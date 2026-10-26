ALTER TABLE ticket ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT '';
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL';
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS card_message_id text;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS sync_error text;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS sync_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS sync_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS ticket_updated ON ticket(updated_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS ticket_panel (
 id integer PRIMARY KEY CHECK(id=1), channel_id text NOT NULL,
 message_id text, status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ticket_reply (
 id uuid PRIMARY KEY, ticket_id uuid NOT NULL REFERENCES ticket(id),
 authored_by text NOT NULL, authored_role text NOT NULL, body text NOT NULL, expected_status text,
 status text NOT NULL DEFAULT 'PENDING', message_id text,
 attempts integer NOT NULL DEFAULT 0, error_code text,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_reply_queue ON ticket_reply(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS ticket_private_channel ON ticket(private_channel_id);
