// The pictures in the build guide, as standalone SVG strings.
//
// Drawn from the same numbers as the cut drawings, with literal colours rather
// than the app's theme variables, because the guide is also downloaded and
// printed on its own. Font sizes and strokes scale with the drawing so a
// 2440 mm sheet and a 20 mm cleat both read.
import { cabinetDims } from '../model/cabinet.ts'
import type { CabinetParams } from '../model/cabinet.ts'
import { SHEET_MM } from '../model/guide.ts'
import type { ThicknessOrder } from '../model/guide.ts'
import { PANEL_DRAWINGS } from './cutDrawing.ts'
import type { PanelId } from './cutDrawing.ts'
import type { Ring } from '../../../geometry/vec.ts'

const C = {
  case: '#e8e2d6', line: '#3a3a3a', dado: '#b9b3a6', tray: '#6aa0d6', trayLine: '#2a6fb0',
  text: '#555', cleat: '#c99a5b', wall: '#8c7a62', void: '#fafafa', screw: '#2a6fb0',
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = (v: number): string => `${+v.toFixed(2)}`

interface Frame { w: number; h: number; fs: number; sw: number }

function svg(
  body: string, w: number, h: number, pad: number, alt: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}" ` +
    `role="img" aria-label="${esc(alt)}" style="max-width:100%;height:auto;max-height:420px">${body}</svg>`
}

const frame = (w: number, h: number): Frame => {
  const big = Math.max(w, h)
  return { w, h, fs: big / 45, sw: big / 700 }
}

/** A dimension line above the drawing, ticks at both ends. */
function dimAcross(x0: number, x1: number, y: number, label: string, f: Frame): string {
  const t = f.fs * 0.4
  return `<g stroke="${C.text}" stroke-width="${f.sw}" fill="${C.text}">` +
    `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
    `<line x1="${x0}" y1="${y - t}" x2="${x0}" y2="${y + t}"/><line x1="${x1}" y1="${y - t}" x2="${x1}" y2="${y + t}"/>` +
    `<text x="${(x0 + x1) / 2}" y="${y - f.fs * 0.5}" text-anchor="middle" font-size="${f.fs}" stroke="none">${esc(label)}</text></g>`
}

/** A dimension line down the left of the drawing. */
function dimDown(y0: number, y1: number, x: number, label: string, f: Frame): string {
  const t = f.fs * 0.4
  const cy = (y0 + y1) / 2
  return `<g stroke="${C.text}" stroke-width="${f.sw}" fill="${C.text}">` +
    `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>` +
    `<line x1="${x - t}" y1="${y0}" x2="${x + t}" y2="${y0}"/><line x1="${x - t}" y1="${y1}" x2="${x + t}" y2="${y1}"/>` +
    `<text x="${x - f.fs * 0.5}" y="${cy}" text-anchor="middle" font-size="${f.fs}" stroke="none" ` +
    `transform="rotate(-90 ${x - f.fs * 0.5} ${cy})">${esc(label)}</text></g>`
}

const poly = (ring: readonly (readonly number[])[], h: number, fill: string, f: Frame, dash = ''): string =>
  `<polygon points="${ring.map(([x, y]) => `${n(x)},${n(h - y)}`).join(' ')}" fill="${fill}" ` +
  `stroke="${C.line}" stroke-width="${f.sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`

/** One panel as the router sees it: pockets shaded, screw marks, overall size. */
export function panelSvg(panel: PanelId, p: CabinetParams, f: (mm: number) => string): string {
  const drawing = PANEL_DRAWINGS[panel](p)
  const outline = drawing.layers.find(l => l.cutType === 'exterior')?.polygons.flat() ?? []
  const xs = outline.flatMap(r => r.map(pt => pt[0]))
  const ys = outline.flatMap(r => r.map(pt => pt[1]))
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
  const fr = frame(w, h)
  const shift = (r: Ring): Ring => r.map(([x, y]) => [x - x0, y - y0] as [number, number])
  const body =
    outline.map(r => poly(shift(r), h, C.case, fr)).join('') +
    drawing.layers.filter(l => l.cutType === 'pocket')
      .flatMap(l => l.polygons.flat().map(r => poly(shift(r), h, C.dado, fr))).join('') +
    (drawing.guideRings ?? []).map(r => poly(shift(r), h, 'none', fr).replace(C.line, C.screw)).join('') +
    dimAcross(0, w, -fr.fs * 1.2, f(w), fr) +
    dimDown(0, h, -fr.fs * 1.4, f(h), fr)
  const note = panel === 'side' ? 'front edge left' : panel === 'top-bottom' ? 'rear edge down' : ''
  return svg(
    body + (note ? `<text x="${w / 2}" y="${h + fr.fs * 1.8}" text-anchor="middle" font-size="${fr.fs}" fill="${C.text}">${note}</text>` : ''),
    w, h + fr.fs * 2, fr.fs * 3, `${panel} panel, ${f(w)} by ${f(h)}, inner face up`)
}

/** The case head on, every slot with its tray. */
export function caseSvg(p: CabinetParams, f: (mm: number) => string): string {
  const d = cabinetDims(p)
  const w = d.overallWidthMm, h = d.overallHeightMm
  const fr = frame(w, h)
  const trays = d.dadoFloorsMm.map(floor =>
    `<rect x="${n(p.stockMm - p.dadoDepthMm + p.slideClearanceMm / 2)}" y="${n(h - floor - p.trayThicknessMm)}" ` +
    `width="${p.trayWidthMm}" height="${p.trayThicknessMm}" fill="${C.tray}" stroke="${C.trayLine}" stroke-width="${fr.sw / 2}"/>`).join('')
  const dados = d.dadoFloorsMm.map(floor =>
    [p.stockMm - p.dadoDepthMm, w - p.stockMm].map(x =>
      `<rect x="${n(x)}" y="${n(h - floor - p.dadoHeightMm)}" width="${p.dadoDepthMm}" height="${p.dadoHeightMm}" fill="${C.dado}"/>`).join('')).join('')
  const body =
    `<rect width="${w}" height="${h}" fill="${C.case}" stroke="${C.line}" stroke-width="${fr.sw}"/>` +
    `<rect x="${p.stockMm}" y="${p.stockMm}" width="${d.interiorWidthMm}" height="${d.interiorHeightMm}" fill="${C.void}" stroke="${C.line}" stroke-width="${fr.sw / 2}"/>` +
    trays + dados +
    dimAcross(0, w, -fr.fs * 1.2, f(w), fr) + dimDown(0, h, -fr.fs * 1.4, f(h), fr)
  return svg(body, w, h, fr.fs * 3, `Assembled case, ${f(w)} by ${f(h)}, ${p.trayCount} trays seated`)
}

/** The case pulled apart: sides out, top and bottom clear, the back behind. */
export function explodedSvg(p: CabinetParams): string {
  const d = cabinetDims(p)
  const t = p.stockMm
  const w = d.overallWidthMm, h = d.overallHeightMm
  const gap = Math.max(w, h) * 0.12
  const fr = frame(w + gap * 2 + gap, h + gap * 3)
  const ox = gap // sides move out by one gap
  const rect = (x: number, y: number, rw: number, rh: number, fill: string, label: string, dash = '') =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(rw)}" height="${n(rh)}" fill="${fill}" stroke="${C.line}" stroke-width="${fr.sw}"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
    (label ? `<text x="${n(x + rw / 2)}" y="${n(y + rh / 2)}" text-anchor="middle" font-size="${fr.fs}" fill="${C.text}">${esc(label)}</text>` : '')
  const backW = d.backWidthMm, backH = d.backHeightMm
  const body =
    // The back, behind everything and offset to read as further away.
    rect(ox + (w - backW) / 2 + gap * 0.5, gap * 1.5 + (h - backH) / 2 - gap * 0.5, backW, backH, 'none', '', `${fr.fs / 2} ${fr.fs / 2}`) +
    `<text x="${n(ox + w / 2 + gap * 0.5)}" y="${n(gap * 1.5 + h / 2 - gap * 0.5)}" text-anchor="middle" font-size="${fr.fs}" fill="${C.text}">Back</text>` +
    rect(0, gap * 1.5, t, h, C.case, 'Side') +
    rect(ox * 2 + w - t, gap * 1.5, t, h, C.case, 'Side') +
    rect(ox + t, 0, d.interiorWidthMm, t, C.case, 'Top') +
    rect(ox + t, gap * 3 + h - t, d.interiorWidthMm, t, C.case, 'Bottom')
  return svg(body, w + gap * 2 + gap, h + gap * 3, fr.fs * 2, 'Exploded case: two sides, top, bottom and back')
}

/** The case from the side, with the cleat halves and spacer behind the back. */
export function cleatSvg(p: CabinetParams, f: (mm: number) => string): string {
  const d = cabinetDims(p)
  const w = d.panelDepthMm, h = d.overallHeightMm
  const fr = frame(w, h)
  const c = d.cleat
  const body =
    `<rect width="${w}" height="${h}" fill="${C.case}" stroke="${C.line}" stroke-width="${fr.sw}"/>` +
    (c
      ? poly(c.caseProfile, h, C.cleat, fr) + poly(c.spacerProfile, h, C.cleat, fr) + poly(c.wallProfile, h, C.wall, fr) +
        `<text x="${w + fr.fs * 0.5}" y="${n(h - (c.caseProfile[0][1] + c.caseProfile[2][1]) / 2)}" font-size="${fr.fs}" fill="${C.text}">case cleat</text>` +
        `<text x="${w + fr.fs * 0.5}" y="${n(h - (c.wallProfile[0][1] + c.wallProfile[2][1]) / 2)}" font-size="${fr.fs}" fill="${C.text}">wall cleat</text>` +
        `<text x="${w + fr.fs * 0.5}" y="${n(h - c.spacerHeightMm / 2 - p.stockMm)}" font-size="${fr.fs}" fill="${C.text}">spacer</text>`
      : '') +
    dimAcross(0, w, -fr.fs * 1.2, f(w), fr)
  return svg(body, w + fr.fs * 8, h, fr.fs * 3, 'Side view of the case with the French cleat halves and spacer behind the back')
}

/** Every thickness's strips on full sheets, with the blanks named. */
export function breakdownSvg(order: ThicknessOrder[], f: (mm: number) => string): string {
  const { lengthMm: L, widthMm: W } = SHEET_MM
  const fr = frame(L, W)
  const gap = fr.fs * 3
  let y = 0
  let body = ''
  for (const g of order) {
    g.sheets.forEach((sheet, i) => {
      body += `<text x="0" y="${n(y - fr.fs * 0.4)}" font-size="${fr.fs}" fill="${C.text}">${f(g.thicknessMm)} plywood, sheet ${i + 1}</text>` +
        `<rect x="0" y="${n(y)}" width="${L}" height="${W}" fill="${C.void}" stroke="${C.line}" stroke-width="${fr.sw}"/>`
      for (const strip of sheet.strips) {
        for (const piece of strip.pieces) {
          body += `<rect x="${n(piece.xMm)}" y="${n(y + strip.yMm)}" width="${n(piece.lengthMm)}" height="${n(strip.widthMm)}" ` +
            `fill="${C.case}" stroke="${C.line}" stroke-width="${fr.sw}"/>`
          // Fit the name to the blank, and drop it only when it would be unreadable.
          const label = `${f(piece.lengthMm)} × ${f(strip.widthMm)}`
          const size = Math.min(
            fr.fs * 0.7, (piece.lengthMm * 0.92) / (Math.max(piece.part.length, label.length) * 0.58))
          if (size > fr.fs * 0.3 && strip.widthMm > size * 3) {
            const cx = n(piece.xMm + piece.lengthMm / 2)
            const cy = y + strip.yMm + strip.widthMm / 2
            body += `<text x="${cx}" y="${n(cy)}" text-anchor="middle" font-size="${n(size)}" fill="${C.text}">${esc(piece.part)}</text>` +
              `<text x="${cx}" y="${n(cy + size * 1.2)}" text-anchor="middle" font-size="${n(size * 0.85)}" fill="${C.text}">${esc(label)}</text>`
          }
        }
      }
      y += W + gap * 2
    })
  }
  const total = Math.max(0, y - gap * 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-fr.fs} ${-fr.fs * 2} ${L + fr.fs * 2} ${total + fr.fs * 3}" ` +
    `role="img" aria-label="Plywood sheets with the blanks laid out" style="max-width:100%;height:auto">${body}</svg>`
}
