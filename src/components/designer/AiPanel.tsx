// The assistant's conversation surface. A proposal is shown with what it would
// change and is applied only on request -- never automatically.
import { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Stack, TextField, Typography,
} from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import type { ChatTurn } from '../../model/document.ts'
import type { Proposal } from './useAiDesigner.ts'

export interface AiPanelProps {
  available: boolean | null
  busy: boolean
  error: string | null
  proposal: Proposal | null
  turns: ChatTurn[]
  placeholder: string
  onSend: (prompt: string) => void
  onApply: () => void
  onDiscard: () => void
  onDismissError: () => void
}

export default function AiPanel(props: AiPanelProps) {
  const {
    available, busy, error, proposal, turns, placeholder,
    onSend, onApply, onDiscard, onDismissError,
  } = props
  const [draft, setDraft] = useState('')

  const submit = () => {
    const prompt = draft.trim()
    if (!prompt || busy) return
    onSend(prompt)
    setDraft('')
  }

  if (available === false) {
    return (
      <Alert severity="info" variant="outlined">
        The design assistant is not configured for this deployment.
      </Alert>
    )
  }

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0 }}>
      {turns.length > 0 && (
        <Stack spacing={1} sx={{ maxHeight: 260, overflowY: 'auto' }}>
          {turns.map(turn => (
            <Box key={turn.id}>
              <Typography
                variant="body2"
                sx={{ color: turn.role === 'user' ? 'text.primary' : 'text.secondary' }}
              >
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {turn.role === 'user' ? 'You' : 'Assistant'}:{' '}
                </Box>
                {turn.text}
              </Typography>
              {turn.summary && (
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                  {turn.summary}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}

      {proposal && (
        <>
          <Divider />
          <Stack spacing={1}>
            <Typography variant="h3">Proposed change</Typography>
            <Typography variant="body2">{proposal.notes}</Typography>
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
              {proposal.diff.added.map(n => (
                <Chip key={`a${n}`} size="small" color="success" variant="outlined" label={`+ ${n}`} />
              ))}
              {proposal.diff.modified.map(n => (
                <Chip key={`m${n}`} size="small" color="warning" variant="outlined" label={`~ ${n}`} />
              ))}
              {proposal.diff.removed.map(n => (
                <Chip key={`r${n}`} size="small" color="error" variant="outlined" label={`− ${n}`} />
              ))}
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Shown in the viewport as a preview. Applying is one undo step.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" onClick={onApply}>Apply</Button>
              <Button size="small" onClick={onDiscard}>Discard</Button>
            </Stack>
          </Stack>
          <Divider />
        </>
      )}

      {error && (
        <Alert severity="error" variant="outlined" onClose={onDismissError}>{error}</Alert>
      )}

      <TextField
        multiline
        minRows={2}
        size="small"
        label="Describe what you want"
        placeholder={placeholder}
        value={draft}
        disabled={busy || available === null}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          // Enter sends; Shift+Enter is a newline, the convention for a
          // composer that mostly takes one-liners.
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
      />
      <Button
        variant="contained"
        size="small"
        disabled={busy || !draft.trim() || available === null}
        startIcon={busy ? <CircularProgress size={14} /> : <AutoAwesomeRoundedIcon />}
        onClick={submit}
      >
        {busy ? 'Designing…' : 'Send'}
      </Button>
    </Stack>
  )
}
