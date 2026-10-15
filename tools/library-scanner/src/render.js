// Software thumbnail renderer: isometric, z-buffered, flat shaded, 2x
// supersampled, transparent background. No GPU or headless browser needed, so
// it runs the same under launchd as in tests.

import { deflateSync, crc32 } from 'node:zlib'

const BASE = [0.62, 0.66, 0.7] // neutral slate; the UI tints around it
const LIGHT = normalize([-0.45, -0.35, 0.82])
const FILL = normalize([0.6, 0.3, 0.3])

/** Renders a triangle soup to a PNG buffer (size x size). Returns null for empty meshes. */
export function renderThumbnail(tris, { size = 512, maxTriangles = 2_000_000 } = {}) {
  const count = tris.length / 9
  if (!count || count > maxTriangles) return null
  const ss = 2
  const W = size * ss
  // Camera: yaw -45° around Z (model Z is up on the print bed), then pitch 35°.
  const yaw = (-45 * Math.PI) / 180
  const pitch = (35 * Math.PI) / 180
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const view = (x, y, z) => {
    const x1 = x * cy - y * sy
    const y1 = x * sy + y * cy
    // screen X = x1, screen Y = up, depth toward viewer
    return [x1, z * cp - y1 * sp, z * sp + y1 * cp]
  }

  const projected = new Float32Array(tris.length)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < tris.length; i += 3) {
    const [x, y, d] = view(tris[i], tris[i + 1], tris[i + 2])
    projected[i] = x
    projected[i + 1] = y
    projected[i + 2] = -d
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const scale = (W * 0.84) / span
  const offX = W / 2 - ((minX + maxX) / 2) * scale
  const offY = W / 2 + ((minY + maxY) / 2) * scale

  const depth = new Float32Array(W * W).fill(Infinity)
  const color = new Uint8ClampedArray(W * W * 4)

  for (let t = 0; t < count; t += 1) {
    const o = t * 9
    // World-space normal for lighting (view-independent light feels steadier).
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2]
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2]
    const n = normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx])
    const vn = view(n[0], n[1], n[2])
    // Two-sided: flip normals facing away so broken meshes still read well.
    const facing = vn[2] >= 0 ? 1 : -1
    const lambert = Math.max(0, facing * dot(n, LIGHT))
    const fill = Math.max(0, facing * dot(n, FILL)) * 0.25
    const shade = Math.min(1, 0.32 + lambert * 0.62 + fill)
    const r = BASE[0] * shade * 255, g = BASE[1] * shade * 255, b = BASE[2] * shade * 255

    const ax = projected[o] * scale + offX, ay = offY - projected[o + 1] * scale, az = projected[o + 2]
    const bx = projected[o + 3] * scale + offX, by = offY - projected[o + 4] * scale, bz = projected[o + 5]
    const cx = projected[o + 6] * scale + offX, cyy = offY - projected[o + 7] * scale, cz = projected[o + 8]
    const area = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax)
    if (area === 0) continue
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cyy)))
    const y1 = Math.min(W - 1, Math.ceil(Math.max(ay, by, cyy)))
    for (let py = y0; py <= y1; py += 1) {
      const sy2 = py + 0.5
      for (let px = x0; px <= x1; px += 1) {
        const sx = px + 0.5
        let w0 = (bx - sx) * (cyy - sy2) - (by - sy2) * (cx - sx)
        let w1 = (cx - sx) * (ay - sy2) - (cyy - sy2) * (ax - sx)
        let w2 = (ax - sx) * (by - sy2) - (ay - sy2) * (bx - sx)
        if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2 }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const a = Math.abs(area)
        const z = (w0 * az + w1 * bz + w2 * cz) / a
        const idx = py * W + px
        if (z >= depth[idx]) continue
        depth[idx] = z
        color[idx * 4] = r
        color[idx * 4 + 1] = g
        color[idx * 4 + 2] = b
        color[idx * 4 + 3] = 255
      }
    }
  }

  // Box-filter downsample (premultiplied so edges blend into transparency).
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < ss; dy += 1) {
        for (let dx = 0; dx < ss; dx += 1) {
          const i = ((y * ss + dy) * W + (x * ss + dx)) * 4
          const al = color[i + 3] / 255
          r += color[i] * al; g += color[i + 1] * al; b += color[i + 2] * al; a += al
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a
        out[o + 3] = Math.round((a / (ss * ss)) * 255)
      }
    }
  }
  return encodePng(out, size, size)
}

/** Minimal RGBA PNG encoder (filter 0 on every row). */
export function encodePng(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
