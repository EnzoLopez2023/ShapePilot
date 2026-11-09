// Panel stands: a printed foot that holds a sheet of plywood upright on its
// edge -- to iron on edge banding, to finish both faces, to let a glued panel
// dry -- with the panel's bottom edge dropped into a slot.
//
// Seen end-on the stand is a low triangle split by the slot: a base bar along
// the bench, an upright wall either side of the slot, and a sloped leg from the
// top of each wall down to the bench. A strut from the foot of each wall to
// the middle of its leg, square to the leg, leaves two triangular windows a
// side, which keeps it light and stiff. It prints lying on that profile, so
// the slot runs the full print height and every layer carries its own load.
//
// The shape follows a downloaded set of fixed sizes, measured and redrawn so
// any measured thickness works: the same nominal sheet is 18 or 19 mm
// depending on where it came from. The panel thickness can also be raised as a
// label on the top face of the base bar, because a drawer of stands that all
// look alike is the reason to want one.
//
// Like the clamping squares, each stand is one ordinary path object; its label
// is an ordinary text object beside it, the way the ID card lays out its text,
// so it can print from its own AMS tray.
import type { Contour, PathObject, SceneObject, TextObject, Triple } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, createText, newId } from '../../model/scene.ts'
import { DEFAULT_FONT_ID } from '../../text/fonts.ts'
import type { MeasureText } from './idCard.ts'

export interface PanelStandSpec {
  /** The panel, as measured. */
  panelMm: number
  /** Added to each side of the slot. */
  clearanceMm: number
  /** Length of the slot, which is the print height. */
  depthMm: number
  /** Raised on the base bar; blank for none. */
  label: string
  /** How far the label stands above the base. */
  raiseMm: number
  /** How many to lay out, in rows across the plate. */
  count: number
}

export const DEFAULT_PANEL_STAND_SPEC: PanelStandSpec = {
  panelMm: 18,
  clearanceMm: 0.25,
  depthMm: 25,
  label: '18mm',
  raiseMm: 0.6,
  count: 4,
}

/** From the slot wall out to the tip of the leg, along the bench. */
export const LEG_MM = 60
/** Bench to the peak before it is rounded; the slot wall stands about 57 mm. */
export const HEIGHT_MM = 61
/** Under the slot, and the strip the label sits on. */
export const BASE_MM = 8
/** The walls either side of the slot, the legs and the struts. */
export const BAR_MM = 5
/** Round over the tips, the wall tops and the windows; the slot stays square. */
const TIP_RADIUS_MM = 3
const TOP_RADIUS_MM = 2.5
const WINDOW_RADIUS_MM = 2.5
const ARC_SEGMENTS = 8
/** Between the label and the edges of the base bar. */
const LABEL_MARGIN_MM = 1.2
/** Below this a label would not print legibly, so it is left off. */
export const MIN_LABEL_MM = 2.5

export const MIN_PANEL_MM = 3
export const MAX_PANEL_MM = 40
export const MAX_COUNT = 8
/** Between neighbouring stands. */
const SPACING_MM = 5

/** Why a spec cannot be made, or null when it can. */
export function panelStandProblem(s: PanelStandSpec): string | null {
  if (!Number.isFinite(s.panelMm) || s.panelMm < MIN_PANEL_MM || s.panelMm > MAX_PANEL_MM) {
    return `Panel thickness must be between ${MIN_PANEL_MM} and ${MAX_PANEL_MM} mm.`
  }
  if (!Number.isFinite(s.clearanceMm) || s.clearanceMm < 0 || s.clearanceMm > 2) {
    return 'Clearance must be between 0 and 2 mm.'
  }
  if (!Number.isFinite(s.depthMm) || s.depthMm < 5 || s.depthMm > 200) {
    return 'Depth must be between 5 and 200 mm.'
  }
  if (s.label.trim() && (!Number.isFinite(s.raiseMm) || s.raiseMm <= 0 || s.raiseMm > 5)) {
    return 'Label height must be above zero and at most 5 mm.'
  }
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > MAX_COUNT) {
    return `Make between 1 and ${MAX_COUNT} at a time.`
  }
  return null
}

/** The thickness written the way a label reads, 18 → "18mm", 18.5 → "18.5mm". */
export const panelLabel = (panelMm: number): string =>
  Number.isFinite(panelMm) ? `${Math.round(panelMm * 10) / 10}mm` : ''

export const panelStandName = (s: PanelStandSpec): string =>
  `Panel stand ${Math.round(s.panelMm * 10) / 10} mm`

type Pt = readonly [number, number]

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const len = (a: Pt) => Math.hypot(a[0], a[1])

/** Where line p + t·d meets line q + u·e. */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt {
  const den = d[0] * e[1] - d[1] * e[0]
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
  return [p[0] + t * d[0], p[1] + t * d[1]]
}

/**
 * Rounds each corner of a simple polygon by its radius, shrunk where the two
 * edges are too short to hold it. Works for either winding, and for corners
 * that turn either way.
 */
export function filletRing(ring: readonly Pt[], radii: readonly number[]): Contour {
  const n = ring.length
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n], at = ring[i], next = ring[(i + 1) % n]
    const a = sub(prev, at), b = sub(next, at)
    const la = len(a), lb = len(b)
    const ua: Pt = [a[0] / la, a[1] / la], ub: Pt = [b[0] / lb, b[1] / lb]
    const angle = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])))
    const r0 = radii[i] ?? 0
    if (r0 <= 0 || angle < 1e-6 || Math.PI - angle < 1e-6) { out.push([at[0], at[1]]); continue }
    // Tangent length; neither neighbour may give up more than half its edge.
    const tan = Math.min(r0 / Math.tan(angle / 2), la / 2, lb / 2)
    const r = tan * Math.tan(angle / 2)
    const p0: Pt = [at[0] + ua[0] * tan, at[1] + ua[1] * tan]
    const p1: Pt = [at[0] + ub[0] * tan, at[1] + ub[1] * tan]
    const bis = [ua[0] + ub[0], ua[1] + ub[1]]
    const bl = len(bis as unknown as Pt)
    const dist = r / Math.sin(angle / 2)
    const c: Pt = [at[0] + bis[0] / bl * dist, at[1] + bis[1] / bl * dist]
    const s0 = Math.atan2(p0[1] - c[1], p0[0] - c[0])
    let sweep = Math.atan2(p1[1] - c[1], p1[0] - c[0]) - s0
    while (sweep > Math.PI) sweep -= 2 * Math.PI
    while (sweep < -Math.PI) sweep += 2 * Math.PI
    for (let k = 0; k <= ARC_SEGMENTS; k++) {
      const t = s0 + sweep * (k / ARC_SEGMENTS)
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
    }
  }
  return out
}

/** Half the slot, clearance included. */
const halfSlot = (s: PanelStandSpec) => s.panelMm / 2 + s.clearanceMm

interface Profile {
  rings: Contour[]
  /** Overall width along the bench. */
  widthMm: number
}

/**
 * The end-on profile, the slot centred on x = 0 and the bench at y = 0: the
 * outline CCW, then the four windows CW.
 */
function profile(s: PanelStandSpec): Profile {
  const h = halfSlot(s)
  const tip = h + LEG_MM
  const wall = h + BAR_MM

  // Each leg runs straight up to the top of its slot wall, so the rounded
  // peak also gives the panel a lead-in.
  const outer: Pt[] = [
    [-tip, 0], [tip, 0], [h, HEIGHT_MM], [h, BASE_MM], [-h, BASE_MM], [-h, HEIGHT_MM],
  ]
  const outerRadii = [TIP_RADIUS_MM, TIP_RADIUS_MM, TOP_RADIUS_MM, 0, 0, TOP_RADIUS_MM]

  // The right-hand windows; the left are their mirror image.
  const legDir = sub([h, HEIGHT_MM], [tip, 0])
  const legLen = len(legDir)
  const along: Pt = [legDir[0] / legLen, legDir[1] / legLen]
  /** Square to the leg, pointing in towards the slot. */
  const inward: Pt = [-along[1], along[0]]
  const legInside: Pt = [tip + inward[0] * BAR_MM, inward[1] * BAR_MM]
  const corner: Pt = [wall, BASE_MM]
  // The strut runs from the foot of the wall straight out to the leg.
  const strut: Pt = [-inward[0], -inward[1]]
  // `along` runs up the leg, so half a bar back along it is the lower edge.
  const strutLow: Pt = [corner[0] - along[0] * BAR_MM / 2, corner[1] - along[1] * BAR_MM / 2]
  const strutHigh: Pt = [corner[0] + along[0] * BAR_MM / 2, corner[1] + along[1] * BAR_MM / 2]

  const lower: Pt[] = [
    meet(corner, [1, 0], strutLow, strut),
    meet(corner, [1, 0], legInside, along),
    meet(strutLow, strut, legInside, along),
  ]
  const upper: Pt[] = [
    meet(corner, [0, 1], strutHigh, strut),
    meet(strutHigh, strut, legInside, along),
    meet(corner, [0, 1], legInside, along),
  ]
  const window = (tri: Pt[]) => filletRing(tri, tri.map(() => WINDOW_RADIUS_MM))
  const cw = (tri: Pt[]) => (area(tri) > 0 ? [...tri].reverse() : tri)
  const mirror = (tri: Pt[]): Pt[] => cw(tri.map(([x, y]) => [-x, y] as Pt))

  return {
    rings: [
      filletRing(outer, outerRadii),
      window(cw(lower)), window(cw(upper)), window(mirror(lower)), window(mirror(upper)),
    ],
    widthMm: 2 * tip,
  }
}

function area(ring: readonly Pt[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length]
    sum += x0 * y1 - x1 * y0
  }
  return sum / 2
}

/**
 * The box a label must stay inside on the base bar's top face: the full bar
 * height less a margin, and as wide as the bar is solid at its top edge.
 */
export function labelRoom(s: PanelStandSpec): { widthMm: number; heightMm: number } {
  const h = halfSlot(s)
  // The leg's outer face crosses the top of the base this far out.
  const xAtTop = h + LEG_MM - LEG_MM * (BASE_MM - LABEL_MARGIN_MM) / HEIGHT_MM
  return { widthMm: 2 * (xAtTop - TIP_RADIUS_MM), heightMm: BASE_MM - 2 * LABEL_MARGIN_MM }
}

/** The label's font size, or null when it is blank or too long to read. */
export function labelSize(s: PanelStandSpec, measure: MeasureText): number | null {
  const text = s.label.trim()
  if (!text) return null
  const m = measure(text)
  if (m.widthMm <= 0 || m.heightMm <= 0) return null
  const room = labelRoom(s)
  const size = Math.floor(Math.min(room.widthMm / m.widthMm, room.heightMm / m.heightMm) * 10) / 10
  return size * m.heightMm >= MIN_LABEL_MM ? size : null
}

interface Placement {
  /** Where the stand's origin -- the middle of its slot, at the bench -- lands. */
  x: number
  y: number
  /** Turned half a turn, peak towards the front, to nest against the one before. */
  flipped: boolean
}

export interface StandLayout {
  stands: Placement[]
  /** Outside size on the plate, x by y, from the layout's front-left corner. */
  footprintMm: [number, number]
}

/**
 * Where each stand goes, from the front-left corner of the layout. Stands go
 * in pairs, the second turned half a turn so its leg runs alongside the
 * first's a spacing apart: two take barely more depth than one. A pair too
 * wide for the plate gives way to one stand a row.
 */
export function panelStandLayout(s: PanelStandSpec, plateWidthMm = Infinity): StandLayout {
  const h = halfSlot(s)
  const tip = h + LEG_MM
  // Square to the legs they are SPACING_MM apart; across the plate, further.
  const nudge = SPACING_MM * Math.hypot(LEG_MM, HEIGHT_MM) / HEIGHT_MM
  const offset = tip + h + nudge
  const pairWidth = 2 * tip + offset
  const paired = s.count > 1 && pairWidth <= plateWidthMm
  const perRow = paired ? 2 : 1
  const rows = Math.ceil(s.count / perRow)
  const stands = Array.from({ length: s.count }, (_, i): Placement => {
    const y = Math.floor(i / perRow) * (HEIGHT_MM + SPACING_MM)
    return paired && i % 2 === 1
      ? { x: tip + offset, y: y + HEIGHT_MM, flipped: true }
      : { x: tip, y, flipped: false }
  })
  return {
    stands,
    footprintMm: [paired ? pairWidth : 2 * tip, rows * HEIGHT_MM + (rows - 1) * SPACING_MM],
  }
}

export interface StandPaint {
  filamentSlot?: number
  color?: string
}

const paint = (p?: StandPaint) => ({
  ...(p?.filamentSlot ? { filamentSlot: p.filamentSlot } : {}),
  ...(p?.color ? { color: p.color } : {}),
})

/**
 * `count` stands laid out for a plate `plateWidthMm` wide, the layout's
 * front-left corner at `at`, each followed by its label when it has one.
 * `measure` sizes the label; without it no label is made.
 */
export function createPanelStands(
  s: PanelStandSpec,
  measure: MeasureText | null,
  at: Triple = [0, 0, 0],
  plateWidthMm = Infinity,
  colours: { stand?: StandPaint; label?: StandPaint } = {},
): SceneObject[] {
  const problem = panelStandProblem(s)
  if (problem) throw new Error(problem)
  const { rings } = profile(s)
  const size = measure ? labelSize(s, measure) : null
  const objects: SceneObject[] = []
  panelStandLayout(s, plateWidthMm).stands.forEach((place, i) => {
    const x = at[0] + place.x
    const y = at[1] + place.y
    const rotationDeg: Triple = [0, 0, place.flipped ? 180 : 0]
    const name = s.count > 1 ? `${panelStandName(s)} ${i + 1}` : panelStandName(s)
    const stand: PathObject = {
      id: newId(),
      name,
      type: 'path',
      rings,
      thicknessMm: s.depthMm,
      transform: { ...IDENTITY_TRANSFORM, position: [x, y, at[2]], rotationDeg },
      mode: 'solid',
      visible: true,
      locked: false,
      ...paint(colours.stand),
    }
    objects.push(stand)
    if (size !== null) {
      const text = createText(s.label.trim(), [x, y + (place.flipped ? -1 : 1) * BASE_MM / 2, at[2] + s.depthMm])
      const label: TextObject = {
        ...text,
        name: `${name} label`,
        transform: { ...text.transform, rotationDeg },
        fontId: DEFAULT_FONT_ID,
        sizeMm: size,
        thicknessMm: s.raiseMm,
        ...paint(colours.label),
      }
      objects.push(label)
    }
  })
  return objects
}
