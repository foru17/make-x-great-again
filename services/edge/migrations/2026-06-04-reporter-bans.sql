-- LUO-62 reporter ban controls.
CREATE TABLE IF NOT EXISTS reporter_bans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_fp   TEXT NOT NULL,
  reason        TEXT,
  created_by    TEXT NOT NULL DEFAULT 'admin',
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reporter_bans_fp_active
  ON reporter_bans(reporter_fp, expires_at);
