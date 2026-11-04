ALTER TABLE community_event ADD COLUMN IF NOT EXISTS recovered boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS community_join_recovery (
 id integer PRIMARY KEY CHECK(id=1), completed_until timestamptz NOT NULL
);
