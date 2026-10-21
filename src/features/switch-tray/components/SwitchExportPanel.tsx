import { Box, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { Issue } from '../geometry/validate.ts'

/** A body split off the plate for a second filament -- the feet, the nameplate. */
export interface ExtraPart {
  mesh: Mesh
  suffix: string
  label: string
}

export interface SwitchExportPanelProps {
  /** The plate body, for the triangle count in the status text. */
  mesh: Mesh
  issues: Issue[]
}

/**
 * Print-only: a switch tray is a plate with posts under it, which a router
 * cannot make in one setup, so there is no CNC target to toggle here. The
 * STL / 3MF downloads are in the File menu; this is just the status icon.
 */
export default function SwitchExportPanel({ mesh, issues }: SwitchExportPanelProps) {
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const statusText = errors.length
    ? errors.map(i => i.message).join(' ')
    : warnings.length
      ? warnings.map(i => i.message).join(' ')
      : `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles. `
        + 'Print it feet up, plate flat on the bed — feet down would bridge the whole '
        + 'plate over air. Files are generated in the browser; nothing is uploaded.'

  return (
    <Box component="span" aria-live="polite" sx={{ display: 'flex' }}>
      <Tooltip title={statusText}>
        {errors.length
          ? <ErrorOutlineIcon color="error" fontSize="small" role="img" aria-label={statusText} />
          : warnings.length
            ? <WarningAmberIcon color="warning" fontSize="small" role="img" aria-label={statusText} />
            : <CheckCircleOutlineIcon color="success" fontSize="small" role="img" aria-label={statusText} />}
      </Tooltip>
    </Box>
  )
}
