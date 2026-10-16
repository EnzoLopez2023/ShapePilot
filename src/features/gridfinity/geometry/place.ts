import type { Mesh } from '../../../geometry/mesh.ts'

/** A copy of `mesh` moved by (dx, dy), for laying tiles out in the preview. */
export function translateMesh(mesh: Mesh, dx: number, dy: number): Mesh {
  const positions = new Float32Array(mesh.positions)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx
    positions[i + 1] += dy
  }
  const [x0, y0, z0, x1, y1, z1] = mesh.bbox
  return { ...mesh, positions, bbox: [x0 + dx, y0 + dy, z0, x1 + dx, y1 + dy, z1] }
}

/** Several bodies as one mesh, for previewing them together. Not for export. */
export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  const vertexCount = meshes.reduce((n, m) => n + m.positions.length, 0)
  const indexCount = meshes.reduce((n, m) => n + m.indices.length, 0)
  const positions = new Float32Array(vertexCount)
  const indices = new Uint32Array(indexCount)
  const bbox: Mesh['bbox'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  let p = 0
  let i = 0
  for (const m of meshes) {
    positions.set(m.positions, p)
    const base = p / 3
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + base
    p += m.positions.length
    i += m.indices.length
    for (let a = 0; a < 3; a++) {
      bbox[a] = Math.min(bbox[a], m.bbox[a])
      bbox[a + 3] = Math.max(bbox[a + 3], m.bbox[a + 3])
    }
  }
  return { positions, indices, triangleCount: indexCount / 3, bbox }
}
