// Text as real geometry.
//
// A CNC or a printer needs outlines, not a font reference, so glyphs are traced
// with opentype.js into the same Ring type every other shape uses. The font
// binary is vendored under public/fonts (SIL Open Font License, see
// public/fonts/OFL.txt) rather than fetched from a CDN: tracing a glyph is a
// geometry operation and must not fail because the network did, or because the
// PWA is running offline.
import type { Font } from 'opentype.js'
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { quantizeRing } from '../geometry/vec.ts'
import { nestRings } from '../geometry/nest.ts'
import type { Contour, TextObject } from '../model/document.ts'

export interface FontEntry {
  id: string
  label: string
  url: string
}

export const FONTS: readonly FontEntry[] = [
  { id: 'archivo-medium', label: 'Archivo Medium', url: '/fonts/archivo-medium.ttf' },
]

export const DEFAULT_FONT_ID = 'archivo-medium'

/** Bezier flattening resolution. Finer than QUANTUM at any plausible text size. */
const CURVE_STEPS = 16

const cache = new Map<string, Promise<Font>>()

export function loadFont(id: string): Promise<Font> {
  const entry = FONTS.find(f => f.id === id) ?? FONTS[0]
  let pending = cache.get(entry.id)
  if (!pending) {
    pending = (async () => {
      const { parse } = await import('opentype.js')
      const response = await fetch(entry.url)
      if (!response.ok) throw new Error(`could not load the font ${entry.label}`)
      return parse(await response.arrayBuffer())
    })()
    cache.set(entry.id, pending)
  }
  return pending
}

const quadAt = (t: number, a: number, b: number, c: number): number =>
  (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c

const cubicAt = (t: number, a: number, b: number, c: number, d: number): number => {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/**
 * opentype's path commands -> flat rings. Y is negated because font space is
 * y-down while the model is y-up, matching the SVG importer's conversion.
 */
function pathToRings(commands: readonly { type: string; [k: string]: unknown }[]): Ring[] {
  const rings: Ring[] = []
  let current: Ring = []
  let cx = 0, cy = 0

  const push = (x: number, y: number) => { current.push([x, -y] as const); cx = x; cy = y }
  const close = () => {
    if (current.length >= 3) rings.push(current)
    current = []
  }

  for (const command of commands) {
    const c = command as unknown as Record<string, number>
    switch (command.type) {
      case 'M':
        close()
        push(c.x, c.y)
        break
      case 'L':
        push(c.x, c.y)
        break
      case 'Q': {
        const x0 = cx, y0 = cy
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
          current.push([quadAt(t, x0, c.x1, c.x), -quadAt(t, y0, c.y1, c.y)] as const)
        }
        cx = c.x; cy = c.y
        break
      }
      case 'C': {
        const x0 = cx, y0 = cy
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
          current.push([
            cubicAt(t, x0, c.x1, c.x2, c.x),
            -cubicAt(t, y0, c.y1, c.y2, c.y),
          ] as const)
        }
        cx = c.x; cy = c.y
        break
      }
      case 'Z':
        close()
        break
    }
  }
  close()
  return rings
}

/**
 * Glyph outlines for a plain string as a nested `MultiPolygon` -- outer rings
 * with their counters as holes, recovered by containment -- centred on the
 * run's own bounds so it scales and rotates about itself like every other
 * shape. This is the form the mesher wants for extruding text as a solid
 * (the keycap-tray nameplate); `textOutlines` flattens it for the 2D canvas.
 *
 * Glyphs are mapped per character rather than through `stringToGlyphs`, which
 * runs GSUB shaping: Archivo uses a contextual lookup opentype.js cannot read
 * and throws on. Ligatures and contextual alternates are a nicety for cut
 * text; a reliable outline is not. Kerning is still applied.
 */
export function traceTextPolys(
  font: Font, text: string, sizeMm: number, letterSpacing = 0,
): MultiPolygon {
  if (!text.trim() || sizeMm <= 0) return []

  const rings: Ring[] = []
  let penX = 0
  const glyphs = [...text].map(char => font.charToGlyph(char))
  glyphs.forEach((glyph, index) => {
    const path = glyph.getPath(penX, 0, sizeMm)
    rings.push(...pathToRings(path.commands as unknown as { type: string }[]))
    penX += ((glyph.advanceWidth ?? 0) / font.unitsPerEm) * sizeMm + letterSpacing
    const next = glyphs[index + 1]
    if (next) penX += (font.getKerningValue(glyph, next) / font.unitsPerEm) * sizeMm
  })
  if (!rings.length) return []

  const nested = nestRings(rings.map(quantizeRing))

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of nested) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const dx = -(minX + maxX) / 2
  const dy = -(minY + maxY) / 2
  return nested.map(poly => poly.map(ring =>
    ring.map(([x, y]) => [x + dx, y + dy] as const)))
}

/**
 * Outlines for one text object as a flat list of contours, for the 2D canvas
 * (which fills them with `fill-rule: evenodd`). Counters come back as their own
 * contours -- see `traceTextPolys`, which keeps the nesting the mesher needs.
 */
export function textOutlines(font: Font, object: TextObject): Contour[] {
  const polys = traceTextPolys(font, object.text, object.sizeMm, object.letterSpacing ?? 0)
  const out: Contour[] = []
  for (const poly of polys) for (const ring of poly) out.push(ring)
  return out
}

/** Resolve every text object in a scene to outlines, keyed by object id --
 *  the shape src/geometry/sceneShapes.ts and src/csg/fromScene.ts expect. */
export async function resolveTextOutlines(
  objects: readonly { id: string; type: string }[],
  lookup: (id: string) => TextObject | undefined,
): Promise<Map<string, Ring[]>> {
  const result = new Map<string, Ring[]>()
  const texts = objects.filter(o => o.type === 'text')
  if (!texts.length) return result

  for (const entry of texts) {
    const object = lookup(entry.id)
    if (!object) continue
    try {
      const font = await loadFont(object.fontId)
      result.set(object.id, textOutlines(font, object).map(c => c.map(([x, y]) => [x, y] as const)))
    } catch {
      // A font that will not load leaves the object with no outlines; the
      // canvas draws nothing for it rather than the whole scene failing.
    }
  }
  return result
}
