-- Hourly project pulse, written by tools/pulse/push.py. kind is 'manuscript' or 'portfolio'.
-- Project-level pulse is merged into the projects table by tools/sync_projects.py instead.
CREATE TABLE pulse (
  slug       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  project    TEXT,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX pulse_kind ON pulse (kind);
