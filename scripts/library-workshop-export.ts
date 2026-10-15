// library-workshop-export — read a downloaded copy of one Workshop user
// database and write the Library carry-over bundle (lib/contracts/libraryWorkshop.ts).
//
// Strictly read-only: the database opens `readonly` + `query_only`, and with
// `--backup` the file must be listed, byte for byte, in that Workshop recovery
// bundle's checksummed manifest. The bundle never lands in the repository.
//
// Usage:
//   node scripts/library-workshop-export.ts \
//     --db /path/to/backup/databases/users/<userKey>.db \
//     --backup /path/to/backup \
//     --out ~/Desktop/library-workshop.json
//
// Then POST it to /api/library/import/workshop (dry run first) while signed in.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { WORKSHOP_BUNDLE_FORMAT, cleanWorkshopBundle, workshopHubUrl } from '../lib/contracts/libraryWorkshop.ts'
import type { WorkshopBundle } from '../lib/contracts/libraryWorkshop.ts'
import { fail, parseArgs, requireFlag, UsageError } from './cli.ts'

const json = (value: string | null): unknown => {
  try { return value == null ? null : JSON.parse(value) } catch { return null }
}

/** Throws unless `dbSha` is a database the backup's verified manifest lists. */
async function verifyAgainstBackup(backupDir: string, dbSha: string): Promise<string> {
  const manifestText = await readFile(join(backupDir, 'manifest.json'), 'utf8')
  const checksum = /^([0-9a-f]{64}) {2}manifest\.json\n?$/.exec(await readFile(join(backupDir, 'manifest.sha256'), 'utf8'))
  if (!checksum || createHash('sha256').update(manifestText).digest('hex') !== checksum[1]) {
    throw new UsageError('the backup manifest does not match manifest.sha256')
  }
  const manifest = JSON.parse(manifestText) as { files?: { path: string; kind: string; sha256: string }[] }
  const record = manifest.files?.find(f => f.kind === 'sqlite' && f.sha256 === dbSha)
  if (!record) throw new UsageError('--db is not a database listed in that backup manifest')
  return record.path
}

export function readWorkshopLibrary(db: Database.Database, sourceSha256: string): WorkshopBundle {
  const models = db.prepare(`
    SELECT id, favorite, bambu_project_id FROM library_models
    WHERE favorite = 1 OR bambu_project_id IS NOT NULL ORDER BY id`).all() as
    { id: string; favorite: number; bambu_project_id: number | null }[]
  const collections = db.prepare('SELECT * FROM library_collections ORDER BY id').all() as
    { id: number; name: string; kind: string; query_json: string | null; created_at: string }[]
  const members = db.prepare('SELECT model_id FROM library_collection_models WHERE collection_id = ? ORDER BY added_at, model_id')
  const prints = db.prepare(`
    SELECT * FROM library_prints
    WHERE (source = 'manual' AND model_id IS NOT NULL)
       OR (source = 'shapepilot' AND match_state IN ('confirmed', 'rejected') AND external_job_id LIKE 'shapepilot:%')
    ORDER BY id`).all() as Record<string, unknown>[]

  return cleanWorkshopBundle({
    format: WORKSHOP_BUNDLE_FORMAT,
    sourceSha256,
    models: models.map(m => ({
      id: m.id,
      favorite: m.favorite === 1,
      bambuHubUrl: m.bambu_project_id == null ? null : workshopHubUrl(m.bambu_project_id),
    })),
    collections: collections.map(c => ({
      name: c.name,
      kind: c.kind,
      query: json(c.query_json),
      modelIds: (members.all(c.id) as { model_id: string }[]).map(r => r.model_id),
      createdAt: c.created_at,
    })),
    manualPrints: prints.filter(p => p.source === 'manual').map(p => ({
      modelId: p.model_id,
      title: p.title,
      result: p.result,
      startedAt: p.started_at,
      endedAt: p.ended_at,
      seconds: p.seconds,
      grams: p.grams,
      notes: p.notes,
      createdAt: p.created_at,
    })),
    decisions: prints.filter(p => p.source === 'shapepilot').map(p => ({
      jobKey: String(p.external_job_id).slice('shapepilot:'.length),
      modelId: p.match_state === 'confirmed' ? p.model_id : null,
      matchState: p.match_state,
      matchScore: p.match_score,
      title: p.title,
      result: p.result,
      startedAt: p.started_at,
      endedAt: p.ended_at,
      seconds: p.seconds,
      grams: p.grams,
      materials: json(p.materials_json as string | null),
    })),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2))
  try {
    const dbPath = resolve(requireFlag(args, 'db'))
    const outPath = resolve(requireFlag(args, 'out'))
    if (!relative(process.cwd(), outPath).startsWith('..')) {
      throw new UsageError('--out must be outside the repository: the bundle carries account data')
    }
    const dbSha = createHash('sha256').update(await readFile(dbPath)).digest('hex')
    const backup = args.flags.get('backup')
    const listedAs = backup ? await verifyAgainstBackup(resolve(backup), dbSha) : null

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.pragma('query_only = ON')
    const bundle = readWorkshopLibrary(db, dbSha)
    db.close()

    await writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' })
    console.log(`wrote ${outPath}`)
    console.log(`source      ${dbSha}${listedAs ? ` (verified: ${listedAs})` : ' (NOT verified against a backup manifest)'}`)
    console.log(`favorites   ${bundle.models.filter(m => m.favorite).length}`)
    console.log(`hub links   ${bundle.models.filter(m => m.bambuHubUrl).length}`)
    console.log(`collections ${bundle.collections.length} (${bundle.collections.reduce((n, c) => n + c.modelIds.length, 0)} manual members)`)
    console.log(`manual prints ${bundle.manualPrints.length}`)
    console.log(`decisions   ${bundle.decisions.filter(d => d.matchState === 'confirmed').length} confirmed, ${bundle.decisions.filter(d => d.matchState === 'rejected').length} rejected`)
  } catch (error) {
    fail(error)
  }
}
