// The X2D maintenance calendar.
//
// Three views of one service log, in the order you need them: what is due now,
// where the rest falls on a calendar, and the whole catalogue of jobs with the
// procedure inside each. The log itself is at the bottom, because reading it is
// the rarest of the four things you come here to do.
//
// Everything is derived. The only stored facts are the profile and the dated
// entries; every due date, every dot on the grid and every "36 days overdue" is
// recomputed from those by model/schedule.ts. There is no stored "next due"
// column to fall out of step when you change how hard the printer works.
//
// Writes are not optimistic, unlike the filament page's ticks. A tick that
// lands a moment later is invisible; a service record that silently failed to
// save is a maintenance history with a hole in it, so the page waits for the
// server and says so if the write does not land.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Paper, Stack, Typography,
} from '@mui/material'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { MAINTENANCE_GROUPS } from '../../../lib/contracts/x2dMaintenance.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { MonthCalendar } from './components/MonthCalendar.tsx'
import { ProfilePanel } from './components/ProfilePanel.tsx'
import RecordedRuntime from './components/RecordedRuntime.tsx'
import { ServiceLog } from './components/ServiceLog.tsx'
import { TaskCard } from './components/TaskCard.tsx'
import { STATUS_STYLE, formatDay, formatMonth } from './components/statusStyle.ts'
import {
  attentionOf, daysBetween, monthGrid, scheduleFor, shiftMonth, todayLocal,
} from './model/schedule.ts'
import type { MaintenanceEvent, MaintenanceProfile } from './model/schedule.ts'
import {
  deleteService, getMaintenance, logService, saveProfile,
} from './service.ts'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The maintenance log could not be reached.'

const plural = (count: number, one: string): string =>
  `${count} ${count === 1 ? one : `${one}s`}`

export default function MaintenancePage() {
  // Sampled once per mount. A page that recomputed "today" on every render
  // would silently reclassify jobs at midnight under a reader's cursor.
  const [today] = useState(() => todayLocal())
  const [profile, setProfile] = useState<MaintenanceProfile | null>(null)
  const [events, setEvents] = useState<MaintenanceEvent[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7))
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    let cancelled = false
    void getMaintenance()
      .then(record => {
        if (cancelled) return
        setProfile(record.profile)
        setEvents(record.events)
      })
      .catch(error => { if (!cancelled) setLoadError(messageOf(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  /** Every write goes through here, so one failure path covers all three. */
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setWriteError(null)
    try {
      await work()
    } catch (error) {
      setWriteError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const onSaveProfile = useCallback((next: MaintenanceProfile) => {
    void run(async () => { setProfile(await saveProfile(next)) })
  }, [run])

  const onAddRoll = useCallback(() => {
    if (!profile) return
    void run(async () => {
      setProfile(await saveProfile({ ...profile, rollsUsed: profile.rollsUsed + 1 }))
    })
  }, [profile, run])

  const onLog = useCallback((taskKey: string, performedOn: string, note: string) => {
    void run(async () => {
      const event = await logService({ taskKey, performedOn, note })
      setEvents(previous => [event, ...(previous ?? [])]
        .sort((a, b) => (a.performedOn === b.performedOn
          ? b.id - a.id
          : b.performedOn.localeCompare(a.performedOn))))
      // Checking the blade is what the roll count counts up to, so logging the
      // check is what resets it. Leaving the reader to zero it by hand would
      // leave the cutter permanently reading as due.
      if (taskKey === 'filament-cutter-blade' && profile && profile.rollsUsed > 0) {
        setProfile(await saveProfile({ ...profile, rollsUsed: 0 }))
      }
    })
  }, [profile, run])

  const onDelete = useCallback((id: number) => {
    void run(async () => {
      await deleteService(id)
      setEvents(previous => (previous ?? []).filter(event => event.id !== id))
    })
  }, [run])

  const schedule = useMemo(
    () => (profile && events ? scheduleFor(profile, events, today) : []),
    [profile, events, today])

  const attention = useMemo(() => attentionOf(schedule), [schedule])
  const days = useMemo(() => monthGrid(month, schedule, today), [month, schedule, today])

  const selectedDay = useMemo(
    () => days.find(day => day.date === selected) ?? null, [days, selected])

  const watching = schedule.filter(standing => standing.status === 'watch')

  if (loadError) return <ErrorState message={loadError} onRetry={load} />
  if (!events) return <LoadingState label="Loading your maintenance log…" />

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1000, width: '100%' }}>
      <Box>
        <Typography variant="h1" component="h1">X2D maintenance</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Bambu Lab’s own schedule, counted from the day your printer entered service.
          Every interval says whose it is — four come from the wiki, the rest are ours.
        </Typography>
      </Box>

      {writeError && (
        <Alert severity="warning" onClose={() => setWriteError(null)}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Not saved</Typography>
          <Typography variant="body2">{writeError}</Typography>
        </Alert>
      )}

      <RecordedRuntime />

      <ProfilePanel
        profile={profile}
        today={today}
        busy={busy}
        onSave={onSaveProfile}
        onAddRoll={profile ? onAddRoll : undefined}
      />

      {profile && (
        <>
          <Paper variant="outlined" sx={{ borderRadius: '14px', p: { xs: 1.5, sm: 2 } }}>
            <Typography component="h2" sx={{ fontWeight: 650, fontSize: '1rem', mb: 1 }}>
              {attention.length === 0
                ? 'Nothing is due'
                : `${plural(attention.length, 'job')} to do`}
            </Typography>
            {attention.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                The printer is up to date. The next job falls due{' '}
                {nextDueSentence(schedule, today)}.
              </Typography>
            ) : (
              <Stack sx={{ gap: 0.5 }}>
                {attention.map(standing => (
                  <Stack
                    key={standing.task.key}
                    direction="row"
                    sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: STATUS_STYLE[standing.status].dot,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {standing.task.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {standing.detail}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: '14px', p: { xs: 1.5, sm: 2 } }}>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}
            >
              <IconButton
                size="small"
                aria-label="Previous month"
                onClick={() => setMonth(previous => shiftMonth(previous, -1))}
                sx={{ borderRadius: '10px' }}
              >
                <ChevronLeftRoundedIcon />
              </IconButton>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Typography component="h2" sx={{ fontWeight: 650, fontSize: '1rem' }}>
                  {formatMonth(month)}
                </Typography>
                {month !== today.slice(0, 7) && (
                  <Button size="small" onClick={() => setMonth(today.slice(0, 7))}>
                    Today
                  </Button>
                )}
              </Stack>
              <IconButton
                size="small"
                aria-label="Next month"
                onClick={() => setMonth(previous => shiftMonth(previous, 1))}
                sx={{ borderRadius: '10px' }}
              >
                <ChevronRightRoundedIcon />
              </IconButton>
            </Stack>

            <MonthCalendar days={days} selected={selected} onSelect={setSelected} />

            {selectedDay && (
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>
                  {formatDay(selectedDay.date)}
                </Typography>
                {selectedDay.due.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Nothing falls due on this day.
                  </Typography>
                ) : (
                  <Stack sx={{ gap: 0.5 }}>
                    {selectedDay.due.map(standing => (
                      <Stack
                        key={standing.task.key}
                        direction="row"
                        sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          label={STATUS_STYLE[standing.status].label}
                          color={STATUS_STYLE[standing.status].color === 'default'
                            ? undefined
                            : STATUS_STYLE[standing.status].color}
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.6875rem' }}
                        />
                        <Typography variant="body2">{standing.task.title}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {/* The grid shows dated jobs only. Saying so beats letting someone
                conclude the cutter and the PTFE tube were forgotten. */}
            {watching.length > 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.5, fontSize: '0.75rem' }}
              >
                {plural(watching.length, 'job')} below have no date at all — they are
                replaced when a symptom appears, not on a schedule.
              </Typography>
            )}
          </Paper>

          {MAINTENANCE_GROUPS.map(({ group, label }) => {
            const inGroup = schedule.filter(standing => standing.task.group === group)
            if (inGroup.length === 0) return null
            return (
              <Box key={group}>
                <Typography
                  component="h2"
                  sx={{ fontWeight: 650, fontSize: '0.8125rem', mb: 1, color: 'text.secondary',
                    textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  {label}
                </Typography>
                <Stack spacing={1}>
                  {inGroup.map(standing => (
                    <TaskCard
                      key={standing.task.key}
                      standing={standing}
                      today={today}
                      commissionedOn={profile.commissionedOn}
                      busy={busy}
                      onLog={onLog}
                    />
                  ))}
                </Stack>
              </Box>
            )
          })}

          <Box>
            <Typography
              component="h2"
              sx={{ fontWeight: 650, fontSize: '0.8125rem', mb: 1, color: 'text.secondary',
                textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              Service log
            </Typography>
            <ServiceLog events={events} busy={busy} onDelete={onDelete} />
          </Box>
        </>
      )}
    </Stack>
  )
}

/** "in 9 days, on 24 Sep 2026" — the sentence that follows "nothing is due". */
function nextDueSentence(
  schedule: readonly { dueOn: string | null }[], today: string,
): string {
  const upcoming = schedule
    .map(standing => standing.dueOn)
    .filter((date): date is string => date !== null && date >= today)
    .sort()
  if (upcoming.length === 0) return 'once you log your first service'
  const days = daysBetween(today, upcoming[0])
  return `in ${plural(days, 'day')}, on ${formatDay(upcoming[0])}`
}
