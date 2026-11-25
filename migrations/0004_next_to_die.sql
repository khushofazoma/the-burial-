-- "Next to die" is an admin decision, not the vote leader.
ALTER TABLE proposals ADD COLUMN chosen INTEGER NOT NULL DEFAULT 0;
