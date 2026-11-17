-- Run of show. Times are epoch ms. AUTOINCREMENT so a deleted activity's id is never reused
-- (alert claims are keyed by activity id).
CREATE TABLE schedule_activities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  blurb            TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'other',
  highlight        INTEGER NOT NULL DEFAULT 0,
  link             TEXT,
  start_at         INTEGER NOT NULL,
  end_at           INTEGER NOT NULL,
  planned_start_at INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
  actual_start_at  INTEGER,
  actual_end_at    INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX schedule_activities_start ON schedule_activities (start_at, id);

CREATE TABLE schedule_meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO schedule_meta (key, value) VALUES ('version', 0);
