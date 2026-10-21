import type { MenuAction } from '../../../components/menu/AppMenu.tsx'
import type { Mesh } from '../../../geometry/mesh.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import { writeThreeMf, writeThreeMfParts } from '../../../export/threemf.ts'
import { safeFilename, triggerDownload } from '../../../export/download.ts'
import { zipParts } from '../../../export/zip.ts'
import type { SwitchTrayDesign } from '../model/types.ts'
import type { ExtraPart } from './SwitchExportPanel.tsx'

export interface SwitchExportActionsInput {
  design: SwitchTrayDesign
  /** The plate body. Excludes anything listed in `extraParts`. */
  mesh: Mesh
  extraParts: ExtraPart[]
}

/** The File > Export entries: STL and 3MF, print-only. */
export function switchExportActions(
  { design, mesh, extraParts }: SwitchExportActionsInput,
): MenuAction[] {
  const base = safeFilename(design.name)

  const downloadStl = () => {
    if (extraParts.length) {
      // STL carries no colour, so a two-filament tray is separate files the
      // slicer aligns by their shared origin.
      const files: Record<string, Uint8Array> = {
        [`${base}_plate.stl`]: new Uint8Array(writeBinaryStl(mesh, `${design.name} plate`)),
      }
      for (const part of extraParts) {
        files[`${base}_${part.suffix}.stl`] =
          new Uint8Array(writeBinaryStl(part.mesh, `${design.name} ${part.suffix}`))
      }
      triggerDownload(zipParts(files), `${base}_2-colour.zip`, 'application/zip')
    } else {
      triggerDownload(writeBinaryStl(mesh, design.name), `${base}.stl`, 'model/stl')
    }
  }

  const download3mf = () => {
    triggerDownload(
      extraParts.length
        ? writeThreeMfParts([
          { mesh, name: `${design.name} plate`, extruder: 1 },
          ...extraParts.map((p, i) => (
            { mesh: p.mesh, name: `${design.name} ${p.label}`, extruder: Math.min(i + 2, 4) })),
        ], design.name)
        : writeThreeMf(mesh, design.name),
      `${base}.3mf`, 'model/3mf')
  }

  return [
    { label: 'Export STL', onClick: downloadStl },
    { label: 'Export 3MF', onClick: download3mf },
  ]
}
