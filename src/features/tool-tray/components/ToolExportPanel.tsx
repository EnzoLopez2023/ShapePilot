import { Box, Button, Stack, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Mesh } from '../../../geometry/mesh.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import { writeThreeMf } from '../../../export/threemf.ts'
import { safeFilename, triggerDownload } from '../../../export/download.ts'
import type { Issue } from '../geometry/validate.ts'
import type { ToolTrayDesign } from '../model/types.ts'

export interface ToolExportPanelProps {
  design: ToolTrayDesign
  mesh: Mesh
  issues: Issue[]
}

/**
 * Print-only, and one body.
 *
 * Unlike the switch tray there is nothing to split off for a second filament
 * yet -- no nameplate, and the feet are welded in -- so there is no zip path
 * here. When one arrives, `writeThreeMfParts` already handles it.
 */
export default function ToolExportPanel({ design, mesh, issues }: ToolExportPanelProps) {
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const statusText = errors.length
    ? errors.map(i => i.message).join(' ')
    : warnings.length
      ? warnings.map(i => i.message).join(' ')
      : `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles. `
        + 'Print it rim up, underside on the bed — every pocket then opens upward and '
        + 'nothing needs bridging. Files are generated in the browser; nothing is uploaded.'

  const download = (format: 'stl' | '3mf') => {
    const base = safeFilename(design.name)
    if (format === 'stl') {
      triggerDownload(writeBinaryStl(mesh, design.name), `${base}.stl`, 'model/stl')
      return
    }
    triggerDownload(writeThreeMf(mesh, design.name), `${base}.3mf`, 'model/3mf')
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
