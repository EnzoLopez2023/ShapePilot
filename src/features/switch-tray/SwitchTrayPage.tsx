import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Paper, Snackbar, Stack, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import AddIcon from '@mui/icons-material/Add'
import type { MultiPolygon } from '../../geometry/vec.ts'
import { profileToMulti } from '../../model/trayProfile.ts'
import { DEFAULT_FONT_ID, loadFont, traceTextPolys } from '../../text/fonts.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'
import { formatUpdated } from '../keycap-projects/model/formatUpdated.ts'
import { cellKeepoutMm, emptyDesign } from './model/defaults.ts'
import { planFill } from './geometry/fill.ts'
import { feetRects } from './geometry/feet.ts'
import {
  buildFeetMesh, buildNameplateMesh, buildSwitchTrayMesh,
} from './geometry/layers.ts'
import { validateDesign } from './geometry/validate.ts'
import { useSwitchTrayDesign } from './state/useSwitchTrayDesign.ts'
import {
  DEFAULT_VIEW_SETTINGS, forgetViewSettings, loadViewSettings, saveViewSettings,
} from './state/viewSettings.ts'
import type { ViewSettings } from './state/viewSettings.ts'
import * as api from './service.ts'
import type { SwitchTraySummary } from './service.ts'
import { SwitchTrayCanvas } from './components/SwitchTrayCanvas.tsx'
import SwitchPanel from './components/SwitchPanel.tsx'
import FillPanel from './components/FillPanel.tsx'
import SwitchExportPanel from './components/SwitchExportPanel.tsx'
import type { ExtraPart } from './components/SwitchExportPanel.tsx'

// three.js is a third of the bundle and the 2D layout is the default view, so
// the viewer is only fetched when someone actually switches to 3D.
const SolidViewer3D = lazy(() => import('../../components/viewport3d/SolidViewer3D.tsx'))

// The panels sit beside the canvas rather than over it, so fit-to-view has the
// whole element to work with. Hoisted so the fit effect's dependencies stay
// stable -- an inline object literal re-runs it on every render.
const CANVAS_INSET = { left: 0, right: 0, top: 0, bottom: 0 }

export default function SwitchTrayPage() {
  const confirm = useConfirm()
  const { designId } = useParams()
  const navigate = useNavigate()
  const d = useSwitchTrayDesign()
  const { design } = d

  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS)
  const [designs, setDesigns] = useState<SwitchTraySummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [fitToken, setFitToken] = useState(0)

  const loadGeneration = useRef(0)
  // Which URL the loader has already answered, so the effect below does not
  // re-open a tray the user has since navigated away from.
  const answeredForUrl = useRef<string | null>(null)
  const designRevision = useRef(design.revision)
  designRevision.current = design.revision
  const hasUnsavedChanges = savedId !== null && savedRevision !== design.revision

  const view = (patch: Partial<ViewSettings>) => setSettings(s => ({ ...s, ...patch }))

  // Nameplate glyph outlines, traced only when the name or the cap height
  // changes. Null until the font resolves, so the first paint does not block.
  const [nameplatePolys, setNameplatePolys] = useState<MultiPolygon | null>(null)
  const npFontSizeMm = design.nameplate?.fontSizeMm
  useEffect(() => {
    if (npFontSizeMm === undefined || !design.name.trim()) {
      setNameplatePolys(null)
      return
    }
    let cancelled = false
    void loadFont(DEFAULT_FONT_ID)
      .then(font => {
        if (!cancelled) setNameplatePolys(traceTextPolys(font, design.name, npFontSizeMm))
      })
      .catch(() => { if (!cancelled) setNameplatePolys(null) })
    return () => { cancelled = true }
  }, [design.name, npFontSizeMm])

  // The posts are placed against the outline alone, and the fill then treats
  // their footprints as occupied -- which is what keeps a cell off a post
  // without the two needing to know about each other.
  const fitted = useMemo(
    () => feetRects(design.profile, design.feet), [design.profile, design.feet])

  const plan = useMemo(
    () => planFill({
      region: profileToMulti(design.profile),
      blockers: fitted,
      keepoutMm: cellKeepoutMm(design.plate, design.switch),
      marginMm: design.fill.marginMm,
      pitchXMm: design.fill.pitchXMm,
      pitchYMm: design.fill.pitchYMm,
      stagger: design.fill.stagger,
      origin: design.fill.origin,
      spreadEvenly: design.fill.spreadEvenly,
      skippedCells: design.skippedCells,
    }),
    // `revision` is bumped on every mutation, which is cheaper than deep
    // comparing the settings objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.revision, fitted],
  )

  // `mesh` is the welded single body for the 3D preview and validation; export
  // splits off any second-filament bodies. `buildSwitchTrayMesh` with no
  // options already omits the nameplate and, when `feet.separate` is set, the
  // feet -- so it *is* the body-only mesh.
  const mesh = useMemo(
    () => buildSwitchTrayMesh(
      design, plan, nameplatePolys ? { nameplateOutlines: nameplatePolys } : undefined),
    [design, plan, nameplatePolys])
  const nameplateMesh = useMemo(
    () => buildNameplateMesh(design, plan, nameplatePolys), [design, plan, nameplatePolys])
  const feetMesh = useMemo(() => buildFeetMesh(design), [design])
  const extraParts = useMemo<ExtraPart[]>(() => {
    const parts: ExtraPart[] = []
    if (nameplateMesh) parts.push({ mesh: nameplateMesh, suffix: 'nameplate', label: 'nameplate' })
    if (feetMesh) parts.push({ mesh: feetMesh, suffix: 'feet', label: 'feet' })
    return parts
  }, [nameplateMesh, feetMesh])
  const bodyMesh = useMemo(
    () => (extraParts.length
      ? buildSwitchTrayMesh(design, plan, { omitSeparateParts: true })
      : mesh),
    [design, plan, extraParts, mesh])

  const issues = useMemo(
    () => validateDesign(design, plan, { fittedFeet: fitted.length, mesh }),
    [design, plan, fitted, mesh])

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
      if (!savedId && id) { answeredForUrl.current = id; navigate(`/switch-tray/${id}`) }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, design, refresh, navigate])

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
      setSettings(loadViewSettings(id, DEFAULT_VIEW_SETTINGS))
      answeredForUrl.current = id
      setSavedId(id)
      setSavedRevision(0)
      setOpenDialog(false)
      setFitToken(t => t + 1)
      if (designId !== id) navigate(`/switch-tray/${id}`)
    } catch (e) {
      if (generation === loadGeneration.current) setError((e as Error).message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [d, designId, navigate])

  // Written on change rather than on unload: a tab closed by force still
  // remembers, and the write is a few hundred bytes.
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
    // Address first: navigating clears the id from the URL, and the effect
    // above must not read the old one back.
    if (designId) navigate('/switch-tray')
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
      title: 'Delete this switch tray?',
      message: `"${name}" will be permanently removed. This cannot be undone.`,
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
      if (id === savedId) startNew()
      await refresh()
      setToast('Deleted')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, refresh, confirm, startNew])

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Paper
        variant="outlined"
        sx={{ p: 1, borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h3" component="h1" sx={{ mr: 1 }}>
            {design.name || 'Untitled switch tray'}
          </Typography>

          <ToggleButtonGroup
            exclusive size="small" value={settings.view}
            aria-label="Canvas view"
            onChange={(_e, v) => v && view({ view: v })}
          >
            <ToggleButton value="2d">Layout</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>

          <Tooltip title="Undo">
            <span>
              <IconButton size="small" disabled={!d.canUndo} onClick={d.undo} aria-label="Undo">
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo">
            <span>
              <IconButton size="small" disabled={!d.canRedo} onClick={d.redo} aria-label="Redo">
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>

          <Divider orientation="vertical" flexItem />

          <SwitchExportPanel
            design={design} mesh={bodyMesh} extraParts={extraParts} issues={issues}
          />

          <Box sx={{ flex: 1 }} />

          <Button size="small" startIcon={<AddIcon />} onClick={startNew}>New tray</Button>
          <Button size="small" onClick={() => { setOpenDialog(true); void refresh() }}>Open</Button>
          <Tooltip title="Save first — a clone copies the saved tray.">
            <span>
              <Button
                size="small" startIcon={<ContentCopyIcon />}
                disabled={!savedId || busy} onClick={() => void clone()}
              >
                Clone
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="contained" size="small" startIcon={<SaveIcon />}
            disabled={busy} onClick={() => void save()}
          >
            {savedId ? (hasUnsavedChanges ? 'Save changes' : 'Saved') : 'Save'}
          </Button>
        </Stack>
      </Paper>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '300px 1fr 320px' },
          gridTemplateRows: { xs: 'auto 1fr auto', lg: '1fr' },
        }}
      >
        <Paper variant="outlined" sx={{ borderRadius: 0, borderTop: 0, borderLeft: 0, minHeight: 0 }}>
          <SwitchPanel
            design={design}
            imperial={settings.imperial}
            onImperial={v => view({ imperial: v })}
            onProfile={d.setProfile}
            onSwitch={d.setSwitch}
            onPlate={d.setPlate}
            onDesign={d.replace}
          />
        </Paper>

        <Box sx={{ position: 'relative', minHeight: 0 }}>
          {settings.view === '2d' ? (
            <SwitchTrayCanvas
              design={design}
              plan={plan}
              inset={CANVAS_INSET}
              fitToken={fitToken}
              showHousings={settings.showHousings}
              onToggleCell={d.toggleCell}
            />
          ) : (
            <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
              <SolidViewer3D mesh={mesh} label="the switch tray" />
            </Suspense>
          )}
          <Typography
            variant="body2" color="text.secondary"
            sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}
          >
            {plan.cells.length} cells · {mesh.triangleCount.toLocaleString()} triangles
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 0, borderTop: 0, borderRight: 0, minHeight: 0 }}>
          <FillPanel
            design={design}
            plan={plan}
            issues={issues}
            fittedFeet={fitted.length}
            imperial={settings.imperial}
            onFill={d.setFill}
            onFeet={d.setFeet}
            onDesign={d.replace}
            onClearSkipped={d.clearSkipped}
          />
        </Paper>
      </Box>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Open a switch tray</DialogTitle>
        <DialogContent dividers>
          {listLoading && <CircularProgress size={20} />}
          {!listLoading && designs.length === 0 && (
            <EmptyState
              title="No switch trays yet"
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
                      {s.switchLabel || 'switch tray'} · {formatUpdated(s.updatedAt)}
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
