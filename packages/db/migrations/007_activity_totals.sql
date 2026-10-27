CREATE TABLE IF NOT EXISTS community_lifetime (
 id integer PRIMARY KEY CHECK(id=1), joins bigint NOT NULL DEFAULT 0, leaves bigint NOT NULL DEFAULT 0,
 messages bigint NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(), legacy_limited boolean NOT NULL DEFAULT false
);
INSERT INTO community_lifetime(id,joins,leaves,messages,started_at,legacy_limited)
SELECT 1,count(*) FILTER(WHERE kind='JOIN'),count(*) FILTER(WHERE kind='LEAVE'),count(*) FILTER(WHERE kind='MESSAGE'),
 COALESCE((SELECT started_at FROM gateway_observation WHERE id=1),min(occurred_at),now()),
 COALESCE((SELECT started_at<now()-interval '90 days' FROM gateway_observation WHERE id=1),false)
FROM community_event ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS community_lifetime_speaker (user_id text PRIMARY KEY);
INSERT INTO community_lifetime_speaker(user_id) SELECT DISTINCT user_id FROM community_event WHERE kind='MESSAGE' ON CONFLICT(user_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS community_capture_minute (
 minute timestamptz PRIMARY KEY, members_seen boolean NOT NULL, messages_seen boolean NOT NULL
);
ALTER TABLE gateway_observation ADD COLUMN IF NOT EXISTS member_count integer;
ALTER TABLE gateway_observation ADD COLUMN IF NOT EXISTS member_count_at timestamptz;
