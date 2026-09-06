import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  FILAMENT_CATALOG,
  FILAMENT_LINES,
  FILAMENT_PAIR_COUNT,
  filamentByKey,
  filamentLineById,
  filamentsOfLine,
  isFilamentVariantFor,
} from './bambuFilaments.ts'

const lineId = (id: string) => id

test('holds the five Bambu lines at their captured sizes', () => {
  assert.equal(FILAMENT_LINES.length, 5)
  assert.equal(FILAMENT_CATALOG.length, 108)
  const counts = Object.fromEntries(
    FILAMENT_LINES.map(l => [`${l.brand}/${l.material}/${l.type}`, filamentsOfLine(
      `${l.brand}/${l.material}/${l.type}`).length]))
  assert.deepEqual(counts, {
    'bambu-lab/pla/basic': 32,
    'bambu-lab/pla/matte': 25,
    'bambu-lab/petg/basic': 28,
    'bambu-lab/pla/wood': 6,
    'bambu-lab/abs/basic': 17,
  })
})

// The key is what the database stores. A collision would silently merge two
// products into one checkbox, and it could not be fixed after anyone had ticked
// anything: the rows would orphan.
test('every key is unique and agrees with its line', () => {
  const keys = new Set(FILAMENT_CATALOG.map(c => c.key))
  assert.equal(keys.size, FILAMENT_CATALOG.length)
  for (const color of FILAMENT_CATALOG) {
    assert.ok(color.key.startsWith(`${color.line}/`), `${color.key} is not under ${color.line}`)
    assert.ok(filamentLineById(color.line), `${color.line} is not a declared line`)
  }
})

// Bambu reissues a colour under a new code when it revises a SKU and leaves both
// listed, so the name alone is not an identity.
test('keeps both codes of a reissued colour apart', () => {
  const blues = filamentsOfLine(lineId('bambu-lab/pla/basic')).filter(c => c.name === 'Blue')
  assert.equal(blues.length, 2)
  assert.deepEqual(blues.map(c => c.code).sort(), ['10600', '10601'])
  assert.equal(new Set(blues.map(c => c.key)).size, 2)
  assert.equal(blues.find(c => c.code === '10600')?.discontinued, true)
})

// ABS "Grey" and PLA Basic "Gray" are both code 10103. A bare-code key would
// have collided across lines; the path is what separates them.
test('tolerates a code reused across two lines', () => {
  const sharing = FILAMENT_CATALOG.filter(c => c.code === '10103')
  assert.equal(sharing.length, 2)
  assert.equal(new Set(sharing.map(c => c.key)).size, 2)
  assert.deepEqual(sharing.map(c => c.line).sort(),
    ['bambu-lab/abs/basic', 'bambu-lab/pla/basic'])
})

test('every colour carries one or two uppercase hexes', () => {
  for (const color of FILAMENT_CATALOG) {
    assert.ok(color.hexes.length === 1 || color.hexes.length === 2,
      `${color.key} has ${color.hexes.length} hexes`)
    for (const hex of color.hexes) {
      assert.match(hex, /^#[0-9A-F]{6}$/, `${color.key} hex ${hex}`)
    }
  }
})

test('offers refills only on the two PLA lines that have them', () => {
  const refillable = FILAMENT_LINES
    .filter(l => l.variants.includes('refill'))
    .map(l => `${l.brand}/${l.material}/${l.type}`)
  assert.deepEqual(refillable.sort(), ['bambu-lab/pla/basic', 'bambu-lab/pla/matte'])
  for (const line of FILAMENT_LINES) {
    assert.ok(line.variants.includes('spool'), `${line.label} cannot be bought on a reel`)
  }
})

test('isFilamentVariantFor gates a variant against its own line', () => {
  const basic = filamentsOfLine(lineId('bambu-lab/pla/basic'))[0].key
  const abs = filamentsOfLine(lineId('bambu-lab/abs/basic'))[0].key
  assert.equal(isFilamentVariantFor(basic, 'spool'), true)
  assert.equal(isFilamentVariantFor(basic, 'refill'), true)
  assert.equal(isFilamentVariantFor(abs, 'spool'), true)
  // ABS is sold on a reel only, so a refill tick must never be storable.
  assert.equal(isFilamentVariantFor(abs, 'refill'), false)
  assert.equal(isFilamentVariantFor('no/such/filament/key', 'spool'), false)
  assert.equal(isFilamentVariantFor(basic, 'bottle'), false)
})

test('lookups resolve, and the pair count bounds a full tick set', () => {
  const known = FILAMENT_CATALOG[40]
  assert.equal(filamentByKey(known.key), known)
  assert.equal(filamentByKey('no/such/filament/key'), undefined)
  assert.equal(filamentLineById('no/such/line'), undefined)
  // 32 + 25 PLA lines carry two variants each; the other 51 carry one.
  assert.equal(FILAMENT_PAIR_COUNT, (32 + 25) * 2 + 28 + 6 + 17)
  assert.equal(FILAMENT_PAIR_COUNT, 165)
})
