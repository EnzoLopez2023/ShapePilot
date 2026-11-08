// What goes on the baseplate: pick a saved bin, click a free cell to put it
// there, click a stack to see it, add to it or take from it. Heights are
// checked against the container's clear height as you go.
import {
  Alert, Button, Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import type { GridfinityBaseplateParams, GridfinityPlacement } from '../../../../lib/contracts/gridfinity.ts'
import { mmToInches } from '../../../units.ts'
import { describe } from '../model/types.ts'
import { heightLimit, type LayoutBin, type ResolvedStack } from '../model/layout.ts'

export interface LayoutPanelProps {
  plate: GridfinityBaseplateParams
  bins: readonly LayoutBin[]
  stacks: readonly ResolvedStack[]
  selected: number | null
  placingId: string | null
  rotated: boolean
  busy: boolean
  onPlacing: (id: string | null) => void
  onRotated: (rotated: boolean) => void
  onSelect: (index: number | null) => void
  onLayout: (layout: GridfinityPlacement[]) => void
  onHeightLimit: (mm: number | undefined) => void
  onExport: () => void
}

const NONE = ''
const both = (mm: number) => `${mm.toFixed(1)} mm · ${mmToInches(mm).toFixed(2)}"`

export default function LayoutPanel(props: LayoutPanelProps) {
  const {
    plate, bins, stacks, selected, placingId, rotated, busy,
    onPlacing, onRotated, onSelect, onLayout, onHeightLimit, onExport,
  } = props
  const layout = plate.layout ?? []
  const limit = heightLimit(plate)
  const isDrawer = (plate.container ?? 'drawer') === 'drawer'
  const current = selected !== null ? stacks.find(s => s.index === selected) : undefined
  const binCount = layout.reduce((n, item) => n + item.stack.length, 0)
  const flagged = stacks.filter(s => s.problems.length > 0).length
  const tallest = stacks.reduce((mm, s) => Math.max(mm, s.heightMm), 0)

  const edit = (index: number, change: (item: GridfinityPlacement) => GridfinityPlacement | null) => {
    const next: GridfinityPlacement[] = []
    layout.forEach((item, i) => {
      if (i !== index) { next.push(item); return }
      const changed = change(item)
      if (changed && changed.stack.length) next.push(changed)
    })
    onLayout(next)
    if (next.length < layout.length) onSelect(null)
  }

  const binOption = (bin: LayoutBin) => (
    <MenuItem key={bin.id} value={bin.id}>
      <Stack>
        <Typography variant="body2">{bin.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {describe('bin', bin.params as unknown as Record<string, unknown>)}
        </Typography>
      </Stack>
    </MenuItem>
  )

  return (
    <Stack spacing={1.5}>
      <Typography variant="h3" component="h2">What goes in it</Typography>
      {bins.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Save a storage bin design first. Saved bins can be placed on this plate and stacked.
        </Typography>
      ) : (
        <>
          <TextField
            select size="small" label="Place a bin" value={placingId ?? NONE}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            onChange={e => onPlacing(e.target.value || null)}
            helperText={placingId ? 'Click a free cell on the plan: it becomes the bin’s front-left corner.' : 'Click a stack on the plan to see it.'}
          >
            <MenuItem value={NONE}>None — select stacks</MenuItem>
            {bins.map(binOption)}
          </TextField>
          <FormControlLabel
            control={<Switch size="small" checked={rotated} onChange={e => onRotated(e.target.checked)} />}
            label="Turned a quarter (width and depth swap)"
          />
        </>
      )}

      {isDrawer ? (
        <TextField
          size="small" type="number" label="Clear height in the drawer (mm)"
          value={plate.heightLimitMm ?? ''}
          onChange={e => onHeightLimit(e.target.value ? Math.max(1, Number(e.target.value)) : undefined)}
          helperText={plate.heightLimitMm ? `${mmToInches(plate.heightLimitMm).toFixed(2)}" — stacks taller than this are flagged.` : 'Leave empty to skip the height check.'}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Stacks are checked against the S76 base’s {limit} mm clear height — Systainer’s figure, not yet measured.
        </Typography>
      )}

      {current && (
        <>
          <Divider />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h3" component="h3">
              Stack at cell {current.col + 1}, {current.row + 1}
            </Typography>
            <Tooltip title="Remove the whole stack">
              <IconButton size="small" aria-label="Remove stack" onClick={() => edit(current.index, () => null)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="body2">
            {current.cellsX} × {current.cellsY} cells, {both(current.heightMm)} tall
            {limit !== null ? ` of ${limit} mm` : ''}.
          </Typography>
          <Stack divider={<Divider />}>
            {[...current.bins].reverse().map((bin, k) => {
              const level = current.bins.length - 1 - k
              return (
                <Stack key={`${bin.id}-${level}`} direction="row" sx={{ alignItems: 'center', py: 0.5 }}>
                  <Stack sx={{ flex: 1 }}>
                    <Typography variant="body2">{bin.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {level === 0 ? 'Bottom' : `Level ${level + 1}`} · {describe('bin', bin.params as unknown as Record<string, unknown>)}
                    </Typography>
                  </Stack>
                  <Tooltip title="Take this bin out">
                    <IconButton
                      size="small" aria-label={`Remove ${bin.name}`}
                      onClick={() => edit(current.index, item => ({ ...item, stack: item.stack.filter((_, i) => i !== level) }))}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              )
            })}
          </Stack>
          {current.problems.map(problem => (
            <Alert key={problem} severity="warning" variant="outlined">{problem}</Alert>
          ))}
          <TextField
            select size="small" label="Stack another on top" value={NONE}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            onChange={e => {
              const id = e.target.value
              if (id) edit(current.index, item => ({ ...item, stack: [...item.stack, id] }))
            }}
          >
            <MenuItem value={NONE} disabled>Pick a bin…</MenuItem>
            {bins.map(binOption)}
          </TextField>
          <FormControlLabel
            control={(
              <Switch
                size="small" checked={!!layout[current.index]?.rotated}
                onChange={e => edit(current.index, item => ({ ...item, rotated: e.target.checked }))}
              />
            )}
            label="Turned a quarter"
          />
        </>
      )}

      <Divider />
      <Typography variant="body2">
        {layout.length === 0
          ? 'Nothing placed yet.'
          : `${layout.length} ${layout.length === 1 ? 'stack' : 'stacks'}, ${binCount} ${binCount === 1 ? 'bin' : 'bins'}. Tallest ${both(tallest)}.`}
      </Typography>
      {flagged > 0 && (
        <Alert severity="warning" variant="outlined">
          {flagged} {flagged === 1 ? 'stack needs' : 'stacks need'} a look — shown in red on the plan.
        </Alert>
      )}
      <Button variant="outlined" disabled={!layout.length || busy} onClick={onExport}>
        Export every bin (STL zip)
      </Button>
      {layout.length > 0 && (
        <Button color="inherit" size="small" onClick={() => { onLayout([]); onSelect(null) }}>
          Clear the layout
        </Button>
      )}
    </Stack>
  )
}
