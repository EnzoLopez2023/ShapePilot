// STL, OBJ and 3MF -> the app's Mesh. three ships loaders for all three, so the
// only work here is turning a BufferGeometry into the indexed, welded form the
// exporters and checkManifold expect.
import type { BufferGeometry } from 'three'
import type { Mesh } from '../geometry/mesh.ts'
import { QUANTUM } from '../geometry/vec.ts'
import type { ImportedMesh } from './types.ts'
import { ImportError } from './types.ts'

/**
 * Weld on the quantized position, exactly as MeshBuilder does. STL in
 * particular is a triangle soup with no shared vertices, so an unwelded import
 * reports as non-manifold even when the model is sound.
 */
export function geometryToMesh(geometry: BufferGeometry): Mesh {
  const pos = geometry.getAttribute('position')
  if (!pos) throw new ImportError('the file contains no vertex positions')

  const index = geometry.getIndex()
  const sourceCount = index ? index.count : pos.count
  if (sourceCount === 0 || sourceCount % 3 !== 0) {
    throw new ImportError('the file contains no complete triangles')
  }

  const lookup = new Map<string, number>()
  const positions: number[] = []
  const indices: number[] = []
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  const vertex = (i: number): number => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const key = `${Math.round(x / QUANTUM)}|${Math.round(y / QUANTUM)}|${Math.round(z / QUANTUM)}`
    const seen = lookup.get(key)
    if (seen !== undefined) return seen
    const id = positions.length / 3
    positions.push(x, y, z)
    lookup.set(key, id)
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    return id
  }

  for (let i = 0; i < sourceCount; i += 3) {
    const a = vertex(index ? index.getX(i) : i)
    const b = vertex(index ? index.getX(i + 1) : i + 1)
    const c = vertex(index ? index.getX(i + 2) : i + 2)
    // A triangle whose corners welded together has zero area and would only
    // confuse the manifold check.
    if (a !== b && b !== c && a !== c) indices.push(a, b, c)
  }

  if (!indices.length) throw new ImportError('every triangle in the file is degenerate')

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleCount: indices.length / 3,
    bbox: [minX, minY, minZ, maxX, maxY, maxZ],
  }
}

export async function importStl(buffer: ArrayBuffer): Promise<ImportedMesh> {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
  return { kind: '3d', format: 'stl', mesh: geometryToMesh(new STLLoader().parse(buffer)) }
}

export async function importObj(text: string): Promise<ImportedMesh> {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
  const group = new OBJLoader().parse(text)
  const geometries: BufferGeometry[] = []
  group.traverse(child => {
    const geom = (child as { geometry?: BufferGeometry }).geometry
    if (geom?.getAttribute?.('position')) geometries.push(geom)
  })
  if (!geometries.length) throw new ImportError('the OBJ file contains no meshes')

  // Merge by concatenating triangles; geometryToMesh welds across the seam.
  const merged = mergeGeometries(geometries)
  return { kind: '3d', format: 'obj', mesh: merged }
}

function mergeGeometries(geometries: BufferGeometry[]): Mesh {
  const meshes = geometries.map(geometryToMesh)
  if (meshes.length === 1) return meshes[0]

  const positions: number[] = []
  const indices: number[] = []
  let offset = 0
  const bbox: [number, number, number, number, number, number] =
    [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const m of meshes) {
    positions.push(...m.positions)
    for (const i of m.indices) indices.push(i + offset)
    offset += m.positions.length / 3
    for (let k = 0; k < 3; k++) {
      bbox[k] = Math.min(bbox[k], m.bbox[k])
      bbox[k + 3] = Math.max(bbox[k + 3], m.bbox[k + 3])
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleCount: indices.length / 3,
    bbox,
  }
}

export async function importThreeMf(buffer: ArrayBuffer): Promise<ImportedMesh> {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
  const group = new ThreeMFLoader().parse(buffer)
  const geometries: BufferGeometry[] = []
  group.traverse(child => {
    const geom = (child as { geometry?: BufferGeometry }).geometry
    if (geom?.getAttribute?.('position')) geometries.push(geom)
  })
  if (!geometries.length) throw new ImportError('the 3MF file contains no meshes')
  return { kind: '3d', format: '3mf', mesh: mergeGeometries(geometries) }
}
