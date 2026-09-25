// Systainer ID cards: a flat card with its label raised on top.
//
// A template, not a new object type. It lays out ordinary scene objects -- a
// box, a text object per line, the logo -- so everything after it (the
// inspector, the 3MF export, the AMS trays) treats a card like anything else.
// What the template adds is the fit: every line is sized so its outline stays
// inside the card's margin, which hand-placed text only does by luck.
//
// Nothing about the card is stored beyond the objects themselves. `readCards`
// recognises one by its size, so reopening the template on a saved card picks
// up where it left off without a field the document validator would refuse.
import type { Font } from 'opentype.js'
import type { AssetRef, GroupObject, PathObject, SceneObject, Triple } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, createSolid, createText, newId } from '../../model/scene.ts'
import { DEFAULT_FONT_ID, traceTextPolys } from '../../text/fonts.ts'
import type { MultiPolygon } from '../../geometry/vec.ts'
import type { CardIconId } from './cardIcons.ts'
import { CARD_ICONS, iconOutline } from './cardIcons.ts'

export type CardSizeId = 's76' | 'm'

export interface CardSize {
  label: string
  widthMm: number
  depthMm: number
  heightMm: number
}

/** The card slot on the front of each Systainer³, measured off printed cards. */
export const CARD_SIZES: Record<CardSizeId, CardSize> = {
  s76: { label: 'Systainer³ S76', widthMm: 56, depthMm: 36, heightMm: 1 },
  m: { label: 'Systainer³ M', widthMm: 85.72, depthMm: 54, heightMm: 1 },
}

/** Two and four layers at the X2D's 0.2 mm default. */
export const RAISE_OPTIONS = [0.4, 0.8] as const

export type LogoPlacement = 'none' | 'left' | 'right'

/** Where the icon sits against the text, when a card carries both. */
export type IconPlacement = 'left' | 'right' | 'above' | 'below'

/** Which tray a set of parts prints from, and the colour it is drawn in. */
export interface CardPaint {
  filamentSlot?: number
  color?: string
}

export interface CardSpec {
  size: CardSizeId
  /** One text object per non-blank line, top to bottom. */
  lines: string[]
  /**
   * A drawing of what the case holds, beside the text or on its own when
   * there is no text. Null for no drawing.
   */
  icon: CardIconId | null
  /** Where the icon goes relative to the text. Ignored without both. */
  iconAt: IconPlacement
  /** The largest a line may be. A line too long for the card comes out smaller. */
  maxTextMm: number
  raiseMm: number
  logo: LogoPlacement
  card: CardPaint
  /** The text and the logo: everything standing on the card. */
  raised: CardPaint
}

/** Clear border between the card's edge and anything raised on it. */
export const CARD_MARGIN_MM = 3
/** Between the logo and the text beside it. */
const LOGO_GAP_MM = 2.5
/** Between one line of text and the next. */
const LINE_GAP_MM = 1.5
/** The most of the card's inside width the logo takes. */
const LOGO_SHARE = 0.4
/** Between the icon and the text beside, above or below it. */
const ICON_GAP_MM = 2
/** The most of the space beside the logo that an icon takes from the text. */
const ICON_SHARE = 0.4
const MIN_TEXT_MM = 1

export const DEFAULT_CARD_SPEC: CardSpec = {
  size: 's76',
  lines: [''],
  icon: null,
  iconAt: 'below',
  maxTextMm: 12,
  raiseMm: 0.4,
  logo: 'none',
  card: { filamentSlot: 1 },
  raised: { filamentSlot: 2 },
}

/** A line's outline at a 1 mm font size. Both scale linearly with the size. */
export interface TextMetrics {
  widthMm: number
  heightMm: number
}

export type MeasureText = (text: string) => TextMetrics

/** Measures from the real outline, the same one the mesher extrudes. */
export function measureWith(font: Font): MeasureText {
  return text => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const poly of traceTextPolys(font, text, 1)) for (const ring of poly) for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    return Number.isFinite(minX)
      ? { widthMm: maxX - minX, heightMm: maxY - minY }
      : { widthMm: 0, heightMm: 0 }
  }
}

/** The logo mesh as it sits in its own file, centred on x and y: its
 *  footprint, and the z range it spans. */
export interface LogoBounds {
  widthMm: number
  depthMm: number
  minZ: number
  maxZ: number
}

/** Rounded down, so a size can only ever come out a hair inside its box. */
const floorTenth = (mm: number): number => Math.floor(mm * 10 + 1e-9) / 10

/**
 * The font size for each line so the block fits `widthMm` × `heightMm`. Each
 * line shrinks on its own to fit the width -- a long word should not drag a
 * short one down with it -- then the whole block shrinks together if the lines
 * are too tall to stack.
 */
export function fitLines(
  metrics: readonly TextMetrics[], widthMm: number, heightMm: number, maxTextMm: number,
): number[] {
  if (!metrics.length) return []
  const sizes = metrics.map(m => (m.widthMm > 0 ? Math.min(maxTextMm, widthMm / m.widthMm) : maxTextMm))
  const gaps = LINE_GAP_MM * (metrics.length - 1)
  const stacked = metrics.reduce((sum, m, i) => sum + m.heightMm * sizes[i], 0)
  const room = heightMm - gaps
  const shrink = stacked > room && stacked > 0 ? Math.max(room, 0) / stacked : 1
  return sizes.map(size => floorTenth(size * shrink))
}

export interface CardLayout {
  /** Top-level objects, card first. */
  objects: SceneObject[]
  /** The size each line came out at, for the dialog to report. */
  lineSizesMm: number[]
}

const paint = (p: CardPaint) => ({
  ...(p.filamentSlot ? { filamentSlot: p.filamentSlot } : {}),
  ...(p.color ? { color: p.color } : {}),
})

/**
 * The card and everything on it, centred on `at`. The logo is only placed
 * when `logo` is given -- the caller owns fetching and storing the file.
 */
export function layoutCard(
  spec: CardSpec,
  measure: MeasureText,
  logo: { asset: AssetRef; bounds: LogoBounds; name: string } | null = null,
  at: Triple = [0, 0, 0],
): CardLayout {
  const size = CARD_SIZES[spec.size]
  const top = at[2] + size.heightMm
  const innerW = size.widthMm - 2 * CARD_MARGIN_MM
  const innerH = size.depthMm - 2 * CARD_MARGIN_MM

  const card: SceneObject = {
    ...createSolid('box', at, {
      widthMm: size.widthMm, depthMm: size.depthMm, heightMm: size.heightMm, cornerRadiusMm: 0,
    }),
    name: `${size.label} ID card`,
    ...paint(spec.card),
  }
  const objects: SceneObject[] = [card]

  // The text gets whatever width the logo leaves it, and is centred in that.
  let textW = innerW
  let textCx = at[0]
  if (logo && spec.logo !== 'none') {
    const aspect = logo.bounds.widthMm / logo.bounds.depthMm
    const logoW = Math.min(innerW * LOGO_SHARE, innerH * aspect)
    const scaleXY = logoW / logo.bounds.widthMm
    const scaleZ = spec.raiseMm / (logo.bounds.maxZ - logo.bounds.minZ)
    const side = spec.logo === 'left' ? -1 : 1
    const logoCx = at[0] + side * (innerW - logoW) / 2
    textW = innerW - logoW - LOGO_GAP_MM
    textCx = at[0] - side * (logoW + LOGO_GAP_MM) / 2
    objects.push({
      id: newId(),
      name: logo.name,
      type: 'imported',
      format: 'stl',
      asset: logo.asset,
      transform: {
        ...IDENTITY_TRANSFORM,
        // The mesh is scaled about its own origin, so its bottom lands at
        // minZ × scale; lift by the rest to seat it on the card's top face.
        position: [logoCx, at[1], top - logo.bounds.minZ * scaleZ],
        scale: [scaleXY, scaleXY, scaleZ],
      },
      mode: 'solid',
      visible: true,
      locked: false,
      ...paint(spec.raised),
    })
  }

  const lines = spec.lines.map(line => line.trim()).filter(Boolean)
  const metrics = lines.map(measure)
  const region = { widthMm: textW, depthMm: innerH, cx: textCx, cy: at[1] }

  /** Stacks the fitted lines down from `blockTop`, each centred on `cx`. */
  const placeLines = (sizes: number[], cx: number, blockTop: number) => {
    let cursor = blockTop
    lines.forEach((line, i) => {
      const height = metrics[i].heightMm * sizes[i]
      const y = cursor - height / 2
      cursor -= height + LINE_GAP_MM
      // Too many lines for the card: a line this small would not print legibly.
      if (sizes[i] < MIN_TEXT_MM) return
      objects.push({
        ...createText(line, [cx, y, top]),
        fontId: DEFAULT_FONT_ID,
        sizeMm: sizes[i],
        thicknessMm: spec.raiseMm,
        ...paint(spec.raised),
      })
    })
  }
  const blockHeight = (sizes: number[]) =>
    metrics.reduce((sum, m, i) => sum + m.heightMm * sizes[i], 0)
    + LINE_GAP_MM * Math.max(lines.length - 1, 0)

  // An icon with no text to share with fills the space on its own.
  if (spec.icon && !lines.length) {
    objects.push(iconGroup(spec.icon, spec, region.widthMm, region.depthMm, [region.cx, region.cy, top]))
    return { objects, lineSizesMm: [] }
  }

  if (!spec.icon) {
    const sizes = fitLines(metrics, region.widthMm, region.depthMm, spec.maxTextMm)
    // Text is centred on its own outline, so each line's y is the middle of
    // its slot in a block that is itself centred on the card.
    placeLines(sizes, region.cx, region.cy + blockHeight(sizes) / 2)
    return { objects, lineSizesMm: sizes }
  }

  // Text and icon together. The icon takes its share first, the text is
  // fitted to what is left, and then the two are centred as one block -- so a
  // short word does not leave the icon stranded at the card's edge.
  const aspect = iconAspect(spec.icon)
  let sizes: number[]
  let iconCx: number, iconCy: number, iconW: number, iconH: number
  if (spec.iconAt === 'above' || spec.iconAt === 'below') {
    iconH = Math.min(region.depthMm * ICON_SHARE, region.widthMm / aspect)
    iconW = iconH * aspect
    sizes = fitLines(metrics, region.widthMm, region.depthMm - iconH - ICON_GAP_MM, spec.maxTextMm)
    const textH = blockHeight(sizes)
    const blockTop = region.cy + (textH + ICON_GAP_MM + iconH) / 2
    iconCx = region.cx
    if (spec.iconAt === 'above') {
      iconCy = blockTop - iconH / 2
      placeLines(sizes, region.cx, blockTop - iconH - ICON_GAP_MM)
    } else {
      iconCy = blockTop - textH - ICON_GAP_MM - iconH / 2
      placeLines(sizes, region.cx, blockTop)
    }
  } else {
    iconW = Math.min(region.widthMm * ICON_SHARE, region.depthMm * aspect)
    iconH = iconW / aspect
    sizes = fitLines(metrics, region.widthMm - iconW - ICON_GAP_MM, region.depthMm, spec.maxTextMm)
    const inkW = Math.max(...metrics.map((m, i) => m.widthMm * sizes[i]))
    const left = region.cx - (iconW + ICON_GAP_MM + inkW) / 2
    iconCy = region.cy
    const textTop = region.cy + blockHeight(sizes) / 2
    if (spec.iconAt === 'left') {
      iconCx = left + iconW / 2
      placeLines(sizes, left + iconW + ICON_GAP_MM + inkW / 2, textTop)
    } else {
      iconCx = left + inkW + ICON_GAP_MM + iconW / 2
      placeLines(sizes, left + inkW / 2, textTop)
    }
  }
  objects.push(iconGroup(spec.icon, spec, iconW, iconH, [iconCx, iconCy, top]))
  return { objects, lineSizesMm: sizes }
}

/** Named so `readCards` can tell which drawing a card carries. */
const iconName = (id: CardIconId) => `${CARD_ICONS[id].label} icon`

function outlineBounds(mp: MultiPolygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of mp) for (const [x, y] of poly[0] ?? []) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Width over height of the drawing's ink, which is not its nominal square. */
function iconAspect(id: CardIconId): number {
  const probe = outlineBounds(iconOutline(id, 100))
  return (probe.maxX - probe.minX) / (probe.maxY - probe.minY)
}

/**
 * The drawing as raised outlines, as large as fits `widthMm` × `depthMm` and
 * centred there. One path object per separate piece of ink, grouped so the
 * icon moves and prints as one part.
 */
function iconGroup(
  id: CardIconId, spec: CardSpec, widthMm: number, depthMm: number, at: Triple,
): GroupObject {
  // Measure once at a nominal size, then redraw at the size that fits: the
  // strokes scale with the drawing, so the line weight stays in proportion.
  const probe = outlineBounds(iconOutline(id, 100))
  // A hair under, so rounding in the redraw never lands a point past the box.
  const fit = 0.999 * Math.min(widthMm / (probe.maxX - probe.minX), depthMm / (probe.maxY - probe.minY))
  const outline = iconOutline(id, 100 * fit)
  const b = outlineBounds(outline)
  const [cx, cy] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
  const children: PathObject[] = outline.map((poly, i) => ({
    id: newId(),
    name: `${CARD_ICONS[id].label} ${i + 1}`,
    type: 'path',
    rings: poly.map(ring => ring.map(([x, y]) => [x - cx, y - cy] as [number, number])),
    thicknessMm: spec.raiseMm,
    transform: IDENTITY_TRANSFORM,
    mode: 'solid',
    visible: true,
    locked: false,
    ...paint(spec.raised),
  }))
  return {
    id: newId(),
    name: iconName(id),
    type: 'group',
    children,
    transform: { ...IDENTITY_TRANSFORM, position: at },
    mode: 'solid',
    visible: true,
    locked: false,
    ...paint(spec.raised),
  }
}

const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance

const inside = (p: Triple, c: Triple, size: CardSize) =>
  Math.abs(p[0] - c[0]) <= size.widthMm / 2 && Math.abs(p[1] - c[1]) <= size.depthMm / 2

export interface FoundCard {
  spec: CardSpec
  /** Where the card sits; a re-laid card stays put. */
  at: Triple
  /** The card and every part the template placed on it, card first. */
  ids: string[]
}

/**
 * Every card in the scene: a box of a card's size, with the text and logo
 * standing on its top face. Anything else on it -- a hole, a part added by
 * hand -- is not the template's, and is left alone. A plate of several cards
 * reads as several cards, each keeping only what sits inside its own outline.
 */
export function readCards(objects: readonly SceneObject[], logoFilename: string): FoundCard[] {
  const found: FoundCard[] = []
  const claimed = new Set<string>()
  for (const box of objects) {
    if (box.type !== 'solid' || box.primitive !== 'box' || box.mode !== 'solid') continue
    const { widthMm = 0, depthMm = 0, heightMm = 0 } = box.params
    const sizeId = (Object.keys(CARD_SIZES) as CardSizeId[]).find(id => {
      const s = CARD_SIZES[id]
      return near(widthMm, s.widthMm) && near(depthMm, s.depthMm) && near(heightMm, s.heightMm)
    })
    if (!sizeId || box.transform.rotationDeg.some(r => r !== 0)) continue
    const size = CARD_SIZES[sizeId]
    const at = box.transform.position
    const top = at[2] + size.heightMm

    const texts = objects
      .filter((o): o is Extract<SceneObject, { type: 'text' }> =>
        o.type === 'text' && o.mode === 'solid' && !claimed.has(o.id)
        && near(o.transform.position[2], top) && inside(o.transform.position, at, size))
      .sort((a, b) => b.transform.position[1] - a.transform.position[1])
    const logo = objects.find(o =>
      o.type === 'imported' && o.mode === 'solid' && o.asset.filename === logoFilename
      && !claimed.has(o.id) && inside(o.transform.position, at, size))

    const iconIds = Object.keys(CARD_ICONS) as CardIconId[]
    const icon = objects.find((o): o is GroupObject =>
      o.type === 'group' && o.mode === 'solid' && !claimed.has(o.id)
      && iconIds.some(id => o.name === iconName(id))
      && near(o.transform.position[2], top) && inside(o.transform.position, at, size))
    const iconId = icon ? iconIds.find(id => icon.name === iconName(id)) ?? null : null
    const iconPath = icon?.children.find((c): c is PathObject => c.type === 'path')

    const ids = [box.id, ...texts.map(t => t.id), ...(logo ? [logo.id] : []), ...(icon ? [icon.id] : [])]
    ids.forEach(id => claimed.add(id))
    // Which side of the text the icon is on: whichever way it is further off.
    let iconAt: IconPlacement = DEFAULT_CARD_SPEC.iconAt
    if (icon && texts.length) {
      const tx = texts.reduce((sum, t) => sum + t.transform.position[0], 0) / texts.length
      const ty = texts.reduce((sum, t) => sum + t.transform.position[1], 0) / texts.length
      const dx = icon.transform.position[0] - tx
      const dy = icon.transform.position[1] - ty
      iconAt = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'above' : 'below') : (dx < 0 ? 'left' : 'right')
    }
    const raisedFrom = texts[0] ?? icon ?? logo
    const raise = texts[0]?.thicknessMm ?? iconPath?.thicknessMm ?? RAISE_OPTIONS[0]
    found.push({
      at,
      ids,
      spec: {
        size: sizeId,
        lines: texts.length ? texts.map(t => t.text) : [''],
        icon: iconId,
        iconAt,
        // The lines were fitted down from some larger cap; the largest is the
        // closest thing to it that survives.
        maxTextMm: texts.length ? Math.max(...texts.map(t => t.sizeMm)) : DEFAULT_CARD_SPEC.maxTextMm,
        raiseMm: RAISE_OPTIONS.reduce((best, r) => (Math.abs(r - raise) < Math.abs(best - raise) ? r : best)),
        logo: logo ? (logo.transform.position[0] < at[0] ? 'left' : 'right') : 'none',
        card: { filamentSlot: box.filamentSlot, color: box.color },
        raised: { filamentSlot: raisedFrom?.filamentSlot, color: raisedFrom?.color },
      },
    })
  }
  return found
}
