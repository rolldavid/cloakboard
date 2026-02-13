CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email_hash   TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mlt_token_hash ON magic_link_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mlt_expires ON magic_link_tokens(expires_at);
