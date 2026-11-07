-- Every Claude chat, indexed and categorized by tools/sync_projects.py.
CREATE TABLE chats (
  id         TEXT PRIMARY KEY,
  start      TEXT NOT NULL,
  category   TEXT NOT NULL,
  data       TEXT NOT NULL,
  synced_at  TEXT NOT NULL
);
CREATE INDEX chats_start ON chats(start);
