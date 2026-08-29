// Legacy export, import and reconciliation.
//
// Everything here runs against synthetic fixtures generated from the pinned
// Hearth DDL. No test needs the real production backup to be present, and none
// of them can touch it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import {
  openDatabase, openEphemeralDatabase, openExistingCompatibleDatabase,
} from '../../lib/db/connection.ts'
import { OWNED_LEGACY_TABLES } from '../../lib/db/schema.ts'
import { LEGACY_COLUMNS, rowValue, serializeCanonical } from '../../lib/legacy/canonical.ts'
import { exportLegacyBundle } from '../../lib/legacy/exportLegacy.ts'
import { LegacyError, bundleHash, validateExportBundle } from '../../lib/legacy/manifest.ts'
import type { ExportBundle } from '../../lib/legacy/manifest.ts'
import { applyImport, planImport } from '../../lib/legacy/importLegacy.ts'
import { reconcile } from '../../lib/legacy/reconcile.ts'
import {
  approvedSourceFor, bundleFor, createCorruptFixture, createLegacyFixture, evidenceFor,
} from '../helpers/legacyFixtures.ts'
import type { ApprovedSource } from '../../lib/legacy/approvedSource.ts'
import { TEST_OID, TEST_ROOT, TEST_TENANT, OTHER_OID } from '../helpers/server.ts'

const owner = { tenantId: TEST_TENANT, oid: TEST_OID }
const otherOwner = { tenantId: TEST_TENANT, oid: OTHER_OID }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

async function withFixture<T>(
  kind: Parameters<typeof createLegacyFixture>[0],
  body: (bundle: ExportBundle, approved: ApprovedSource) => Promise<T> | T,
): Promise<T> {
  const fixture = createLegacyFixture(kind)
  try {
    // The approved contract is derived from the fixture database itself, so a
    // fixture import passes exactly the gate a production import passes.
    return await body(await bundleFor(fixture), await approvedSourceFor(fixture))
  } finally {
    fixture.cleanup()
  }
}

describe('legacy export', () => {
  test('a valid backup exports canonical rows in a deterministic order', async () => {
    await withFixture('valid', (bundle) => {
      assert.equal(bundle.contract, 'shapepilot.legacy-export.v2')
      assert.deepEqual(bundle.tables.map(t => t.name), [...OWNED_LEGACY_TABLES])
      assert.deepEqual(bundle.tables.map(t => t.rowCount), [2, 4, 1])
      assert.deepEqual(
        bundle.tables[0].columns, LEGACY_COLUMNS.keycap_tray_designs)
      // Pockets are ordered by design_id, sort_order, id.
      assert.deepEqual(bundle.tables[1].primaryKeys, [7, 8, 13, 17])
      // v2 carries the source schema and canonical identity of every table.
      assert.deepEqual(
        bundle.tables[0].schema.columns.map(c => c.name),
        [...LEGACY_COLUMNS.keycap_tray_designs])
      assert.deepEqual(bundle.tables[0].schema.primaryKey, ['id'])
      assert.match(bundle.tables[0].canonicalSha256, /^[0-9a-f]{64}$/)
      assert.equal(bundle.canonical.tableAlgorithm, 'hearth.sqlite-table-canonical.v1')
      assert.equal(bundle.canonical.product, 'ShapePilot')
    })
  })

  test('the same source exports byte-identical bundles', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const first = await bundleFor(fixture)
      const second = await bundleFor(fixture)
      assert.equal(serializeCanonical(first), serializeCanonical(second))
      assert.equal(bundleHash(first), bundleHash(second))
    } finally {
      fixture.cleanup()
    }
  })

  test('the default bundle timestamp is pinned to immutable source evidence', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const source = await evidenceFor(fixture.path)
      const bundle = await exportLegacyBundle({
        backupPath: fixture.path,
        source,
      })
      assert.equal(bundle.createdUtc, source.backupCreatedUtc)
    } finally {
      fixture.cleanup()
    }
  })

  test('raw JSON, timestamps, nulls, booleans and sort_order survive verbatim', async () => {
    await withFixture('valid', (bundle) => {
      const designs = bundle.tables[0]
      const first = designs.rows[0]
      assert.equal(
        rowValue(first, 'keycap_tray_designs', 'profile_json'),
        '{"id":"systainer-s76-notched"}')
      assert.equal(rowValue(first, 'keycap_tray_designs', 'created_at'), '2026-08-25 13:21:28')
      assert.equal(rowValue(first, 'keycap_tray_designs', 'notes'), null)

      const pockets = bundle.tables[1]
      // The through-cut boolean stays the integer 1, not `true`.
      assert.equal(rowValue(pockets.rows[0], 'keycap_tray_pockets', 'is_through'), 1)
      assert.equal(rowValue(pockets.rows[1], 'keycap_tray_pockets', 'is_through'), 0)
      assert.equal(rowValue(pockets.rows[0], 'keycap_tray_pockets', 'sort_order'), 0)
      assert.equal(rowValue(pockets.rows[1], 'keycap_tray_pockets', 'sort_order'), 1)
      // `shape` is NULL in production and is carried across as NULL.
      assert.equal(rowValue(pockets.rows[0], 'keycap_tray_pockets', 'shape'), null)
      // Floating-point coordinates keep full precision.
      assert.equal(rowValue(pockets.rows[2], 'keycap_tray_pockets', 'y_mm'), 64.1417)
    })
  })

  test('unicode and null edge cases round-trip', async () => {
    await withFixture('unicode-nulls', (bundle) => {
      const names = bundle.tables[0].rows.map(
        r => rowValue(r, 'keycap_tray_designs', 'name'))
      assert.ok(names.includes('Ünïcødé — 托盘 «test» 🎹'))
      const library = bundle.tables[2].rows
      assert.equal(rowValue(library[1], 'keycap_pocket_library', 'name'), 'Ünïcødé pocket ✓')
      assert.equal(rowValue(library[1], 'keycap_pocket_library', 'width_mm'), null)
    })
  })

  test('sqlite_sequence is captured', async () => {
    await withFixture('valid', (bundle) => {
      const designs = bundle.sqliteSequence.find(s => s.name === 'keycap_tray_designs')
      const pockets = bundle.sqliteSequence.find(s => s.name === 'keycap_tray_pockets')
      assert.equal(designs?.seq, 2)
      assert.equal(pockets?.seq, 17)
    })
  })

  test('a declared byte length that does not match aborts before opening', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const evidence = await evidenceFor(fixture.path, { bytes: 42 })
      await assert.rejects(
        () => exportLegacyBundle({ backupPath: fixture.path, source: evidence }),
        (error: unknown) => error instanceof LegacyError && error.code === 'SOURCE_BYTES_MISMATCH')
    } finally {
      fixture.cleanup()
    }
  })

  test('a declared hash that does not match aborts before opening', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const evidence = await evidenceFor(fixture.path, { sha256: 'a'.repeat(64) })
      await assert.rejects(
        () => exportLegacyBundle({ backupPath: fixture.path, source: evidence }),
        (error: unknown) => error instanceof LegacyError && error.code === 'SOURCE_HASH_MISMATCH')
    } finally {
      fixture.cleanup()
    }
  })

  test('incomplete source evidence is refused field by field', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const complete = await evidenceFor(fixture.path)
      for (const field of Object.keys(complete)) {
        const partial = { ...complete } as Record<string, unknown>
        delete partial[field]
        await assert.rejects(
          () => exportLegacyBundle({ backupPath: fixture.path, source: partial }),
          (error: unknown) => error instanceof LegacyError
            && error.code === 'SOURCE_EVIDENCE_INVALID',
          `missing ${field} must be refused`)
      }
    } finally {
      fixture.cleanup()
    }
  })

  test('a corrupt artifact is refused', async () => {
    const fixture = createCorruptFixture()
    try {
      const evidence = await evidenceFor(fixture.path)
      await assert.rejects(
        () => exportLegacyBundle({ backupPath: fixture.path, source: evidence }))
    } finally {
      fixture.cleanup()
    }
  })

  test('a non-quiesced source with a hot journal is refused', async () => {
    const fixture = createLegacyFixture('valid')
    const journal = `${fixture.path}-journal`
    try {
      const evidence = await evidenceFor(fixture.path)
      writeFileSync(journal, Buffer.alloc(16))
      await assert.rejects(
        () => exportLegacyBundle({ backupPath: fixture.path, source: evidence }),
        (error: unknown) => error instanceof LegacyError && error.code === 'SOURCE_NOT_QUIESCED')
    } finally {
      rmSync(journal, { force: true })
      fixture.cleanup()
    }
  })

  test('a missing backup is refused', async () => {
    await assert.rejects(
      () => exportLegacyBundle({
        backupPath: '/nonexistent/shapepilot-does-not-exist.db',
        source: {
          repository: 'x', commit: 'f'.repeat(40), tree: '0'.repeat(40), version: '1',
          build: 1, imageDigest: `sha256:${'0'.repeat(64)}`, backupBundle: 'b',
          backupCreatedUtc: '2026-08-28T05:36:25.317Z', file: 'f', bytes: 1,
          sha256: '0'.repeat(64),
        },
      }),
      (error: unknown) => error instanceof LegacyError && error.code === 'SOURCE_MISSING')
  })
})

describe('legacy import dry run', () => {
  test('a clean bundle plans every row as an insert', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, true)
        assert.equal(plan.report.totals.insert, 7)
        assert.equal(plan.report.totals.reject, 0)
        assert.deepEqual(plan.report.tables.map(t => t.insert.length), [2, 4, 1])
      } finally {
        db.close()
      }
    })
  })

  test('the dry run writes nothing', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        for (const table of OWNED_LEGACY_TABLES) {
          const row = db.handle.prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count FROM ${table}`).get()
          assert.equal(Number(row?.count), 0, `${table} must still be empty`)
        }
      } finally {
        db.close()
      }
    })
  })

  test('the report is deterministic for identical inputs', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const first = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        const second = planImport({ db: db.handle, bundle: clone(bundle), owner, approvedSource: approved })
        assert.equal(first.reportHash, second.reportHash)
      } finally {
        db.close()
      }
    })
  })

  test('a different owner produces a different report hash', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        assert.notEqual(
          planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
          planImport({ db: db.handle, bundle, owner: otherOwner, approvedSource: approved }).reportHash)
      } finally {
        db.close()
      }
    })
  })

  test('a different target authority produces a different report hash', async () => {
      await withFixture('valid', (bundle, approved) => {
        const first = openEphemeralDatabase()
        const second = openEphemeralDatabase()
        try {
          const firstPlan = planImport({ db: first.handle, bundle, owner, approvedSource: approved })
          const secondPlan = planImport({ db: second.handle, bundle, owner, approvedSource: approved })
          assert.notEqual(firstPlan.report.targetAuthorityId, secondPlan.report.targetAuthorityId)
          assert.notEqual(firstPlan.reportHash, secondPlan.reportHash)
          assert.throws(
            () => applyImport({
              db: second.handle,
              bundle,
              owner,
              approvedSource: approved,
              expectedReportHash: firstPlan.reportHash,
            }),
            (error: unknown) => error instanceof LegacyError && error.code === 'REPORT_HASH_MISMATCH',
          )
        } finally {
          first.close()
          second.close()
        }
    })
  })

  test('an implicit or malformed owner is refused', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        for (const bad of [undefined, {}, { tenantId: TEST_TENANT }, { tenantId: 'x', oid: 'y' }]) {
          assert.throws(() => planImport({ db: db.handle, bundle, owner: bad, approvedSource: approved }),
            (error: unknown) => error instanceof LegacyError && error.code === 'OWNER_REQUIRED')
        }
      } finally {
        db.close()
      }
    })
  })

  test('a tampered bundle fails the approval gate and its own row hashes', async () => {
    await withFixture('valid', (bundle, approved) => {
      const edited = clone(bundle)
      const nameIndex = LEGACY_COLUMNS.keycap_tray_designs.indexOf('name')
      edited.tables[0].rows[0][nameIndex] = ['s', 'Renamed by an attacker']

      // Only the declared row hash is moved, so the approval gate is satisfied
      // and the bundle's own row-hash check is the thing that has to catch it.
      const relabelled = clone(bundle)
      relabelled.tables[0].rowsHash = 'f'.repeat(64)

      const db = openEphemeralDatabase()
      try {
        assert.throws(
          () => planImport({ db: db.handle, bundle: edited, owner, approvedSource: approved }),
          (error: unknown) => error instanceof LegacyError
            && error.code === 'SOURCE_NOT_APPROVED')
        assert.throws(
          () => planImport({ db: db.handle, bundle: relabelled, owner, approvedSource: approved }),
          (error: unknown) => error instanceof LegacyError && error.code === 'EXPORT_TAMPERED')
        for (const table of OWNED_LEGACY_TABLES) {
          const row = db.handle.prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count FROM ${table}`).get()
          assert.equal(Number(row?.count), 0, `${table} must still be empty`)
        }
      } finally {
        db.close()
      }
    })
  })

  test('a bundle with the wrong column list is refused', async () => {
    await withFixture('valid', (bundle) => {
      const tampered = clone(bundle)
      tampered.tables[0] = {
        ...tampered.tables[0],
        columns: tampered.tables[0].columns.slice(1),
      }
      assert.throws(() => validateExportBundle(tampered),
        (error: unknown) => error instanceof LegacyError && error.code === 'EXPORT_COLUMNS_INVALID')
    })
  })

  test('an orphan pocket is rejected', async () => {
    await withFixture('orphan-pocket', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, false)
        const pockets = plan.report.tables.find(t => t.name === 'keycap_tray_pockets')
        assert.equal(pockets?.reject.length, 1)
        assert.equal(pockets?.reject[0].id, 99)
        assert.equal(pockets?.reject[0].code, 'ORPHAN_ROW')
      } finally {
        db.close()
      }
    })
  })

  test('a duplicate library business key is rejected', async () => {
    await withFixture('duplicate-library', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, false)
        const library = plan.report.tables.find(t => t.name === 'keycap_pocket_library')
        assert.equal(library?.reject[0].code, 'DUPLICATE_BUSINESS_KEY')
      } finally {
        db.close()
      }
    })
  })

  test('an unsupported value is rejected rather than coerced', async () => {
    await withFixture('bad-json', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        const designs = plan.report.tables.find(t => t.name === 'keycap_tray_designs')
        const rejected = designs?.reject.find(r => r.id === 4)
        assert.equal(rejected?.code, 'UNSUPPORTED_VALUE')
        assert.match(rejected?.message ?? '', /profile_json is not valid JSON/)
      } finally {
        db.close()
      }
    })
  })

  test('a target id collision owned by someone else is rejected', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner: otherOwner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner: otherOwner, approvedSource: approved }).reportHash,
        })
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, false)
        const designs = plan.report.tables.find(t => t.name === 'keycap_tray_designs')
        assert.equal(designs?.reject[0].code, 'TARGET_COLLISION')
      } finally {
        db.close()
      }
    })
  })

  test('a changed source row against an imported target is rejected', async () => {
    const fixture = createLegacyFixture('valid')
    try {
      const bundle = await bundleFor(fixture)
      const approved = await approvedSourceFor(fixture)
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare("UPDATE keycap_tray_designs SET name = 'edited' WHERE id = 1").run()
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        const designs = plan.report.tables.find(t => t.name === 'keycap_tray_designs')
        assert.equal(designs?.reject[0].code, 'SOURCE_CHANGED')
      } finally {
        db.close()
      }
    } finally {
      fixture.cleanup()
    }
  })

  test('a previously imported row that was deleted is rejected, not resurrected', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })

        db.handle.prepare('DELETE FROM keycap_pocket_library WHERE id = 1').run()
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        const library = plan.report.tables.find(t => t.name === 'keycap_pocket_library')
        assert.equal(library?.reject[0].code, 'LEDGER_ROW_DELETED')
      } finally {
        db.close()
      }
    })
  })

  test('matching target rows without completed ledger evidence are not adopted as replays', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({
            db: db.handle, bundle, owner, approvedSource: approved,
          }).reportHash,
        })
        db.handle.exec('DELETE FROM legacy_import_runs')

        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, false)
        assert.equal(plan.report.totals.noop, 0)
        assert.ok(plan.report.tables.every(
          (table) => table.reject.every((row) => row.code === 'UNTRACKED_TARGET_ROW'),
        ))
      } finally {
        db.close()
      }
    })
  })
})

describe('legacy import apply', () => {
  test('BEGIN IMMEDIATE prevents a writer from changing the approved plan', async () => {
    await withFixture('valid', (bundle, approved) => {
      const path = join(TEST_ROOT, `import-lock-${randomUUID()}.db`)
      const primary = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
      const competitor = openExistingCompatibleDatabase({ path, busyTimeoutMs: 100 })
      try {
        const plan = planImport({
          db: primary.handle, bundle, owner, approvedSource: approved,
        })
        const result = applyImport({
          db: primary.handle,
          bundle,
          owner,
          approvedSource: approved,
          expectedReportHash: plan.reportHash,
          beforeTransactionalPlan: () => {
            assert.throws(
              () => competitor.handle.prepare(`
                INSERT INTO audit_events (category, action, outcome)
                VALUES ('test', 'competing-write', 'success')
              `).run(),
              (error: unknown) => (error as { code?: string }).code === 'SQLITE_BUSY',
            )
          },
        })
        assert.equal(result.inserted, 7)
      } finally {
        competitor.close()
        primary.close()
        rmSync(path, { force: true })
      }
    })
  })

  test('apply refuses a wrong or missing dry-run hash', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        assert.throws(
          () => applyImport({ db: db.handle, bundle, owner, expectedReportHash: 'nope', approvedSource: approved }),
          (error: unknown) => error instanceof LegacyError
            && error.code === 'REPORT_HASH_MISMATCH')
        const designs = db.handle.prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM keycap_tray_designs').get()
        assert.equal(Number(designs?.count), 0)
      } finally {
        db.close()
      }
    })
  })

  test('apply refuses to write anything when any row is rejected', async () => {
    await withFixture('orphan-pocket', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.throws(
          () => applyImport({
            db: db.handle, bundle, owner, approvedSource: approved,
            expectedReportHash: plan.reportHash,
        }),
          (error: unknown) => error instanceof LegacyError && error.code === 'IMPORT_REJECTED')
        for (const table of OWNED_LEGACY_TABLES) {
          const row = db.handle.prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count FROM ${table}`).get()
          assert.equal(Number(row?.count), 0)
        }
      } finally {
        db.close()
      }
    })
  })

  test('apply writes explicit ids, owner scoping, and advances the sequences', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        const result = applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: plan.reportHash,
        })
        assert.equal(result.inserted, 7)

        const designs = db.handle.prepare<[], {
          id: number; owner_tenant_id: string; owner_oid: string; created_at: string
        }>('SELECT id, owner_tenant_id, owner_oid, created_at FROM keycap_tray_designs ORDER BY id')
          .all()
        assert.deepEqual(designs.map(d => Number(d.id)), [1, 2])
        for (const design of designs) {
          assert.equal(design.owner_tenant_id, owner.tenantId)
          assert.equal(design.owner_oid, owner.oid)
        }
        assert.equal(designs[0].created_at, '2026-08-25 13:21:28')

        const pockets = db.handle.prepare<[], { id: number; sort_order: number }>(
          'SELECT id, sort_order FROM keycap_tray_pockets ORDER BY id').all()
        assert.deepEqual(pockets.map(p => Number(p.id)), [7, 8, 13, 17])

        const sequences = Object.fromEntries(
          db.handle.prepare<[], { name: string; seq: number }>(
            'SELECT name, seq FROM sqlite_sequence').all().map(r => [r.name, Number(r.seq)]))
        assert.equal(sequences.keycap_tray_designs, 2)
        assert.equal(sequences.keycap_tray_pockets, 17)
        assert.equal(sequences.keycap_pocket_library, 1)

        // A new row must not reuse an imported id.
        const info = db.handle.prepare(`
          INSERT INTO keycap_tray_designs
            (owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
          VALUES (?, ?, 'fresh', 'rect', '{}', '{}')`).run(owner.tenantId, owner.oid)
        assert.equal(Number(info.lastInsertRowid), 3)
      } finally {
        db.close()
      }
    })
  })

  test('the import ledger records the run and every row', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        applyImport({ db: db.handle, bundle, owner, expectedReportHash: plan.reportHash, approvedSource: approved })

        const run = db.handle.prepare<[], {
          source_manifest_hash: string; owner_oid: string; report_hash: string; completed_at: string
        }>('SELECT * FROM legacy_import_runs').get()
        assert.equal(run?.source_manifest_hash, bundleHash(bundle))
        assert.equal(run?.owner_oid, owner.oid)
        assert.equal(run?.report_hash, plan.reportHash)
        assert.ok(run?.completed_at)

        const rows = db.handle.prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM legacy_import_rows').get()
        assert.equal(Number(rows?.count), 7)
      } finally {
        db.close()
      }
    })
  })

  test('an exact replay is an idempotent no-op', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare(
          "UPDATE sqlite_sequence SET seq = 1 WHERE name = 'keycap_tray_pockets'").run()
        const replayPlan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(replayPlan.report.totals.insert, 0)
        assert.equal(replayPlan.report.totals.noop, 7)
        assert.equal(replayPlan.report.ok, true)

        const replay = applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: replayPlan.reportHash,
        })
        assert.equal(replay.inserted, 0)
        assert.equal(replay.noop, 7)
        assert.equal(
          db.handle.prepare<[string], { seq: number }>(
            'SELECT seq FROM sqlite_sequence WHERE name = ?',
          ).get('keycap_tray_pockets')?.seq,
          17,
          'a no-op row replay must still repair the approved source sequence',
        )

        const designs = db.handle.prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM keycap_tray_designs').get()
        assert.equal(Number(designs?.count), 2)
        const runs = db.handle.prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM legacy_import_runs').get()
        assert.equal(Number(runs?.count), 1, 'a no-op replay must not open a second run')
      } finally {
        db.close()
      }
    })
  })

  test('unicode payloads survive the whole round trip', async () => {
    await withFixture('unicode-nulls', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        const row = db.handle.prepare<[], { name: string }>(
          'SELECT name FROM keycap_tray_designs WHERE id = 3').get()
        assert.equal(row?.name, 'Ünïcødé — 托盘 «test» 🎹')
      } finally {
        db.close()
      }
    })
  })

  test('an empty source is a valid, empty import', async () => {
    await withFixture('empty', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, true)
        assert.equal(plan.report.totals.insert, 0)
        const result = applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: plan.reportHash,
        })
        assert.equal(result.inserted, 0)
      } finally {
        db.close()
      }
    })
  })
})

describe('reconciliation', () => {
  test('a correct import reconciles with zero unexplained differences', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare(`
          INSERT INTO keycap_tray_designs (
            id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          999,
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
          'Another owner design',
          'preset',
          '{}',
          '{}',
        )
        db.handle.prepare(`
          INSERT INTO keycap_pocket_library (
            id, owner_tenant_id, owner_oid, name, units
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          999,
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
          'Another owner pocket',
          1,
        )
        const report = reconcile({
          db: db.handle, bundle, owner, approvedSource: approved,
          signedOffUtc: '2026-08-28T12:00:00.000Z',
        })
        assert.deepEqual(report.differences, [])
        assert.equal(report.ok, true)
        assert.equal(report.approval.productCanonicalSha256, approved.canonical.productCanonicalSha256)
        assert.deepEqual(report.tables.map(t => t.sourceRowCount), [2, 4, 1])
        assert.deepEqual(report.tables.map(t => t.targetRowCount), [2, 4, 1])
        for (const table of report.tables) {
          assert.equal(table.sourceKeyHash, table.targetKeyHash)
          assert.equal(table.sourceRowsHash, table.targetRowsHash)
        }
        assert.equal(report.relationships[0].ok, true)
        assert.ok(report.sequences.every(s => s.ok))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation fails when the target is empty', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        const report = reconcile({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(report.ok, false)
        assert.ok(report.differences.some(d => d.check === 'rowCount'))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation detects a single edited field', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare('UPDATE keycap_tray_pockets SET x_mm = 999 WHERE id = 8').run()
        const report = reconcile({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(report.ok, false)
        assert.ok(report.differences.some(
          d => d.table === 'keycap_tray_pockets' && d.check === 'fieldHash' && d.detail.includes('8')))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation detects a missing row and an extra row', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare('DELETE FROM keycap_tray_pockets WHERE id = 17').run()
        db.handle.prepare(`
          INSERT INTO keycap_pocket_library
            (id, owner_tenant_id, owner_oid, name, units, created_at)
          VALUES (900, ?, ?, 'extra', 1, '2026-08-28 00:00:00')`)
          .run(owner.tenantId, owner.oid)

        const report = reconcile({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(report.ok, false)
        const keys = report.differences.filter(d => d.check === 'primaryKeys')
        assert.ok(keys.some(d => d.table === 'keycap_tray_pockets' && d.detail.includes('17')))
        assert.ok(keys.some(d => d.table === 'keycap_pocket_library' && d.detail.includes('900')))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation detects rows scoped to the wrong owner', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare('UPDATE keycap_tray_designs SET owner_oid = ? WHERE id = 1')
          .run(OTHER_OID)
        const report = reconcile({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(report.ok, false)
        assert.ok(report.differences.some(d => d.check === 'ownerAssignment'))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation detects a sequence that is behind the source', async () => {
    await withFixture('valid', (bundle, approved) => {
      const db = openEphemeralDatabase()
      try {
        applyImport({
          db: db.handle, bundle, owner, approvedSource: approved,
          expectedReportHash: planImport({ db: db.handle, bundle, owner, approvedSource: approved }).reportHash,
        })
        db.handle.prepare("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'keycap_tray_pockets'")
          .run()
        const report = reconcile({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(report.ok, false)
        assert.ok(report.differences.some(d => d.check === 'sequence'))
      } finally {
        db.close()
      }
    })
  })

  test('reconciliation refuses a bundle outside the approved source contract', async () => {
      await withFixture('valid', (bundle, approved) => {
        const db = openEphemeralDatabase()
        try {
          const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
          applyImport({
            db: db.handle, bundle, owner, approvedSource: approved,
            expectedReportHash: plan.reportHash,
          })
          const unapproved = clone(bundle)
          unapproved.source.commit = 'f'.repeat(40)
          assert.throws(
            () => reconcile({ db: db.handle, bundle: unapproved, owner, approvedSource: approved }),
            (error: unknown) => error instanceof LegacyError && error.code === 'SOURCE_NOT_APPROVED',
          )
        } finally {
          db.close()
        }
    })
  })
})
