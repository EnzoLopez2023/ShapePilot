import {
  Autocomplete, Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch,
  TextField, Tooltip, Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  BIN_LIMITS, GRID_PITCH_MM, HEIGHT_UNIT_MM, type GridfinityBinParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { mmToInches } from '../../../units.ts'
import { BIN_CLEARANCE_MM, LIP_HEIGHT_MM, binDimensions } from '../geometry/bin.ts'
import type { LabelList } from '../model/types.ts'
import type { BinColors } from '../state/viewSettings.ts'
import OwnedColorSelect from '../../filaments/components/OwnedColorSelect.tsx'
import type { OwnedColor } from '../../filaments/useOwnedColors.ts'

export interface BinPanelProps {
  name: string
  bin: GridfinityBinParams
  lists: LabelList[]
  onName: (name: string) => void
  onBin: (patch: Partial<GridfinityBinParams>) => void
  /** Filament you own, to paint the bin and label in. Empty hides the pickers. */
  ownedColors: readonly OwnedColor[]
  colors: BinColors
  onColors: (colors: BinColors) => void
  /** Where an owned colour sits in the AMS, e.g. "in AMS 1 · tray 2". */
  amsNote: (key: string) => string | null
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const NO_LIST = ''

export default function BinPanel(
  { name, bin, lists, onName, onBin, ownedColors, colors, onColors, amsNote }: BinPanelProps,
) {
  const colorField = (part: keyof BinColors, label: string) => (
    <OwnedColorSelect
      label={label} colors={ownedColors} value={colors[part] ?? null}
      onChange={choice => onColors({ ...colors, [part]: choice?.key })}
      note={color => amsNote(color.key)}
    />
  )
  const hasText = bin.labelTab && bin.labelText.trim() !== ''
  const dims = binDimensions(bin)
  // Both units everywhere, so a target like 6" x 4" can be matched by eye.
  const both = (mm: number) => `${+mm.toFixed(1)} mm · ${mmToInches(mm).toFixed(2)}"`
  const cellsLabel = (n: number) => `${n} ${n === 1 ? 'cell' : 'cells'} · ${both(n * GRID_PITCH_MM - BIN_CLEARANCE_MM)}`
  const list = lists.find(l => l.id === bin.labelListId)
  const items = list?.items ?? []
  const index = items.indexOf(bin.labelText)

  const step = (by: number) => {
    if (!items.length) return
    const next = index < 0 ? (by > 0 ? 0 : items.length - 1) : (index + by + items.length) % items.length
    onBin({ labelText: items[next] })
  }

  return (
    <Stack spacing={2} sx={{ p: 2, overflowY: { lg: 'auto' }, height: { lg: '100%' } }}>
      <TextField
        label="Name" size="small" value={name}
        onChange={e => onName(e.target.value)}
      />

      <Typography variant="h3" component="h2">Size</Typography>
      <Stack spacing={2}>
        <TextField
          select fullWidth size="small" label="Width" value={bin.gridX}
          slotProps={{ select: { renderValue: v => cellsLabel(Number(v)) } }}
          onChange={e => onBin({ gridX: Number(e.target.value) })}
        >
          {range(BIN_LIMITS.minGrid, BIN_LIMITS.maxGrid).map(n => (
            <MenuItem key={n} value={n}>{cellsLabel(n)}</MenuItem>
          ))}
        </TextField>
        <TextField
          select fullWidth size="small" label="Depth" value={bin.gridY}
          slotProps={{ select: { renderValue: v => cellsLabel(Number(v)) } }}
          onChange={e => onBin({ gridY: Number(e.target.value) })}
        >
          {range(BIN_LIMITS.minGrid, BIN_LIMITS.maxGrid).map(n => (
            <MenuItem key={n} value={n}>{cellsLabel(n)}</MenuItem>
          ))}
        </TextField>
      </Stack>
      <TextField
        select size="small" label="Height" value={bin.heightUnits}
        slotProps={{ select: { renderValue: v => `${v}u · ${both(Number(v) * HEIGHT_UNIT_MM)} to the wall top` } }}
        onChange={e => onBin({ heightUnits: Number(e.target.value) })}
        helperText={`${both(dims.heightMm)} overall${bin.stackingLip ? `, including the ${LIP_HEIGHT_MM} mm stacking lip` : ''}`}
      >
        {range(BIN_LIMITS.minHeightUnits, BIN_LIMITS.maxHeightUnits).map(n => (
          <MenuItem key={n} value={n}>{n}u · {both(n * HEIGHT_UNIT_MM)} to the wall top</MenuItem>
        ))}
      </TextField>
      <Typography variant="body2" color="text.secondary">
        Finished bin: {both(dims.widthMm)} wide × {both(dims.depthMm)} deep × {both(dims.heightMm)} tall.
        {' '}One cell is {GRID_PITCH_MM} mm ({mmToInches(GRID_PITCH_MM).toFixed(2)}"); one height unit is {HEIGHT_UNIT_MM} mm.
      </Typography>

      <Divider />
      <Typography variant="h3" component="h2">Features</Typography>
      <Stack>
        <FormControlLabel
          control={<Switch checked={bin.stackingLip} onChange={e => onBin({ stackingLip: e.target.checked })} />}
          label="Stacking lip"
        />
        <FormControlLabel
          control={<Switch checked={bin.scoop} onChange={e => onBin({ scoop: e.target.checked })} />}
          label="Finger scoop at the front"
        />
        <FormControlLabel
          control={<Switch checked={bin.magnets} onChange={e => onBin({ magnets: e.target.checked })} />}
          label="Magnet holes (6 × 2 mm)"
        />
        <FormControlLabel
          control={<Switch checked={bin.labelTab} onChange={e => onBin({ labelTab: e.target.checked })} />}
          label="Label tab at the back"
        />
      </Stack>

      <Divider />
      <Typography variant="h3" component="h2">Label</Typography>
      <TextField
        select size="small" label="Pick from" value={list ? list.id : NO_LIST}
        disabled={!bin.labelTab}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        onChange={e => {
          const id = e.target.value
          if (!id) { onBin({ labelListId: undefined }); return }
          const picked = lists.find(l => l.id === id)
          onBin({ labelListId: id, labelText: picked?.items[0] ?? bin.labelText })
        }}
      >
        <MenuItem value={NO_LIST}>No list — type the text</MenuItem>
        {lists.map(l => (
          <MenuItem key={l.id} value={l.id}>{l.name} ({l.items.length})</MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Autocomplete
          freeSolo fullWidth size="small" disabled={!bin.labelTab}
          options={items}
          inputValue={bin.labelText}
          onInputChange={(_e, value) => onBin({ labelText: value.slice(0, BIN_LIMITS.labelMaxLength) })}
          renderInput={params => (
            <TextField {...params} label="Text" placeholder="None — a plain tab" />
          )}
        />
        {items.length > 0 && (
          <>
            <Tooltip title="Previous item">
              <span>
                <IconButton size="small" aria-label="Previous label" disabled={!bin.labelTab} onClick={() => step(-1)}>
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Next item">
              <span>
                <IconButton size="small" aria-label="Next label" disabled={!bin.labelTab} onClick={() => step(1)}>
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Stack>
      {items.length > 0 && index >= 0 && (
        <Typography variant="body2" color="text.secondary">
          Item {index + 1} of {items.length} in {list?.name}
        </Typography>
      )}
      <TextField
        select size="small" label="Text height" value={bin.textSizeMm}
        disabled={!bin.labelTab}
        onChange={e => onBin({ textSizeMm: Number(e.target.value) })}
        helperText="Raised 0.6 mm. Long labels shrink to fit the tab."
      >
        {range(BIN_LIMITS.minTextMm, BIN_LIMITS.maxTextMm).map(n => (
          <MenuItem key={n} value={n}>{n} mm</MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        disabled={!bin.labelTab}
        control={(
          <Switch
            size="small" checked={!!bin.labelSeparate}
            onChange={e => onBin({ labelSeparate: e.target.checked })}
          />
        )}
        label="Print the text in a second colour"
      />
      {bin.labelSeparate && bin.labelTab && (
        <Typography variant="body2" color="text.secondary">
          {hasText
            ? 'The text exports as its own body on the tab: one 3MF with two parts, or a zip of two STLs that line up.'
            : 'Pick some text to get a second body.'}
        </Typography>
      )}

      {ownedColors.length > 0 && (
        <>
          <Divider />
          <Tooltip title="Paints each printed body in a filament you own. A colour loaded in the AMS also sets which tray that body prints from in the 3MF.">
            <Typography variant="h3" component="h2">Filament colours</Typography>
          </Tooltip>
          {colorField('bin', 'Bin')}
          {bin.labelSeparate && hasText && colorField('label', 'Label text')}
        </>
      )}
    </Stack>
  )
}
