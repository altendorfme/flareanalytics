-- Users, sessions, invites, per-site access and settings (encrypted Cloudflare token).

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  pw_hash              TEXT NOT NULL,
  pw_salt              TEXT NOT NULL,
  pw_iter              INTEGER NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  locale               TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
) WITHOUT ROWID;

-- Stores only the SHA-256 of the cookie token.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE invites (
  code_hash  TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  site_tags  TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
) WITHOUT ROWID;

-- Sites each member can see (admins see all).
CREATE TABLE user_sites (
  user_id  TEXT NOT NULL,
  site_tag TEXT NOT NULL,
  PRIMARY KEY (user_id, site_tag)
) WITHOUT ROWID;

-- cf_token: AES-GCM encrypted token; cf_accounts: JSON of the selected accounts.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
