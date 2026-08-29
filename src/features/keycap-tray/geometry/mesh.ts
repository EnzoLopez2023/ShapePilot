// Mesh generation from a stack of z-bands. Every feature in a keycap tray is a
// 2D polygon extruded straight up, so there is no 3D CSG here and never should
// be -- see layers.ts for the two rules that generate every surface.
import type { MultiPolygon, Ring, Vec2 } from './vec.ts'
import { QUANTUM } from './vec.ts'
import { signedArea2, triangulatePolygon } from './triangulate.ts'

export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
  triangleCount: number
  bbox: [number, number, number, number, number, number]
}

export type Facing = 'up' | 'down'


/**
 * Split a ring into the vertices a triangulator will keep and the collinear runs
 * it drops.
 *
 * earcut prunes exactly-collinear points before triangulating, so its output
 * boundary can skip vertices that the wall extrusion still uses -- a T-junction
 * between the cap and its own walls. Doing the pruning here instead means we
 * know exactly which vertices went, and can stitch them back (see addHorizontal).
 *
 * The epsilon is a deliberate superset of earcut's exact-zero test: dropping a
 * few more points than it would is safe, dropping fewer is not.
 */
function pruneCollinear(ring: Ring): { kept: Ring; dropped: Map<number, Vec2[]> } {
  const n = ring.length
  if (n < 4) return { kept: ring, dropped: new Map() }
  const keep = new Array<boolean>(n).fill(true)
  // Sweep repeatedly: removing one point can make its neighbour collinear too.
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue
      let prev = (i - 1 + n) % n
      while (!keep[prev] && prev !== i) prev = (prev - 1 + n) % n
      let next = (i + 1) % n
      while (!keep[next] && next !== i) next = (next + 1) % n
      if (prev === i || next === i || prev === next) continue
      const [ax, ay] = ring[prev], [bx, by] = ring[next], [px, py] = ring[i]
      const dx = bx - ax, dy = by - ay
      const len = Math.hypot(dx, dy)
      if (len < 1e-12) continue
      if (Math.abs((px - ax) * dy - (py - ay) * dx) / len < QUANTUM) {
        // Never let a ring collapse below a triangle.
        if (keep.reduce((c, k) => c + (k ? 1 : 0), 0) <= 3) break
        keep[i] = false
        changed = true
      }
    }
  }
  const kept: Ring = []
  const dropped = new Map<number, Vec2[]>()
  for (let i = 0; i < n; i++) {
    if (keep[i]) { kept.push(ring[i]); continue }
    const owner = kept.length - 1 // run hangs off the last kept vertex
    const list = dropped.get(owner)
    if (list) list.push(ring[i])
    else dropped.set(owner, [ring[i]])
  }
  return { kept, dropped }
}


/**
 * Final safety net: split any unpaired half-edge through mesh vertices that lie
 * on it.
 *
 * Upstream stages (the clipper, earcut's own pruning, T-junction insertion
 * between regions) each try to keep the surfaces vertex-compatible, but they
 * work on 2D regions in isolation. This pass works on the finished triangle soup
 * and targets the defect directly: an edge used by one triangle and not matched
 * in reverse by another is exactly what makes a slicer call the mesh non-manifold.
 *
 * A triangle (a,b,c) whose edge a->b needs points p1..pk becomes a fan from c,
 * which replaces a->b with the chain a->p1->..->pk->b and leaves the other two
 * edges untouched.
 */
function repairTJunctions(positions: number[], indices: number[], maxPasses = 4): number[] {
  const CELL = 4
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`

  const grid = new Map<string, number[]>()
  for (let v = 0; v < positions.length / 3; v++) {
    const k = key(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
    const bucket = grid.get(k)
    if (bucket) bucket.push(v)
    else grid.set(k, [v])
  }

  let tris = indices
  for (let pass = 0; pass < maxPasses; pass++) {
    const owner = new Map<string, number>() // directed edge -> triangle index
    const counts = new Map<string, number>()
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const fwd = `${p}_${q}`, rev = `${q}_${p}`
        const r = counts.get(rev)
        if (r) { if (r === 1) counts.delete(rev); else counts.set(rev, r - 1); continue }
        counts.set(fwd, (counts.get(fwd) ?? 0) + 1)
        owner.set(fwd, t / 3)
      }
    }
    if (!counts.size) break

    const replacements = new Map<number, number[]>()
    for (const edge of counts.keys()) {
      const [a, b] = edge.split('_').map(Number)
      const ti = owner.get(edge)
      if (ti === undefined || replacements.has(ti)) continue

      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
      const dx = bx - ax, dy = by - ay, dz = bz - az
      const len2 = dx * dx + dy * dy + dz * dz
      if (len2 < 1e-18) continue
      const len = Math.sqrt(len2)

      // Candidate vertices from every cell the segment's bounding box touches.
      const cand: { t: number; v: number }[] = []
      const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL)
      const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL)
      const z0 = Math.floor(Math.min(az, bz) / CELL), z1 = Math.floor(Math.max(az, bz) / CELL)
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (let cz = z0; cz <= z1; cz++) {
            for (const v of grid.get(`${cx},${cy},${cz}`) ?? []) {
              if (v === a || v === b) continue
              const px = positions[v * 3] - ax
              const py = positions[v * 3 + 1] - ay
              const pz = positions[v * 3 + 2] - az
              const tt = (px * dx + py * dy + pz * dz) / len2
              if (tt <= 1e-9 || tt >= 1 - 1e-9) continue
              // distance from the segment's line, via the cross product
              const cxv = py * dz - pz * dy
              const cyv = pz * dx - px * dz
              const czv = px * dy - py * dx
              if (Math.hypot(cxv, cyv, czv) / len > QUANTUM) continue
              cand.push({ t: tt, v })
            }
          }
        }
      }
      if (!cand.length) continue
      cand.sort((u, v) => u.t - v.t)

      const tri = [tris[ti * 3], tris[ti * 3 + 1], tris[ti * 3 + 2]]
      const c = tri.find(v => v !== a && v !== b)
      if (c === undefined) continue
      const chain = [a, ...cand.map(x => x.v).filter((v, i, arr) => arr.indexOf(v) === i), b]
      const fan: number[] = []
      for (let i = 0; i < chain.length - 1; i++) fan.push(chain[i], chain[i + 1], c)
      replacements.set(ti, fan)
    }
    if (!replacements.size) break

    const next: number[] = []
    for (let t = 0; t < tris.length / 3; t++) {
      const rep = replacements.get(t)
      if (rep) next.push(...rep)
      else next.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2])
    }
    tris = next
  }
  return tris
}

export class MeshBuilder {
  private pos: number[] = []
  private idx: number[] = []
  private map = new Map<string, number>()

  /** Welds on the quantized triple. Never push raw coordinates past this. */
  vertex(x: number, y: number, z: number): number {
    const k = `${Math.round(x / QUANTUM)},${Math.round(y / QUANTUM)},${Math.round(z / QUANTUM)}`
    let i = this.map.get(k)
    if (i === undefined) {
      i = this.pos.length / 3
      this.pos.push(x, y, z)
      this.map.set(k, i)
    }
    return i
  }

  tri(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return // collapsed by welding
    this.idx.push(a, b, c)
  }

  /**
   * Outer rings are CCW and holes CW, so walking any ring in index order keeps
   * material on the left. That makes this single winding correct for both.
   */
  addWalls(mp: MultiPolygon, z0: number, z1: number): void {
    if (z1 - z0 < 1e-9) return
    for (const poly of mp) {
      for (const ring of poly) {
        const n = ring.length
        if (n < 3) continue
        for (let i = 0; i < n; i++) {
          const [ax, ay] = ring[i]
          const [bx, by] = ring[(i + 1) % n]
          const v0 = this.vertex(ax, ay, z0)
          const v1 = this.vertex(bx, by, z0)
          const v2 = this.vertex(bx, by, z1)
          const v3 = this.vertex(ax, ay, z1)
          this.tri(v0, v1, v2)
          this.tri(v0, v2, v3)
        }
      }
    }
  }

  addHorizontal(mp: MultiPolygon, z: number, facing: Facing): void {
    for (const poly of mp) {
      const pruned = poly.map(pruneCollinear)
      this.stitchCollinear(pruned, z, facing)
      const { verts, tris } = triangulatePolygon(pruned.map(r => r.kept))

      // Orientation is decided once for the whole polygon, from the summed area,
      // rather than per triangle. A finely flattened arc yields a handful of
      // exactly-degenerate triangles whose own sign is meaningless; flipping
      // those individually would reverse their edges relative to their
      // neighbours and unpair them. They are kept, not discarded -- a zero-area
      // triangle is invisible to a slicer but its edges still have to pair.
      let total = 0
      for (let t = 0; t < tris.length; t += 3) {
        total += signedArea2(verts, tris[t], tris[t + 1], tris[t + 2])
      }
      const flip = total < 0

      for (let t = 0; t < tris.length; t += 3) {
        const p = tris[t]
        let qi = tris[t + 1], r = tris[t + 2]
        if (flip) { const tmp = qi; qi = r; r = tmp } // force CCW == +Z normal
        const i0 = this.vertex(verts[p * 2], verts[p * 2 + 1], z)
        const i1 = this.vertex(verts[qi * 2], verts[qi * 2 + 1], z)
        const i2 = this.vertex(verts[r * 2], verts[r * 2 + 1], z)
        // The only reversal in the whole pipeline.
        if (facing === 'up') this.tri(i0, i1, i2)
        else this.tri(i0, i2, i1)
      }
    }
  }


  /**
   * Re-attach the collinear vertices pruned before triangulation. Each run
   * a -> v1..vn -> b becomes a fan from `a`, which is zero-area (the points are
   * collinear by construction) but pairs the wall's split edges against the
   * cap's single a->b edge. Without it the cap and its walls disagree and the
   * mesh leaks.
   */
  private stitchCollinear(
    pruned: { kept: Ring; dropped: Map<number, Vec2[]> }[],
    z: number,
    facing: Facing,
  ): void {
    for (const { kept, dropped } of pruned) {
      if (!dropped.size || kept.length < 2) continue
      for (const [owner, run] of dropped) {
        const a = kept[owner === -1 ? kept.length - 1 : owner]
        const b = kept[(owner + 1 + kept.length) % kept.length]
        const chain = [a, ...run, b]
        const ia = this.vertex(a[0], a[1], z)
        for (let i = 1; i < chain.length - 1; i++) {
          const i1 = this.vertex(chain[i][0], chain[i][1], z)
          const i2 = this.vertex(chain[i + 1][0], chain[i + 1][1], z)
          if (facing === 'up') this.tri(ia, i1, i2)
          else this.tri(ia, i2, i1)
        }
      }
    }
  }

  get triangleCount(): number { return this.idx.length / 3 }

  finish(): Mesh {
    this.idx = repairTJunctions(this.pos, this.idx)
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.pos[i], y = this.pos[i + 1], z = this.pos[i + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    return {
      positions: new Float32Array(this.pos),
      indices: new Uint32Array(this.idx),
      triangleCount: this.idx.length / 3,
      bbox: [minX, minY, minZ, maxX, maxY, maxZ],
    }
  }
}

export interface ManifoldReport {
  ok: boolean
  /** Half-edges that never found an opposite. Non-empty means a leaky mesh. */
  danglingEdges: number
  /** Signed volume via the divergence theorem. Must be positive. */
  volume: number
}

/**
 * Every interior edge must be traversed once in each direction. Counting
 * half-edges and requiring them all to cancel catches leaks, duplicated faces
 * and inverted windings in one pass.
 */
export function checkManifold(mesh: Mesh): ManifoldReport {
  const { indices: ix, positions: p } = mesh
  const counts = new Map<string, number>()
  const bump = (a: number, b: number) => {
    const fwd = `${a}_${b}`, rev = `${b}_${a}`
    const r = counts.get(rev)
    if (r) { if (r === 1) counts.delete(rev); else counts.set(rev, r - 1); return }
    counts.set(fwd, (counts.get(fwd) ?? 0) + 1)
  }
  let vol = 0
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], b = ix[t + 1], c = ix[t + 2]
    bump(a, b); bump(b, c); bump(c, a)
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2]
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2]
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  let dangling = 0
  for (const n of counts.values()) dangling += n
  return { ok: dangling === 0 && vol > 0, danglingEdges: dangling, volume: vol }
}
