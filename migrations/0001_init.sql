-- Kanban board: fixed-order columns holding cards. Card order within a column
-- is a REAL "position" so a move only rewrites the moved card.
CREATE TABLE columns (
  id       INTEGER PRIMARY KEY,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  column_id   INTEGER NOT NULL REFERENCES columns(id),
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  label       TEXT    NOT NULL DEFAULT '',
  position    REAL    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX cards_column_position ON cards(column_id, position);

INSERT INTO columns (id, name, position) VALUES
  (1, 'Backlog', 0), (2, 'To do', 1), (3, 'In progress', 2), (4, 'Done', 3);
