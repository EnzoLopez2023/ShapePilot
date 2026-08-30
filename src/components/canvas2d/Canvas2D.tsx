// The 2D editing surface for scene documents.
//
// Interaction model is the one the keycap canvas established and this app's
// users already know: drag to move, drag the background to pan, shift-drag to
// zoom to a region, wheel to zoom at the cursor, corner handles to rotate,
// drop a palette item to add it. See src/components/canvas2d/useViewBox.ts for
// the viewport half, which both canvases share.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, Stack, Tooltip, useTheme } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded'
import type { MultiPolygon, Ring } from '../../geometry/vec.ts'
import { multiBBox, ringBBox } from '../../geometry/vec.ts'
import type { CutType, SceneObject } from '../../model/document.ts'
import type { Inset, MarqueeBox } from './useViewBox.ts'
import { NO_INSET, useViewBox } from './useViewBox.ts'

/** A resolved object ready to draw: its outline plus what it is. */
export interface CanvasShape {
  id: string
  name: string
  polygons: MultiPolygon
  mode: 'solid' | 'hole'
  cutType?: CutType
  locked: boolean
}

export interface Canvas2DProps {
  shapes: CanvasShape[]
  objects: readonly SceneObject[]
  selection: Set<string>
  /** Grid pitch in mm; 0 hides the grid. */
  gridMm: number
  /** Snap increment in mm; 0 disables snapping. */
  snapMm: number
  /** Stock outline to draw behind the design, if the machine defines one. */
  stockMm?: { widthMm: number; heightMm: number } | null
  /** Panels frame the canvas, so fit() has to account for them. */
  inset?: Inset
  /** Bumping this re-runs fit-to-content. */
  fitToken: number
  onSelect: (id: string, additive: boolean) => void
  onClearSelection: () => void
  onMove: (ids: string[], dx: number, dy: number) => void
  onRotate: (id: string, deg: number) => void
  onDropPaletteItem?: (payload: unknown, x: number, y: number) => void
  emptyHint?: string
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  ids: string[]
  guideX: number | null
  guideY: number | null
}

interface RotateState {
  pointerId: number
  id: string
  cx: number
  cy: number
  startPointerDeg: number
  baseRotation: number
  angle: number
}

const ringToPath = (ring: Ring): string =>
  ring.length
    ? `${ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`
    : ''

const multiToPath = (mp: MultiPolygon): string =>
  mp.flat().map(ringToPath).join(' ')

const bearingDeg = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI

/** Rotation is stored on the object's z axis; the 2D canvas only ever turns
 *  about z, so the other two are left alone. */
const zRotation = (o: SceneObject): number => o.transform.rotationDeg[2]

export default function Canvas2D(props: Canvas2DProps) {
  const {
    shapes, objects, selection, gridMm, snapMm, stockMm, inset = NO_INSET, fitToken,
    onSelect, onClearSelection, onMove, onRotate, onDropPaletteItem, emptyHint,
  } = props

  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const svgRef = useRef<SVGSVGElement | null>(null)

  const { view, toModel, zoomBy, zoomAt, fit, panBy, commitMarquee, guideToleranceMm } =
    useViewBox(svgRef, { x: -20, y: -20, w: 300, h: 220 }, inset)

  const [drag, setDrag] = useState<DragState | null>(null)
  const [rotateDrag, setRotateDrag] = useState<RotateState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const bgPointer = useRef<{
    id: number; mode: 'pan' | 'zoom'
    startClientX: number; startClientY: number; moved: boolean
  } | null>(null)

  const paths = useMemo(
    () => shapes.map(s => ({ shape: s, d: multiToPath(s.polygons) })), [shapes])

  const contentBBox = useMemo(() => {
    const all = shapes.flatMap(s => s.polygons)
    if (!all.length) {
      return stockMm
        ? { minX: 0, minY: 0, maxX: stockMm.widthMm, maxY: stockMm.heightMm }
        : { minX: 0, minY: 0, maxX: 200, maxY: 150 }
    }
    return multiBBox(all)
  }, [shapes, stockMm])

  // Re-framing is driven by fitToken alone: refitting whenever the content
  // changes would yank the view out from under every edit.
  const contentRef = useRef(contentBBox)
  contentRef.current = contentBBox
  useEffect(() => { fit(contentRef.current) }, [fit, fitToken])

  /** Alignment-guide targets: every non-dragged shape's centre. */
  const centres = useMemo(() => shapes.map(s => {
    const b = multiBBox(s.polygons)
    return { id: s.id, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }
  }), [shapes])

  const snap = useCallback(
    (v: number) => (snapMm > 0 ? Math.round(v / snapMm) * snapMm : v), [snapMm])

  // preventDefault must come from a non-passive native listener; calling it in
  // the React handler logs a passive-listener violation on every scroll.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const block = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.1 : 1 / 1.1)
  }, [zoomAt])

  const beginBackground = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = svgRef.current
    if (!el) return
    const zoom = e.shiftKey
    bgPointer.current = {
      id: e.pointerId, mode: zoom ? 'zoom' : 'pan',
      startClientX: e.clientX, startClientY: e.clientY, moved: false,
    }
    if (zoom) {
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      setMarquee({ x0: x, y0: y, x1: x, y1: y })
    } else {
      setGrabbing(true)
    }
    try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }, [])

  const beginDrag = useCallback((e: React.PointerEvent, shape: CanvasShape) => {
    if (shape.locked) return
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const ids = selection.has(shape.id) && !additive
      ? [...selection]
      : (additive ? [...new Set([...selection, shape.id])] : [shape.id])
    onSelect(shape.id, additive)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      dx: 0, dy: 0, ids, guideX: null, guideY: null,
    })
  }, [selection, onSelect])

  const beginRotate = useCallback((e: React.PointerEvent, shape: CanvasShape) => {
    e.stopPropagation()
    const object = objects.find(o => o.id === shape.id)
    const b = multiBBox(shape.polygons)
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
    const m = toModel(e.clientX, e.clientY)
    setRotateDrag({
      pointerId: e.pointerId, id: shape.id, cx, cy,
      startPointerDeg: bearingDeg(m.x - cx, m.y - cy),
      baseRotation: object ? zRotation(object) : 0,
      angle: object ? zRotation(object) : 0,
    })
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* gone */ }
  }, [objects, toModel])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const bg = bgPointer.current
    if (bg && e.pointerId === bg.id) {
      const el = svgRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (Math.abs(e.clientX - bg.startClientX) > 2 || Math.abs(e.clientY - bg.startClientY) > 2) {
        bg.moved = true
      }
      if (bg.mode === 'zoom') {
        setMarquee(m => (m ? { ...m, x1: e.clientX - r.left, y1: e.clientY - r.top } : m))
      } else {
        const dx = -((e.clientX - bg.startClientX) / r.width) * view.w
        // The render group is y-flipped, so a downward drag raises view.y.
        const dy = ((e.clientY - bg.startClientY) / r.height) * view.h
        bg.startClientX = e.clientX
        bg.startClientY = e.clientY
        panBy(dx, dy)
      }
      return
    }

    if (rotateDrag && e.pointerId === rotateDrag.pointerId) {
      const m = toModel(e.clientX, e.clientY)
      const pointer = bearingDeg(m.x - rotateDrag.cx, m.y - rotateDrag.cy)
      let angle = rotateDrag.baseRotation + (pointer - rotateDrag.startPointerDeg)
      if (e.shiftKey) angle = Math.round(angle / 15) * 15
      setRotateDrag({ ...rotateDrag, angle })
      return
    }

    if (!drag || e.pointerId !== drag.pointerId) return
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const rawDx = ((e.clientX - drag.startX) / r.width) * view.w
    const rawDy = -((e.clientY - drag.startY) / r.height) * view.h

    const anchor = centres.find(c => c.id === drag.ids[0])
    let dx = rawDx, dy = rawDy
    let guideX: number | null = null, guideY: number | null = null

    if (anchor) {
      dx = snap(anchor.cx + rawDx) - anchor.cx
      dy = snap(anchor.cy + rawDy) - anchor.cy
      const dragging = new Set(drag.ids)
      const tolerance = guideToleranceMm()
      for (const c of centres) {
        if (dragging.has(c.id)) continue
        if (guideX === null && Math.abs(anchor.cx + rawDx - c.cx) < tolerance) {
          dx = c.cx - anchor.cx
          guideX = c.cx
        }
        if (guideY === null && Math.abs(anchor.cy + rawDy - c.cy) < tolerance) {
          dy = c.cy - anchor.cy
          guideY = c.cy
        }
      }
    }
    setDrag({ ...drag, dx, dy, guideX, guideY })
  }, [drag, rotateDrag, toModel, view.w, view.h, snap, centres, guideToleranceMm, panBy])

  // The document is mutated once, on release, so one gesture is one undo step.
  const endDrag = useCallback(() => {
    if (!drag) return
    if (drag.dx !== 0 || drag.dy !== 0) onMove(drag.ids, drag.dx, drag.dy)
    setDrag(null)
  }, [drag, onMove])

  const endRotate = useCallback(() => {
    if (!rotateDrag) return
    if (rotateDrag.angle !== rotateDrag.baseRotation) onRotate(rotateDrag.id, rotateDrag.angle)
    setRotateDrag(null)
  }, [rotateDrag, onRotate])

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    const bg = bgPointer.current
    if (bg && e.pointerId === bg.id) {
      bgPointer.current = null
      setGrabbing(false)
      if (bg.mode === 'zoom' && marquee) {
        const wide = Math.abs(marquee.x1 - marquee.x0) > 8 && Math.abs(marquee.y1 - marquee.y0) > 8
        if (wide) commitMarquee(marquee)
        setMarquee(null)
      } else if (!bg.moved) {
        onClearSelection()
      }
      return
    }
    if (rotateDrag && e.pointerId === rotateDrag.pointerId) { endRotate(); return }
    endDrag()
  }, [marquee, commitMarquee, onClearSelection, rotateDrag, endRotate, endDrag])

  const onCanvasPointerCancel = useCallback(() => {
    bgPointer.current = null
    setGrabbing(false)
    setMarquee(null)
    setDrag(null)
    setRotateDrag(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!onDropPaletteItem) return
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    try {
      const m = toModel(e.clientX, e.clientY)
      onDropPaletteItem(JSON.parse(raw), snap(m.x), snap(m.y))
    } catch { /* a drag from somewhere else in the browser */ }
  }, [onDropPaletteItem, toModel, snap])

  const stroke = view.w / 400
  const handleR = view.w / 130
  const hitR = view.w / 45

  const colours = {
    grid: dark ? theme.palette.divider : theme.palette.divider,
    stock: dark ? '#3b3f46' : '#cfcabd',
    solid: dark ? '#8d99a8' : '#c3bfb4',
    hole: dark ? '#2a2d33' : '#8d8578',
    selected: theme.palette.primary.main,
    guide: theme.palette.warning.main,
  }

  const gridLines = useMemo(() => {
    if (gridMm <= 0) return null
    // A grid finer than a few pixels is visual noise, not a reading aid.
    const spacing = gridMm
    if ((spacing / view.w) * 800 < 4) return null
    const lines: React.ReactElement[] = []
    const x0 = Math.ceil(view.x / spacing) * spacing
    const y0 = Math.ceil(view.y / spacing) * spacing
    for (let x = x0; x < view.x + view.w; x += spacing) {
      lines.push(<line key={`v${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} />)
    }
    for (let y = y0; y < view.y + view.h; y += spacing) {
      lines.push(<line key={`h${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} />)
    }
    return lines
  }, [gridMm, view])

  const selectedShape = selection.size === 1
    ? shapes.find(s => selection.has(s.id))
    : undefined

  return (
    <Box sx={{ position: 'absolute', inset: 0, minHeight: 0 }}>
      <Box
        component="svg"
        ref={svgRef}
        role="application"
        aria-label={
          'Design canvas. Drag a shape to move it; drag a corner handle to rotate it; '
          + 'drag the background to pan; hold Shift and drag to zoom to a region; '
          + 'scroll to zoom.'
        }
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={onWheel}
        onPointerDown={beginBackground}
        onPointerMove={onPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerCancel}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        sx={{
          width: '100%', height: '100%', display: 'block', touchAction: 'none',
          cursor: grabbing ? 'grabbing' : 'default',
        }}
      >
        {/* Model space is y-up; flip once here rather than negating every value. */}
        <g transform={`translate(0, ${2 * view.y + view.h}) scale(1, -1)`}>
          {gridLines && (
            <g stroke={colours.grid} strokeWidth={stroke * 0.5} opacity={0.5}>{gridLines}</g>
          )}
          {stockMm && (
            <rect
              x={0} y={0} width={stockMm.widthMm} height={stockMm.heightMm}
              fill="none" stroke={colours.stock} strokeWidth={stroke * 1.5}
              strokeDasharray={`${stroke * 6} ${stroke * 4}`}
            />
          )}

          {drag?.guideX != null && (
            <line
              x1={drag.guideX} y1={view.y} x2={drag.guideX} y2={view.y + view.h}
              stroke={colours.guide} strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 3}`}
            />
          )}
          {drag?.guideY != null && (
            <line
              x1={view.x} y1={drag.guideY} x2={view.x + view.w} y2={drag.guideY}
              stroke={colours.guide} strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 3}`}
            />
          )}

          {paths.map(({ shape, d }) => {
            const selected = selection.has(shape.id)
            const moving = selected && drag ? { x: drag.dx, y: drag.dy } : null
            const turning = rotateDrag?.id === shape.id ? rotateDrag : null
            const b = multiBBox(shape.polygons)
            const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
            const transform = [
              moving ? `translate(${moving.x},${moving.y})` : '',
              turning ? `rotate(${turning.angle - turning.baseRotation} ${cx} ${cy})` : '',
            ].filter(Boolean).join(' ')

            return (
              <g key={shape.id} transform={transform || undefined}>
                <path
                  d={d}
                  fill={shape.mode === 'hole' ? colours.hole : colours.solid}
                  fillOpacity={shape.mode === 'hole' ? 0.85 : 1}
                  fillRule="evenodd"
                  stroke={selected ? colours.selected : 'none'}
                  strokeWidth={selected ? stroke * 2 : 0}
                  style={{ cursor: shape.locked ? 'not-allowed' : 'move' }}
                  onPointerDown={e => beginDrag(e, shape)}
                />
              </g>
            )
          })}

          {/* Rotate handles, only with exactly one selection -- with several,
              there is no single centre a turn would obviously be about. */}
          {selectedShape && !drag && (() => {
            const b = ringBBox(selectedShape.polygons.flat()[0] ?? [])
            if (!Number.isFinite(b.minX)) return null
            const corners: [number, number][] = [
              [b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY],
            ]
            return corners.map(([hx, hy], i) => (
              <g key={i}>
                <circle
                  cx={hx} cy={hy} r={handleR}
                  fill="none" stroke={colours.selected} strokeWidth={stroke * 1.5}
                />
                <circle
                  cx={hx} cy={hy} r={hitR} fill="transparent"
                  style={{ cursor: 'grab' }}
                  onPointerDown={e => beginRotate(e, selectedShape)}
                />
              </g>
            ))
          })()}
        </g>
      </Box>

      {marquee && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute', pointerEvents: 'none',
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
            border: theme => `1px dashed ${theme.palette.primary.main}`,
            bgcolor: theme => `${theme.palette.primary.main}14`,
          }}
        />
      )}

      {!shapes.length && emptyHint && (
        <Box
          sx={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
            pointerEvents: 'none', color: 'text.secondary', px: 3, textAlign: 'center',
          }}
        >
          {emptyHint}
        </Box>
      )}

      <Stack
        direction="row" spacing={0.5}
        sx={{ position: 'absolute', right: 8, bottom: 8 }}
      >
        <Tooltip title="Zoom out" describeChild>
          <IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom in" describeChild>
          <IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit to design" describeChild>
          <IconButton size="small" aria-label="Fit to design" onClick={() => fit(contentBBox)}>
            <CenterFocusStrongRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
