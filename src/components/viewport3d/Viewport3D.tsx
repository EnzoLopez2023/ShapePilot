// The 3D editing surface.
//
// Plain three.js rather than react-three-fiber, matching SolidViewer3D: the
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
import {
  EDGE_OPACITY, addSolidLighting, buildEdges, disposeBody, edgeColourFor, solidMaterial,
} from './solidRender.ts'
import type { Triple } from '../../model/document.ts'
import { formatMeasure, formatSize } from '../../units.ts'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/** One selectable body in the viewport. */
export interface ViewportPart {
  id: string
  mesh: AppMesh
  /** Holes render translucent, the way Tinkercad shows them. */
  mode: 'solid' | 'hole'
  color?: string
  /**
   * Where this object's own origin sits in world millimetres -- its transform
   * position. The gizmo pivots here, because that is the point the document
   * rotates and scales about; without it the gizmo turns the part about its
   * bounding-box centre and the result jumps on release.
   */
  origin?: Triple
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
  /** The measured-size readout follows the designer's unit toggle. */
  imperial?: boolean
  onSelect: (id: string | null, additive: boolean) => void
  /**
   * Fired once on gizmo release, so one drag is one undo step. The change is
   * RELATIVE: a position offset in mm, a rotation offset in degrees and a
   * scale factor, all against where the part was when the drag began.
   */
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
  /** Where the pivot was placed when the gizmo attached; the drag is measured
   *  from here, since the gizmo reports an absolute position. */
  pivotOrigin: THREE.Vector3
  workplane: THREE.Group
  /** The selected body's world bounds, remeasured every frame so the box and
   *  the readout follow a gizmo drag rather than the last committed edit. */
  liveBox: THREE.Box3
  selectionBox: THREE.Box3Helper
  raf: number
}

const DEG = 180 / Math.PI
const ZERO = new THREE.Vector3()

export default function Viewport3D(props: Viewport3DProps) {
  const {
    parts, selection, buildMm, innerBuildMm, gizmo, snapMm, imperial = false,
    onSelect, onTransform, fitToken,
  } = props

  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<SceneState | null>(null)
  const readoutRef = useRef<HTMLDivElement | null>(null)
  const sizeRef = useRef<HTMLSpanElement | null>(null)
  const liveRef = useRef<HTMLSpanElement | null>(null)
  // The render loop reads these every frame; it is set up once and must not be
  // torn down to learn that the unit toggle or the gizmo mode changed.
  const optionsRef = useRef({ imperial, gizmo })
  optionsRef.current = { imperial, gizmo }
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

    addSolidLighting(scene)

    const workplane = new THREE.Group()
    scene.add(workplane)

    // The box the readout is measuring. Drawn rather than implied: with a
    // number on screen and nothing around the part, it is not obvious that the
    // three figures are the part's own extent.
    const liveBox = new THREE.Box3()
    const selectionBox = new THREE.Box3Helper(liveBox, new THREE.Color(0x000000))
    selectionBox.visible = false
    const boxLines = selectionBox.material as THREE.LineBasicMaterial
    boxLines.transparent = true
    boxLines.opacity = 0.5
    scene.add(selectionBox)

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
      bodies: new Map(), pivot, pivotOrigin: new THREE.Vector3(), workplane,
      liveBox, selectionBox, raf: 0,
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
      // The gizmo reports where the pivot now is; the document wants how far it
      // moved. Subtracting the attach point is the whole difference between a
      // drag that nudges a part and one that teleports it to its own centre.
      const origin = state.pivotOrigin
      onTransformRef.current(id, {
        position: [
          pivot.position.x - origin.x,
          pivot.position.y - origin.y,
          pivot.position.z - origin.z,
        ],
        rotationDeg: [
          pivot.rotation.x * DEG, pivot.rotation.y * DEG, pivot.rotation.z * DEG,
        ],
        scale: [pivot.scale.x, pivot.scale.y, pivot.scale.z],
      })
    }
    gizmoControls.addEventListener('mouseUp', onGizmoUp)

    // Measuring after the render, not before: the renderer is what brings world
    // matrices up to date, so reading them first would report the part as it
    // was one frame ago -- visible as a readout lagging the drag.
    const boxSize = new THREE.Vector3()
    const anchor = new THREE.Vector3()
    let lastSize = '', lastLive = ''
    const updateReadout = () => {
      const chip = readoutRef.current
      const sizeEl = sizeRef.current
      const liveEl = liveRef.current
      if (!chip || !sizeEl || !liveEl) return

      const id = pivot.userData.id as string | undefined
      const body = id ? state.bodies.get(id) : undefined
      const bounds = body?.geometry.boundingBox
      if (!body || !bounds) {
        selectionBox.visible = false
        chip.style.display = 'none'
        return
      }

      liveBox.copy(bounds).applyMatrix4(body.matrixWorld)
      selectionBox.visible = true

      const { imperial: inches, gizmo: mode } = optionsRef.current
      liveBox.getSize(boxSize)
      const size = formatSize([boxSize.x, boxSize.y, boxSize.z], inches)
      if (size !== lastSize) { sizeEl.textContent = size; lastSize = size }

      // While a drag is in flight the panel is still showing the last committed
      // numbers, so the axis being dragged is worth spelling out here.
      let live = ''
      if (gizmoControls.dragging && mode === 'translate') {
        live = axisTriple(pivot.position, inches)
      } else if (gizmoControls.dragging && mode === 'rotate') {
        live = dominantAngle(pivot.rotation)
      }
      if (live !== lastLive) {
        liveEl.textContent = live
        liveEl.style.display = live ? 'block' : 'none'
        lastLive = live
      }

      // Under the part on screen, which is not the same as under it in the
      // model: the lowest corner of the box in world space still projects
      // somewhere inside the silhouette from most angles. Project all eight and
      // sit below the lowest of them.
      const w = host.clientWidth, h = host.clientHeight
      let left = Infinity, right = -Infinity, bottom = -Infinity, behind = false
      for (let corner = 0; corner < 8; corner++) {
        anchor.set(
          corner & 1 ? liveBox.max.x : liveBox.min.x,
          corner & 2 ? liveBox.max.y : liveBox.min.y,
          corner & 4 ? liveBox.max.z : liveBox.min.z,
        ).project(camera)
        if (anchor.z > 1) { behind = true; break }
        const sx = (anchor.x * 0.5 + 0.5) * w
        const sy = (-anchor.y * 0.5 + 0.5) * h
        if (sx < left) left = sx
        if (sx > right) right = sx
        if (sy > bottom) bottom = sy
      }
      if (behind) { chip.style.display = 'none'; return }
      const x = Math.min(Math.max((left + right) / 2, 60), w - 60)
      const y = Math.min(Math.max(bottom, 8), h - 52)
      chip.style.display = 'block'
      chip.style.transform = `translate(${x}px, ${y}px) translate(-50%, 10px)`
    }

    const loop = () => {
      state.raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
      updateReadout()
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
      for (const body of state.bodies.values()) disposeBody(body)
      disposeGroup(workplane)
      disposeGroup(selectionBox)
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
      // removeFromParent, not scene.remove: the selected body rides the pivot
      // during a drag, so the scene is not always its parent.
      body.removeFromParent()
      disposeBody(body)
      state.bodies.delete(id)
    }

    const edgeColour = edgeColourFor(dark)

    for (const part of parts) {
      const existing = state.bodies.get(part.id)
      if (existing) {
        existing.removeFromParent()
        disposeBody(existing)
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3))
      geom.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1))
      // Measured once here rather than per frame: the readout only has to
      // re-apply the body's matrix, which is eight points instead of all of them.
      geom.computeBoundingBox()
      // Deliberately no computeVertexNormals: the kernel returns welded,
      // indexed geometry, so averaging normals at shared vertices smooths
      // across every sharp edge and shades a flat face like a curved one.
      // `flatShading` derives the normal per triangle in the shader instead,
      // which is both correct for CAD solids and what makes a face read as one
      // solid tone.

      const hole = part.mode === 'hole'
      const material = solidMaterial({
        color: part.color ?? (hole ? '#8899aa' : (dark ? 0xb9b0a2 : 0xd8d2c6)),
        hole,
      })
      const body = new THREE.Mesh(geom, material)
      body.userData.id = part.id

      const edges = buildEdges(geom, edgeColour, part.mesh.triangleCount)
      if (edges) body.add(edges)

      state.scene.add(body)
      state.bodies.set(part.id, body)
    }
  }, [parts, dark])

  // Selection highlight and gizmo attachment.
  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    const accent = new THREE.Color(theme.palette.primary.main)
    ;(state.selectionBox.material as THREE.LineBasicMaterial).color.set(accent)

    const edgeColour = edgeColourFor(dark)

    for (const [id, body] of state.bodies) {
      const material = body.material as THREE.MeshStandardMaterial
      const isSelected = selection.has(id)
      // Mutate the existing Color rather than replacing it: no allocation, and
      // three reuses the same uniform.
      material.emissive.set(isSelected ? accent : 0x000000)
      setEmissiveIntensity(material, isSelected ? 0.22 : 0)

      // The outline carries the selection more legibly than a wash of emissive
      // over a solid face.
      const outline = body.children.find(child => child instanceof THREE.LineSegments)
      if (outline) {
        const line = (outline as THREE.LineSegments).material as THREE.LineBasicMaterial
        line.color.set(isSelected ? accent : edgeColour)
        line.opacity = isSelected ? 1 : EDGE_OPACITY
      }
    }

    // The gizmo attaches only to a single selection: with several bodies there
    // is no one origin a scale or rotation would obviously be about.
    const only = selection.size === 1 ? [...selection][0] : null
    const body = only ? state.bodies.get(only) : undefined

    // Whatever rode the pivot last time goes back to the scene first, so a body
    // is never left parented to a pivot that is about to move for another part.
    for (const other of state.bodies.values()) {
      if (other !== body && other.parent === state.pivot) state.scene.attach(other)
    }

    if (body && only) {
      state.pivot.rotation.set(0, 0, 0)
      state.pivot.scale.set(1, 1, 1)
      state.pivot.userData.id = only
      // The part's own origin when we know it -- that is the point the document
      // rotates and scales about -- and the body's centre otherwise, so the
      // gizmo still lands somewhere sensible.
      const declared = parts.find(p => p.id === only)?.origin
      if (declared) {
        state.pivot.position.set(declared[0], declared[1], declared[2])
      } else {
        body.geometry.computeBoundingBox()
        const box = body.geometry.boundingBox
        state.pivot.position.copy(box ? box.getCenter(new THREE.Vector3()) : ZERO)
      }
      state.pivotOrigin.copy(state.pivot.position)
      // The body rides the pivot for the length of the drag, so the part follows
      // the cursor instead of sitting still until the document catches up.
      state.pivot.attach(body)
      state.gizmo.attach(state.pivot)
    } else {
      state.pivot.userData.id = undefined
      state.gizmo.detach()
    }
  }, [selection, parts, dark, theme.palette.primary.main])

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
    // Centred on the origin, because that is where the model space is: every
    // primitive is generated about x = y = 0 and the 3MF writer places bodies
    // at the shared origin. A plate spanning 0..256 instead put every new
    // object at its front-left corner, three quarters off the bed.
    grid.position.set(0, 0, 0)
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
      const [bx, by, bz] = buildMm
      box.set(new THREE.Vector3(-bx / 2, -by / 2, 0), new THREE.Vector3(bx / 2, by / 2, bz))
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50))

    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const centre = sphere.center
    const radius = sphere.radius || 50

    // Distance from the field of view rather than a guessed multiple of the
    // span: a fixed multiplier frames a 20 mm part and a 250 mm one completely
    // differently. The horizontal field is the binding one on a wide viewport,
    // so the smaller of the two decides.
    const vFov = THREE.MathUtils.degToRad(state.camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * state.camera.aspect)
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15

    const direction = new THREE.Vector3(0.55, -1, 0.6).normalize()
    state.controls.target.copy(centre)
    state.camera.position.copy(centre).addScaledVector(direction, distance)
    state.camera.near = Math.max(0.1, distance / 1_000)
    state.camera.far = distance * 10 + radius * 4
    state.camera.updateProjectionMatrix()
    state.controls.update()
  }, [buildMm])

  useEffect(() => { frame() }, [frame, fitToken])

  // Going from an empty scene to a first object should frame it; after that the
  // camera is the user's to control and must not jump on every edit.
  const wasEmpty = useRef(true)
  useEffect(() => {
    if (wasEmpty.current && parts.length) frame()
    wasEmpty.current = parts.length === 0
  }, [parts.length, frame])

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
      {/* Measured off the bodies every frame, so it is written straight to the
          DOM: re-rendering the page at 60 Hz to move a label is not a trade
          worth making. Hidden from assistive tech -- the inspector carries the
          same numbers without churning. */}
      <Box
        ref={readoutRef}
        aria-hidden
        sx={{
          position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none',
          px: 0.75, py: 0.25, borderRadius: 1, border: 1, borderColor: 'divider',
          bgcolor: 'background.paper', color: 'primary.main',
          fontSize: '0.6875rem', fontWeight: 600, lineHeight: 1.5,
          whiteSpace: 'nowrap', textAlign: 'center',
        }}
      >
        <Box component="span" ref={sizeRef} sx={{ display: 'block' }} />
        <Box
          component="span" ref={liveRef}
          sx={{ display: 'none', color: 'text.secondary', fontWeight: 500 }}
        />
      </Box>

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

/** A wireframe box marking a build envelope: centred in x and y, sitting on
 *  z = 0, matching how every solid in the program is generated. */
function envelope(x: number, y: number, z: number, colour: number): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z))
  const material = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.5 })
  const lines = new THREE.LineSegments(geometry, material)
  lines.position.set(0, 0, z / 2)
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

/** A position as one line of axis-labelled lengths. */
function axisTriple(v: THREE.Vector3, imperial: boolean): string {
  return `X ${formatMeasure(v.x, imperial)} · Y ${formatMeasure(v.y, imperial)} `
    + `· Z ${formatMeasure(v.z, imperial)}`
}

/** The gizmo turns about one axis at a time, so naming the axis that actually
 *  moved reads better than three numbers, two of which are zero. */
function dominantAngle(euler: THREE.Euler): string {
  const axes: [string, number][] = [['X', euler.x], ['Y', euler.y], ['Z', euler.z]]
  const [name, radians] = axes.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))
  return `${name} ${Math.round(radians * DEG)}°`
}
