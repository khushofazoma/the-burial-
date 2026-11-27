-- A permanent record of which feature was sentenced each month.
-- feature and votes are snapshots, so the record survives the proposal being removed.
CREATE TABLE verdicts (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT REFERENCES proposals (id) ON DELETE SET NULL,
  feature     TEXT NOT NULL,
  votes       INTEGER NOT NULL DEFAULT 0,
  month       TEXT NOT NULL,          -- YYYY-MM
  chosen_at   TEXT NOT NULL
);
CREATE INDEX verdicts_by_month ON verdicts (month);

ALTER TABLE proposals ADD COLUMN chosen_at TEXT;

-- Record anything already marked "next to die" under the current month.
UPDATE proposals SET chosen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE chosen = 1;
INSERT INTO verdicts (id, proposal_id, feature, votes, month, chosen_at)
SELECT lower(hex(randomblob(16))), p.id, p.feature,
       (SELECT COUNT(*) FROM ballots b WHERE b.proposal_id = p.id),
       strftime('%Y-%m', 'now'), p.chosen_at
  FROM proposals p WHERE p.chosen = 1;
