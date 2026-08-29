// Backup, verify and restore.
//
// The contract these prove: SQLite's online backup API rather than a byte copy,
// a manifest with hash/counts/recency and all three offline checks, a read-back
// that restores into a disposable destination, a forward-only restore that
// refuses an active destination, and no recovery work on any startup or request
// path.
import assert from 'node:assert/strict'
import {
  chmodSync, closeSync, constants, existsSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { afterEach, describe, test } from 'vitest'
import { openDatabase } from '../../lib/db/connection.ts'
import { MIGRATIONS, headMigrationId, schemaIdentity } from '../../lib/db/migrate.ts'
import {
  ArtifactStoreError, assertSafeKey, createFilesystemArtifactStore,
} from '../../lib/recovery/artifactStore.ts'
import { createBackup, sha256File } from '../../lib/recovery/backup.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_MANIFEST_FILE, RecoveryError, validateBackupManifest,
} from '../../lib/recovery/manifest.ts'
import { restoreBackup, verifyBackup } from '../../lib/recovery/verify.ts'
import { TEST_ROOT, startTestServer, stubVerifier } from '../helpers/server.ts'

const scratch: string[] = []
const artifactGuard = resolve(import.meta.dirname, '../../native/build/artifact-store-guard')

const waitForPath = async (path: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(path)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 5))
  }
  throw new Error(`timed out waiting for ${path}`)
}

const waitForEntry = async (directory: string, prefix: string): Promise<string> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(directory)) {
      const entry = readdirSync(directory).find((name) => name.startsWith(prefix))
      if (entry) return entry
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5))
  }
  throw new Error(`timed out waiting for ${prefix} in ${directory}`)
}

const guardExit = (child: ReturnType<typeof spawn>): Promise<number | null> => {
  for (const stream of child.stdio) stream?.on('error', () => undefined)
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', resolveExit)
  })
}

const guardExitBounded = async (child: ReturnType<typeof spawn>): Promise<number | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      guardExit(child),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('artifact guard did not terminate after a bounded-source failure'))
        }, 2_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const startGuardPut = (root: string, key: string, expectedBytes: number) => {
  const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const child = spawn(artifactGuard, ['put', key, String(expectedBytes)], {
    stdio: ['pipe', 'ignore', 'pipe', rootFd, 'pipe'],
  })
  closeSync(rootFd)
  const control = child.stdio[4]
  if (!child.stdin || !control || !('end' in control)) {
    throw new Error('artifact guard did not expose its input pipes')
  }
  return { child, input: child.stdin, control }
}

const scratchDir = (label: string): string => {
  const path = join(TEST_ROOT, `${label}-${randomUUID()}`)
  mkdirSync(path, { recursive: true })
  scratch.push(path)
  return path
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

interface Fixture {
  dbPath: string
  storeRoot: string
  store: ReturnType<typeof createFilesystemArtifactStore>
}

function seededDatabase(label: string): Fixture {
  const root = scratchDir(label)
  const dbPath = join(root, 'shapepilot.db')
  const database = openDatabase({ path: dbPath, busyTimeoutMs: 2_000, createIfMissing: true })
  database.handle.prepare(`
    INSERT INTO keycap_tray_designs
      (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json,
       created_at, updated_at)
    VALUES (1, 't', 'o', 'Backed up tray', 'rect', '{}', '{}',
            '2026-08-27 00:00:00', '2026-08-27 00:07:24')`).run()
  database.handle.prepare(`
    INSERT INTO keycap_tray_pockets (id, design_id, units, x_mm, y_mm, sort_order)
    VALUES (1, 1, 1, 0, 0, 0), (2, 1, 2, 30, 0, 1)`).run()
  database.close()

  const storeRoot = join(root, 'artifact-store')
  mkdirSync(storeRoot, { recursive: true })
  return { dbPath, storeRoot, store: createFilesystemArtifactStore(storeRoot) }
}

const backupOptions = (fixture: Fixture) => ({
  sourcePath: fixture.dbPath,
  store: fixture.store,
  appVersion: '0.1.0',
  buildId: 'test',
  sourceCommit: 'test',
  sourceCreatedUtc: '2026-08-28T05:36:25.317Z',
  workRoot: join(fixture.storeRoot, '..', 'work'),
})

describe('artifact store', () => {
  test('keys are relative and cannot traverse out of the root', () => {
    const root = scratchDir('store')
    const store = createFilesystemArtifactStore(root)
    for (const key of ['../escape', '/absolute', 'a/../../b', '..']) {
      assert.rejects(() => store.get(key),
        (error: unknown) => error instanceof ArtifactStoreError)
    }
    assert.equal(assertSafeKey('20260828T053625317Z-abc/manifest.json'),
      '20260828T053625317Z-abc/manifest.json')
    assert.throws(() => assertSafeKey('../x'),
      (error: unknown) => error instanceof ArtifactStoreError)
  })

  test('put and get round-trip bytes and report the hash', async () => {
    const store = createFilesystemArtifactStore(scratchDir('store-roundtrip'))
    const payload = Buffer.from('shapepilot artifact', 'utf8')
    const stored = await store.put('bundle/data.bin', payload)
    assert.equal(stored.bytes, payload.byteLength)
    assert.deepEqual(Buffer.from(await store.get('bundle/data.bin')), payload)
    assert.deepEqual(await store.list('bundle'), ['bundle/data.bin'])
    assert.deepEqual(await store.list(''), ['bundle'])
    assert.deepEqual(await store.list(''), ['bundle'])
  })

  test('file copies are hashed with bounded I/O and materialize exact bytes', async () => {
    const root = scratchDir('store-file-copy')
    const source = join(root, '..', `source-${randomUUID()}.bin`)
    const destination = join(root, '..', `destination-${randomUUID()}.bin`)
    scratch.push(source, destination)
    const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a)
    writeFileSync(source, payload)
    const store = createFilesystemArtifactStore(root)

    const stored = await store.putFile('bundle/large.bin', source)
    const fetched = await store.fetchToFile('bundle/large.bin', destination)

    assert.equal(stored.bytes, payload.byteLength)
    assert.equal(fetched.bytes, payload.byteLength)
    assert.equal(fetched.sha256, stored.sha256)
    assert.deepEqual(readFileSync(destination), payload)
  })

  test('a same-size source rewrite aborts before publishing the final key', async () => {
    const root = scratchDir('store-source-race')
    const source = join(root, '..', `changing-source-${randomUUID()}.bin`)
    scratch.push(source)
    writeFileSync(source, Buffer.alloc(16 * 1024 * 1024, 0x41))
    const sourceFd = openSync(source, 'r+')
    let mutations = 0
    const timer = setInterval(() => {
      const byte = Buffer.from([mutations++ % 256])
      writeSync(sourceFd, byte, 0, 1, mutations % (16 * 1024 * 1024))
    }, 1)
    const store = createFilesystemArtifactStore(root)

    try {
      await assert.rejects(
        () => store.putFile('bundle/changing.bin', source),
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_SOURCE_CHANGED',
      )
    } finally {
      clearInterval(timer)
      closeSync(sourceFd)
    }
    assert.ok(mutations > 0)
    await assert.rejects(() => store.get('bundle/changing.bin'))
  })

  test('a growing source is bounded to its approved size and cannot hang publication', async () => {
    const root = scratchDir('store-growing-source')
    const source = join(root, '..', `growing-source-${randomUUID()}.bin`)
    scratch.push(source)
    writeFileSync(source, Buffer.alloc(8 * 1024 * 1024, 0x42))
    const sourceFd = openSync(source, 'a')
    const timer = setInterval(() => writeSync(sourceFd, Buffer.from('growth')), 1)
    const store = createFilesystemArtifactStore(root)

    try {
      await assert.rejects(
        Promise.race([
          store.putFile('bundle/growing.bin', source),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('growing source copy hung')), 5_000)),
        ]),
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_SOURCE_CHANGED',
      )
    } finally {
      clearInterval(timer)
      closeSync(sourceFd)
    }
    await assert.rejects(() => store.get('bundle/growing.bin'))
  })

  test('symlink components cannot redirect store reads or writes', async () => {
    const root = scratchDir('store-symlink')
    const outside = scratchDir('store-outside')
    writeFileSync(join(outside, 'secret.bin'), 'outside')
    symlinkSync(outside, join(root, 'redirect'), 'dir')
    const store = createFilesystemArtifactStore(root)
    const sourceSha256 = await sha256File(join(outside, 'secret.bin'))

    for (const operation of [
      () => store.get('redirect/secret.bin'),
      () => store.put('redirect/new.bin', Buffer.from('escape')),
      () => store.putFile('redirect/copied.bin', join(outside, 'secret.bin')),
      () => store.putBundle('redirect', [{
        name: 'shapepilot.sqlite3',
        sourcePath: join(outside, 'secret.bin'),
        bytes: 7,
        sha256: sourceSha256,
      }]),
      () => store.list('redirect'),
    ]) {
      await assert.rejects(
        operation,
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_OPERATION_FAILED',
      )
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      await assert.rejects(
        () => store.putFile(`redirect/copied-${attempt}.bin`, join(outside, 'secret.bin')),
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_OPERATION_FAILED',
      )
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      await assert.rejects(
        () => store.putBundle('redirect', [{
          name: 'shapepilot.sqlite3',
          sourcePath: join(outside, 'secret.bin'),
          bytes: 7,
          sha256: sourceSha256,
        }]),
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_OPERATION_FAILED',
      )
    }
    assert.equal(existsSync(join(outside, 'new.bin')), false)
    assert.equal(existsSync(join(outside, 'copied.bin')), false)
  })

  test('a raced root replacement cannot redirect a descriptor-anchored put', async () => {
    const parent = scratchDir('store-root-race')
    const root = join(parent, 'store')
    const held = join(parent, 'held')
    mkdirSync(root)
    const store = createFilesystemArtifactStore(root)
    renameSync(root, held)
    mkdirSync(root)

    await store.put('bundle/data.bin', Buffer.from('payload'))

    assert.equal(readFileSync(join(held, 'bundle', 'data.bin'), 'utf8'), 'payload')
    assert.equal(existsSync(join(root, 'bundle', 'data.bin')), false)
  })

  test('a raced final key is preserved and the unpublished temporary is removed', async () => {
    const root = scratchDir('store-cleanup-race')
    const direct = startGuardPut(root, 'bundle/data.bin', 5)
    const target = join(root, 'bundle', 'data.bin')
    direct.input.end('owned')
    await waitForPath(join(root, 'bundle'))
    writeFileSync(target, 'replacement')
    direct.control.end('C')

    assert.notEqual(await guardExit(direct.child), 0)
    assert.equal(readFileSync(target, 'utf8'), 'replacement')
    assert.deepEqual(
      readdirSync(join(root, 'bundle')).filter((name) => name.startsWith('.shapepilot-tmp-')),
      [],
    )
  })

  test('a replaced single-object staging inode cannot be published', async () => {
    const root = scratchDir('store-single-staging-race')
    const data = Buffer.from('approved bytes')
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const child = spawn(
      artifactGuard,
      ['put', 'object.bin', String(data.byteLength)],
      { stdio: ['pipe', 'ignore', 'pipe', rootFd, 'pipe'] },
    )
    closeSync(rootFd)
    const control = child.stdio[4]
    if (!child.stdin || !control || !('end' in control)) {
      throw new Error('artifact guard did not expose its put pipes')
    }
    child.stdin.end(data)
    const staging = join(root, '.shapepilot-staging')
    const temporary = await waitForEntry(staging, '.shapepilot-tmp-')
    const displaced = `${temporary}.displaced`
    renameSync(join(staging, temporary), join(staging, displaced))
    writeFileSync(join(staging, temporary), 'attacker bytes')
    control.end('C')

    assert.notEqual(await guardExitBounded(child), 0)
    assert.equal(existsSync(join(root, 'object.bin')), false)
    assert.equal(readFileSync(join(staging, temporary), 'utf8'), 'attacker bytes')
  })

  test('a failed put leaves no partial object to poison a retry', async () => {
    const root = scratchDir('store-failed-put')
    const target = join(root, 'bundle', 'data.bin')
    const direct = startGuardPut(root, 'bundle/data.bin', 10)
    direct.input.end('short')
    direct.control.end('C')

    assert.notEqual(await guardExit(direct.child), 0)
    assert.equal(existsSync(target), false)
    const store = createFilesystemArtifactStore(root)
    assert.equal((await store.put('bundle/data.bin', Buffer.from('complete'))).bytes, 8)
  })

  test('the next operation scavenges a temporary left by forced helper termination', async () => {
    const root = scratchDir('store-crash-temp')
    const direct = startGuardPut(root, 'bundle/data.bin', 10)
    const staging = join(root, '.shapepilot-staging')
    await waitForEntry(staging, '.shapepilot-tmp-')
    direct.child.kill('SIGKILL')
    assert.notEqual(await guardExit(direct.child), 0)
    assert.ok(readdirSync(staging).some((name) => name.startsWith('.shapepilot-tmp-')))

    const store = createFilesystemArtifactStore(root)
    assert.deepEqual(await store.list(''), ['bundle'])
    assert.deepEqual(readdirSync(staging), [])
    assert.equal(existsSync(join(root, 'bundle', 'data.bin')), false)
  })

  test('independent helpers serialize on the store root lock', async () => {
    const root = scratchDir('store-lock')
    const direct = startGuardPut(root, 'bundle/data.bin', 7)
    direct.input.end('payload')
    await waitForEntry(join(root, '.shapepilot-staging'), '.shapepilot-tmp-')
    const secondStore = createFilesystemArtifactStore(root)
    let listed = false
    const listing = secondStore.list('').then((entries) => {
      listed = true
      return entries
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    assert.equal(listed, false)

    direct.control.end('C')
    assert.equal(await guardExit(direct.child), 0)
    assert.deepEqual(await listing, ['bundle'])
  })

  test('a raced destination-parent replacement cannot redirect fetched bytes', async () => {
    const root = scratchDir('store-fetch-parent-race')
    const store = createFilesystemArtifactStore(root)
    const payload = Buffer.alloc(3 * 1024 * 1024, 0x51)
    await store.put('bundle/data.bin', payload)
    const parent = join(root, '..', `fetch-parent-${randomUUID()}`)
    const held = `${parent}-held`
    const outside = scratchDir('store-fetch-parent-outside')
    scratch.push(parent, held)
    mkdirSync(parent)
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const child = spawn(artifactGuard, ['fetch', 'bundle/data.bin', 'copy.bin'], {
      stdio: ['ignore', 'pipe', 'pipe', rootFd, parentFd],
    })
    closeSync(rootFd)
    closeSync(parentFd)
    await waitForPath(join(parent, 'copy.bin'))
    renameSync(parent, held)
    symlinkSync(outside, parent, 'dir')
    child.stdout?.resume()

    assert.equal(await guardExit(child), 0)
    assert.deepEqual(readFileSync(join(held, 'copy.bin')), payload)
    assert.equal(existsSync(join(outside, 'copy.bin')), false)
  })

  test('a handled multi-file bundle failure removes all staged bytes', async () => {
    const root = scratchDir('store-bundle-failure')
    const source = join(root, '..', `bundle-source-${randomUUID()}.bin`)
    scratch.push(source)
    writeFileSync(source, 'database bytes')
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const invalidSourceFd = openSync('/dev/null', constants.O_RDONLY)
    const child = spawn(
      artifactGuard,
      ['bundle', 'artifact-id', 'shapepilot.sqlite3', '14', 'manifest.json', '0'],
      { stdio: ['ignore', 'pipe', 'pipe', rootFd, 'pipe', sourceFd, invalidSourceFd] },
    )
    closeSync(rootFd)
    closeSync(sourceFd)
    closeSync(invalidSourceFd)
    child.stdout?.resume()

    assert.notEqual(await guardExit(child), 0)
    assert.equal(existsSync(join(root, 'artifact-id')), false)
    assert.equal(
      readdirSync(root).some((name) => name.startsWith('.shapepilot-bundle-')),
      false,
    )
  })

  test('a replaced bundle staging pathname cannot publish unapproved contents', async () => {
    const root = scratchDir('store-bundle-path-race')
    const source = join(root, '..', `bundle-race-source-${randomUUID()}.bin`)
    scratch.push(source)
    const data = Buffer.from('approved database bytes')
    writeFileSync(source, data)
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const child = spawn(
      artifactGuard,
      ['bundle', 'artifact-id', 'shapepilot.sqlite3', String(data.byteLength)],
      { stdio: ['ignore', 'pipe', 'pipe', rootFd, 'pipe', sourceFd] },
    )
    closeSync(rootFd)
    closeSync(sourceFd)
    const control = child.stdio[4]
    if (!child.stdout || !control || !('end' in control)) {
      throw new Error('artifact guard did not expose its bundle verification pipes')
    }
    let received = 0
    const copied = new Promise<void>((resolveCopied) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        received += chunk.byteLength
        if (received === data.byteLength) resolveCopied()
      })
    })
    await copied
    const staging = await waitForEntry(root, '.shapepilot-bundle-')
    const displaced = join(root, 'displaced-owned-bundle')
    renameSync(join(root, staging), displaced)
    mkdirSync(join(root, staging))
    writeFileSync(join(root, staging, 'malicious.bin'), 'unapproved')
    control.end('C')

    assert.notEqual(await guardExitBounded(child), 0)
    assert.equal(existsSync(join(root, 'artifact-id')), false)
    assert.equal(readFileSync(join(root, staging, 'malicious.bin'), 'utf8'), 'unapproved')
  })

  test('a replaced staged bundle file cannot become the approved identity', async () => {
    const root = scratchDir('store-bundle-file-race')
    const source = join(root, '..', `bundle-file-source-${randomUUID()}.bin`)
    scratch.push(source)
    const data = Buffer.from('approved database bytes')
    writeFileSync(source, data)
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const child = spawn(
      artifactGuard,
      ['bundle', 'artifact-id', 'shapepilot.sqlite3', String(data.byteLength)],
      { stdio: ['ignore', 'pipe', 'pipe', rootFd, 'pipe', sourceFd] },
    )
    closeSync(rootFd)
    closeSync(sourceFd)
    const control = child.stdio[4]
    if (!child.stdout || !control || !('end' in control)) {
      throw new Error('artifact guard did not expose its bundle verification pipes')
    }
    const copied = new Promise<void>((resolveCopied) => {
      let received = 0
      child.stdout?.on('data', (chunk: Buffer) => {
        received += chunk.byteLength
        if (received === data.byteLength) resolveCopied()
      })
    })
    await copied
    const staging = await waitForEntry(root, '.shapepilot-bundle-')
    const stagedFile = join(root, staging, 'shapepilot.sqlite3')
    await waitForPath(stagedFile)
    renameSync(stagedFile, join(root, staging, 'displaced-approved.sqlite3'))
    writeFileSync(stagedFile, 'unapproved replacement')
    control.end('C')

    assert.notEqual(await guardExitBounded(child), 0)
    assert.equal(existsSync(join(root, 'artifact-id')), false)
    assert.equal(readFileSync(stagedFile, 'utf8'), 'unapproved replacement')
  })

  test('an injected bundle entry cannot be published', async () => {
    const root = scratchDir('store-bundle-entry-race')
    const source = join(root, '..', `bundle-entry-source-${randomUUID()}.bin`)
    scratch.push(source)
    const data = Buffer.from('approved database bytes')
    writeFileSync(source, data)
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const child = spawn(
      artifactGuard,
      ['bundle', 'artifact-id', 'shapepilot.sqlite3', String(data.byteLength)],
      { stdio: ['ignore', 'pipe', 'pipe', rootFd, 'pipe', sourceFd] },
    )
    closeSync(rootFd)
    closeSync(sourceFd)
    const control = child.stdio[4]
    if (!child.stdout || !control || !('end' in control)) {
      throw new Error('artifact guard did not expose its bundle verification pipes')
    }
    const copied = new Promise<void>((resolveCopied) => {
      let received = 0
      child.stdout?.on('data', (chunk: Buffer) => {
        received += chunk.byteLength
        if (received === data.byteLength) resolveCopied()
      })
    })
    await copied
    const staging = await waitForEntry(root, '.shapepilot-bundle-')
    writeFileSync(join(root, staging, 'injected.bin'), 'unapproved')
    control.end('C')

    assert.notEqual(await guardExitBounded(child), 0)
    assert.equal(existsSync(join(root, 'artifact-id')), false)
    assert.equal(readFileSync(join(root, staging, 'injected.bin'), 'utf8'), 'unapproved')
  })

  test('a bundle with unapproved staged bytes is never published', async () => {
    const root = scratchDir('store-bundle-hash')
    const source = join(root, '..', `bundle-hash-source-${randomUUID()}.bin`)
    scratch.push(source)
    const data = Buffer.from('database bytes')
    writeFileSync(source, data)
    const store = createFilesystemArtifactStore(root)
    await assert.rejects(
      () => store.putBundle('artifact-id', [{
        name: 'shapepilot.sqlite3',
        sourcePath: source,
        bytes: data.byteLength,
        sha256: '0'.repeat(64),
      }]),
      (error: unknown) =>
        error instanceof ArtifactStoreError && error.code === 'ARTIFACT_BUNDLE_MISMATCH',
    )
    assert.equal(existsSync(join(root, 'artifact-id')), false)
  })

  test('an early bundle-guard exit is reported without a control-pipe crash', async () => {
    const root = scratchDir('store-bundle-early-exit')
    const source = join(root, '..', `bundle-exit-source-${randomUUID()}.bin`)
    scratch.push(source)
    const data = Buffer.from('database bytes')
    writeFileSync(source, data)
    const store = createFilesystemArtifactStore(root)
    const sha256 = await sha256File(source)
    chmodSync(root, 0o500)
    try {
      await assert.rejects(
        () => store.putBundle('artifact-id', [{
          name: 'shapepilot.sqlite3',
          sourcePath: source,
          bytes: data.byteLength,
          sha256,
        }]),
        (error: unknown) =>
          error instanceof ArtifactStoreError && error.code === 'ARTIFACT_OPERATION_FAILED',
      )
    } finally {
      chmodSync(root, 0o700)
    }
  })

  test.each([
    { label: 'shrinks', contents: 'short', approvedBytes: 6 },
    { label: 'grows', contents: 'longer', approvedBytes: 5 },
  ])('a bundle source that $label cannot deadlock or publish', async ({
    contents, approvedBytes,
  }) => {
    const root = scratchDir(`store-bundle-${contents}`)
    const source = join(root, '..', `bundle-length-source-${randomUUID()}.bin`)
    scratch.push(source)
    writeFileSync(source, contents)
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const child = spawn(
      artifactGuard,
      ['bundle', 'artifact-id', 'shapepilot.sqlite3', String(approvedBytes)],
      { stdio: ['ignore', 'pipe', 'pipe', rootFd, 'pipe', sourceFd] },
    )
    closeSync(rootFd)
    closeSync(sourceFd)
    const control = child.stdio[4]
    if (!child.stdout || !control || !('end' in control)) {
      throw new Error('artifact guard did not expose its bundle verification pipes')
    }
    let received = 0
    child.stdout.on('data', (chunk: Buffer) => {
      received += chunk.byteLength
      if (received >= approvedBytes) control.end('C')
    })

    assert.notEqual(await guardExitBounded(child), 0)
    assert.equal(existsSync(join(root, 'artifact-id')), false)
    assert.equal(
      readdirSync(root).some((name) => name.startsWith('.shapepilot-bundle-')),
      false,
    )
  })
})

describe('backup', () => {
  test('the backup is a real SQLite snapshot, not a byte copy of the live file', async () => {
    const fixture = seededDatabase('backup')

    // Hold a live connection open with an uncommitted write in flight; a naive
    // byte copy would capture a torn file, the online backup API cannot.
    const live = openDatabase({
      path: fixture.dbPath, busyTimeoutMs: 2_000, createIfMissing: false,
    })
    try {
      live.handle.prepare(`
        INSERT INTO keycap_tray_designs
          (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
        VALUES (2, 't', 'o', 'second', 'rect', '{}', '{}')`).run()

      const result = await createBackup(backupOptions(fixture))
      assert.match(result.artifactId, /^\d{8}T\d{9}Z-[0-9a-f]{16}$/)
      assert.equal(result.databaseKey, `${result.artifactId}/${BACKUP_DATABASE_FILE}`)

      const manifest = result.manifest
      assert.equal(manifest.contract, 'shapepilot.sqlite-backup-manifest.v2')
      assert.equal(manifest.database.checks.quickCheck.ok, true)
      assert.equal(manifest.database.checks.integrityCheck.ok, true)
      assert.equal(manifest.database.checks.foreignKeyCheck.ok, true)
      // Identity is derived from the snapshot and happens to agree with this
      // build, which is what makes the backup acceptable in the first place.
      assert.equal(manifest.database.appMarker, 'shapepilot')
      assert.equal(manifest.database.schemaMarker, schemaIdentity())
      assert.equal(manifest.database.headMigration, headMigrationId())
      assert.deepEqual(
        manifest.database.migrationLedger.map(entry => entry.id),
        MIGRATIONS.map(migration => migration.id))
      assert.deepEqual(
        manifest.database.migrationLedger.map(entry => entry.ordinal),
        MIGRATIONS.map((_, index) => index))

      const designs = manifest.database.tables.find(t => t.name === 'keycap_tray_designs')
      assert.equal(designs?.rowCount, 2)
      assert.equal(designs?.recency?.column, 'updated_at')
      const pockets = manifest.database.tables.find(t => t.name === 'keycap_tray_pockets')
      assert.equal(pockets?.rowCount, 2)
    } finally {
      live.close()
    }
  })

  test('the manifest validates and records the exact stored bytes', async () => {
    const fixture = seededDatabase('backup-manifest')
    const result = await createBackup(backupOptions(fixture))

    const stored = await fixture.store.get(`${result.artifactId}/${BACKUP_MANIFEST_FILE}`)
    const parsed = validateBackupManifest(JSON.parse(Buffer.from(stored).toString('utf8')))
    assert.equal(parsed.database.sha256, result.sha256)
    assert.equal(parsed.database.bytes, result.bytes)

    const onDisk = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    assert.equal(await sha256File(onDisk), result.sha256)
  })

  test('the live database is left untouched by taking a backup', async () => {
    const fixture = seededDatabase('backup-untouched')
    const before = await sha256File(fixture.dbPath)
    await createBackup(backupOptions(fixture))
    assert.equal(await sha256File(fixture.dbPath), before)
    assert.ok(!existsSync(`${fixture.dbPath}-wal`))
  })

  test('the scratch directory is cleaned up', async () => {
    const fixture = seededDatabase('backup-scratch')
    const options = backupOptions(fixture)
    await createBackup(options)
    const leftovers = existsSync(options.workRoot)
      ? readFileSync
      : null
    // The work root may remain, but no snapshot may be left inside it.
    if (leftovers) {
      const { readdirSync } = await import('node:fs')
      assert.deepEqual(readdirSync(options.workRoot), [])
    }
  })
})

describe('verify', () => {
  test('a good artifact verifies, restoring into a disposable destination', async () => {
    const fixture = seededDatabase('verify')
    const result = await createBackup(backupOptions(fixture))
    const workRoot = join(fixture.storeRoot, '..', 'verify-work')

    const report = await verifyBackup({
      store: fixture.store, artifactId: result.artifactId, workRoot,
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.differences, [])
    assert.equal(report.sha256, result.sha256)
    assert.equal(report.manifestSha256, result.sha256)
    assert.ok(report.tables.every(t => t.ok))
    assert.deepEqual(report.checks.quickCheck.messages, ['ok'])
    assert.deepEqual(report.checks.integrityCheck.messages, ['ok'])
    // Disposable: the scratch restore is gone once verification finishes.
    const { readdirSync } = await import('node:fs')
    assert.deepEqual(readdirSync(workRoot), [])
  })

  test('a tampered artifact fails verification', async () => {
    const fixture = seededDatabase('verify-tampered')
    const result = await createBackup(backupOptions(fixture))
    const target = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    const bytes = readFileSync(target)
    // Flip a byte deep inside the page data, past the header.
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(target, bytes)

    // Detection may surface either as a reported difference (bytes/hash) or as
    // a thrown integrity failure, depending on which page was hit. Both are a
    // refusal to accept the artifact; silently passing is not.
    let detected = false
    try {
      const report = await verifyBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        workRoot: join(fixture.storeRoot, '..', 'verify-work'),
      })
      detected = !report.ok
        && report.differences.some(d => d.includes('SHA-256'))
    } catch (error) {
      detected = error instanceof RecoveryError || error instanceof Error
    }
    assert.ok(detected, 'a tampered artifact must never verify clean')
  })

  test('a truncated artifact fails verification on bytes and hash', async () => {
    const fixture = seededDatabase('verify-truncated')
    const result = await createBackup(backupOptions(fixture))
    const target = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    writeFileSync(target, readFileSync(target).subarray(0, 4096))

    await assert.rejects(() => verifyBackup({
      store: fixture.store,
      artifactId: result.artifactId,
      workRoot: join(fixture.storeRoot, '..', 'verify-work'),
    }))
  })

  test('a manifest recording a failed check is rejected on read', async () => {
    const fixture = seededDatabase('verify-manifest')
    const result = await createBackup(backupOptions(fixture))
    const manifestPath = join(fixture.storeRoot, result.artifactId, BACKUP_MANIFEST_FILE)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, never>
    ;(manifest.database as unknown as { checks: { quickCheck: { ok: boolean } } })
      .checks.quickCheck.ok = false
    writeFileSync(manifestPath, JSON.stringify(manifest))

    await assert.rejects(
      () => verifyBackup({ store: fixture.store, artifactId: result.artifactId }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'MANIFEST_CHECKS_FAILED')
  })
})

describe('restore', () => {
  const assertNoRestoreTemps = (directory: string): void => {
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('.shapepilot-restore-')),
      [],
    )
  }

  test('restore materializes a new verified file', async () => {
    const fixture = seededDatabase('restore')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'restored', 'shapepilot.db')

    const restored = await restoreBackup({
      store: fixture.store,
      artifactId: result.artifactId,
      destinationPath: destination,
      activePath: fixture.dbPath,
    })
    assert.equal(restored.sha256, result.sha256)
    assert.equal(restored.checks.foreignKeyCheck.ok, true)
    assert.equal(statSync(destination).mode & 0o777, 0o600)

    const reopened = openDatabase({
      path: destination, busyTimeoutMs: 2_000, createIfMissing: false,
    })
    try {
      const row = reopened.handle.prepare<[], { name: string }>(
        'SELECT name FROM keycap_tray_designs WHERE id = 1').get()
      assert.equal(row?.name, 'Backed up tray')
    } finally {
      reopened.close()
    }
  })

  test('restore refuses the active authority', async () => {
    const fixture = seededDatabase('restore-active')
    const result = await createBackup(backupOptions(fixture))
    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: fixture.dbPath,
        activePath: fixture.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
  })

  test('restore refuses any existing destination, so it is forward-only', async () => {
    const fixture = seededDatabase('restore-exists')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'occupied.db')
    writeFileSync(destination, 'not empty')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store, artifactId: result.artifactId, destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
    assert.equal(readFileSync(destination, 'utf8'), 'not empty')
  })

  test('restore refuses a destination with a live journal sidecar', async () => {
    const fixture = seededDatabase('restore-journal')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'busy.db')
    writeFileSync(`${destination}-journal`, '')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store, artifactId: result.artifactId, destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_ACTIVE')
  })

  test('restore refuses dangling sidecar symlinks', async () => {
    const fixture = seededDatabase('restore-dangling-sidecar')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'dangling-sidecar.db')
    const sidecar = `${destination}-journal`
    symlinkSync('missing-sidecar-target', sidecar)

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store, artifactId: result.artifactId, destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_ACTIVE')
    assert.equal(lstatSync(sidecar).isSymbolicLink(), true)
  })

  for (const code of [
    'BACKUP_QUICK_CHECK_FAILED',
    'BACKUP_INTEGRITY_CHECK_FAILED',
    'BACKUP_FOREIGN_KEY_CHECK_FAILED',
  ]) {
    test(`${code} removes the restored file and temporary sidecars`, async () => {
      const fixture = seededDatabase(`restore-${code}`)
      const result = await createBackup(backupOptions(fixture))
      const destination = join(fixture.storeRoot, '..', `${code}.db`)

      await assert.rejects(
        () => restoreBackup({
          store: fixture.store,
          artifactId: result.artifactId,
          destinationPath: destination,
          snapshotChecks: (database) => {
            writeFileSync(`${database.name}-journal`, 'temporary')
            throw new RecoveryError(code, 'injected offline check failure')
          },
        }),
        (error: unknown) => error instanceof RecoveryError && error.code === code)

      for (const path of [
        destination,
        `${destination}-journal`,
        `${destination}-wal`,
        `${destination}-shm`,
      ]) {
        assert.equal(existsSync(path), false, `${path} must be removed`)
      }
      assertNoRestoreTemps(join(destination, '..'))
    })
  }

  test('a failed artifact fetch removes partial destination bytes', async () => {
    const fixture = seededDatabase('restore-partial-fetch')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'partial-fetch.db')
    const failingStore = {
      ...fixture.store,
      async fetchToFile(_key: string, target: string): Promise<never> {
        writeFileSync(target, 'partial SQLite bytes')
        writeFileSync(`${target}-journal`, 'temporary')
        throw new ArtifactStoreError('ARTIFACT_FETCH_FAILED', 'injected fetch failure')
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: failingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof ArtifactStoreError
        && error.code === 'ARTIFACT_FETCH_FAILED')
    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}-journal`), false)
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a concurrent destination creator wins without being overwritten or deleted', async () => {
    const fixture = seededDatabase('restore-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'raced.db')
    const racingStore = {
      ...fixture.store,
      async fetchToFile(key: string, target: string) {
        const stored = await fixture.store.fetchToFile(key, target)
        writeFileSync(destination, 'created by another process')
        return stored
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: racingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
    assert.equal(readFileSync(destination, 'utf8'), 'created by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a raced sidecar is preserved because this restore did not create it', async () => {
    const fixture = seededDatabase('restore-sidecar-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'sidecar-raced.db')
    const sidecar = `${destination}-journal`
    const racingStore = {
      ...fixture.store,
      async fetchToFile(key: string, target: string) {
        const stored = await fixture.store.fetchToFile(key, target)
        writeFileSync(sidecar, 'owned by another process')
        return stored
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: racingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_ACTIVE')
    assert.equal(existsSync(destination), false)
    assert.equal(readFileSync(sidecar, 'utf8'), 'owned by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a path replacement after exclusive create is preserved and never overwritten', async () => {
    const fixture = seededDatabase('restore-post-reservation-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'post-reservation-raced.db')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: destination,
        afterDestinationReserved: () => {
          rmSync(destination)
          writeFileSync(destination, 'replacement owned by another process')
        },
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_RACED')
    assert.equal(readFileSync(destination, 'utf8'), 'replacement owned by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a symlink to the reserved inode cannot become a promotable destination', async () => {
    const fixture = seededDatabase('restore-symlink-reserved-inode')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'symlink-raced.db')
    const retained = join(fixture.storeRoot, '..', 'retained-raced.db')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: destination,
        afterDestinationReserved: () => {
          linkSync(destination, retained)
          rmSync(destination)
          symlinkSync(retained, destination)
        },
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_RACED')
    assert.equal(lstatSync(destination).isSymbolicLink(), true)
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a raced destination parent cannot redirect descriptor-relative restore', async () => {
    const fixture = seededDatabase('restore-parent-race')
    const result = await createBackup(backupOptions(fixture))
    const parent = join(fixture.storeRoot, '..', 'restore-parent')
    const displaced = join(fixture.storeRoot, '..', 'restore-parent-displaced')
    const outside = scratchDir('restore-parent-outside')
    mkdirSync(parent)
    const destination = join(parent, 'restored.db')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: destination,
        afterDestinationReserved: () => {
          renameSync(parent, displaced)
          symlinkSync(outside, parent, 'dir')
        },
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_RACED')
    assert.equal(existsSync(join(outside, 'restored.db')), false)
    assert.equal(existsSync(join(displaced, 'restored.db')), false)
    assert.equal(lstatSync(parent).isSymbolicLink(), true)
    assertNoRestoreTemps(displaced)
  })
})

describe('recovery never runs implicitly', () => {
  test('starting the server and serving requests performs no integrity work', async () => {
    const server = await startTestServer({ label: 'no-recovery', verifier: stubVerifier({}) })
    try {
      // A running instance must leave no snapshot, manifest or work directory
      // beside its database, and must not create an artifact store.
      await server.fetchJson('/api/live')
      await server.fetchJson('/api/ready')
      await server.fetchJson('/api/version')

      const dbPath = server.database.path
      for (const sidecar of ['-wal', '-shm', '.pre-delete-mode.bak']) {
        assert.ok(!existsSync(`${dbPath}${sidecar}`), `${sidecar} must not be created`)
      }
      assert.ok(!existsSync(join(dbPath, '..', '.recovery-work')))
    } finally {
      await server.close()
    }
  })
})
