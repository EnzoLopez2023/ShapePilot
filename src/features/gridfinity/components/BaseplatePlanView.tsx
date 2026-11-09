import { Box, useTheme } from '@mui/material'
import { GRID_PITCH_MM } from '../../../../lib/contracts/gridfinity.ts'
import type { BaseplatePlan } from '../geometry/baseplate.ts'
import type { ResolvedStack } from '../model/layout.ts'

export interface BaseplatePlanViewProps {
  plan: BaseplatePlan
  drawerWidthMm: number
  drawerDepthMm: number
  /** Bins planned on the plate, drawn over their cells. */
  stacks?: readonly ResolvedStack[]
  selected?: number | null
  /** Clicking a cell: select what is there, or place the bin being placed. */
  onCell?: (col: number, row: number) => void
}

/**
 * The drawer seen from above, front edge at the bottom: the plate, its cells,
 * the solid padding and where it is cut into tiles. Pure SVG in millimetres,
 * scaled to the panel.
 */
export default function BaseplatePlanView(
  { plan, drawerWidthMm, drawerDepthMm, stacks = [], selected = null, onCell }: BaseplatePlanViewProps,
) {
  const theme = useTheme()
  const margin = 16
  const W = drawerWidthMm
  const D = drawerDepthMm
  // A case outline is drawn where it is; a drawer plate is centred in the drawer.
  const ox = plan.outline ? 0 : (W - plan.plateWidthMm) / 2
  const oy = plan.outline ? 0 : (D - plan.plateDepthMm) / 2
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
        {plan.gutterOutline && (() => {
          const ys = plan.gutterOutline.flat().map(([, y]) => y)
          const mid = (Math.min(...ys) + Math.max(...ys)) / 2
          return (
            <g>
              <title>Gutter: one long bin standing on the case floor</title>
              <path
                d={path(plan.gutterOutline)} fillRule="evenodd"
                fill={accent} fillOpacity={0.12} stroke={accent} strokeWidth={0.8}
              />
              <text
                x={ox + plan.plateWidthMm / 2} y={oy + fy(mid)} textAnchor="middle" dominantBaseline="central"
                fontSize={7} fontWeight={600} fill={accent} fontFamily={theme.typography.fontFamily}
              >
                Gutter
              </text>
            </g>
          )
        })()}
        {Array.from({ length: plan.cellsX }, (_, i) => Array.from({ length: plan.cellsY }, (_, j) => (
          <rect
            key={`${i}-${j}`}
            x={ox + plan.gridX + i * GRID_PITCH_MM + 2.5}
            y={oy + fy(plan.gridY + j * GRID_PITCH_MM, GRID_PITCH_MM) + 2.5}
            width={GRID_PITCH_MM - 5} height={GRID_PITCH_MM - 5} rx={2}
            fill={theme.palette.background.paper} stroke={line} strokeWidth={0.6}
            style={onCell ? { cursor: 'pointer' } : undefined}
            onClick={onCell ? () => onCell(i, j) : undefined}
          >
            <title>{`Cell ${i + 1}, ${j + 1}`}</title>
          </rect>
        )))}
        {stacks.map(stack => {
          const x = ox + plan.gridX + stack.col * GRID_PITCH_MM + 1.5
          const w = stack.cellsX * GRID_PITCH_MM - 3
          const h = stack.cellsY * GRID_PITCH_MM - 3
          const y = oy + fy(plan.gridY + stack.row * GRID_PITCH_MM, stack.cellsY * GRID_PITCH_MM) + 1.5
          const bad = stack.problems.length > 0
          const isSelected = stack.index === selected
          const colour = bad ? theme.palette.error.main : accent
          const size = Math.min(7, w / 7)
          const names = stack.bins.map(b => b.name)
          return (
            <g
              key={stack.index}
              style={onCell ? { cursor: 'pointer' } : undefined}
              onClick={onCell ? () => onCell(stack.col, stack.row) : undefined}
            >
              <title>{`${names.join(' on ') || 'Empty'} · ${stack.heightMm.toFixed(1)} mm${bad ? ` · ${stack.problems.join(' ')}` : ''}`}</title>
              <rect
                x={x} y={y} width={w} height={h} rx={3}
                fill={colour} fillOpacity={isSelected ? 0.28 : 0.14}
                stroke={colour} strokeWidth={isSelected ? 2 : 1}
              />
              <text
                x={x + w / 2} y={y + h / 2 - size * 0.6} textAnchor="middle" dominantBaseline="central"
                fontSize={size} fontWeight={600} fill={ink} fontFamily={theme.typography.fontFamily}
              >
                {names.length > 1 ? `${names.length} stacked` : (names[0] ?? '?').slice(0, Math.max(4, Math.floor(w / (size * 0.6))))}
              </text>
              <text
                x={x + w / 2} y={y + h / 2 + size * 0.8} textAnchor="middle" dominantBaseline="central"
                fontSize={size * 0.85} fill={bad ? colour : muted} fontFamily={theme.typography.fontFamily}
              >
                {stack.heightMm.toFixed(1)} mm
              </text>
            </g>
          )
        })}
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
