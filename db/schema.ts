/**
 * Operational data kept in Sites D1. User accounts and vocabulary records stay
 * in Supabase; this table only protects the Azure translation budget.
 */
export const AZURE_TRANSLATION_USAGE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS azure_translation_usage (
  month_key TEXT PRIMARY KEY NOT NULL,
  characters_used INTEGER NOT NULL DEFAULT 0 CHECK (
    characters_used >= 0 AND characters_used <= 1900000
  ),
  warning_emitted INTEGER NOT NULL DEFAULT 0 CHECK (
    warning_emitted IN (0, 1)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

/**
 * Operational meter for the optional microphone fallback. Audio itself is
 * never stored: only the number of milliseconds reserved for Azure Speech.
 */
export const AZURE_SPEECH_USAGE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS azure_speech_usage (
  month_key TEXT PRIMARY KEY NOT NULL,
  milliseconds_used INTEGER NOT NULL DEFAULT 0 CHECK (
    milliseconds_used >= 0 AND milliseconds_used <= 16200000
  ),
  warning_emitted INTEGER NOT NULL DEFAULT 0 CHECK (
    warning_emitted IN (0, 1)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
