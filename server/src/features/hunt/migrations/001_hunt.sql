-- Treasure hunt (spec 5.5). One hunt per event; the table prefix is hunt_.

CREATE TABLE hunt_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  title        TEXT NOT NULL,
  -- Seeds the per-attendee shuffle. Random per database, never sent to clients.
  shuffle_seed TEXT NOT NULL,
  opened_at    INTEGER,
  closed_at    INTEGER
);
INSERT INTO hunt_state (id, status, title, shuffle_seed)
VALUES (1, 'draft', 'the after hours hunt', lower(hex(randomblob(16))));

CREATE TABLE hunt_stops (
  id          INTEGER PRIMARY KEY,
  position    INTEGER NOT NULL,            -- authoring order; the last one is the finale
  title       TEXT NOT NULL,
  clue        TEXT NOT NULL,
  clue_image  TEXT,
  answers     TEXT NOT NULL DEFAULT '[]',  -- JSON array of accepted answers as typed by the organiser
  hints       TEXT NOT NULL DEFAULT '[]',  -- JSON array, at most 2
  points      INTEGER NOT NULL DEFAULT 10,
  glyph       TEXT NOT NULL DEFAULT 'star',
  color       TEXT NOT NULL DEFAULT 'tangerine',
  reveal      TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',    -- organiser-only note
  token       TEXT NOT NULL UNIQUE,        -- random, in the QR url
  code        TEXT NOT NULL UNIQUE         -- 8 unambiguous chars, printed under the QR
);

-- Someone who pressed "start". The clock runs from started_at.
CREATE TABLE hunt_players (
  attendee_id INTEGER PRIMARY KEY REFERENCES attendees(id),
  started_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  finished_at INTEGER,
  finish_rank INTEGER,
  elapsed_ms  INTEGER,
  bonus       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX hunt_players_finish ON hunt_players(finish_rank);

CREATE TABLE hunt_progress (
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  stop_id     INTEGER NOT NULL REFERENCES hunt_stops(id) ON DELETE CASCADE,
  solved_at   INTEGER NOT NULL,
  via         TEXT NOT NULL CHECK (via IN ('qr', 'answer')),
  points      INTEGER NOT NULL,
  hints_used  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attendee_id, stop_id)
);
CREATE INDEX hunt_progress_stop ON hunt_progress(stop_id);

-- Per attendee per stop: revealed hints and the escalating wrong-answer lock.
CREATE TABLE hunt_stop_state (
  attendee_id  INTEGER NOT NULL REFERENCES attendees(id),
  stop_id      INTEGER NOT NULL REFERENCES hunt_stops(id) ON DELETE CASCADE,
  hints_used   INTEGER NOT NULL DEFAULT 0,
  wrong_count  INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attendee_id, stop_id)
);
