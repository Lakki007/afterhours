-- Per-activity check-in. Activities belong to the schedule feature: activity_id is an opaque
-- string, never a foreign key. Titles are copied in when the console opens a check-in.
CREATE TABLE attendance_windows (
  activity_id TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  is_open     INTEGER NOT NULL DEFAULT 1,
  opened_at   INTEGER NOT NULL,
  closed_at   INTEGER,
  closes_at   INTEGER                      -- optional auto-close
);

CREATE TABLE attendance_checkins (
  id          INTEGER PRIMARY KEY,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  activity_id TEXT NOT NULL,
  at          INTEGER NOT NULL,
  method      TEXT NOT NULL DEFAULT 'code' CHECK (method IN ('code', 'manual')),
  UNIQUE (attendee_id, activity_id)
);
CREATE INDEX attendance_checkins_activity ON attendance_checkins(activity_id, id);

-- Server-side secret for the rotating codes. Generated once, never leaves the server.
CREATE TABLE attendance_secret (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL
);
