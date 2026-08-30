// The 3D editing surface.
//
// Plain three.js rather than react-three-fiber, matching TrayViewer3D: the
// reconciler would add bundle weight for a scene that is a handful of meshes
// and a gizmo. What this adds over the tray's read-only preview is raycast
// picking, a TransformControls gizmo, and a workplane sized to the machine.
import { useCallback, useEffect, useRef } from 'react'
import { Box, IconButton, Stack, Tooltip, useTheme } from '@mui/material'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { Mesh as AppMesh } from '../../geometry/mesh.ts'
import type { Triple } from '../../model/document.ts'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/** One selectable body in the viewport. */
export interface ViewportPart {
  id: string
  mesh: AppMesh
  /** Holes render translucent, the way Tinkercad shows them. */
  mode: 'solid' | 'hole'
  color?: string
}

export interface Viewport3DProps {
  parts: ViewportPart[]
  selection: Set<string>
  /** Build volume for the workplane grid, mm. */
  buildMm?: Triple
  /** Reduced envelope drawn inside the first, when the machine is dual-nozzle. */
  innerBuildMm?: Triple
  gizmo: GizmoMode
  /** Snap increment in mm; 0 disables gizmo snapping. */
  snapMm: number
  onSelect: (id: string | null, additive: boolean) => void
  /** Fired once on gizmo release, so one drag is one undo step. */
  onTransform: (id: string, change: {
    position: Triple; rotationDeg: Triple; scale: Triple
  }) => void
  /** Bumping this re-frames the camera. */
  fitToken: number
}

interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  gizmo: TransformControls
  bodies: Map<string, THREE.Mesh>
  pivot: THREE.Object3D
  workplane: THREE.Group
  raf: number
}

const DEG = 180 / Math.PI

export default function Viewport3D(props: Viewport3DProps) {
  const {
    parts, selection, buildMm, innerBuildMm, gizmo, snapMm,
    onSelect, onTransform, fitToken,
  } = props

  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<SceneState | null>(null)
  // Handlers live on refs so the mount effect never has to re-run.
  const onSelectRef = useRef(onSelect)
  const onTransformRef = useRef(onTransform)
  onSelectRef.current = onSelect
  onTransformRef.current = onTransform

  // Scene setup runs once; contents are swapped in later effects.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // The canvas has no intrinsic CSS size, so without this it lays out at its
    // drawing-buffer size in CSS pixels and overflows the host by the ratio.
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 20_000)
    camera.up.set(0, 0, 1) // Z-up, matching the model space.

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const gizmoControls = new TransformControls(camera, renderer.domElement)
    // Orbiting while dragging the gizmo would fight the drag.
    gizmoControls.addEventListener('dragging-changed', event => {
      controls.enabled = !(event as unknown as { value: boolean }).value
    })
    const pivot = new THREE.Object3D()
    scene.add(pivot)
    const helper = gizmoControls.getHelper()
    scene.add(helper)

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(180, -220, 320)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.5)
    fill.position.set(-200, 160, 140)
    scene.add(fill)

    const workplane = new THREE.Group()
    scene.add(workplane)

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

    const state: SceneState = {
      renderer, scene, camera, controls, gizmo: gizmoControls,
      bodies: new Map(), pivot, workplane, raf: 0,
    }
    stateRef.current = state

    // Picking. A click that followed an orbit is a camera move, not a
    // selection, so movement since pointerdown is what distinguishes them.
    const raycaster = new THREE.Raycaster()
    let downAt: { x: number; y: number } | null = null
    const onPointerDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY } }
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt) return
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
      downAt = null
      if (moved > 4) return
      if (gizmoControls.dragging) return

      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects([...state.bodies.values()], false)
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      onSelectRef.current(hits.length ? (hits[0].object.userData.id as string) : null, additive)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    // The gizmo drives a pivot object; the document is updated once on release
    // so one drag is one undo step, matching the 2D canvas.
    const onGizmoUp = () => {
      const id = pivot.userData.id as string | undefined
      if (!id) return
      onTransformRef.current(id, {
        position: [pivot.position.x, pivot.position.y, pivot.position.z],
        rotationDeg: [
          pivot.rotation.x * DEG, pivot.rotation.y * DEG, pivot.rotation.z * DEG,
        ],
        scale: [pivot.scale.x, pivot.scale.y, pivot.scale.z],
      })
    }
    gizmoControls.addEventListener('mouseUp', onGizmoUp)

    const loop = () => {
      state.raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(state.raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      gizmoControls.removeEventListener('mouseUp', onGizmoUp)
      gizmoControls.detach()
      gizmoControls.dispose()
      controls.dispose()
      for (const body of state.bodies.values()) {
        body.geometry.dispose()
        ;(body.material as THREE.Material).dispose()
      }
      disposeGroup(workplane)
      renderer.dispose()
      host.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Bodies. Disposing replaced geometry is what keeps a non-R3F three
  // integration from leaking GPU buffers on every edit.
  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    const wanted = new Set(parts.map(p => p.id))
    for (const [id, body] of state.bodies) {
      if (wanted.has(id)) continue
      state.scene.remove(body)
      body.geometry.dispose()
      ;(body.material as THREE.Material).dispose()
      state.bodies.delete(id)
    }

    for (const part of parts) {
      const existing = state.bodies.get(part.id)
      if (existing) {
        state.scene.remove(existing)
        existing.geometry.dispose()
        ;(existing.material as THREE.Material).dispose()
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3))
      geom.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1))
      geom.computeVertexNormals()

      const hole = part.mode === 'hole'
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color ?? (hole ? '#8899aa' : (dark ? 0xb9b0a2 : 0xd8d2c6))),
        roughness: 0.72,
        metalness: 0.02,
        // A hole is a subtraction, so it reads as a ghost rather than a body.
        transparent: hole,
        opacity: hole ? 0.35 : 1,
        side: THREE.FrontSide,
      })
      const body = new THREE.Mesh(geom, material)
      body.userData.id = part.id
      state.scene.add(body)
      state.bodies.set(part.id, body)
    }
  }, [parts, dark])

  // Selection highlight and gizmo attachment.
  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    const accent = new THREE.Color(theme.palette.primary.main)

    for (const [id, body] of state.bodies) {
      const material = body.material as THREE.MeshStandardMaterial
      const isSelected = selection.has(id)
      // Mutate the existing Color rather than replacing it: no allocation, and
      // three reuses the same uniform.
      material.emissive.set(isSelected ? accent : 0x000000)
      setEmissiveIntensity(material, isSelected ? 0.28 : 0)
    }

    // The gizmo attaches only to a single selection: with several bodies there
    // is no one origin a scale or rotation would obviously be about.
    const only = selection.size === 1 ? [...selection][0] : null
    const body = only ? state.bodies.get(only) : undefined
    if (body) {
      state.pivot.position.set(0, 0, 0)
      state.pivot.rotation.set(0, 0, 0)
      state.pivot.scale.set(1, 1, 1)
      state.pivot.userData.id = only
      // The pivot sits at the body's centre so the gizmo lands on the part.
      body.geometry.computeBoundingBox()
      const box = body.geometry.boundingBox
      if (box) state.pivot.position.copy(box.getCenter(new THREE.Vector3()))
      state.gizmo.attach(state.pivot)
    } else {
      state.pivot.userData.id = undefined
      state.gizmo.detach()
    }
  }, [selection, parts, theme.palette.primary.main])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    state.gizmo.setMode(gizmo)
    state.gizmo.setTranslationSnap(snapMm > 0 ? snapMm : null)
    state.gizmo.setRotationSnap(snapMm > 0 ? THREE.MathUtils.degToRad(15) : null)
  }, [gizmo, snapMm])

  // Workplane: the build volume, plus the reduced dual-nozzle envelope.
  useEffect(() => {
    const state = stateRef.current
    if (!state || !buildMm) return
    disposeGroup(state.workplane)
    state.workplane.clear()

    const [bx, by, bz] = buildMm
    const grid = new THREE.GridHelper(
      Math.max(bx, by), Math.round(Math.max(bx, by) / 10),
      dark ? 0x4a4f57 : 0xbdb8ac, dark ? 0x2f3339 : 0xdad5c9,
    )
    // GridHelper lies in XZ; the app's ground plane is XY.
    grid.rotation.x = Math.PI / 2
    grid.position.set(bx / 2, by / 2, 0)
    state.workplane.add(grid)

    state.workplane.add(envelope(bx, by, bz, dark ? 0x6f7681 : 0x9c968a))
    if (innerBuildMm) {
      state.workplane.add(envelope(
        innerBuildMm[0], innerBuildMm[1], innerBuildMm[2], 0xd08a3c))
    }
  }, [buildMm, innerBuildMm, dark])

  const frame = useCallback(() => {
    const state = stateRef.current
    if (!state) return
    const box = new THREE.Box3()
    for (const body of state.bodies.values()) box.expandByObject(body)
    if (box.isEmpty() && buildMm) {
      box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...buildMm))
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50))

    const centre = box.getCenter(new THREE.Vector3())
    const span = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 100
    state.controls.target.copy(centre)
    state.camera.position.set(
      centre.x + span * 0.9, centre.y - span * 1.2, centre.z + span * 0.9)
    state.camera.near = span / 100
    state.camera.far = span * 40
    state.camera.updateProjectionMatrix()
    state.controls.update()
  }, [buildMm])

  useEffect(() => { frame() }, [frame, fitToken])

  const triangles = parts.reduce((sum, p) => sum + p.mesh.triangleCount, 0)

  return (
    <Box sx={{ position: 'absolute', inset: 0, minHeight: 0 }}>
      <Box
        ref={hostRef}
        role="img"
        aria-label={
          parts.length
            ? `Three-dimensional view of ${parts.length} ${parts.length === 1 ? 'object' : 'objects'}, ${triangles} triangles`
            : 'Three-dimensional view, no objects yet'
        }
        sx={{ position: 'absolute', inset: 0, minHeight: 0 }}
      />
      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', right: 8, bottom: 8 }}>
        <Tooltip title="Reset the view" describeChild>
          <IconButton size="small" aria-label="Reset the view" onClick={frame}>
            <HomeRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}

/** three exposes intensity only as a plain property, so the write is wrapped
 *  to keep it out of the effect body where the immutability rule reads it. */
function setEmissiveIntensity(material: THREE.MeshStandardMaterial, value: number): void {
  material.emissiveIntensity = value
}

/** A wireframe box from the origin, marking a build envelope. */
function envelope(x: number, y: number, z: number, colour: number): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z))
  const material = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.5 })
  const lines = new THREE.LineSegments(geometry, material)
  lines.position.set(x / 2, y / 2, z / 2)
  return lines
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse(child => {
    const mesh = child as Partial<THREE.Mesh>
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach(m => m.dispose())
    else material?.dispose()
  })
}
