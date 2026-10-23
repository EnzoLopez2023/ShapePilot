// Save As and Open for named cabinets.
import { useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem,
  ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { LABEL_MAX, deleteCabinet, savedCabinetNames } from '../state/saved.ts'

export function SaveCabinetDialog(
  { initial, onSave, onClose }:
  { initial: string; onSave: (name: string) => void; onClose: () => void },
) {
  const [name, setName] = useState(initial)
  const clean = name.trim()
  const exists = clean !== '' && savedCabinetNames().includes(clean) && clean !== initial
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
  { onOpen, onClose }: { onOpen: (name: string) => void; onClose: () => void },
) {
  const [names, setNames] = useState(savedCabinetNames)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Open cabinet</DialogTitle>
      <DialogContent>
        {names.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing saved yet. Use File → Save As… to keep this cabinet under a name.
          </Typography>
        ) : (
          <List dense disablePadding>
            {names.map(name => (
              <ListItem
                key={name} disablePadding
                secondaryAction={
                  <IconButton
                    edge="end" aria-label={`Delete ${name}`}
                    onClick={() => { deleteCabinet(name); setNames(savedCabinetNames()) }}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemButton onClick={() => onOpen(name)}>
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
