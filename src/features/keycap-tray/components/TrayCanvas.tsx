import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, Stack, Tooltip, useTheme } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import type { Issue } from '../geometry/validate.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { pocketRing } from '../geometry/shapes.ts'
import { profileToMulti } from '../model/presets.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { offsetRingInward } from '../../../geometry/offset.ts'
import { pocketExtent } from '../state/useTrayDesign.ts'
import type { PaletteItem } from '../model/defaults.ts'

const ringToPath = (r: Ring): string =>
  `${r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`).join('')}Z`

export interface TrayCanvasProps {
  design: TrayDesign
  selection: Set<string>
  issues: Issue[]
  snapMm: number
  gridMm: number
  showPlate: boolean
  showLabels: boolean
  showBuffer: boolean
  bufferMm: number
  /** Pixels hidden behind the surrounding panels, so fit-to-view centres correctly. */
  inset: { left: number; right: number; top: number; bottom: number }
  fitToken: number
  plateWidthMm: number
  plateDepthMm: number
  onSelect: (id: string, additive: boolean) => void
  onClearSelection: () => void
  onMove: (ids: Iterable<string>, dx: number, dy: number) => void
  onRotate: (id: string, deg: number) => void
  onDropItem: (item: PaletteItem, x: number, y: number) => void
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  ids: string[]
  /** Model-space position of a matched alignment guide, if any, for this axis. */
  guideX: number | null
  guideY: number | null
}

interface RotateState {
  pointerId: number
  id: string
  /** Rotation pivot, model mm. */
  cx: number
  cy: number
  /** Pointer bearing about the pivot at press, degrees. */
  startPointerDeg: number
  /** The pocket's angle at press. */
  baseRotation: number
  /** Live angle for the preview and the commit. */
  angle: number
}

const bearingDeg = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI

/**
 * The whole scene is mirrored so the model can stay y-up, which would render
 * text upside down. Flip back around the label's own centre.
 */
function PocketLabel(
  { pocket, design, ink }: { pocket: Pocket; design: TrayDesign; ink: string },
) {
  const { w, h } = pocketExtent(pocket, design.sizing)
  // The ISO Enter bbox centre sits right on the notch boundary -- anchor to
  // the wider bottom row instead, which is solid material end to end.
  const cx = pocket.x + w / 2
  const cy = pocket.shape === 'iso-enter' ? pocket.y + h / 4 : pocket.y + h / 2
  const labelH = pocket.shape === 'iso-enter' ? h / 2 : h
  const size = Math.min(labelH * 0.5, w * 0.6, 9)
  return (
    <text
      x={cx}
      y={cy}
      transform={`translate(0, ${2 * cy}) scale(1, -1)`}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      fontFamily="system-ui, sans-serif"
      fill={ink}
      opacity={0.7}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {pocket.label ?? `${pocket.units}u`}
    </text>
  )
}

/**
 * Four grab points at the (rotated) footprint corners of the sole selected
 * pocket. Dragging any of them spins the pocket about its centre. Drawn inside
 * the y-flipped group, so positions are model mm and radii scale with the zoom.
 */
function RotateHandles(
  { cx, cy, x, y, w, h, angleDeg, viewW, color, onBegin }: {
    cx: number; cy: number; x: number; y: number; w: number; h: number
    angleDeg: number; viewW: number; color: string
    onBegin: (e: React.PointerEvent) => void
  },
) {
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  const rot = (px: number, py: number): [number, number] => {
    const dx = px - cx, dy = py - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
  }
  const corners = [rot(x, y), rot(x + w, y), rot(x + w, y + h), rot(x, y + h)]
  const rVis = viewW / 130
  const rHit = viewW / 45
  return (
    <g>
      {corners.map(([hx, hy], i) => (
        <g key={i}>
          <circle
            cx={hx} cy={hy} r={rHit} fill="transparent"
            role="button" aria-label="Rotate pocket"
            onPointerDown={onBegin}
            style={{ cursor: 'grab' }}
          />
          <circle
            cx={hx} cy={hy} r={rVis} fill="none"
            stroke={color} strokeWidth={viewW / 400}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      ))}
    </g>
  )
}

export default function TrayCanvas(props: TrayCanvasProps) {
  const {
    design, selection, issues, snapMm, gridMm, showPlate, showLabels, inset, fitToken,
    plateWidthMm, plateDepthMm, showBuffer, bufferMm,
    onSelect, onClearSelection, onMove, onRotate, onDropItem,
  } = props

  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState({ x: -12, y: -12, w: 280, h: 200 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [rotateDrag, setRotateDrag] = useState<RotateState | null>(null)
  // Background gesture: a plain drag on empty canvas pans the view; holding
  // Shift instead rubber-bands a region to zoom into. `marquee` (client pixels
  // relative to the SVG) drives the zoom rectangle overlay; `grabbing` only
  // swaps the cursor while panning.
  const [marquee, setMarquee] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null)
  const [grabbing, setGrabbing] = useState(false)
  const bgPointer = useRef<
    | {
        id: number
        mode: 'pan' | 'zoom'
        startClientX: number
        startClientY: number
        viewX: number
        viewY: number
        moved: boolean
      }
    | null
  >(null)

  const profileRings = useMemo(() => profileToMulti(design.profile), [design.profile])
  const profilePath = useMemo(
    () => profileRings.flat().map(ringToPath).join(' '), [profileRings])

  // The panels frame the canvas, so fitting to the raw element size would tuck
  // the tray under them. Inflate the viewBox by the hidden fraction instead,
  // then shift by the left/top inset.
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

  const pocketPaths = useMemo(
    () => design.pockets.map(p => ({ p, d: ringToPath(pocketRing(p, design.sizing)[0]) })),
    // The pockets array and sizing are both replaced on every edit.
    [design.pockets, design.sizing],
  )

  // Alignment-guide targets: every pocket's own centre, plus the tray's.
  // Recomputed on every pockets/sizing change, not on every drag frame.
  const pocketCenters = useMemo(
    () => design.pockets.map(p => {
      const { w, h } = pocketExtent(p, design.sizing)
      return { id: p.id, cx: p.x + w / 2, cy: p.y + h / 2 }
    }),
    [design.pockets, design.sizing],
  )
  const trayCenter = useMemo(() => {
    const b = multiBBox(profileRings)
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }
  }, [profileRings])

  const flagged = useMemo(() => {
    const errors = new Set<string>()
    const warnings = new Set<string>()
    for (const i of issues) {
      for (const id of i.pocketIds ?? []) (i.severity === 'error' ? errors : warnings).add(id)
    }
    return { errors, warnings }
  }, [issues])

  /** Client pixels -> model mm, accounting for the current viewBox. */
  const toModel = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    const x = view.x + ((clientX - r.left) / r.width) * view.w
    // SVG y grows downward; the model is y-up, and the group is flipped to match.
    const y = view.y + view.h - ((clientY - r.top) / r.height) * view.h
    return { x, y }
  }, [view])

  const snap = useCallback((v: number) => (snapMm > 0 ? Math.round(v / snapMm) * snapMm : v), [snapMm])

  // Same clamp as the wheel handler, but zooms on the view's own centre --
  // for the toolbar buttons, where there's no cursor position to anchor on.
  const zoomBy = useCallback((factor: number) => {
    setView(v => {
      const w = Math.min(2000, Math.max(20, v.w * factor))
      const h = w * (v.h / v.w)
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2
      return { x: cx - w / 2, y: cy - h / 2, w, h }
    })
  }, [])

  // Zoom the view to the dragged region, growing the short axis so it fills the
  // viewport without distorting, then clamping to the same limits as the wheel.
  const commitMarqueeZoom = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number }) => {
      const el = svgRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const a = toModel(r.left + box.x0, r.top + box.y0)
      const b = toModel(r.left + box.x1, r.top + box.y1)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      let w = Math.max(Math.abs(a.x - b.x), 1e-3)
      let h = Math.max(Math.abs(a.y - b.y), 1e-3)
      const ratio = view.w / view.h
      if (w / h > ratio) h = w / ratio
      else w = h * ratio
      w = Math.min(2000, Math.max(20, w))
      h = w / ratio
      setView({ x: cx - w / 2, y: cy - h / 2, w, h })
    },
    [toModel, view.w, view.h],
  )

  const beginBackground = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = svgRef.current
    if (!el) return
    const zoom = e.shiftKey
    bgPointer.current = {
      id: e.pointerId,
      mode: zoom ? 'zoom' : 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
    }
    if (zoom) {
      const r = el.getBoundingClientRect()
      setMarquee({
        x0: e.clientX - r.left, y0: e.clientY - r.top,
        x1: e.clientX - r.left, y1: e.clientY - r.top,
      })
    } else {
      setGrabbing(true)
    }
    try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }, [view.x, view.y])

  const onWheel = useCallback((e: React.WheelEvent) => {
    // preventDefault is handled by the non-passive native listener below;
    // calling it here too logs a passive-listener violation on every scroll.
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1
    const m = toModel(e.clientX, e.clientY)
    setView(v => {
      const w = Math.min(2000, Math.max(20, v.w * factor))
      const h = w * (v.h / v.w)
      // Keep the point under the cursor fixed.
      return { x: m.x - (m.x - v.x) * (w / v.w), y: m.y - (m.y - v.y) * (h / v.h), w, h }
    })
  }, [toModel])

  const beginDrag = useCallback((e: React.PointerEvent, pocket: Pocket) => {
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const ids = selection.has(pocket.id) && !additive
      ? [...selection]
      : (additive ? [...new Set([...selection, pocket.id])] : [pocket.id])
    onSelect(pocket.id, additive)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, ids,
      guideX: null, guideY: null,
    })
  }, [selection, onSelect])

  const beginRotate = useCallback((e: React.PointerEvent, pocket: Pocket) => {
    e.stopPropagation()
    const { w, h } = pocketExtent(pocket, design.sizing)
    const cx = pocket.x + w / 2, cy = pocket.y + h / 2
    const m = toModel(e.clientX, e.clientY)
    setRotateDrag({
      pointerId: e.pointerId,
      id: pocket.id,
      cx, cy,
      startPointerDeg: bearingDeg(m.x - cx, m.y - cy),
      baseRotation: pocket.rotationDeg ?? 0,
      angle: pocket.rotationDeg ?? 0,
    })
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }, [design.sizing, toModel])

  // Screen-pixel snap radius for alignment guides, converted to model mm at
  // the current zoom so it feels like a constant ~6 px regardless of scale.
  const guideToleranceMm = useCallback((rectWidth: number) => (6 / rectWidth) * view.w, [view.w])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const bg = bgPointer.current
    if (bg && bg.id === e.pointerId) {
      const el = svgRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const dxPx = e.clientX - bg.startClientX
      const dyPx = e.clientY - bg.startClientY
      if (!bg.moved && Math.hypot(dxPx, dyPx) > 3) bg.moved = true
      if (bg.mode === 'pan') {
        // Keep the grabbed model point under the cursor. The group is y-flipped,
        // so a downward drag raises view.y.
        setView(v => ({
          ...v,
          x: bg.viewX - (dxPx / r.width) * v.w,
          y: bg.viewY + (dyPx / r.height) * v.h,
        }))
      } else {
        setMarquee(m => (m ? { ...m, x1: e.clientX - r.left, y1: e.clientY - r.top } : m))
      }
      return
    }
    if (rotateDrag && e.pointerId === rotateDrag.pointerId) {
      const m = toModel(e.clientX, e.clientY)
      const cur = bearingDeg(m.x - rotateDrag.cx, m.y - rotateDrag.cy)
      let deg = rotateDrag.baseRotation + (cur - rotateDrag.startPointerDeg)
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((deg % 360) + 360) % 360
      setRotateDrag(d => (d ? { ...d, angle: deg } : d))
      return
    }
    if (!drag || e.pointerId !== drag.pointerId) return
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const rawDx = ((e.clientX - drag.startX) / r.width) * view.w
    const rawDy = -((e.clientY - drag.startY) / r.height) * view.h

    // Anchor on the first dragged pocket -- good enough for multi-select too,
    // since the group moves together.
    const anchor = design.pockets.find(p => p.id === drag.ids[0])
    let dx = snap(rawDx), dy = snap(rawDy), guideX: number | null = null, guideY: number | null = null

    if (anchor) {
      const { w, h } = pocketExtent(anchor, design.sizing)
      const origCx = anchor.x + w / 2, origCy = anchor.y + h / 2
      const tol = guideToleranceMm(r.width)
      const dragging = new Set(drag.ids)
      const xTargets = [trayCenter.cx, ...pocketCenters.filter(c => !dragging.has(c.id)).map(c => c.cx)]
      const yTargets = [trayCenter.cy, ...pocketCenters.filter(c => !dragging.has(c.id)).map(c => c.cy)]

      let bestX = Infinity
      for (const t of xTargets) {
        const d = Math.abs(origCx + rawDx - t)
        if (d < tol && d < bestX) { bestX = d; dx = t - origCx; guideX = t }
      }
      let bestY = Infinity
      for (const t of yTargets) {
        const d = Math.abs(origCy + rawDy - t)
        if (d < tol && d < bestY) { bestY = d; dy = t - origCy; guideY = t }
      }
    }

    setDrag(d => (d ? { ...d, dx, dy, guideX, guideY } : d))
  }, [drag, rotateDrag, toModel, view, snap, design.pockets, design.sizing,
      pocketCenters, trayCenter, guideToleranceMm])

  const endDrag = useCallback(() => {
    if (!drag) return
    if (drag.dx !== 0 || drag.dy !== 0) onMove(drag.ids, drag.dx, drag.dy)
    setDrag(null)
  }, [drag, onMove])

  const endRotate = useCallback(() => {
    if (!rotateDrag) return
    if (Math.abs(rotateDrag.angle - rotateDrag.baseRotation) > 1e-6) {
      onRotate(rotateDrag.id, rotateDrag.angle)
    }
    setRotateDrag(null)
  }, [rotateDrag, onRotate])

  // Background pointer released. Shift-drag frames a zoom region; a plain drag
  // has already panned the view; a bare click (either mode, no real movement)
  // clears the selection, as clicking empty canvas always did.
  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    if (rotateDrag && e.pointerId === rotateDrag.pointerId) { endRotate(); return }
    const bg = bgPointer.current
    if (bg && bg.id === e.pointerId) {
      bgPointer.current = null
      setGrabbing(false)
      const box = marquee
      setMarquee(null)
      if (bg.mode === 'zoom' && box) {
        const moved = Math.hypot(box.x1 - box.x0, box.y1 - box.y0)
        if (moved < 5) onClearSelection()
        else commitMarqueeZoom(box)
      } else if (!bg.moved) {
        onClearSelection()
      }
      return
    }
    endDrag()
  }, [rotateDrag, endRotate, marquee, endDrag, onClearSelection, commitMarqueeZoom])

  const onCanvasPointerCancel = useCallback((e: React.PointerEvent) => {
    if (rotateDrag && e.pointerId === rotateDrag.pointerId) { setRotateDrag(null); return }
    if (bgPointer.current?.id === e.pointerId) {
      bgPointer.current = null
      setGrabbing(false)
      setMarquee(null)
      return
    }
    endDrag()
  }, [rotateDrag, endDrag])

  // Dropping from the palette.
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    let item: PaletteItem
    try { item = JSON.parse(raw) } catch { return }
    const m = toModel(e.clientX, e.clientY)
    // Drop centres the pocket under the cursor.
    const { w, h } = pocketExtent(
      { id: '', units: item.units, x: 0, y: 0, shape: item.shape, widthMm: item.widthMm, heightMm: item.heightMm },
      design.sizing,
    )
    onDropItem(item, snap(m.x - w / 2), snap(m.y - h / 2))
  }, [toModel, snap, design.sizing, onDropItem])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    // React attaches wheel passively, which blocks preventDefault.
    const handler = (ev: WheelEvent) => ev.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const ink = theme.palette.text.primary
  const stock = dark ? '#2A2D33' : '#FFFFFF'
  const pocketFill = dark ? 'rgba(237,237,236,0.10)' : 'rgba(27,26,24,0.06)'
  const selFill = dark ? 'rgba(121,182,228,0.30)' : 'rgba(31,92,139,0.18)'
  const guideColor = theme.palette.primary.main
  const plateColor = theme.palette.success.main
  const bufferColor = theme.palette.warning.main

  // Grid fades out past a density where the lines would just be noise --
  // zoomed way out at a 2 mm pitch would draw thousands of them.
  const grid = useMemo(() => {
    if (gridMm <= 0) return null
    const startX = Math.floor(view.x / gridMm) * gridMm
    const startY = Math.floor(view.y / gridMm) * gridMm
    const vCount = Math.ceil(view.w / gridMm)
    const hCount = Math.ceil(view.h / gridMm)
    if (vCount > 400 || hCount > 400) return null
    const vLines = Array.from({ length: vCount + 1 }, (_, i) => startX + i * gridMm)
    const hLines = Array.from({ length: hCount + 1 }, (_, i) => startY + i * gridMm)
    return { vLines, hLines }
  }, [gridMm, view])

  // Follows the tray's actual outline (notches and all) rather than insetting
  // its bounding box, so the guide is accurate on a non-rectangular profile.
  const bufferPath = useMemo(() => {
    if (!showBuffer || bufferMm <= 0) return null
    const rings = profileRings
      .map(poly => offsetRingInward(poly[0], bufferMm))
      .filter((r): r is Ring => r !== null)
    return rings.length ? rings.map(ringToPath).join(' ') : null
  }, [showBuffer, bufferMm, profileRings])

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="application"
        aria-label={
          `Tray layout, ${design.pockets.length} pockets. `
          + 'Drag a pocket to move it; drag a corner handle to rotate it; '
          + 'drag the background to pan; hold Shift and drag to zoom to a region; '
          + 'scroll to zoom.'
        }
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerCancel}
        onPointerDown={beginBackground}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        style={{
          display: 'block',
          touchAction: 'none',
          cursor: grabbing || rotateDrag ? 'grabbing' : 'grab',
        }}
      >
        {/* Model space is y-up; flip once here so all geometry below is in mm. */}
        <g transform={`translate(0, ${2 * view.y + view.h}) scale(1, -1)`}>
          {showPlate && (
            <rect
              x={0} y={0} width={plateWidthMm} height={plateDepthMm}
              fill="none" stroke={plateColor}
              strokeWidth={view.w / 600} strokeDasharray={`${view.w / 120} ${view.w / 120}`}
            />
          )}

          <path d={profilePath} fill={stock}
                stroke={ink} strokeWidth={view.w / 800} />

          {grid && (
            <g stroke={ink} strokeOpacity={dark ? 0.14 : 0.16} strokeWidth={view.w / 1400}>
              {grid.vLines.map(x => (
                <line key={`v${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} />
              ))}
              {grid.hLines.map(y => (
                <line key={`h${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} />
              ))}
            </g>
          )}

          {bufferPath && (
            <path
              d={bufferPath}
              fill="none" stroke={bufferColor}
              strokeWidth={view.w / 700} strokeDasharray={`${view.w / 250} ${view.w / 250}`}
            />
          )}

          {drag?.guideX != null && (
            <line x1={drag.guideX} y1={view.y} x2={drag.guideX} y2={view.y + view.h}
                  stroke={guideColor} strokeWidth={view.w / 600} strokeDasharray={`${view.w / 180} ${view.w / 300}`} />
          )}
          {drag?.guideY != null && (
            <line x1={view.x} y1={drag.guideY} x2={view.x + view.w} y2={drag.guideY}
                  stroke={guideColor} strokeWidth={view.w / 600} strokeDasharray={`${view.w / 180} ${view.w / 300}`} />
          )}

          {pocketPaths.map(({ p, d }) => {
            const selected = selection.has(p.id)
            const dragging = selected && drag ? { x: drag.dx, y: drag.dy } : null
            const isError = flagged.errors.has(p.id)
            const isWarn = !isError && flagged.warnings.has(p.id)
            const { w, h } = pocketExtent(p, design.sizing)
            const pcx = p.x + w / 2, pcy = p.y + h / 2
            const rotating = rotateDrag && rotateDrag.id === p.id ? rotateDrag : null
            // The committed geometry already bakes baseRotation; only the live
            // delta needs an SVG rotate. Same matrix as rotateRing, y-up frame.
            const previewDeg = rotating ? rotating.angle - rotating.baseRotation : 0
            return (
              <g key={p.id} transform={dragging ? `translate(${dragging.x},${dragging.y})` : undefined}>
                <g transform={previewDeg ? `rotate(${previewDeg} ${pcx} ${pcy})` : undefined}>
                  <path
                    d={d}
                    fill={selected ? selFill : pocketFill}
                    stroke={isError
                      ? theme.palette.error.main
                      : isWarn
                        ? theme.palette.warning.main
                        : selected ? theme.palette.primary.main : ink}
                    strokeWidth={(isError || isWarn || selected ? 2.2 : 1) * (view.w / 800)}
                    onPointerDown={e => beginDrag(e, p)}
                    style={{ cursor: 'move' }}
                  />
                </g>
                {showLabels && <PocketLabel pocket={p} design={design} ink={ink} />}
                {selected && selection.size === 1 && (
                  <RotateHandles
                    cx={pcx} cy={pcy} x={p.x} y={p.y} w={w} h={h}
                    angleDeg={rotating ? rotating.angle : (p.rotationDeg ?? 0)}
                    viewW={view.w}
                    color={theme.palette.primary.main}
                    onBegin={e => beginRotate(e, p)}
                  />
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {marquee && (
        <Box
          sx={{
            position: 'absolute',
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
            border: `1px dashed ${theme.palette.primary.main}`,
            bgcolor: dark ? 'rgba(121,182,228,0.14)' : 'rgba(31,92,139,0.12)',
            borderRadius: '2px',
            pointerEvents: 'none',
          }}
        />
      )}

      <Stack
        sx={{
          position: 'absolute', bottom: 8, right: 8,
          bgcolor: 'background.paper', borderRadius: 1, boxShadow: 1,
        }}
      >
        <Tooltip title="Zoom in" placement="left">
          <IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(1 / 1.2)}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out" placement="left">
          <IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(1.2)}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
