// ShapeProgram -> Mesh, via manifold-3d.
//
// Manifold is used rather than a pure-JS CSG evaluator because PRODUCT.md
// requires every exported mesh to be watertight, and it is the only browser
// kernel that guarantees that on arbitrary input. The output is the same `Mesh`
// shape src/geometry/mesh.ts produces, so the existing STL and 3MF writers and
// `checkManifold` all work on an AI-generated part unchanged.
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import type { Mesh } from '../geometry/mesh.ts'
import type {
  BooleanNode, PartNode, Point2, PrimitiveNode, ProgramTransform, ShapeProgram,
} from '../../lib/contracts/shapeProgram.ts'
import { ShapeProgramError, isBooleanNode } from '../../lib/contracts/shapeProgram.ts'
import { loadManifold } from './manifold.ts'

const DEFAULT_SEGMENTS = 64

/** manifold's Polygons wants closed-or-not simple contours of [x, y] pairs. */
const toContour = (ring: readonly Point2[]): [number, number][] =>
  ring.map(([x, y]) => [x, y] as [number, number])

/** Imported triangles, by content hash. Kept beside the program rather than in
 *  it: see ProgramParams.meshId. */
export type MeshSources = ReadonlyMap<string, Mesh>

export interface EvaluateOptions {
  meshes?: MeshSources
}

function buildPrimitive(
  wasm: ManifoldToplevel, node: PrimitiveNode, options: EvaluateOptions,
): Manifold {
  const { Manifold: M, CrossSection } = wasm
  const p = node.params
  const segs = p.segments ?? DEFAULT_SEGMENTS

  switch (node.op) {
    case 'box':
      // Centred on the origin in x and y, sitting on z = 0: the workplane
      // convention every 3D sub-app draws against.
      return M.cube([p.widthMm!, p.depthMm!, p.heightMm!], true).translate(0, 0, p.heightMm! / 2)

    case 'cylinder':
      return M.cylinder(p.heightMm!, p.radiusMm!, p.radiusMm!, segs, false)

    case 'sphere':
      return M.sphere(p.radiusMm!, segs).translate(0, 0, p.radiusMm!)

    case 'cone':
      return M.cylinder(p.heightMm!, p.radiusMm!, p.topRadiusMm ?? 0, segs, false)

    case 'torus': {
      // Revolve a circle offset along x. The validator has already refused
      // tube >= radius, so the section never crosses the axis.
      const section = CrossSection.circle(p.tubeMm!, segs).translate(p.radiusMm!, 0)
      return M.revolve(section, segs).translate(0, 0, p.tubeMm!)
    }

    case 'wedge': {
      // A right triangular prism: full height at -x, zero at +x. Extruded along
      // z then laid down so `depthMm` runs in y like every other primitive.
      const w = p.widthMm!, d = p.depthMm!, h = p.heightMm!
      const profile: [number, number][] = [[-w / 2, 0], [w / 2, 0], [-w / 2, h]]
      return M.extrude([profile], d).rotate(90, 0, 0).translate(0, d / 2, 0)
    }

    case 'extrude': {
      const contours = [toContour(p.profile!), ...(p.holes ?? []).map(toContour)]
      return M.extrude(contours, p.heightMm!)
    }

    case 'text':
      // Glyph outlines need a font, which is async and browser-side. Text nodes
      // are lowered to `extrude` by src/text/expandText.ts before evaluation.
      throw new ShapeProgramError(
        `part.${node.id}`,
        'text nodes must be expanded to extrusions before evaluation',
      )

    case 'mesh': {
      const source = options.meshes?.get(p.meshId!)
      if (!source) {
        // The bytes are not authoritative and may simply be absent -- opened on
        // another browser, or evicted. The caller decides whether that is fatal;
        // here it is a named, catchable failure rather than a silent empty solid.
        throw new ShapeProgramError(
          `part.${node.id}`,
          `the imported file for "${node.name}" is not available`,
        )
      }
      return meshToManifold(wasm, source)
    }
  }
}

/**
 * The app's Mesh -> a Manifold. `ofMesh` takes ownership of the triangles as
 * they are, so an imported model that was not watertight stays not watertight;
 * `status()` at the end of evaluation is what surfaces that, rather than this
 * silently repairing geometry the user handed us.
 */
function meshToManifold(wasm: ManifoldToplevel, source: Mesh): Manifold {
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: source.positions,
    triVerts: source.indices,
  })
  return wasm.Manifold.ofMesh(mesh)
}

function applyTransform(solid: Manifold, t: ProgramTransform): Manifold {
  const [sx, sy, sz] = t.scale
  const [rx, ry, rz] = t.rotationDeg
  const [px, py, pz] = t.position
  let out = solid
  if (sx !== 1 || sy !== 1 || sz !== 1) out = out.scale([sx, sy, sz])
  if (rx || ry || rz) out = out.rotate([rx, ry, rz])
  if (px || py || pz) out = out.translate([px, py, pz])
  return out
}

function buildBoolean(
  wasm: ManifoldToplevel, node: BooleanNode, options: EvaluateOptions,
): Manifold {
  const parts = node.children.map(c => buildNode(wasm, c, options))
  const [first, ...rest] = parts
  switch (node.op) {
    case 'union':
      return rest.reduce<Manifold>((acc, m) => acc.add(m), first)
    case 'difference':
      // A single child is its own result -- "subtract nothing" is not an error,
      // it is what a group holding one solid means.
      return rest.reduce<Manifold>((acc, m) => acc.subtract(m), first)
    case 'intersection':
      return rest.reduce<Manifold>((acc, m) => acc.intersect(m), first)
  }
}

function buildNode(
  wasm: ManifoldToplevel, node: PartNode, options: EvaluateOptions,
): Manifold {
  const solid = isBooleanNode(node)
    ? buildBoolean(wasm, node, options)
    : buildPrimitive(wasm, node, options)
  return applyTransform(solid, node.transform)
}

/** manifold Mesh -> the app's Mesh. `numProp` is the vertex stride; the first
 *  three properties are always the position. */
function toAppMesh(solid: Manifold): Mesh {
  const mm = solid.getMesh()
  const stride = mm.numProp
  const vertexCount = mm.vertProperties.length / stride

  let positions: Float32Array
  if (stride === 3) {
    positions = new Float32Array(mm.vertProperties)
  } else {
    positions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = mm.vertProperties[i * stride]
      positions[i * 3 + 1] = mm.vertProperties[i * stride + 1]
      positions[i * 3 + 2] = mm.vertProperties[i * stride + 2]
    }
  }

  const box = solid.boundingBox()
  return {
    positions,
    indices: new Uint32Array(mm.triVerts),
    triangleCount: mm.triVerts.length / 3,
    bbox: [box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2]],
  }
}

const EMPTY_MESH: Mesh = {
  positions: new Float32Array(0),
  indices: new Uint32Array(0),
  triangleCount: 0,
  bbox: [0, 0, 0, 0, 0, 0],
}

/**
 * Evaluate a whole program. Top-level parts are unioned, which is what makes a
 * multi-part program a single printable solid.
 *
 * Manifold reports failure through `status()` rather than by throwing, so it is
 * checked once at the end: a bad boolean silently yields an empty solid
 * otherwise, and an empty STL is a much worse failure than an error message.
 */
export async function evaluateProgram(
  program: ShapeProgram, options: EvaluateOptions = {},
): Promise<Mesh> {
  if (!program.parts.length) return EMPTY_MESH
  const wasm = await loadManifold()

  const [first, ...rest] = program.parts.map(p => buildNode(wasm, p, options))
  const result = rest.reduce<Manifold>((acc, m) => acc.add(m), first)

  const status = result.status()
  if (status !== 'NoError') {
    throw new ShapeProgramError('program', `geometry could not be built (${status})`)
  }
  return toAppMesh(result)
}

/** Evaluate one named part, for per-object preview and selection highlighting. */
export async function evaluateNode(
  node: PartNode, options: EvaluateOptions = {},
): Promise<Mesh> {
  const wasm = await loadManifold()
  const solid = buildNode(wasm, node, options)
  const status = solid.status()
  if (status !== 'NoError') {
    throw new ShapeProgramError(`part.${node.id}`, `"${node.name}" could not be built (${status})`)
  }
  return toAppMesh(solid)
}
