import {
  getRuntimeD1Database,
  type D1DatabaseBinding,
} from "../lib/runtime-bindings";
import { AZURE_SPEECH_USAGE_TABLE_SQL } from "./schema";

export const AZURE_SPEECH_WARNING_MILLISECONDS = 14_400_000;
export const AZURE_SPEECH_HARD_LIMIT_MILLISECONDS = 16_200_000;

type UsageRow = Record<string, unknown> & {
  milliseconds_used: number;
};

export type AzureSpeechReservation =
  | {
      allowed: true;
      milliseconds: number;
      millisecondsUsed: number;
      warningJustReached: boolean;
    }
  | {
      allowed: false;
      milliseconds: number;
      reason: "hard-limit-reached" | "meter-unavailable";
    };

let schemaReady: Promise<void> | null = null;

function getDatabase(): D1DatabaseBinding | null {
  return getRuntimeD1Database();
}

function currentUtcMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

async function ensureSchema(database: D1DatabaseBinding): Promise<void> {
  schemaReady ??= database
    .prepare(AZURE_SPEECH_USAGE_TABLE_SQL)
    .run()
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  await schemaReady;
}

/**
 * Reserves audio duration atomically before Azure is contacted. Failing closed
 * keeps a missing meter from turning into an unbounded paid service.
 */
export async function reserveAzureSpeechMilliseconds(
  milliseconds: number,
  date = new Date(),
): Promise<AzureSpeechReservation> {
  const duration = Math.max(1, Math.ceil(milliseconds));
  const database = getDatabase();
  if (!database) {
    return { allowed: false, milliseconds: duration, reason: "meter-unavailable" };
  }

  try {
    await ensureSchema(database);
    const monthKey = currentUtcMonth(date);
    const usage = await database
      .prepare(
        `INSERT INTO azure_speech_usage (
          month_key,
          milliseconds_used,
          warning_emitted,
          created_at,
          updated_at
        )
        SELECT ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE ? <= ?
        ON CONFLICT(month_key) DO UPDATE SET
          milliseconds_used = azure_speech_usage.milliseconds_used + excluded.milliseconds_used,
          updated_at = CURRENT_TIMESTAMP
        WHERE azure_speech_usage.milliseconds_used + excluded.milliseconds_used <= ?
        RETURNING milliseconds_used`,
      )
      .bind(
        monthKey,
        duration,
        duration,
        AZURE_SPEECH_HARD_LIMIT_MILLISECONDS,
        AZURE_SPEECH_HARD_LIMIT_MILLISECONDS,
      )
      .first<UsageRow>();

    if (!usage) {
      return { allowed: false, milliseconds: duration, reason: "hard-limit-reached" };
    }

    let warningJustReached = false;
    if (usage.milliseconds_used >= AZURE_SPEECH_WARNING_MILLISECONDS) {
      const warning = await database
        .prepare(
          `UPDATE azure_speech_usage
          SET warning_emitted = 1, updated_at = CURRENT_TIMESTAMP
          WHERE month_key = ?
            AND milliseconds_used >= ?
            AND warning_emitted = 0
          RETURNING milliseconds_used`,
        )
        .bind(monthKey, AZURE_SPEECH_WARNING_MILLISECONDS)
        .first<UsageRow>();
      warningJustReached = Boolean(warning);
    }

    return {
      allowed: true,
      milliseconds: duration,
      millisecondsUsed: usage.milliseconds_used,
      warningJustReached,
    };
  } catch (error) {
    console.error("[speech-usage] D1 reservation failed", error);
    return { allowed: false, milliseconds: duration, reason: "meter-unavailable" };
  }
}
