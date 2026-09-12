CREATE TABLE IF NOT EXISTS azure_translation_usage (
  month_key TEXT PRIMARY KEY NOT NULL,
  characters_used INTEGER NOT NULL DEFAULT 0 CHECK (
    characters_used >= 0 AND characters_used <= 1900000
  ),
  warning_emitted INTEGER NOT NULL DEFAULT 0 CHECK (
    warning_emitted IN (0, 1)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
