// Writes the print-test coupon for the hardware cutters.
//
//   node scripts/build-fastener-coupon.ts [--sizes M3,M4] [--out DIR]
//
// The clearances in src/features/bambu-designer/hardware.ts are ISO nominal
// plus an allowance for how an FDM printer actually lays a hole down. Only a
// print settles whether that allowance is right, and this is the smallest part
// that asks every question at once: one plate, every cutter, two sizes.
//
// The plate is 10 mm thick so the blind features are genuinely blind -- an M4
// insert pocket is 9 mm deep, and in thinner material it would come out as a
// through hole and prove nothing.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateProgram } from '../src/csg/evaluate.ts'
import { programFromScene } from '../src/csg/fromScene.ts'
import { checkManifold } from '../src/geometry/mesh.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { writeThreeMf } from '../src/export/threemf.ts'
import { createSolid, groupObjects, newId } from '../src/model/scene.ts'
import type { SceneObject, Triple } from '../src/model/document.ts'
import type { FastenerKind, MetricSize } from '../src/features/bambu-designer/hardware.ts'
import {
  FASTENER_LABELS, METRIC_SIZES, createFastenerCutter,
} from '../src/features/bambu-designer/hardware.ts'

const PLATE = { widthMm: 80, depthMm: 40, thicknessMm: 10 }
const COLUMN_PITCH_MM = 15
const ROW_OFFSET_MM = 10
/** PLA, to say what the coupon costs before it is printed. */
const DENSITY_G_PER_CM3 = 1.24

const KINDS: readonly FastenerKind[] = [
  'clearance', 'countersunk', 'counterbored', 'insert', 'nut-trap',
]

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const index = argv.indexOf(name)
  return index >= 0 ? (argv[index + 1] ?? null) : null
}

const sizes = (flag('--sizes') ?? 'M3,M4').split(',').map(value => value.trim()) as MetricSize[]
for (const size of sizes) {
  if (!METRIC_SIZES.includes(size)) {
    console.error(`Unknown size "${size}". Known sizes: ${METRIC_SIZES.join(', ')}`)
    process.exit(1)
  }
}
if (sizes.length > 2) {
  console.error('Two rows fit on this plate; pass at most two sizes.')
  process.exit(1)
}

const outDir = resolve(flag('--out') ?? 'models/fastener-coupon')

const at = (x: number, y: number): Triple => [x, y, -PLATE.thicknessMm / 2]

/**
 * The plate is built centred on the origin, so the cutters -- which stand on
 * z = 0 by construction -- are dropped to its underside rather than the plate
 * being moved around them.
 */
const plate: SceneObject = {
  ...createSolid('box', [0, 0, -PLATE.thicknessMm / 2], {
    widthMm: PLATE.widthMm, depthMm: PLATE.depthMm, heightMm: PLATE.thicknessMm,
  }),
  id: 'plate',
  name: 'Coupon plate',
}

/** A notch at one corner, so the coupon can only be read one way up. */
const marker: SceneObject = {
  id: newId(),
  name: 'Orientation notch',
  type: 'solid',
  primitive: 'cylinder',
  params: { radiusMm: 2, heightMm: PLATE.thicknessMm + 1, segments: 32 },
  transform: {
    position: [-PLATE.widthMm / 2 + 4, -PLATE.depthMm / 2 + 4, -PLATE.thicknessMm / 2 - 0.5],
    rotationDeg: [0, 0, 0],
    scale: [1, 1, 1],
  },
  mode: 'hole',
  visible: true,
  locked: false,
}

const columnX = (index: number): number =>
  (index - (KINDS.length - 1) / 2) * COLUMN_PITCH_MM

const cutters = sizes.flatMap((size, row) => KINDS.map((kind, column) => {
  const cutter = createFastenerCutter(kind, size, PLATE.thicknessMm)
  const y = sizes.length === 1 ? 0 : (row === 0 ? ROW_OFFSET_MM : -ROW_OFFSET_MM)
  return {
    ...cutter,
    transform: { ...cutter.transform, position: at(columnX(column), y) },
  }
}))

const members = [plate, marker, ...cutters]
const { objects } = groupObjects(members, new Set(members.map(object => object.id)))

const mesh = await evaluateProgram(programFromScene(objects))
const report = checkManifold(mesh)
if (!report.ok) {
  console.error(`The coupon did not come out watertight (${report.danglingEdges} unpaired edges).`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'fastener-coupon.stl'), Buffer.from(writeBinaryStl(mesh, 'Fastener coupon')))
writeFileSync(resolve(outDir, 'fastener-coupon.3mf'), Buffer.from(writeThreeMf(mesh, 'Fastener coupon')))

const grams = (report.volume / 1000) * DENSITY_G_PER_CM3
console.log(`Wrote fastener-coupon.stl and .3mf to ${outDir}`)
console.log(`Plate ${PLATE.widthMm} x ${PLATE.depthMm} x ${PLATE.thicknessMm} mm,`
  + ` ${(report.volume / 1000).toFixed(1)} cm³ solid (about ${grams.toFixed(0)} g at 100%,`
  + ' rather less as printed).')
console.log('')
console.log('Hold it with the notch at the front left. Columns run left to right:')
KINDS.forEach((kind, index) => {
  console.log(`  ${index + 1}. ${FASTENER_LABELS[kind]}`)
})
console.log(sizes.length === 1
  ? `Single row: ${sizes[0]}.`
  : `Back row ${sizes[0]}, front row ${sizes[1]}.`)
console.log('')
console.log('Heads and insert pockets open at the TOP face; nut traps open at the bottom.')
