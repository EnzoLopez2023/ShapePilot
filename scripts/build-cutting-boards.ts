// Writes Shaper Origin SVGs for two cutting boards with juice grooves, after
// the Woodpeckers CBJG-SM (8 x 13 in, corner hang hole) and CBJG-LG
// (10.75 x 17.75 in, a slot handle at each end) templates. Origin cuts the
// board directly, so these are the boards themselves, not the acrylic jigs.
//
//   node scripts/build-cutting-boards.ts [--out DIR]
//
// Every outline here -- the profile, the handles and the groove -- is a belt
// wrapped around a chain of circles: corners are circles the path turns left
// around, the groove's detour round a handle is a circle it turns right around,
// and the straight runs are the tangents between them. That keeps every curve
// an exact arc meeting its neighbours tangentially, which a hand-placed
// polyline would not.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Ring, Vec2 } from '../src/geometry/vec.ts'
import { signedArea } from '../src/geometry/vec.ts'
import type { CutDrawing } from '../src/export/cutLayers.ts'
import { writeShaperSvg } from '../src/export/shaperSvg.ts'

const IN = 25.4

/** Tool and groove numbers shared by both boards. */
const SHOP = {
  /** The groove is an on-line cut, so its width is the core box bit's. */
  grooveBitIn: 3 / 8,
  grooveDepthIn: 1 / 4,
  /** Groove centreline in from the board edge. */
  grooveInsetIn: 1,
  /** Wood left between the groove's edge and a handle opening. */
  handleWallIn: 1 / 2,
  /** Radius of the S-curve where the groove leaves the edge to clear a handle.
   *  The large board's slots leave less room before the corner -- see there. */
  grooveFilletIn: 1,
  cornerRadiusIn: 1.5,
}

// -- The belt ----------------------------------------------------------------

/** turn +1: the path goes anticlockwise round it (a convex corner).
 *  turn -1: clockwise (the groove bending in around a handle). */
interface Pulley { c: Vec2; r: number; turn: 1 | -1 }

const CHORD_MM = 0.2

/** Where the tangent leaves pulley a for pulley b: the unit normal `n` such
 *  that both touch points are C - turn*r*n. */
function tangentNormal(a: Pulley, b: Pulley): Vec2 {
  const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1]
  const d = Math.hypot(dx, dy)
  const k = (b.turn * b.r - a.turn * a.r) / d
  if (k > 1 + 1e-9 || k < -1 - 1e-9) throw new Error('pulleys overlap; no tangent between them')
  const alpha = Math.atan2(dy, dx) + Math.acos(Math.max(-1, Math.min(1, k)))
  return [Math.cos(alpha), Math.sin(alpha)]
}

/** A closed, anticlockwise ring around the pulleys, taken in order. */
function belt(pulleys: readonly Pulley[]): Ring {
  const count = pulleys.length
  const normals = pulleys.map((p, i) => tangentNormal(p, pulleys[(i + 1) % count]!))
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const p = pulleys[i]!
    const nIn = normals[(i - 1 + count) % count]!
    const nOut = normals[i]!
    // Touch point angle is the angle of -turn*n about the centre.
    const a0 = Math.atan2(-p.turn * nIn[1], -p.turn * nIn[0])
    const a1 = Math.atan2(-p.turn * nOut[1], -p.turn * nOut[0])
    let sweep = p.turn * (a1 - a0)
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (sweep > 2 * Math.PI - 1e-6) sweep = 0
    const steps = Math.max(1, Math.ceil((sweep * p.r) / CHORD_MM))
    for (let s = 0; s <= steps; s++) {
      const a = a0 + p.turn * sweep * (s / steps)
      out.push([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)])
    }
  }
  // Tangent runs between pulleys are the implicit straight edges; drop the
  // duplicate points a zero-length tangent leaves behind.
  const ring = out.filter((v, i) => {
    const prev = out[(i - 1 + out.length) % out.length]!
    return Math.hypot(v[0] - prev[0], v[1] - prev[1]) > 1e-6
  })
  if (signedArea(ring) <= 0) throw new Error('belt came out clockwise; pulley order is wrong')
  // A pulley placed past its neighbour's tangent point folds the belt over
  // itself rather than failing, so look for that explicitly.
  if (selfIntersects(ring)) throw new Error('belt crosses itself; a fillet or keep-out is too big')
  return ring
}

function selfIntersects(ring: Ring): boolean {
  const n = ring.length
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const c = ring[j]!, d = ring[(j + 1) % n]!
      if (Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.min(c[0], d[0]) > Math.max(a[0], b[0])) continue
      if (Math.max(c[1], d[1]) < Math.min(a[1], b[1]) || Math.min(c[1], d[1]) > Math.max(a[1], b[1])) continue
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
    }
  }
  return false
}

const circle = (c: Vec2, r: number): Ring => belt([{ c, r, turn: 1 }, { c: [c[0] + 1e-3, c[1]], r, turn: 1 }])

/** Four convex corners of a rounded rectangle, anticlockwise from bottom-left. */
const corners = (x0: number, y0: number, x1: number, y1: number, r: number): Pulley[] => [
  { c: [x0 + r, y0 + r], r, turn: 1 },
  { c: [x1 - r, y0 + r], r, turn: 1 },
  { c: [x1 - r, y1 - r], r, turn: 1 },
  { c: [x0 + r, y1 - r], r, turn: 1 },
]

/**
 * The fillet that carries a straight groove run (the line `axis = at`) into a
 * clockwise detour round `keep`: a circle of radius `rf` touching the line from
 * the island side and the keep-out circle from outside. `side` picks which of
 * the two solutions along the line -- the one before or after the keep-out.
 */
function fillet(keep: Pulley, rf: number, axis: 'x' | 'y', at: number, inward: 1 | -1, side: 1 | -1): Pulley {
  const reach = keep.r + rf
  const across = at + inward * rf
  const offset = axis === 'x' ? across - keep.c[0] : across - keep.c[1]
  const along = Math.sqrt(reach * reach - offset * offset)
  if (!Number.isFinite(along)) throw new Error('fillet cannot reach the keep-out circle')
  const c: Vec2 = axis === 'x'
    ? [across, keep.c[1] + side * along]
    : [keep.c[0] + side * along, across]
  return { c, r: rf, turn: 1 }
}

// -- The boards --------------------------------------------------------------

interface Board {
  name: string
  file: string
  lengthMm: number
  widthMm: number
  handles: Ring[]
  groove: Ring
  notes: string[]
}

const groove = {
  inset: SHOP.grooveInsetIn * IN,
  half: (SHOP.grooveBitIn * IN) / 2,
  fillet: SHOP.grooveFilletIn * IN,
  /** Groove corners stay concentric with the board's. */
  corner: (SHOP.cornerRadiusIn - SHOP.grooveInsetIn) * IN,
}
const R = SHOP.cornerRadiusIn * IN
const wall = SHOP.handleWallIn * IN

/** CBJG-SM: 8 x 13 in, a 1 in hang hole in one corner, the groove bending in
 *  around it. Length runs along x, the hole at bottom-left. */
function smallBoard(): Board {
  const L = 13 * IN, W = 8 * IN
  const holeR = 0.5 * IN
  const hole: Vec2 = [1.25 * IN, 1.25 * IN]
  const g = groove.inset
  const keep: Pulley = { c: hole, r: holeR + wall + groove.half, turn: -1 }
  const [, br, tr, tl] = corners(g, g, L - g, W - g, groove.corner)
  const path: Pulley[] = [
    // Down the left run, in round the hole, back out onto the bottom run.
    fillet(keep, groove.fillet, 'x', g, 1, 1),
    keep,
    fillet(keep, groove.fillet, 'y', g, 1, 1),
    br!, tr!, tl!,
  ]
  return {
    name: 'Cutting board, small (8 x 13 in)',
    file: 'cutting-board-small',
    lengthMm: L, widthMm: W,
    handles: [circle(hole, holeR)],
    groove: belt(path),
    notes: ['Hang hole: 1 in diameter, centred 1-1/4 in from both edges of one corner.'],
  }
}

/** CBJG-LG: 10.75 x 17.75 in, a 1 x 3-1/2 in slot handle across each end, the
 *  groove swinging in around both. */
function largeBoard(): Board {
  const L = 17.75 * IN, W = 10.75 * IN
  const slotR = 0.5 * IN
  const slotHalf = (3.5 * IN) / 2 - slotR
  const slotX = 1.5 * IN
  const cy = W / 2
  const g = groove.inset
  const keepR = slotR + wall + groove.half
  // A 1 in fillet would start above where the groove's corner arc ends: the
  // slot leaves under 2 in of straight run before the corner.
  const rf = 0.5 * IN

  const slot = (x: number): Ring => belt([
    { c: [x, cy - slotHalf], r: slotR, turn: 1 },
    { c: [x, cy + slotHalf], r: slotR, turn: 1 },
  ])

  // Left end: travelling down x = g, the path meets the top of the slot first.
  const lTop: Pulley = { c: [slotX, cy + slotHalf], r: keepR, turn: -1 }
  const lBot: Pulley = { c: [slotX, cy - slotHalf], r: keepR, turn: -1 }
  // Right end: travelling up x = L - g, the bottom of the slot comes first.
  const rBot: Pulley = { c: [L - slotX, cy - slotHalf], r: keepR, turn: -1 }
  const rTop: Pulley = { c: [L - slotX, cy + slotHalf], r: keepR, turn: -1 }
  const [bl, br, tr, tl] = corners(g, g, L - g, W - g, groove.corner)

  const path: Pulley[] = [
    tl!,
    fillet(lTop, rf, 'x', g, 1, 1),
    lTop, lBot,
    fillet(lBot, rf, 'x', g, 1, -1),
    bl!, br!,
    fillet(rBot, rf, 'x', L - g, -1, -1),
    rBot, rTop,
    fillet(rTop, rf, 'x', L - g, -1, 1),
    tr!,
  ]
  return {
    name: 'Cutting board, large (10-3/4 x 17-3/4 in)',
    file: 'cutting-board-large',
    lengthMm: L, widthMm: W,
    handles: [slot(slotX), slot(L - slotX)],
    groove: belt(path),
    notes: ['Handles: 1 x 3-1/2 in slots, centred across the width, 1-1/2 in from each end to their centreline.'],
  }
}

// -- Output ------------------------------------------------------------------

const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const outDir = resolve(outIndex >= 0 ? argv[outIndex + 1] ?? '' : 'models/cutting-boards')

/** Inches to the nearest 1/16, written as a woodworker would: 10-3/4 in. */
function fmtIn(mm: number): string {
  const sixteenths = Math.round((mm / IN) * 16)
  const whole = Math.floor(sixteenths / 16)
  let num = sixteenths % 16, den = 16
  while (num && num % 2 === 0) { num /= 2; den /= 2 }
  const frac = num ? `${num}/${den}` : ''
  return `${whole && frac ? `${whole}-${frac}` : whole ? whole : frac || '0'} in`
}

mkdirSync(outDir, { recursive: true })
const boards = [smallBoard(), largeBoard()]
for (const b of boards) {
  const outline = belt(corners(0, 0, b.lengthMm, b.widthMm, R))
  const drawing: CutDrawing = {
    name: b.name,
    layers: [
      // Profile first, as the keycap tray's proven file has it: its white fill
      // would otherwise paint over everything inside it.
      { id: 'board-profile', cutType: 'exterior', polygons: [[outline]] },
      { id: 'juice-groove', cutType: 'online', polygons: [[b.groove]] },
      { id: 'handles', cutType: 'interior', polygons: b.handles.map(h => [h]) },
    ],
    description: '1 unit = 1 mm, 1:1 scale. black = interior (handles) | '
      + 'grey line = on-line (juice groove) | white+outline = exterior (profile)',
  }
  writeFileSync(resolve(outDir, `${b.file}.svg`), writeShaperSvg(drawing))
  console.log(`${b.file}.svg  ${fmtIn(b.lengthMm)} x ${fmtIn(b.widthMm)}`)
}

const readme = [
  'Cutting boards with juice grooves, for the Shaper Origin',
  '========================================================',
  '',
  'Regenerate with: node scripts/build-cutting-boards.ts',
  'Each SVG is 1:1 in millimetres and carries Shaper\'s cut types, so Origin',
  'reads it directly. It also imports into ShapePilot\'s Shaper Designer.',
  '',
  ...boards.flatMap(b => [
    `${b.file}.svg -- ${b.name}`,
    `  Profile: ${fmtIn(b.lengthMm)} x ${fmtIn(b.widthMm)}, ${fmtIn(R)} corner radius.`,
    ...b.notes.map(n => `  ${n}`),
    '',
  ]),
  'Juice groove',
  `  On-line cut, centreline ${fmtIn(groove.inset)} from the edge, corners`,
  `  concentric with the board's. It bends in around each handle, keeping`,
  `  ${fmtIn(wall)} of wood between the groove's edge and the opening.`,
  `  Bit: ${fmtIn(SHOP.grooveBitIn * IN)} core box (round nose). Depth: ${fmtIn(SHOP.grooveDepthIn * IN)}.`,
  '  The SVG cannot carry an on-line depth -- set it on Origin. Take it in',
  '  two or three passes, and go slowly through the curves.',
  '',
  'Cut order on Origin',
  '  1. Juice groove (on-line), while the board is still full size and stiff.',
  '  2. Handles (interior), with a 1/4 in spiral bit, full thickness in passes.',
  '     Leave tabs or use tape so the slugs do not catch the bit.',
  '  3. Profile (exterior), same bit, in passes, tabs on the last pass.',
  '  Then round over the edges and handles with a 1/4 in roundover.',
  '',
  'Groove size, inset and handle wall live in SHOP at the top of the script.',
  '',
].join('\n')
writeFileSync(resolve(outDir, 'README.txt'), readme)
