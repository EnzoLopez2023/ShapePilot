// How a solid looks in every 3D view.
//
// Shared so the keycap tray preview and the designer viewport cannot drift
// apart: they are the same product and a part should not change appearance by
// being looked at on a different page.
//
// The look is CAD, not product render. Each facet is one solid tone and feature
// edges are drawn. See DESIGN.md, "Designer conventions".
import * as THREE from 'three'

/** Outline tones. Dark enough to read as a drawn edge, not a highlight. */
export const EDGE_COLOUR_LIGHT = 0x4a4f57
export const EDGE_COLOUR_DARK = 0xc9cdd4
export const EDGE_OPACITY = 0.7

export const edgeColourFor = (dark: boolean): number =>
  (dark ? EDGE_COLOUR_DARK : EDGE_COLOUR_LIGHT)

/**
 * Only edges where the surface genuinely turns. Below this the facets of a
 * tessellated cylinder would each draw a line and the part would look like a
 * wireframe; a 64-segment cylinder turns about 5.6 degrees per facet.
 */
export const EDGE_ANGLE_DEGREES = 20

/**
 * Outlining is O(triangles) and runs on the main thread, so a large imported
 * mesh is left unoutlined rather than freezing the viewport. Flat shading alone
 * still reads correctly.
 */
export const MAX_OUTLINED_TRIANGLES = 150_000

/**
 * The surface material.
 *
 * `flatShading` is the load-bearing part. The geometry kernels return welded,
 * indexed meshes, so computing vertex normals averages them at shared vertices
 * and smooths across every sharp edge -- which shades a flat face like a curved
 * one. Deriving the normal per triangle in the shader is both correct for a
 * solid and what makes a face read as one tone. Callers must therefore NOT call
 * `computeVertexNormals()`.
 */
export function solidMaterial(options: {
  color: THREE.ColorRepresentation
  /** A hole is a subtraction, so it reads as a ghost rather than a body. */
  hole?: boolean
}): THREE.MeshStandardMaterial {
  const hole = options.hole ?? false
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.color),
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    transparent: hole,
    opacity: hole ? 0.3 : 1,
    side: THREE.FrontSide,
    // Outlines sit exactly on the surface they trace, so the faces are pushed
    // back a touch in depth. Without this the lines stipple in and out as the
    // camera turns.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

/** The drawn edges, or null when the mesh is too large to outline cheaply. */
export function buildEdges(
  geometry: THREE.BufferGeometry, colour: number, triangleCount: number,
): THREE.LineSegments | null {
  if (triangleCount > MAX_OUTLINED_TRIANGLES) return null
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, EDGE_ANGLE_DEGREES),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: EDGE_OPACITY }),
  )
}

/** A body owns its outline as a child, so both are freed together. */
export function disposeBody(body: THREE.Mesh): void {
  body.geometry.dispose()
  ;(body.material as THREE.Material).dispose()
  for (const child of body.children) {
    const line = child as THREE.LineSegments
    line.geometry?.dispose()
    ;(line.material as THREE.Material | undefined)?.dispose()
  }
  body.clear()
}

/**
 * Under flat shading the lights only ever separate one face from another: the
 * normal is constant across a triangle, so intensity cannot produce a gradient
 * within a face however hard the key is. Contrast is therefore worth having --
 * a flat plate seen from above is unreadable if every face lands on the same
 * tone. Ambient sets the floor so a face turned away is still legible.
 */
export function addSolidLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.52))

  const key = new THREE.DirectionalLight(0xffffff, 1.05)
  key.position.set(180, -220, 320)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xffffff, 0.45)
  fill.position.set(-200, 160, 140)
  scene.add(fill)

  // Straight down, so a top face never reads the same as a side.
  const top = new THREE.DirectionalLight(0xffffff, 0.3)
  top.position.set(0, 0, 400)
  scene.add(top)
}
