// One panel, flat, with the BenchPilot reach drawn around it.
//
// Same frame as the Shaper SVG (inner face up), so what is drawn here is what
// the router sees. The reach is anchored at the panel's origin corner; a part
// that fits only when turned is drawn turned a quarter, so the picture shows
// how it would sit inside the cut area.
import { Alert, Box, Typography } from '@mui/material'
import { CABINET_VARS } from './CabinetElevations.tsx'
import { PANEL_DRAWINGS, PANEL_LABELS } from '../export/cutDrawing.ts'
import type { PanelId } from '../export/cutDrawing.ts'
import type { CabinetParams } from '../model/cabinet.ts'
import { fitsReach } from '../../../model/benchpilot.ts'
import type { BenchPilotReach } from '../../../model/benchpilot.ts'
import { formatMeasure, formatSize } from '../../../units.ts'
import type { Ring } from '../../../geometry/vec.ts'

const PAD = 46
const TICK = 5

const bounds = (rings: Ring[]) => {
  const xs = rings.flatMap(r => r.map(pt => pt[0]))
  const ys = rings.flatMap(r => r.map(pt => pt[1]))
  return {
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    minX: Math.min(...xs), minY: Math.min(...ys),
  }
}

export default function CabinetPartView(
  { panel, params, reach, imperial }: { panel: PanelId; params: CabinetParams; reach: BenchPilotReach | null; imperial: boolean },
) {
  const drawing = PANEL_DRAWINGS[panel](params)
  const outline = drawing.layers.find(l => l.cutType === 'exterior')?.polygons.flat() ?? []
  const { w, h, minX, minY } = bounds(outline)
  const pockets = drawing.layers.filter(l => l.cutType === 'pocket')

  const fits = reach ? fitsReach(reach, w, h) : true
  const turned = !!reach && fits && !(w <= reach.widthMm && h <= reach.heightMm)
  const [pw, ph] = turned ? [h, w] : [w, h]
  const vw = Math.max(pw, reach?.widthMm ?? 0)
  const vh = Math.max(ph, reach?.heightMm ?? 0)
  const place = ([x, y]: [number, number]): [number, number] =>
    turned ? [y - minY, w - (x - minX)] : [x - minX, y - minY]
  // The reach's own name carries its size in mm; say it in the units on screen.
  const reachLabel = reach
    ? `${reach.label.split(' (')[0]} (~${formatSize([reach.widthMm, reach.heightMm], imperial)})`
    : ''
  const ring = (r: Ring) => r.map(pt => place(pt as [number, number])).map(([x, y]) => `${x},${vh - y}`).join(' ')

  return (
    <Box sx={{ ...CABINET_VARS, p: 2, minHeight: 0, overflow: 'auto' }}>
      <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
        {PANEL_LABELS[panel]} · {formatSize([w, h], imperial)}
      </Typography>
      {reach && (
        <Alert severity={fits ? 'success' : 'warning'} variant="outlined" sx={{ mb: 1, py: 0 }}>
          {fits
            ? turned ? 'Fits inside the BenchPilot reach when turned a quarter (shown turned).' : 'Fits inside the BenchPilot reach.'
            : 'Larger than the BenchPilot reach in both orientations.'}
        </Alert>
      )}
      <svg
        viewBox={`${-PAD} ${-PAD} ${vw + PAD * 2} ${vh + PAD * 2}`}
        role="img"
        aria-label={`${PANEL_LABELS[panel]}, ${formatSize([w, h], imperial).replace(' × ', ' by ')}`}
        style={{ width: '100%', height: 'auto', maxHeight: '70vh' }}
      >
        {reach && (
          <g>
            <rect
              x={0} y={vh - reach.heightMm} width={reach.widthMm} height={reach.heightMm}
              fill="var(--cab-reach)" fillOpacity={0.07} stroke="var(--cab-reach)" strokeWidth={1.2}
            />
            <text x={4} y={vh - reach.heightMm - 6} fontSize={11} fill="var(--cab-reach)">
              {reachLabel}
            </text>
          </g>
        )}
        {outline.map((r, i) => (
          <polygon
            key={i} points={ring(r)} fill="var(--cab-case)" stroke="var(--cab-line)" strokeWidth={0.8}
          />
        ))}
        {pockets.flatMap((l, li) => l.polygons.flat().map((r, i) => (
          <polygon key={`${li}-${i}`} points={ring(r)} fill="var(--cab-dado)" />
        )))}
        {(drawing.guideRings ?? []).map((r, i) => (
          <polygon key={`g${i}`} points={ring(r)} fill="none" stroke="var(--cab-tray)" strokeWidth={0.6} />
        ))}
        {/* The part's own size, on the part as placed in the cut area. */}
        <g stroke="var(--cab-text)" strokeWidth={0.8} fill="var(--cab-text)">
          <line x1={0} y1={vh + 16} x2={pw} y2={vh + 16} />
          <line x1={0} y1={vh + 16 - TICK} x2={0} y2={vh + 16 + TICK} />
          <line x1={pw} y1={vh + 16 - TICK} x2={pw} y2={vh + 16 + TICK} />
          <text x={pw / 2} y={vh + 33} textAnchor="middle" fontSize={13} stroke="none">
            {formatMeasure(pw, imperial)}
          </text>
          <line x1={-16} y1={vh - ph} x2={-16} y2={vh} />
          <line x1={-16 - TICK} y1={vh - ph} x2={-16 + TICK} y2={vh - ph} />
          <line x1={-16 - TICK} y1={vh} x2={-16 + TICK} y2={vh} />
          <text
            x={-22} y={vh - ph / 2} textAnchor="middle" fontSize={13} stroke="none"
            transform={`rotate(-90 -22 ${vh - ph / 2})`}
          >
            {formatMeasure(ph, imperial)}
          </text>
        </g>
      </svg>
    </Box>
  )
}
