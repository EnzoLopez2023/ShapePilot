// Open and Save-as dialogs, shared by the three designers. The Open list spans
// every kind so a Bambu model can be picked up in the Shaper Designer, which is
// the whole reason one table backs all three.
import { useEffect, useState } from 'react'
import {
  Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import type { DocumentKind } from '../../model/document.ts'
import type { DocumentSummary } from '../../services/designDocuments.ts'
import { EmptyState, LoadingState } from '../LoadingState.tsx'

const KIND_LABEL: Record<DocumentKind, string> = {
  shaper: 'Shaper',
  bambu: 'Bambu',
  playground: 'Playground',
}

export interface OpenDialogProps {
  open: boolean
  documents: DocumentSummary[]
  loading: boolean
  /** The current sub-app's kind, shown first. */
  kind: DocumentKind
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function OpenDocumentDialog(props: OpenDialogProps) {
  const { open, documents, loading, kind, onOpen, onDelete, onClose } = props
  // Own kind first, then everything else: cross-app opening is supported, but
  // the common case is reopening your own work.
  const sorted = [...documents].sort((a, b) => {
    if (a.kind === b.kind) return b.updatedAt.localeCompare(a.updatedAt)
    if (a.kind === kind) return -1
    if (b.kind === kind) return 1
    return a.kind.localeCompare(b.kind)
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Open a design</DialogTitle>
      <DialogContent dividers>
        {loading
          ? <LoadingState label="Loading your designs…" fill={false} />
          : !sorted.length
            ? <EmptyState title="No saved designs" description="Save one to see it here." />
            : (
              <Stack spacing={0.5}>
                {sorted.map(d => (
                  <Stack
                    key={d.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      p: 1, borderRadius: 1, cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(d.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(d.id) }
                    }}
                  >
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body1" noWrap>{d.name}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {d.objectCount} {d.objectCount === 1 ? 'object' : 'objects'}
                        {' · '}{new Date(d.updatedAt).toLocaleDateString()}
                      </Typography>
                    </Stack>
                    <Chip
                      size="small"
                      label={KIND_LABEL[d.kind]}
                      color={d.kind === kind ? 'primary' : 'default'}
                      variant={d.kind === kind ? 'filled' : 'outlined'}
                    />
                    <Tooltip title="Delete" describeChild>
                      <IconButton
                        size="small"
                        aria-label={`Delete ${d.name}`}
                        onClick={e => { e.stopPropagation(); onDelete(d.id) }}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

export interface SaveAsDialogProps {
  open: boolean
  defaultName: string
  /**
   * True when the design has never been saved, so this is not a copy at all --
   * it is the first save, and the one moment the name is worth asking for.
   */
  firstSave?: boolean
  onSave: (name: string) => void
  onClose: () => void
}

export function SaveAsDialog(props: SaveAsDialogProps) {
  const { open, defaultName, firstSave, onSave, onClose } = props
  const [name, setName] = useState(defaultName)
  // Reset on every open, so the field always starts from the document's current
  // name. This used to be a `key` on the Dialog below, which remounted MUI's
  // dialog but not the component holding this state -- so the field kept the
  // name it was first constructed with, however the document had been renamed
  // since. The reset has to live where the state does.
  useEffect(() => { if (open) setName(defaultName) }, [open, defaultName])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{firstSave ? 'Name this design' : 'Save a copy'}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth size="small" label="Name" sx={{ mt: 1 }}
          // On a first save the field holds a placeholder nobody wants to keep,
          // so select it and let the first keystroke replace it. On a copy the
          // name is a real one worth editing rather than retyping.
          onFocus={firstSave ? e => e.target.select() : undefined}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()) }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
