import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'
import { bandVolume } from '../geometry/bands.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { writeBinaryStl } from '../export/stl.ts'
import { CARD_50x30, ladderSteps } from './card.ts'
import { bandsFor, buildCard } from './cardGeometry.ts'

const ROOT = resolve(import.meta.dirname, '../..')

test('the card is watertight', () => {
  const report = checkManifold(buildCard(CARD_50x30))
  assert.equal(report.danglingEdges, 0)
  assert.ok(report.volume > 0)
})

test('a card with any number of ladder steps is watertight', () => {
  for (const steps of [1, 2, 6, 12]) {
    const cfg = { ...CARD_50x30, ladderStepsMm: ladderSteps(steps) }
    const report = checkManifold(buildCard(cfg))
    assert.equal(report.danglingEdges, 0, `${steps} steps leaked`)
  }
})

test('band volume equals mesh volume', () => {
  // The mesh's volume comes from the divergence theorem over its triangles; the
  // bands' comes from their own areas. A band derived from the wrong neighbour
  // can still mesh watertight, and only this catches it.
  const fromBands = bandVolume(bandsFor(CARD_50x30))
  const fromMesh = checkManifold(buildCard(CARD_50x30)).volume
  // Relative, as src/rack/geometry.test.ts:48 does: a Mesh stores positions as
  // Float32Array, so the divergence sum is only good to about seven digits.
  assert.ok(
    Math.abs(fromBands - fromMesh) / fromMesh < 1e-6,
    `bands ${fromBands.toFixed(3)} vs mesh ${fromMesh.toFixed(3)}`,
  )
})

test('the 50 x 30 card is byte-for-byte the STL committed in models/', () => {
  // The card in models/ is what was printed and what every holder is cut for.
  // Band, ring and weld order are all insertion-ordered, so this is a real
  // identity and not a near-enough: if a refactor moves a vertex, it fails.
  const committed = readFileSync(resolve(ROOT, 'models/filament-swatch/swatch-50x30.stl'))
  const built = Buffer.from(writeBinaryStl(buildCard(CARD_50x30), 'ShapePilot filament swatch'))
  assert.equal(built.length, committed.length, 'triangle count changed')
  assert.ok(built.equals(committed), 'the generated card no longer matches models/')
})
