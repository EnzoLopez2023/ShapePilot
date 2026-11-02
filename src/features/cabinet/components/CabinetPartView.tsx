// One panel, flat, with the BenchPilot reach drawn around it.
//
// Same frame as the Shaper SVG (inner face up), so what is drawn here is what
// the router sees. The reach is anchored at the panel's origin corner; a part
// that fits only when turned is drawn turned a quarter, so the picture shows
// how it would sit inside the cut area. A part too long for it is laid along
// the reach the way it passes through -- sideways or front to back, as chosen --
// with the export's seams drawn across it. With the tape shown, the ShaperTape
// strips the part carries are laid across it, each marked with how far its
// near edge sits from the part's top or left end.
import { Alert, Box, Typography } from '@mui/material'
import { CABINET_VARS } from './CabinetElevations.tsx'
import { PANEL_DRAWINGS, PANEL_LABELS } from '../export/cutDrawing.ts'
import type { PanelId } from '../export/cutDrawing.ts'
import type { CabinetParams } from '../model/cabinet.ts'
import { fitsReach } from '../../../model/benchpilot.ts'
import type { BenchPilotFeed, BenchPilotReach } from '../../../model/benchpilot.ts'
import { formatMeasure, formatSize } from '../../../units.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { planPassThrough } from '../../../export/passThrough.ts'
import { TAPE_PITCH_MM, TAPE_WIDTH_MM, tapeLayout } from '../../../export/shaperTape.ts'

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

const FEED_LABEL: Record<BenchPilotFeed, string> = { sideways: 'left to right', 'front-to-back': 'front to back' }
const OTHER_FEED: Record<BenchPilotFeed, BenchPilotFeed> = { sideways: 'front-to-back', 'front-to-back': 'sideways' }

export default function CabinetPartView(
  { panel, params, reach, imperial, bitMm, feed, showTape }: {
    panel: PanelId; params: CabinetParams; reach: BenchPilotReach | null; imperial: boolean; bitMm: number
    feed: BenchPilotFeed; showTape: boolean
  },
) {
  const drawing = PANEL_DRAWINGS[panel](params)
  const outline = drawing.layers.find(l => l.cutType === 'exterior')?.polygons.flat() ?? []
  const { w, h, minX, minY } = bounds(outline)
  const pockets = drawing.layers.filter(l => l.cutType === 'pocket')

  const fits = reach ? fitsReach(reach, w, h) : true
  const plan = reach && !fits ? planPassThrough(drawing, reach, bitMm, feed) : null
  const otherFeedWorks = !!reach && !fits && !plan && !!planPassThrough(drawing, reach, bitMm, OTHER_FEED[feed])
  // The reach's width runs across the picture, so a part is turned when its
  // length has to run the other way to fit -- or, passing through, to slide.
  const turned = plan
    ? plan.alongReachWidth === (plan.axis === 'y')
    : !!reach && fits && !(w <= reach.widthMm && h <= reach.heightMm)
  const seams: Ring[] = (plan?.seamsMm ?? []).map(s => (plan!.axis === 'y'
    ? [[minX, s], [minX + w, s]]
    : [[s, minY], [s, minY + h]]))
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

  // Tape strips across the part, placed, with each near edge measured from the
  // part's top or left end as it sits on screen.
  const tape = reach && showTape ? tapeLayout(drawing, imperial ? 25.4 / 8 : 1) : null
  const strips = (tape?.stripsMm ?? []).map(s => {
    const [a, b] = [s, s + TAPE_WIDTH_MM].map(v => v + (tape!.axis === 'y' ? minY : minX))
    const r: Ring = tape!.axis === 'y'
      ? [[minX, a], [minX + w, a], [minX + w, b], [minX, b]]
      : [[a, minY], [b, minY], [b, minY + h], [a, minY + h]]
    const pts = r.map(pt => place(pt as [number, number])).map(([x, y]) => [x, vh - y])
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    const across = box.w < box.h // a tall, thin strip: the length runs across the screen
    return { r, box, across, fromEndMm: across ? box.x : box.y - (vh - ph) }
  }).sort((a, b) => a.fromEndMm - b.fromEndMm)
  const tapeAcross = strips[0]?.across ?? true

  return (
    <Box sx={{ ...CABINET_VARS, p: 2, minHeight: 0, overflow: 'auto' }}>
      <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
        {PANEL_LABELS[panel]} · {formatSize([w, h], imperial)}
      </Typography>
      {reach && (
        <Alert severity={fits ? 'success' : plan ? 'info' : 'warning'} variant="outlined" sx={{ mb: 1, py: 0 }}>
          {fits
            ? turned ? 'Fits inside the BenchPilot reach when turned a quarter (shown turned).' : 'Fits inside the BenchPilot reach.'
            : plan
              ? `Longer than the reach: exported in ${plan.windows.length} pass-through segments, ` +
                `split at ${plan.seamsMm.map(v => formatMeasure(v - plan.startMm, imperial)).join(', ')} (dashed). ` +
                'Tape and scan the whole board, cut what is in reach, slide it along, cut the rest.'
              : otherFeedWorks
                ? `Too wide to feed ${FEED_LABEL[feed]} through the reach. Feed it ${FEED_LABEL[OTHER_FEED[feed]]} instead.`
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
            {/* Beside the part when it stands taller than the reach and would cover the label. */}
            <text x={ph > reach.heightMm ? pw + 6 : 4} y={vh - reach.heightMm - 6} fontSize={11} fill="var(--cab-reach)">
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
        {seams.map((r, i) => (
          <polyline
            key={`s${i}`} points={ring(r)} fill="none" stroke="var(--cab-reach)" strokeWidth={1.2} strokeDasharray="6 4"
          />
        ))}
        {(drawing.guideRings ?? []).map((r, i) => (
          <polygon key={`g${i}`} points={ring(r)} fill="none" stroke="var(--cab-tray)" strokeWidth={0.6} />
        ))}
        {strips.map(({ r, box, across, fromEndMm }, i) => (
          <g key={`t${i}`}>
            <polygon points={ring(r)} fill="var(--cab-tape)" fillOpacity={0.82} />
            <text
              x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" dominantBaseline="central"
              fontSize={8} fill="#fff"
              transform={across ? `rotate(-90 ${box.x + box.w / 2} ${box.y + box.h / 2})` : undefined}
            >
              {formatMeasure(fromEndMm, imperial)}
            </text>
          </g>
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
      {tape && strips.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          ShaperTape: {strips.length} strip{strips.length === 1 ? '' : 's'} across the part, about{' '}
          {formatMeasure(TAPE_PITCH_MM, imperial)} apart. Measured from the {tapeAcross ? 'left' : 'top'} end to each
          strip&apos;s {tapeAcross ? 'left' : 'top'} edge:{' '}
          {strips.map(s => formatMeasure(s.fromEndMm, imperial)).join(', ')}.
          {' '}Each strip sits clear of the dados, so none is routed through
          {tape.overCuts.length ? `, except strip ${tape.overCuts.map(i => i + 1).join(', ')}, which could not miss a cut` : ''}.
        </Typography>
      )}
    </Box>
  )
}
