-- Running totals for the console, and per-attendee counts for the "hype machine" sticker.
CREATE TABLE reactions_totals (
  kind  TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reactions_by_attendee (
  attendee_id INTEGER PRIMARY KEY REFERENCES attendees(id),
  count       INTEGER NOT NULL DEFAULT 0
);
