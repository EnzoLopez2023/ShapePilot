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

export interface SolidViewer3DProps {
  mesh: SolidMesh
  /** Announced to screen readers -- "tray", "switch tray plate", ... */
  label?: string
  /** The main body's colour; absent uses the neutral default. */
  color?: string
  /** Bodies exported separately, e.g. a nameplate in a second filament. */
  extras?: readonly SolidViewerBody[]
}

/**
 * Plain three.js rather than react-three-fiber: this is one static mesh and an
 * orbit camera, and the reconciler would only add weight to the bundle.
 *
 * Shared by every tray-shaped designer -- it only ever needed a `Mesh`.
 */
export default function SolidViewer3D(
  { mesh, label = 'the model', color, extras }: SolidViewer3DProps,
) {
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
      { renderer, scene, camera, controls, bodies: [], raf: 0 }
    stateRef.current = state
    const loop = () => {
      state.raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
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
    state.camera.position.set(cx + span * 0.55, cy - span * 0.95, cz + span * 0.85)
    state.camera.near = span / 100
    state.camera.far = span * 20
    state.camera.updateProjectionMatrix()
    state.controls.update()
  }, [mesh, color, extras, dark])

  return (
    <Box
      ref={hostRef}
      role="img"
      aria-label={`Three-dimensional preview of ${label}, ${mesh.triangleCount} triangles`}
      sx={{ position: 'absolute', inset: 0, minHeight: 0 }}
    />
  )
}
