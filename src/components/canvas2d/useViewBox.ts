// The 2D canvas viewport: an SVG viewBox plus the gestures that move it.
//
// Extracted from src/features/keycap-tray/components/TrayCanvas.tsx, which is
// where these behaviours were worked out and proven. The keycap canvas and the
// Shaper canvas both drive this hook, so pan, cursor-anchored zoom, shift-drag
// zoom-to-region and fit-to-content stay identical between them.
import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { BBox } from '../../geometry/vec.ts'

export interface ViewBox { x: number; y: number; w: number; h: number }

export interface Inset { left: number; right: number; top: number; bottom: number }

export const NO_INSET: Inset = { left: 0, right: 0, top: 0, bottom: 0 }

/** Model-space width limits. Below 20 mm across, a millimetre design is all
 *  cursor; above 2000 mm it is a dot. */
const MIN_VIEW_MM = 20
const MAX_VIEW_MM = 2_000

/** Alignment guides should feel like a constant few pixels at any zoom. */
const GUIDE_PIXELS = 6

export interface MarqueeBox { x0: number; y0: number; x1: number; y1: number }

export interface ViewBoxApi {
  view: ViewBox
  /** Client pixels -> model millimetres, honouring the y-up flip. */
  toModel: (clientX: number, clientY: number) => { x: number; y: number }
  /** Zoom about the view's own centre, for toolbar buttons. */
  zoomBy: (factor: number) => void
  /** Zoom about the cursor, for the wheel. */
  zoomAt: (clientX: number, clientY: number, factor: number) => void
  /** Frame `bbox`, inflated so the framing panels do not cover the content. */
  fit: (bbox: BBox) => void
  panBy: (dxModel: number, dyModel: number) => void
  setView: (view: ViewBox) => void
  /** Zoom to a rubber-banded region, in client pixels relative to the element. */
  commitMarquee: (box: MarqueeBox) => void
  /** Model millimetres corresponding to GUIDE_PIXELS on screen right now. */
  guideToleranceMm: () => number
}

const clampWidth = (w: number): number => Math.min(MAX_VIEW_MM, Math.max(MIN_VIEW_MM, w))

export function useViewBox(
  elementRef: RefObject<SVGSVGElement | null>,
  initial: ViewBox = { x: -12, y: -12, w: 280, h: 200 },
  inset: Inset = NO_INSET,
): ViewBoxApi {
  const [view, setViewState] = useState<ViewBox>(initial)
  // Gesture handlers read the current view without re-binding every frame.
  const viewRef = useRef(view)
  viewRef.current = view

  const rect = useCallback(() => elementRef.current?.getBoundingClientRect() ?? null, [elementRef])

  const toModel = useCallback((clientX: number, clientY: number) => {
    const r = rect()
    if (!r || !r.width || !r.height) return { x: 0, y: 0 }
    const v = viewRef.current
    return {
      x: v.x + ((clientX - r.left) / r.width) * v.w,
      // SVG y grows downward; the model is y-up and the render group is flipped.
      y: v.y + v.h - ((clientY - r.top) / r.height) * v.h,
    }
  }, [rect])

  const zoomBy = useCallback((factor: number) => {
    setViewState(v => {
      const w = clampWidth(v.w * factor)
      const h = w * (v.h / v.w)
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2
      return { x: cx - w / 2, y: cy - h / 2, w, h }
    })
  }, [])

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const m = toModel(clientX, clientY)
    setViewState(v => {
      const w = clampWidth(v.w * factor)
      const h = w * (v.h / v.w)
      // Keep the point under the cursor fixed.
      return { x: m.x - (m.x - v.x) * (w / v.w), y: m.y - (m.y - v.y) * (h / v.h), w, h }
    })
  }, [toModel])

  const panBy = useCallback((dxModel: number, dyModel: number) => {
    setViewState(v => ({ ...v, x: v.x + dxModel, y: v.y + dyModel }))
  }, [])

  const setView = useCallback((next: ViewBox) => setViewState(next), [])

  /**
   * The panels frame the canvas, so fitting to the raw element size would tuck
   * the content under them. Inflate the viewBox by the hidden fraction instead,
   * then shift by the left/top inset.
   */
  const fit = useCallback((bbox: BBox) => {
    const r = rect()
    if (!r || !r.width || !r.height) return
    if (!Number.isFinite(bbox.minX) || bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) return

    const usableW = Math.max(80, r.width - inset.left - inset.right)
    const usableH = Math.max(80, r.height - inset.top - inset.bottom)
    const margin = 1.06
    const scale = Math.min(
      usableW / ((bbox.maxX - bbox.minX) * margin),
      usableH / ((bbox.maxY - bbox.minY) * margin),
    )
    if (!Number.isFinite(scale) || scale <= 0) return

    const w = r.width / scale
    const h = r.height / scale
    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2
    setViewState({
      x: cx - w / 2 + ((inset.right - inset.left) / 2) / scale,
      y: cy - h / 2 - ((inset.top - inset.bottom) / 2) / scale,
      w, h,
    })
  }, [rect, inset])

  /** Grow the short axis so the region fills the viewport without distorting,
   *  then clamp to the same limits as the wheel. */
  const commitMarquee = useCallback((box: MarqueeBox) => {
    const r = rect()
    if (!r) return
    const a = toModel(r.left + box.x0, r.top + box.y0)
    const b = toModel(r.left + box.x1, r.top + box.y1)
    const v = viewRef.current
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    let w = Math.max(Math.abs(a.x - b.x), 1e-3)
    let h = Math.max(Math.abs(a.y - b.y), 1e-3)
    const ratio = v.w / v.h
    if (w / h > ratio) h = w / ratio
    else w = h * ratio
    w = clampWidth(w)
    h = w / ratio
    setViewState({ x: cx - w / 2, y: cy - h / 2, w, h })
  }, [rect, toModel])

  const guideToleranceMm = useCallback(() => {
    const r = rect()
    if (!r || !r.width) return 0
    return (GUIDE_PIXELS / r.width) * viewRef.current.w
  }, [rect])

  return { view, toModel, zoomBy, zoomAt, fit, panBy, setView, commitMarquee, guideToleranceMm }
}

/** Stroke widths and handle radii are expressed against the view width so they
 *  stay a constant size on screen at any zoom. */
export const screenScaled = (viewWidth: number, divisor: number): number => viewWidth / divisor
