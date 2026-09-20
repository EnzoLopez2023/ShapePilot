// Writes a filament swatch card sized around a printed label.
//
//   node scripts/build-filament-swatch.ts [--label 50x30] [--steps 4] [--out DIR]
//
// This is a redraw of the widely-printed "Swatch 48" card (48 x 24 x 2, a
// 30.25 x 20.1 label pocket) for a label maker that prints 50 x 30 mm. The
// pocket has to grow to the label, and everything else on the card is measured
// from the pocket, so the card grows with it -- there is no way to keep the
// 48 mm outline and still seat the label.
//
// Everything the original says about the filament is preserved: the same hang
// slot, the same 0.5 mm label recess, and the same thickness ladder (0.2 / 0.4
// / 0.6 / 0.8 mm windows) that shows how the colour reads when the light comes
// through it. Only the ladder's BANDS get taller, so the four numbers you can
// compare between two cards stay the same numbers.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { difference, intersection } from '../src/geometry/boolean.ts'
import { MeshBuilder, checkManifold } from '../src/geometry/mesh.ts'
import { roundedRectRing } from '../src/geometry/primitives.ts'
import { insertTJunctions } from '../src/geometry/tjunction.ts'
import type { MultiPolygon } from '../src/geometry/vec.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { writeThreeMf } from '../src/export/threemf.ts'

/** PLA, for turning the volume into something comparable to a spool. */
const DENSITY_G_PER_CM3 = 1.24
/** Corner arcs. 24 a quarter is past what a 0.4 nozzle can resolve at r=3. */
const ARC_SEGS = 24

interface SwatchConfig {
  /** The label as the label maker prints it, before any clearance. */
  labelWidthMm: number
  labelHeightMm: number
  /**
   * Added to each label dimension, halved on each side. The original card ran
   * 0.25 wide and 0.1 tall on a 30 x 20 label, which is tighter than a peeled
   * label wants to be placed by hand -- 0.4 is one extrusion of slack and
   * still reads as a seated label rather than a floating one.
   */
  labelClearanceMm: number
  /** Recess depth. Deep enough to trap the edges, shallow enough to stay flush. */
  labelDepthMm: number
  cardThicknessMm: number
  cardCornerRadiusMm: number
  /**
   * The frame: card edge to the nearest pocket. The original ran it at 1.6 mm
   * on the right and 1.8 mm top and bottom, which is a card you hold by its
   * pockets. The slot edge is the exception -- see `slotWallMm`.
   */
  borderMm: number
  /** Label pocket to ladder pocket. Interior, so the border does not set it. */
  dividerMm: number
  slotWidthMm: number
  /**
   * Material each side of the hang slot. This, not the border, sets the slot
   * edge's width: at a 3 mm border a 2 mm slot would leave 0.5 mm walls, which
   * is under one extrusion pair. 1 mm is what the original card used and held.
   */
  slotWallMm: number
  ladderWidthMm: number
  ladderCornerRadiusMm: number
  /** Window thicknesses, thinnest first. Each gets an equal band of the pocket. */
  ladderStepsMm: readonly number[]
}

/** The original Swatch 48's numbers, with the label pocket left open. */
const SWATCH: Omit<SwatchConfig, 'labelWidthMm' | 'labelHeightMm'> = {
  labelClearanceMm: 0.4,
  labelDepthMm: 0.5,
  cardThicknessMm: 2,
  cardCornerRadiusMm: 3,
  borderMm: 3,
  dividerMm: 2,
  slotWidthMm: 2,
  slotWallMm: 1,
  ladderWidthMm: 10,
  ladderCornerRadiusMm: 1,
  ladderStepsMm: [0.2, 0.4, 0.6, 0.8],
}

interface Derived {
  /** The slot edge, which is the border unless the slot needs more than that. */
  slotZoneMm: number
  cardWidthMm: number
  cardHeightMm: number
  pocketWidthMm: number
  pocketHeightMm: number
  ladderX0: number
  ladderHeightMm: number
}

/**
 * The card is laid out from the pocket outwards, so the label is what sets
 * every outside dimension. x runs along the card, y across it.
 */
function derive(cfg: SwatchConfig): Derived {
  const pocketWidthMm = cfg.labelWidthMm + cfg.labelClearanceMm
  const pocketHeightMm = cfg.labelHeightMm + cfg.labelClearanceMm
  const slotZoneMm = Math.max(cfg.borderMm, cfg.slotWidthMm + 2 * cfg.slotWallMm)
  const ladderX0 = slotZoneMm + pocketWidthMm + cfg.dividerMm
  return {
    slotZoneMm,
    cardWidthMm: ladderX0 + cfg.ladderWidthMm + cfg.borderMm,
    cardHeightMm: pocketHeightMm + 2 * cfg.borderMm,
    pocketWidthMm,
    pocketHeightMm,
    ladderX0,
    // The ladder squares up with the label pocket, so the two read as one row
    // across the card rather than two features that nearly line up.
    ladderHeightMm: pocketHeightMm,
  }
}

function checkConfig(cfg: SwatchConfig): string[] {
  const issues: string[] = []
  const d = derive(cfg)
  if (cfg.labelWidthMm <= 0 || cfg.labelHeightMm <= 0) issues.push('the label has no size')
  if (cfg.labelDepthMm >= cfg.cardThicknessMm) {
    issues.push(`a ${cfg.labelDepthMm} mm recess goes through a ${cfg.cardThicknessMm} mm card`)
  }
  const thickest = Math.max(...cfg.ladderStepsMm)
  if (thickest >= cfg.cardThicknessMm - cfg.labelDepthMm) {
    issues.push(`the ${thickest} mm ladder step is thicker than the card's floor under the label`)
  }
  if (cfg.borderMm < 0.8) issues.push(`a ${cfg.borderMm} mm border is under two extrusions`)
  if (d.cardHeightMm < 2 * cfg.borderMm + cfg.slotWidthMm) {
    issues.push('the card is too narrow for its own hang slot')
  }
  return issues
}

const ring = (x: number, y: number, w: number, h: number, r: number): MultiPolygon =>
  [[roundedRectRing(x, y, w, h, r, ARC_SEGS)]]

/**
 * The card as a stack of z-bands, thinnest feature first. Each band is the
 * card's outline less every feature whose floor is at or below that band --
 * the ladder windows drop out one by one as z rises past their thickness, and
 * the label pocket drops out for the top band only.
 */
function bandsFor(cfg: SwatchConfig): { z0: number; z1: number; region: MultiPolygon }[] {
  const d = derive(cfg)
  const steps = [...cfg.ladderStepsMm].sort((a, b) => a - b)
  const bandHeight = d.ladderHeightMm / steps.length
  const ladderY0 = cfg.borderMm + (d.pocketHeightMm - d.ladderHeightMm) / 2

  const outline = ring(0, 0, d.cardWidthMm, d.cardHeightMm, cfg.cardCornerRadiusMm)
  // A stadium: a rounded rectangle whose radius is its own half-width.
  const slotHeight = d.cardHeightMm - 2 * cfg.borderMm
  const slot = ring(
    (d.slotZoneMm - cfg.slotWidthMm) / 2, cfg.borderMm,
    cfg.slotWidthMm, slotHeight, cfg.slotWidthMm / 2,
  )
  const label = ring(
    d.slotZoneMm, cfg.borderMm, d.pocketWidthMm, d.pocketHeightMm, 2,
  )
  // The ladder is ONE pocket with a stepped floor, not a row of separate slots:
  // only its outside corners are relieved, and the step edges run straight
  // across it. So each window is the pocket clipped to its own band, which
  // leaves the radius on the two ends of the ladder and nowhere else.
  const ladder = ring(
    d.ladderX0, ladderY0, cfg.ladderWidthMm, d.ladderHeightMm, cfg.ladderCornerRadiusMm,
  )
  const windows = steps.map((_, i) => intersection(ladder, ring(
    d.ladderX0, ladderY0 + i * bandHeight, cfg.ladderWidthMm, bandHeight, 0,
  )))

  const labelFloor = cfg.cardThicknessMm - cfg.labelDepthMm
  const levels = [...new Set([0, ...steps, labelFloor, cfg.cardThicknessMm])]
    .sort((a, b) => a - b)

  const bands: { z0: number; z1: number; region: MultiPolygon }[] = []
  for (let i = 0; i < levels.length - 1; i++) {
    const z0 = levels[i]!, z1 = levels[i + 1]!
    let region = difference(outline, slot)
    // A window's material ends at its own thickness, so every band above it is
    // missing it. `>=` and not `>`: at z0 == t the window's floor is behind us.
    steps.forEach((t, w) => { if (z0 >= t - 1e-9) region = difference(region, windows[w]!) })
    if (z0 >= labelFloor - 1e-9) region = difference(region, label)
    bands.push({ z0, z1, region })
  }
  return bands
}

/**
 * The two meshing rules from the tray pipeline, unchanged: a horizontal face
 * wherever the region changes, built as the DIFFERENCE of the two bands that
 * meet there, and walls per band.
 */
function buildSwatch(cfg: SwatchConfig) {
  const raw = bandsFor(cfg)
  const b = new MeshBuilder()

  const rawUp: MultiPolygon[] = [[]]
  const rawDown: MultiPolygon[] = [[]]
  for (let i = 1; i < raw.length; i++) {
    rawUp.push(difference(raw[i - 1]!.region, raw[i]!.region))
    rawDown.push(difference(raw[i]!.region, raw[i - 1]!.region))
  }

  const n = raw.length
  const flat = insertTJunctions([...raw.map(x => x.region), ...rawUp, ...rawDown])
  const bands = raw.map((x, i) => ({ z0: x.z0, z1: x.z1, region: flat[i]! }))
  const floorsUp = flat.slice(n, 2 * n)
  const ceilingsDown = flat.slice(2 * n, 3 * n)

  b.addHorizontal(bands[0]!.region, bands[0]!.z0, 'down')
  for (let i = 1; i < bands.length; i++) {
    b.addHorizontal(floorsUp[i] ?? [], bands[i]!.z0, 'up')
    b.addHorizontal(ceilingsDown[i] ?? [], bands[i]!.z0, 'down')
  }
  b.addHorizontal(bands[n - 1]!.region, bands[n - 1]!.z1, 'up')
  for (const band of bands) b.addWalls(band.region, band.z0, band.z1)

  return b.finish()
}

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}

const label = (flag('--label') ?? '50x30').toLowerCase().split('x').map(Number)
if (label.length !== 2 || label.some(v => !Number.isFinite(v) || v <= 0)) {
  console.error('--label wants WIDTHxHEIGHT in mm, e.g. 50x30')
  process.exit(1)
}
const stepCount = Number(flag('--steps') ?? SWATCH.ladderStepsMm.length)
if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 12) {
  console.error('--steps wants a whole number of ladder windows, 1 to 12')
  process.exit(1)
}
const outDir = resolve(flag('--out') ?? 'models/filament-swatch')

const cfg: SwatchConfig = {
  ...SWATCH,
  labelWidthMm: label[0]!,
  labelHeightMm: label[1]!,
  // More windows keep the original's 0.2 mm rung and carry on up.
  ladderStepsMm: Array.from({ length: stepCount }, (_, i) => Number(((i + 1) * 0.2).toFixed(2))),
}

const issues = checkConfig(cfg)
if (issues.length) {
  console.error('This swatch cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const d = derive(cfg)
const mesh = buildSwatch(cfg)
const report = checkManifold(mesh)
if (!report.ok) {
  console.error(`The swatch mesh is not closed: ${report.danglingEdges} dangling edges`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const stem = `swatch-${label[0]}x${label[1]}`
writeFileSync(resolve(outDir, `${stem}.stl`), Buffer.from(writeBinaryStl(mesh, 'ShapePilot filament swatch')))
writeFileSync(resolve(outDir, `${stem}.3mf`), Buffer.from(writeThreeMf(mesh, 'Filament swatch')))

const grams = (report.volume / 1000) * DENSITY_G_PER_CM3
console.log(`Filament swatch for a ${label[0]} x ${label[1]} mm label`)
console.log(`  card          ${d.cardWidthMm} x ${d.cardHeightMm} x ${cfg.cardThicknessMm} mm`)
console.log(`  border        ${cfg.borderMm} mm, ${d.slotZoneMm} mm on the slot edge`)
console.log(`  label pocket  ${d.pocketWidthMm} x ${d.pocketHeightMm} mm, ${cfg.labelDepthMm} mm deep`)
console.log(`  ladder        ${cfg.ladderWidthMm} x ${d.ladderHeightMm} mm, steps ${cfg.ladderStepsMm.join(' / ')} mm`)
console.log(`  mesh          ${mesh.triangleCount} triangles, ${grams.toFixed(2)} g in PLA`)
console.log(`  written to    ${outDir}`)
