-- One row: the organiser's freeze / final-reveal state, with the board as it stood when frozen.
CREATE TABLE leaderboard_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  frozen            INTEGER NOT NULL DEFAULT 0,
  frozen_at         INTEGER,
  hide_top          INTEGER NOT NULL DEFAULT 1,
  top_n             INTEGER NOT NULL DEFAULT 10,
  step_ms           INTEGER NOT NULL DEFAULT 5000,
  suspense_ms       INTEGER NOT NULL DEFAULT 4000,
  reveal_started_at INTEGER,
  snapshot          TEXT                       -- JSON array of full (unmasked) board rows at freeze time
);
INSERT INTO leaderboard_state (id) VALUES (1);
