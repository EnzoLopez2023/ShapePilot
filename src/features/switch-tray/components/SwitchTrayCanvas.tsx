import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, Stack, Tooltip, useTheme } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { cellHoleMm, cellKeepoutMm } from '../model/defaults.ts'
import type { SwitchTrayDesign } from '../model/types.ts'
import type { FillPlan } from '../geometry/fill.ts'
import { feetRects } from '../geometry/feet.ts'

const ringToPath = (r: Ring): string =>
  `${r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`).join('')}Z`

export interface SwitchTrayCanvasProps {
  design: SwitchTrayDesign
  plan: FillPlan
  /** Pixels hidden behind the surrounding panels, so fit-to-view centres correctly. */
  inset: { left: number; right: number; top: number; bottom: number }
  fitToken: number
  showHousings: boolean
  onToggleCell: (col: number, row: number) => void
}

/**
 * The generated layout, drawn over the real outline.
 *
 * Much simpler than the keycap tray's canvas, and for a good reason: there is
 * nothing to drag. Cells are placed by `planFill`, so the only gesture that
 * edits anything is a click, which takes a cell out of the grid (or puts it
 * back). Everything else is pan and zoom.
 */
export function SwitchTrayCanvas({
  design, plan, inset, fitToken, showHousings, onToggleCell,
}: SwitchTrayCanvasProps) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState({ x: -12, y: -12, w: 280, h: 200 })
  const [grabbing, setGrabbing] = useState(false)
  const pan = useRef<
    { id: number; clientX: number; clientY: number; viewX: number; viewY: number; moved: boolean }
    | null
  >(null)

  const profileRings: MultiPolygon = useMemo(
    () => profileToMulti(design.profile), [design.profile])
  const profilePath = useMemo(
    () => profileRings.flatMap(poly => poly.map(ringToPath)).join(' '), [profileRings])
  const footPaths = useMemo(
    () => feetRects(design.profile, design.feet).map(rect => ringToPath(rect[0])),
    [design.profile, design.feet])

  const holeMm = cellHoleMm(design.plate, design.switch)
  const keepoutMm = cellKeepoutMm(design.plate, design.switch)
  const hasRecess = design.plate.recessMm > 0 && keepoutMm > holeMm

  // The panels frame the canvas, so fitting to the raw element size would tuck
  // the tray under them. Inflate the viewBox by the hidden fraction instead.
  const fit = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const b = multiBBox(profileRings)
    if (!Number.isFinite(b.minX)) return
    const usableW = Math.max(80, r.width - inset.left - inset.right)
    const usableH = Math.max(80, r.height - inset.top - inset.bottom)
    const margin = 1.06
    const scale = Math.min(usableW / ((b.maxX - b.minX) * margin),
                           usableH / ((b.maxY - b.minY) * margin))
    const w = r.width / scale
    const h = r.height / scale
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    setView({
      x: cx - w / 2 + ((inset.right - inset.left) / 2) / scale,
      y: cy - h / 2 - ((inset.top - inset.bottom) / 2) / scale,
      w, h,
    })
  }, [profileRings, inset])

  useEffect(() => { fit() }, [fit, fitToken])

  const zoomBy = useCallback((factor: number, atClientX?: number, atClientY?: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = atClientX === undefined ? r.width / 2 : atClientX - r.left
    const py = atClientY === undefined ? r.height / 2 : atClientY - r.top
    setView(v => {
      // Model space is y-up and the scene is flipped once, so a screen y maps
      // to the far side of the viewBox.
      const mx = v.x + (px / r.width) * v.w
      const my = v.y + (1 - py / r.height) * v.h
      const w = Math.min(4000, Math.max(8, v.w * factor))
      const h = w * (v.h / v.w)
      return { x: mx - (mx - v.x) * (w / v.w), y: my - (my - v.y) * (h / v.h), w, h }
    })
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    // React attaches wheel passively, which blocks preventDefault.
    const handler = (ev: WheelEvent) => ev.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    pan.current = {
      id: e.pointerId,
      clientX: e.clientX, clientY: e.clientY,
      viewX: view.x, viewY: view.y,
      moved: false,
    }
    setGrabbing(true)
    // Guarded: the pointer may already be gone, and jsdom has no capture at all.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = ((e.clientX - p.clientX) / r.width) * view.w
    const dy = ((e.clientY - p.clientY) / r.height) * view.h
    if (Math.abs(e.clientX - p.clientX) + Math.abs(e.clientY - p.clientY) > 3) p.moved = true
    setView(v => ({ ...v, x: p.viewX - dx, y: p.viewY + dy }))
  }

  const endPan = () => { pan.current = null; setGrabbing(false) }

  const ink = theme.palette.text.primary
  const stock = dark ? '#2A2D33' : '#FFFFFF'
  const holeFill = dark ? 'rgba(237,237,236,0.12)' : 'rgba(27,26,24,0.07)'
  const recessStroke = theme.palette.primary.main
  const keepClear = theme.palette.warning.main
  const skippedInk = theme.palette.text.disabled

  // Cells the lattice found but the user clicked out. Drawn as ghosts so a skip
  // reads as a deliberate gap rather than a hole in the algorithm, and so it
  // can be clicked again to put the cell back.
  const skipped = useMemo(() => {
    const keys = new Set(design.skippedCells ?? [])
    if (!keys.size) return []
    const byIndex = new Map(plan.cells.map(c => [`${c.col},${c.row}`, c]))
    const out: { col: number; row: number; cx: number; cy: number }[] = []
    for (const key of keys) {
      if (byIndex.has(key)) continue
      const [col, row] = key.split(',').map(Number)
      // Reconstruct the centre from the lattice the plan actually used.
      const anchor = plan.cells[0]
      if (!anchor) continue
      out.push({
        col,
        row,
        cx: anchor.cx + (col - anchor.col) * plan.pitchXMm,
        cy: anchor.cy + (row - anchor.row) * plan.pitchYMm,
      })
    }
    return out
  }, [design.skippedCells, plan])

  const stroke = view.w / 800

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="application"
        aria-label={
          `Switch tray layout, ${plan.cells.length} cells. `
          + 'Click a cell to leave it out; click the gap to put it back; '
          + 'drag the background to pan; scroll to zoom.'
        }
        onWheel={onWheel}
        onPointerDown={beginPan}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        style={{ display: 'block', touchAction: 'none', cursor: grabbing ? 'grabbing' : 'grab' }}
      >
        {/* Model space is y-up; flip once here so all geometry below is in mm. */}
        <g transform={`translate(0, ${2 * view.y + view.h}) scale(1, -1)`}>
          <path d={profilePath} fill={stock} stroke={ink} strokeWidth={stroke} fillRule="evenodd" />

          {/* Post footprints, in the same keep-clear language as the keycap
              tray's buffer guide -- these are why a cell is missing there. */}
          {footPaths.map((d, i) => (
            <path
              key={`foot${i}`}
              d={d}
              fill={keepClear}
              fillOpacity={dark ? 0.22 : 0.16}
              stroke={keepClear}
              strokeWidth={view.w / 700}
              strokeDasharray={`${view.w / 250} ${view.w / 250}`}
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {plan.cells.map(c => (
            <g key={`${c.col},${c.row}`}>
              {hasRecess && (
                <rect
                  x={c.cx - keepoutMm / 2} y={c.cy - keepoutMm / 2}
                  width={keepoutMm} height={keepoutMm}
                  rx={design.plate.cornerRadiusMm}
                  fill="none" stroke={recessStroke} strokeOpacity={0.75} strokeWidth={stroke}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {showHousings && !hasRecess && (
                <rect
                  x={c.cx - design.switch.housingMm / 2} y={c.cy - design.switch.housingMm / 2}
                  width={design.switch.housingMm} height={design.switch.housingMm}
                  fill="none" stroke={recessStroke} strokeOpacity={0.4}
                  strokeWidth={stroke} strokeDasharray={`${view.w / 300} ${view.w / 300}`}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <rect
                x={c.cx - holeMm / 2} y={c.cy - holeMm / 2}
                width={holeMm} height={holeMm}
                rx={design.plate.cornerRadiusMm}
                fill={holeFill} stroke={ink} strokeWidth={stroke}
                onClick={() => { if (!pan.current?.moved) onToggleCell(c.col, c.row) }}
                style={{ cursor: 'pointer' }}
              />
            </g>
          ))}

          {skipped.map(c => (
            <rect
              key={`skip${c.col},${c.row}`}
              x={c.cx - holeMm / 2} y={c.cy - holeMm / 2}
              width={holeMm} height={holeMm}
              rx={design.plate.cornerRadiusMm}
              fill="none" stroke={skippedInk} strokeWidth={stroke}
              strokeDasharray={`${view.w / 300} ${view.w / 300}`}
              onClick={() => { if (!pan.current?.moved) onToggleCell(c.col, c.row) }}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </g>
      </svg>

      <Stack sx={{ position: 'absolute', right: 8, bottom: 8 }}>
        <Tooltip title="Zoom in" placement="left">
          <IconButton size="small" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom in">
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out" placement="left">
          <IconButton size="small" onClick={() => zoomBy(1.25)} aria-label="Zoom out">
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
