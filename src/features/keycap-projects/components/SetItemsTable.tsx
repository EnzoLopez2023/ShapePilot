// The keycap set, edited as line items.
//
// One row per distinct cap. Rows are grouped by their `group` field for
// reading, but edited in place: a table that reorders itself while someone is
// typing in it is a table nobody trusts.
import { useEffect, useState } from 'react'
import { Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeRounded'
import { KEY_SIZES } from '../../keycap-tray/model/presets.ts'
import type { SetItem } from '../model/types.ts'
import { groupItems } from '../model/summary.ts'

export interface SetItemsTableProps {
  items: SetItem[]
  onChange: (items: SetItem[]) => void
}

/** The palette's own vocabulary, so a project and a tray speak of the same
 *  sizes. Widths outside it are still accepted -- an existing row keeps its
 *  value and the field shows it. */
const SIZE_OPTIONS = KEY_SIZES.map(s => ({ units: s.units, label: s.label }))

// The legend is the field a person reads the row by, so it gets the wider
// share of what is left after the fixed-width controls.
const ROW_COLUMNS = 'minmax(0, 1.6fr) 104px 92px 76px minmax(0, 1fr) 40px'

/**
 * A count that can be emptied while it is being retyped.
 *
 * Clamping on every keystroke means the field can never be cleared: deleting
 * "34" writes 1, and the next digit lands after it. So the text is local while
 * someone is typing, and only a value that parses is committed; an empty or
 * nonsense field falls back to the last good number when focus leaves.
 */
function QuantityField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  // Follows the row when the value changes from elsewhere -- applying a
  // proposal, for instance -- without fighting what is being typed.
  useEffect(() => { setText(String(value)) }, [value])

  return (
    <TextField
      size="small" label="Qty" type="number" value={text}
      onChange={e => {
        setText(e.target.value)
        const parsed = Math.round(Number(e.target.value))
        if (e.target.value !== '' && Number.isFinite(parsed) && parsed >= 1) {
          onChange(Math.min(999, parsed))
        }
      }}
      onBlur={() => setText(String(value))}
      slotProps={{ htmlInput: { min: 1, max: 999 } }}
    />
  )
}

export default function SetItemsTable({ items, onChange }: SetItemsTableProps) {
  const replace = (index: number, patch: Partial<SetItem>) =>
    onChange(items.map((item, i) => (i === index
      // Editing a row the model proposed makes it the person's row.
      ? { ...item, ...patch, source: 'manual' as const }
      : item)))

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index))

  const add = () => onChange([...items, { units: 1, count: 1, source: 'manual' }])

  // Rendered flat but labelled by group, so the indices stay the real ones and
  // an edit never lands on the wrong row.
  const grouped = groupItems(items)
  const indexOf = new Map(items.map((item, index) => [item, index]))

  return (
    <Stack spacing={1}>
      {!items.length && (
        <Typography variant="body2" color="text.secondary">
          No caps yet. Add a row, or upload photos of the set and let the assistant read it.
        </Typography>
      )}

      {grouped.map(({ group, items: rows }) => (
        <Box key={group}>
          <Typography variant="h3" component="h3" sx={{ mb: 0.5 }}>{group}</Typography>
          <Stack spacing={0.5}>
            {rows.map(item => {
              const index = indexOf.get(item) ?? 0
              return (
                <Box
                  key={index}
                  sx={{
                    display: 'grid',
                    gap: 0.75,
                    gridTemplateColumns: { xs: '1fr 1fr', sm: ROW_COLUMNS },
                    alignItems: 'center',
                    // A row is one line on a wide screen, so where it starts and
                    // ends is obvious. Wrapped onto three lines it is not, and
                    // six identical fields in a column read as one blur -- hence
                    // a rule under each row, but only where it wraps.
                    pb: { xs: 1, sm: 0 },
                    borderBottom: { xs: 1, sm: 0 },
                    borderColor: { xs: 'divider', sm: 'transparent' },
                  }}
                >
                  <TextField
                    size="small" label="Legend" value={item.legend ?? ''}
                    onChange={e => replace(index, { legend: e.target.value || undefined })}
                    slotProps={{ input: {
                      startAdornment: item.source === 'photo'
                        ? (
                          <Tooltip title="Read from a photo — check it and edit if it is wrong.">
                            <AutoAwesomeIcon
                              fontSize="small"
                              sx={{ mr: 0.75, color: 'text.secondary' }}
                            />
                          </Tooltip>
                        )
                        : undefined,
                    } }}
                  />
                  <TextField
                    select size="small" label="Size" value={item.units}
                    onChange={e => replace(index, { units: parseFloat(e.target.value) })}
                  >
                    {SIZE_OPTIONS.map(s => (
                      <MenuItem key={s.units} value={s.units}>{s.label}</MenuItem>
                    ))}
                    {!SIZE_OPTIONS.some(s => s.units === item.units) && (
                      <MenuItem value={item.units}>{item.units}u</MenuItem>
                    )}
                  </TextField>
                  <TextField
                    select size="small" label="Shape"
                    value={item.shape === 'iso-enter' ? 'iso-enter' : 'rect'}
                    onChange={e => replace(index, {
                      shape: e.target.value === 'iso-enter' ? 'iso-enter' : undefined,
                    })}
                  >
                    <MenuItem value="rect">Rect</MenuItem>
                    <MenuItem value="iso-enter">ISO</MenuItem>
                  </TextField>
                  <QuantityField
                    value={item.count ?? 1}
                    onChange={count => replace(index, { count })}
                  />
                  <TextField
                    size="small" label="Group" value={item.group ?? ''}
                    onChange={e => replace(index, { group: e.target.value || undefined })}
                  />
                  <IconButton
                    size="small"
                    aria-label={`Remove ${item.legend || `${item.units}u cap`}`}
                    onClick={() => remove(index)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              )
            })}
          </Stack>
        </Box>
      ))}

      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={add}>Add a row</Button>
      </Box>
    </Stack>
  )
}
