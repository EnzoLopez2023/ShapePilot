// Free-space thresholds.
//
// Two numbers, and the gap between them matters: below the first a backup must
// not be attempted at all, and between the two it is taken and complained
// about. Everything here is exercised against real filesystem paths, but the
// thresholds are checked by handing the function a source size large enough (or
// small enough) to land either side of the disk that is actually there.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'vitest'
import { availableBytes, checkSpaceFor } from './diskSpace.ts'

const scratch: string[] = []
const scratchDir = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'shapepilot-space-'))
  scratch.push(path)
  return path
}
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('measuring a volume', () => {
  test('a real directory reports the space a non-root process can use', () => {
    const available = availableBytes(scratchDir())
    assert.ok(available !== null)
    assert.ok(available > 0)
  })

  test('a path that cannot be interrogated answers null rather than throwing', () => {
    // Not a failure: an unanswerable question is not evidence of a problem, and
    // a backup must never be refused because statfs was unavailable.
    assert.equal(availableBytes(join(scratchDir(), 'does', 'not', 'exist')), null)
  })
})

describe('deciding whether there is room', () => {
  test('an ordinary database on an ordinary disk is fine and quiet', () => {
    const check = checkSpaceFor([scratchDir()], 1024 * 1024)
    assert.deepEqual(check.refusals, [])
    assert.deepEqual(check.warnings, [])
    assert.equal(check.volumes.length, 1)
  })

  test('a database too large for the volume is refused before anything is written', () => {
    const path = scratchDir()
    const available = availableBytes(path)
    assert.ok(available !== null)
    // Big enough that two copies plus headroom cannot possibly fit.
    const check = checkSpaceFor([path], available)
    assert.equal(check.warnings.length, 0)
    assert.equal(check.refusals.length, 1)
    assert.match(check.refusals[0], /free and this backup needs about/)
    assert.match(check.refusals[0], /two copies/)
  })

  test('room for this one and not many more is a warning, not a refusal', () => {
    const path = scratchDir()
    const available = availableBytes(path)
    assert.ok(available !== null)
    // Fits twice over with headroom, but nowhere near ten times.
    const check = checkSpaceFor([path], Math.floor(available / 4))
    assert.deepEqual(check.refusals, [])
    assert.equal(check.warnings.length, 1)
    assert.match(check.warnings[0], /room for roughly \d+ more snapshots/)
  })

  test('a small database on a nearly-full volume still warns on the floor alone', () => {
    // A one-kilobyte database has room for millions of copies, so the
    // proportional test says nothing. The absolute floor is what catches a
    // volume that is in trouble regardless of what it is being asked to hold.
    const path = scratchDir()
    const available = availableBytes(path)
    assert.ok(available !== null)
    if (available < 128 * 1024 * 1024) {
      assert.equal(checkSpaceFor([path], 1024).warnings.length, 1)
    } else {
      // The test machine has room; assert the floor is what would decide it.
      assert.deepEqual(checkSpaceFor([path], 1024).warnings, [])
    }
  })

  test('one volume is measured once, however many paths land on it', () => {
    const root = scratchDir()
    const check = checkSpaceFor([root, join(root, '.'), root], 1024)
    assert.equal(check.volumes.length, 1)
  })

  test('a path that cannot be measured is skipped, not treated as full', () => {
    const check = checkSpaceFor([join(scratchDir(), 'missing')], 1024)
    assert.deepEqual(check.refusals, [])
    assert.deepEqual(check.warnings, [])
    assert.deepEqual(check.volumes, [])
  })

  test('no paths at all is not a refusal', () => {
    assert.deepEqual(checkSpaceFor([], 1024).refusals, [])
  })
})
