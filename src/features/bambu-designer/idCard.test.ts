import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse } from 'opentype.js'
import type { AssetRef, SceneObject } from '../../model/document.ts'
import { traceTextPolys } from '../../text/fonts.ts'
import type { CardSizeId, CardSpec, LogoBounds } from './idCard.ts'
import {
  CARD_MARGIN_MM, CARD_SIZES, DEFAULT_CARD_SPEC, fitLines, layoutCard, measureWith, readCards,
} from './idCard.ts'

const font = parse(readFileSync('public/fonts/archivo-medium.ttf').buffer as ArrayBuffer)
const measure = measureWith(font)

const LOGO_FILE = 'el-logo-badge.stl'
/** The badge as it sits in public/models: centred, standing 1.5 mm off z = 0. */
const LOGO_BOUNDS: LogoBounds = { widthMm: 35.7, depthMm: 31.9, minZ: 1.5, maxZ: 3 }
const logo = {
  asset: { hash: 'a'.repeat(64), filename: LOGO_FILE, byteLength: 1 } satisfies AssetRef,
  bounds: LOGO_BOUNDS,
  name: 'EL logo badge',
}

const spec = (patch: Partial<CardSpec>): CardSpec => ({ ...DEFAULT_CARD_SPEC, ...patch })

/** Every raised part's real footprint, as [minX, minY, maxX, maxY], and its z span. */
function footprints(objects: readonly SceneObject[]) {
  return objects.slice(1).map(o => {
    const [px, py, pz] = o.transform.position
    if (o.type === 'text') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const poly of traceTextPolys(font, o.text, o.sizeMm)) for (const ring of poly) for (const [x, y] of ring) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      return { box: [px + minX, py + minY, px + maxX, py + maxY], z: [pz, pz + (o.thicknessMm ?? 0)] }
    }
    const [sx, sy, sz] = o.transform.scale
    return {
      box: [
        px - (LOGO_BOUNDS.widthMm / 2) * sx, py - (LOGO_BOUNDS.depthMm / 2) * sy,
        px + (LOGO_BOUNDS.widthMm / 2) * sx, py + (LOGO_BOUNDS.depthMm / 2) * sy,
      ],
      z: [pz + LOGO_BOUNDS.minZ * sz, pz + LOGO_BOUNDS.maxZ * sz],
    }
  })
}

const CASES: { lines: string[]; logo: CardSpec['logo'] }[] = [
  { lines: ['Gateron'], logo: 'none' },
  { lines: ['Gateron'], logo: 'left' },
  { lines: ['Kailh Box Jade', 'Clicky'], logo: 'right' },
  { lines: ['M3 × 8 socket head cap screws, stainless'], logo: 'none' },
  { lines: ['One', 'Two', 'Three', 'Four'], logo: 'left' },
  { lines: ['Wgjpqy'], logo: 'none' },
]

test('every line and the logo stay inside the card margin, standing on its top', () => {
  for (const size of Object.keys(CARD_SIZES) as CardSizeId[]) {
    const card = CARD_SIZES[size]
    for (const raiseMm of [0.4, 0.8]) {
      for (const { lines, logo: placement } of CASES) {
        const { objects } = layoutCard(spec({ size, lines, raiseMm, logo: placement }), measure, logo)
        const halfW = card.widthMm / 2 - CARD_MARGIN_MM + 1e-6
        const halfD = card.depthMm / 2 - CARD_MARGIN_MM + 1e-6
        const parts = footprints(objects)
        assert.equal(parts.length, lines.length + (placement === 'none' ? 0 : 1), `${size} ${lines}`)
        for (const { box: [x0, y0, x1, y1], z: [z0, z1] } of parts) {
          assert.ok(x0 >= -halfW && x1 <= halfW, `${size} ${lines} spills in x: ${x0}..${x1}`)
          assert.ok(y0 >= -halfD && y1 <= halfD, `${size} ${lines} spills in y: ${y0}..${y1}`)
          assert.ok(Math.abs(z0 - card.heightMm) < 1e-9, `${size} ${lines} floats at ${z0}`)
          assert.ok(Math.abs(z1 - z0 - raiseMm) < 1e-9, `${size} ${lines} raised ${z1 - z0}`)
        }
        // Lines never overlap the logo or each other.
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
          const [a, b] = [parts[i].box, parts[j].box]
          const apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]
          assert.ok(apart, `${size} ${lines}: parts ${i} and ${j} overlap`)
        }
      }
    }
  }
})

test('a short line keeps the size asked for; a long one shrinks to fit', () => {
  const { lineSizesMm } = layoutCard(
    spec({ size: 'm', lines: ['Ok', 'A much longer description line'], maxTextMm: 8 }), measure)
  assert.equal(lineSizesMm[0], 8)
  assert.ok(lineSizesMm[1] < 8)
})

test('fitLines shrinks the block together when the lines are too tall to stack', () => {
  const sizes = fitLines([{ widthMm: 1, heightMm: 1 }, { widthMm: 1, heightMm: 1 }], 100, 10, 20)
  // 10 mm tall, less one 1.5 mm gap, split between two 1:1 lines.
  assert.deepEqual(sizes, [4.2, 4.2])
})

test('blank lines are dropped, and the card carries its own filament', () => {
  const { objects } = layoutCard(spec({
    lines: ['', 'Gateron', '  '],
    card: { filamentSlot: 1, color: '#0A2472' },
    raised: { filamentSlot: 2, color: '#C0C0C0' },
  }), measure)
  assert.equal(objects.length, 2)
  assert.equal(objects[0].filamentSlot, 1)
  assert.equal(objects[1].filamentSlot, 2)
  assert.equal(objects[1].color, '#C0C0C0')
})

test('readCards recovers the spec each card was laid out from', () => {
  const original = spec({
    size: 'm', lines: ['Festool', 'Drill bits'], raiseMm: 0.8, logo: 'right', maxTextMm: 9,
    card: { filamentSlot: 1, color: '#0A2472' }, raised: { filamentSlot: 3, color: '#FFFFFF' },
  })
  const { objects, lineSizesMm } = layoutCard(original, measure, logo, [20, -10, 0])
  const second = layoutCard(spec({ lines: ['Second'] }), measure, null, [100, 0, 0]).objects
  const stray = { ...objects[1], id: 'elsewhere', transform: { ...objects[1].transform, position: [300, 300, 1] as const } }
  const cards = readCards([...objects, ...second, stray], LOGO_FILE)
  assert.equal(cards.length, 2)
  assert.deepEqual(cards[1].ids, second.map(o => o.id))
  const found = cards[0]
  assert.deepEqual(found.at, [20, -10, 0])
  assert.deepEqual(found.ids.sort(), objects.map(o => o.id).sort())
  assert.deepEqual(found.spec, { ...original, maxTextMm: Math.max(...lineSizesMm) })
})

test('readCards ignores a box that is not a card', () => {
  const { objects } = layoutCard(spec({ lines: ['x'] }), measure)
  const box = objects[0] as Extract<SceneObject, { type: 'solid' }>
  assert.deepEqual(readCards([{ ...box, params: { ...box.params, widthMm: 57 } }], LOGO_FILE), [])
})

test('an icon card puts the drawing where the text would go, inside the margin', () => {
  for (const icon of ['keycap', 'switch'] as const) {
    const size = CARD_SIZES.s76
    const { objects } = layoutCard(spec({ icon, logo: 'left', lines: ['ignored'] }), measure, logo, [10, 20, 0])
    assert.equal(objects.filter(o => o.type === 'text').length, 0, 'an icon card carries no text')
    const group = objects.find(o => o.type === 'group')
    assert.ok(group && group.type === 'group', `${icon}: no icon group`)
    const [gx, gy, gz] = group.transform.position
    assert.equal(gz, size.heightMm, 'the icon stands on the card top')
    // Right of the logo, and wholly inside the card's margin.
    assert.ok(gx > 10, `${icon} should sit right of centre, opposite the logo`)
    for (const child of group.children) {
      assert.equal(child.type, 'path')
      if (child.type !== 'path') continue
      assert.equal(child.thicknessMm, DEFAULT_CARD_SPEC.raiseMm)
      for (const [x, y] of child.rings[0]) {
        assert.ok(gx + x <= 10 + size.widthMm / 2 - CARD_MARGIN_MM + 1e-6, `${icon} runs past the right margin`)
        assert.ok(Math.abs(gy + y - 20) <= size.depthMm / 2 - CARD_MARGIN_MM + 1e-6, `${icon} runs past the margin`)
      }
    }
  }
})

test('an icon card reads back as the same card', () => {
  const made = layoutCard(spec({ icon: 'switch', logo: 'left', raiseMm: 0.8 }), measure, logo, [0, 0, 0]).objects
  const [found] = readCards(made, LOGO_FILE)
  assert.equal(found.spec.icon, 'switch')
  assert.equal(found.spec.logo, 'left')
  assert.equal(found.spec.raiseMm, 0.8)
  assert.equal(found.ids.length, made.length)
})
