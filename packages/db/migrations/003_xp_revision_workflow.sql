-- Keep existing published rules and ledger intact. Legacy pending revisions have
-- no known base and must be copied into a new draft before they can be published.
ALTER TABLE xp_rule_revision ADD COLUMN IF NOT EXISTS base_version integer REFERENCES xp_rule_revision(version);
ALTER TABLE xp_rule_revision ADD COLUMN IF NOT EXISTS edit_version integer NOT NULL DEFAULT 1;
