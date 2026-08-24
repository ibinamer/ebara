import {
  getRuntimeD1Database,
  type D1DatabaseBinding,
} from "../lib/runtime-bindings";
import { GOOGLE_TRANSLATION_USAGE_TABLE_SQL } from "./schema";

export const GOOGLE_TRANSLATION_WARNING_CHARACTERS = 400_000;
export const GOOGLE_TRANSLATION_HARD_LIMIT_CHARACTERS = 450_000;

type D1ResultRow = Record<string, unknown>;

type UsageRow = D1ResultRow & {
  characters_used: number;
};

export type GoogleTranslationReservation =
  | {
      allowed: true;
      characters: number;
      charactersUsed: number;
      warningJustReached: boolean;
    }
  | {
      allowed: false;
      characters: number;
      reason: "hard-limit-reached" | "meter-unavailable";
    };

let schemaReady: Promise<void> | null = null;

function getDatabase(): D1DatabaseBinding | null {
  return getRuntimeD1Database();
}

function currentUtcMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Google bills translation input by Unicode code point, not UTF-16 unit. */
export function countGoogleTranslationCharacters(text: string): number {
  return Array.from(text).length;
}

async function ensureSchema(database: D1DatabaseBinding): Promise<void> {
  schemaReady ??= database
    .prepare(GOOGLE_TRANSLATION_USAGE_TABLE_SQL)
    .run()
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  await schemaReady;
}

/**
 * Atomically reserves the characters before Google is contacted. A failed
 * upstream request remains counted because the text was already sent and may
 * still be billable. When D1 is unavailable, Google is deliberately skipped.
 */
export async function reserveGoogleTranslationCharacters(
  text: string,
  date = new Date(),
): Promise<GoogleTranslationReservation> {
  const characters = countGoogleTranslationCharacters(text);
  const database = getDatabase();
  if (!database) {
    return { allowed: false, characters, reason: "meter-unavailable" };
  }

  try {
    await ensureSchema(database);
    const monthKey = currentUtcMonth(date);
    const usage = await database
      .prepare(
        `INSERT INTO google_translation_usage (
          month_key,
          characters_used,
          warning_emitted,
          created_at,
          updated_at
        )
        SELECT ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE ? <= ?
        ON CONFLICT(month_key) DO UPDATE SET
          characters_used = google_translation_usage.characters_used + excluded.characters_used,
          updated_at = CURRENT_TIMESTAMP
        WHERE google_translation_usage.characters_used + excluded.characters_used <= ?
        RETURNING characters_used`,
      )
      .bind(
        monthKey,
        characters,
        characters,
        GOOGLE_TRANSLATION_HARD_LIMIT_CHARACTERS,
        GOOGLE_TRANSLATION_HARD_LIMIT_CHARACTERS,
      )
      .first<UsageRow>();

    if (!usage) {
      return { allowed: false, characters, reason: "hard-limit-reached" };
    }

    let warningJustReached = false;
    if (usage.characters_used >= GOOGLE_TRANSLATION_WARNING_CHARACTERS) {
      const warning = await database
        .prepare(
          `UPDATE google_translation_usage
          SET warning_emitted = 1, updated_at = CURRENT_TIMESTAMP
          WHERE month_key = ?
            AND characters_used >= ?
            AND warning_emitted = 0
          RETURNING characters_used`,
        )
        .bind(monthKey, GOOGLE_TRANSLATION_WARNING_CHARACTERS)
        .first<UsageRow>();
      warningJustReached = Boolean(warning);
    }

    return {
      allowed: true,
      characters,
      charactersUsed: usage.characters_used,
      warningJustReached,
    };
  } catch (error) {
    console.error("[translation-usage] D1 reservation failed", error);
    return { allowed: false, characters, reason: "meter-unavailable" };
  }
}
