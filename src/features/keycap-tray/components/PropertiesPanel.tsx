import {
  Button, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import type { PocketSizing } from '../geometry/shapes.ts'
import { LIBRARY_SIZING, PYTHON_SIZING, PROFILE_PRESETS, profileToMulti } from '../model/presets.ts'
import { multiBBox } from '../geometry/vec.ts'
import { pocketAABB } from '../state/useTrayDesign.ts'
import type { FabricationSettings, Pocket, TrayDesign, TrayProfile } from '../model/types.ts'
import LengthField from './LengthField.tsx'
import AngleField from './AngleField.tsx'
import HoverTooltip from './HoverTooltip.tsx'

export interface PropertiesPanelProps {
  design: TrayDesign
  selected: Pocket[]
  fab: FabricationSettings
  imperial: boolean
  onImperial: (v: boolean) => void
  onProfile: (p: TrayProfile) => void
  onSizing: (s: PocketSizing) => void
  onDesign: (mutate: (d: TrayDesign) => TrayDesign) => void
  onPocket: (id: string, patch: Partial<Pocket>) => void
  onFab: (f: FabricationSettings) => void
}

export default function PropertiesPanel(props: PropertiesPanelProps) {
  const {
    design, selected, fab, imperial, onImperial, onProfile, onSizing, onDesign, onPocket, onFab,
  } = props

  const heading = (t: string) => (
    <Typography variant="h3" component="h2">{t}</Typography>
  )

  const trayCenter = (() => {
    const b = multiBBox(profileToMulti(design.profile))
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }
  })()
  // Nudge each pocket so its true (rotated) bounding box centres on the tray.
  // `p.x`/`p.y` are the un-rotated footprint origin, so move by the delta.
  const centerSelected = (axis: 'x' | 'y') => {
    for (const p of selected) {
      const b = pocketAABB(p, design.sizing)
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
      onPocket(p.id, axis === 'x'
        ? { x: p.x + (trayCenter.cx - cx) }
        : { y: p.y + (trayCenter.cy - cy) })
    }
  }
  // Mirror / flip the pocket's own geometry in place -- bbox and position
  // unchanged. Only asymmetric shapes (ISO Enter, future customs) change.
  const mirrorSelected = () => {
    for (const p of selected) onPocket(p.id, { mirrorX: !p.mirrorX })
  }
  const flipSelected = () => {
    for (const p of selected) onPocket(p.id, { flipY: !p.flipY })
  }

  const sizingPreset =
    design.sizing.cornerRadius === LIBRARY_SIZING.cornerRadius &&
    design.sizing.widthOffset === LIBRARY_SIZING.widthOffset ? 'library'
    : design.sizing.cornerRadius === PYTHON_SIZING.cornerRadius &&
      design.sizing.widthOffset === PYTHON_SIZING.widthOffset ? 'python' : 'custom'

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0, overflowY: 'auto', p: 1.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {heading('Tray')}
        <Tooltip title="Show every length in millimetres or in fractional inches (nearest 1/32&quot;). Values are still stored in mm either way.">
          <ToggleButtonGroup
            exclusive size="small" value={imperial ? 'in' : 'mm'}
            aria-label="Display units"
            onChange={(_e, v) => v && onImperial(v === 'in')}
          >
            <ToggleButton value="mm">mm</ToggleButton>
            <ToggleButton value="in">in</ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>
      </Stack>
      <Tooltip title="Shown on the toolbar, the saved-designs list, and exported file names.">
        <TextField
          size="small" label="Name" value={design.name}
          onChange={e => onDesign(d => ({ ...d, name: e.target.value }))}
        />
      </Tooltip>
      <HoverTooltip title="The tray outline pockets sit inside. Presets match a physical Systainer insert; Custom rectangle lets you set any width and depth.">
        <TextField
          select size="small" label="Profile"
          value={design.profile.kind === 'preset' ? design.profile.id : design.profile.kind}
          onChange={e => {
            const v = e.target.value
            if (v === 'rect') onProfile({ kind: 'rect', widthMm: 248, heightMm: 156 })
            else onProfile({ kind: 'preset', id: v as never })
          }}
        >
          {PROFILE_PRESETS.map(p => (
            <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>
          ))}
          <MenuItem value="rect">Custom rectangle</MenuItem>
        </TextField>
      </HoverTooltip>

      {design.profile.kind === 'rect' && (
        <Stack direction="row" spacing={1}>
          <LengthField
            label="Width" imperial={imperial} valueMm={design.profile.widthMm}
            hint="Tray outline width, left to right."
            onChangeMm={v => onProfile({
              ...(design.profile as Extract<TrayProfile, { kind: 'rect' }>), widthMm: v,
            })}
          />
          <LengthField
            label="Depth" imperial={imperial} valueMm={design.profile.heightMm}
            hint="Tray outline depth, front to back."
            onChangeMm={v => onProfile({
              ...(design.profile as Extract<TrayProfile, { kind: 'rect' }>), heightMm: v,
            })}
          />
        </Stack>
      )}

      <Stack direction="row" spacing={1}>
        <LengthField
          label="Floor" imperial={imperial} valueMm={design.floorThicknessMm}
          hint="Solid material left below the deepest pocket. Under 3 mm on the CNC risks blowing through."
          onChangeMm={v => onDesign(d => ({ ...d, floorThicknessMm: v }))}
        />
        <LengthField
          label="Depth" imperial={imperial} valueMm={design.pocketDepthMm}
          hint="How deep every pocket cuts, measured from the top face."
          onChangeMm={v => onDesign(d => ({ ...d, pocketDepthMm: v }))}
        />
      </Stack>

      <Divider />
      {heading('Pocket sizing')}
      <HoverTooltip title="How a unit count becomes a pocket size. Library sizing rounds corners at 2 mm, wide enough for a 1/8&quot; bit; Python sizing matches the trays already cut but needs a smaller bit.">
        <TextField
          select size="small" label="Preset" value={sizingPreset}
          onChange={e => {
            if (e.target.value === 'library') onSizing({ ...LIBRARY_SIZING })
            if (e.target.value === 'python') onSizing({ ...PYTHON_SIZING })
          }}
          helperText={
            sizingPreset === 'python'
              ? 'A 1.00 mm radius cannot be cut by a 1/8" bit — printing only.'
              : sizingPreset === 'library'
                ? 'Machinable on the Origin with a 1/8" bit.'
                : 'Hand-tuned values.'
          }
        >
          <MenuItem value="library">SVG library — 19.05u − 0.45, r 2.00</MenuItem>
          <MenuItem value="python">Python source — 19.05u − 0.25, r 1.00</MenuItem>
          {sizingPreset === 'custom' && <MenuItem value="custom">Custom</MenuItem>}
        </TextField>
      </HoverTooltip>
      <Stack direction="row" spacing={1}>
        <LengthField
          label="Width offset" imperial={imperial} valueMm={design.sizing.widthOffset}
          hint="Added to units × pitch (19.05 mm) to get pocket width. Negative leaves clearance so a keycap lifts out easily."
          onChangeMm={v => onSizing({ ...design.sizing, widthOffset: v })}
        />
        <LengthField
          label="Corner r" imperial={imperial} valueMm={design.sizing.cornerRadius}
          hint="Pocket corner radius. Must be at least half the router bit diameter or the CNC can't cut it — see Fabrication below."
          onChangeMm={v => onSizing({ ...design.sizing, cornerRadius: v })}
        />
      </Stack>

      <Divider />
      {heading('Fabrication')}
      <Stack direction="row" spacing={1}>
        <LengthField
          label="Bit ⌀" imperial={imperial} valueMm={fab.toolDiameterMm}
          hint="Router bit diameter. Sets the tightest corner radius the CNC can actually cut."
          onChangeMm={v => onFab({ ...fab, toolDiameterMm: v })}
        />
        <LengthField
          label="Stock" imperial={imperial} valueMm={fab.stockThicknessMm}
          hint="Thickness of the material blank. Pocket depth plus floor must fit inside it."
          onChangeMm={v => onFab({ ...fab, stockThicknessMm: v })}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        <LengthField
          label="Plate W" imperial={imperial} valueMm={fab.plateWidthMm}
          hint="Printer build-plate width. Shown as the dashed outline when Show plate is on."
          onChangeMm={v => onFab({ ...fab, plateWidthMm: v })}
        />
        <LengthField
          label="Plate D" imperial={imperial} valueMm={fab.plateDepthMm}
          hint="Printer build-plate depth."
          onChangeMm={v => onFab({ ...fab, plateDepthMm: v })}
        />
      </Stack>

      {selected.length > 0 && (
        <>
          <Divider />
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            {heading(selected.length === 1 ? 'Selected pocket' : `${selected.length} pockets`)}
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Tooltip title="Move each selected pocket so it's centred left-to-right on the tray.">
              <Button size="small" onClick={() => centerSelected('x')} sx={{ minWidth: 0, px: 1 }}>
                Center X
              </Button>
            </Tooltip>
            <Tooltip title="Move each selected pocket so it's centred front-to-back on the tray.">
              <Button size="small" onClick={() => centerSelected('y')} sx={{ minWidth: 0, px: 1 }}>
                Center Y
              </Button>
            </Tooltip>
            <Tooltip title="Mirror the pocket's own shape left-to-right, in place. Only changes an asymmetric shape like ISO Enter.">
              <span>
                <Button
                  size="small" onClick={mirrorSelected} sx={{ minWidth: 0, px: 1 }}
                  disabled={!selected.some(p => p.shape === 'iso-enter')}
                >
                  Mirror
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Flip the pocket's own shape top-to-bottom, in place. Only changes an asymmetric shape like ISO Enter.">
              <span>
                <Button
                  size="small" onClick={flipSelected} sx={{ minWidth: 0, px: 1 }}
                  disabled={!selected.some(p => p.shape === 'iso-enter')}
                >
                  Flip
                </Button>
              </span>
            </Tooltip>
          </Stack>
          {selected.length === 1 && (
            <>
              <Tooltip title="Overrides the size label drawn on the pocket. Leave blank to fall back to the unit size.">
                <TextField
                  size="small" label="Label" value={selected[0].label ?? ''}
                  onChange={e => onPocket(selected[0].id, { label: e.target.value })}
                />
              </Tooltip>
              <Stack direction="row" spacing={1}>
                <LengthField
                  label="X" imperial={imperial} valueMm={selected[0].x}
                  hint="Footprint origin (lower-left before rotation), from the tray's origin."
                  onChangeMm={v => onPocket(selected[0].id, { x: v })}
                />
                <LengthField
                  label="Y" imperial={imperial} valueMm={selected[0].y}
                  hint="Footprint origin (lower-left before rotation), from the tray's origin."
                  onChangeMm={v => onPocket(selected[0].id, { y: v })}
                />
              </Stack>
              <AngleField
                valueDeg={selected[0].rotationDeg ?? 0}
                onChangeDeg={v => onPocket(selected[0].id, { rotationDeg: v })}
                hint="Rotate the pocket about its own centre. Or drag a corner handle on the canvas (hold Shift to snap to 15°)."
                sx={{ maxWidth: 120 }}
              />
            </>
          )}
          {selected.map(p => (
            <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ minWidth: 56 }}>
                {p.shape === 'iso-enter' ? 'ISO Ent.' : `${p.units}u`}
              </Typography>
              <Tooltip title="Cuts all the way through the floor instead of stopping at Depth, for a slot rather than a pocket.">
                <FormControlLabel
                  control={
                    <Switch
                      size="small" checked={!!p.isThrough}
                      onChange={e => onPocket(p.id, { isThrough: e.target.checked })}
                    />
                  }
                  label={<Typography variant="body2">Through cut</Typography>}
                />
              </Tooltip>
              <Tooltip title="Rotate this pocket 90°. A free angle set on the canvas or in the Angle field shows this unchecked.">
                <FormControlLabel
                  control={
                    <Switch
                      size="small" checked={p.rotationDeg === 90}
                      onChange={e => onPocket(p.id, { rotationDeg: e.target.checked ? 90 : 0 })}
                    />
                  }
                  label={<Typography variant="body2">Tilt</Typography>}
                />
              </Tooltip>
              {p.shape === 'iso-enter' && (
                <>
                  <Tooltip title="Mirror this shape left-to-right, in place.">
                    <FormControlLabel
                      control={
                        <Switch
                          size="small" checked={!!p.mirrorX}
                          onChange={e => onPocket(p.id, { mirrorX: e.target.checked })}
                        />
                      }
                      label={<Typography variant="body2">Mirror</Typography>}
                    />
                  </Tooltip>
                  <Tooltip title="Flip this shape top-to-bottom, in place.">
                    <FormControlLabel
                      control={
                        <Switch
                          size="small" checked={!!p.flipY}
                          onChange={e => onPocket(p.id, { flipY: e.target.checked })}
                        />
                      }
                      label={<Typography variant="body2">Flip</Typography>}
                    />
                  </Tooltip>
                </>
              )}
            </Stack>
          ))}
        </>
      )}
    </Stack>
  )
}
