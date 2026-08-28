// db-init — create and migrate the app-owned SQLite authority, explicitly.
//
// This exists so that nothing else has to. A dry run is read-only and refuses
// to create a target; the server's bootstrap creates one only where the
// configuration allows it (never in production, where an absent file means the
// persistent volume did not mount). When an operator genuinely wants a new
// empty authority — a fresh environment, a rehearsal, a disposable target for
// an import rehearsal — this is the command that makes one.
//
// Usage:
//   node scripts/init-db.ts                     # the configured database
//   node scripts/init-db.ts --database ./x.db   # an explicit path
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDatabase } from '../lib/db/connection.ts'
import { loadConfig } from '../server/config.ts'
import { fail, parseArgs } from './cli.ts'

const args = parseArgs(process.argv.slice(2))

try {
  const config = loadConfig()
  const path = args.flags.get('database')
    ? resolve(args.flags.get('database') as string)
    : config.database.path
  const existed = existsSync(path)

  const database = openDatabase({
    path,
    busyTimeoutMs: config.database.busyTimeoutMs,
    // The whole point of this command: it is allowed to create the file.
    createIfMissing: true,
  })
  try {
    console.log(`database    ${database.path}`)
    console.log(`created     ${existed ? 'no (already existed)' : 'yes'}`)
    console.log(`app         ${database.identity.app}`)
    console.log(`schema      ${database.identity.schemaMarker}`)
    for (const entry of database.identity.ledger) {
      console.log(`  ${entry.ordinal} ${entry.id} (${entry.name}) ${entry.checksum}`)
    }
  } finally {
    database.close()
  }
} catch (error) {
  fail(error)
}
