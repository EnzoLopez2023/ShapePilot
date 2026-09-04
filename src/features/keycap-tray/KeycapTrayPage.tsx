import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Menu, MenuItem, Paper, Snackbar, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded'
import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import AddIcon from '@mui/icons-material/Add'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SettingsIcon from '@mui/icons-material/SettingsRounded'
import { buildTrayMesh } from './geometry/layers.ts'
import { validateDesign } from './geometry/validate.ts'
import { materialOf } from './model/materials.ts'
import {
  DEFAULT_VIEW_SETTINGS, forgetViewSettings, loadViewSettings, saveViewSettings,
} from './state/viewSettings.ts'
import type { CanvasMode, ViewSettings } from './state/viewSettings.ts'
import { designerDefaults } from '../settings/preferences.ts'
import { DEFAULT_FABRICATION, paletteItemExtra } from './model/defaults.ts'
import type { PaletteItem } from './model/defaults.ts'
import type { FabricationSettings } from './model/types.ts'
import { emptyDesign } from './model/presets.ts'
import { useTrayDesign } from './state/useTrayDesign.ts'
import * as api from './service.ts'
import * as projects from '../keycap-projects/service.ts'
import type { KeycapProject, ProjectSummary } from '../keycap-projects/model/types.ts'
import TrayCanvas from './components/TrayCanvas.tsx'
import PocketPalette from './components/PocketPalette.tsx'
import PropertiesPanel from './components/PropertiesPanel.tsx'
import ExportPanel from './components/ExportPanel.tsx'
import ProjectGate from './components/ProjectGate.tsx'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { formatUpdated } from '../keycap-projects/model/formatUpdated.ts'

// three.js is a third of the bundle and the 2D layout is the default view, so
// the viewer is only fetched when someone actually switches to 3D.
const TrayViewer3D = lazy(() => import('./components/TrayViewer3D.tsx'))

// The panels sit beside the canvas rather than over it, so fit-to-view has the
// whole element to work with. Hoisted so the fit effect's dependencies stay
// stable -- an inline object literal re-runs it on every render.
const CANVAS_INSET = { left: 0, right: 0, top: 0, bottom: 0 }

export default function KeycapTrayPage() {
  const confirm = useConfirm()
  const { designId } = useParams()
  const navigate = useNavigate()
  const d = useTrayDesign()
  const { design, selection } = d

  const [fab, setFab] = useState<FabricationSettings>(DEFAULT_FABRICATION)
  // One object rather than nine separate states, because it is remembered and
  // restored as a unit: a tray comes back the way it was being looked at.
  // `target` is here too -- lifted from ExportPanel, since the build-plate
  // controls only make sense for the 3D printer and the toolbar needs to know.
  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS)
  // What a tray with nothing remembered opens with, from the settings page.
  // Held in a ref as well as state: `load` reads it without having to be
  // rebuilt every time it changes, which would retrigger the URL effect.
  const [baseline, setBaseline] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS)
  const baselineRef = useRef(baseline)
  baselineRef.current = baseline
  // Nothing loads until the baseline is known, so a tray opened from a URL
  // cannot fall back to the shipped defaults just because the preferences
  // request had not landed yet. `designerDefaults` never rejects, so this
  // always resolves.
  const [baselineReady, setBaselineReady] = useState(false)
  const {
    view, snapMm, gridMm, showLabels, showPlate, showBuffer, bufferMm, imperial, target,
  } = settings
  const patch = useCallback(
    (next: Partial<ViewSettings>) => setSettings(current => ({ ...current, ...next })), [])
  const [designs, setDesigns] = useState<api.DesignSummary[]>([])
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [fitToken, setFitToken] = useState(0)
  const [project, setProject] = useState<KeycapProject | null>(null)
  const [projectList, setProjectList] = useState<ProjectSummary[]>([])
  const [projectMenu, setProjectMenu] = useState<HTMLElement | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const loadGeneration = useRef(0)
  // The tray id the address has already been answered for. Not "the tray in
  // the editor": abandoning one with New answers the address too, and until
  // the navigation commits the URL still names it. Comparing against `savedId`
  // instead -- or clearing this on New -- put the abandoned tray straight back,
  // because `load` is not referentially stable and the effect below re-runs on
  // every render.
  const answeredForUrl = useRef<string | null>(null)
  const designRevision = useRef(design.revision)
  designRevision.current = design.revision
  const hasUnsavedChanges = savedId !== null && savedRevision !== design.revision

  // Rebuilt only when the design actually changes -- a full 75-pocket tray takes
  // ~55 ms, which is fine on commit but would stutter if it ran during a drag.
  const mesh = useMemo(() => buildTrayMesh(design), [design])
  const issues = useMemo(
    () => validateDesign(design, fab, mesh, { minFloorMm: materialOf(settings.material).minFloorMm }),
    [design, fab, mesh, settings.material])

  const refresh = useCallback(async () => {
    setListLoading(true)
    try { setDesigns(await api.listDesigns()) } catch (e) { setError((e as Error).message) }
    finally { setListLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // The project picker's contents. A failure here just leaves the picker empty:
  // the designer works fine without knowing every project.
  const refreshProjects = useCallback(async () => {
    try { setProjectList(await projects.listProjects()) } catch { /* picker stays empty */ }
  }, [])

  useEffect(() => { void refreshProjects() }, [refreshProjects])

  // Landing on the gate (no tray in the URL): re-pull both lists so a project
  // or tray made elsewhere shows up, and so "open" lands on the newest tray.
  useEffect(() => {
    if (!designId) { void refresh(); void refreshProjects() }
  }, [designId, refresh, refreshProjects])

  // The settings page decides how a designer opens. Applied to the current
  // state only while nothing is loaded and untouched -- a tray already open,
  // or edits already made, are not overwritten by a preference arriving late.
  useEffect(() => {
    let cancelled = false
    void designerDefaults().then(defaults => {
      if (cancelled) return
      // `material` is a per-tray working choice, not one of the settings-page
      // "how a designer opens" preferences, so it is not in KeycapTrayDefaults.
      const base: ViewSettings = { ...DEFAULT_VIEW_SETTINGS, ...defaults.keycapTray }
      setBaseline(base)
      // Only while nothing is loaded and untouched: a preference arriving late
      // must not overwrite a tray already open or edits already made.
      setSettings(current => (current === DEFAULT_VIEW_SETTINGS ? base : current))
      setBaselineReady(true)
    })
    return () => { cancelled = true }
  }, [])

  // The project the open tray belongs to, from the list: the summary already
  // carries its name, so the header chip costs no extra request.
  const owningProject = designs.find(s => s.id === savedId)
  const owningProjectId = owningProject?.projectId ?? null

  // Already in hand from the list, so switching between a project's trays costs
  // nothing extra -- and a set is laid out across several of them at once.
  const siblingTrays = owningProjectId
    ? designs.filter(s => s.projectId === owningProjectId)
    : []

  // The set and the *other* trays' pockets, for the coverage panel. This tray
  // is excluded on purpose -- its pockets are read live from the design below,
  // unsaved edits included, and counting the saved copy too would double them.
  useEffect(() => {
    if (!owningProjectId || !savedId) { setProject(null); return }
    let cancelled = false
    void projects.getProject(owningProjectId, savedId)
      .then(result => { if (!cancelled) setProject(result) })
      // A coverage panel that will not load is simply absent; the designer
      // works without it and must not report someone else's failure.
      .catch(() => { if (!cancelled) setProject(null) })
    return () => { cancelled = true }
  }, [owningProjectId, savedId, savedRevision])

  const selectedPockets = useMemo(
    () => design.pockets.filter(p => selection.has(p.id)), [design.pockets, selection])

  const save = useCallback(async () => {
    const submittedRevision = design.revision
    setBusy(true)
    try {
      if (savedId) {
        await api.updateDesign(savedId, design)
      } else {
        const { id } = await api.createDesign(design)
        setSavedId(id)
      }
      setSavedRevision(submittedRevision)
      setToast(
        designRevision.current === submittedRevision
          ? (savedId ? 'Saved' : 'Saved as a new design')
          : 'Saved earlier changes — newer edits are still unsaved',
      )
      await refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, design, refresh])

  const load = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current
    setBusy(true)
    try {
      const loaded = await api.getDesign(id)
      if (generation !== loadGeneration.current) return
      d.setDesign(loaded)
      // How this tray was last being looked at. Applied here rather than in an
      // effect on `savedId`, so it lands in the same commit as the design and
      // there is no window where one tray's settings sit over another's.
      setSettings(loadViewSettings(id, baselineRef.current))
      answeredForUrl.current = id
      setSavedId(id)
      setSavedRevision(0)
      setOpenDialog(false)
      setFitToken(t => t + 1)
      // Keep the summary list current so the header names the right project --
      // a tray just cloned or created is not in the list the page loaded with.
      void refresh()
      // Guarded, so the effect that loads *from* the URL does not push a
      // duplicate history entry on its way back here.
      if (designId !== id) navigate(`/keycap-tray/${id}`)
    } catch (e) {
      if (generation === loadGeneration.current) setError((e as Error).message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [d, designId, navigate, refresh])

  // Written on change rather than on unload: a browser tab closed by force
  // still remembers, and the write is a few hundred bytes.
  useEffect(() => {
    if (savedId) saveViewSettings(savedId, settings)
  }, [savedId, settings])

  // The URL is the source of truth for which tray is open, so a link from a
  // project, a reload and the back button all land on the same design.
  useEffect(() => {
    if (!baselineReady) return
    if (!designId) { answeredForUrl.current = null; return }
    if (answeredForUrl.current === designId) return
    void load(designId)
  }, [designId, load, baselineReady])

  const clone = useCallback(async () => {
    if (!savedId) { setError('Save the design before cloning it.'); return }
    setBusy(true)
    try {
      const { id } = await api.cloneDesign(savedId)
      await load(id)
      setToast('Cloned — editing the copy')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, load])

  const remove = useCallback(async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete this tray?',
      message: `"${name}" and its pockets will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteDesign(id)
      // The tray is gone; remembering how it was being looked at would only
      // hold a row in local storage for something nobody can open.
      forgetViewSettings(id)
      if (id === savedId) {
        // Address first, for the reason given on New.
        if (designId) navigate('/keycap-tray')
        answeredForUrl.current = designId ?? null
        d.setDesign(emptyDesign())
        setSettings(baselineRef.current)
        setSavedId(null)
        setSavedRevision(null)
      }
      await refresh()
      setToast('Deleted')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, d, refresh, confirm, designId, navigate])

  // Switch to another project: open its most recently touched tray, or the
  // project page itself when it has no trays yet. The list already carries
  // every tray's project and timestamp, so this costs no request.
  const goToProject = useCallback((id: string) => {
    setProjectMenu(null)
    const trays = designs
      .filter(s => s.projectId === id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    navigate(trays.length ? `/keycap-tray/${trays[0].id}` : `/projects/${id}`)
  }, [designs, navigate])

  // A tray only exists inside a project, so a new project is created with its
  // first tray already cut. The project page is where the set gets described,
  // so that is where this lands.
  const createProjectWithTray = useCallback(async () => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const { id } = await projects.createProject({ name: trimmed })
      try {
        await api.createDesign({ ...emptyDesign(), name: 'Tray 1' }, id)
      } catch {
        // The project exists; its tray can be added from the project page.
        setToast('Project created — add a tray from the project page')
      }
      setNewProjectOpen(false)
      setNewProjectName('')
      setProjectMenu(null)
      navigate(`/projects/${id}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [newProjectName, navigate])

  // Another tray for the project the open one belongs to. A set is laid out
  // across several trays, so this is the ordinary "New".
  const newTrayInProject = useCallback(async () => {
    if (!owningProjectId) { navigate('/keycap-tray'); return }
    setProjectMenu(null)
    setBusy(true)
    try {
      const seed = { ...emptyDesign(), name: `Tray ${siblingTrays.length + 1}` }
      const { id } = await api.createDesign(seed, owningProjectId)
      await load(id)
      setToast('New tray added to the project')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [owningProjectId, siblingTrays.length, load, navigate])

  // Delete / undo / redo while the canvas has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
        e.preventDefault(); d.removePockets(selection)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) d.redo(); else d.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [d, selection])

  const panel = {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
  }

  return (
    <Box
      component="section"
      aria-label="Keycap tray designer"
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateRows: 'auto minmax(0, 1fr)',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Paper component="header" sx={{ px: 1.5, py: 1 }}>
        {!designId ? (
          <Typography variant="h3" component="h1">Keycap tray</Typography>
        ) : (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography
            variant="h3"
            component="h1"
            title={design.name}
            sx={{
              maxWidth: { xs: '100%', sm: 220 },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              pr: 1,
              borderRight: { sm: 1 },
              borderColor: { sm: 'divider' },
            }}
          >
            {design.name}
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              onClick={e => setProjectMenu(e.currentTarget)}
              startIcon={<FolderOutlinedIcon fontSize="small" />}
              endIcon={<ExpandMoreIcon fontSize="small" />}
              aria-haspopup="menu"
              sx={{ maxWidth: 220, '& .MuiButton-endIcon': { ml: 0.25 } }}
            >
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {owningProject?.projectName ?? 'No project'}
              </Box>
            </Button>
            {owningProjectId && (
              <Tooltip title="Edit the project — set, photos and coverage">
                <IconButton
                  size="small"
                  aria-label="Edit project"
                  onClick={() => navigate(`/projects/${owningProjectId}`)}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <Menu
            open={!!projectMenu}
            anchorEl={projectMenu}
            onClose={() => setProjectMenu(null)}
            slotProps={{ list: { 'aria-label': 'Project' } }}
          >
            {owningProjectId && siblingTrays.map(tray => (
              <MenuItem
                key={tray.id}
                selected={tray.id === savedId}
                disabled={busy}
                onClick={() => { setProjectMenu(null); void load(tray.id) }}
              >
                {tray.name}
                <Typography
                  variant="body2" color="text.secondary" component="span" sx={{ ml: 1 }}
                >
                  {tray.pocketCount} pockets
                </Typography>
              </MenuItem>
            ))}
            {owningProjectId && (
              <MenuItem disabled={busy} onClick={() => void newTrayInProject()}>
                New tray in this project
              </MenuItem>
            )}
            {owningProjectId && <Divider />}
            {projectList
              .filter(p => p.id !== owningProjectId)
              .map(p => (
                <MenuItem key={p.id} disabled={busy} onClick={() => goToProject(p.id)}>
                  {owningProjectId ? p.name : `Open ${p.name}`}
                </MenuItem>
              ))}
            <MenuItem
              disabled={busy}
              onClick={() => { setProjectMenu(null); setNewProjectName(''); setNewProjectOpen(true) }}
            >
              New project…
            </MenuItem>
          </Menu>

          <ToggleButtonGroup
            exclusive size="small" value={view} onChange={(_e, v) => v && patch({ view: v as CanvasMode })}
            aria-label="Canvas mode"
          >
            <ToggleButton value="2d">Layout</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title="Undo (⌘Z)"><span>
              <IconButton size="small" aria-label="Undo" disabled={!d.canUndo} onClick={d.undo}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Redo (⇧⌘Z)"><span>
              <IconButton size="small" aria-label="Redo" disabled={!d.canRedo} onClick={d.redo}>
                <RedoIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Delete selected (⌫)"><span>
              <IconButton
                size="small" aria-label="Delete selected pockets"
                disabled={!selection.size} onClick={() => d.removePockets(selection)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Zoom and centre the view on the tray outline">
              <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>
            </Tooltip>
          </Stack>

          <Stack
            direction="row" spacing={1}
            sx={{ ml: 'auto', alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <ExportPanel
              design={design} mesh={mesh} issues={issues}
              target={target} onTarget={next => patch({ target: next })}
            />

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              size="small" startIcon={<AddIcon />}
              disabled={busy}
              onClick={() => void newTrayInProject()}
            >
              New tray
            </Button>
            <Button
              size="small"
              disabled={busy}
              onClick={() => { setOpenDialog(true); void refresh() }}
            >
              Open
            </Button>
            <Button
              size="small" startIcon={<ContentCopyIcon />} disabled={!savedId || busy}
              onClick={() => void clone()}
            >
              Clone
            </Button>
            <Button
              size="small" variant="contained" onClick={() => void save()} disabled={busy}
              startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
            >
              {hasUnsavedChanges ? 'Save changes' : 'Save'}
            </Button>
            </Stack>
          </Stack>
        </Stack>
        )}
      </Paper>

      {!designId ? (
        <ProjectGate
          projects={projectList}
          busy={busy}
          onNewProject={() => { setNewProjectName(''); setNewProjectOpen(true) }}
          onOpenProject={goToProject}
        />
      ) : (
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          minHeight: 0,
          gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)', lg: '220px minmax(0, 1fr) 312px' },
          gridTemplateRows: { xs: 'minmax(360px, 55vh) auto auto', md: 'minmax(0, 1fr)' },
        }}
      >
        <Paper sx={{ ...panel, order: { xs: 2, md: 0 } }}>
          <PocketPalette
            sizing={design.sizing}
            onAdd={(item: PaletteItem) => d.addPocket(item.units, 10, 10, paletteItemExtra(item))}
          />
        </Paper>

        <Paper
          sx={{
            position: 'relative',
            minHeight: 0,
            overflow: 'hidden',
            order: { xs: 1, md: 0 },
            bgcolor: 'background.default',
          }}
        >
          {view === '2d' ? (
            <TrayCanvas
              design={design} selection={selection} issues={issues}
              snapMm={snapMm} gridMm={gridMm} showPlate={showPlate && target === 'print'} showLabels={showLabels}
              showBuffer={showBuffer} bufferMm={bufferMm}
              inset={CANVAS_INSET} fitToken={fitToken}
              plateWidthMm={fab.plateWidthMm} plateDepthMm={fab.plateDepthMm}
              onSelect={d.toggleSelection}
              onClearSelection={() => d.setSelection([])}
              onMove={d.movePockets}
              onRotate={(id, deg) => d.updatePocket(id, { rotationDeg: deg })}
              onDropItem={(item, x, y) => d.addPocket(item.units, x, y, paletteItemExtra(item))}
            />
          ) : (
            <Suspense fallback={<LoadingState label="Loading the 3D viewer…" />}>
              <TrayViewer3D mesh={mesh} />
            </Suspense>
          )}
          <Typography
            variant="body2"
            aria-live="polite"
            sx={{
              position: 'absolute', bottom: 8, left: 12,
              color: 'text.secondary', pointerEvents: 'none',
            }}
          >
            {design.pockets.length} pockets · {mesh.triangleCount.toLocaleString()} triangles
            {selection.size > 0 && ` · ${selection.size} selected`}
          </Typography>
        </Paper>

        <Paper sx={{ ...panel, order: { xs: 3, md: 0 } }}>
          <PropertiesPanel
            design={design} selected={selectedPockets} fab={fab}
            imperial={imperial} onImperial={next => patch({ imperial: next })}
            view={settings} onView={patch}
            onProfile={p => { d.setProfile(p); setFitToken(t => t + 1) }} onSizing={d.setSizing}
            onDesign={mutate => d.replace(mutate)}
            onPocket={d.updatePocket} onFab={setFab}
            coverage={project && owningProjectId && owningProject?.projectName
              ? {
                projectId: owningProjectId,
                projectName: owningProject.projectName,
                items: project.items,
                otherTrays: project.coverage,
              }
              : undefined}
          />
        </Paper>
      </Box>
      )}

      <Dialog
        open={!!designId && openDialog}
        onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth
      >
        <DialogTitle>Saved trays</DialogTitle>
        <DialogContent dividers>
          {listLoading && <LoadingState label="Loading your saved trays…" fill={false} />}
          {!listLoading && !designs.length && (
            <EmptyState
              title="No saved trays yet"
              description="Lay out some pockets and choose Save to keep this design."
            />
          )}
          {!listLoading && designs.map(s => (
            <Stack
              key={s.id} direction="row" spacing={1}
              sx={{ alignItems: 'center', py: 0.75 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {s.projectName && `${s.projectName} · `}
                  {s.pocketCount} pockets · updated {formatUpdated(s.updatedAt)}
                </Typography>
              </Box>
              <Button size="small" disabled={busy} onClick={() => void load(s.id)}>Open</Button>
              <IconButton
                size="small" aria-label={`Delete ${s.name}`}
                disabled={busy}
                onClick={() => void remove(s.id, s.name)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </DialogContent>
        <DialogActions><Button onClick={() => setOpenDialog(false)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog
        open={newProjectOpen} onClose={() => setNewProjectOpen(false)} fullWidth maxWidth="xs"
      >
        <DialogTitle>New project</DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus fullWidth size="small" label="Name"
            placeholder="GMK Olivia"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createProjectWithTray() }}
            helperText="Opens the project page with its first tray ready and photos to upload."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewProjectOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newProjectName.trim() || busy}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            onClick={() => void createProjectWithTray()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast ?? ''}
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Box>
  )
}
