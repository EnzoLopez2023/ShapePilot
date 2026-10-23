import { useEffect, useRef } from 'react'
import { Box, useTheme } from '@mui/material'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Mesh as SolidMesh } from '../../geometry/mesh.ts'
import {
  addSolidLighting, buildEdges, disposeBody, edgeColourFor, solidMaterial,
} from './solidRender.ts'

/** A second body drawn beside the main one, in its own colour. */
export interface SolidViewerBody {
  mesh: SolidMesh
  /** CSS colour; absent draws it in the default body colour. */
  color?: string
}

/** A flat rectangular outline drawn in the XY plane, e.g. a machine's reach. */
export interface SolidViewerOutline {
  x0: number; y0: number; x1: number; y1: number
  z?: number
  /** CSS colour. */
  color?: string
}

/** A measured span drawn as a dimension line with its text beside it. */
export interface SolidViewerDimension {
  from: readonly [number, number, number]
  to: readonly [number, number, number]
  /** Already formatted, so the caller owns the unit toggle. */
  text: string
}

export interface SolidViewer3DProps {
  mesh: SolidMesh
  /** Announced to screen readers -- "tray", "switch tray plate", ... */
  label?: string
  /** The main body's colour; absent uses the neutral default. */
  color?: string
  /** Bodies exported separately, e.g. a nameplate in a second filament. */
  extras?: readonly SolidViewerBody[]
  /**
   * Which axis the orbit keeps upright. Trays lie flat and read best orbiting
   * about Y; something standing on Z, like the tray cabinet, wants 'z'. Read
   * once, when the viewer mounts.
   */
  up?: 'y' | 'z'
  /** Reference outlines drawn alongside the body; they do not affect framing. */
  outlines?: readonly SolidViewerOutline[]
  /** Dimension lines with text labels; like outlines they do not affect framing. */
  dimensions?: readonly SolidViewerDimension[]
}

/**
 * Plain three.js rather than react-three-fiber: this is one static mesh and an
 * orbit camera, and the reconciler would only add weight to the bundle.
 *
 * Shared by every tray-shaped designer -- it only ever needed a `Mesh`.
 */
export default function SolidViewer3D(
  { mesh, label = 'the model', color, extras, up = 'y', outlines, dimensions }: SolidViewer3DProps,
) {
  const upRef = useRef(up)
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    bodies: THREE.Mesh[]
    /** The mesh the camera was last framed on; a recolour keeps the view. */
    framed?: SolidMesh
    raf: number
    /** Dimension texts follow their 3D anchor; moved every frame. */
    labels: { pos: THREE.Vector3; el: HTMLElement }[]
  } | null>(null)

  // Scene setup runs once; the mesh is swapped separately below.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // The canvas has no intrinsic CSS size, so without this it lays out at its
    // drawing-buffer size in CSS pixels and overflows the host by the pixel ratio.
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
    // OrbitControls takes its upright axis from the camera when it is built.
    if (upRef.current === 'z') camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    addSolidLighting(scene)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h, false) // style is fixed at 100%; only the buffer changes
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const state: NonNullable<typeof stateRef.current> =
      { renderer, scene, camera, controls, bodies: [], raf: 0, labels: [] }
    stateRef.current = state
    const loop = () => {
      state.raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
      const { clientWidth: w, clientHeight: h } = host
      const v = new THREE.Vector3()
      for (const l of state.labels) {
        v.copy(l.pos).project(camera)
        const behind = v.z > 1
        l.el.style.display = behind ? 'none' : ''
        // Kept inside the view, so a line near the edge never loses its text.
        const hw = l.el.offsetWidth / 2, hh = l.el.offsetHeight / 2
        const x = Math.min(Math.max((v.x + 1) / 2 * w, hw), w - hw)
        const y = Math.min(Math.max((1 - v.y) / 2 * h, hh), h - hh)
        l.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`
      }
    }
    loop()

    return () => {
      cancelAnimationFrame(state.raf)
      ro.disconnect()
      controls.dispose()
      for (const body of state.bodies) disposeBody(body)
      renderer.dispose()
      host.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Geometry swap. Disposing the previous BufferGeometry is what keeps a
  // non-R3F three integration from leaking GPU buffers on every edit.
  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    for (const body of state.bodies) {
      state.scene.remove(body)
      disposeBody(body)
    }
    state.bodies = []

    const neutral = dark ? 0xb9b0a2 : 0xd8d2c6
    for (const body of [{ mesh, color }, ...(extras ?? [])]) {
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(body.mesh.positions, 3))
      geom.setIndex(new THREE.BufferAttribute(body.mesh.indices, 1))
      // Deliberately no computeVertexNormals -- see solidRender.solidMaterial.
      // The mesher welds vertices, so averaging normals there would smooth the
      // tray's flat top into the pocket walls.

      const obj = new THREE.Mesh(geom, solidMaterial({ color: body.color ?? neutral }))
      const edges = buildEdges(geom, edgeColourFor(dark), body.mesh.triangleCount)
      if (edges) obj.add(edges)
      state.scene.add(obj)
      state.bodies.push(obj)
    }

    if (state.framed === mesh) return
    state.framed = mesh
    const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bbox
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 100
    state.controls.target.set(cx, cy, cz)
    if (upRef.current === 'z') {
      // A standing part is as tall as it is wide, so the tray framing below
      // crops it. Back off until the whole bounding sphere is in view, from a
      // three-quarter view a little above eye level.
      const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 50
      const fit = radius / Math.sin(THREE.MathUtils.degToRad(state.camera.fov / 2))
      const dir = new THREE.Vector3(0.6, -1, 0.5).normalize().multiplyScalar(fit * 1.05)
      state.camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z)
    } else {
      state.camera.position.set(cx + span * 0.55, cy - span * 0.95, cz + span * 0.85)
    }
    state.camera.near = span / 100
    state.camera.far = span * 20
    state.camera.updateProjectionMatrix()
    state.controls.update()
  }, [mesh, color, extras, dark])

  useEffect(() => {
    const state = stateRef.current
    if (!state || !outlines?.length) return
    const group = new THREE.Group()
    for (const o of outlines) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(o.x0, o.y0, o.z ?? 0), new THREE.Vector3(o.x1, o.y0, o.z ?? 0),
        new THREE.Vector3(o.x1, o.y1, o.z ?? 0), new THREE.Vector3(o.x0, o.y1, o.z ?? 0),
      ])
      group.add(new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color: o.color ?? '#3b82f6' })))
    }
    state.scene.add(group)
    return () => {
      state.scene.remove(group)
      group.traverse(child => {
        const line = child as Partial<THREE.Line>
        line.geometry?.dispose()
        ;(line.material as THREE.Material | undefined)?.dispose()
      })
    }
  }, [outlines])

  useEffect(() => {
    const state = stateRef.current
    const host = hostRef.current
    if (!state || !host || !dimensions?.length) return
    const colour = dark ? '#e6dfd2' : '#2b2722'
    const pts: THREE.Vector3[] = []
    const labels: typeof state.labels = []
    const size = Math.max(...dimensions.map(d =>
      Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1], d.to[2] - d.from[2])))
    const tick = size * 0.015
    for (const d of dimensions) {
      const a = new THREE.Vector3(...d.from), b = new THREE.Vector3(...d.to)
      const axis = b.clone().sub(a).normalize()
      // A short cross-tick at each end, perpendicular to the line.
      const side = new THREE.Vector3(0, 0, 1)
      if (Math.abs(axis.z) > 0.9) side.set(1, 0, 0)
      const t = axis.clone().cross(side).normalize().multiplyScalar(tick)
      pts.push(a, b, a.clone().sub(t), a.clone().add(t), b.clone().sub(t), b.clone().add(t))
      const el = document.createElement('span')
      el.textContent = d.text
      Object.assign(el.style, {
        position: 'absolute', left: '0', top: '0', pointerEvents: 'none', whiteSpace: 'nowrap',
        font: '12px system-ui, sans-serif', color: colour, padding: '0 4px', borderRadius: '3px',
        background: dark ? 'rgba(30,27,23,0.7)' : 'rgba(250,247,240,0.8)',
      })
      host.appendChild(el)
      labels.push({ pos: a.clone().add(b).multiplyScalar(0.5), el })
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colour, depthTest: false }),
    )
    lines.renderOrder = 10
    state.scene.add(lines)
    state.labels = labels
    return () => {
      state.scene.remove(lines)
      lines.geometry.dispose()
      ;(lines.material as THREE.Material).dispose()
      for (const l of labels) l.el.remove()
      state.labels = []
    }
  }, [dimensions, dark])

  return (
    <Box
      ref={hostRef}
      role="img"
      aria-label={`Three-dimensional preview of ${label}, ${mesh.triangleCount} triangles`}
      sx={{ position: 'absolute', inset: 0, minHeight: 0 }}
    />
  )
}
