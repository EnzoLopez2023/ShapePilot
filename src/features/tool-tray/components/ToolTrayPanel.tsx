import {
  Alert, Button, Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import LengthField from '../../../components/LengthField.tsx'
import {
  PROFILE_PRESETS, profileInternalClearHeight, profileSize, profileTotalClearHeight,
} from '../../../model/trayProfile.ts'
import type { PresetProfileId, TrayProfile } from '../../../model/trayProfile.ts'
import { MATERIALS } from '../../keycap-tray/model/materials.ts'
import type { MaterialId } from '../../keycap-tray/model/materials.ts'
import type {
  FingerAccess, PocketStep, StepShape, ToolPocket, ToolTrayDesign, UndersideReliefMode,
} from '../model/types.ts'
import { deepestStepMm } from '../geometry/shapes.ts'
import {
  DEFAULT_FINGER_ACCESS, FINGER_ACCESS_PRESETS, fingerAccessFrom, fingerAccessPresetOf,
} from '../model/fingerAccess.ts'
import type { Issue } from '../geometry/validate.ts'

const RELIEF_LABELS: Record<UndersideReliefMode, string> = {
  ignore: 'Ignore them',
  avoid: 'Keep pockets clear',
  generate: 'Keep clear and cut them',
}

export interface ToolTrayPanelProps {
  design: ToolTrayDesign
  selected: ToolPocket | null
  issues: Issue[]
  imperial: boolean
  material: MaterialId
  levels: number
  onMaterial: (id: MaterialId) => void
  onProfile: (p: TrayProfile) => void
  onHeight: (mm: number) => void
  onLayerHeight: (mm: number) => void
  onMinFloor: (mm: number) => void
  onUndersideReliefs: (mode: UndersideReliefMode) => void
  onCaseClearHeight: (mm: number | undefined) => void
  onFeet: (feet: ToolTrayDesign['feet']) => void
  onPocket: (id: string, patch: Partial<ToolPocket>) => void
  onStep: (pocketId: string, index: number, patch: Partial<PocketStep>) => void
  onAddStep: (pocketId: string) => void
  onRemoveStep: (pocketId: string, index: number) => void
  onFingerAccess: (pocketId: string, access: FingerAccess | undefined) => void
}

/**
 * Tray settings, and the selected pocket.
 *
 * The height is the number this designer is really about: every pocket depth is
 * measured DOWN from it, so there is no separate floor thickness to keep in
 * step. `minFloorMm` is a validation bound rather than geometry, which the hint
 * says outright -- it is the one field a reader of the keycap tray will expect
 * to mean something else.
 */
export function ToolTrayPanel({
  design, selected, issues, imperial, material, levels,
  onMaterial, onProfile, onHeight, onLayerHeight, onMinFloor,
  onUndersideReliefs, onCaseClearHeight, onFeet, onPocket,
  onStep, onAddStep, onRemoveStep, onFingerAccess,
}: ToolTrayPanelProps) {
  const size = profileSize(design.profile)
  const baseCavity = design.caseClearHeightMm ?? profileInternalClearHeight(design.profile)
  const withLid = profileTotalClearHeight(design.profile)
  const tiers = baseCavity ? Math.floor(baseCavity / Math.max(1, design.heightMm)) : null
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const deepest = design.pockets.reduce(
    (mm, p) => Math.max(mm, deepestStepMm(p) ?? design.heightMm), 0)

  return (
    <Stack spacing={1.5}>
      <Typography variant="h3" component="h2">Tray</Typography>

      <TextField
        select
        size="small"
        label="Outline"
        value={design.profile.kind === 'preset' ? design.profile.id : 'custom'}
        onChange={e => onProfile({ kind: 'preset', id: e.target.value as PresetProfileId })}
      >
        {PROFILE_PRESETS.map(p => (
          <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>
        ))}
      </TextField>
      <Typography variant="body2" color="text.secondary">
        {size.widthMm.toFixed(1)} × {size.heightMm.toFixed(1)} mm
      </Typography>

      <LengthField
        label="Tray height"
        imperial={imperial}
        valueMm={design.heightMm}
        onChangeMm={onHeight}
        hint={
          `Underside to rim. Every pocket depth is measured down from this — `
          + `the deepest so far is ${deepest.toFixed(1)} mm.`
        }
      />

      <LengthField
        label="Layer height"
        imperial={imperial}
        valueMm={design.layerHeightMm}
        onChangeMm={onLayerHeight}
        hint={`Pocket floors snap down to whole layers. ${levels} distinct floor levels so far.`}
      />

      <LengthField
        label="Minimum floor"
        imperial={imperial}
        valueMm={design.minFloorMm}
        onChangeMm={onMinFloor}
        hint="A check, not geometry: pockets deeper than this leaves room for are flagged."
      />

      <TextField
        select
        size="small"
        label="Filament"
        value={material}
        onChange={e => onMaterial(e.target.value as MaterialId)}
        helperText={MATERIALS[material].note}
      >
        {Object.values(MATERIALS).map(m => (
          <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>
        ))}
      </TextField>

      <Divider />

      <Typography variant="h3" component="h2">The case</Typography>
      <Tooltip title={
        "The Systainer inlays carry four hex-key lift recesses cut into the tray's "
        + 'underside. They reach 18.5 mm inboard, so a pocket near the left or right '
        + 'edge with a floor below the recess opens a hole in the wall.'
      }>
        <TextField
          select
          size="small"
          label="Lift recesses"
          value={design.undersideReliefs ?? 'avoid'}
          onChange={e => onUndersideReliefs(e.target.value as UndersideReliefMode)}
        >
          {(Object.keys(RELIEF_LABELS) as UndersideReliefMode[]).map(mode => (
            <MenuItem key={mode} value={mode}>{RELIEF_LABELS[mode]}</MenuItem>
          ))}
        </TextField>
      </Tooltip>

      {baseCavity !== null && (
        <Typography variant="body2" color="text.secondary">
          {tiers === 0
            ? `This tray is taller than the ${baseCavity} mm base cavity.`
            : `${tiers} of these stack in the ${baseCavity} mm base cavity.`}
          {withLid !== null && ` The lid adds ${withLid - baseCavity} mm, but its recess is `
            + 'inset from the case walls, so a full-width tray cannot use it.'}
        </Typography>
      )}
      <Tooltip title={
        "Usable height in the case's base cavity. The Systainer presets carry 48 mm, "
        + 'measured with calipers on a real SYS3 S 76. Override it for a different case.'
      }>
        <span>
          <LengthField
            label="Case base cavity"
            imperial={imperial}
            valueMm={baseCavity ?? 48}
            onChangeMm={mm => onCaseClearHeight(mm)}
          />
        </span>
      </Tooltip>

      <Divider />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(design.feet)}
            onChange={e => onFeet(
              e.target.checked ? { heightMm: 6, sizeMm: 10, pattern: 'corners' } : undefined)}
          />
        }
        label="Feet"
      />
      {design.feet && (
        <Stack direction="row" spacing={1}>
          <LengthField
            label="Foot height"
            imperial={imperial}
            valueMm={design.feet.heightMm}
            onChangeMm={mm => onFeet({ ...design.feet!, heightMm: mm })}
          />
          <LengthField
            label="Foot size"
            imperial={imperial}
            valueMm={design.feet.sizeMm}
            onChangeMm={mm => onFeet({ ...design.feet!, sizeMm: mm })}
          />
        </Stack>
      )}

      {selected && (
        <>
          <Divider />
          <Typography variant="h3" component="h2">
            {selected.label ?? selected.presetId ?? 'Pocket'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selected.widthMm.toFixed(1)} × {selected.heightMm.toFixed(1)} mm ·{' '}
            {selected.steps.length === 1
              ? `${selected.steps[0]!.depthMm ?? 'through'} deep`
              : `${selected.steps.length} tiers, deepest ${deepestStepMm(selected) ?? 'through'}`}
          </Typography>
          <Stack direction="row" spacing={1}>
            <LengthField
              label="X"
              imperial={imperial}
              valueMm={selected.x}
              onChangeMm={mm => onPocket(selected.id, { x: mm })}
            />
            <LengthField
              label="Y"
              imperial={imperial}
              valueMm={selected.y}
              onChangeMm={mm => onPocket(selected.id, { y: mm })}
            />
          </Stack>
          <TextField
            size="small"
            label="Angle"
            type="number"
            value={selected.rotationDeg ?? 0}
            onChange={e => onPocket(selected.id, { rotationDeg: Number(e.target.value) || 0 })}
            helperText="Turns the whole pocket, every tier together."
          />
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(selected.mirrorX)}
                  onChange={e => onPocket(selected.id, { mirrorX: e.target.checked })}
                />
              }
              label="Mirror"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(selected.flipY)}
                  onChange={e => onPocket(selected.id, { flipY: e.target.checked })}
                />
              }
              label="Flip"
            />
          </Stack>
        </>
      )}

      {selected && (
        <>
          <Divider />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h3" component="h2">Tiers</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => onAddStep(selected.id)}>
              Add
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Each tier is one floor. A wider, shallower tier over a narrower, deeper
            one is a lead-in the part drops into; several make a bay that follows
            the shape of the thing it holds.
          </Typography>
          {selected.steps.map((step, i) => (
            <Stack key={i} spacing={1} sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2">
                  Tier {i + 1} · {step.shape.kind}
                </Typography>
                <Tooltip title={selected.steps.length > 1
                  ? 'Remove this tier'
                  : 'A pocket needs at least one tier'}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Remove tier ${i + 1}`}
                      disabled={selected.steps.length <= 1}
                      onClick={() => onRemoveStep(selected.id, i)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <Stack direction="row" spacing={1}>
                <LengthField
                  label="Depth"
                  imperial={imperial}
                  valueMm={step.depthMm ?? design.heightMm}
                  onChangeMm={mm => onStep(selected.id, i, { depthMm: mm })}
                />
                {step.shape.kind === 'rect' && (
                  <>
                    <LengthField
                      label="Width"
                      imperial={imperial}
                      valueMm={step.shape.widthMm}
                      onChangeMm={mm => onStep(selected.id, i, {
                        shape: { ...(step.shape as Extract<StepShape, { kind: 'rect' }>), widthMm: mm },
                      })}
                    />
                    <LengthField
                      label="Length"
                      imperial={imperial}
                      valueMm={step.shape.heightMm}
                      onChangeMm={mm => onStep(selected.id, i, {
                        shape: {
                          ...(step.shape as Extract<StepShape, { kind: 'rect' }>), heightMm: mm,
                        },
                      })}
                    />
                  </>
                )}
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={step.depthMm === null}
                    onChange={e => onStep(selected.id, i, {
                      depthMm: e.target.checked ? null : (deepestStepMm(selected) ?? design.heightMm),
                    })}
                  />
                }
                label="Cut through"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(step.liftOverKeepOut)}
                    onChange={e => onStep(selected.id, i, {
                      liftOverKeepOut: e.target.checked || undefined,
                    })}
                  />
                }
                label="Lift over a lift recess"
              />
              {step.liftOverKeepOut && (
                <Typography variant="caption" color="text.secondary">
                  This tier&rsquo;s floor is held above the recess, leaving a thin roof to
                  bridge it. That puts a step in the floor — fine under loose hardware,
                  a defect under an allen key.
                </Typography>
              )}
            </Stack>
          ))}

          <Divider />
          <Typography variant="h3" component="h2">Finger access</Typography>
          <Typography variant="body2" color="text.secondary">
            A scoop or slot breaking the pocket wall, so the part can be lifted
            out. A close-fitting pocket with no way under the part is a pocket
            that keeps it.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(selected.fingerAccess)}
                onChange={e => onFingerAccess(selected.id, e.target.checked
                  ? fingerAccessFrom(DEFAULT_FINGER_ACCESS, 'left')
                  : undefined)}
              />
            }
            label="Finger access"
          />
          {selected.fingerAccess && (
            <>
              <TextField
                select size="small" label="Fit"
                value={fingerAccessPresetOf(selected.fingerAccess)?.id ?? 'custom'}
                onChange={e => {
                  const preset = FINGER_ACCESS_PRESETS.find(p => p.id === e.target.value)
                  if (preset) {
                    onFingerAccess(selected.id,
                      fingerAccessFrom(preset, selected.fingerAccess!.side))
                  }
                }}
                helperText={
                  fingerAccessPresetOf(selected.fingerAccess)?.note
                  ?? 'Sized by hand. Pick a fit to go back to a standard one.'
                }
              >
                {FINGER_ACCESS_PRESETS.map(preset => (
                  <MenuItem key={preset.id} value={preset.id}>{preset.label}</MenuItem>
                ))}
                {!fingerAccessPresetOf(selected.fingerAccess) && (
                  <MenuItem value="custom" disabled>Custom</MenuItem>
                )}
              </TextField>
              <Stack direction="row" spacing={1}>
                <TextField
                  select size="small" label="Style" sx={{ flex: 1 }}
                  value={selected.fingerAccess.style}
                  onChange={e => onFingerAccess(selected.id, {
                    ...selected.fingerAccess!,
                    style: e.target.value as FingerAccess['style'],
                  })}
                >
                  <MenuItem value="scallop">Scallop</MenuItem>
                  <MenuItem value="slot">Slot</MenuItem>
                </TextField>
                <TextField
                  select size="small" label="Side" sx={{ flex: 1 }}
                  value={selected.fingerAccess.side}
                  onChange={e => onFingerAccess(selected.id, {
                    ...selected.fingerAccess!,
                    side: e.target.value as FingerAccess['side'],
                  })}
                >
                  {(['left', 'right', 'top', 'bottom'] as const).map(side => (
                    <MenuItem key={side} value={side}>{side}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={1}>
                <LengthField
                  label="Width" imperial={imperial}
                  valueMm={selected.fingerAccess.widthMm}
                  onChangeMm={mm => onFingerAccess(selected.id, {
                    ...selected.fingerAccess!, widthMm: mm,
                  })}
                />
                <LengthField
                  label="Reach" imperial={imperial}
                  valueMm={selected.fingerAccess.reachMm}
                  onChangeMm={mm => onFingerAccess(selected.id, {
                    ...selected.fingerAccess!, reachMm: mm,
                  })}
                />
              </Stack>
            </>
          )}
        </>
      )}

      {(errors.length > 0 || warnings.length > 0) && <Divider />}
      {errors.map((issue, i) => (
        <Alert key={`e${i}`} severity="error">{issue.message}</Alert>
      ))}
      {warnings.map((issue, i) => (
        <Alert key={`w${i}`} severity="warning">{issue.message}</Alert>
      ))}
    </Stack>
  )
}

export default ToolTrayPanel
