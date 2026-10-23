CREATE TABLE IF NOT EXISTS xp_rule_revision (
 id uuid PRIMARY KEY, version integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','PUBLISHED','SUPERSEDED')),
 body jsonb NOT NULL, reason text NOT NULL, authored_by text NOT NULL,
 approved_by text, published_by text, created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published_xp ON xp_rule_revision(status) WHERE status='PUBLISHED';
CREATE TABLE IF NOT EXISTS xp_ledger (
 id uuid PRIMARY KEY, user_id text NOT NULL, amount integer NOT NULL CHECK(amount<>0),
 event_kind text NOT NULL, source_key text NOT NULL, reason text NOT NULL,
 actor_id text NOT NULL, rule_version integer NOT NULL REFERENCES xp_rule_revision(version),
 rule_snapshot jsonb NOT NULL, channel_id text, content_hash text,
 occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS xp_unique_source ON xp_ledger(source_key);
CREATE INDEX IF NOT EXISTS xp_user_time ON xp_ledger(user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS xp_event_time ON xp_ledger(user_id,event_kind,occurred_at DESC);
CREATE TABLE IF NOT EXISTS xp_boost_state (
 user_id text PRIMARY KEY, started_at timestamptz NOT NULL, active boolean NOT NULL,
 verified_at timestamptz NOT NULL, next_check_at timestamptz NOT NULL DEFAULT now(),
 next_cycle_at timestamptz NOT NULL, last_error_code text, first_eligible boolean NOT NULL DEFAULT false
);
ALTER TABLE xp_boost_state ADD COLUMN IF NOT EXISTS last_error_code text;
