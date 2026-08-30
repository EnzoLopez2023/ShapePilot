import { useEffect, useRef } from 'react'
import { Box, useTheme } from '@mui/material'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Mesh as TrayMesh } from '../../../geometry/mesh.ts'

export interface TrayViewer3DProps {
  mesh: TrayMesh
}

/**
 * Plain three.js rather than react-three-fiber: this is one static mesh and an
 * orbit camera, and the reconciler would only add weight to the bundle.
 */
export default function TrayViewer3D({ mesh }: TrayViewer3DProps) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    mesh?: THREE.Mesh
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(180, -220, 320)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.5)
    fill.position.set(-200, 160, 140)
    scene.add(fill)

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
      { renderer, scene, camera, controls, raf: 0 }
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
      state.mesh?.geometry.dispose()
      ;(state.mesh?.material as THREE.Material | undefined)?.dispose()
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

    if (state.mesh) {
      state.scene.remove(state.mesh)
      state.mesh.geometry.dispose()
      ;(state.mesh.material as THREE.Material).dispose()
      state.mesh = undefined
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    geom.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      color: dark ? 0xb9b0a2 : 0xd8d2c6,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.FrontSide,
    })
    const obj = new THREE.Mesh(geom, material)
    state.scene.add(obj)
    state.mesh = obj

    const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bbox
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 100
    state.controls.target.set(cx, cy, cz)
    state.camera.position.set(cx + span * 0.55, cy - span * 0.95, cz + span * 0.85)
    state.camera.near = span / 100
    state.camera.far = span * 20
    state.camera.updateProjectionMatrix()
    state.controls.update()
  }, [mesh, dark])

  return (
    <Box
      ref={hostRef}
      role="img"
      aria-label={`Three-dimensional preview of the tray, ${mesh.triangleCount} triangles`}
      sx={{ position: 'absolute', inset: 0, minHeight: 0 }}
    />
  )
}
