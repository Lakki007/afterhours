-- Polls and quiz. The correct quiz option lives ONLY in polls.correct_option;
-- it is never copied into config and is only selected by code that has
-- already decided the viewer may see it (console, or poll revealed).
CREATE TABLE polls (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('single', 'multi', 'this_or_that', 'rating', 'wordcloud', 'quiz')),
  question       TEXT NOT NULL,
  config         TEXT NOT NULL,                 -- JSON: kind-specific, never contains the answer
  correct_option INTEGER,                       -- quiz only, SECRET until reveal
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed', 'revealed')),
  position       INTEGER NOT NULL,
  series         TEXT,                          -- quiz scoreboard group
  created_at     INTEGER NOT NULL,
  opened_at      INTEGER,
  starts_at      INTEGER,
  deadline_at    INTEGER,
  closed_at      INTEGER,
  revealed_at    INTEGER
);

-- One live poll at a time, enforced by the database as well as the code.
CREATE UNIQUE INDEX polls_one_live ON polls (status) WHERE status = 'live';

-- One vote per attendee per poll: the primary key IS the rule.
CREATE TABLE poll_votes (
  poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  received_at INTEGER NOT NULL,                 -- server clock at receipt
  choice      INTEGER,                          -- single / this_or_that / quiz
  value       INTEGER,                          -- rating
  correct     INTEGER,                          -- quiz: 1/0, decided at answer time, secret until reveal
  points      INTEGER NOT NULL DEFAULT 0,       -- quiz: base + speed bonus if correct
  speed_bonus INTEGER NOT NULL DEFAULT 0,
  elapsed_ms  INTEGER,                          -- quiz: receipt - startsAt, clamped
  PRIMARY KEY (poll_id, attendee_id)
) WITHOUT ROWID;

CREATE INDEX poll_votes_by_attendee ON poll_votes (attendee_id);

-- Multi-choice picks (item = option index) and word cloud words (item = normalised word).
CREATE TABLE poll_vote_items (
  poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  item        TEXT NOT NULL,
  PRIMARY KEY (poll_id, attendee_id, item)
) WITHOUT ROWID;
CREATE INDEX poll_vote_items_by_item ON poll_vote_items (poll_id, item);

CREATE TABLE poll_hidden_words (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  word    TEXT NOT NULL,
  PRIMARY KEY (poll_id, word)
) WITHOUT ROWID;
