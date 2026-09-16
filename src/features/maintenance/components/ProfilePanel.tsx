// How this printer is worked -- the four facts every due date is computed from.
//
// The same component does first-run setup and later edits, because they are the
// same four fields and a separate one-shot wizard would be a second form to
// keep in step. What differs is the framing: with no profile yet the panel is
// the only thing on the page and says why it is asking; afterwards it is a
// collapsed summary line you open when the answer changes.
//
// Nothing is guessed. A printer's commissioning date is not derivable from
// anything we hold, and a calendar counted from a date we invented would be
// confidently wrong -- so the page asks, once, and schedules nothing until it
// has an answer.
import { useState } from 'react'
import {
  Box,
  Button,
  Collapse,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  FILAMENT_WEARS, USAGE_TIERS,
} from '../../../../lib/contracts/x2dMaintenance.ts'
import type { FilamentWear, UsageTier } from '../../../../lib/contracts/x2dMaintenance.ts'
import type { MaintenanceProfile } from '../model/schedule.ts'
import { formatDay } from './statusStyle.ts'

export interface ProfilePanelProps {
  profile: MaintenanceProfile | null
  today: string
  busy: boolean
  onSave: (profile: MaintenanceProfile) => void
  /**
   * Add one roll to the cutter count. Present only once a profile exists --
   * the count is the one field here you touch between services rather than
   * when something changes, and opening a four-field form to type 7 instead of
   * 6 is the kind of friction that makes a counter stop being kept.
   */
  onAddRoll?: () => void
}

const EARLIEST = '2015-01-01'

export function ProfilePanel(
  { profile, today, busy, onSave, onAddRoll }: ProfilePanelProps,
) {
  const [open, setOpen] = useState(false)
  const [commissionedOn, setCommissionedOn] = useState(profile?.commissionedOn ?? '')
  const [usageTier, setUsageTier] = useState<UsageTier>(profile?.usageTier ?? 'regular')
  const [filamentWear, setFilamentWear] = useState<FilamentWear>(
    profile?.filamentWear ?? 'standard')
  const [rollsUsed, setRollsUsed] = useState(String(profile?.rollsUsed ?? 0))

  const rolls = Number(rollsUsed)
  const rollsValid = Number.isInteger(rolls) && rolls >= 0 && rolls <= 100_000
  const dateValid = commissionedOn >= EARLIEST && commissionedOn <= today
  const canSave = dateValid && rollsValid && !busy

  const save = () => {
    onSave({ commissionedOn, usageTier, filamentWear, rollsUsed: rolls })
    setOpen(false)
  }

  /**
   * Re-seed the fields from the saved profile every time the panel opens.
   *
   * The roll count can change while the panel is shut -- "+1 roll" writes
   * straight through -- so form state initialised at mount goes stale. Syncing
   * on open rather than in an effect keeps the editing session stable: a save
   * landing mid-edit must not overwrite what is under the cursor.
   */
  const toggle = () => {
    setOpen(previous => {
      if (!previous && profile) {
        setCommissionedOn(profile.commissionedOn)
        setUsageTier(profile.usageTier)
        setFilamentWear(profile.filamentWear)
        setRollsUsed(String(profile.rollsUsed))
      }
      return !previous
    })
  }

  const fields = (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          size="small"
          type="date"
          label="First used"
          value={commissionedOn}
          onChange={event => setCommissionedOn(event.target.value)}
          error={commissionedOn !== '' && !dateValid}
          helperText="The day the printer entered service"
          slotProps={{ htmlInput: { min: EARLIEST, max: today }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          select
          label="How hard it works"
          value={usageTier}
          onChange={event => setUsageTier(event.target.value as UsageTier)}
          helperText="Sets the axis intervals"
          sx={{ minWidth: 200 }}
        >
          {USAGE_TIERS.map(tier => (
            <MenuItem key={tier.tier} value={tier.tier}>
              {tier.label} — {tier.detail}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          size="small"
          select
          label="Mostly printing"
          value={filamentWear}
          onChange={event => setFilamentWear(event.target.value as FilamentWear)}
          helperText="Sets how often the cutter is checked"
          sx={{ minWidth: 200 }}
        >
          {FILAMENT_WEARS.map(wear => (
            <MenuItem key={wear.wear} value={wear.wear}>
              {wear.label} — {wear.detail}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="number"
          label="Rolls since the blade was checked"
          value={rollsUsed}
          onChange={event => setRollsUsed(event.target.value)}
          error={!rollsValid}
          helperText="Reset to 0 when you log a cutter check"
          slotProps={{ htmlInput: { min: 0, max: 100_000, step: 1 } }}
          sx={{ minWidth: 180 }}
        />
      </Stack>
    </Stack>
  )

  // First run: no profile, so nothing else on the page can mean anything yet.
  if (!profile) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: '14px', p: { xs: 2, sm: 2.5 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography component="h2" sx={{ fontWeight: 650, fontSize: '1rem' }}>
              When did this printer enter service?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Every date on the calendar is counted from that day, so the schedule starts
              once you answer. Nothing else here is guessed either — you can change all
              four whenever they change.
            </Typography>
          </Box>
          {fields}
          <Box>
            <Button variant="contained" disabled={!canSave} onClick={save}>
              Start the calendar
            </Button>
          </Box>
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px' }}>
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
          p: { xs: 1.5, sm: 2 },
        }}
      >
        <Typography variant="body2" color="text.secondary">
          In service since {formatDay(profile.commissionedOn)}
          {' · '}
          {USAGE_TIERS.find(tier => tier.tier === profile.usageTier)?.label} use
          {' · '}
          {FILAMENT_WEARS.find(wear => wear.wear === profile.filamentWear)?.label} filament
          {' · '}
          {profile.rollsUsed} {profile.rollsUsed === 1 ? 'roll' : 'rolls'} on the blade
        </Typography>
        <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
          {onAddRoll && (
            <Button size="small" variant="outlined" disabled={busy} onClick={onAddRoll}>
              +1 roll
            </Button>
          )}
          <Button
            size="small"
            onClick={toggle}
            aria-expanded={open}
          >
            {open ? 'Close' : 'Edit'}
          </Button>
        </Stack>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={2} sx={{ px: { xs: 1.5, sm: 2 }, pb: { xs: 1.5, sm: 2 } }}>
          {fields}
          <Box>
            <Button variant="contained" size="small" disabled={!canSave} onClick={save}>
              Save
            </Button>
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  )
}
