// The document's name, editable where you read it.
//
// `rename` has been on the document hook since the designers were split out,
// wired to nothing: the only way to name a design was Save as, so anything
// saved straight from New kept its default and a shelf of "Untitled model"
// piled up in the Open dialog. This is the field that was meant to drive it.
import { useEffect, useState } from 'react'
import { InputBase, Tooltip } from '@mui/material'

export interface DocumentNameFieldProps {
  name: string
  onRename: (name: string) => void
}

export default function DocumentNameField({ name, onRename }: DocumentNameFieldProps) {
  const [draft, setDraft] = useState(name)
  // A load, an undo, or a Save as changes the name from underneath the field.
  useEffect(() => { setDraft(name) }, [name])

  // Committed on blur rather than per keystroke: renaming goes through the
  // history stack, and an undo should step over the whole name at once rather
  // than back out one letter at a time.
  const commit = () => {
    const next = draft.trim()
    // A design with no name at all is not nameable in the Open dialog, so an
    // empty field reverts rather than saving a blank.
    if (!next) { setDraft(name); return }
    if (next !== name) onRename(next)
  }

  return (
    <Tooltip title="Rename this design" describeChild>
      <InputBase
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(name); (e.target as HTMLInputElement).blur() }
        }}
        inputProps={{ 'aria-label': 'Design name', size: Math.max(12, draft.length) }}
        sx={{
          fontSize: '0.9375rem', fontWeight: 500,
          px: 0.75, borderRadius: 1,
          border: 1, borderColor: 'transparent',
          '&:hover': { borderColor: 'divider' },
          '&.Mui-focused': { borderColor: 'primary.main' },
        }}
      />
    </Tooltip>
  )
}
