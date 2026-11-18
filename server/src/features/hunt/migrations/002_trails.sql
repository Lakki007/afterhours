-- Trails: the hunt engine generalised. A trail is its own sequence of stops with its own
-- open/close state, order mode, hint and cooldown switches, points and finish order.
-- The existing treasure hunt becomes trail 1; every existing row is moved onto it.

CREATE TABLE hunt_trails (
  id           INTEGER PRIMARY KEY,
  position     INTEGER NOT NULL DEFAULT 1,
  kind         TEXT NOT NULL DEFAULT 'hunt' CHECK (kind IN ('hunt', 'morse', 'other')),
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  order_mode   TEXT NOT NULL DEFAULT 'shuffled' CHECK (order_mode IN ('shuffled', 'fixed', 'graph')),
  hints_on     INTEGER NOT NULL DEFAULT 1,
  cooldown_on  INTEGER NOT NULL DEFAULT 1,
  shuffle_seed TEXT NOT NULL,
  opened_at    INTEGER,
  closed_at    INTEGER
);
INSERT INTO hunt_trails (id, position, kind, title, status, shuffle_seed, opened_at, closed_at)
SELECT 1, 1, 'hunt', title, status, shuffle_seed, opened_at, closed_at FROM hunt_state WHERE id = 1;
DROP TABLE hunt_state;

-- Stops belong to a trail and say how they are verified.
--   riddle: typed answer (scanning the sticker also works unless require_scan)
--   scan:   only the sticker/object QR
--   morse:  the object carries a Morse message; decode it and type the word
-- require_scan: the QR must be scanned before the answer box opens (proves you found the object).
-- online_fallback (morse): the phone may play/flash the signal itself (never the readable word).
-- (no REFERENCES: SQLite refuses ADD COLUMN with a foreign key and a non-null default; trail deletes are done in code)
ALTER TABLE hunt_stops ADD COLUMN trail_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hunt_stops ADD COLUMN challenge TEXT NOT NULL DEFAULT 'riddle' CHECK (challenge IN ('riddle', 'scan', 'morse', 'slip'));
ALTER TABLE hunt_stops ADD COLUMN require_scan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hunt_stops ADD COLUMN online_fallback INTEGER NOT NULL DEFAULT 0;
UPDATE hunt_stops SET challenge = 'scan' WHERE answers = '[]';
CREATE INDEX hunt_stops_trail ON hunt_stops(trail_id, position);

-- Players are per trail now: recreate with a composite key, keeping every row on trail 1.
CREATE TABLE hunt_players_v2 (
  trail_id    INTEGER NOT NULL DEFAULT 1 REFERENCES hunt_trails(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  started_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  finished_at INTEGER,
  finish_rank INTEGER,
  elapsed_ms  INTEGER,
  bonus       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trail_id, attendee_id)
);
INSERT INTO hunt_players_v2 (trail_id, attendee_id, started_at, last_at, finished_at, finish_rank, elapsed_ms, bonus)
SELECT 1, attendee_id, started_at, last_at, finished_at, finish_rank, elapsed_ms, bonus FROM hunt_players;
DROP TABLE hunt_players;
ALTER TABLE hunt_players_v2 RENAME TO hunt_players;
CREATE INDEX hunt_players_finish ON hunt_players(trail_id, finish_rank);

-- A scanned-but-not-yet-solved stop (require_scan unlock).
ALTER TABLE hunt_stop_state ADD COLUMN scanned_at INTEGER;
