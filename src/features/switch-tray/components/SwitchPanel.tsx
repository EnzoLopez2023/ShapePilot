import {
  Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import LengthField from '../../../components/LengthField.tsx'
import HoverTooltip from '../../../components/HoverTooltip.tsx'
import { PROFILE_PRESETS } from '../../../model/trayProfile.ts'
import {
  RETENTION_LABELS, cellHoleMm, cellKeepoutMm, defaultFeet, defaultPlate, minPitchMm,
} from '../model/defaults.ts'
import { SWITCH_PROFILES, getSwitchProfile } from '../model/switches.ts'
import { DEFAULT_NAMEPLATE_DEPTH_MM } from '../geometry/layers.ts'
import type {
  FillSettings, NameplateStyle, PlateSettings, Retention, SwitchProfile, SwitchProfileId,
  SwitchTrayDesign, TrayProfile,
} from '../model/types.ts'

export interface SwitchPanelProps {
  design: SwitchTrayDesign
  imperial: boolean
  onImperial: (v: boolean) => void
  onProfile: (p: TrayProfile) => void
  onSwitch: (patch: Partial<SwitchProfile>) => void
  onPlate: (patch: Partial<PlateSettings>) => void
  onDesign: (mutate: (d: SwitchTrayDesign) => SwitchTrayDesign) => void
}

const RETENTIONS: Retention[] = ['shelf', 'clip', 'plain']

const NAMEPLATE_STYLE_HELP = [
  'Inlay: the glyphs are taken out of the top of the plate and exported as a second body '
  + 'that fills exactly that space. The surface stays flat and the name is read by colour, '
  + 'so a thin stroke still works. Needs a second filament.',
  'Inset: the same cut with nothing filling it — read by the shadow in the groove, so it '
  + 'wants a heavier stroke to survive first-layer squish.',
  'Raised: a boss on the top face. That face is the one on the bed when the tray prints '
  + 'feet-up, so the bump stops it lying flat.',
].join('\n\n')

/**
 * The left column: what the tray is cut from, what goes in it, and how the
 * plate holds it. Everything that decides a cell's *shape*, as opposed to where
 * the cells go -- that is the fill panel on the right.
 */
export default function SwitchPanel(props: SwitchPanelProps) {
  const { design, imperial, onImperial, onProfile, onSwitch, onPlate, onDesign } = props
  const { plate } = design
  const heading = (t: string) => <Typography variant="h3" component="h2">{t}</Typography>

  const holeMm = cellHoleMm(plate, design.switch)
  const keepoutMm = cellKeepoutMm(plate, design.switch)
  const ledgeMm = (keepoutMm - holeMm) / 2

  /**
   * Switching retention or switch re-derives the whole plate, the pitch floor
   * and the posts. Carrying the old ones over would be wrong every time: a
   * 3.6 mm shelf plate kept for `clip` stops the switch's clips latching, and
   * MX-height posts kept for Choc are 5 mm of wasted filament per corner and
   * cost a whole tier in the case. Feet are only re-derived when the tray has
   * them -- turning them off is a decision, not a stale value.
   */
  const rederive = (sw: SwitchProfile, retention: Retention) => {
    const next = defaultPlate(retention, sw)
    onDesign(d => ({
      ...d,
      switch: sw === d.switch ? d.switch : { ...sw },
      plate: next,
      fill: { ...d.fill, ...respace(d.fill, d.plate, d.switch, next, sw) },
      ...(d.feet ? { feet: { ...defaultFeet(next, sw), separate: d.feet.separate } } : {}),
      skippedCells: undefined,
    }))
  }

  const pickRetention = (retention: Retention) => rederive(design.switch, retention)
  const pickSwitch = (id: SwitchProfileId) => rederive(getSwitchProfile(id), plate.retention)

  return (
    <Stack spacing={2} sx={{ p: 2, overflowY: 'auto', height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        {heading('Switch & plate')}
        <Tooltip title="Display units. Every field reads and writes millimetres underneath.">
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

      <Tooltip title="Shown on the toolbar, in the Open list, on exported file names — and, when the nameplate is on, cut into the plate itself.">
        <TextField
          size="small" label="Name" value={design.name}
          onChange={e => onDesign(d => ({ ...d, name: e.target.value }))}
        />
      </Tooltip>

      <HoverTooltip title="The tray outline. Presets match a physical Systainer insert; Custom rectangle lets you set any width and depth.">
        <TextField
          select size="small" label="Outline"
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

      <Divider />

      <HoverTooltip title="Which switch the plate is cut for. Picking one re-derives the plate and pitch; every dimension below stays editable, so a caliper reading on your own switches wins.">
        <TextField
          select size="small" label="Switch"
          value={SWITCH_PROFILES.some(s => s.id === design.switch.id) ? design.switch.id : ''}
          onChange={e => pickSwitch(e.target.value as SwitchProfileId)}
        >
          {SWITCH_PROFILES.map(s => (
            <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
          ))}
        </TextField>
      </HoverTooltip>
      <Typography variant="body2" color="text.secondary">
        {design.switch.source}
      </Typography>

      <Stack direction="row" spacing={1}>
        <LengthField
          label="Body" imperial={imperial} valueMm={design.switch.bodyMm}
          hint="The lower housing — the square the plate is cut to. 14.00 mm on MX, 13.80 on Choc v1."
          onChangeMm={v => onSwitch({ bodyMm: v })}
        />
        <LengthField
          label="Housing" imperial={imperial} valueMm={design.switch.housingMm}
          hint="The top housing: the widest part, and what a drop-in recess has to clear. 15.60 mm on MX."
          onChangeMm={v => onSwitch({ housingMm: v })}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        <LengthField
          label="Above plate" imperial={imperial} valueMm={design.switch.flangeToTopMm}
          hint="Flange underside up to the stem top — what stands proud of the plate. Half of the stacking pitch."
          onChangeMm={v => onSwitch({ flangeToTopMm: v })}
        />
        <LengthField
          label="Below plate" imperial={imperial} valueMm={design.switch.flangeToTipMm}
          hint="Flange underside down to the pin tips — what hangs below. This is what the feet have to lift clear."
          onChangeMm={v => onSwitch({ flangeToTipMm: v })}
        />
      </Stack>

      <Divider />

      <HoverTooltip title={RETENTIONS.map(r => `${RETENTION_LABELS[r].label}: ${RETENTION_LABELS[r].blurb}`).join('\n')}>
        <TextField
          select size="small" label="Retention"
          value={plate.retention}
          onChange={e => pickRetention(e.target.value as Retention)}
        >
          {RETENTIONS.map(r => (
            <MenuItem key={r} value={r}>{RETENTION_LABELS[r].label}</MenuItem>
          ))}
        </TextField>
      </HoverTooltip>
      <Typography variant="body2" color="text.secondary">
        {RETENTION_LABELS[plate.retention].blurb}
      </Typography>

      <Stack direction="row" spacing={1}>
        <LengthField
          label="Plate" imperial={imperial} valueMm={plate.shelfMm}
          hint="The band the body hole goes through. On a clip-in plate this is what the switch's clips latch onto — MX wants 1.5 mm. Keep it a whole number of layers."
          onChangeMm={v => onPlate({ shelfMm: v })}
        />
        <LengthField
          label="Recess" imperial={imperial} valueMm={plate.recessMm}
          hint="Depth of the counterbore the top housing sits in. Zero on a clip-in or plain plate."
          onChangeMm={v => onPlate({ recessMm: v })}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        <LengthField
          label="Hole clearance" imperial={imperial} valueMm={plate.holeClearanceMm}
          hint="Added to the body square. FDM prints holes undersize, so 0.2 mm is about right for PLA; raise it if the switch will not go in."
          onChangeMm={v => onPlate({ holeClearanceMm: v })}
        />
        <LengthField
          label="Recess clearance" imperial={imperial} valueMm={plate.recessClearanceMm}
          hint="Added to the housing square for the recess. It also eats the wall between cells, so it costs density."
          onChangeMm={v => onPlate({ recessClearanceMm: v })}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Hole {holeMm.toFixed(2)} mm
        {plate.recessMm > 0 && ` · recess ${keepoutMm.toFixed(2)} mm · shelf ${ledgeMm.toFixed(2)} mm wide`}
        {' · '}plate {(plate.shelfMm + plate.recessMm).toFixed(2)} mm thick
      </Typography>

      <Tooltip title="How much a printer can round a cell's corners. 0.5 mm keeps them honest without a visible bulge; zero corners come out ragged on FDM.">
        <span>
          <LengthField
            label="Cell corner radius" imperial={imperial} valueMm={plate.cornerRadiusMm}
            onChangeMm={v => onPlate({ cornerRadiusMm: v })}
          />
        </span>
      </Tooltip>

      <Divider />

      <Tooltip title="Carry the tray's name on the plate's top face — the side you see in the case. Drag it on the layout to place it; the fill keeps switch cells clear of wherever it lands.">
        <FormControlLabel
          control={
            <Switch
              size="small" checked={!!design.nameplate}
              onChange={e => onDesign(d => ({
                ...d,
                nameplate: e.target.checked
                  ? {
                    style: 'inlay',
                    heightMm: 1.2,
                    depthMm: DEFAULT_NAMEPLATE_DEPTH_MM,
                    fontSizeMm: 8,
                    x: 40,
                    y: 12,
                  }
                  : undefined,
              }))}
            />
          }
          label="Name on the plate"
        />
      </Tooltip>

      {design.nameplate && (
        <>
          <HoverTooltip title={NAMEPLATE_STYLE_HELP}>
            <TextField
              select size="small" label="Style"
              value={design.nameplate.style ?? 'raised'}
              onChange={e => onDesign(d => (d.nameplate
                ? { ...d, nameplate: { ...d.nameplate, style: e.target.value as NameplateStyle } }
                : d))}
            >
              <MenuItem value="inlay">Inlay — flush, second colour</MenuItem>
              <MenuItem value="inset">Inset — cut in, read by shadow</MenuItem>
              <MenuItem value="raised">Raised — stands proud</MenuItem>
            </TextField>
          </HoverTooltip>

          <Stack direction="row" spacing={1}>
            <LengthField
              label="Text size" imperial={imperial} valueMm={design.nameplate.fontSizeMm}
              hint="Em size, not cap height — this font's capitals are 0.70 em, so 8 mm draws 5.7 mm letters. An inlay is read by colour and stays legible small; an inset is read by shadow and wants 8 mm or more to survive the first layer."
              onChangeMm={v => onDesign(d => (d.nameplate
                ? { ...d, nameplate: { ...d.nameplate, fontSizeMm: v } }
                : d))}
            />
            {(design.nameplate.style ?? 'raised') === 'raised' ? (
              <LengthField
                label="Height" imperial={imperial} valueMm={design.nameplate.heightMm}
                hint="How far the text stands proud of the top face. Note this is the face that lies on the bed when the tray prints feet-up, so a raised name stops it lying flat."
                onChangeMm={v => onDesign(d => (d.nameplate
                  ? { ...d, nameplate: { ...d.nameplate, heightMm: v } }
                  : d))}
              />
            ) : (
              <LengthField
                label="Depth" imperial={imperial}
                valueMm={design.nameplate.depthMm ?? DEFAULT_NAMEPLATE_DEPTH_MM}
                hint="How far the cut goes into the plate. 0.6 mm is three layers, which is opaque for an inlay; the plate is only a few millimetres thick, so keep it well under that."
                onChangeMm={v => onDesign(d => (d.nameplate
                  ? { ...d, nameplate: { ...d.nameplate, depthMm: v } }
                  : d))}
              />
            )}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {(design.nameplate.style ?? 'raised') === 'inlay'
              ? `${(design.nameplate.fontSizeMm * 0.7).toFixed(1)} mm letters, flush with the top `
                + 'face — exports as a second body filling exactly the space it cut.'
              : (design.nameplate.style === 'inset'
                ? `${(design.nameplate.fontSizeMm * 0.7).toFixed(1)} mm letters, cut into the top `
                  + 'face. One body, one colour.'
                : `${(design.nameplate.fontSizeMm * 0.7).toFixed(1)} mm letters standing proud — `
                  + 'the plate will not lie flat on the bed in this print orientation.')}
          </Typography>
        </>
      )}
    </Stack>
  )
}

/**
 * Move the pitch onto the new plate's floor.
 *
 * A pitch still sitting on the *old* floor was never chosen -- it is the number
 * the previous plate implied -- so it follows the new one down as well as up.
 * That matters: a drop-in shelf cannot go below 17.1 mm, and switching to a
 * clip plate should actually hand back the density it just freed. A pitch the
 * user opened up themselves is theirs, and only ever gets raised, never cut.
 */
function respace(
  fill: FillSettings, oldPlate: PlateSettings, oldSwitch: SwitchProfile,
  plate: PlateSettings, sw: SwitchProfile,
): { pitchXMm: number; pitchYMm: number } {
  const was = Math.round(minPitchMm(oldPlate, oldSwitch) * 10) / 10
  const floor = Math.round(minPitchMm(plate, sw) * 10) / 10
  const move = (pitch: number) =>
    Math.abs(pitch - was) < 1e-6 ? floor : Math.max(pitch, floor)
  return { pitchXMm: move(fill.pitchXMm), pitchYMm: move(fill.pitchYMm) }
}
