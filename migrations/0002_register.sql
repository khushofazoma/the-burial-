-- Who has taken part (voted or nominated). Deliberately NOT linked to proposals or ballots,
-- and only the day is kept, never the time, so it cannot be matched to individual votes.
CREATE TABLE participants (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  first_voted TEXT NOT NULL,
  last_voted  TEXT NOT NULL
) WITHOUT ROWID;
