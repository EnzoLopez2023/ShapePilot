// Every keycap project, and the way to start another one.
//
// This is the browsing surface the designer never had: trays used to live in a
// single flat modal list, and a growing collection has no shape in one of
// those. A project is one keycap set, so this list is really a list of sets.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Snackbar, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import * as api from './service.ts'
import type { ProjectSummary } from './model/types.ts'
import { errorMessage } from '../../services/errors.ts'
import { EmptyState, ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { formatUpdated } from './model/formatUpdated.ts'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProjects(await api.listProjects())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const create = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const { id } = await api.createProject({ name: trimmed })
      setCreating(false)
      setName('')
      // Straight into the project: the next thing anyone wants is to describe
      // the set, and a list that just grew by one row does not help with that.
      navigate(`/projects/${id}`)
    } catch (cause) {
      setToast(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [name, navigate])

  return (
    <Stack spacing={1.5} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 900 }}>
      <Stack
        direction="row" spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Typography variant="h1" component="h1">Projects</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Button
          variant="contained" size="small" startIcon={<AddIcon />}
          onClick={() => setCreating(true)}
        >
          New project
        </Button>
      </Stack>

      <Typography color="text.secondary">
        A project is one keycap set: what it holds, photos of it, and the trays cut for it.
      </Typography>

      {loading && <LoadingState label="Loading your projects…" />}
      {!loading && error && <ErrorState message={error} onRetry={() => void refresh()} />}
      {!loading && !error && !projects.length && (
        <EmptyState
          title="No projects yet"
          description="Start one for a keycap set, then add the trays you cut for it."
          action={(
            <Button variant="contained" size="small" onClick={() => setCreating(true)}>
              New project
            </Button>
          )}
        />
      )}

      {!loading && !error && projects.length > 0 && (
        <Stack spacing={0.5}>
          {projects.map(project => (
            <Stack
              key={project.id}
              direction="row"
              alignItems="center"
              spacing={1}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/projects/${project.id}`)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/projects/${project.id}`)
                }
              }}
              sx={{
                p: 1, borderRadius: 2, cursor: 'pointer',
                border: 1, borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{project.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {describe(project)}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {formatUpdated(project.updatedAt)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="xs">
        <DialogTitle>New project</DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus fullWidth size="small" label="Name"
            placeholder="GMK Olivia"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void create() }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!name.trim() || busy}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            onClick={() => void create()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast(null)}>
        <Alert severity="error" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Stack>
  )
}

/** The one line under a project's name: the set, then what it has. */
function describe(project: ProjectSummary): string {
  const parts: string[] = []
  if (project.setName) parts.push(project.setName)
  if (project.capProfile) parts.push(`${project.capProfile} profile`)
  parts.push(`${project.capCount} ${project.capCount === 1 ? 'cap' : 'caps'}`)
  parts.push(`${project.trayCount} ${project.trayCount === 1 ? 'tray' : 'trays'}`)
  if (project.photoCount) {
    parts.push(`${project.photoCount} ${project.photoCount === 1 ? 'photo' : 'photos'}`)
  }
  return parts.join(' · ')
}
