// The drawing set, built from the same geometry the STLs come from.
//
// It exists because the sheets kept drifting from the parts. Twice the picture
// disagreed with the STL -- once the boss width, once a detail drawn about x=0
// when the rail is centred on the boss -- and both times every geometry test
// still passed, because the tests check the parts and the drawings were a
// separate hand-made thing. So the drawings are generated now, and
// `auditDrawings` is run over the result by `drawings.test.ts`.
//
// Pure: no Node APIs, so it lives under src/ where the test globs reach it.
// `scripts/build-rack-drawings.ts` is the CLI that writes the file.
import type { MultiPolygon } from '../geometry/vec.ts'
import { checkManifold } from '../geometry/mesh.ts'
import type { RackConfig } from './config.ts'
import { derive, seamTabCentres } from './config.ts'
import type { PieceKind, PieceSpec } from './geometry.ts'
import {
  buildPiece, crossSectionAt, originShiftFor, pieceList, pieceName, seamOutline, shelfOpenings,
  stackLayout,
} from './geometry.ts'

/** A projector from drawing units into SVG pixels. */
type Pt = (a: number, b: number) => [number, number]

interface Geom {
  centres: number[]
  section: Record<PieceKind, { plain: { left: MultiPolygon; right: MultiPolygon } }>
  plan: { tab: [number, number][]; cavity: [number, number][] }
  pieces: { file: string; qty: number; w: number; h: number; dep: number; cm3: number }[]
}

export function buildDrawings(cfg: RackConfig): string {
  const C = cfg
  const D = derive(cfg)
  const L = stackLayout(cfg)

  const shiftBack = (mp: MultiPolygon, spec: PieceSpec): MultiPolygon => {
    const dx = -originShiftFor(cfg, spec)
    return mp.map(p => p.map(ring => ring.map(([x, y]) => [x + dx, y] as const)))
  }
  const frame = (kind: PieceKind, side: 'left' | 'right', z: number): MultiPolygon =>
    shiftBack(crossSectionAt(cfg, { kind, side }, z), { kind, side })

  const plainZ = C.backLipDepthMm + 16   // clear of both the lip bands and every tab
  const seamAt = (inflate: number): [number, number][] => seamOutline(cfg, inflate)

  const qty = new Map<string, number>()
  for (const s of pieceList(cfg)) qty.set(pieceName(s), (qty.get(pieceName(s)) ?? 0) + 1)
  const seen = new Set<string>()
  const pieceStats: Geom['pieces'] = []
  for (const s of pieceList(cfg)) {
    const n = pieceName(s)
    if (seen.has(n)) continue
    seen.add(n)
    const bb = buildPiece(cfg, s).mesh.bbox
    pieceStats.push({
      file: `rack_${n}.stl`, qty: qty.get(n) ?? 1,
      w: +(bb[3] - bb[0]).toFixed(1), h: +(bb[4] - bb[1]).toFixed(1), dep: +(bb[5] - bb[2]).toFixed(1),
      cm3: Math.round(checkManifold(buildPiece(cfg, s).mesh).volume / 1000),
    })
  }

  const J: Geom = {
    centres: seamTabCentres(cfg, D),
    section: {
      bottom: { plain: { left: frame('bottom', 'left', plainZ), right: frame('bottom', 'right', plainZ) } },
      middle: { plain: { left: frame('middle', 'left', plainZ), right: frame('middle', 'right', plainZ) } },
      top: { plain: { left: frame('top', 'left', plainZ), right: frame('top', 'right', plainZ) } },
    },
    plan: { tab: seamAt(0), cavity: seamAt(C.fitMm) },
    pieces: pieceStats,
  }

  const f = (n: number): string => String(+(+n).toFixed(2))

  /* ---------- svg helpers (all coords pre-transformed to px: constant strokes) ---------- */
  const pathOf = (mp: MultiPolygon, P: Pt): string => mp.map(poly => poly.map(ring => {
    const pts = ring.map(([x, y]) => { const [a, b] = P(x, y); return `${f(a)},${f(b)}` })
    return 'M' + pts.join('L') + 'Z'
  }).join('')).join('')

  const solid = (mp: MultiPolygon, P: Pt, cls = 'part'): string => `<path class="${cls}" d="${pathOf(mp, P)}"/>`

  // dimension line with slash ticks, label riding on it
  function dimH(x0: number, x1: number, y: number, label: string, cls = 'dim'): string {
    const t = 3.2
    return `<g class="${cls}">
      <line x1="${f(x0)}" y1="${f(y)}" x2="${f(x1)}" y2="${f(y)}"/>
      <line x1="${f(x0 - t)}" y1="${f(y + t)}" x2="${f(x0 + t)}" y2="${f(y - t)}"/>
      <line x1="${f(x1 - t)}" y1="${f(y + t)}" x2="${f(x1 + t)}" y2="${f(y - t)}"/>
      <text class="dimtext" x="${f((x0 + x1) / 2)}" y="${f(y - 5)}" text-anchor="middle">${label}</text>
    </g>`
  }
  function dimV(y0: number, y1: number, x: number, label: string, cls = 'dim'): string {
    const t = 3.2
    return `<g class="${cls}">
      <line x1="${f(x)}" y1="${f(y0)}" x2="${f(x)}" y2="${f(y1)}"/>
      <line x1="${f(x - t)}" y1="${f(y0 + t)}" x2="${f(x + t)}" y2="${f(y0 - t)}"/>
      <line x1="${f(x - t)}" y1="${f(y1 + t)}" x2="${f(x + t)}" y2="${f(y1 - t)}"/>
      <text class="dimtext" x="${f(x - 4)}" y="${f((y0 + y1) / 2)}" text-anchor="middle"
        transform="rotate(-90 ${f(x - 4)} ${f((y0 + y1) / 2)})">${label}</text>
    </g>`
  }
  const ext = (x0: number, y0: number, x1: number, y1: number): string => `<line class="ext" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}"/>`

  /* ================= SHEET 1 — front elevation, 6 bays ================= */
  function sheetElevation() {
    const s = 0.92
    const X0 = -C.bossOutMm, X1 = D.rackWidthMm + C.bossOutMm, YT = L.totalHeightMm
    const ox = 132, oy = 32
    const P = (x: number, y: number): [number, number] => [ox + (x - X0) * s, oy + (YT - y) * s]
    const W = ox + (X1 - X0) * s + 118
    const H = oy + YT * s + 46
    const out: string[] = []

    // bays: case silhouettes
    for (const [i, bay] of L.bays.entries()) {
      const [ax, ay] = P(C.wallMm + C.clearSideMm, bay.floorTopY + C.caseHeightMm)
      const [bx, by] = P(D.rackWidthMm - C.wallMm - C.clearSideMm, bay.floorTopY)
      out.push(`<rect class="case" x="${f(ax)}" y="${f(ay)}" width="${f(bx - ax)}" height="${f(by - ay)}"/>`)
      out.push(`<text class="caselbl" x="${f((ax + bx) / 2)}" y="${f((ay + by) / 2 + 3.5)}" text-anchor="middle">S76 · bay ${i + 1}</text>`)
    }
    // courses
    for (const [i, course] of L.courses.entries()) {
      const sec = J.section[course.kind].plain
      const Q = (x: number, y: number): [number, number] => P(x, y + course.baseY)
      out.push(solid(sec.left, Q))
      out.push(solid(sec.right, Q))
      if (i > 0) {
        const [lx, ly] = P(X0, course.baseY)
        const [rx] = P(X1, course.baseY)
        out.push(`<line class="seam" x1="${f(lx)}" y1="${f(ly)}" x2="${f(rx)}" y2="${f(ly)}"/>`)
      }
      const [tx, ty] = P(X0, course.baseY + course.height / 2)
      out.push(`<text class="course" x="${f(tx - 8)}" y="${f(ty + 3)}" text-anchor="end">${course.kind === 'middle' ? 'MIDDLE' : course.kind === 'bottom' ? 'BOTTOM CAP' : 'TOP CAP'}</text>`)
    }
    // centre seam
    const [cx, cy0] = P(D.halfWidthMm, YT), [, cy1] = P(D.halfWidthMm, 0)
    out.push(`<line class="centre" x1="${f(cx)}" y1="${f(cy0 - 14)}" x2="${f(cx)}" y2="${f(cy1 + 14)}"/>`)
    out.push(`<text class="note" x="${f(cx)}" y="${f(cy0 - 18)}" text-anchor="middle">CENTRE SEAM</text>`)

    // dimensions
    const [, yTop] = P(0, YT), [, yBot] = P(0, 0)
    const [xL] = P(X0, 0)
    out.push(dimV(yTop, yBot, xL - 96, `${f(YT)} overall`))
    const b0 = L.bays[0], b1 = L.bays[1]
    out.push(dimV(P(0, b1.floorTopY)[1], P(0, b0.floorTopY)[1], xL - 60, `${f(D.pitchMm)} pitch`))
    out.push(dimV(P(0, b0.ceilingY)[1], P(0, b0.floorTopY)[1], xL - 26, `${f(D.bayClearMm)} clear`))
    const [xR] = P(X1, 0)
    const bt = L.bays[L.bays.length - 1]
    out.push(dimV(P(0, bt.ceilingY)[1], P(0, bt.floorTopY)[1], xR + 30, `${f(C.caseHeightMm)} case + ${f(C.clearTopMm)}`))
    out.push(dimV(P(0, L.courses[0].height)[1], P(0, 0)[1], xR + 74, `${f(D.capHeightMm)} cap`))
    const [wx0, wy] = P(0, 0), [wx1] = P(D.rackWidthMm, 0)
    out.push(ext(wx0, wy, wx0, wy + 30), ext(wx1, wy, wx1, wy + 30))
    out.push(dimH(wx0, wx1, wy + 26, `${f(D.rackWidthMm)} outside`))
    const [hx] = P(D.halfWidthMm, 0)
    out.push(ext(hx, wy, hx, wy + 46))
    out.push(dimH(wx0, hx, wy + 42, `${f(D.halfWidthMm)}`))
    out.push(dimH(hx, wx1, wy + 42, `${f(D.halfWidthMm)}`))

    return { svg: `<svg viewBox="0 0 ${f(W)} ${f(H)}" role="img" aria-label="Front elevation of the six-bay rack: bottom cap, five middle courses and a top cap, every bay 79 mm clear at an 82.2 mm pitch.">${out.join('')}</svg>` }
  }

  /* ================= SHEET 2 — the three piece sections ================= */
  function sheetSections() {
    const s = 1.32
    const X0 = -C.bossOutMm, X1 = D.rackWidthMm + C.bossOutMm
    const kinds: [PieceKind, string, string][] = [['bottom', 'BOTTOM CAP', 'floor of bay 1 · no socket underneath'],
                   ['middle', 'MIDDLE (x' + (C.bays - 1) + ')', 'ceiling of one bay, floor of the next'],
                   ['top', 'TOP CAP', 'ceiling only · no rail on top']]
    const ox = 58, gap = 46
    let y = 24
    const out: string[] = []
    const heights = kinds.map(([k]) => J.section[k].plain.left.flat(2).reduce((m, p) => Math.max(m, p[1]), 0))
    for (const [i, [kind, label, sub]] of kinds.entries()) {
      const h = heights[i]
      const P = (x: number, yy: number): [number, number] => [ox + (x - X0) * s, y + (h - yy) * s]
      const sec = J.section[kind].plain
      out.push(`<text class="secttl" x="${f(ox)}" y="${f(y - 8)}">${label}</text>`)
      out.push(`<text class="subttl" x="${f(ox + 128)}" y="${f(y - 8)}">${sub}</text>`)
      out.push(solid(sec.left, P))
      out.push(solid(sec.right, P))
      const [cx, cy0] = P(D.halfWidthMm, h), [, cy1] = P(D.halfWidthMm, 0)
      out.push(`<line class="centre" x1="${f(cx)}" y1="${f(cy0 - 6)}" x2="${f(cx)}" y2="${f(cy1 + 6)}"/>`)
      const [dx, dy0] = P(X0, h)
      out.push(dimV(dy0, P(0, 0)[1], dx - 26, `${f(h)}`))
      y += h * s + gap
    }
    const W = ox + (X1 - X0) * s + 40
    return { svg: `<svg viewBox="0 0 ${f(W)} ${f(y - gap + 30)}" role="img" aria-label="Cross-sections of the three piece kinds, each a side wall plus half a shelf, drawn at the centre seam.">${out.join('')}</svg>` }
  }

  /* ================= SHEET 3 — shelf plan, seam tabs ================= */
  function sheetPlan() {
    const s = 1.18
    const ox = 46, oy = 30
    const P = (x: number, z: number): [number, number] => [ox + x * s, oy + z * s]
    const out: string[] = []
    const W = ox + D.rackWidthMm * s + 178, H = oy + D.rackDepthMm * s + 54

    // left half outline: plate 0..half plus tabs; right half: half..W minus cavity
    const tab = J.plan.tab, cav = J.plan.cavity
    const chain = (pts: [number, number][]): string => pts.map(([x, z]) => { const [a, b] = P(x, z); return `${f(a)},${f(b)}` }).join(' ')
    const [x0, z0] = P(0, 0), [, z1] = P(0, D.rackDepthMm)
    out.push(`<polygon class="part" points="${f(x0)},${f(z0)} ${chain(tab)} ${f(x0)},${f(z1)}"/>`)
    const [xw] = P(D.rackWidthMm, 0)
    out.push(`<polygon class="part alt" points="${f(xw)},${f(z0)} ${chain(cav)} ${f(xw)},${f(z1)}"/>`)

    // the waffle: openings on both halves
    for (const side of ['left', 'right'] as const) {
      for (const o of shelfOpenings(C, { kind: 'middle', side })) {
        const [ax, az] = P(o.x0, o.z0), [bx, bz] = P(o.x1, o.z1)
        out.push(`<rect class="void" x="${f(ax)}" y="${f(az)}" width="${f(bx - ax)}" height="${f(bz - az)}"/>`)
      }
    }

    // lip bands
    const [, lb] = P(0, C.backLipDepthMm)
    out.push(`<line class="hidden" x1="${f(x0)}" y1="${f(lb)}" x2="${f(xw)}" y2="${f(lb)}"/>`)
    out.push(`<text class="note" x="${f(xw + 6)}" y="${f(lb + 3)}">back stop ${f(C.backLipHeightMm)} high</text>`)
    const [, fb] = P(0, D.rackDepthMm - C.frontLipDepthMm)
    out.push(`<line class="hidden" x1="${f(x0)}" y1="${f(fb)}" x2="${f(xw)}" y2="${f(fb)}"/>`)
    out.push(`<text class="note" x="${f(xw + 6)}" y="${f(fb + 3)}">front retainer ${f(C.frontLipHeightMm)}</text>`)

    for (const zc of J.centres) {
      const [tx, tz] = P(D.halfWidthMm + C.seamTabReachMm + 3, zc)
      out.push(`<text class="jointlbl" x="${f(tx)}" y="${f(tz + 3)}">tab</text>`)
    }
    out.push(`<text class="note" x="${f(P(4, 0)[0])}" y="${f(oy - 10)}">BACK</text>`)
    out.push(`<text class="note" x="${f(P(4, 0)[0])}" y="${f(oy + D.rackDepthMm * s + 16)}">FRONT — cases slide out this way</text>`)
    out.push(dimV(P(0, 0)[1], P(0, D.rackDepthMm)[1], ox - 22, `${f(D.rackDepthMm)} deep`))
    out.push(`<text class="secttl" x="${f(P(20, 0)[0])}" y="${f(P(0, 40)[1])}">LEFT HALF</text>`)
    out.push(`<text class="secttl alt" x="${f(P(180, 0)[0])}" y="${f(P(0, 40)[1])}">RIGHT HALF</text>`)
    return { svg: `<svg viewBox="0 0 ${f(W)} ${f(H)}" role="img" aria-label="Plan of one shelf: three flared tabs on the left half cross the centre seam into matching slots in the right half.">${out.join('')}</svg>` }
  }

  /* ================= SHEET 4 — joint details ================= */
  function detailCourse() {
    // The rail is centred on the BOSS, which spans -bossOut..wallMm -- so its
    // centre is not x=0. Drawing it at 0 put a fat leg on one side and a sliver
    // on the other and made both 1.65 dimensions span the wrong distance.
    const s = 13
    const bo = C.bossOutMm, w = C.wallMm, r = C.railHeightMm, fit = C.fitMm
    const n = C.railNeckMm / 2, hd = C.railHeadMm / 2
    const cx = (-bo + w) / 2
    const oy = 34, ox = 122, ox2 = 336
    const P = (x: number, y: number): [number, number] => [ox + (x - cx) * s, oy + (10 - y) * s]
    const Q = (x: number, y: number): [number, number] => [ox2 + (x - cx) * s, oy + (10 - y) * s]
    const pts = (ring: number[][], M: Pt): string => ring.map(([x, y]) => M(x, y).map(f).join(',')).join(' ')
    const out: string[] = []

    // lower course: boss with the tongue standing on it
    const tongue = [[-bo, -2], [w, -2], [w, 0], [cx + n, 0], [cx + hd, r], [cx - hd, r], [cx - n, 0], [-bo, 0]]
    out.push(`<polygon class="part" points="${pts(tongue, P)}"/>`)
    out.push(dimH(P(cx - hd, 0)[0], P(cx + hd, 0)[0], P(0, r)[1] - 10, `${f(C.railHeadMm)} head`))
    out.push(dimH(P(cx - n, 0)[0], P(cx + n, 0)[0], P(0, 0)[1] + 16, `${f(C.railNeckMm)} neck`))
    out.push(dimV(P(0, r)[1], P(0, 0)[1], P(cx - hd, 0)[0] - 20, `${f(C.railHeightMm)}`))

    // upper course: the same boss with the socket cut up into it
    const sock = [[-bo, 0], [cx - n - fit, 0], [cx - hd - fit, r], [cx + hd + fit, r],
                  [cx + n + fit, 0], [w, 0], [w, r + 2], [-bo, r + 2]]
    out.push(`<polygon class="part alt" points="${pts(sock, Q)}"/>`)
    const dy = Q(0, r + 2)[1] - 12
    out.push(dimH(Q(-bo, 0)[0], Q(cx - hd - fit, 0)[0], dy, `${f(D.socketWallMm)}`))
    out.push(dimH(Q(cx + hd + fit, 0)[0], Q(w, 0)[0], dy, `${f(D.socketWallMm)}`))
    out.push(`<text class="jointlbl" x="${f(Q(cx, 0)[0])}" y="${f(dy - 18)}" text-anchor="middle">+${f(fit)} all round</text>`)

    const titleY = P(0, -2.6)[1] + 12
    out.push(`<text class="secttl" x="${f(P(-bo, 0)[0])}" y="${f(titleY)}">LOWER COURSE — tongue</text>`)
    out.push(`<text class="secttl alt" x="${f(Q(-bo, 0)[0])}" y="${f(titleY)}">UPPER COURSE — socket</text>`)
    out.push(`<text class="note" x="${f(Q(cx, 0)[0])}" y="${f(titleY + 16)}" text-anchor="middle">${(D.socketWallMm / 0.4).toFixed(1)} extrusion lines each side</text>`)

    return `<svg viewBox="0 0 448 232" role="img" aria-label="Course dovetail at ten to one: a tongue 4.4 mm at the neck flaring to 6 mm at the head, centred on a 9.6 mm boss that leaves 1.65 mm of wall each side of the socket.">${out.join('')}</svg>`
  }

  function detailTab() {
    const s = 4.6
    const zc = J.centres[1]!
    const neck = C.seamTabRootMm / 2, reach = C.seamTabReachMm, fit = C.fitMm
    const span = neck + reach + 8
    const ox = 70, oy = 26
    const P = (x: number, z: number): [number, number] =>
      [ox + (x - (D.halfWidthMm - 16)) * s, oy + (z - (zc - span)) * s]
    const out: string[] = []
    const hw = D.halfWidthMm
    const chain = (pts: [number, number][]): string =>
      pts.map(([x, z]) => P(x, z).map(f).join(',')).join(' ')

    // left half: plate edge with one tab hanging off it, doubling back
    const left: [number, number][] = [
      [hw - 16, zc - span], [hw, zc - span], [hw, zc - neck],
      [hw + reach, zc - neck - reach], [hw + reach, zc + neck + reach],
      [hw, zc + neck], [hw, zc + span], [hw - 16, zc + span],
    ]
    out.push(`<polygon class="part" points="${chain(left)}"/>`)
    // right half: the same shape grown by the fit, cut out of its plate
    const n2 = neck + fit, r2 = reach + fit
    const right: [number, number][] = [
      [hw + 40, zc - span], [hw, zc - span], [hw, zc - n2],
      [hw + r2, zc - n2 - r2], [hw + r2, zc + n2 + r2],
      [hw, zc + n2], [hw, zc + span], [hw + 40, zc + span],
    ]
    out.push(`<polygon class="part alt" points="${chain(right)}"/>`)

    out.push(dimH(P(hw, 0)[0], P(hw + reach, 0)[0], P(0, zc + span)[1] + 22, `${f(reach)} reach`))
    out.push(dimV(P(0, zc - neck)[1], P(0, zc + neck)[1], P(hw - 4, 0)[0], `${f(C.seamTabRootMm)} neck`))
    out.push(dimV(P(0, zc - neck - reach)[1], P(0, zc + neck + reach)[1], P(hw + reach + 5, 0)[0],
      `${f(2 * (neck + reach))} head`))
    out.push(`<text class="jointlbl" x="${f(P(hw + 2, 0)[0])}" y="${f(oy - 10)}">head wider than neck — it cannot pull out</text>`)
    return `<svg viewBox="0 0 ${f(ox + 62 * s + 60)} ${f(oy + 2 * span * s + 42)}" role="img" aria-label="One seam tab in plan at four to one: a 16 mm neck opening to a 40 mm head 12 mm past the seam, so the head cannot withdraw through the neck.">${out.join('')}</svg>`
  }

  /* ================= SHEET 5 — print orientation ================= */
  function sheetPrint() {
    const s = 0.78, dep = D.rackDepthMm
    const H = D.middleHeightMm, half = D.halfWidthMm, w = C.wallMm, p0 = D.bayClearMm / 2, p1 = p0 + C.shelfMm
    const L8 = [[0, 0], [w, 0], [w, p0], [half, p0], [half, p1], [w, p1], [w, H], [0, H]]
    const cos30 = Math.cos(Math.PI / 6), sin30 = 0.5
    const ox = 170, oy = 290
    const iso = (x: number, y: number, z: number): [number, number] => [ox + (x - y) * cos30 * s, oy + (x + y) * sin30 * s - z * s]
    const out: string[] = []
    const face = (z: number): string => L8.map(([x, y]) => iso(x, y, z).map(f).join(',')).join(' ')
    // bed
    const bed = [[-30, -30], [200, -30], [200, 120], [-30, 120]].map(([x, y]) => iso(x, y, 0).map(f).join(',')).join(' ')
    out.push(`<polygon class="bed" points="${bed}"/>`)
    out.push(`<text class="note" x="${f(iso(180, 110, 0)[0])}" y="${f(iso(180, 110, 0)[1])}">build plate</text>`)
    out.push(`<polygon class="ghost" points="${face(0)}"/>`)
    for (const [x, y] of L8) {
      const a = iso(x, y, 0), b = iso(x, y, dep)
      out.push(`<line class="riser" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`)
    }
    out.push(`<polygon class="part" points="${face(dep)}"/>`)
    // layer arrow
    const a0 = iso(half + 26, 0, 0), a1 = iso(half + 26, 0, dep)
    out.push(`<line class="arrow" x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}" marker-end="url(#ah)"/>`)
    out.push(`<text class="jointlbl" x="${f((a0[0] + a1[0]) / 2 + 10)}" y="${f((a0[1] + a1[1]) / 2)}">${f(dep)} mm of identical layers</text>`)
    const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`
    return `<svg viewBox="0 0 484 452" role="img" aria-label="A middle piece stood on its back face on the build plate, extruded 182 mm as one unchanging L-shaped cross-section.">${defs}${out.join('')}</svg>`
  }

  /* ================= assemble ================= */
  const elev = sheetElevation(), sect = sheetSections(), plan = sheetPlan()
  const pieces: [string, number, number, number, number][] =
      J.pieces.map(p => [p.file, p.qty, p.w, p.h, p.cm3])
  const totalCm3 = pieces.reduce((t, p) => t + p[1] * p[4], 0)

  const skelOpenings = shelfOpenings(C, { kind: 'middle', side: 'left' })
  const openingW = skelOpenings.length ? skelOpenings[0]!.x1 - skelOpenings[0]!.x0 : 0

  const schedule: [string, string, string][] = [
    ['Case, feet included', `${C.caseWidthMm} × ${C.caseDepthMm} × ${C.caseHeightMm}`, 'caliper-verified'],
    ['Bay pitch', f(D.pitchMm), `${C.caseHeightMm} + ${f(C.clearTopMm)} headroom + ${f(C.shelfMm)} shelf`],
    ['Bay clear opening', f(D.bayClearMm), 'floor top to ceiling'],
    ['Rack outside width', f(D.rackWidthMm), `case + ${f(C.clearSideMm)}/side + ${f(C.wallMm)} walls`],
    ['Rack depth', f(D.rackDepthMm), 'also the print height'],
    ['Overall height, 6 bays', f(L.totalHeightMm), `2 caps + ${C.bays - 1} middles`],
    ['Middle piece', `${f(D.middleHeightMm)} tall`, 'sketch said 76 — that was the case'],
    ['Cap piece', `${f(D.capHeightMm)} tall`, 'sketch said 38'],
    ['Shelf / wall', `${f(C.shelfMm)} / ${f(C.wallMm)}`, '8 lines at a 0.4 nozzle'],
    ['Fit clearance', f(C.fitMm), 'every mating feature'],
    ['Joint boss', f(C.wallMm + C.bossOutMm), `wall ${f(C.wallMm)} swelled outward ${f(C.bossOutMm)}`],
    ['Wall beside socket', f(D.socketWallMm), `${(D.socketWallMm / 0.4).toFixed(1)} lines — what carries the stack`],
  ]

  const css = `
  :root{
    --paper:#F1F2EF; --sheet:#FBFBF9; --ink:#101519; --soft:#59635E; --rule:#8B948F;
    --faint:#DBDED7; --joint:#0E7C6B; --flag:#B4530A; --case:#C9CEC7; --line:#CDD2CA;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){--paper:#0D1113; --sheet:#141A1B; --ink:#E7EBE6; --soft:#95A09A;
    --rule:#5A645E; --faint:#232B29; --joint:#3ACCB4; --flag:#E5A24A; --case:#2A3331; --line:#2C3634;}
  }
  :root[data-theme="dark"]{--paper:#0D1113; --sheet:#141A1B; --ink:#E7EBE6; --soft:#95A09A; --rule:#5A645E;
    --faint:#232B29; --joint:#3ACCB4; --flag:#E5A24A; --case:#2A3331; --line:#2C3634;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font-family:Archivo,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.6;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding-block:32px;padding-left:20px;padding-right:20px;
    display:flex;flex-direction:column;gap:30px}
  h1,h2,h3{margin:0;text-wrap:balance;font-weight:650;letter-spacing:-.015em}
  h1{font-size:clamp(28px,5vw,42px);line-height:1.08}
  h2{font-size:20px}
  .mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
  .eyebrow{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--soft)}

  /* title block — a real drawing sheet has one */
  .titleblock{border:1.5px solid var(--ink);background:var(--sheet)}
  .titleblock .top{padding:22px 24px 18px;border-bottom:1.5px solid var(--ink)}
  .titleblock .lede{margin:10px 0 0;max-width:62ch;color:var(--soft)}
  .tbgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  .tbcell{padding:12px 16px;border-right:1px solid var(--line);border-top:0}
  .tbcell:last-child{border-right:0}
  .tbcell dt{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--soft);margin:0}
  .tbcell dd{margin:3px 0 0;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}

  .sheet{border:1px solid var(--line);background:var(--sheet)}
  .sheethead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;
    padding:14px 20px;border-bottom:1px solid var(--line)}
  .sheetno{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.1em;
    color:var(--paper);background:var(--ink);padding:3px 7px;border-radius:2px}
  .sheetbody{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:26px;padding:20px}
  @media (max-width:820px){.sheetbody{grid-template-columns:minmax(0,1fr)}}
  .drawing{overflow-x:auto}
  .drawing svg{max-width:100%;height:auto;display:block;color:var(--ink)}
  .notes{font-size:14px;color:var(--soft);display:flex;flex-direction:column;gap:12px}
  .notes p{margin:0}
  .notes strong{color:var(--ink);font-weight:620}
  figure{margin:0}
  figcaption{margin-top:10px;font-size:13px;color:var(--soft);max-width:66ch}

  /* svg classes */
  .part{fill:var(--faint);stroke:var(--ink);stroke-width:1.1;stroke-linejoin:round}
  .part.alt{fill:var(--faint);stroke:var(--joint);stroke-width:1.1}
  polygon.part.alt,path.part.alt{stroke:var(--joint)}
  .case{fill:var(--case);stroke:var(--rule);stroke-width:.8;stroke-dasharray:4 3}
.void{fill:var(--paper);stroke:var(--rule);stroke-width:.7}
  .caselbl{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9px;fill:var(--soft)}
  .seam{stroke:var(--joint);stroke-width:1;stroke-dasharray:7 4}
  .centre{stroke:var(--joint);stroke-width:.9;stroke-dasharray:9 3 2 3}
  .hidden{stroke:var(--rule);stroke-width:.7;stroke-dasharray:5 3}
  .dim line{stroke:var(--rule);stroke-width:.8}
  .ext{stroke:var(--rule);stroke-width:.6;stroke-dasharray:2 2}
  .dimtext{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;fill:var(--ink)}
  .course{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;
    letter-spacing:.09em;fill:var(--soft)}
  .secttl{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.1em;fill:var(--ink)}
  .secttl.alt{fill:var(--joint)}
  .subttl{font-size:11px;fill:var(--soft)}
  .note{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;fill:var(--soft)}
  .jointlbl{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;fill:var(--joint)}
  .bed{fill:none;stroke:var(--rule);stroke-width:.9;stroke-dasharray:6 4}
  .ghost{fill:none;stroke:var(--rule);stroke-width:.7}
  .riser{stroke:var(--line);stroke-width:.8}
  .arrow{stroke:var(--joint);stroke-width:1.3;color:var(--joint)}

  table{border-collapse:collapse;width:100%;font-size:14px}
  th{text-align:left;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;
    letter-spacing:.11em;text-transform:uppercase;color:var(--soft);font-weight:500;
    padding:0 12px 8px 0;border-bottom:1px solid var(--line)}
  td{padding:8px 12px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}
  td.num{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.why{color:var(--soft);font-size:13px}
  tr:last-child td{border-bottom:0}

  .flag{border-left:3px solid var(--flag);padding:14px 18px;background:var(--sheet)}
  .flag h3{font-size:15px;color:var(--flag);margin-bottom:4px}
  .decisions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
  .dec{border:1px solid var(--line);background:var(--sheet);padding:16px 18px}
  .dec h3{font-size:15px;margin-bottom:6px}
  .dec p{margin:0;font-size:14px;color:var(--soft)}
  .dec .opt{margin-top:10px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;color:var(--ink)}
  footer{color:var(--soft);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `

  const html = `<title>S76 Rack Drawing Set</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
  <style>${css}</style>
  <div class="wrap">

  <div class="titleblock">
    <div class="top">
      <p class="eyebrow">Shop drawings · generated from src/rack/geometry.ts</p>
      <h1>Systainer3 S76 modular rack</h1>
      <p class="lede">A ${C.bays}-bay wall rack in ${pieces.reduce((t, p) => t + p[1], 0)} printed pieces, split down the middle because a 265&nbsp;mm case
        is wider than the X2D's 256&nbsp;mm plate. Every joint is printed — no bolts, no inserts, no glue.</p>
    </div>
    <dl class="tbgrid">
      <div class="tbcell"><dt>Bay pitch</dt><dd>${f(D.pitchMm)} mm</dd></div>
      <div class="tbcell"><dt>Overall</dt><dd>${f(D.rackWidthMm)} × ${f(D.rackDepthMm)} × ${f(L.totalHeightMm)}</dd></div>
      <div class="tbcell"><dt>Pieces</dt><dd>${pieces.reduce((t, p) => t + p[1], 0)} · ${pieces.length} distinct</dd></div>
      <div class="tbcell"><dt>Material</dt><dd>~${(totalCm3 / 1000 * 1.24).toFixed(2)} kg PLA</dd></div>
      <div class="tbcell"><dt>Units</dt><dd>mm</dd></div>
    </dl>
  </div>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 1</span><h2>Front elevation</h2>
      <span class="eyebrow">${C.bays} bays · scale ≈ 1:1.1</span></div>
    <div class="sheetbody">
      <figure class="drawing">${elev.svg}
        <figcaption>Every horizontal seam falls at mid-bay, in the side wall — never at a shelf. That is the one
          thing the original sketch already had right, and it is kept verbatim.</figcaption></figure>
      <div class="notes">
        <p><strong>Courses.</strong> Bottom cap + ${C.bays - 1} middles + top cap = ${C.bays} bays.
           Add a bay by adding one middle course; the caps never change.</p>
        <p><strong>The one change from the sketch.</strong> It marked the middle piece 76 and the caps 38.
           76 is the <em>case</em>; the shelf and its headroom need their own ${f(C.shelfMm + C.clearTopMm)} mm.
           Middles are ${f(D.middleHeightMm)}, caps ${f(D.capHeightMm)}.</p>
        <p><strong>Teal marks every mating feature</strong> on all five sheets.</p>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 2</span><h2>Piece sections</h2>
      <span class="eyebrow">at the centre seam · scale ≈ 1.3:1</span></div>
    <div class="sheetbody">
      <figure class="drawing">${sect.svg}
        <figcaption>Each piece is a side wall plus half a shelf. The three kinds differ in one number —
          where the plate sits in the piece's height — which is why one generator makes all of them.</figcaption></figure>
      <div class="notes">
        <p><strong>The boss.</strong> The wall swells from ${f(C.wallMm)} to ${f(C.wallMm + C.bossOutMm)} mm over the
           top and bottom ${f(C.bossHeightMm)} mm — sized so ${f(D.socketWallMm)} mm of wall survives beside the socket.
           A ${f(C.wallMm)} mm wall is too thin to hold a dovetail that carries tension, and the swell goes
           <em>outward</em> so it costs no bay width.</p>
        <p><strong>Lips.</strong> Only a plate that is a floor carries them. The top cap is a ceiling, so it has none.</p>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 3</span><h2>Shelf plan — the centre seam</h2>
      <span class="eyebrow">one course · scale ≈ 1.2:1</span></div>
    <div class="sheetbody">
      <figure class="drawing">${plan.svg}
        <figcaption>${C.seamTabs} flared tabs carry the left half across the seam into slots in the right half.
          The seam sits at mid-span, where a plain butt joint would act as a hinge and let the shelf sag into a V.</figcaption></figure>
      <div class="notes">
        <p><strong>How it goes together.</strong> The tabs are undercut, so they can only be assembled along the axis
           they are constant in — the height. You <em>drop</em> the right half onto the left.</p>
        <p><strong>What it locks.</strong> Sideways and fore-and-aft — everything in the plane of the shelf,
           which is where bending puts the seam in tension. The head is ${f(2 * (C.seamTabRootMm / 2 + C.seamTabReachMm))} mm
           across and the neck ${f(C.seamTabRootMm)} mm, so it cannot withdraw.</p>
        <p><strong>What it does NOT lock: straight up.</strong> An undercut can only be assembled along the
           axis it is constant in, so the one direction that lets the halves go together is also the one
           nothing in the rack resists. The <em>mount</em> resists it: both towers seat on one continuous
           cleat, or on one floor. In service the load only ever pushes the seam down.</p>
        <p><strong>Why a grid and not slots.</strong> Depth is the print axis, so every opening ends in a bridge —
           the rib above it arrives in one layer. The grid holds each bridge to ${f(openingW)} mm. Ribs running
           only front-to-back would need no bridge at all, but would leave the shelf nearly hollow across a slot's
           width, which is exactly where it carries the case.</p>
        <p><strong>The seam frame is ${f(D.seamFrameMm)} mm</strong> — wider than the ${f(C.shelfFrameMm)} mm frame
           elsewhere, because the tab cavity is cut ${f(C.seamTabReachMm + C.fitMm)} mm into it.</p>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 4</span><h2>Joint details</h2>
      <span class="eyebrow">enlarged</span></div>
    <div class="sheetbody" style="grid-template-columns:minmax(0,1fr)">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px">
        <figure class="drawing">${detailCourse()}
          <figcaption><strong>Course joint, 10:1.</strong> A sliding dovetail running the full ${f(D.rackDepthMm)} mm depth.
            The head is wider than the neck, so it carries tension — which matters, because the cleat hangs the whole
            stack from the top course. Slide the course on from the front.</figcaption></figure>
        <figure class="drawing">${detailTab()}
          <figcaption><strong>Seam tab, 4.6:1.</strong> 45° flanks are the compromise: steep enough that the tip is wider
            than the root and locks, shallow enough that the overhang still prints. Anything flatter needs support.</figcaption></figure>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 5</span><h2>Print orientation</h2>
      <span class="eyebrow">not optional</span></div>
    <div class="sheetbody">
      <figure class="drawing">${sheetPrint()}
        <figcaption>A middle piece stood on its back face. Looked at down the depth axis the piece is one unchanging
          L, so all ${f(D.rackDepthMm)} mm of it is the same layer repeated.</figcaption></figure>
      <div class="notes">
        <p><strong>This is why there are no supports.</strong> Every layer is identical, so nothing ever overhangs.</p>
        <p><strong>Printed the way it is used</strong>, a middle piece would cantilever a ${f(D.halfWidthMm)} mm shelf over
           open air.</p>
        <p><strong>Back face down</strong> puts the widest cross-section — the one with the back stop — on the plate.
           Brim on. No supports.</p>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheethead"><span class="sheetno">SHEET 6</span><h2>Schedule &amp; bill of materials</h2></div>
    <div class="sheetbody" style="grid-template-columns:minmax(0,1fr)">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:30px">
        <div>
          <p class="eyebrow" style="margin:0 0 10px">Parameter schedule</p>
          <table><thead><tr><th>Dimension</th><th>mm</th><th>Where it comes from</th></tr></thead><tbody>
          ${schedule.map(([a, b, c]) => `<tr><td>${a}</td><td class="num">${b}</td><td class="why">${c}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div>
          <p class="eyebrow" style="margin:0 0 10px">Bill of materials</p>
          <table><thead><tr><th>File</th><th>Qty</th><th>Plate footprint</th><th>Vol</th></tr></thead><tbody>
          ${pieces.map(([n, q, w, h, v]) => `<tr><td class="num" style="font-size:12px">${n}</td><td class="num">×${q}</td><td class="num">${f(w)} × ${f(h)}</td><td class="num">${v * q} cm³</td></tr>`).join('')}
          <tr><td><strong>Total</strong></td><td class="num"><strong>${pieces.reduce((t, p) => t + p[1], 0)}</strong></td>
              <td class="why">all inside 256 × 256 × 260</td><td class="num"><strong>${totalCm3} cm³</strong></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  </section>

  <div class="flag">
    <h3>${(totalCm3 / 1000 * 1.24).toFixed(2)} kg of filament — the shelves are already cut back</h3>
    <p style="margin:0;color:var(--soft)">Skeletonising the shelves to a frame, ribs and
  ${skelOpenings.length * 2} openings a course takes roughly a quarter off the whole rack. What is left is
  sized by the print, not by eye: each opening is capped at ${f(C.shelfOpeningMaxMm)} mm so the rib arriving
  over it never bridges further than that.</p>
  </div>

  <div class="decisions">
    <div class="dec">
      <h3>Shelves: skeletonised ✓</h3>
    <p>A ${f(C.shelfFrameMm)} mm frame, ${f(C.shelfRibMm)} mm ribs and ${f(openingW)} × ${f(skelOpenings.length ? skelOpenings[0]!.z1 - skelOpenings[0]!.z0 : 0)} mm
       openings. The case bears near its edges, over the frame, so the middle was the cheapest material to lose.</p>
    <p class="opt">→ <span class="mono">skeletonShelf: false</span> returns solid shelves</p>
    </div>
  </div>

  <footer>
    Drawn from the same code that exports the STLs — <span class="mono">src/rack/geometry.ts</span>, verified watertight
    with a band-volume identity check. Print the joint coupon (<span class="mono">npm run rack:build -- --coupon</span>)
    and confirm the ${f(C.fitMm)} mm fit before committing to ${pieces.reduce((t, p) => t + p[1], 0)} pieces.
  </footer>
  </div>`
  return html
}

export interface DrawingIssue {
  figure: number
  kind: 'nonfinite' | 'bounds' | 'collision'
  detail: string
}

const FIG = /<svg viewBox="([^"]+)"(.*?)<\/svg>/gs
const TEXT = /<text[^>]*?class="([^"]*)"[^>]*?x="(-?[\d.]+)"\s+y="(-?[\d.]+)"([^>]*)>([^<]*)<\/text>/g

/** Rough advance width, good enough to catch labels landing on each other. */
const fontSize = (cls: string): number =>
  cls.includes('dim') ? 10.5
    : /note|course|caselbl/.test(cls) ? 9.5
      : 11

/**
 * Check the rendered sheets for the three ways a generated drawing lies.
 *
 * All three have actually happened here. `nonfinite` is the worst and the
 * quietest: a NaN coordinate makes a polygon silently drop the points it
 * touches, so half a shape just is not drawn and nothing errors.
 */
export function auditDrawings(html: string): DrawingIssue[] {
  const issues: DrawingIssue[] = []
  let m: RegExpExecArray | null
  let figure = 0
  FIG.lastIndex = 0
  while ((m = FIG.exec(html)) !== null) {
    figure++
    const [vx, vy, vw, vh] = m[1]!.split(/\s+/).map(Number) as [number, number, number, number]
    const body = m[2]!
    const pts: [number, number][] = []

    if (/NaN|Infinity|undefined/.test(body)) {
      issues.push({ figure, kind: 'nonfinite', detail: 'a coordinate is NaN, Infinity or undefined' })
    }
    for (const g of body.matchAll(/points="([^"]+)"/g)) {
      for (const pair of g[1]!.trim().split(/\s+/)) {
        const [a, b] = pair.split(',').map(Number)
        pts.push([a!, b!])
      }
    }
    for (const g of body.matchAll(/\sd="(M[^"]+)"/g)) {
      for (const pr of g[1]!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) pts.push([+pr[1]!, +pr[2]!])
    }
    for (const g of body.matchAll(/<line[^>]*?x1="(-?[\d.]+)"[^>]*?y1="(-?[\d.]+)"[^>]*?x2="(-?[\d.]+)"[^>]*?y2="(-?[\d.]+)"/g)) {
      pts.push([+g[1]!, +g[2]!], [+g[3]!, +g[4]!])
    }
    for (const g of body.matchAll(/<rect[^>]*?x="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s+width="(-?[\d.]+)"\s+height="(-?[\d.]+)"/g)) {
      pts.push([+g[1]!, +g[2]!], [+g[1]! + +g[3]!, +g[2]! + +g[4]!])
    }

    const boxes: { text: string; box: [number, number, number, number] }[] = []
    TEXT.lastIndex = 0
    let t: RegExpExecArray | null
    while ((t = TEXT.exec(body)) !== null) {
      const [, cls, tx, ty, rest, text] = t as unknown as string[]
      if (rest!.includes('rotate')) continue      // audited on its other axis
      const fs = fontSize(cls!)
      const w = text!.length * fs * 0.56
      const lo = rest!.includes('middle') ? +tx! - w / 2 : rest!.includes('end') ? +tx! - w : +tx!
      const box: [number, number, number, number] = [lo, +ty! - fs * 0.78, lo + w, +ty! + fs * 0.24]
      boxes.push({ text: text!, box })
      pts.push([box[0], box[1]], [box[2], box[3]])
    }

    const finite = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (finite.length) {
      const over = [
        ['left', vx - Math.min(...finite.map(p => p[0]))],
        ['right', Math.max(...finite.map(p => p[0])) - (vx + vw)],
        ['top', vy - Math.min(...finite.map(p => p[1]))],
        ['bottom', Math.max(...finite.map(p => p[1])) - (vy + vh)],
      ] as const
      for (const [side, by] of over) {
        if (by > 1) issues.push({ figure, kind: 'bounds', detail: `content runs ${by.toFixed(0)}px past the ${side} edge` })
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.box, b = boxes[j]!.box
        if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1.5 &&
            Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1.5) {
          issues.push({ figure, kind: 'collision', detail: `"${boxes[i]!.text}" overlaps "${boxes[j]!.text}"` })
        }
      }
    }
  }
  return issues
}
