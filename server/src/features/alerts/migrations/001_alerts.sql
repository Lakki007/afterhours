-- Every banner/push that went out (also what GET /recent replays to late phones).
CREATE TABLE alerts_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('soon', 'live', 'announcement')),
  activity_id INTEGER,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT NOT NULL,
  at          INTEGER NOT NULL,
  push_sent   INTEGER,
  push_failed INTEGER,
  push_removed INTEGER
);

-- The exactly-once ledger. A claim is (activity, kind, the start time it was armed for).
-- No foreign key: this scope is migrated before schedule, and a deleted activity's claims are harmless.
-- A delay changes start_at, so the same activity can be claimed again for its new time (re-arm).
CREATE TABLE alerts_claims (
  activity_id INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('soon', 'live')),
  start_at    INTEGER NOT NULL,
  log_id      INTEGER NOT NULL,
  claimed_at  INTEGER NOT NULL,
  PRIMARY KEY (activity_id, kind, start_at)
);
