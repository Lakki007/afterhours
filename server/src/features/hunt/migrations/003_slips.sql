-- Morse slips (docs/SLIPS.md) and graph trails.
--
-- Graph trails: a stop's exits decide where you go next. `next_stop_id` is the plain exit of a
-- riddle/scan/morse stop; slip stops exit through their readings' outcomes. `is_finale` marks the
-- stops that end the trail. Each player's position is stored, so progress is the path they took.
ALTER TABLE hunt_stops ADD COLUMN next_stop_id INTEGER;
ALTER TABLE hunt_stops ADD COLUMN is_finale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hunt_stops ADD COLUMN slip_id INTEGER;
ALTER TABLE hunt_players ADD COLUMN current_stop_id INTEGER;

-- A slip set: the slips that go into every kit (shared) or that are drawn per kit from a word pool.
CREATE TABLE hunt_slip_sets (
  id         INTEGER PRIMARY KEY,
  trail_id   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'shared' CHECK (mode IN ('shared', 'per_kit')),
  word_pool  TEXT NOT NULL DEFAULT '[]'   -- JSON array of words for per-kit draws
);

CREATE TABLE hunt_slips (
  id       INTEGER PRIMARY KEY,
  set_id   INTEGER NOT NULL REFERENCES hunt_slip_sets(id) ON DELETE CASCADE,
  slip_no  INTEGER NOT NULL,
  label    TEXT NOT NULL DEFAULT ''
);

-- One orientation of a slip (bottom/right/top/left: the edge at the bottom of the camera view),
-- or an extra 'decoy' sequence such as the upside-down top strip. `morse` is the normalised
-- sequence ("-.-. --- -.. ."); for per-kit sets the word and morse live in hunt_kit_slip_words.
CREATE TABLE hunt_slip_readings (
  id             INTEGER PRIMARY KEY,
  slip_id        INTEGER NOT NULL REFERENCES hunt_slips(id) ON DELETE CASCADE,
  orientation    TEXT NOT NULL CHECK (orientation IN ('bottom', 'right', 'top', 'left', 'extra')),
  word           TEXT,
  morse          TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('next', 'branch', 'clue', 'bonus', 'decoy')),
  target_stop_id INTEGER,
  target_trail_id INTEGER,
  clue           TEXT NOT NULL DEFAULT '',
  bonus_points   INTEGER NOT NULL DEFAULT 0,
  message        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX hunt_slip_readings_morse ON hunt_slip_readings(morse);

-- Per-kit draws: which word this kit's copy of a reading carries.
CREATE TABLE hunt_kit_slip_words (
  kit_id     TEXT NOT NULL,
  reading_id INTEGER NOT NULL REFERENCES hunt_slip_readings(id) ON DELETE CASCADE,
  word       TEXT NOT NULL,
  morse      TEXT NOT NULL,
  PRIMARY KEY (kit_id, reading_id)
);
CREATE INDEX hunt_kit_slip_words_morse ON hunt_kit_slip_words(morse);

-- Who found which reading (live counts per reading; bonus pays once).
CREATE TABLE hunt_slip_finds (
  attendee_id INTEGER NOT NULL,
  reading_id  INTEGER NOT NULL REFERENCES hunt_slip_readings(id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,
  PRIMARY KEY (attendee_id, reading_id)
);
CREATE INDEX hunt_slip_finds_reading ON hunt_slip_finds(reading_id);
