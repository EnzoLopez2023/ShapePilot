// Reviewing what the assistant read off the photographs.
//
// The model proposes; it never writes. This is where a person sees the rows
// before they exist, the same rule the designers' AI panel follows: an answer
// is a proposal with a visible shape, applied in one step or discarded whole.
//
// Two ways to take it, because both are real: a set photographed in pieces is
// added to what is already there, and a set re-read after a bad first pass
// replaces it.
import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, Typography,
} from '@mui/material'
import type { KeycapSetResponse } from '../../../services/ai.ts'
import type { SetItem } from '../model/types.ts'
import { sizeLabel } from '../model/summary.ts'

export interface ExtractionReviewDialogProps {
  open: boolean
  /** Null while nothing has been read yet. */
  proposal: KeycapSetResponse | null
  /** What the project already holds, so "add" can be described honestly. */
  existingCount: number
  onApply: (items: SetItem[], mode: 'replace' | 'append', details: SetDetails) => void
  onClose: () => void
}

export interface SetDetails {
  setName?: string
  manufacturer?: string
  capProfile?: string
  colorway?: string
}

export default function ExtractionReviewDialog(props: ExtractionReviewDialogProps) {
  const { open, proposal, existingCount, onApply, onClose } = props
  const [applying, setApplying] = useState(false)

  const items: SetItem[] = proposal?.set.items ?? []
  // A proposal has no tray behind it yet, so this is the plain tally of what
  // was read -- not what has a home, which is the project page's question.
  const bySize = new Map<string, { label: string; count: number; units: number }>()
  for (const item of items) {
    const label = sizeLabel(item.units, item.heightUnits ?? 1, item.shape)
    const seen = bySize.get(label)
    if (seen) seen.count += item.count ?? 1
    else bySize.set(label, { label, count: item.count ?? 1, units: item.units })
  }
  const rows = [...bySize.values()].sort((a, b) => a.units - b.units)
  const totals = {
    caps: items.reduce((sum, i) => sum + (i.count ?? 1), 0),
    entries: items.length,
  }

  const apply = (mode: 'replace' | 'append') => {
    if (!proposal) return
    setApplying(true)
    onApply(items, mode, {
      setName: proposal.set.setName,
      manufacturer: proposal.set.manufacturer,
      capProfile: proposal.set.capProfile,
      colorway: proposal.set.colorway,
    })
    setApplying(false)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>What the photos say</DialogTitle>
      <DialogContent dividers>
        {!proposal
          ? <Typography variant="body2" color="text.secondary">Nothing to review.</Typography>
          : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {totals.caps} caps in {totals.entries} {totals.entries === 1 ? 'row' : 'rows'}
                {proposal.set.setName && ` · ${proposal.set.setName}`}
                {proposal.set.capProfile && ` · ${proposal.set.capProfile} profile`}
              </Typography>

              {proposal.notes && (
                // The model's own account of what it could not read is the most
                // useful thing on this screen, so it is not hidden behind a
                // disclosure.
                <Alert severity="info">{proposal.notes}</Alert>
              )}

              <Box>
                <Typography variant="h3" component="h2" sx={{ mb: 0.5 }}>Sizes</Typography>
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                  {rows.map(row => (
                    <Box
                      key={row.label}
                      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 1, py: 0.5 }}
                    >
                      <Typography variant="body2">{row.label} × {row.count}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>

              <Box>
                <Typography variant="h3" component="h2" sx={{ mb: 0.5 }}>Caps</Typography>
                <Box
                  component="ul"
                  sx={{
                    listStyle: 'none', m: 0, p: 0, maxHeight: 260, overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: 0.25,
                  }}
                >
                  {items.map((item, index) => (
                    <Typography key={index} component="li" variant="body2">
                      {item.legend || 'Blank'}
                      {' — '}
                      {sizeLabel(item.units, item.heightUnits ?? 1, item.shape)}
                      {(item.count ?? 1) > 1 && ` × ${item.count}`}
                    </Typography>
                  ))}
                </Box>
              </Box>

              <Typography variant="body2" color="text.secondary">
                Nothing is saved yet. Applying fills in the rows below, where you can
                correct anything before saving the project.
              </Typography>
            </Stack>
          )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Discard</Button>
        {existingCount > 0 && (
          <Button disabled={!proposal || applying} onClick={() => apply('append')}>
            Add to the {existingCount} existing
          </Button>
        )}
        <Button
          variant="contained"
          disabled={!proposal || applying}
          onClick={() => apply('replace')}
        >
          {existingCount > 0 ? 'Replace the list' : 'Use these caps'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
