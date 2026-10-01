import assert from 'node:assert/strict'
import { test } from 'vitest'
import { unzipSync } from 'fflate'
import { rectRing } from '../geometry/primitives.ts'
import { meshFromBands } from '../geometry/bands.ts'
import { writeThreeMf, writeThreeMfParts } from './threemf.ts'
import { writeXlsx } from './xlsx.ts'
import { zipParts } from './zip.ts'

const slab = () => meshFromBands([{ z0: 0, z1: 2, region: [[rectRing(10, 10)]] }])

const bytes = (b: ArrayBuffer | Uint8Array): Buffer =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b))

/**
 * The DOS timestamp in a zip's first local file header: 2 bytes of time at
 * offset 10, 2 of date at 12, with the year counted from 1980.
 */
function stamp(buf: Buffer): { year: number; month: number; day: number } {
  const date = buf.readUInt16LE(12)
  return { year: 1980 + (date >> 9), month: (date >> 5) & 15, day: date & 31 }
}

test('a zip written twice is byte-for-byte the same zip', () => {
  // This is what models/ depends on: a generated file that changes on every
  // build makes every regeneration look like a change and hides the real one.
  const a = bytes(zipParts({ 'a.txt': new Uint8Array([1, 2, 3]) }))
  const b = bytes(zipParts({ 'a.txt': new Uint8Array([1, 2, 3]) }))
  assert.ok(a.equals(b))
})

test('the same mesh exports to the same 3MF', () => {
  const mesh = slab()
  assert.ok(bytes(writeThreeMf(mesh, 'slab')).equals(bytes(writeThreeMf(mesh, 'slab'))))
  const parts = [{ mesh, name: 'slab' }, { mesh, name: 'slab 2', extruder: 2 }]
  assert.ok(bytes(writeThreeMfParts(parts, 'pair')).equals(bytes(writeThreeMfParts(parts, 'pair'))))
})

test('the same rows export to the same workbook', () => {
  const rows = [['a', 'b'], ['1', '2']]
  assert.ok(bytes(writeXlsx(rows, 'Sheet')).equals(bytes(writeXlsx(rows, 'Sheet'))))
})

test('the stamp is the DOS epoch, not the wall clock', () => {
  // 1980 is the earliest a zip can encode. Built from LOCAL calendar fields on
  // purpose: fflate reads getFullYear(), so a UTC instant would come out as
  // 1979 west of Greenwich and be rejected.
  const s = stamp(bytes(zipParts({ 'a.txt': new Uint8Array([1]) })))
  assert.deepEqual(s, { year: 1980, month: 1, day: 1 })
  assert.deepEqual(stamp(bytes(writeThreeMf(slab(), 'slab'))), { year: 1980, month: 1, day: 1 })
  assert.deepEqual(stamp(bytes(writeXlsx([['a']]))), { year: 1980, month: 1, day: 1 })
})

test('pinning the clock did not break the archives', () => {
  // A zip readers refuse is worse than one that changes every build.
  const three = unzipSync(new Uint8Array(writeThreeMf(slab(), 'slab')))
  assert.ok(Object.keys(three).includes('3D/3dmodel.model'))
  const book = unzipSync(new Uint8Array(writeXlsx([['a']], 'Sheet')))
  assert.ok(Object.keys(book).includes('xl/worksheets/sheet1.xml'))
})
