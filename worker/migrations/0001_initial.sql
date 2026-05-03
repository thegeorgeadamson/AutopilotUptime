CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL,
  error TEXT,
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checks_target_time
  ON checks (target_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_checks_time
  ON checks (checked_at DESC);
