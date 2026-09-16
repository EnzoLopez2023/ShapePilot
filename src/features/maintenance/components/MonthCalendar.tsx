// The calendar itself: six weeks of days, with the dated jobs sitting on the
// days they fall due.
//
// Only the dated jobs appear here. A cutter blade due "in 6 more rolls" and a
// PTFE tube due "when it starts to slide" have no day to sit on, and putting
// them on one would be inventing a date the printer never gave us. They live in
// their own lists on the page instead.
//
// Every day is a button, including the empty ones. A grid where only some cells
// are focusable is a grid you cannot walk through with a keyboard, and the
// empty days are exactly the ones you click when logging a service you did last
// Tuesday.
import { Box, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { CalendarDay } from '../model/schedule.ts'
import { STATUS_STYLE, formatDay } from './statusStyle.ts'

/** Monday first: this is a workshop calendar, and the week starts at work. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface MonthCalendarProps {
  days: readonly CalendarDay[]
  selected: string | null
  onSelect: (date: string) => void
}

/** What a day announces to a screen reader, which cannot see the dots. */
function dayLabel(day: CalendarDay): string {
  const date = formatDay(day.date)
  if (day.due.length === 0) return day.isToday ? `${date}, today` : date
  const jobs = day.due.map(standing => standing.task.title).join(', ')
  return `${date}${day.isToday ? ', today' : ''}: ${day.due.length === 1 ? 'due' : `${day.due.length} due`} — ${jobs}`
}

export function MonthCalendar({ days, selected, onSelect }: MonthCalendarProps) {
  const theme = useTheme()

  return (
    <Box>
      <Box
        aria-hidden
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {WEEKDAYS.map(name => (
          <Typography
            key={name}
            variant="body2"
            sx={{
              textAlign: 'center',
              color: 'text.secondary',
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {/* One letter on a phone: seven three-letter headings do not fit
                across 375px without the columns going narrower than a tap. */}
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{name}</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{name[0]}</Box>
          </Typography>
        ))}
      </Box>

      <Box
        role="grid"
        aria-label="Maintenance calendar"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 0.5,
        }}
      >
        {days.map(day => {
          const isSelected = day.date === selected
          return (
            <Box
              key={day.date}
              role="gridcell"
              component="button"
              type="button"
              aria-label={dayLabel(day)}
              aria-current={day.isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              onClick={() => onSelect(day.date)}
              sx={{
                appearance: 'none',
                font: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.25,
                minHeight: { xs: 44, sm: 56 },
                py: 0.75,
                px: 0.25,
                borderRadius: '10px',
                border: isSelected
                  ? `2px solid ${theme.palette.primary.main}`
                  : `1px solid ${theme.palette.divider}`,
                // The selected cell already carries a 2px border; the extra
                // pixel comes off the padding so the grid does not shift.
                p: isSelected ? 'calc(0.375rem - 1px) calc(0.125rem - 1px)' : undefined,
                bgcolor: day.isToday ? 'action.selected' : 'transparent',
                // A day outside this month is context, not content. Dimmed
                // rather than blanked, because a job can fall due on one.
                opacity: day.inMonth ? 1 : 0.45,
                color: day.isPast && day.inMonth ? 'text.secondary' : 'text.primary',
                transition: 'background 0.15s ease-in-out',
                '&:hover': { bgcolor: 'action.hover' },
                '&:focus-visible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                component="span"
                sx={{
                  fontSize: '0.8125rem',
                  fontWeight: day.isToday ? 700 : 500,
                  lineHeight: 1,
                }}
              >
                {day.dayOfMonth}
              </Box>
              {/* Dots, capped at three with a "+n" beyond: four 6px dots do not
                  fit across a phone-width cell, and the count is what matters
                  once there are that many. */}
              <Stack
                direction="row"
                aria-hidden
                sx={{ gap: '3px', alignItems: 'center', minHeight: 6 }}
              >
                {day.due.slice(0, 3).map(standing => (
                  <Box
                    key={standing.task.key}
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: STATUS_STYLE[standing.status].dot,
                    }}
                  />
                ))}
                {day.due.length > 3 && (
                  <Box component="span" sx={{ fontSize: '0.5625rem', color: 'text.secondary' }}>
                    +{day.due.length - 3}
                  </Box>
                )}
              </Stack>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
