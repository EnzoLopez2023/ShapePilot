// Triangle-soup helpers shared by the STL and 3MF readers.
// A mesh here is a Float32Array of 9 floats per triangle (x0 y0 z0 x1 y1 z1 x2 y2 z2).

import { createHash } from 'node:crypto'

/** Geometry hashes are skipped above this size; sha256 still catches exact copies. */
export const GEOMETRY_HASH_MAX_TRIANGLES = 3_000_000
const QUANTUM = 0.01 // mm

export function boundingBox(tris) {
  if (tris.length === 0) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < tris.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const v = tris[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  return { min, max, size: max.map((v, a) => round2(v - min[a])) }
}

/** Absolute enclosed volume in mm³ (signed tetrahedra; exact for closed meshes). */
export function volume(tris) {
  let sum = 0
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(i, i + 9)
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return round2(Math.abs(sum / 6))
}

/**
 * Placement-independent hash of the triangle set. The mesh is translated so its
 * bounding box starts at the origin, vertices are quantized to 0.01 mm, each
 * triangle is rotated to start at its smallest vertex (winding is preserved)
 * and the triangle list is sorted. The same model saved as STL, re-exported,
 * renamed or moved on the plate therefore hashes the same.
 */
export function geometryHash(tris) {
  const count = tris.length / 9
  if (count === 0 || count > GEOMETRY_HASH_MAX_TRIANGLES) return null
  const box = boundingBox(tris)
  const q = new Int32Array(tris.length)
  for (let i = 0; i < tris.length; i += 1) {
    q[i] = Math.round((tris[i] - box.min[i % 3]) / QUANTUM)
  }
  const order = new Uint32Array(count)
  const rot = new Uint8Array(count)
  for (let t = 0; t < count; t += 1) {
    order[t] = t
    const o = t * 9
    let best = 0
    for (let r = 1; r < 3; r += 1) {
      if (compareVertex(q, o + r * 3, o + best * 3) < 0) best = r
    }
    rot[t] = best
  }
  const cmp = (a, b) => {
    for (let k = 0; k < 9; k += 1) {
      const va = q[a * 9 + ((rot[a] * 3 + k) % 9)]
      const vb = q[b * 9 + ((rot[b] * 3 + k) % 9)]
      if (va !== vb) return va - vb
    }
    return 0
  }
  order.sort(cmp)
  const out = new Int32Array(count * 9)
  for (let i = 0; i < count; i += 1) {
    const t = order[i]
    for (let k = 0; k < 9; k += 1) out[i * 9 + k] = q[t * 9 + ((rot[t] * 3 + k) % 9)]
  }
  return createHash('sha256').update(Buffer.from(out.buffer)).digest('hex')
}

function compareVertex(q, a, b) {
  return q[a] - q[b] || q[a + 1] - q[b + 1] || q[a + 2] - q[b + 2]
}

function round2(v) {
  return Math.round(v * 100) / 100
}

/** Applies a 3MF 3x4 affine transform ("m00 m01 m02 m10 ... m32") to a triangle soup in place. */
export function applyTransform(tris, transform) {
  if (!transform) return tris
  const m = transform.trim().split(/\s+/).map(Number)
  if (m.length !== 12 || m.some(Number.isNaN)) return tris
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2]
    tris[i] = x * m[0] + y * m[3] + z * m[6] + m[9]
    tris[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10]
    tris[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11]
  }
  return tris
}

/** Multiplies two 3MF transforms (apply `inner` first, then `outer`). */
export function composeTransforms(outer, inner) {
  if (!outer) return inner
  if (!inner) return outer
  const a = inner.trim().split(/\s+/).map(Number)
  const b = outer.trim().split(/\s+/).map(Number)
  const r = new Array(12)
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      r[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col] + (row === 3 ? b[9 + col] : 0)
    }
  }
  return r.join(' ')
}

export function concatMeshes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
