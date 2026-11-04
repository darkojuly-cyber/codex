CREATE TABLE IF NOT EXISTS community_message_recovery (
 channel_id text PRIMARY KEY, completed_until timestamptz NOT NULL
);
