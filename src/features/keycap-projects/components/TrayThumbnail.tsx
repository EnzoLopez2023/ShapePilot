// A tray at a glance: its outline and where the pockets sit.
//
// Not the designer's canvas. That one is 677 lines because it drags, selects,
// rotates and snaps; none of which a preview does. This draws two paths and
// stops, so a project can show several at once without loading the machinery
// for editing any of them.
import { Box } from '@mui/material'
import { pocketRing } from '../../keycap-tray/geometry/shapes.ts'
import type { PocketSizing } from '../../keycap-tray/geometry/shapes.ts'
import { profileToMulti } from '../../keycap-tray/model/presets.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'
import type { TrayDesign } from '../../keycap-tray/model/types.ts'

/** Room for the stroke, so an outline on the bounding box is not clipped. */
const PAD_MM = 2

const ringPath = (ring: Ring): string =>
  `${ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')}Z`

const multiPath = (mp: MultiPolygon): string =>
  mp.flatMap(polygon => polygon.map(ringPath)).join(' ')

export interface TrayThumbnailProps {
  design: Pick<TrayDesign, 'profile' | 'pockets'> & { sizing: PocketSizing }
  /** Read out as the picture's meaning; the name alone would say nothing. */
  label: string
}

export default function TrayThumbnail({ design, label }: TrayThumbnailProps) {
  const outline = profileToMulti(design.profile)
  const bounds = multiBBox(outline)
  if (!Number.isFinite(bounds.minX)) return null

  const width = bounds.maxX - bounds.minX + PAD_MM * 2
  const height = bounds.maxY - bounds.minY + PAD_MM * 2

  const pockets = design.pockets.map(pocket => multiPath([pocketRing(pocket, design.sizing)]))

  return (
    <Box
      component="svg"
      role="img"
      aria-label={label}
      viewBox={`${bounds.minX - PAD_MM} ${bounds.minY - PAD_MM} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      sx={{ display: 'block', width: '100%', height: '100%' }}
    >
      {/* The model is y-up and SVG is y-down, so the whole drawing is flipped
          about the bounding box rather than every coordinate being negated. */}
      <g transform={`translate(0 ${bounds.minY + bounds.maxY}) scale(1 -1)`}>
        <path
          d={multiPath(outline)}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {pockets.map((d, index) => (
          <path
            key={index}
            d={d}
            fill="currentColor"
            fillOpacity={0.22}
            stroke="currentColor"
            strokeOpacity={0.5}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </Box>
  )
}
