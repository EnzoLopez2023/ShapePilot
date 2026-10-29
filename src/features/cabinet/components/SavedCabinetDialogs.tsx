// Save As and Open for named cabinets.
import { useEffect, useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem,
  ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { DEFAULT_CABINET_SETTINGS } from '../state/params.ts'
import type { CabinetSettings } from '../state/params.ts'
import { LABEL_MAX, deleteCabinet, listCabinets } from '../state/saved.ts'
import type { SavedCabinet } from '../state/saved.ts'

export function SaveCabinetDialog(
  { initial, onSave, onClose }:
  { initial: string; onSave: (name: string) => void; onClose: () => void },
) {
  const [name, setName] = useState(initial)
  const [taken, setTaken] = useState<string[]>([])
  useEffect(() => {
    let live = true
    listCabinets(DEFAULT_CABINET_SETTINGS)
      .then(all => { if (live) setTaken(all.map(c => c.name)) })
      .catch(() => { /* the save itself reports an unreachable server */ })
    return () => { live = false }
  }, [])
  const clean = name.trim()
  const exists = clean !== '' && taken.includes(clean) && clean !== initial
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Save cabinet as</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth size="small" margin="dense" label="Name"
          value={name} onChange={e => setName(e.target.value.slice(0, LABEL_MAX))}
          onKeyDown={e => { if (e.key === 'Enter' && clean) onSave(clean) }}
          helperText={exists ? 'A cabinet with this name exists and will be replaced.'
            : 'Also used to name the exported files.'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!clean} onClick={() => onSave(clean)}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

export function OpenCabinetDialog(
  { onOpen, onClose }: { onOpen: (settings: CabinetSettings) => void; onClose: () => void },
) {
  const [cabinets, setCabinets] = useState<SavedCabinet[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    listCabinets(DEFAULT_CABINET_SETTINGS)
      .then(all => { if (live) setCabinets(all) })
      .catch(() => { if (live) setError('Could not load saved cabinets.') })
    return () => { live = false }
  }, [])
  const remove = (name: string) => {
    deleteCabinet(name)
      .then(() => setCabinets(all => all && all.filter(c => c.name !== name)))
      .catch(() => setError(`Could not delete “${name}”.`))
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Open cabinet</DialogTitle>
      <DialogContent>
        {error !== null ? (
          <Typography variant="body2" color="error">{error}</Typography>
        ) : cabinets === null ? (
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        ) : cabinets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing saved yet. Use File → Save As… to keep this cabinet under a name.
          </Typography>
        ) : (
          <List dense disablePadding>
            {cabinets.map(({ name, settings }) => (
              <ListItem
                key={name} disablePadding
                secondaryAction={
                  <IconButton
                    edge="end" aria-label={`Delete ${name}`}
                    onClick={() => remove(name)}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemButton onClick={() => onOpen(settings)}>
                  <ListItemText primary={name} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  )
}
