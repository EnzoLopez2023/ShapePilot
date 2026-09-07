import { zipSync } from 'fflate'
import { Box, Button, Stack, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Mesh } from '../../../geometry/mesh.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import { writeThreeMf, writeThreeMfParts } from '../../../export/threemf.ts'
import { safeFilename, triggerDownload } from '../../../export/download.ts'
import type { Issue } from '../geometry/validate.ts'
import type { SwitchTrayDesign } from '../model/types.ts'

/** A body split off the plate for a second filament -- the feet, the nameplate. */
export interface ExtraPart {
  mesh: Mesh
  suffix: string
  label: string
}

export interface SwitchExportPanelProps {
  design: SwitchTrayDesign
  /** The plate body. Excludes anything listed in `extraParts`. */
  mesh: Mesh
  extraParts: ExtraPart[]
  issues: Issue[]
}

/**
 * Print-only: a switch tray is a plate with posts under it, which a router
 * cannot make in one setup, so there is no CNC target to toggle here.
 */
export default function SwitchExportPanel(
  { design, mesh, extraParts, issues }: SwitchExportPanelProps,
) {
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const statusText = errors.length
    ? errors.map(i => i.message).join(' ')
    : warnings.length
      ? warnings.map(i => i.message).join(' ')
      : `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles. `
        + 'Print it feet up, plate flat on the bed — feet down would bridge the whole '
        + 'plate over air. Files are generated in the browser; nothing is uploaded.'

  const download = (format: 'stl' | '3mf') => {
    const base = safeFilename(design.name)
    if (format === 'stl') {
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
        triggerDownload(zipSync(files, { level: 6 }), `${base}_2-colour.zip`, 'application/zip')
      } else {
        triggerDownload(writeBinaryStl(mesh, design.name), `${base}.stl`, 'model/stl')
      }
      return
    }
    triggerDownload(
      extraParts.length
        ? writeThreeMfParts([
          { mesh, name: `${design.name} plate` },
          ...extraParts.map(p => ({ mesh: p.mesh, name: `${design.name} ${p.label}` })),
        ], design.name)
        : writeThreeMf(mesh, design.name),
      `${base}.3mf`, 'model/3mf')
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box component="span" aria-live="polite" sx={{ display: 'flex' }}>
        <Tooltip title={statusText}>
          {errors.length
            ? <ErrorOutlineIcon color="error" fontSize="small" role="img" aria-label={statusText} />
            : warnings.length
              ? <WarningAmberIcon color="warning" fontSize="small" role="img" aria-label={statusText} />
              : <CheckCircleOutlineIcon color="success" fontSize="small" role="img" aria-label={statusText} />}
        </Tooltip>
      </Box>
      <Stack direction="row" spacing={0.5}>
        <Button variant="contained" size="small" onClick={() => download('stl')}>STL</Button>
        <Button variant="contained" size="small" onClick={() => download('3mf')}>3MF</Button>
      </Stack>
    </Stack>
  )
}
