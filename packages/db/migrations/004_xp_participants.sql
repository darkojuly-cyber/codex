CREATE TABLE IF NOT EXISTS xp_participant (
 user_id text PRIMARY KEY,
 can_earn boolean NOT NULL,
 can_rank boolean NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xp_ledger_time ON xp_ledger(occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS xp_ledger_type_time ON xp_ledger(event_kind,occurred_at DESC,id DESC);
