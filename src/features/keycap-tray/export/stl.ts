import type { Mesh } from '../geometry/mesh.ts'

/**
 * Binary STL: 80-byte header, uint32 triangle count, then 50 bytes per triangle
 * (3 floats normal, 9 floats vertices, uint16 attribute). All little-endian.
 */
export function writeBinaryStl(mesh: Mesh, header = 'ShapePilot keycap tray'): ArrayBuffer {
  const { positions: p, indices: ix } = mesh
  const n = ix.length / 3
  const buf = new ArrayBuffer(84 + 50 * n)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)

  // Must not start with "solid" or readers may sniff the file as ASCII.
  const text = `H: ${header}`.slice(0, 79)
  for (let i = 0; i < text.length; i++) u8[i] = text.charCodeAt(i) & 0x7f
  dv.setUint32(80, n, true)

  let o = 84
  for (let t = 0; t < n; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
    const ax = p[a], ay = p[a + 1], az = p[a + 2]
    const bx = p[b], by = p[b + 1], bz = p[b + 2]
    const cx = p[c], cy = p[c + 1], cz = p[c + 2]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    // Degenerate triangles are kept for manifoldness; they have no normal.
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true)
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true)
    dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true)
    dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true)
    o += 50 // attribute byte count stays 0 from the zero-filled buffer
  }
  return buf
}

export interface ParsedStl { triangleCount: number; positions: Float32Array }

/** Minimal binary-STL reader, used by tests and the file viewer. */
export function readBinaryStl(buf: ArrayBuffer): ParsedStl {
  const dv = new DataView(buf)
  const n = dv.getUint32(80, true)
  if (buf.byteLength !== 84 + 50 * n) {
    throw new Error(`not a binary STL: ${buf.byteLength} bytes, header claims ${n} triangles`)
  }
  const positions = new Float32Array(n * 9)
  let o = 84
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 9; v++) positions[t * 9 + v] = dv.getFloat32(o + 12 + v * 4, true)
    o += 50
  }
  return { triangleCount: n, positions }
}
