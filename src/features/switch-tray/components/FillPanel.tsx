import {
  Alert, Button, Divider, FormControlLabel, LinearProgress, MenuItem, Slider, Stack,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import LengthField from '../../../components/LengthField.tsx'
import HoverTooltip from '../../../components/HoverTooltip.tsx'
import {
  bottomTierFeetHeightMm, cellKeepoutMm, defaultFeet, feetHeightMm, minPitchMm,
  requiredFeetHeightMm, wallAtPitchMm,
} from '../model/defaults.ts'
import { stackBudget } from '../model/stack.ts'
import { profileTotalClearHeight } from '../../../model/trayProfile.ts'
import type { FeetSettings, FillSettings, SwitchTrayDesign } from '../model/types.ts'
import type { FillPlan } from '../geometry/fill.ts'
import { feetWanted } from '../geometry/feet.ts'
import type { Issue } from '../geometry/validate.ts'

export interface FillPanelProps {
  design: SwitchTrayDesign
  plan: FillPlan
  issues: Issue[]
  fittedFeet: number
  imperial: boolean
  onFill: (patch: Partial<FillSettings>) => void
  onFeet: (feet: FeetSettings | undefined) => void
  onDesign: (mutate: (d: SwitchTrayDesign) => SwitchTrayDesign) => void
  onClearSkipped: () => void
}

/**
 * The right column: how many switches fit, and how the trays stack.
 *
 * The count at the top is the whole point of the designer, so it leads --
 * every control below it is a thing you change while watching that number.
 */
export default function FillPanel(props: FillPanelProps) {
  const {
    design, plan, issues, fittedFeet, imperial, onFill, onFeet, onDesign, onClearSkipped,
  } = props
  const { fill, feet } = design
  const heading = (t: string) => <Typography variant="h3" component="h2">{t}</Typography>

  const budget = stackBudget(design)
  // The budget is the case's base cavity. The lid adds a recess on top, but it
  // is inset from the walls, so a full-footprint tray cannot use it -- worth
  // saying, because the two numbers differ by a whole tier.
  const withLid = profileTotalClearHeight(design.profile)
  const floor = minPitchMm(design.plate, design.switch)
  const wall = Math.min(
    wallAtPitchMm(plan.pitchXMm, design.plate, design.switch),
    wallAtPitchMm(plan.pitchYMm, design.plate, design.switch))
  const skipped = design.skippedCells?.length ?? 0
  const wanted = feetWanted(feet)
  const tier = feet?.tier ?? 'stacked'
  const height = feetHeightMm(feet)
  const stackedMm = feet?.heightMm ?? requiredFeetHeightMm(design.plate, design.switch)
  const bottomMm = feet?.bottomTierHeightMm
    ?? bottomTierFeetHeightMm(design.plate, design.switch)

  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  return (
    <Stack spacing={2} sx={{ p: 2, overflowY: 'auto', height: '100%' }}>
      <Stack spacing={0.5}>
        {heading('Capacity')}
        <Typography variant="h2" component="p">
          {plan.cells.length} switches
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {plan.columns} × {plan.rows} at {plan.pitchXMm.toFixed(2)} × {plan.pitchYMm.toFixed(2)} mm
          {skipped > 0 && ` · ${skipped} left out`}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {wall > 0
            ? `${wall.toFixed(2)} mm of plate between neighbours`
            : 'the cells overlap — raise the pitch'}
        </Typography>
        {skipped > 0 && (
          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={onClearSkipped}>
            Put all {skipped} back
          </Button>
        )}
      </Stack>

      {errors.map(issue => (
        <Alert key={issue.code} severity="error" variant="outlined">{issue.message}</Alert>
      ))}
      {warnings.map(issue => (
        <Alert key={issue.code} severity="warning" variant="outlined">{issue.message}</Alert>
      ))}

      <Divider />

      {heading('Fill')}
      <Tooltip title={`Centre to centre, left to right. The floor is ${floor.toFixed(1)} mm here: whichever is larger of the switch's own minimum spacing and what leaves a printable wall between cells.`}>
        <Stack>
          <Typography variant="body2" id="pitch-x-label">
            Pitch across — {fill.pitchXMm.toFixed(2)} mm
          </Typography>
          <Slider
            size="small"
            aria-labelledby="pitch-x-label"
            value={fill.pitchXMm}
            min={Math.floor(floor * 2) / 2}
            max={30}
            step={0.05}
            onChange={(_e, v) => onFill({ pitchXMm: v as number })}
          />
        </Stack>
      </Tooltip>
      <Tooltip title="Centre to centre, front to back. Choc keyboards use 18 × 17 mm, so the two axes are worth setting separately.">
        <Stack>
          <Typography variant="body2" id="pitch-y-label">
            Pitch down — {fill.pitchYMm.toFixed(2)} mm
          </Typography>
          <Slider
            size="small"
            aria-labelledby="pitch-y-label"
            value={fill.pitchYMm}
            min={Math.floor(floor * 2) / 2}
            max={30}
            step={0.05}
            onChange={(_e, v) => onFill({ pitchYMm: v as number })}
          />
        </Stack>
      </Tooltip>

      <Stack direction="row" spacing={1}>
        <LengthField
          label="Margin" imperial={imperial} valueMm={fill.marginMm}
          hint="Clear material demanded between a cell and the tray outline. This is also what keeps a cell off a notch."
          onChangeMm={v => onFill({ marginMm: v })}
        />
        <Tooltip title="Cell size including clearance — what the fill actually packs.">
          <TextField
            size="small" label="Cell" disabled
            value={`${cellKeepoutMm(design.plate, design.switch).toFixed(2)} mm`}
          />
        </Tooltip>
      </Stack>

      <HoverTooltip title="Centred puts the grid on the outline's middle. Fit the most searches the grid origin for whatever holds the most switches — on a notched outline that is usually a row or a column more.">
        <TextField
          select size="small" label="Arrangement" value={fill.origin}
          onChange={e => onFill({ origin: e.target.value as FillSettings['origin'] })}
        >
          <MenuItem value="maximised">Fit the most</MenuItem>
          <MenuItem value="centred">Centred</MenuItem>
        </TextField>
      </HoverTooltip>

      <Tooltip title="Offset alternate rows by half a pitch, like brickwork. Occasionally wins a row on a notched outline; usually costs one on a rectangle.">
        <FormControlLabel
          control={
            <Switch
              size="small" checked={fill.stagger === 'brick'}
              onChange={e => onFill({ stagger: e.target.checked ? 'brick' : 'none' })}
            />
          }
          label="Stagger rows"
        />
      </Tooltip>

      <Tooltip title="Treat the pitch as a minimum and open it up until a switch would be lost, so the spare millimetres are shared out between the cells instead of left along one edge.">
        <FormControlLabel
          control={
            <Switch
              size="small" checked={fill.spreadEvenly}
              onChange={e => onFill({ spreadEvenly: e.target.checked })}
            />
          }
          label="Spread evenly"
        />
      </Tooltip>

      <Divider />

      {heading('Feet & stacking')}
      <Tooltip title="Posts under the plate. They keep this tray's switch pins off whatever is below, and they are what a tray stacked on top rests on.">
        <FormControlLabel
          control={
            <Switch
              size="small" checked={!!feet}
              onChange={e => onFeet(
                e.target.checked ? defaultFeet(design.plate, design.switch) : undefined)}
            />
          }
          label="Feet"
        />
      </Tooltip>

      {feet && (
        <>
          <HoverTooltip title="A stack needs two builds of the same tray. Everything above the bottom stands on the tray below and has to clear a whole switch; the bottom one rests on the case floor and only has to lift its own pins, which is what buys the extra tier. Switch between them and export each once.">
            <TextField
              select size="small" label="Building"
              value={feet.tier ?? 'stacked'}
              onChange={e => {
                const tier = e.target.value as 'stacked' | 'bottom'
                onFeet({ ...feet, tier })
              }}
            >
              <MenuItem value="stacked">
                A tray that stands on another ({stackedMm.toFixed(1)} mm posts)
              </MenuItem>
              <MenuItem value="bottom">
                The bottom of the stack ({bottomMm.toFixed(1)} mm posts)
              </MenuItem>
            </TextField>
          </HoverTooltip>

          <Stack direction="row" spacing={1}>
            <LengthField
              label={tier === 'bottom' ? 'Post height (bottom)' : 'Post height (stacked)'}
              imperial={imperial}
              valueMm={height}
              hint={tier === 'bottom'
                ? 'This tray rests on the case floor, so the posts only have to lift its own switch pins clear.'
                : 'This tray stands on another, so the posts have to clear a whole switch — the tray below has switch tops standing up into the same air these pins hang into.'}
              onChangeMm={v => onFeet(tier === 'bottom'
                ? { ...feet, bottomTierHeightMm: v }
                : { ...feet, heightMm: v })}
            />
            <LengthField
              label="Post size" imperial={imperial} valueMm={feet.sizeMm}
              hint="Square footprint of each post. Cells never land on one — the layout treats the footprints as occupied."
              onChangeMm={v => onFeet({ ...feet, sizeMm: v })}
            />
          </Stack>
          <HoverTooltip title="Four corners is the least filament. Corners and edges adds a post at the middle of each side, which stops a big thin plate sagging in the middle under a full load of switches.">
            <TextField
              select size="small" label="Posts" value={feet.pattern}
              onChange={e => onFeet({ ...feet, pattern: e.target.value as FeetSettings['pattern'] })}
            >
              <MenuItem value="corners">Four corners</MenuItem>
              <MenuItem value="corners+edges">Corners and edges</MenuItem>
            </TextField>
          </HoverTooltip>
          <Typography variant="body2" color="text.secondary">
            {fittedFeet}/{wanted} posts fit
            {' · '}{tier === 'bottom'
              ? `the stacked build needs ${stackedMm.toFixed(1)} mm`
              : `the bottom build needs ${bottomMm.toFixed(1)} mm`}
          </Typography>
          <Tooltip title="Export the posts as their own body (welded to the plate by a 0.05 mm overlap). STL comes out as a zip, 3MF as a multi-object model — assign the posts a second filament in the slicer.">
            <FormControlLabel
              control={
                <Switch
                  size="small" checked={!!feet.separate}
                  onChange={e => onFeet({ ...feet, separate: e.target.checked })}
                />
              }
              label="Separate body (2nd colour)"
            />
          </Tooltip>
        </>
      )}

      <Stack spacing={0.5}>
        <Typography variant="body2">
          {budget.tierPitchMm.toFixed(1)} mm per tier
        </Typography>
        <Typography variant="body2" color="text.secondary">
          That is the switch&rsquo;s own {(design.switch.flangeToTopMm + design.switch.flangeToTipMm).toFixed(1)} mm
          height plus clearance, whatever the plate does — a thinner plate saves
          filament, never height.
        </Typography>
        {budget.clearHeightMm !== null && budget.tiers !== null && (
          <>
            <LinearProgress
              variant="determinate"
              value={Math.min(100,
                ((budget.stackHeightMm ?? 0) / budget.clearHeightMm) * 100)}
              sx={{ my: 0.5 }}
            />
            <Typography variant="body2">
              {budget.tiers === 0
                ? `One tray does not fit the ${budget.clearHeightMm} mm of clear height.`
                : `${budget.tiers} tray${budget.tiers === 1 ? '' : 's'} fit — `
                  + `${(budget.stackHeightMm ?? 0).toFixed(1)} of ${budget.clearHeightMm} mm`}
            </Typography>
            {budget.tiers !== null && budget.tiers > 1 && (
              <Typography variant="body2" color="text.secondary">
                That is one bottom tray ({bottomMm.toFixed(1)} mm posts) and{' '}
                {budget.tiers - 1} stacked ({stackedMm.toFixed(1)} mm) — export each build once.
              </Typography>
            )}
            {budget.nextTierHeightMm !== null && budget.tiers > 0 && (
              <Typography variant="body2" color="text.secondary">
                One more would need {budget.nextTierHeightMm.toFixed(1)} mm.
                {withLid !== null && budget.nextTierHeightMm <= withLid
                  && ` It would fit the ${withLid} mm to the closed lid, but the lid&rsquo;s`
                     + ' recess is inset from the case walls, so a full-width tray cannot use it.'}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {plan.cells.length * Math.max(1, budget.tiers)} switches in the case.
            </Typography>
          </>
        )}
        <Tooltip title="Usable height in the case's base cavity. The Systainer presets carry 48 mm — Festool publish 258 x 164 x 67 mm internal, the rest of that 67 being the lid's own recess, which is inset from the walls. Still a retailer's figure rather than a caliper reading, so measure yours and put the real number here.">
          <span>
            <LengthField
              label="Case clear height"
              imperial={imperial}
              valueMm={budget.clearHeightMm ?? 48}
              onChangeMm={v => onDesign(d => ({ ...d, caseClearHeightMm: v }))}
            />
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  )
}
