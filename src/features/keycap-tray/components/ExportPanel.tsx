import { useMemo, useState } from 'react'
import { Alert, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
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

export default function ExportPanel({ design, mesh, issues }: ExportPanelProps) {
  const [target, setTarget] = useState<Target>('print')

  const scoped = useMemo(() => issuesFor(issues, target), [issues, target])
  const errors = scoped.filter(i => i.severity === 'error')
  const warnings = scoped.filter(i => i.severity === 'warning')

  const download = (id: string) => {
    const fmt = FORMATS.find(f => f.id === id)!
    const name = `${safeFilename(design.name)}.${fmt.ext}`
    if (id === 'stl') triggerDownload(writeBinaryStl(mesh, design.name), name, fmt.mime)
    if (id === '3mf') triggerDownload(writeThreeMf(mesh, design.name), name, fmt.mime)
    if (id === 'svg') triggerDownload(writeShaperSvg(design), name, fmt.mime)
    if (id === 'dxf') triggerDownload(writeDxf(design), name, fmt.mime)
  }

  return (
    <Stack spacing={1.25} sx={{ p: 1.5 }}>
      <Typography variant="h3" component="h2">Export</Typography>

      <ToggleButtonGroup
        exclusive size="small" value={target}
        aria-label="Fabrication target"
        onChange={(_e, v) => v && setTarget(v)}
      >
        <ToggleButton value="print">Bambu X2D</ToggleButton>
        <ToggleButton value="cnc">Shaper Origin</ToggleButton>
      </ToggleButtonGroup>

      <div aria-live="polite">
        {errors.map(i => (
          <Alert key={i.code} severity="error" sx={{ fontSize: 12, mb: 1 }}>{i.message}</Alert>
        ))}
        {warnings.map(i => (
          <Alert key={i.code} severity="warning" sx={{ fontSize: 12, mb: 1 }}>{i.message}</Alert>
        ))}
        {!scoped.length && (
          <Alert severity="success" sx={{ fontSize: 12 }}>
            {target === 'print'
              ? `Watertight mesh, ${mesh.triangleCount.toLocaleString()} triangles.`
              : 'All pockets are machinable with the current bit.'}
          </Alert>
        )}
      </div>

      <Stack direction="row" spacing={1}>
        {FORMATS.filter(f => f.target === target).map(f => (
          <Button
            key={f.id} variant="contained" size="small" onClick={() => download(f.id)}
            sx={{ flex: 1 }}
          >
            {f.label}
          </Button>
        ))}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Files are generated in the browser; nothing is uploaded.
      </Typography>
    </Stack>
  )
}
