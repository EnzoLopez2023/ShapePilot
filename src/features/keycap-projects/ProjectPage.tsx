// One keycap project: the set it describes, photographs of it, and its trays.
//
// Not the workbench grid. DESIGN.md records that layout for a canvas with
// panels either side of it, and the Playground already departs from it for the
// same reason this page does: there is no canvas here. Two columns -- the set
// and its trays on the left, where the reading and the editing happen, photos
// on the right, where they are glanced at.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Divider, Paper, Snackbar, Stack, TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import * as api from './service.ts'
import * as trays from '../keycap-tray/service.ts'
import { aiStatus, readKeycapSet } from '../../services/ai.ts'
import type { KeycapSetResponse } from '../../services/ai.ts'
import { emptyDesign } from '../keycap-tray/model/presets.ts'
import { errorMessage } from '../../services/errors.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import SetItemsTable from './components/SetItemsTable.tsx'
import SetSummary from './components/SetSummary.tsx'
import PhotoPanel from './components/PhotoPanel.tsx'
import ExtractionReviewDialog from './components/ExtractionReviewDialog.tsx'
import type { SetDetails } from './components/ExtractionReviewDialog.tsx'
import type { KeycapProject, SetItem } from './model/types.ts'
import { formatUpdated } from './model/formatUpdated.ts'

/** The editable half of a project. The rest of the record is server-owned. */
interface Draft {
  name: string
  notes: string
  setName: string
  manufacturer: string
  capProfile: string
  colorway: string
  items: SetItem[]
}

const draftOf = (project: KeycapProject): Draft => ({
  name: project.name,
  notes: project.notes ?? '',
  setName: project.setName ?? '',
  manufacturer: project.manufacturer ?? '',
  capProfile: project.capProfile ?? '',
  colorway: project.colorway ?? '',
  items: project.items,
})

const trimmed = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim())

export default function ProjectPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [project, setProject] = useState<KeycapProject | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [trayList, setTrayList] = useState<trays.DesignSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [reading, setReading] = useState(false)
  const [proposal, setProposal] = useState<KeycapSetResponse | null>(null)
  // Same guard the designer uses: a slow load must not overwrite a newer one.
  const loadGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setError(null)
    try {
      const [loaded, designs] = await Promise.all([
        api.getProject(projectId),
        trays.listDesigns(projectId),
      ])
      if (generation !== loadGeneration.current) return
      setProject(loaded)
      setDraft(draftOf(loaded))
      setTrayList(designs)
      setDirty(false)
    } catch (cause) {
      if (generation === loadGeneration.current) setError(errorMessage(cause))
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void aiStatus().then(s => setAiAvailable(s.available)).catch(() => setAiAvailable(false))
  }, [])

  const edit = useCallback((patch: Partial<Draft>) => {
    setDraft(current => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }, [])

  const save = useCallback(async () => {
    if (!draft) return
    setBusy(true)
    try {
      await api.updateProject(projectId, {
        name: draft.name.trim() || 'Untitled project',
        notes: trimmed(draft.notes),
        setName: trimmed(draft.setName),
        manufacturer: trimmed(draft.manufacturer),
        capProfile: trimmed(draft.capProfile),
        colorway: trimmed(draft.colorway),
        items: draft.items,
      })
      setDirty(false)
      setToast('Saved')
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [draft, projectId, load])

  const remove = useCallback(async () => {
    if (!project) return
    const ok = await confirm({
      title: 'Delete this project?',
      message: `"${project.name}", its ${project.items.length} cap rows and its photos will be `
        + `permanently removed. Its ${trayList.length} `
        + `${trayList.length === 1 ? 'tray stays' : 'trays stay'} in the designer, unassigned.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteProject(projectId)
      navigate('/projects')
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }, [project, trayList.length, projectId, confirm, navigate])

  const attachPhoto = useCallback(async (hash: string, caption?: string) => {
    await api.addProjectPhoto(projectId, hash, caption)
    await load()
  }, [projectId, load])

  const removePhoto = useCallback(async (hash: string) => {
    setBusy(true)
    try {
      await api.removeProjectPhoto(projectId, hash)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [projectId, load])

  const readPhotos = useCallback(async (hint: string) => {
    if (!project?.photos.length) return
    setReading(true)
    try {
      setProposal(await readKeycapSet(project.photos.map(p => p.hash), hint || undefined))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setReading(false)
    }
  }, [project])

  // The proposal is applied to the draft, not to the server: it becomes rows a
  // person can correct, and only Save writes them.
  const applyProposal = useCallback((
    items: SetItem[], mode: 'replace' | 'append', details: SetDetails,
  ) => {
    setDraft(current => {
      if (!current) return current
      return {
        ...current,
        items: mode === 'replace' ? items : [...current.items, ...items],
        // Only fill a detail the person has not already written themselves.
        setName: current.setName || details.setName || '',
        manufacturer: current.manufacturer || details.manufacturer || '',
        capProfile: current.capProfile || details.capProfile || '',
        colorway: current.colorway || details.colorway || '',
      }
    })
    setDirty(true)
    setProposal(null)
    setToast('Applied — check the rows, then save')
  }, [])

  const newTray = useCallback(async () => {
    setBusy(true)
    try {
      // Created with its project already set, so the designer opens by URL and
      // has no query-param state to reconcile.
      const seed = emptyDesign()
      const { id } = await trays.createDesign(
        { ...seed, name: `${project?.name ?? 'Tray'} — new tray` }, projectId)
      navigate(`/keycap-tray/${id}`)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }, [project, projectId, navigate])

  if (loading) return <LoadingState label="Loading the project…" />
  if (error && !project) return <ErrorState message={error} onRetry={() => void load()} />
  if (!project || !draft) return null

  return (
    <Stack spacing={1.5} sx={{ p: { xs: 1.5, md: 0 }, minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Button size="small" component={RouterLink} to="/projects">All projects</Button>
        <Typography variant="h1" component="h1" sx={{ minWidth: 0 }}>{draft.name}</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Typography variant="body2" color="text.secondary">
          Updated {formatUpdated(project.updatedAt)}
        </Typography>
        <Button
          size="small" startIcon={<DeleteIcon />} disabled={busy} onClick={() => void remove()}
        >
          Delete
        </Button>
        <Button
          size="small" variant="contained" disabled={busy || !dirty}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
          onClick={() => void save()}
        >
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid', gap: 1.5, minHeight: 0,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 360px' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          <Paper sx={{ p: 1.5 }}>
            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>The set</Typography>
            <Box
              sx={{
                display: 'grid', gap: 1,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              <TextField
                size="small" label="Project name" value={draft.name}
                onChange={e => edit({ name: e.target.value })}
              />
              <TextField
                size="small" label="Set name" placeholder="Olivia" value={draft.setName}
                onChange={e => edit({ setName: e.target.value })}
              />
              <TextField
                size="small" label="Manufacturer" placeholder="GMK" value={draft.manufacturer}
                onChange={e => edit({ manufacturer: e.target.value })}
              />
              <TextField
                size="small" label="Cap profile" placeholder="Cherry" value={draft.capProfile}
                onChange={e => edit({ capProfile: e.target.value })}
              />
              <TextField
                size="small" label="Colourway" placeholder="grey and tan" value={draft.colorway}
                onChange={e => edit({ colorway: e.target.value })}
              />
              <TextField
                size="small" label="Notes" value={draft.notes} multiline minRows={1}
                onChange={e => edit({ notes: e.target.value })}
              />
            </Box>

            <Divider sx={{ my: 1.5 }} />

            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Breakdown</Typography>
            <SetSummary items={draft.items} coverage={project.coverage} />
          </Paper>

          <Paper sx={{ p: 1.5 }}>
            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Caps</Typography>
            <SetItemsTable items={draft.items} onChange={items => edit({ items })} />
          </Paper>

          <Paper sx={{ p: 1.5 }}>
            <Stack
              direction="row" spacing={1}
              sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}
            >
              <Typography variant="h2" component="h2">Trays</Typography>
              <Box sx={{ flex: 1, minWidth: 0 }} />
              <Button
                size="small" startIcon={<AddIcon />} disabled={busy}
                onClick={() => void newTray()}
              >
                New tray
              </Button>
            </Stack>

            {!trayList.length
              ? (
                <EmptyState
                  title="No trays yet"
                  description="Cut a tray for this set and it appears here."
                />
              )
              : (
                <Stack spacing={0.5}>
                  {trayList.map(tray => (
                    <Stack
                      key={tray.id}
                      direction="row" alignItems="center" spacing={1}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/keycap-tray/${tray.id}`)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/keycap-tray/${tray.id}`)
                        }
                      }}
                      sx={{
                        p: 1, borderRadius: 2, cursor: 'pointer',
                        border: 1, borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }}>{tray.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {tray.pocketCount} pockets · updated {formatUpdated(tray.updatedAt)}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              )}
          </Paper>
        </Stack>

        <Paper sx={{ p: 1.5, minWidth: 0 }}>
          <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Photos</Typography>
          {reading
            ? <LoadingState label="Reading the photos…" />
            : (
              <PhotoPanel
                photos={project.photos}
                projectId={projectId}
                busy={busy}
                aiAvailable={aiAvailable}
                onAttach={attachPhoto}
                onRemove={removePhoto}
                onRead={readPhotos}
                onError={setError}
              />
            )}
        </Paper>
      </Box>

      <ExtractionReviewDialog
        open={proposal !== null}
        proposal={proposal}
        existingCount={draft.items.length}
        onApply={applyProposal}
        onClose={() => setProposal(null)}
      />

      <Snackbar
        open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast ?? ''}
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Stack>
  )
}
