import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, useTheme } from '@mui/material'
import type { MultiPolygon, Polygon, Ring } from '../../../geometry/vec.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import type { ToolTrayDesign } from '../model/types.ts'
import { deepestStepMm, stepRings } from '../geometry/shapes.ts'
import { reliefKeepOuts } from '../geometry/bands.ts'

const ringToPath = (r: Ring): string =>
  `${r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`).join('')}Z`

const polysToPath = (polys: Polygon[]): string =>
  polys.flatMap(poly => poly.map(ringToPath)).join(' ')

export interface ToolTrayCanvasProps {
  design: ToolTrayDesign
  selection: Set<string>
  /** Pixels hidden behind the surrounding panels, so fit-to-view centres correctly. */
  inset: { left: number; right: number; top: number; bottom: number }
  fitToken: number
  showKeepOuts: boolean
  showDepths: boolean
  snapMm: number
  /** Pocket ids the validator has something to say about. */
  flagged: Set<string>
  onSelect: (id: string, additive: boolean) => void
  onClearSelection: () => void
  onMove: (ids: Iterable<string>, dx: number, dy: number) => void
}

/**
 * The tray drawn over its real outline, with every pocket draggable.
 *
 * Unlike the switch tray's canvas there is real editing here: pockets are
 * placed, so a drag moves one. A drag is committed once on pointer-up rather
 * than per frame, so the whole gesture is a single undo step and the mesh is
 * rebuilt once instead of sixty times a second.
 */
export function ToolTrayCanvas({
  design, selection, inset, fitToken, showKeepOuts, showDepths, snapMm, flagged,
  onSelect, onClearSelection, onMove,
}: ToolTrayCanvasProps) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState({ x: -12, y: -12, w: 280, h: 200 })
  const [grabbing, setGrabbing] = useState(false)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const dragRef = useRef<
    { id: number; clientX: number; clientY: number; ids: string[] } | null
  >(null)
  const pan = useRef<
    { id: number; clientX: number; clientY: number; viewX: number; viewY: number; moved: boolean }
    | null
  >(null)

  const profileRings: MultiPolygon = useMemo(
    () => profileToMulti(design.profile), [design.profile])
  const profilePath = useMemo(() => polysToPath(profileRings), [profileRings])
  const keepOutPath = useMemo(
    () => (showKeepOuts ? polysToPath(reliefKeepOuts(design)) : ''),
    [design, showKeepOuts])

  /** Every pocket's steps, deepest first so a shallow step draws on top. */
  const drawn = useMemo(() => design.pockets.map(pocket => {
    const deepest = deepestStepMm(pocket) ?? design.heightMm
    const steps = pocket.steps
      .map(step => ({
        depth: step.depthMm === null ? design.heightMm : step.depthMm,
        path: polysToPath(stepRings(pocket, step)),
      }))
      .sort((a, b) => b.depth - a.depth)
    return { pocket, deepest, steps }
  }), [design.pockets, design.heightMm])

  const fit = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const b = multiBBox(profileRings)
    const pad = 8
    const wMm = b.maxX - b.minX + pad * 2
    const hMm = b.maxY - b.minY + pad * 2
    const usableW = Math.max(1, r.width - inset.left - inset.right)
    const usableH = Math.max(1, r.height - inset.top - inset.bottom)
    const scale = Math.min(usableW / wMm, usableH / hMm)
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

  /** Screen pixels to millimetres, for a drag delta. */
  const perPx = useCallback((): number => {
    const el = svgRef.current
    if (!el) return 1
    const r = el.getBoundingClientRect()
    return r.width ? view.w / r.width : 1
  }, [view.w])

  const snap = useCallback(
    (mm: number): number => (snapMm > 0 ? Math.round(mm / snapMm) * snapMm : mm),
    [snapMm])

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    pan.current = {
      id: e.pointerId,
      clientX: e.clientX, clientY: e.clientY,
      viewX: view.x, viewY: view.y,
      moved: false,
    }
    setGrabbing(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }

  const beginDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    // Dragging an unselected pocket selects it first, so the gesture always
    // moves what is under the cursor.
    const ids = selection.has(id) ? [...selection] : [id]
    if (!selection.has(id)) onSelect(id, additive)
    dragRef.current = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, ids }
    setDrag({ dx: 0, dy: 0 })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d && d.id === e.pointerId) {
      const k = perPx()
      setDrag({
        dx: snap((e.clientX - d.clientX) * k),
        // Screen y grows downward, model y upward.
        dy: snap(-(e.clientY - d.clientY) * k),
      })
      return
    }
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    const k = perPx()
    if (Math.abs(e.clientX - p.clientX) > 2 || Math.abs(e.clientY - p.clientY) > 2) {
      p.moved = true
    }
    setView(v => ({
      ...v,
      x: p.viewX - (e.clientX - p.clientX) * k,
      y: p.viewY + (e.clientY - p.clientY) * k,
    }))
  }

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    dragRef.current = null
    const moved = drag
    setDrag(null)
    // One undo step for the whole gesture, and one mesh rebuild.
    if (moved && (moved.dx || moved.dy)) onMove(d.ids, moved.dx, moved.dy)
  }

  const endPan = (e: React.PointerEvent) => {
    endDrag(e)
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    pan.current = null
    setGrabbing(false)
    // A click on the background with no drag clears the selection.
    if (!p.moved) onClearSelection()
  }

  const ink = theme.palette.text.primary
  const stock = dark ? '#2A2D33' : '#FFFFFF'
  const pocketInk = theme.palette.primary.main
  const keepClear = theme.palette.warning.main
  const problem = theme.palette.error.main
  const stroke = view.w / 800

  /** Deeper pockets read darker, so the tiers of one pocket are legible. */
  const depthOpacity = (depthMm: number): number => {
    if (!showDepths) return dark ? 0.3 : 0.16
    const t = Math.min(1, Math.max(0, depthMm / Math.max(1, design.heightMm)))
    return (dark ? 0.14 : 0.08) + t * (dark ? 0.5 : 0.42)
  }

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="application"
        aria-label={
          `Tool tray layout, ${design.pockets.length} pockets. `
          + 'Click a pocket to select it; drag to move it; '
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

          {/* The case's underside lift recesses. A pocket reaching into one of
              these opens a hole in the tray wall, so they are drawn in the same
              keep-clear language the other designers use for a post. */}
          {keepOutPath && (
            <path
              d={keepOutPath}
              fill={keepClear}
              fillOpacity={dark ? 0.2 : 0.14}
              stroke={keepClear}
              strokeWidth={view.w / 700}
              strokeDasharray={`${view.w / 250} ${view.w / 250}`}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {drawn.map(({ pocket, steps }) => {
            const selected = selection.has(pocket.id)
            const bad = flagged.has(pocket.id)
            const moving = selected && drag ? drag : null
            return (
              <g
                key={pocket.id}
                transform={moving ? `translate(${moving.dx},${moving.dy})` : undefined}
                onPointerDown={e => beginDrag(e, pocket.id)}
                style={{ cursor: 'move' }}
              >
                {steps.map((s, i) => (
                  <path
                    key={i}
                    d={s.path}
                    fill={bad ? problem : pocketInk}
                    fillOpacity={depthOpacity(s.depth)}
                    stroke={bad ? problem : (selected ? pocketInk : ink)}
                    strokeWidth={selected ? stroke * 2.5 : stroke}
                    fillRule="evenodd"
                  />
                ))}
                {/* An invisible hit area over the pocket's own box, so a pocket
                    made of thin channels is still easy to grab. */}
                <rect
                  x={pocket.x} y={pocket.y}
                  width={pocket.widthMm} height={pocket.heightMm}
                  fill="transparent"
                />
              </g>
            )
          })}
        </g>
      </svg>
    </Box>
  )
}

export default ToolTrayCanvas
