CREATE TABLE IF NOT EXISTS azure_speech_usage (
  month_key TEXT PRIMARY KEY NOT NULL,
  milliseconds_used INTEGER NOT NULL DEFAULT 0 CHECK (
    milliseconds_used >= 0 AND milliseconds_used <= 16200000
  ),
  warning_emitted INTEGER NOT NULL DEFAULT 0 CHECK (
    warning_emitted IN (0, 1)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
