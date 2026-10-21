import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, MenuItem, Paper, Snackbar, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { standardMenu, useAppMenu } from '../../components/menu/AppMenu.tsx'
import { writeBinaryStl } from '../../export/stl.ts'
import { writeThreeMf } from '../../export/threemf.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { formatUpdated } from '../keycap-projects/model/formatUpdated.ts'
import { emptyDesign } from './model/defaults.ts'
import { buildToolTrayMesh, resolveLevels } from './geometry/bands.ts'
import { DEFAULT_TOOL_FABRICATION, validateDesign } from './geometry/validate.ts'
import { useToolTrayDesign } from './state/useToolTrayDesign.ts'
import {
  DEFAULT_VIEW_SETTINGS, forgetViewSettings, loadViewSettings, saveViewSettings, SNAP_STEPS_MM,
} from './state/viewSettings.ts'
import type { ViewSettings } from './state/viewSettings.ts'
import * as api from './service.ts'
import type { ToolTraySummary } from './service.ts'
import { ToolTrayCanvas } from './components/ToolTrayCanvas.tsx'
import PartPalette from './components/PartPalette.tsx'
import PackPanel from './components/PackPanel.tsx'
import { MATERIALS } from '../keycap-tray/model/materials.ts'
import ToolTrayPanel from './components/ToolTrayPanel.tsx'
import ToolExportPanel from './components/ToolExportPanel.tsx'

// three.js is a third of the bundle and the layout is the default view, so the
// viewer is only fetched when someone actually switches to 3D.
const SolidViewer3D = lazy(() => import('../../components/viewport3d/SolidViewer3D.tsx'))

const CANVAS_INSET = { left: 0, right: 0, top: 0, bottom: 0 }

export default function ToolTrayPage() {
  const confirm = useConfirm()
  const { designId } = useParams()
  const navigate = useNavigate()
  const d = useToolTrayDesign()
  const { design, selection } = d

  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS)
  const [designs, setDesigns] = useState<ToolTraySummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [fitToken, setFitToken] = useState(0)

  const loadGeneration = useRef(0)
  const answeredForUrl = useRef<string | null>(null)
  const designRevision = useRef(design.revision)
  designRevision.current = design.revision
  const hasUnsavedChanges = savedId !== null && savedRevision !== design.revision

  const view = (patch: Partial<ViewSettings>) => setSettings(s => ({ ...s, ...patch }))

  const mesh = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => buildToolTrayMesh(design), [design.revision])
  const levels = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => resolveLevels(design).length, [design.revision])
  const issues = useMemo(
    () => validateDesign(design, {
      fabrication: { ...DEFAULT_TOOL_FABRICATION, material: settings.material },
      mesh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.revision, settings.material, mesh])

  /** Pockets the validator has something to say about, for the canvas. */
  const flagged = useMemo(
    () => new Set(issues.flatMap(i => i.pocketIds ?? [])), [issues])

  const selected = useMemo(
    () => (selection.size === 1
      ? design.pockets.find(p => selection.has(p.id)) ?? null
      : null),
    [design.pockets, selection])

  const refresh = useCallback(async () => {
    setListLoading(true)
    try { setDesigns(await api.listDesigns()) } catch (e) { setError((e as Error).message) }
    finally { setListLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async () => {
    const submittedRevision = design.revision
    setBusy(true)
    try {
      let id = savedId
      if (id) {
        await api.updateDesign(id, design)
      } else {
        id = (await api.createDesign(design)).id
        setSavedId(id)
      }
      setSavedRevision(submittedRevision)
      setToast(
        designRevision.current === submittedRevision
          ? (savedId ? 'Saved' : 'Saved as a new tray')
          : 'Saved earlier changes — newer edits are still unsaved',
      )
      await refresh()
      if (!savedId && id) { answeredForUrl.current = id; navigate(`/tool-tray/${id}`) }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, design, refresh, navigate])

  const load = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current
    setBusy(true)
    try {
      const loaded = await api.getDesign(id)
      if (generation !== loadGeneration.current) return
      d.setDesign(loaded)
      setSettings(loadViewSettings(id, DEFAULT_VIEW_SETTINGS))
      answeredForUrl.current = id
      setSavedId(id)
      setSavedRevision(0)
      setOpenDialog(false)
      setFitToken(t => t + 1)
      if (designId !== id) navigate(`/tool-tray/${id}`)
    } catch (e) {
      if (generation === loadGeneration.current) setError((e as Error).message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [d, designId, navigate])

  useEffect(() => {
    if (savedId) saveViewSettings(savedId, settings)
  }, [savedId, settings])

  // The URL is the source of truth for which tray is open, so a link, a reload
  // and the back button all land on the same design.
  useEffect(() => {
    if (!designId) { answeredForUrl.current = null; return }
    if (answeredForUrl.current === designId) return
    void load(designId)
  }, [designId, load])

  const startNew = useCallback(() => {
    if (designId) navigate('/tool-tray')
    answeredForUrl.current = null
    d.setDesign(emptyDesign())
    setSettings(DEFAULT_VIEW_SETTINGS)
    setSavedId(null)
    setSavedRevision(null)
    setFitToken(t => t + 1)
  }, [d, designId, navigate])

  const clone = useCallback(async () => {
    if (!savedId) { setError('Save the tray before cloning it.'); return }
    setBusy(true)
    try {
      const { id } = await api.cloneDesign(savedId)
      await load(id)
      setToast('Cloned — editing the copy')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, load])

  const remove = useCallback(async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete this tool tray?',
      message: `"${name}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteDesign(id)
      forgetViewSettings(id)
      if (id === savedId) startNew()
      await refresh()
      setToast('Deleted')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, refresh, confirm, startNew])

  // Delete removes the selected pockets, which is the one keyboard gesture the
  // canvas cannot express as a click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (!selection.size) return
      e.preventDefault()
      d.removePockets(selection)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [d, selection])

  const downloadMesh = (format: 'stl' | '3mf') => {
    const base = safeFilename(design.name)
    if (format === 'stl') {
      triggerDownload(writeBinaryStl(mesh, design.name), `${base}.stl`, 'model/stl')
      return
    }
    triggerDownload(writeThreeMf(mesh, design.name), `${base}.3mf`, 'model/3mf')
  }

  useAppMenu(standardMenu({
    onNew: startNew,
    onOpen: () => { setOpenDialog(true); void refresh() },
    onSave: () => void save(),
    saveDisabled: busy,
    exports: [
      { label: 'Export STL', onClick: () => downloadMesh('stl') },
      { label: 'Export 3MF', onClick: () => downloadMesh('3mf') },
    ],
    file: [
      { label: 'Make a copy', onClick: savedId ? () => void clone() : undefined, disabled: busy },
    ],
    onUndo: d.undo,
    onRedo: d.redo,
    canUndo: d.canUndo,
    canRedo: d.canRedo,
    onDelete: () => d.removePockets(selection),
    canDelete: selection.size > 0,
    view: [{ label: 'Fit to window', onClick: () => setFitToken(t => t + 1) }],
  }))

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Paper
        variant="outlined"
        sx={{ p: 1, borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h3" component="h1" sx={{ mr: 1 }}>
            {design.name || 'Untitled tool tray'}
            {hasUnsavedChanges || savedId === null ? ' •' : ''}
          </Typography>

          <ToggleButtonGroup
            exclusive size="small" value={settings.view}
            aria-label="Canvas view"
            onChange={(_e, v) => v && view({ view: v as ViewSettings['view'] })}
          >
            <ToggleButton value="2d">Layout</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            select size="small" label="Snap" value={settings.snapMm}
            onChange={e => view({ snapMm: Number(e.target.value) })}
            sx={{ minWidth: 96 }}
          >
            {SNAP_STEPS_MM.map(v => (
              <MenuItem key={v} value={v}>{v} mm</MenuItem>
            ))}
          </TextField>

          <ToolExportPanel mesh={mesh} issues={issues} />
        </Stack>
      </Paper>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '260px 1fr 320px' },
          gridTemplateRows: { xs: 'auto 1fr auto', lg: '1fr' },
        }}
      >
        <Paper
          variant="outlined"
          sx={{ borderRadius: 0, borderTop: 0, borderLeft: 0, minHeight: 0, overflowY: 'auto', p: 1.5 }}
        >
          <PartPalette
            onAdd={d.addFromPreset}
            onTrace={(traced, name) => {
              // One depth, and a shallow one: a traced outline says what shape
              // the part is, never how deep it sits. The tier editor is where
              // that gets set, and a too-shallow pocket is obvious on sight
              // where a too-deep one quietly eats the floor.
              d.addTraced(traced, name, Math.min(8, design.heightMm - design.minFloorMm))
            }}
            clearanceMm={MATERIALS[settings.material].pocketClearanceMm}
            disabled={busy}
          />
          <Divider sx={{ my: 2 }} />
          <PackPanel onPack={d.packFrom} disabled={busy} />
        </Paper>

        <Box sx={{ position: 'relative', minHeight: 0 }}>
          {settings.view === '2d' ? (
            <ToolTrayCanvas
              design={design}
              selection={selection}
              inset={CANVAS_INSET}
              fitToken={fitToken}
              showKeepOuts={settings.showKeepOuts}
              showDepths={settings.showDepths}
              snapMm={settings.snapMm}
              flagged={flagged}
              onSelect={d.toggleSelection}
              onClearSelection={() => d.setSelection([])}
              onMove={d.movePockets}
            />
          ) : (
            <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
              <SolidViewer3D mesh={mesh} label="the tool tray" />
            </Suspense>
          )}
          <Typography
            variant="body2" color="text.secondary"
            sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}
          >
            {design.pockets.length} pockets · {levels} floor levels ·{' '}
            {mesh.triangleCount.toLocaleString()} triangles
          </Typography>
        </Box>

        <Paper
          variant="outlined"
          sx={{ borderRadius: 0, borderTop: 0, borderRight: 0, minHeight: 0, overflowY: 'auto', p: 1.5 }}
        >
          <ToolTrayPanel
            design={design}
            selected={selected}
            issues={issues}
            imperial={settings.imperial}
            material={settings.material}
            levels={levels}
            onMaterial={id => view({ material: id })}
            onProfile={d.setProfile}
            onHeight={d.setHeight}
            onLayerHeight={d.setLayerHeight}
            onMinFloor={d.setMinFloor}
            onUndersideReliefs={d.setUndersideReliefs}
            onCaseClearHeight={d.setCaseClearHeight}
            onFeet={d.setFeet}
            onPocket={d.updatePocket}
            onStep={d.updateStep}
            onAddStep={d.addStep}
            onRemoveStep={d.removeStep}
            onFingerAccess={d.setFingerAccess}
          />
        </Paper>
      </Box>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Open a tool tray</DialogTitle>
        <DialogContent dividers>
          {listLoading && <CircularProgress size={20} />}
          {!listLoading && designs.length === 0 && (
            <EmptyState
              title="No tool trays yet"
              description="Close this and press Save to keep the one you are working on."
            />
          )}
          <Stack divider={<Divider />}>
            {designs.map(s => (
              <Stack
                key={s.id} direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1 }}
              >
                <Button sx={{ justifyContent: 'flex-start', flex: 1 }} onClick={() => void load(s.id)}>
                  <Stack sx={{ alignItems: 'flex-start' }}>
                    <Typography>{s.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {s.pocketCount} {s.pocketCount === 1 ? 'pocket' : 'pockets'} ·{' '}
                      {formatUpdated(s.updatedAt)}
                    </Typography>
                  </Stack>
                </Button>
                <Tooltip title="Delete">
                  <IconButton
                    size="small" aria-label={`Delete ${s.name}`}
                    onClick={() => void remove(s.id, s.name)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''}
      />
      <Snackbar open={!!error} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Stack>
  )
}
