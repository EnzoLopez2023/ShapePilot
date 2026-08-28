import type { SqliteDatabase } from '../connection.ts'
import type {
  AppRole,
  Membership,
  MembershipRepository,
  MembershipUpsert,
  Owner,
} from './contracts.ts'

interface MembershipRow {
  tenant_id: string
  oid: string
  role: string
  display_name: string | null
  email: string | null
  created_at: string
  updated_at: string
}

const toMembership = (r: MembershipRow): Membership => ({
  tenantId: r.tenant_id,
  oid: r.oid,
  role: r.role === 'admin' ? 'admin' : 'user',
  displayName: r.display_name,
  email: r.email,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** Display fields are bounded here so a hostile token cannot grow the database. */
const bounded = (value: string | null | undefined, max = 256): string | null =>
  value == null ? null : String(value).slice(0, max)

export function createMembershipRepository(db: SqliteDatabase): MembershipRepository {
  const select = db.prepare<[string, string], MembershipRow>(
    'SELECT * FROM app_memberships WHERE tenant_id = ? AND oid = ?')

  const insert = db.prepare(`
    INSERT INTO app_memberships (tenant_id, oid, role, display_name, email)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, oid) DO NOTHING`)

  // Role is deliberately not touched here: sign-in refreshes display fields, it
  // never re-grants or revokes a role.
  const touch = db.prepare(`
    UPDATE app_memberships
       SET display_name = ?, email = ?, updated_at = datetime('now')
     WHERE tenant_id = ? AND oid = ?`)

  const ensureTx = db.transaction((input: MembershipUpsert): MembershipRow => {
    const { owner } = input
    insert.run(
      owner.tenantId, owner.oid, input.initialRole ?? 'user',
      bounded(input.displayName), bounded(input.email))
    touch.run(bounded(input.displayName), bounded(input.email), owner.tenantId, owner.oid)
    const row = select.get(owner.tenantId, owner.oid)
    if (!row) throw new Error('membership row missing immediately after upsert')
    return row
  })

  return {
    async ensure(input) {
      return toMembership(ensureTx(input))
    },

    async find(owner: Owner) {
      const row = select.get(owner.tenantId, owner.oid)
      return row ? toMembership(row) : null
    },

    async list() {
      return db.prepare<[], MembershipRow>(
        'SELECT * FROM app_memberships ORDER BY tenant_id, oid',
      ).all().map(toMembership)
    },

    async setRole(owner: Owner, role: AppRole) {
      const info = db.prepare(`
        UPDATE app_memberships
           SET role = ?, updated_at = datetime('now')
         WHERE tenant_id = ? AND oid = ?`).run(role, owner.tenantId, owner.oid)
      if (!info.changes) return null
      const row = select.get(owner.tenantId, owner.oid)
      return row ? toMembership(row) : null
    },
  }
}
