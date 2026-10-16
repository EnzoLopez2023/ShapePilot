import { Box, useTheme } from '@mui/material'
import { GRID_PITCH_MM } from '../../../../lib/contracts/gridfinity.ts'
import type { BaseplatePlan } from '../geometry/baseplate.ts'

export interface BaseplatePlanViewProps {
  plan: BaseplatePlan
  drawerWidthMm: number
  drawerDepthMm: number
}

/**
 * The drawer seen from above, front edge at the bottom: the plate, its cells,
 * the solid padding and where it is cut into tiles. Pure SVG in millimetres,
 * scaled to the panel.
 */
export default function BaseplatePlanView({ plan, drawerWidthMm, drawerDepthMm }: BaseplatePlanViewProps) {
  const theme = useTheme()
  const margin = 16
  const W = drawerWidthMm
  const D = drawerDepthMm
  const ox = (W - plan.plateWidthMm) / 2
  const oy = (D - plan.plateDepthMm) / 2
  // SVG y runs down; the drawer's front (y = 0) is drawn at the bottom.
  const fy = (y: number, h = 0) => D - y - h
  const ink = theme.palette.text.primary
  const muted = theme.palette.text.secondary
  const line = theme.palette.divider
  const accent = theme.palette.primary.main
  const tileLabel = Math.max(6, Math.min(W, D) / 28)
  const path = (rings: [number, number][][]) => rings
    .map(r => r.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + x).toFixed(2)} ${(oy + fy(y)).toFixed(2)}`).join('') + 'Z')
    .join('')

  return (
    <Box sx={{ position: 'absolute', inset: 0, p: 3, display: 'flex' }}>
      <svg
        viewBox={`${-margin} ${-margin} ${W + margin * 2} ${D + margin * 2}`}
        width="100%" height="100%" role="img"
        aria-label={`Drawer plan: ${plan.cellsX} by ${plan.cellsY} cells in ${plan.tiles.length} tiles`}
      >
        {plan.outline ? (
          <path d={path(plan.outline)} fillRule="evenodd" fill={theme.palette.action.hover} stroke={ink} strokeWidth={0.8} />
        ) : (
          <>
            <rect x={0} y={0} width={W} height={D} fill="none" stroke={muted} strokeDasharray="4 3" strokeWidth={0.8} />
            <rect
              x={ox} y={oy} width={plan.plateWidthMm} height={plan.plateDepthMm} rx={2}
              fill={theme.palette.action.hover} stroke={ink} strokeWidth={0.8}
            />
          </>
        )}
        {Array.from({ length: plan.cellsX }, (_, i) => Array.from({ length: plan.cellsY }, (_, j) => (
          <rect
            key={`${i}-${j}`}
            x={ox + plan.gridX + i * GRID_PITCH_MM + 2.5}
            y={oy + fy(plan.gridY + j * GRID_PITCH_MM, GRID_PITCH_MM) + 2.5}
            width={GRID_PITCH_MM - 5} height={GRID_PITCH_MM - 5} rx={2}
            fill={theme.palette.background.paper} stroke={line} strokeWidth={0.6}
          />
        )))}
        {plan.columns.slice(1).map(c => (
          <line
            key={`c${c.from}`} x1={ox + c.from} x2={ox + c.from} y1={oy - 4} y2={oy + plan.plateDepthMm + 4}
            stroke={accent} strokeWidth={1.4}
          />
        ))}
        {plan.rows.slice(1).map(r => (
          <line
            key={`r${r.from}`} y1={oy + fy(r.from)} y2={oy + fy(r.from)} x1={ox - 4} x2={ox + plan.plateWidthMm + 4}
            stroke={accent} strokeWidth={1.4}
          />
        ))}
        {plan.tiles.map(t => (
          <text
            key={`${t.col}-${t.row}`}
            x={ox + t.x + t.widthMm / 2} y={oy + fy(t.y + t.depthMm / 2)}
            textAnchor="middle" dominantBaseline="central"
            fontSize={tileLabel} fontWeight={600} fill={accent}
            fontFamily={theme.typography.fontFamily}
          >
            {plan.tiles.length > 1 ? `${t.col}-${t.row}` : ''}
          </text>
        ))}
        <text
          x={W / 2} y={D + margin * 0.7} textAnchor="middle" fontSize={Math.max(6, tileLabel * 0.7)}
          fill={muted} fontFamily={theme.typography.fontFamily}
        >
          {plan.outline ? 'Front of case' : 'Front of drawer'}
        </text>
      </svg>
    </Box>
  )
}
