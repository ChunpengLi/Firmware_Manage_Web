CREATE TABLE IF NOT EXISTS firmware_records (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS firmware_records_category_date
  ON firmware_records(category, updated_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  multipart_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  old_object_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);
