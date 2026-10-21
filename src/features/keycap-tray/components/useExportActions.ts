import { useMemo } from 'react'
import { strToU8 } from 'fflate'
import type { MenuAction } from '../../../components/menu/AppMenu.tsx'
import type { Target } from '../geometry/validate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { FabricationSettings, TrayDesign } from '../model/types.ts'
import type { ExtraPart } from './ExportPanel.tsx'
import { tileTray } from '../geometry/tiling.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import { zipParts } from '../../../export/zip.ts'
import { writeThreeMf, writeThreeMfParts } from '../../../export/threemf.ts'
import { writeShaperSvg } from '../export/svg.ts'
import { writeDxf } from '../export/dxf.ts'
import { safeFilename, triggerDownload } from '../../../export/download.ts'
import { assignExtruders } from '../../bambu-designer/amsTrays.ts'

export interface ExportActionsInput {
  design: TrayDesign
  /** The tray body, excluding any body in `extraParts`. */
  mesh: Mesh
  extraParts: ExtraPart[]
  bodySlot?: number
  maxSlot?: number
  fab: FabricationSettings
  target: Target
}

/**
 * The File > Export entries for the current fabrication target: STL and 3MF
 * (plus a split-to-pieces zip when the tray is bigger than the plate) for the
 * printer, SVG and DXF for the router.
 */
export function useExportActions(
  { design, mesh, extraParts, bodySlot, maxSlot = 4, fab, target }: ExportActionsInput,
): MenuAction[] {
  const tiles = useMemo(
    () => (target === 'print'
      ? tileTray(design, { plateWidthMm: fab.plateWidthMm, plateDepthMm: fab.plateDepthMm })
      : []),
    [design, fab.plateWidthMm, fab.plateDepthMm, target])

  const base = safeFilename(design.name)

  const downloadTiles = () => {
    const files: Record<string, Uint8Array> = {}
    for (const t of tiles) {
      files[`${base}_${t.label}.stl`] =
        new Uint8Array(writeBinaryStl(t.mesh, `${design.name} ${t.label}`))
    }
    files['README.txt'] = strToU8(
      `${design.name}\n${tiles.length} pieces, ${tiles[0]?.widthMm.toFixed(0)} x ` +
      `${tiles[0]?.depthMm.toFixed(0)} mm or smaller. Interior edges interlock with finger ` +
      `joints -- press together and glue. Labels are row then column from the front-left.\n`)
    triggerDownload(zipParts(files), `${base}_pieces.zip`, 'application/zip')
  }

  const downloadStl = () => {
    if (extraParts.length) {
      // STL carries no colour, so a two-filament tray is separate files the
      // slicer aligns by their shared origin.
      const files: Record<string, Uint8Array> = {
        [`${base}_tray.stl`]: new Uint8Array(writeBinaryStl(mesh, `${design.name} tray`)),
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
    // A body whose colour is loaded in the AMS prints from that tray; the
    // rest take the lowest numbers nobody chose, in order.
    const extruders = assignExtruders([{ filamentSlot: bodySlot }, ...extraParts], maxSlot)
    triggerDownload(
      extraParts.length
        ? writeThreeMfParts([
          { mesh, name: `${design.name} tray`, extruder: extruders[0] },
          ...extraParts.map((p, i) => (
            { mesh: p.mesh, name: `${design.name} ${p.label}`, extruder: extruders[i + 1] })),
        ], design.name)
        : writeThreeMf(mesh, design.name),
      `${base}.3mf`, 'model/3mf')
  }

  if (target === 'print') {
    return [
      { label: 'Export STL', onClick: downloadStl },
      { label: 'Export 3MF', onClick: download3mf },
      ...(tiles.length > 1
        ? [{ label: `Export in ${tiles.length} pieces (zip of STLs)`, onClick: downloadTiles }]
        : []),
    ]
  }
  return [
    { label: 'Export SVG (Shaper Origin)', onClick: () => triggerDownload(writeShaperSvg(design), `${base}.svg`, 'image/svg+xml') },
    { label: 'Export DXF', onClick: () => triggerDownload(writeDxf(design), `${base}.dxf`, 'image/vnd.dxf') },
  ]
}
