CREATE TABLE IF NOT EXISTS dictionary_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dictionary_cache_expiry ON dictionary_cache(expires_at);

CREATE TABLE IF NOT EXISTS request_limits (
  counter_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(reset_at);
