CREATE TABLE IF NOT EXISTS member_profile (
 user_id text PRIMARY KEY, display_name text NOT NULL, username text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_access (
 user_id text PRIMARY KEY, role text NOT NULL, revoked boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations_settings (
 id integer PRIMARY KEY CHECK(id=1), body jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_event (
 event_key text PRIMARY KEY, kind text NOT NULL, user_id text NOT NULL,
 channel_id text, occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_event_time ON community_event(occurred_at,kind);
CREATE TABLE IF NOT EXISTS risk_signal (
 message_id text PRIMARY KEY, user_id text NOT NULL, channel_id text NOT NULL,
 matches jsonb NOT NULL, status text NOT NULL DEFAULT 'OPEN', reviewed_by text,
 review_note text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS gateway_observation (
 id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 members_enabled boolean NOT NULL, messages_enabled boolean NOT NULL, content_enabled boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS member_presence (
 user_id text PRIMARY KEY, state text NOT NULL DEFAULT 'UNKNOWN', last_join_key text
);
