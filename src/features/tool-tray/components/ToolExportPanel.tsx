import { Box, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { Issue } from '../geometry/validate.ts'

export interface ToolExportPanelProps {
  mesh: Mesh
  issues: Issue[]
}

/**
 * The print-readiness indicator. The STL and 3MF downloads live in the File
 * menu (see ToolTrayPage); this stays in the toolbar so a problem with the
 * mesh is visible without opening a menu.
 */
export default function ToolExportPanel({ mesh, issues }: ToolExportPanelProps) {
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  const statusText = errors.length
    ? errors.map(i => i.message).join(' ')
    : warnings.length
      ? warnings.map(i => i.message).join(' ')
      : `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles. `
        + 'Print it rim up, underside on the bed — every pocket then opens upward and '
        + 'nothing needs bridging. Files are generated in the browser; nothing is uploaded.'

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
