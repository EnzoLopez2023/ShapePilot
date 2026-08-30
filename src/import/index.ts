// One entry point for every supported format, chosen by file extension.
import type { ImportFormat } from '../model/document.ts'
import { importDxf } from './dxf.ts'
import { importObj, importStl, importThreeMf } from './mesh.ts'
import { importSvg } from './svg.ts'
import type { ImportResult } from './types.ts'
import { ImportError, formatFromFilename } from './types.ts'

export type { ImportResult, ImportedMesh, ImportedOutlines } from './types.ts'
export { ImportError, formatFromFilename } from './types.ts'

/** Formats each sub-app offers, per the product brief. */
export const SHAPER_IMPORT_FORMATS: readonly ImportFormat[] = ['svg', 'dxf', 'stl']
export const BAMBU_IMPORT_FORMATS: readonly ImportFormat[] = ['stl', 'obj', 'svg', '3mf']

export const ACCEPT_ATTRIBUTE = (formats: readonly ImportFormat[]): string =>
  formats.map(f => `.${f}`).join(',')

/** Anything larger is a sign of a mistake rather than a part, and would blow
 *  past what the browser asset store can hold comfortably. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024

export async function importFile(file: File): Promise<ImportResult> {
  const format = formatFromFilename(file.name)
  if (!format) throw new ImportError(`${file.name} is not an STL, OBJ, 3MF, SVG or DXF file`)
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError(`${file.name} is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB`)
  }
  if (file.size === 0) throw new ImportError(`${file.name} is empty`)

  switch (format) {
    case 'stl': return importStl(await file.arrayBuffer())
    case '3mf': return importThreeMf(await file.arrayBuffer())
    case 'obj': return importObj(await file.text())
    case 'svg': return importSvg(await file.text())
    case 'dxf': return importDxf(await file.text())
  }
}

export { importDxf, importObj, importStl, importSvg, importThreeMf }
