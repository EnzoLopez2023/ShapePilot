import { useCallback, useRef, useState } from 'react'
import {
  Box, Button, CircularProgress, Divider, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import { PART_PRESETS } from '../model/partPresets.ts'
import type { PartPreset } from '../model/partPresets.ts'
import { ACCEPT_ATTRIBUTE, importFile } from '../../../import/index.ts'
import type { ImportFormat } from '../../../model/document.ts'
import { traceToFootprint } from '../geometry/trace.ts'
import type { TracedFootprint } from '../geometry/trace.ts'

/** Outlines only. An STL of a part is not a pocket, and saying so beats a
 * silent failure -- the tray is a 2D region extruded down, not a subtraction. */
const TRACE_FORMATS: readonly ImportFormat[] = ['svg', 'dxf']

export interface PartPaletteProps {
  /** Drops the preset into the tray. The page picks a free spot. */
  onAdd: (preset: PartPreset) => void
  /** Drops a traced outline in, already grown by the material's clearance. */
  onTrace: (traced: TracedFootprint, name: string) => void
  /** The clearance a traced part is grown by, from the chosen filament. */
  clearanceMm: number
  disabled?: boolean
}

/**
 * The part library.
 *
 * Every entry was measured by subtracting a real toolbox insert from its own
 * outline and measuring the cavities, so these are shapes the parts
 * demonstrably sit in. The depth is shown because it is the number that decides
 * whether a pocket fits the tray height, and the note says what the pocket is
 * actually for -- a "19.4 x 60.9" tells you nothing on its own.
 */
export function PartPalette({ onAdd, onTrace, clearanceMm, disabled }: PartPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const result = await importFile(file)
      if (result.kind !== '2d') {
        setError(`${file.name} is a 3D model. Trace the part as an outline instead.`)
        return
      }
      const traced = traceToFootprint(result.regions, clearanceMm)
      if (!traced) {
        setError(`Nothing closed to cut in ${file.name}.`)
        return
      }
      onTrace(traced, file.name.replace(/\.[^.]+$/, ''))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.')
    } finally {
      setBusy(false)
    }
  }, [clearanceMm, onTrace])

  return (
    <Stack spacing={1}>
      <Typography variant="h3" component="h2">Parts</Typography>
      <Typography variant="body2" color="text.secondary">
        Measured from real inserts. Dropping one in copies its pockets, so the
        tray keeps printing the same if the library later changes.
      </Typography>
      {PART_PRESETS.map(preset => (
        <Tooltip key={preset.id} title={preset.note} placement="right">
          <span>
            <Button
              fullWidth
              variant="outlined"
              disabled={disabled}
              onClick={() => onAdd(preset)}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', px: 1.25, py: 0.75 }}
            >
              <Box sx={{ textAlign: 'left', width: '100%' }}>
                <Typography variant="body2" component="div">{preset.label}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {preset.widthMm} × {preset.heightMm} mm ·{' '}
                  {Math.max(...preset.steps.map(s => s.depthMm ?? 0))} deep
                  {preset.steps.length > 1 ? ` · ${preset.steps.length} tiers` : ''}
                </Typography>
              </Box>
            </Button>
          </span>
        </Tooltip>
      ))}
      <Divider />
      <Typography variant="h3" component="h2">Trace a part</Typography>
      <Typography variant="body2" color="text.secondary">
        An SVG or DXF of the part becomes a pocket of its own shape, grown by
        {' '}{clearanceMm} mm so the part drops in rather than jamming.
      </Typography>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={ACCEPT_ATTRIBUTE(TRACE_FORMATS)}
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleFile(file)
        }}
      />
      <Button
        fullWidth
        variant="outlined"
        disabled={disabled || busy}
        startIcon={busy ? <CircularProgress size={16} /> : <FileUploadRoundedIcon />}
        onClick={() => inputRef.current?.click()}
        sx={{ textTransform: 'none' }}
      >
        {busy ? 'Tracing…' : 'Trace an outline'}
      </Button>
      {error && (
        <Typography variant="caption" color="error">{error}</Typography>
      )}
      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography variant="caption" color="text.secondary">
          The open-end wrench is the one entry measured with calipers rather
          than taken from an insert. It was estimated off a photograph once, at
          92 × 30 — it is 70.4 × 22.1. A photograph has no scale in it, so a
          number read from one is a guess wearing a measurement's clothes.
        </Typography>
      </Paper>
    </Stack>
  )
}

export default PartPalette
