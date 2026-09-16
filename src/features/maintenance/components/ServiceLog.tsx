// What has actually been done to this printer, newest first.
//
// The calendar answers "what is due"; this answers "what did I do, and when".
// They are different questions and the second one is the one that survives a
// resale, a warranty claim, or a print that suddenly started warping.
//
// Deleting is for a mis-logged date, not for tidying. It asks first, because an
// undo that silently removes a service record is worse than the typo.
import { useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  IconButton, Paper, Stack, Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { maintenanceTaskByKey } from '../../../../lib/contracts/x2dMaintenance.ts'
import type { MaintenanceEvent } from '../model/schedule.ts'
import { formatDay } from './statusStyle.ts'

export interface ServiceLogProps {
  events: readonly MaintenanceEvent[]
  busy: boolean
  onDelete: (id: number) => void
}

export function ServiceLog({ events, busy, onDelete }: ServiceLogProps) {
  const [pending, setPending] = useState<MaintenanceEvent | null>(null)

  if (events.length === 0) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5 }}>
        <Typography variant="body2" color="text.secondary">
          Nothing logged yet. Open a job above and record it once you have done it —
          the calendar counts from the last entry here.
        </Typography>
      </Paper>
    )
  }

  const confirm = () => {
    if (pending) onDelete(pending.id)
    setPending(null)
  }

  return (
    <>
      <Paper variant="outlined" sx={{ borderRadius: '14px', overflow: 'hidden' }}>
        <Stack divider={<Divider />}>
          {events.map(event => {
            // A key can outlive its catalogue entry if a task is ever retired.
            // The row still has to render: it is history, and history does not
            // stop being true because the catalogue moved on.
            const task = maintenanceTaskByKey(event.taskKey)
            return (
              <Stack
                key={event.id}
                direction="row"
                sx={{ alignItems: 'flex-start', gap: 1, p: { xs: 1.5, sm: 2 } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {task?.title ?? event.taskKey}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDay(event.performedOn)}
                  </Typography>
                  {event.note && (
                    <Typography
                      variant="body2"
                      sx={{ mt: 0.5, fontStyle: 'italic', color: 'text.secondary' }}
                    >
                      {event.note}
                    </Typography>
                  )}
                </Box>
                <IconButton
                  size="small"
                  disabled={busy}
                  onClick={() => setPending(event)}
                  aria-label={`Remove the ${task?.title ?? event.taskKey} entry from `
                    + `${formatDay(event.performedOn)}`}
                  sx={{ borderRadius: '10px' }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            )
          })}
        </Stack>
      </Paper>

      <Dialog open={pending !== null} onClose={() => setPending(null)}>
        <DialogTitle>Remove this entry?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {pending && (
              <>
                {maintenanceTaskByKey(pending.taskKey)?.title ?? pending.taskKey}
                {', '}
                {formatDay(pending.performedOn)}. The calendar will go back to counting
                from whatever was logged before it.
              </>
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={confirm}>Remove</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
