-- The site no longer requires sign-in, so there is no register of who voted.
-- Drop it so no emails remain stored.
DROP TABLE IF EXISTS participants;
