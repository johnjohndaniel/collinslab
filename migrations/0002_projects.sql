-- Live project overviews, written by tools/sync_projects.py. One JSON blob per project.
CREATE TABLE projects (
  slug       TEXT PRIMARY KEY,
  sort       INTEGER NOT NULL DEFAULT 0,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
