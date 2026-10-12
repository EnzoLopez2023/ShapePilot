// A monitor riser that doubles as a desk shelf: a top with a cable notch in
// its back edge, and two leg panels that seat in stopped dadoes on the top's
// underside. All three parts are drawn on one sheet so they cut in one go.
import type { DesignDocument } from '../../../model/document.ts'
import { belt, roundedRect } from './outline.ts'
import { outline, part, templateDocument } from './sceneParts.ts'

export const RISER = {
  lengthMm: 610,
  depthMm: 250,
  /** Leg height under the top. 100 mm lifts a monitor ~120 mm with the top. */
  legHeightMm: 100,
  /** Plywood sold as 3/4 in is nearer 18.5 mm; measure yours. */
  stockMm: 18.5,
  dadoDepthMm: 6,
  /** Dadoes stop short of both long edges so the joint never shows. */
  dadoStopMm: 10,
  /** Top overhang past each leg. */
  overhangMm: 40,
  cornerMm: 10,
  notch: { radiusMm: 35, mouthMm: 5 },
  /** Matches a 1/4 in bit, so the stopped dado's rounded ends take the leg. */
  bitRadiusMm: 3.2,
}

export function monitorRiser(): DesignDocument {
  const {
    lengthMm: L, depthMm: D, legHeightMm, stockMm, dadoDepthMm, dadoStopMm,
    overhangMm, cornerMm: R, notch, bitRadiusMm,
  } = RISER
  const cx = L / 2
  const m = notch.mouthMm, nr = notch.radiusMm
  // Anticlockwise from the front left. The back edge is walked right to left,
  // dipping round the cable scallop: two small convex mouths and the concave
  // bottom, each tangent to the next.
  const top = belt([
    { c: [R, R], r: R, turn: 1 },
    { c: [L - R, R], r: R, turn: 1 },
    { c: [L - R, D - R], r: R, turn: 1 },
    { c: [cx + nr + m, D - m], r: m, turn: 1 },
    { c: [cx, D - m], r: nr, turn: -1 },
    { c: [cx - nr - m, D - m], r: m, turn: 1 },
    { c: [R, D - R], r: R, turn: 1 },
  ])

  const dadoLen = D - 2 * dadoStopMm
  const dadoX = [overhangMm, L - overhangMm - stockMm]
  const dadoes = dadoX.map(x => roundedRect(x, dadoStopMm, x + stockMm, dadoStopMm + dadoLen, bitRadiusMm))

  // Laid out under the top, standing as they will in use: the long edge up
  // goes into the dado. Their corners are eased past the bit radius so they
  // seat in the dado's rounded ends.
  const legH = legHeightMm + dadoDepthMm
  const gap = 20
  const legs = [0, 1].map(i => {
    const x = i * (dadoLen + gap)
    return roundedRect(x, -gap - legH, x + dadoLen, -gap, bitRadiusMm + 1)
  })

  return templateDocument('Monitor riser', [
    `Top ${L} x ${D} mm with a ${nr * 2 + m * 2} mm cable notch in the back edge.`,
    `Legs ${dadoLen} x ${legH} mm: ${legHeightMm} mm under the top plus ${dadoDepthMm} mm in the dado.`,
    `Dadoes ${stockMm} mm wide, ${dadoDepthMm} mm deep, stopped ${dadoStopMm} mm from both`,
    `edges, ${overhangMm} mm in from the ends. Cut them in the top's underside.`,
    `Measure your stock and use Origin's offset to fit the dadoes snug. For a`,
    'desk shelf, make the legs taller -- the top does not change.',
  ], [
    outline('Top', top, 'exterior'),
    part('Leg dadoes', dadoes, 'pocket', dadoDepthMm),
    part('Legs', legs, 'exterior'),
  ])
}
