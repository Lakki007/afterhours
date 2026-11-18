-- Arcade runs: one row per issued token. The token is the primary key and is single use.
CREATE TABLE arcade_runs (
  id           TEXT PRIMARY KEY,               -- random 128-bit hex token
  attendee_id  INTEGER NOT NULL REFERENCES attendees(id),
  game         TEXT NOT NULL CHECK (game IN ('reaction', 'hexbin', 'memory')),
  seed         INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected', 'abandoned')),
  progress     INTEGER NOT NULL DEFAULT 0,     -- memory: levels cleared so far
  last_at      INTEGER,                        -- memory: time of the last accepted step
  score        INTEGER,
  points       INTEGER,
  submitted_at INTEGER
);
CREATE INDEX arcade_runs_attendee ON arcade_runs(attendee_id, game, status);

-- Each attendee's personal best per game (also drives the per-game top list).
CREATE TABLE arcade_best (
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  game        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  label       TEXT NOT NULL,
  at          INTEGER NOT NULL,                -- when the best was set (earlier wins ties)
  PRIMARY KEY (attendee_id, game)
) WITHOUT ROWID;
CREATE INDEX arcade_best_top ON arcade_best(game, score DESC, at ASC);

CREATE TABLE arcade_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
