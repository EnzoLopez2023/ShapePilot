// Filling a tray from a list, rather than a click per part.
//
// The counts are the point. Somebody with five hotends and three tubes should
// say that once, not drop eight times and then tidy up -- and because packing
// places the biggest parts first, the result is a better layout than those
// eight drops would have produced in whatever order they happened.
import { useState } from 'react'
import {
  Button, IconButton, Paper, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import AutoAwesomeMosaicRoundedIcon from '@mui/icons-material/AutoAwesomeMosaicRounded'
import { PART_PRESETS } from '../model/partPresets.ts'
import type { PackRequest, PackResult } from '../geometry/pack.ts'

export interface PackPanelProps {
  onPack: (requests: readonly PackRequest[]) => PackResult['unplaced']
  disabled?: boolean
}

export function PackPanel({ onPack, disabled }: PackPanelProps) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [unplaced, setUnplaced] = useState<PackResult['unplaced'] | null>(null)

  const bump = (id: string, by: number) => {
    setUnplaced(null)
    setCounts(prev => {
      const next = Math.max(0, (prev[id] ?? 0) + by)
      return { ...prev, [id]: next }
    })
  }

  const requests: PackRequest[] = PART_PRESETS
    .filter(preset => (counts[preset.id] ?? 0) > 0)
    .map(preset => ({ preset, count: counts[preset.id]! }))
  const total = requests.reduce((sum, r) => sum + r.count, 0)

  return (
    <Stack spacing={1}>
      <Typography variant="h3" component="h2">Fill from a list</Typography>
      <Typography variant="body2" color="text.secondary">
        Say how many of each and they go in together, biggest first, turned a
        quarter turn where that is the only way one fits. Pockets already in the
        tray stay where they are.
      </Typography>

      {PART_PRESETS.map(preset => {
        const count = counts[preset.id] ?? 0
        return (
          <Stack key={preset.id} direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="body2" sx={{ flex: 1 }}>{preset.label}</Typography>
            <IconButton
              size="small"
              aria-label={`One fewer ${preset.label}`}
              disabled={disabled || count === 0}
              onClick={() => bump(preset.id, -1)}
            >
              <RemoveIcon fontSize="inherit" />
            </IconButton>
            <TextField
              size="small"
              value={count}
              slotProps={{ htmlInput: { 'aria-label': `${preset.label} count`, style: { textAlign: 'center', width: 32 } } }}
              onChange={e => {
                const parsed = Number.parseInt(e.target.value, 10)
                setUnplaced(null)
                setCounts(prev => ({
                  ...prev, [preset.id]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                }))
              }}
            />
            <IconButton
              size="small"
              aria-label={`One more ${preset.label}`}
              disabled={disabled}
              onClick={() => bump(preset.id, 1)}
            >
              <AddIcon fontSize="inherit" />
            </IconButton>
          </Stack>
        )
      })}

      <Button
        variant="contained"
        disabled={disabled || total === 0}
        startIcon={<AutoAwesomeMosaicRoundedIcon />}
        onClick={() => setUnplaced(onPack(requests))}
        sx={{ textTransform: 'none' }}
      >
        {total === 0 ? 'Fill the tray' : `Fill the tray with ${total}`}
      </Button>

      {unplaced && (
        <Paper variant="outlined" sx={{ p: 1 }}>
          <Typography variant="caption" color={unplaced.length ? 'warning.main' : 'text.secondary'}>
            {unplaced.length === 0
              ? 'Everything asked for went in.'
              : `No room left for ${unplaced.map(u => `${u.count} × ${u.label}`).join(', ')}. `
                + 'They need a second tray, or a shallower one to stack under this.'}
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}

export default PackPanel
