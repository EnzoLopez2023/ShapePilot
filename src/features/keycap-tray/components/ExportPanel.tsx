import { useMemo } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import type { Issue, Target } from '../geometry/validate.ts'
import { issuesFor } from '../geometry/validate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { FabricationSettings, TrayDesign } from '../model/types.ts'
import { tileTray } from '../geometry/tiling.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import { writeThreeMf } from '../../../export/threemf.ts'
import { writeShaperSvg } from '../export/svg.ts'
import { writeDxf } from '../export/dxf.ts'
import { safeFilename, triggerDownload } from '../../../export/download.ts'

export interface ExportPanelProps {
  design: TrayDesign
  mesh: Mesh
  issues: Issue[]
  fab: FabricationSettings
  /** Lifted so the toolbar can hide printer-only controls for the CNC target. */
  target: Target
  onTarget: (target: Target) => void
}

const FORMATS: { id: string; label: string; target: Target; ext: string; mime: string }[] = [
  { id: 'stl', label: 'STL', target: 'print', ext: 'stl', mime: 'model/stl' },
  { id: '3mf', label: '3MF', target: 'print', ext: '3mf', mime: 'model/3mf' },
  { id: 'svg', label: 'SVG', target: 'cnc', ext: 'svg', mime: 'image/svg+xml' },
  { id: 'dxf', label: 'DXF', target: 'cnc', ext: 'dxf', mime: 'image/vnd.dxf' },
]

// Lives in the header toolbar rather than a full side panel, so status is a
// single icon with the detail in its tooltip instead of a stack of Alerts.
export default function ExportPanel({ design, mesh, issues, fab, target, onTarget }: ExportPanelProps) {
  const scoped = useMemo(() => issuesFor(issues, target), [issues, target])
  const errors = scoped.filter(i => i.severity === 'error')
  const warnings = scoped.filter(i => i.severity === 'warning')

  const tiles = useMemo(
    () => (target === 'print'
      ? tileTray(design, { plateWidthMm: fab.plateWidthMm, plateDepthMm: fab.plateDepthMm })
      : []),
    [design, fab.plateWidthMm, fab.plateDepthMm, target])

  const downloadTiles = () => {
    const files: Record<string, Uint8Array> = {}
    for (const t of tiles) {
      files[`${safeFilename(design.name)}_${t.label}.stl`] =
        new Uint8Array(writeBinaryStl(t.mesh, `${design.name} ${t.label}`))
    }
    files['README.txt'] = strToU8(
      `${design.name}\n${tiles.length} pieces, ${tiles[0]?.widthMm.toFixed(0)} x ` +
      `${tiles[0]?.depthMm.toFixed(0)} mm or smaller. Interior edges interlock with finger ` +
      `joints -- press together and glue. Labels are row then column from the front-left.\n`)
    triggerDownload(
      zipSync(files, { level: 6 }), `${safeFilename(design.name)}_pieces.zip`, 'application/zip')
  }

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

      <Stack direction="row" spacing={0.5}>
        {FORMATS.filter(f => f.target === target).map(f => (
          <Button key={f.id} variant="contained" size="small" onClick={() => download(f.id)}>
            {f.label}
          </Button>
        ))}
        {tiles.length > 1 && (
          <Tooltip title={`Too big for the plate. Download ${tiles.length} interlocking pieces as a zip of STLs.`}>
            <Button variant="outlined" size="small" onClick={downloadTiles}>
              Split ×{tiles.length}
            </Button>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  )
}
