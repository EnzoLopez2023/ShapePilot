// The approved source contract.
//
// Three things are proved here:
//
//   1. the contract checked into the build still carries the exact coordinator
//      evidence — repository, commit, tree, version, build, image digest,
//      source database bytes and hash, the owned row counts, the source schema
//      identity of every table, the per-table canonical hashes and the product
//      hash;
//   2. ShapePilot's own canonical hash implementation reproduces values that
//      were produced by the coordinator's independent `hash-sqlite-tables.mjs`
//      oracle, from a database *and* from the rows an export bundle carries;
//   3. every single approved field is load-bearing: tampering with any one of
//      them fails the import before a transaction is opened, and the target is
//      byte-for-byte unchanged afterwards.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { describe, test } from 'vitest'
import { openEphemeralDatabase } from '../../lib/db/connection.ts'
import { OWNED_LEGACY_TABLES } from '../../lib/db/schema.ts'
import type { ApprovedSource } from '../../lib/legacy/approvedSource.ts'
import {
  APPROVED_SOURCE, ApprovedSourceError, validateApprovedSource,
} from '../../lib/legacy/approvedSource.ts'
import { assertApprovedSource } from '../../lib/legacy/approvalGate.ts'
import {
  canonicalTableHashFromDatabase, canonicalTableHashFromRows, productCanonicalHash,
} from '../../lib/legacy/canonicalTable.ts'
import { LEGACY_COLUMNS } from '../../lib/legacy/canonical.ts'
import type { ExportBundle } from '../../lib/legacy/manifest.ts'
import { LegacyError } from '../../lib/legacy/manifest.ts'
import { applyImport, planImport } from '../../lib/legacy/importLegacy.ts'
import {
  approvedSourceFor, bundleFor, createLegacyFixture,
} from '../helpers/legacyFixtures.ts'
import { TEST_OID, TEST_TENANT } from '../helpers/server.ts'

const owner = { tenantId: TEST_TENANT, oid: TEST_OID }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * Values produced by the coordinator's `hash-sqlite-tables.mjs` — the external
 * oracle — run against the synthetic `valid` fixture. They are written down
 * here rather than recomputed, so this suite compares ShapePilot's
 * implementation against an independent one instead of against itself.
 */
const ORACLE = {
  keycap_tray_designs: '1897345a4e6d978da36c531b0da34edf669a8e3577c8de2bb72de1ed5c5e4172',
  keycap_tray_pockets: '1b987d02371d283b6dce53bedc607350fc66cbf0844c584d94c67829f4cb651c',
  keycap_pocket_library: '77dae531d34bfce1d010a6a6dd04bd51e71255a60b4869fc9a0ed7580066d8fe',
  product: 'ca4303aff2387af4556b41f8abbdb36207934360bdfb06ccca0e8e756031d7a8',
} as const

async function withApprovedFixture<T>(
  body: (bundle: ExportBundle, approved: ApprovedSource, path: string) => Promise<T> | T,
): Promise<T> {
  const fixture = createLegacyFixture('valid')
  try {
    return await body(
      await bundleFor(fixture), await approvedSourceFor(fixture), fixture.path)
  } finally {
    fixture.cleanup()
  }
}

const emptyTarget = (): number[] => {
  const db = openEphemeralDatabase()
  try {
    return OWNED_LEGACY_TABLES.map((table) => Number(
      (db.handle.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count))
  } finally {
    db.close()
  }
}

/** Run a plan that must fail, and prove the target is still untouched. */
function refused(
  bundle: unknown, approved: ApprovedSource, expectedCode = 'SOURCE_NOT_APPROVED',
): void {
  const db = openEphemeralDatabase()
  try {
    const sequencesBefore = db.handle.prepare(
      'SELECT name, seq FROM sqlite_sequence ORDER BY name',
    ).all()
    assert.throws(
      () => planImport({ db: db.handle, bundle, owner, approvedSource: approved }),
      (error: unknown) => error instanceof LegacyError && error.code === expectedCode,
    )
    assert.throws(
      () => applyImport({
        db: db.handle, bundle, owner, approvedSource: approved, expectedReportHash: 'unused',
      }),
      (error: unknown) => error instanceof LegacyError && error.code === expectedCode,
    )
    for (const table of OWNED_LEGACY_TABLES) {
      const row = db.handle.prepare<[], { count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}`).get()
      assert.equal(Number(row?.count), 0, `${table} must still be empty`)
    }
    const runs = db.handle.prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM legacy_import_runs').get()
    assert.equal(Number(runs?.count), 0, 'no import run may be recorded')
    assert.deepEqual(
      db.handle.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all(),
      sequencesBefore,
      'rejected evidence may not advance any AUTOINCREMENT sequence',
    )
  } finally {
    db.close()
  }
}

describe('the checked-in approved source contract', () => {
  test('carries the exact coordinator evidence', () => {
    const approved = APPROVED_SOURCE
    assert.equal(approved.contract, 'shapepilot.approved-legacy-source.v1')
    assert.equal(approved.product, 'ShapePilot')
    assert.equal(approved.status, 'approved')
    assert.equal(approved.source.repository, 'EnzoLopez2023/Hearth')
    assert.equal(approved.source.commit, 'f0b05fc1dbf53e8aa26c215d8e858894a2793871')
    assert.equal(approved.source.tree, '62cbd35861c511f7c17187c875d19ee6e353b80d')
    assert.equal(approved.source.version, '2.13.2')
    assert.equal(approved.source.build, 172)
    assert.equal(
      approved.source.imageDigest,
      'sha256:dc4df7e0f966be5b0608e71643d316cc5eba7590b8e56cec482583ab69443140')
    assert.equal(approved.source.backupBundle, '20260828T053625317Z-1e0918fd4eea2be7')
    assert.equal(approved.source.backupCreatedUtc, '2026-08-28T05:36:25.317Z')
    assert.equal(approved.source.bytes, 950947840)
    assert.equal(
      approved.source.sha256,
      'dc9fb47d269b339a3dcae37279dc3116f37a0635728a2d2b2ac2c511811a5807')
  })

  test('pins the owned counts, schema identity and canonical hashes', () => {
    const byName = new Map(APPROVED_SOURCE.tables.map((table) => [table.name, table]))
    assert.deepEqual(
      APPROVED_SOURCE.tables.map((table) => table.rowCount), [2, 11, 1])

    assert.equal(
      byName.get('keycap_tray_designs')?.canonicalSha256,
      '1897345a4e6d978da36c531b0da34edf669a8e3577c8de2bb72de1ed5c5e4172')
    assert.equal(
      byName.get('keycap_tray_pockets')?.canonicalSha256,
      '2e18f559e62b862f9945522ccfbcd5f09cf8c1fa2a7e524afa9d498f7a98cf02')
    assert.equal(
      byName.get('keycap_pocket_library')?.canonicalSha256,
      '77dae531d34bfce1d010a6a6dd04bd51e71255a60b4869fc9a0ed7580066d8fe')

    assert.equal(
      APPROVED_SOURCE.canonical.productCanonicalSha256,
      '20ce15ff94cf352169959fa8f102f799112b06b724d94f3584d8a8476119d1f8')
    assert.equal(APPROVED_SOURCE.canonical.totalRowCount, 14)
    assert.deepEqual(APPROVED_SOURCE.sqliteSequence, [
      { name: 'keycap_tray_designs', seq: 2 },
      { name: 'keycap_tray_pockets', seq: 17 },
      { name: 'keycap_pocket_library', seq: 1 },
    ])

    // Source schema identity: the sha256 of each pinned CREATE statement.
    assert.equal(
      byName.get('keycap_tray_designs')?.createSqlSha256,
      'a1a8376088049d4f1cde56c76276e003f66e57faad6eaa22cc90936002e1c9c2')
    assert.equal(
      byName.get('keycap_tray_pockets')?.createSqlSha256,
      '578ba0573460ba7d435e5bf191f8531424080b71037512d800dd80f8c4586619')
    assert.equal(
      byName.get('keycap_pocket_library')?.createSqlSha256,
      '747a291fe19935c71e20a95c747555d74902cbba19dfc61a91e0e4a1b6265d62')

    // Every pinned column, in order, with its declared type.
    for (const table of OWNED_LEGACY_TABLES) {
      assert.deepEqual(
        byName.get(table)?.columns.map((column) => column.name),
        [...LEGACY_COLUMNS[table]],
        `${table} approved column list`)
    }
  })

  test('the product hash is the roll-up of the approved table hashes', () => {
    assert.equal(
      productCanonicalHash('ShapePilot', APPROVED_SOURCE.tables.map((table) => ({
        name: table.name,
        canonicalSha256: table.canonicalSha256,
        rowCount: table.rowCount,
      }))),
      APPROVED_SOURCE.canonical.productCanonicalSha256)
  })

  test('a malformed contract is refused at load time', () => {
    const cases: [string, (draft: Record<string, unknown>) => void][] = [
      ['contract', (draft) => { draft.contract = 'something.else.v1' }],
      ['contractVersion', (draft) => { draft.contractVersion = 99 }],
      ['app', (draft) => { draft.app = 'lantern' }],
      ['status', (draft) => { draft.status = 'draft' }],
      ['commit', (draft) => { (draft.source as { commit: string }).commit = 'nope' }],
      ['sha256', (draft) => { (draft.source as { sha256: string }).sha256 = 'nope' }],
      ['bytes', (draft) => { (draft.source as { bytes: number }).bytes = 0 }],
      ['algorithm', (draft) => {
        (draft.canonical as { tableAlgorithm: string }).tableAlgorithm = 'made.up.v1'
      }],
      ['table count', (draft) => { draft.tables = (draft.tables as unknown[]).slice(1) }],
      ['row totals', (draft) => {
        (draft.canonical as { totalRowCount: number }).totalRowCount = 13
      }],
      ['sequences', (draft) => {
        (draft.sqliteSequence as { seq: number }[])[0].seq = -1
      }],
    ]
    for (const [label, mutate] of cases) {
      const draft = clone(APPROVED_SOURCE) as unknown as Record<string, unknown>
      mutate(draft)
      assert.throws(
        () => validateApprovedSource(draft),
        (error: unknown) => error instanceof ApprovedSourceError,
        `${label} must be refused`)
    }
  })
})

describe('canonical hashes agree with the independent oracle', () => {
  test('computed from the source database', async () => {
    await withApprovedFixture((_bundle, _approved, path) => {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      try {
        for (const table of OWNED_LEGACY_TABLES) {
          assert.equal(canonicalTableHashFromDatabase(db, table).hash, ORACLE[table], table)
        }
      } finally {
        db.close()
      }
    })
  })

  test('computed from exported rows and approved column metadata', async () => {
    await withApprovedFixture((bundle, approved) => {
      const rollup = OWNED_LEGACY_TABLES.map((table) => {
        const columns = approved.tables.find((entry) => entry.name === table)?.columns ?? []
        const rows = bundle.tables.find((entry) => entry.name === table)?.rows ?? []
        const hash = canonicalTableHashFromRows(table, columns, rows)
        assert.equal(hash, ORACLE[table], table)
        return { name: table, canonicalSha256: hash, rowCount: rows.length }
      })
      assert.equal(productCanonicalHash('ShapePilot', rollup), ORACLE.product)
    })
  })

  test('row order in the bundle does not change the hash', async () => {
    await withApprovedFixture((bundle, approved) => {
      const columns = approved.tables.find((t) => t.name === 'keycap_tray_pockets')?.columns ?? []
      const rows = bundle.tables.find((t) => t.name === 'keycap_tray_pockets')?.rows ?? []
      assert.equal(
        canonicalTableHashFromRows('keycap_tray_pockets', columns, [...rows].reverse()),
        ORACLE.keycap_tray_pockets)
    })
  })

  test('the exporter records the same canonical identity it is judged by', async () => {
    await withApprovedFixture((bundle) => {
      for (const table of bundle.tables) {
        assert.equal(table.canonicalSha256, ORACLE[table.name])
      }
      assert.equal(bundle.canonical.productCanonicalSha256, ORACLE.product)
    })
  })
})

describe('the approval gate refuses anything but the approved source', () => {
  test('a synthetic bundle is refused against the production contract', async () => {
    await withApprovedFixture((bundle) => {
      const db = openEphemeralDatabase()
      try {
        // No `approvedSource` override: this is what an operator command does.
        assert.throws(
          () => planImport({ db: db.handle, bundle, owner }),
          (error: unknown) => error instanceof LegacyError
            && error.code === 'SOURCE_NOT_APPROVED')
        assert.deepEqual(emptyTarget(), [0, 0, 0])
      } finally {
        db.close()
      }
    })
  })

  test('every approved source field is load-bearing', async () => {
    await withApprovedFixture((bundle, approved) => {
      const cases: [string, (draft: ExportBundle) => void][] = [
        ['repository', (draft) => { draft.source.repository = 'EnzoLopez2023/Hearth-legacy' }],
        ['commit', (draft) => { draft.source.commit = 'a'.repeat(40) }],
        ['tree', (draft) => { draft.source.tree = 'b'.repeat(40) }],
        ['version', (draft) => { draft.source.version = '2.13.3' }],
        ['build', (draft) => { draft.source.build = 173 }],
        ['imageDigest', (draft) => { draft.source.imageDigest = `sha256:${'c'.repeat(64)}` }],
        ['backupBundle', (draft) => { draft.source.backupBundle = '20260101T000000000Z-0000000000000000' }],
        ['backupCreatedUtc', (draft) => { draft.source.backupCreatedUtc = '2026-08-28T05:36:25.318Z' }],
        ['bytes', (draft) => { draft.source.bytes += 1 }],
        ['sha256', (draft) => { draft.source.sha256 = 'd'.repeat(64) }],
        ['product name', (draft) => { draft.canonical.product = 'Lantern' }],
        ['product hash', (draft) => {
          draft.canonical.productCanonicalSha256 = 'e'.repeat(64)
        }],
        ['table canonical hash', (draft) => {
          draft.tables[0].canonicalSha256 = 'f'.repeat(64)
        }],
        ['row count', (draft) => {
          draft.tables[0].rows = draft.tables[0].rows.slice(1)
          draft.tables[0].rowCount = draft.tables[0].rows.length
        }],
        ['extra row', (draft) => {
          draft.tables[2].rows = [...draft.tables[2].rows, clone(draft.tables[2].rows[0])]
          draft.tables[2].rowCount = draft.tables[2].rows.length
        }],
        ['row value', (draft) => {
          const index = LEGACY_COLUMNS.keycap_tray_designs.indexOf('floor_mm')
          draft.tables[0].rows[0][index] = ['f', 2.5]
        }],
        ['schema identity', (draft) => {
          draft.tables[1].schema.createSqlSha256 = '0'.repeat(64)
        }],
        ['sourceSchema entry', (draft) => {
          draft.sourceSchema.keycap_tray_pockets = '9'.repeat(64)
        }],
        ['schema column name', (draft) => {
          draft.tables[1].schema.columns[3].name = 'x_millimetres'
        }],
        ['schema column type', (draft) => {
          draft.tables[1].schema.columns[2].type = 'INTEGER'
        }],
        ['schema column order', (draft) => {
          const columns = draft.tables[0].schema.columns
          draft.tables[0].schema.columns = [columns[1], columns[0], ...columns.slice(2)]
        }],
        ['schema nullability', (draft) => {
          draft.tables[0].schema.columns[2].notNull = true
        }],
        ['schema primary key position', (draft) => {
          draft.tables[0].schema.columns[0].primaryKeyOrder = 0
        }],
        ['declared primary key', (draft) => { draft.tables[2].schema.primaryKey = ['name'] }],
        ['sqlite sequence', (draft) => { draft.sqliteSequence[1].seq += 1 }],
      ]

      for (const [label, mutate] of cases) {
        const draft = clone(bundle)
        mutate(draft)
        assert.doesNotThrow(() => refused(draft, approved), `${label} must be refused`)
      }
    })
  })

  test('malformed or unsafe sequence entries are rejected before planning', async () => {
    await withApprovedFixture((bundle, approved) => {
      for (const mutate of [
        (draft: ExportBundle) => { draft.sqliteSequence = [] },
        (draft: ExportBundle) => {
          draft.sqliteSequence[0] = null as unknown as ExportBundle['sqliteSequence'][number]
        },
        (draft: ExportBundle) => { draft.sqliteSequence[0].name = 'other' as never },
        (draft: ExportBundle) => { draft.sqliteSequence[0].seq = -1 },
        (draft: ExportBundle) => { draft.sqliteSequence[0].seq = Number.MAX_SAFE_INTEGER + 1 },
      ]) {
        const draft = clone(bundle)
        mutate(draft)
        assert.doesNotThrow(
          () => refused(draft, approved, 'EXPORT_SEQUENCE_INVALID'))
      }
    })
  })

  test('moving the approved contract instead of the bundle is refused too', async () => {
    await withApprovedFixture((bundle, approved) => {
      const cases: [string, (draft: ApprovedSource) => void][] = [
        ['row count', (draft) => { draft.tables[1].rowCount = 11 }],
        ['canonical hash', (draft) => { draft.tables[1].canonicalSha256 = 'a'.repeat(64) }],
        ['product hash', (draft) => {
          draft.canonical.productCanonicalSha256 = 'b'.repeat(64)
        }],
        ['schema identity', (draft) => { draft.tables[0].createSqlSha256 = 'c'.repeat(64) }],
        ['column metadata', (draft) => { draft.tables[0].columns[4].type = 'BLOB' }],
        ['source identity', (draft) => { draft.source.commit = 'd'.repeat(40) }],
        ['product name', (draft) => { draft.product = 'Prism' }],
      ]
      for (const [label, mutate] of cases) {
        const draft = clone(approved)
        mutate(draft)
        assert.doesNotThrow(() => refused(bundle, draft), `${label} must be refused`)
      }
    })
  })

  test('an approved bundle passes and reports its recomputed hashes', async () => {
    await withApprovedFixture((bundle, approved) => {
      const result = assertApprovedSource(bundle, approved)
      assert.equal(result.product, 'ShapePilot')
      assert.equal(result.productCanonicalSha256, ORACLE.product)
      assert.deepEqual(result.tables.map((table) => table.canonicalSha256), [
        ORACLE.keycap_tray_designs, ORACLE.keycap_tray_pockets, ORACLE.keycap_pocket_library,
      ])

      const db = openEphemeralDatabase()
      try {
        const plan = planImport({ db: db.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, true)
        assert.equal(plan.report.approval.productCanonicalSha256, ORACLE.product)
      } finally {
        db.close()
      }
    })
  })

  test('a storage class that the approved schema cannot hold is refused', async () => {
    await withApprovedFixture((bundle, approved) => {
      const draft = clone(bundle)
      // `name` is TEXT in the approved schema; an integer there cannot be
      // canonicalized, so the gate refuses instead of guessing.
      const index = LEGACY_COLUMNS.keycap_tray_designs.indexOf('name')
      draft.tables[0].rows[0][index] = ['i', '5']
      const db = openEphemeralDatabase()
      try {
        assert.throws(
          () => planImport({ db: db.handle, bundle: draft, owner, approvedSource: approved }),
          (error: unknown) => (error as { code?: string }).code === 'STORAGE_CLASS_MISMATCH')
      } finally {
        db.close()
      }
    })
  })

  test('the contract file on disk is the one the build validates', () => {
    // Guards against a build that ships a contract nobody re-validated.
    const reloaded = validateApprovedSource(clone(APPROVED_SOURCE))
    assert.equal(
      createHash('sha256').update(JSON.stringify(reloaded)).digest('hex'),
      createHash('sha256').update(JSON.stringify(APPROVED_SOURCE)).digest('hex'))
  })
})
