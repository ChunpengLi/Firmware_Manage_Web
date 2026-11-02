CREATE TABLE IF NOT EXISTS pcs_packages (
  kind TEXT NOT NULL CHECK(kind IN ('software', 'firmware')),
  file_name TEXT NOT NULL COLLATE NOCASE,
  object_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY(kind, file_name)
);
CREATE TABLE IF NOT EXISTS pcs_sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pcs_uploads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL COLLATE NOCASE,
  object_key TEXT NOT NULL,
  multipart_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  parts TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE(kind, file_name)
);
