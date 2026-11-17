-- Morse challenge. All tables prefixed morse_.

-- One row, the organiser on/off switch.
CREATE TABLE morse_config (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1
);
INSERT INTO morse_config (id, enabled) VALUES (1, 1);

-- Every issued round. The word lives only here, on the server.
CREATE TABLE morse_rounds (
  id              TEXT PRIMARY KEY,
  attendee_id     INTEGER NOT NULL REFERENCES attendees(id),
  mode            TEXT NOT NULL CHECK (mode IN ('decode', 'encode')),
  level           INTEGER NOT NULL,
  word            TEXT NOT NULL,
  wpm             REAL NOT NULL,
  issued_at       INTEGER NOT NULL,
  -- decode: when the beeps end (the speed clock starts here); encode: issued_at
  answer_from     INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'failed', 'expired', 'abandoned')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  sprint_id       INTEGER
);
CREATE INDEX morse_rounds_attendee ON morse_rounds(attendee_id, issued_at);
CREATE INDEX morse_rounds_open ON morse_rounds(status, expires_at);

-- Personal best per attendee, mode and level. Points are paid on improvement only.
CREATE TABLE morse_best (
  attendee_id    INTEGER NOT NULL REFERENCES attendees(id),
  mode           TEXT NOT NULL,
  level          INTEGER NOT NULL,
  best_score     INTEGER NOT NULL DEFAULT 0,
  best_wpm       REAL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  first_clear_at INTEGER,
  PRIMARY KEY (attendee_id, mode, level)
) WITHOUT ROWID;

-- Persisted "someone just cleared" feed for the projector.
CREATE TABLE morse_feed (
  id          INTEGER PRIMARY KEY,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  mode        TEXT NOT NULL,
  level       INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  wpm         REAL,
  first_clear INTEGER NOT NULL,
  at          INTEGER NOT NULL
);

CREATE TABLE morse_sprints (
  id         INTEGER PRIMARY KEY,
  mode       TEXT NOT NULL,
  level      INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ended')),
  ended_at   INTEGER
);

CREATE TABLE morse_sprint_scores (
  sprint_id   INTEGER NOT NULL REFERENCES morse_sprints(id),
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  score       INTEGER NOT NULL DEFAULT 0,
  rounds      INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER NOT NULL,
  PRIMARY KEY (sprint_id, attendee_id)
) WITHOUT ROWID;
