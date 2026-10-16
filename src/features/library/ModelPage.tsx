// One model from the Library: its pictures (or the mesh itself, on the Mac),
// what it is for, its files, and every time it was printed.
//
// Everything a person types here is saved to this server first and written
// into the folder's model.json by the organizer on its next sync, so an edit
// made on a phone still reaches the Mac.
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, Divider, IconButton, Link, MenuItem, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import ThreeDRotationRoundedIcon from '@mui/icons-material/ThreeDRotationRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import { LIBRARY_STATUS_LABELS } from '../../../lib/contracts/library.ts'
import type { LibraryCollection, LibraryFile, LibraryModelDetail, LibraryStatus } from '../../../lib/contracts/library.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { errorMessage } from '../../services/errors.ts'
import { BackToLibrary } from './components/BackToLibrary.tsx'
import { LibraryThumb } from './components/LibraryThumb.tsx'
import { useToast } from './components/useToast.tsx'
import {
  STATUS_COLOR, STATUS_ORDER, categoryLabel, formatBytes, formatDimensions, formatDuration, formatGrams, relativeDate,
  sourceLabel,
} from './model/format.ts'
import { filtersQuery, readFilters } from './model/filters.ts'
import { HELPER_DELETE_VERSION, libraryHelper, useLibraryHelper } from './model/helper.ts'
import {
  createCollection, deleteModel, deletePrint, getModel, listCollections, listModelIds, logPrint, setMembership, updateModel,
} from './service.ts'
import type { ModelUpdate } from './service.ts'

const ModelViewer3D = lazy(() => import('./components/ModelViewer3D.tsx'))

/** The file Bambu Studio should open: an editable 3MF project first, then a sliced one, then meshes. */
function primaryFile(files: LibraryFile[]): LibraryFile | null {
  return files.find(f => f.kind === '3mf' && !f.isSliced)
    ?? files.find(f => f.kind === '3mf')
    ?? files.find(f => f.kind === 'stl')
    ?? files[0]
    ?? null
}

const viewable = (file: LibraryFile | null): file is LibraryFile & { kind: 'stl' | '3mf' } =>
  Boolean(file && (file.kind === 'stl' || file.kind === '3mf'))

/**
 * Steps through the hub's current filtered list with Previous/Next and the
 * arrow keys. The order is captured once when the page opens, so an edit that
 * moves this model out of the filter doesn't reshuffle the sequence.
 */
export default function ModelPage() {
  const { modelId = '' } = useParams()
  const navigate = useNavigate()
  const [ids, setIds] = useState<string[] | null>(null)

  useEffect(() => {
    let live = true
    listModelIds(filtersQuery(readFilters())).then(r => { if (live) setIds(r.ids) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  const index = ids ? ids.indexOf(modelId) : -1
  const prevId = ids && index > 0 ? ids[index - 1] : null
  const nextId = ids && index >= 0 && index < ids.length - 1 ? ids[index + 1] : null

  // Replace, so the browser's Back still returns to the Library rather than through every model.
  const go = useCallback((target: string | null) => {
    if (target) navigate(`/library/${encodeURIComponent(target)}`, { replace: true })
  }, [navigate])

  useEffect(() => {
    if (index < 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"], [role="listbox"]'))) return
      const destination = event.key === 'ArrowLeft' ? prevId : nextId
      if (!destination) return
      event.preventDefault()
      go(destination)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, prevId, nextId, go])

  const stepper = ids && index >= 0 && ids.length > 1 ? (
    <Stack direction="row" spacing={0.5} component="nav" aria-label="Browse filtered models" sx={{ alignItems: 'center' }}>
      <IconButton aria-label="Previous model (←)" disabled={!prevId} onClick={() => go(prevId)}><ChevronLeftRoundedIcon /></IconButton>
      <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {index + 1} of {ids.length}
      </Typography>
      <IconButton aria-label="Next model (→)" disabled={!nextId} onClick={() => go(nextId)}><ChevronRightRoundedIcon /></IconButton>
    </Stack>
  ) : null

  // After a delete, carry on through the filtered list (or back to the Library at its end).
  const onDeleted = useCallback(() => {
    const destination = nextId ?? prevId
    setIds(current => current && current.filter(id => id !== modelId))
    if (destination) go(destination)
    else navigate('/library', { replace: true })
  }, [nextId, prevId, modelId, go, navigate])

  // Keyed by id so per-model state (pictures, viewer file, drafts) starts fresh on each step.
  return <ModelDetail key={modelId} id={modelId} stepper={stepper} onDeleted={onDeleted} />
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Stack spacing={1} component="section">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography variant="h2" component="h2" sx={{ fontSize: '1.05rem' }}>{title}</Typography>
        {aside && <Typography variant="body2" color="text.secondary">{aside}</Typography>}
      </Stack>
      {children}
    </Stack>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 1, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ minWidth: 0, typography: 'body2', overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  )
}

function ModelDetail({ id, stepper, onDeleted }: { id: string; stepper: ReactNode; onDeleted: () => void }) {
  const helper = useLibraryHelper()
  const confirm = useConfirm()
  const toast = useToast()
  const [model, setModel] = useState<LibraryModelDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'image' | '3d'>('image')
  const [image, setImage] = useState<string | null>(null)
  const [viewerFile, setViewerFile] = useState<LibraryFile | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [moveTo, setMoveTo] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState('')
  const [title, setTitle] = useState('')
  const [hubUrl, setHubUrl] = useState('')
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [newCollection, setNewCollection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await getModel(id)
      setModel(next)
      setNotes(next.notes)
      setTitle(next.title)
      setHubUrl(next.bambuHubUrl ?? '')
      setImage(current => current ?? next.thumbHash)
      setViewerFile(current => current ?? next.files.find(f => f.kind === 'stl' || f.kind === '3mf') ?? null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!helper.available) return
    libraryHelper.categories().then(r => setCategories(r.categories)).catch(() => undefined)
  }, [helper.available])

  useEffect(() => {
    listCollections().then(list => setCollections(list.filter(c => c.kind === 'manual'))).catch(() => undefined)
  }, [])

  const save = async (update: ModelUpdate, success?: string) => {
    if (!model) return
    try {
      const next = await updateModel(model.id, update)
      setModel(current => (current ? { ...current, ...next } : current))
      if (success) toast.success(success)
    } catch (cause) {
      toast.failure('Could not save', cause)
    }
  }

  const runHelper = async (label: string, job: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await job()
      toast.success(label)
    } catch (cause) {
      toast.failure(`${label} failed`, cause)
    } finally {
      setBusy(false)
    }
  }

  const recordPrint = async (result: 'completed' | 'failed') => {
    if (!model) return
    try {
      await logPrint(model.id, { result })
      toast.success(result === 'completed' ? 'Print logged' : 'Failed print logged')
      await load()
    } catch (cause) {
      toast.failure('Could not log the print', cause)
    }
  }

  const changeMembership = async (collection: LibraryCollection, member: boolean) => {
    if (!model) return
    try {
      await setMembership(collection.id, model.id, member)
      setModel(current => current && {
        ...current,
        collectionIds: member
          ? [...new Set([...current.collectionIds, collection.id])]
          : current.collectionIds.filter(c => c !== collection.id),
      })
    } catch (cause) {
      toast.failure('Could not update the collection', cause)
    }
  }

  const addCollection = async () => {
    const name = newCollection?.trim()
    if (!model || !name) return
    try {
      const created = await createCollection({ name, kind: 'manual', modelIds: [model.id] })
      setCollections(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
      setModel(current => current && { ...current, collectionIds: [...current.collectionIds, created.id] })
      setNewCollection(null)
    } catch (cause) {
      toast.failure('Could not create the collection', cause)
    }
  }

  const moveModel = async () => {
    const target = (moveTo === '__new' ? newCategory : moveTo).trim()
    if (!model || !target) return
    await runHelper(`Moved to ${categoryLabel(target)}`, async () => {
      await libraryHelper.file(model.id, target)
      setModel(current => (current ? { ...current, category: target } : current))
      setMoveTo('')
      setNewCategory('')
    })
  }

  const addTags = () => {
    if (!model) return
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean)
    if (!tags.length) return
    void save({ tags: [...model.tags, ...tags] })
    setTagInput('')
  }

  const trashFile = async (file: LibraryFile) => {
    if (!model) return
    const ok = await confirm({
      title: 'Move this file to the Trash?',
      message: `“${file.filename}” goes to the macOS Trash. You can undo this from Organize → History.`,
      confirmLabel: 'Move to Trash',
      destructive: true,
    })
    if (!ok) return
    await runHelper('Moved to Trash', async () => {
      await libraryHelper.trashFile(model.id, file.relPath)
      setModel(current => (current ? { ...current, files: current.files.filter(f => f.id !== file.id) } : current))
    })
  }

  const removeModel = async () => {
    if (!model) return
    const onDisk = model.state === 'present'
    const ok = await confirm({
      title: 'Delete this model?',
      message: onDisk
        ? `The “${model.folder ?? model.title}” folder goes to the macOS Trash and the model leaves the Library, with its notes, collections and hand-logged prints. Undoing it from Organize → History brings the folder back as a new model.`
        : `“${model.title}” leaves the Library, with its notes, collections and hand-logged prints. Its folder is already gone from the Mac.`,
      confirmLabel: onDisk ? 'Move to Trash and delete' : 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      if (onDisk) await libraryHelper.trashModel(model.id)
      await deleteModel(model.id)
      onDeleted()
    } catch (cause) {
      toast.failure('Could not delete the model', cause)
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Stack spacing={2} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1100 }}>
        <BackToLibrary />
        <ErrorState title="Model unavailable" message={error} />
      </Stack>
    )
  }
  if (!model) return <LoadingState label="Loading the model…" />

  const primary = primaryFile(model.files)
  const images = [model.thumbHash, ...model.gallery].filter((h): h is string => Boolean(h))
  const canView = helper.available && viewable(viewerFile)
  const needsHelper = helper.available ? '' : 'Available on your Mac while the Library helper is running'
  const source = sourceLabel(model.sourceSite)
  // A folder still on disk must be trashed through the helper, or the next sync brings the model back.
  const helperCanTrash = helper.available && (helper.health?.version ?? 0) >= HELPER_DELETE_VERSION
  const canDelete = model.state === 'missing' || helperCanTrash
  const deleteHint = canDelete ? ''
    : helper.available ? 'Restart the Library helper to delete models from here' : needsHelper

  return (
    <Stack spacing={2.5} sx={{ p: { xs: 1.5, md: 0 }, maxWidth: 1100 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <BackToLibrary />
        {stepper}
      </Stack>

      <Stack spacing={1}>
        <TextField
          variant="standard" value={title} fullWidth
          slotProps={{ htmlInput: { 'aria-label': 'Title', maxLength: 200, style: { fontSize: '1.75rem', fontWeight: 600 } } }}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          onBlur={() => { if (title.trim() && title !== model.title) void save({ title: title.trim() }, 'Title saved') }}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Chip label={LIBRARY_STATUS_LABELS[model.status]} color={STATUS_COLOR[model.status]} size="small" variant="outlined" />
          <Typography variant="body2">{categoryLabel(model.category)}</Typography>
          {model.designer && <Typography variant="body2" color="text.secondary">by {model.designer}</Typography>}
          {model.state === 'missing' && <Chip label="Missing on disk" color="error" size="small" />}
          <Tooltip title={model.favorite ? 'Remove favorite' : 'Mark favorite'}>
            <IconButton aria-pressed={model.favorite} aria-label={model.favorite ? 'Remove favorite' : 'Mark favorite'}
              onClick={() => void save({ favorite: !model.favorite })}>
              {model.favorite ? <FavoriteRoundedIcon color="error" /> : <FavoriteBorderRoundedIcon />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(0, 2fr)' } }}>
        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, alignSelf: 'start' }} aria-label="Preview">
          {helper.available && (
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, next) => next && setView(next)} aria-label="Preview mode">
              <ToggleButton value="image">Pictures</ToggleButton>
              <ToggleButton value="3d" disabled={!canView}>3D</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Box sx={{ aspectRatio: '4 / 3', borderRadius: 1, overflow: 'hidden' }}>
            {view === '3d' && canView && viewable(viewerFile) ? (
              <Suspense fallback={<LoadingState label="Loading the viewer…" />}>
                <ModelViewer3D url={libraryHelper.fileUrl(model.id, viewerFile.relPath)} kind={viewerFile.kind} label={viewerFile.filename} />
              </Suspense>
            ) : (
              <LibraryThumb hash={image} alt={`${model.title} preview`} iconSize={64} fit="contain" />
            )}
          </Box>
          {images.length > 1 && view === 'image' && (
            <Stack direction="row" spacing={1} role="list" aria-label="Plates and parts" sx={{ overflowX: 'auto', pb: 0.5 }}>
              {images.map(hash => (
                <Box
                  key={hash} component="button" type="button" role="listitem" aria-pressed={image === hash}
                  onClick={() => setImage(hash)}
                  sx={{
                    flex: '0 0 72px', height: 72, p: 0, borderRadius: 1, overflow: 'hidden', cursor: 'pointer',
                    border: 2, borderColor: image === hash ? 'primary.main' : 'divider', bgcolor: 'transparent',
                  }}
                >
                  <LibraryThumb hash={hash} iconSize={20} />
                </Box>
              ))}
            </Stack>
          )}
        </Paper>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Tooltip title={needsHelper}>
                <span>
                  <Button
                    fullWidth variant="contained" startIcon={<PrintRoundedIcon />}
                    disabled={!helper.available || !primary || busy}
                    onClick={() => primary && void runHelper('Opened in Bambu Studio', () => libraryHelper.open(model.id, primary.relPath))}
                  >
                    Open in Bambu Studio
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={needsHelper}>
                <span>
                  <Button fullWidth variant="outlined" startIcon={<FolderOpenRoundedIcon />} disabled={!helper.available || busy}
                    onClick={() => void runHelper('Revealed in Finder', () => libraryHelper.reveal(model.id))}>
                    Reveal in Finder
                  </Button>
                </span>
              </Tooltip>
              <Stack direction="row" spacing={1}>
                <Button fullWidth startIcon={<CheckCircleRoundedIcon />} onClick={() => void recordPrint('completed')}>Printed it</Button>
                <Button fullWidth startIcon={<CancelRoundedIcon />} onClick={() => void recordPrint('failed')}>Print failed</Button>
              </Stack>
              <Tooltip title={deleteHint}>
                <span>
                  <Button fullWidth color="error" startIcon={<DeleteOutlineRoundedIcon />} disabled={!canDelete || busy}
                    onClick={() => void removeModel()}>
                    Delete model
                  </Button>
                </span>
              </Tooltip>
              {!helper.available && !helper.checking && (
                <Typography variant="body2" color="text.secondary">
                  File actions work on the Mac that holds your library, while <code>npm run library -- serve</code> is running.
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={2}>
              <TextField select size="small" label="Status" value={model.status}
                onChange={e => void save({ status: e.target.value as LibraryStatus })}>
                {STATUS_ORDER.map(s => <MenuItem key={s} value={s}>{LIBRARY_STATUS_LABELS[s]}</MenuItem>)}
              </TextField>

              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField select size="small" label="Category" value={moveTo} disabled={!helper.available}
                  helperText={needsHelper || undefined} sx={{ flex: 1 }}
                  onChange={e => setMoveTo(e.target.value)}
                  slotProps={{ select: { displayEmpty: true, renderValue: v => (v === '' ? categoryLabel(model.category) : v === '__new' ? 'New category…' : categoryLabel(String(v))) }, inputLabel: { shrink: true } }}>
                  {categories.filter(c => c !== model.category).map(c => <MenuItem key={c} value={c}>{categoryLabel(c)}</MenuItem>)}
                  <MenuItem value="__new">New category…</MenuItem>
                </TextField>
                <Button variant="outlined" startIcon={<DriveFileMoveRoundedIcon />} disabled={!moveTo || busy || (moveTo === '__new' && !newCategory.trim())}
                  onClick={() => void moveModel()} sx={{ mt: 0.25 }}>
                  Move
                </Button>
              </Stack>
              {moveTo === '__new' && (
                <TextField size="small" label="New category name" value={newCategory} onChange={e => setNewCategory(e.target.value)} />
              )}

              <Stack spacing={1}>
                <Typography variant="overline" color="text.secondary">Tags</Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  {model.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" onDelete={() => void save({ tags: model.tags.filter(t => t !== tag) })} />
                  ))}
                </Stack>
                <TextField size="small" placeholder="Add tags, separated by commas" value={tagInput}
                  slotProps={{ htmlInput: { 'aria-label': 'Add tag' } }}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTags() } }}
                  onBlur={addTags} />
              </Stack>

              <Stack spacing={1}>
                <Typography variant="overline" color="text.secondary">Collections</Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  {collections.filter(c => model.collectionIds.includes(c.id)).map(c => (
                    <Chip key={c.id} label={c.name} size="small" onDelete={() => void changeMembership(c, false)} />
                  ))}
                </Stack>
                {newCollection === null ? (
                  <TextField select size="small" value="" label="Add to collection"
                    onChange={e => {
                      const value = e.target.value
                      if (value === '__new') setNewCollection('')
                      else {
                        const target = collections.find(c => c.id === Number(value))
                        if (target) void changeMembership(target, true)
                      }
                    }}>
                    {collections.filter(c => !model.collectionIds.includes(c.id)).map(c => (
                      <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                    ))}
                    <MenuItem value="__new">New collection…</MenuItem>
                  </TextField>
                ) : (
                  <Stack direction="row" spacing={1} component="form" onSubmit={e => { e.preventDefault(); void addCollection() }}>
                    <TextField autoFocus size="small" value={newCollection} placeholder="Collection name" sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { maxLength: 80, 'aria-label': 'New collection name' } }}
                      onChange={e => setNewCollection(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setNewCollection(null) }} />
                    <Button type="submit" variant="contained" size="small" disabled={!newCollection.trim()}>Add</Button>
                    <Button size="small" onClick={() => setNewCollection(null)}>Cancel</Button>
                  </Stack>
                )}
              </Stack>

              <Stack spacing={0.5}>
                <TextField size="small" label="Bambu Hub project" placeholder="https://workshop.nintek.com/bambu/…"
                  value={hubUrl} onChange={e => setHubUrl(e.target.value)}
                  helperText="The link to this model's project in Workshop"
                  onBlur={() => {
                    const next = hubUrl.trim()
                    if (next !== (model.bambuHubUrl ?? '')) void save({ bambuHubUrl: next || null }, next ? 'Link saved' : 'Link removed')
                  }} />
                {model.bambuHubUrl && (
                  <Link href={model.bambuHubUrl} target="_blank" rel="noreferrer" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    Open the project <LaunchRoundedIcon fontSize="inherit" />
                  </Link>
                )}
              </Stack>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }} component="dl">
            <Fact label="Print estimate">
              {model.estSeconds || model.estGrams != null
                ? `${formatDuration(model.estSeconds)} · ${formatGrams(model.estGrams)}`
                : 'Not sliced yet'}
            </Fact>
            <Fact label="Size">{formatDimensions(model.bbox)}</Fact>
            <Fact label="Plates">{model.plateCount || '—'}</Fact>
            <Fact label="Printer">{model.printer ?? '—'}</Fact>
            {model.filaments.length > 0 && (
              <Fact label="Filaments">
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  {model.filaments.map((f, i) => (
                    <Chip key={i} size="small" variant="outlined" label={f.type ?? '—'} title={`${f.type ?? ''} ${f.color ?? ''}`.trim()}
                      icon={<Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: f.color ?? 'transparent', border: 1, borderColor: 'divider' }} />} />
                  ))}
                </Stack>
              </Fact>
            )}
            {source && (
              <Fact label="Source">
                {model.sourceUrl
                  ? <Link href={model.sourceUrl} target="_blank" rel="noreferrer">{source}</Link>
                  : source}
              </Fact>
            )}
            {model.license && <Fact label="License">{model.license}</Fact>}
            <Fact label="Folder"><Box component="code" sx={{ fontSize: 12 }}>{model.folder ?? '—'}</Box></Fact>
            <Fact label="Added">{relativeDate(model.firstSeenAt)}</Fact>
          </Paper>
        </Stack>
      </Box>

      <Section title="Files" aside={`${model.files.length} · ${formatBytes(model.totalBytes)}`}>
        <Paper variant="outlined">
          {model.files.map((file, i) => (
            <Box key={file.id}>
              {i > 0 && <Divider />}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.25 }}>
                <Chip size="small" label={file.isSliced ? 'Sliced' : file.kind.toUpperCase()} sx={{ minWidth: 56 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.filename}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(file.size)}
                    {file.triangles ? ` · ${file.triangles.toLocaleString()} triangles` : ''}
                    {file.bbox ? ` · ${formatDimensions(file.bbox)}` : ''}
                    {file.isSliced ? ` · ${formatDuration(file.seconds)} · ${formatGrams(file.grams)}` : ''}
                  </Typography>
                </Box>
                {helper.available && viewable(file) && (
                  <Tooltip title="View in 3D">
                    <IconButton aria-label="View in 3D" onClick={() => { setViewerFile(file); setView('3d') }}><ThreeDRotationRoundedIcon /></IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Open in Bambu Studio">
                  <span>
                    <IconButton aria-label="Open in Bambu Studio" disabled={!helper.available}
                      onClick={() => void runHelper('Opened in Bambu Studio', () => libraryHelper.open(model.id, file.relPath))}>
                      <PrintRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Reveal in Finder">
                  <span>
                    <IconButton aria-label="Reveal in Finder" disabled={!helper.available}
                      onClick={() => void runHelper('Revealed in Finder', () => libraryHelper.reveal(model.id, file.relPath))}>
                      <FolderOpenRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Move file to Trash">
                  <span>
                    <IconButton aria-label="Move file to Trash" disabled={!helper.available || busy} onClick={() => void trashFile(file)}>
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          ))}
          {model.files.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>No files in this folder any more.</Typography>
          )}
        </Paper>
      </Section>

      <Section title="Print log" aside={model.printedCount ? `${model.printedCount} printed` : undefined}>
        {model.prints.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No prints yet. Jobs from the printer's history link here automatically when their names match.
          </Typography>
        ) : (
          <Paper variant="outlined">
            {model.prints.map((p, i) => (
              <Box key={p.id}>
                {i > 0 && <Divider />}
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.25 }}>
                  <Chip size="small" variant="outlined"
                    color={p.result === 'completed' ? 'success' : p.result === 'failed' ? 'error' : 'default'}
                    label={p.result === 'completed' ? 'Printed' : p.result === 'failed' ? 'Failed' : p.result} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{relativeDate(p.startedAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {p.source === 'bambu' ? `Printer job “${p.title ?? 'Untitled'}”` : 'Logged by hand'}
                      {p.seconds ? ` · ${formatDuration(p.seconds)}` : ''}
                      {p.grams ? ` · ${formatGrams(p.grams)}` : ''}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </Typography>
                  </Box>
                  {p.source === 'manual' && (
                    <IconButton aria-label="Delete this entry" onClick={() => void deletePrint(p.id).then(load).catch(cause => toast.failure('Could not delete', cause))}>
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  )}
                </Stack>
              </Box>
            ))}
          </Paper>
        )}
      </Section>

      <Section title="Notes">
        <TextField multiline minRows={3} fullWidth value={notes}
          placeholder="Settings that worked, filament, what to change next time…"
          onChange={e => setNotes(e.target.value)}
          onBlur={() => { if (notes !== model.notes) void save({ notes }, 'Notes saved') }} />
      </Section>

      {model.description && (
        <Box component="details">
          <Box component="summary" sx={{ cursor: 'pointer', typography: 'body2', fontWeight: 600 }}>Designer's description</Box>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{model.description}</Typography>
        </Box>
      )}

      {model.state === 'missing' && (
        <Alert severity="warning">
          The organizer did not find this folder on its last scan. If it was moved outside the library, it comes back
          when it returns; nothing here is lost in the meantime.
        </Alert>
      )}

      {toast.element}
    </Stack>
  )
}

