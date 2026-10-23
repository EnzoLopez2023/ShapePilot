import type { Mesh as SolidMesh } from '../../geometry/mesh.ts'
import type { SolidViewerDimension } from './SolidViewer3D.tsx'

/** The three overall extents of a bbox, drawn off its near-bottom corner. */
export function bboxDimensions(
  bbox: SolidMesh['bbox'], format: (mm: number) => string,
): SolidViewerDimension[] {
  const [x0, y0, z0, x1, y1, z1] = bbox
  const gap = Math.max(x1 - x0, y1 - y0, z1 - z0) * 0.05
  return [
    { from: [x0, y0 - gap, z0], to: [x1, y0 - gap, z0], text: format(x1 - x0) },
    { from: [x1 + gap, y0, z0], to: [x1 + gap, y1, z0], text: format(y1 - y0) },
    { from: [x0 - gap, y0 - gap, z0], to: [x0 - gap, y0 - gap, z1], text: format(z1 - z0) },
  ]
}
