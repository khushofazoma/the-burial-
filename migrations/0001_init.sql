-- Proposals: no information about who nominated them.
CREATE TABLE proposals (
  id         TEXT PRIMARY KEY,
  feature    TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'buried')),
  created_at TEXT NOT NULL,
  buried_at  TEXT
);

-- Ballots: HMAC(BALLOT_SECRET, email + ':' + proposal id). No emails, no timestamps.
-- WITHOUT ROWID stores rows in key order, so insertion (voting) order is not kept.
CREATE TABLE ballots (
  proposal_id TEXT NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  ballot      TEXT NOT NULL,
  PRIMARY KEY (proposal_id, ballot)
) WITHOUT ROWID;

CREATE INDEX ballots_by_hash ON ballots (ballot);
