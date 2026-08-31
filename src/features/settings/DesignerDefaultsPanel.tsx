// How each designer opens, before anyone touches it.
//
// One section per designer rather than one shared section, because the
// settings are not the same question. A keycap tray has a build plate and a
// buffer guide; the Bambu designer has a gizmo and a solid/hole mode. Offering
// either one the other's controls would be offering a setting that does
// nothing, which is worse than not offering it.
import { Box, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import type { BambuDefaults, DesignerDefaults, KeycapTrayDefaults, ShaperDefaults } from './preferences.ts'

const FIELD_WIDTH = 200

/** The keycap tray toolbar's own snap choices, so a default cannot be a value
 *  the toolbar would not let you pick afterwards. */
const TRAY_SNAP = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 19.05]
const TRAY_GRID = [0, 2, 3, 4, 5]
const TRAY_BUFFER = [1, 1.5, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10]
const FREE_SNAP = [0, 0.5, 1, 2, 5, 10]
const FREE_GRID = [0, 1, 5, 10, 20]

const mmLabel = (value: number): string => (value === 0 ? 'Off' : `${value} mm`)

export interface DesignerDefaultsPanelProps {
  defaults: DesignerDefaults
  onChange: (next: DesignerDefaults) => void
}

export default function DesignerDefaultsPanel({ defaults, onChange }: DesignerDefaultsPanelProps) {
  const tray = (patch: Partial<KeycapTrayDefaults>) =>
    onChange({ ...defaults, keycapTray: { ...defaults.keycapTray, ...patch } })
  const shaper = (patch: Partial<ShaperDefaults>) =>
    onChange({ ...defaults, shaper: { ...defaults.shaper, ...patch } })
  const bambu = (patch: Partial<BambuDefaults>) =>
    onChange({ ...defaults, bambu: { ...defaults.bambu, ...patch } })

  const row = { display: 'flex', gap: 1.5, flexWrap: 'wrap' as const }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2" component="h2">Designer defaults</Typography>
        <Typography variant="body2" color="text.secondary">
          How a new document opens. A keycap tray you have worked on before comes back
          the way you left it instead.
        </Typography>
      </Box>

      <Divider />

      <Typography variant="h3" component="h3">Keycap tray</Typography>
      <Box sx={row}>
        <TextField
          select size="small" label="Snap" sx={{ width: FIELD_WIDTH }}
          value={defaults.keycapTray.snapMm}
          onChange={e => tray({ snapMm: parseFloat(e.target.value) })}
        >
          {TRAY_SNAP.map(v => (
            <MenuItem key={v} value={v}>{v === 19.05 ? '1u pitch' : mmLabel(v)}</MenuItem>
          ))}
        </TextField>
        <TextField
          select size="small" label="Grid" sx={{ width: FIELD_WIDTH }}
          value={defaults.keycapTray.gridMm}
          onChange={e => tray({ gridMm: parseFloat(e.target.value) })}
        >
          {TRAY_GRID.map(v => <MenuItem key={v} value={v}>{mmLabel(v)}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Buffer" sx={{ width: FIELD_WIDTH }}
          value={defaults.keycapTray.bufferMm}
          onChange={e => tray({ bufferMm: parseFloat(e.target.value) })}
        >
          {TRAY_BUFFER.map(v => (
            <MenuItem key={v} value={v}>{v === 1.8 ? '1.8 mm · min wall' : mmLabel(v)}</MenuItem>
          ))}
        </TextField>
        <TextField
          select size="small" label="Machine" sx={{ width: FIELD_WIDTH }}
          value={defaults.keycapTray.target}
          onChange={e => tray({ target: e.target.value as KeycapTrayDefaults['target'] })}
        >
          <MenuItem value="print">Bambu X2D</MenuItem>
          <MenuItem value="cnc">Shaper Origin</MenuItem>
        </TextField>
        <TextField
          select size="small" label="Opens in" sx={{ width: FIELD_WIDTH }}
          value={defaults.keycapTray.view}
          onChange={e => tray({ view: e.target.value as KeycapTrayDefaults['view'] })}
        >
          <MenuItem value="2d">Layout</MenuItem>
          <MenuItem value="3d">3D</MenuItem>
        </TextField>
      </Box>
      <Box sx={row}>
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.keycapTray.showLabels}
              onChange={e => tray({ showLabels: e.target.checked })}
            />
          )}
          label="Show labels"
        />
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.keycapTray.showBuffer}
              onChange={e => tray({ showBuffer: e.target.checked })}
            />
          )}
          label="Show buffer"
        />
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.keycapTray.showPlate}
              onChange={e => tray({ showPlate: e.target.checked })}
            />
          )}
          label="Show plate"
        />
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.keycapTray.imperial}
              onChange={e => tray({ imperial: e.target.checked })}
            />
          )}
          label="Inches"
        />
      </Box>

      <Divider />

      <Typography variant="h3" component="h3">Shaper designer</Typography>
      <Box sx={row}>
        <TextField
          select size="small" label="Snap" sx={{ width: FIELD_WIDTH }}
          value={defaults.shaper.snapMm}
          onChange={e => shaper({ snapMm: parseFloat(e.target.value) })}
        >
          {FREE_SNAP.map(v => <MenuItem key={v} value={v}>{mmLabel(v)}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Grid" sx={{ width: FIELD_WIDTH }}
          value={defaults.shaper.gridMm}
          onChange={e => shaper({ gridMm: parseFloat(e.target.value) })}
        >
          {FREE_GRID.map(v => <MenuItem key={v} value={v}>{mmLabel(v)}</MenuItem>)}
        </TextField>
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.shaper.imperial}
              onChange={e => shaper({ imperial: e.target.checked })}
            />
          )}
          label="Inches"
        />
      </Box>

      <Divider />

      <Typography variant="h3" component="h3">Bambu designer</Typography>
      <Box sx={row}>
        <TextField
          select size="small" label="Snap" sx={{ width: FIELD_WIDTH }}
          value={defaults.bambu.snapMm}
          onChange={e => bambu({ snapMm: parseFloat(e.target.value) })}
        >
          {FREE_SNAP.map(v => <MenuItem key={v} value={v}>{mmLabel(v)}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Gizmo" sx={{ width: FIELD_WIDTH }}
          value={defaults.bambu.gizmo}
          onChange={e => bambu({ gizmo: e.target.value as BambuDefaults['gizmo'] })}
        >
          <MenuItem value="translate">Move</MenuItem>
          <MenuItem value="rotate">Rotate</MenuItem>
          <MenuItem value="scale">Scale</MenuItem>
        </TextField>
        <TextField
          select size="small" label="New objects are" sx={{ width: FIELD_WIDTH }}
          value={defaults.bambu.addMode}
          onChange={e => bambu({ addMode: e.target.value as BambuDefaults['addMode'] })}
        >
          <MenuItem value="solid">Solid</MenuItem>
          <MenuItem value="hole">Hole</MenuItem>
        </TextField>
        <FormControlLabel
          control={(
            <Switch
              checked={defaults.bambu.imperial}
              onChange={e => bambu({ imperial: e.target.checked })}
            />
          )}
          label="Inches"
        />
      </Box>
    </Stack>
  )
}
