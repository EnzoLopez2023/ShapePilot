import type { Migration } from '../migrate.ts'

export const migration018: Migration = {
  id: '018-element-displays',
  name: 'revocable current-job displays',
  statements: [
    `CREATE TABLE element_displays (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      pairing_code TEXT UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      connection_id TEXT,
      tenant_id TEXT,
      oid TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id, oid) REFERENCES app_memberships(tenant_id, oid)
    )`,
    'CREATE INDEX element_displays_expiry ON element_displays(expires_at)',
  ],
}
