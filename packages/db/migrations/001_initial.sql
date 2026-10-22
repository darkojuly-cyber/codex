CREATE TABLE IF NOT EXISTS config_revision (
  id uuid PRIMARY KEY, version integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  body jsonb NOT NULL, authored_by text NOT NULL, published_by text,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE TABLE IF NOT EXISTS environment_binding (
  id integer PRIMARY KEY CHECK (id=1), identity text NOT NULL
);
CREATE TABLE IF NOT EXISTS idea_draw (
  id uuid PRIMARY KEY, user_id text NOT NULL, seed_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published ON config_revision(status) WHERE status='PUBLISHED';
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL,
  entity_id text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_session (
  token_hash text PRIMARY KEY, user_id text NOT NULL, role text NOT NULL,
  csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_state (
  state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS member_state (
  user_id text PRIMARY KEY, joined_at timestamptz, welcome_status text NOT NULL,
  message_id text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idea_seed (
  id uuid PRIMARY KEY, title text NOT NULL, seed_text text NOT NULL,
  category text NOT NULL, locale text NOT NULL DEFAULT 'en', active boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'PENDING_APPROVAL'
);
CREATE TABLE IF NOT EXISTS prompt_generation (
  id uuid PRIMARY KEY, user_id text NOT NULL, seed_id uuid NOT NULL REFERENCES idea_seed(id),
  generated_prompt text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE TABLE IF NOT EXISTS ticket (
  id uuid PRIMARY KEY, seq integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_key text NOT NULL UNIQUE, creator_id text NOT NULL, category text NOT NULL,
  summary text NOT NULL, description text NOT NULL, phase text NOT NULL,
  status text NOT NULL, private_channel_id text, assigned_to text,
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  error_code text
);
CREATE INDEX IF NOT EXISTS ticket_creator ON ticket(creator_id, status);
CREATE TABLE IF NOT EXISTS ticket_event (
  id uuid PRIMARY KEY, ticket_id uuid NOT NULL REFERENCES ticket(id),
  actor_id text NOT NULL, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS message_job (
  id uuid PRIMARY KEY, channel_id text NOT NULL, body text NOT NULL,
  scheduled_at timestamptz NOT NULL, status text NOT NULL,
  authored_by text NOT NULL, approved_by text, config_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS message_delivery (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES message_job(id),
  delivery_key text NOT NULL UNIQUE, status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  discord_message_id text, error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id uuid PRIMARY KEY, event_type text NOT NULL, source_key text NOT NULL UNIQUE,
  payload_version integer NOT NULL DEFAULT 1, payload_json jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
