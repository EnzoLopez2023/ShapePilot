import { useMemo } from 'react'
import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Issue, Target } from '../geometry/validate.ts'
import { issuesFor } from '../geometry/validate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'

/** A body split off the tray for a second filament -- the nameplate text, the
 *  corner spacers. `suffix` names the STL file, `label` the 3MF object. */
export interface ExtraPart {
  mesh: Mesh
  suffix: string
  label: string
  /** AMS filament number this body prints in, when its colour is loaded. */
  filamentSlot?: number
}

export interface ExportPanelProps {
  /** The tray body, for the triangle count in the status text. */
  mesh: Mesh
  issues: Issue[]
  /** Lifted so the toolbar can hide printer-only controls for the CNC target. */
  target: Target
  onTarget: (target: Target) => void
}

// The export buttons themselves live in the File menu (`useExportActions`);
// what stays in the toolbar is the fabrication target and the status icon, so
// status is a single icon with the detail in its tooltip.
export default function ExportPanel({ mesh, issues, target, onTarget }: ExportPanelProps) {
  const scoped = useMemo(() => issuesFor(issues, target), [issues, target])
  const errors = scoped.filter(i => i.severity === 'error')
  const warnings = scoped.filter(i => i.severity === 'warning')

  const statusText = errors.length
    ? errors.map(i => i.message).join(' ')
    : warnings.length
      ? warnings.map(i => i.message).join(' ')
      : (target === 'print'
          ? `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles. Files are generated in the browser; nothing is uploaded.`
          : 'All pockets are machinable with the current bit. Files are generated in the browser; nothing is uploaded.')

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
      <ToggleButtonGroup
        exclusive size="small" value={target}
        aria-label="Fabrication target"
        onChange={(_e, v) => v && onTarget(v)}
      >
        <ToggleButton value="print">Bambu X2D</ToggleButton>
        <ToggleButton value="cnc">Shaper Origin</ToggleButton>
      </ToggleButtonGroup>

      <Box component="span" aria-live="polite" sx={{ display: 'flex' }}>
        <Tooltip title={statusText}>
          {errors.length
            ? <ErrorOutlineIcon color="error" fontSize="small" role="img" aria-label={statusText} />
            : warnings.length
              ? <WarningAmberIcon color="warning" fontSize="small" role="img" aria-label={statusText} />
              : <CheckCircleOutlineIcon color="success" fontSize="small" role="img" aria-label={statusText} />}
        </Tooltip>
      </Box>
    </Stack>
  )
}
