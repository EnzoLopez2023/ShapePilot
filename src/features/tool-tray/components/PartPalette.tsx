import { Box, Button, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { PART_PRESETS } from '../model/partPresets.ts'
import type { PartPreset } from '../model/partPresets.ts'

export interface PartPaletteProps {
  /** Drops the preset into the tray. The page picks a free spot. */
  onAdd: (preset: PartPreset) => void
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
export function PartPalette({ onAdd, disabled }: PartPaletteProps) {
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
      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography variant="caption" color="text.secondary">
          The open-end wrench is deliberately absent: its size was estimated
          from a photograph rather than measured, and a preset that is a guess is
          worse than no preset.
        </Typography>
      </Paper>
    </Stack>
  )
}

export default PartPalette
