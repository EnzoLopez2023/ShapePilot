// One maintenance job: how it stands, and the procedure, and the way to record
// having done it.
//
// Collapsed the card is a status line you can scan twelve of. Opened it is the
// wiki procedure, condensed -- because the moment you need the steps is the
// moment you have decided to do the job, and sending you to a browser tab at
// that point is how a maintenance page stops being used.
//
// "Log this service" takes a date rather than assuming today. Maintenance is
// recorded after the fact at least as often as during it, and a log that can
// only say "now" gets filled in with wrong dates or not at all.
import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import type { TaskStanding } from '../model/schedule.ts'
import { STATUS_STYLE, formatDay } from './statusStyle.ts'

export interface TaskCardProps {
  standing: TaskStanding
  today: string
  commissionedOn: string
  busy: boolean
  onLog: (taskKey: string, performedOn: string, note: string) => void
}

export function TaskCard({ standing, today, commissionedOn, busy, onLog }: TaskCardProps) {
  const [open, setOpen] = useState(false)
  const [logging, setLogging] = useState(false)
  const [performedOn, setPerformedOn] = useState(today)
  const [note, setNote] = useState('')

  const { task, lastDone } = standing
  const style = STATUS_STYLE[standing.status]
  const panelId = `task-${task.key}-detail`

  const submit = () => {
    onLog(task.key, performedOn, note)
    setLogging(false)
    setNote('')
    setPerformedOn(today)
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: '14px',
        overflow: 'hidden',
        // Overdue jobs carry a coloured edge so the list is scannable without
        // reading a single chip.
        borderLeft: 4,
        borderLeftColor: standing.needsAttention ? style.dot : 'transparent',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        sx={{
          appearance: 'none',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          p: { xs: 1.5, sm: 2 },
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.25 }}
          >
            <Typography component="h3" sx={{ fontWeight: 650, fontSize: '0.9375rem' }}>
              {task.title}
            </Typography>
            <Chip
              size="small"
              label={style.label}
              color={style.color === 'default' ? undefined : style.color}
              variant={standing.needsAttention ? 'filled' : 'outlined'}
              sx={{ height: 20, fontSize: '0.6875rem' }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {standing.detail}
            {standing.dueOn && standing.status !== 'overdue' && (
              <> · {formatDay(standing.dueOn)}</>
            )}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: '0.75rem', mt: 0.25 }}
          >
            {standing.cadence}
            {lastDone
              ? <> · Last done {formatDay(lastDone.performedOn)}</>
              : <> · Never logged</>}
          </Typography>
        </Box>
        <ExpandMoreRoundedIcon
          aria-hidden
          sx={{
            flexShrink: 0,
            mt: 0.25,
            color: 'text.secondary',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease-in-out',
          }}
        />
      </Box>

      <Collapse in={open} unmountOnExit>
        <Divider />
        <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 2 } }} id={panelId}>
          <Typography variant="body2" color="text.secondary">{task.summary}</Typography>

          {task.cautions?.map(caution => (
            <Alert key={caution} severity="warning" sx={{ py: 0.5 }}>
              <Typography variant="body2">{caution}</Typography>
            </Alert>
          ))}

          <Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: 650, mb: 0.75 }}
              id={`${panelId}-steps`}
            >
              Procedure
            </Typography>
            <Stack
              component="ol"
              aria-labelledby={`${panelId}-steps`}
              spacing={0.75}
              sx={{ m: 0, pl: 2.5 }}
            >
              {task.steps.map(step => (
                <Typography key={step} component="li" variant="body2">{step}</Typography>
              ))}
            </Stack>
          </Box>

          {task.supplies.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.75 }}>
                What you need
              </Typography>
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                {task.supplies.map(supply => (
                  <Chip key={supply} size="small" variant="outlined" label={supply} />
                ))}
              </Stack>
            </Box>
          )}

          <Divider />

          {logging ? (
            <Stack spacing={1.5}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  size="small"
                  type="date"
                  label="Date done"
                  value={performedOn}
                  onChange={event => setPerformedOn(event.target.value)}
                  // Not before the printer existed, and not in the future --
                  // the same two bounds the server enforces, said here so the
                  // picker will not offer a date the save would reject.
                  slotProps={{ htmlInput: { min: commissionedOn, max: today } }}
                  sx={{ minWidth: 170 }}
                />
                <TextField
                  size="small"
                  label="Note (optional)"
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="Anything worth remembering next time"
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                  sx={{ flex: 1 }}
                />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy || !performedOn}
                  onClick={submit}
                >
                  Save to the log
                </Button>
                <Button size="small" onClick={() => setLogging(false)}>Cancel</Button>
              </Stack>
            </Stack>
          ) : (
            <Stack
              direction="row"
              sx={{ gap: 1, alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Button variant="outlined" size="small" onClick={() => setLogging(true)}>
                Log this service
              </Button>
              <IconButton
                component={Link}
                href={task.source}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                aria-label={`Open the Bambu Lab wiki for ${task.title}`}
                sx={{ borderRadius: '10px' }}
              >
                <OpenInNewRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Paper>
  )
}
