import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BuildIdentity } from '../lib/lineage/buildIdentity.ts'

const root = resolve(import.meta.dirname, '..')
const path = join(root, 'version.json')
const identity = JSON.parse(readFileSync(path, 'utf8')) as BuildIdentity
const commit = process.env.BUILD_SHA?.trim() ?? ''
const build = process.env.BUILD_ID?.trim() ?? ''
const builtAt = process.env.BUILD_TIMESTAMP?.trim() ?? ''
const clientId = process.env.VITE_AZURE_CLIENT_ID?.trim()
  || process.env.VITE_ENTRA_CLIENT_ID?.trim()
  || ''
const tenantId = process.env.VITE_AZURE_TENANT_ID?.trim()
  || process.env.VITE_ENTRA_TENANT_ID?.trim()
  || ''
const apiScope = process.env.VITE_API_SCOPE?.trim() ?? ''
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error('BUILD_SHA must be a full lowercase Git SHA')
}
if (!/^[0-9]+-[0-9]+$/.test(build)) {
  throw new Error('BUILD_ID must be <run-id>-<run-attempt>')
}
const timestamp = new Date(builtAt)
if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== builtAt) {
  throw new Error('BUILD_TIMESTAMP must be canonical UTC ISO-8601')
}
if (process.env.VITE_AUTH_MODE !== 'entra') {
  throw new Error('VITE_AUTH_MODE=entra is required for a production build')
}
if (!guid.test(clientId) || !guid.test(tenantId)) {
  throw new Error('production VITE client and tenant IDs must be GUIDs')
}
if (!/^api:\/\/[^/]+\/[A-Za-z0-9._-]+$/.test(apiScope)) {
  throw new Error('VITE_API_SCOPE must be a complete api:// delegated scope')
}

const stamped: BuildIdentity = {
  ...identity,
  build,
  commit,
  builtAt,
}
const serialized = `${JSON.stringify(stamped, null, 2)}\n`
writeFileSync(path, serialized)
writeFileSync(join(root, 'public', 'version.json'), serialized)
