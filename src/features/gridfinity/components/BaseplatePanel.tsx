import {
  Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup,
  Typography,
} from '@mui/material'
import LengthField from '../../../components/LengthField.tsx'
import {
  BASEPLATE_LIMITS, type GridfinityAlign, type GridfinityBaseplateParams,
} from '../../../../lib/contracts/gridfinity.ts'

export interface BaseplatePanelProps {
  name: string
  plate: GridfinityBaseplateParams
  imperial: boolean
  onImperial: (v: boolean) => void
  onName: (name: string) => void
  onPlate: (patch: Partial<GridfinityBaseplateParams>) => void
}

const BEDS: { label: string; mm: number }[] = [
  { label: 'Bambu X2D / X1 / P1 — 256 mm', mm: 256 },
  { label: 'Bambu A1 mini — 180 mm', mm: 180 },
  { label: 'Prusa MK4 — 210 mm', mm: 210 },
  { label: 'Large format — 350 mm', mm: 350 },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function AlignField(
  { label, value, names, onChange }: {
    label: string
    value: GridfinityAlign
    names: [string, string, string]
    onChange: (v: GridfinityAlign) => void
  },
) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <ToggleButtonGroup
        exclusive fullWidth size="small" value={value} aria-label={label}
        onChange={(_e, v: GridfinityAlign | null) => v && onChange(v)}
      >
        <ToggleButton value="start">{names[0]}</ToggleButton>
        <ToggleButton value="center">{names[1]}</ToggleButton>
        <ToggleButton value="end">{names[2]}</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  )
}

export default function BaseplatePanel(
  { name, plate, imperial, onImperial, onName, onPlate }: BaseplatePanelProps,
) {
  const drawer = (mm: number) => clamp(mm, BASEPLATE_LIMITS.minDrawerMm, BASEPLATE_LIMITS.maxDrawerMm)
  const bedPreset = BEDS.find(b => b.mm === plate.bedMm)
  return (
    <Stack spacing={2} sx={{ p: 2, overflowY: { lg: 'auto' }, height: { lg: '100%' } }}>
      <TextField label="Name" size="small" value={name} onChange={e => onName(e.target.value)} />

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h3" component="h2">Drawer</Typography>
        <FormControlLabel
          control={<Switch size="small" checked={imperial} onChange={e => onImperial(e.target.checked)} />}
          label="Inches"
        />
      </Stack>
      <LengthField
        label="Inside width" imperial={imperial} valueMm={plate.drawerWidthMm}
        onChangeMm={mm => onPlate({ drawerWidthMm: drawer(mm) })}
        hint="Side to side, measured at the bottom of the drawer"
      />
      <LengthField
        label="Inside depth" imperial={imperial} valueMm={plate.drawerDepthMm}
        onChangeMm={mm => onPlate({ drawerDepthMm: drawer(mm) })}
        hint="Front to back"
      />
      <LengthField
        label="Clearance" imperial={imperial} valueMm={plate.clearanceMm}
        onChangeMm={mm => onPlate({ clearanceMm: clamp(mm, 0, BASEPLATE_LIMITS.maxClearanceMm) })}
        hint="Total play left each way so the plate drops in"
      />

      <Divider />
      <Typography variant="h3" component="h2">Grid placement</Typography>
      <Typography variant="body2" color="text.secondary">
        Leftover space becomes solid plate. Choose which edge it goes to.
      </Typography>
      <AlignField
        label="Left to right" value={plate.alignX} names={['Left', 'Centre', 'Right']}
        onChange={alignX => onPlate({ alignX })}
      />
      <AlignField
        label="Front to back" value={plate.alignY} names={['Front', 'Centre', 'Back']}
        onChange={alignY => onPlate({ alignY })}
      />

      <Divider />
      <Typography variant="h3" component="h2">Printer</Typography>
      <TextField
        select size="small" label="Largest tile" value={bedPreset ? bedPreset.mm : 'custom'}
        onChange={e => { if (e.target.value !== 'custom') onPlate({ bedMm: Number(e.target.value) }) }}
      >
        {BEDS.map(b => <MenuItem key={b.mm} value={b.mm}>{b.label}</MenuItem>)}
        {!bedPreset && <MenuItem value="custom">Custom</MenuItem>}
      </TextField>
      <LengthField
        label="Tile limit" imperial={imperial} valueMm={plate.bedMm}
        onChangeMm={mm => onPlate({ bedMm: clamp(mm, BASEPLATE_LIMITS.minBedMm, BASEPLATE_LIMITS.maxBedMm) })}
        hint="Tiles are cut on cell lines so none is larger than this"
      />
    </Stack>
  )
}
