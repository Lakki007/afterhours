-- Core tables: kits, attendees, sessions, points ledger, stickers, push, kv.
-- Feature tables live in server/src/features/<name>/migrations/ and may
-- reference attendees(id), never another feature's tables.

CREATE TABLE kits (
  id            TEXT PRIMARY KEY,              -- 'AH-042'
  password_hash TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  preset_name   TEXT,                          -- from a pasted name,roll CSV
  preset_roll   TEXT,
  created_at    INTEGER NOT NULL,
  device_hash   TEXT,                          -- sha256 of the bound phone's device cookie
  bound_at      INTEGER,
  resets        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attendees (
  id               INTEGER PRIMARY KEY,
  kit_id           TEXT NOT NULL UNIQUE REFERENCES kits(id),
  name             TEXT,
  roll             TEXT,
  nickname         TEXT,
  avatar           TEXT,                       -- JSON AvatarConfig
  profile_complete INTEGER NOT NULL DEFAULT 0,
  first_signin_at  INTEGER NOT NULL,           -- event attendance record (spec 4)
  profile_at       INTEGER
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,                -- sha256 of the cookie value
  kind        TEXT NOT NULL CHECK (kind IN ('attendee', 'admin', 'screen')),
  attendee_id INTEGER REFERENCES attendees(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_attendee ON sessions(attendee_id);

CREATE TABLE points_ledger (
  id          INTEGER PRIMARY KEY,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  source      TEXT NOT NULL,
  ref         TEXT NOT NULL,
  points      INTEGER NOT NULL,
  label       TEXT,
  at          INTEGER NOT NULL,
  UNIQUE (attendee_id, source, ref)
);
CREATE INDEX points_ledger_attendee ON points_ledger(attendee_id);

CREATE TABLE sticker_unlocks (
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  sticker_id  TEXT NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (attendee_id, sticker_id)
) WITHOUT ROWID;

CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  attendee_id INTEGER REFERENCES attendees(id) ON DELETE CASCADE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_attendee ON push_subscriptions(attendee_id);

CREATE TABLE core_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
