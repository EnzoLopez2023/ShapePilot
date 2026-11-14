// The choices that matter most for a run of labelled bins, inside the
// "A bin per label" dialog so they can be set without leaving it. They edit the
// bin being designed -- the batch is that bin with each label in turn -- so the
// panel on the left always agrees with what gets exported.
import {
  Checkbox, FormControlLabel, FormGroup, FormLabel, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { BIN_LIMITS, HEIGHT_UNIT_MM, type GridfinityBinParams } from '../../../../lib/contracts/gridfinity.ts'
import { binDimensions } from '../geometry/bin.ts'
import { LID_TOP_MM } from '../geometry/lid.ts'
import type { BinColors } from '../state/viewSettings.ts'
import OwnedColorSelect from '../../filaments/components/OwnedColorSelect.tsx'
import type { OwnedColor } from '../../filaments/useOwnedColors.ts'

/**
 * Which parts of the run to print. Kept apart from the bin: bins already on
 * the shelf may need only their lids, or new labels.
 */
export interface BatchPrint {
  bins: boolean
  labels: boolean
  lids: boolean
}

export interface BatchBinOptionsProps {
  bin: GridfinityBinParams
  onBin: (patch: Partial<GridfinityBinParams>) => void
  print: BatchPrint
  onPrint: (print: BatchPrint) => void
  ownedColors: readonly OwnedColor[]
  colors: BinColors
  onColors: (colors: BinColors) => void
  amsNote: (key: string) => string | null
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

export default function BatchBinOptions(
  { bin, onBin, print, onPrint, ownedColors, colors, onColors, amsNote }: BatchBinOptionsProps,
) {
  const lid = !!bin.lid && bin.stackingLip
  const glued = !!bin.labelGlued
  const choices = [
    { key: 'bins' as const, label: glued ? 'Bins (blank)' : 'Bins', shown: true },
    { key: 'labels' as const, label: 'Glue-on labels', shown: glued },
    { key: 'lids' as const, label: 'Lids', shown: lid },
  ].filter(c => c.shown)
  const nothing = !choices.some(c => print[c.key])
  const { heightMm } = binDimensions(bin)
  const colorField = (part: keyof BinColors, label: string) => (
    <OwnedColorSelect
      label={label} colors={ownedColors} value={colors[part] ?? null}
      onChange={choice => onColors({ ...colors, [part]: choice?.key })}
      note={color => amsNote(color.key)}
    />
  )
  return (
    <Stack spacing={1.5}>
      <TextField
        select size="small" label="Height" value={bin.heightUnits}
        onChange={e => onBin({ heightUnits: Number(e.target.value) })}
        helperText={`${+(heightMm + (lid ? LID_TOP_MM : 0)).toFixed(1)} mm overall${lid ? ' with its lid' : bin.stackingLip ? ', stacking lip included' : ''}`}
      >
        {range(BIN_LIMITS.minHeightUnits, BIN_LIMITS.maxHeightUnits).map(n => (
          <MenuItem key={n} value={n}>{n}u · {n * HEIGHT_UNIT_MM} mm to the wall top</MenuItem>
        ))}
      </TextField>
      <Stack>
        <FormControlLabel
          control={(
            <Switch
              checked={lid}
              // A lid sits in the stacking lip, so asking for one brings the lip with it.
              onChange={e => onBin(e.target.checked ? { lid: true, stackingLip: true } : { lid: false })}
            />
          )}
          label="A lid for every bin"
        />
        {lid && (
          <FormControlLabel
            sx={{ pl: 4 }}
            control={<Switch size="small" checked={!!bin.lidLabel} onChange={e => onBin({ lidLabel: e.target.checked })} />}
            label="The whole label on each lid, as large as it fits"
          />
        )}
        <FormControlLabel
          control={<Switch checked={glued} onChange={e => onBin({ labelGlued: e.target.checked })} />}
          label="Blank bins, with labels printed separately to glue on"
        />
        <FormControlLabel
          control={(
            <Switch
              checked={bin.labelSizeOnly !== false}
              onChange={e => onBin({ labelSizeOnly: e.target.checked })}
            />
          )}
          label={`${glued ? 'Labels' : 'Tabs'} show only the size (M5x12, M5), as large as they fit`}
        />
        <FormControlLabel
          control={(
            <Switch
              checked={!!bin.labelSeparate}
              onChange={e => onBin({ labelSeparate: e.target.checked })}
            />
          )}
          label="Label text in a second colour"
        />
      </Stack>
      <Stack>
        <FormLabel sx={{ typography: 'body2' }}>Print</FormLabel>
        <FormGroup row>
          {choices.map(c => (
            <FormControlLabel
              key={c.key} label={c.label}
              control={<Checkbox size="small" checked={print[c.key]} onChange={e => onPrint({ ...print, [c.key]: e.target.checked })} />}
            />
          ))}
        </FormGroup>
        {nothing && <Typography variant="body2" color="error">Pick at least one to print.</Typography>}
      </Stack>
      {ownedColors.length > 0 ? (
        <Stack spacing={1.5}>
          {colorField('bin', 'Bin')}
          {bin.labelSeparate && colorField('label', 'Label text')}
        </Stack>
      ) : bin.labelSeparate && (
        <Typography variant="body2" color="text.secondary">
          The text goes on its own filament slot; add filaments you own to pick its colour here.
        </Typography>
      )}
    </Stack>
  )
}
