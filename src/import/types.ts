// Import results. Every importer returns millimetres, y-up -- the conversion
// from the file's own units happens inside the importer, never downstream.
import type { Mesh } from '../geometry/mesh.ts'
import type { Contour, ImportFormat } from '../model/document.ts'

export interface ImportedOutlines {
  kind: '2d'
  format: ImportFormat
  /** One entry per closed region: [outer CCW, ...holes CW]. */
  regions: Contour[][]
}

export interface ImportedMesh {
  kind: '3d'
  format: ImportFormat
  mesh: Mesh
}

export type ImportResult = ImportedOutlines | ImportedMesh

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/** 25.4 mm to the inch; SVG's own 96 dpi user unit is the common case. */
export const MM_PER_INCH = 25.4
export const MM_PER_PX_96DPI = MM_PER_INCH / 96

export const formatFromFilename = (filename: string): ImportFormat | null => {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return ext === 'stl' || ext === 'obj' || ext === 'svg' || ext === 'dxf' || ext === '3mf'
    ? ext
    : null
}
