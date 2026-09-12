import {
  getRuntimeD1Database,
  type D1DatabaseBinding,
} from "../lib/runtime-bindings";
import { AZURE_TRANSLATION_USAGE_TABLE_SQL } from "./schema";

export const AZURE_TRANSLATION_WARNING_CHARACTERS = 1_800_000;
export const AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS = 1_900_000;

type D1ResultRow = Record<string, unknown>;

type UsageRow = D1ResultRow & {
  characters_used: number;
};

export type AzureTranslationReservation =
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

/** Azure Translator meters the number of input characters sent to the service. */
export function countAzureTranslationCharacters(text: string): number {
  return Array.from(text).length;
}

async function ensureSchema(database: D1DatabaseBinding): Promise<void> {
  schemaReady ??= database
    .prepare(AZURE_TRANSLATION_USAGE_TABLE_SQL)
    .run()
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  await schemaReady;
}

/**
 * Reserves characters atomically before Azure is contacted. Retried requests
 * are reserved again because every attempt can be metered by the provider.
 * If D1 is unavailable, Azure is skipped so a meter outage cannot create an
 * unbounded bill.
 */
export async function reserveAzureTranslationCharacters(
  text: string,
  date = new Date(),
): Promise<AzureTranslationReservation> {
  const characters = countAzureTranslationCharacters(text);
  const database = getDatabase();
  if (!database) {
    return { allowed: false, characters, reason: "meter-unavailable" };
  }

  try {
    await ensureSchema(database);
    const monthKey = currentUtcMonth(date);
    const usage = await database
      .prepare(
        `INSERT INTO azure_translation_usage (
          month_key,
          characters_used,
          warning_emitted,
          created_at,
          updated_at
        )
        SELECT ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE ? <= ?
        ON CONFLICT(month_key) DO UPDATE SET
          characters_used = azure_translation_usage.characters_used + excluded.characters_used,
          updated_at = CURRENT_TIMESTAMP
        WHERE azure_translation_usage.characters_used + excluded.characters_used <= ?
        RETURNING characters_used`,
      )
      .bind(
        monthKey,
        characters,
        characters,
        AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS,
        AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS,
      )
      .first<UsageRow>();

    if (!usage) {
      return { allowed: false, characters, reason: "hard-limit-reached" };
    }

    let warningJustReached = false;
    if (usage.characters_used >= AZURE_TRANSLATION_WARNING_CHARACTERS) {
      const warning = await database
        .prepare(
          `UPDATE azure_translation_usage
          SET warning_emitted = 1, updated_at = CURRENT_TIMESTAMP
          WHERE month_key = ?
            AND characters_used >= ?
            AND warning_emitted = 0
          RETURNING characters_used`,
        )
        .bind(monthKey, AZURE_TRANSLATION_WARNING_CHARACTERS)
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
