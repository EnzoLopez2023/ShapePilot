import { useMemo, useState } from 'react'
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Issue, Target } from '../geometry/validate.ts'
import { issuesFor } from '../geometry/validate.ts'
import type { Mesh } from '../geometry/mesh.ts'
import type { TrayDesign } from '../model/types.ts'
import { writeBinaryStl } from '../export/stl.ts'
import { writeThreeMf } from '../export/threemf.ts'
import { writeShaperSvg } from '../export/svg.ts'
import { writeDxf } from '../export/dxf.ts'
import { safeFilename, triggerDownload } from '../export/download.ts'

export interface ExportPanelProps {
  design: TrayDesign
  mesh: Mesh
  issues: Issue[]
}

const FORMATS: { id: string; label: string; target: Target; ext: string; mime: string }[] = [
  { id: 'stl', label: 'STL', target: 'print', ext: 'stl', mime: 'model/stl' },
  { id: '3mf', label: '3MF', target: 'print', ext: '3mf', mime: 'model/3mf' },
  { id: 'svg', label: 'SVG', target: 'cnc', ext: 'svg', mime: 'image/svg+xml' },
  { id: 'dxf', label: 'DXF', target: 'cnc', ext: 'dxf', mime: 'image/vnd.dxf' },
]

// Lives in the header toolbar rather than a full side panel, so status is a
// single icon with the detail in its tooltip instead of a stack of Alerts.
export default function ExportPanel({ design, mesh, issues }: ExportPanelProps) {
  const [target, setTarget] = useState<Target>('print')

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

  const download = (id: string) => {
    const fmt = FORMATS.find(f => f.id === id)!
    const name = `${safeFilename(design.name)}.${fmt.ext}`
    if (id === 'stl') triggerDownload(writeBinaryStl(mesh, design.name), name, fmt.mime)
    if (id === '3mf') triggerDownload(writeThreeMf(mesh, design.name), name, fmt.mime)
    if (id === 'svg') triggerDownload(writeShaperSvg(design), name, fmt.mime)
    if (id === 'dxf') triggerDownload(writeDxf(design), name, fmt.mime)
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
      <ToggleButtonGroup
        exclusive size="small" value={target}
        aria-label="Fabrication target"
        onChange={(_e, v) => v && setTarget(v)}
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

      <Stack direction="row" spacing={0.5}>
        {FORMATS.filter(f => f.target === target).map(f => (
          <Button key={f.id} variant="contained" size="small" onClick={() => download(f.id)}>
            {f.label}
          </Button>
        ))}
      </Stack>
    </Stack>
  )
}
