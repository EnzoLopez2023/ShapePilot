import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Paper, Snackbar, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SaveIcon from '@mui/icons-material/SaveOutlined'
import AddIcon from '@mui/icons-material/Add'
import { buildTrayMesh } from './geometry/layers.ts'
import { validateDesign } from './geometry/validate.ts'
import type { Target } from './geometry/validate.ts'
import { DEFAULT_FABRICATION, paletteItemExtra } from './model/defaults.ts'
import type { PaletteItem } from './model/defaults.ts'
import type { FabricationSettings } from './model/types.ts'
import { emptyDesign } from './model/presets.ts'
import { useTrayDesign } from './state/useTrayDesign.ts'
import * as api from './service.ts'
import TrayCanvas from './components/TrayCanvas.tsx'
import PocketPalette from './components/PocketPalette.tsx'
import PropertiesPanel from './components/PropertiesPanel.tsx'
import ExportPanel from './components/ExportPanel.tsx'
import HoverTooltip from '../../components/HoverTooltip.tsx'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, LoadingState } from '../../components/LoadingState.tsx'

type Mode = '2d' | '3d'

// three.js is a third of the bundle and the 2D layout is the default view, so
// the viewer is only fetched when someone actually switches to 3D.
const TrayViewer3D = lazy(() => import('./components/TrayViewer3D.tsx'))

// The panels sit beside the canvas rather than over it, so fit-to-view has the
// whole element to work with. Hoisted so the fit effect's dependencies stay
// stable -- an inline object literal re-runs it on every render.
const CANVAS_INSET = { left: 0, right: 0, top: 0, bottom: 0 }

// Snap steps: 0.5 mm through 5 mm in 0.5 mm increments, plus the key pitch.
const SNAP_STEPS_MM = Array.from({ length: 10 }, (_, i) => (i + 1) * 0.5)
// Buffer guide distances, in mm inside the tray edge.
const BUFFER_STEPS_MM = [1, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10]

export default function KeycapTrayPage() {
  const confirm = useConfirm()
  const d = useTrayDesign()
  const { design, selection } = d

  const [view, setView] = useState<Mode>('2d')
  const [fab, setFab] = useState<FabricationSettings>(DEFAULT_FABRICATION)
  const [snapMm, setSnapMm] = useState(0.5)
  const [gridMm, setGridMm] = useState(5)
  const [showLabels, setShowLabels] = useState(true)
  const [showPlate, setShowPlate] = useState(false)
  const [showBuffer, setShowBuffer] = useState(false)
  // Lifted from ExportPanel: the build-plate controls only make sense for the
  // 3D printer, so the toolbar needs to know the target too.
  const [target, setTarget] = useState<Target>('print')
  const [bufferMm, setBufferMm] = useState(DEFAULT_FABRICATION.minWallMm)
  const [imperial, setImperial] = useState(false)
  const [designs, setDesigns] = useState<api.DesignSummary[]>([])
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [fitToken, setFitToken] = useState(0)
  const loadGeneration = useRef(0)
  const designRevision = useRef(design.revision)
  designRevision.current = design.revision
  const hasUnsavedChanges = savedId !== null && savedRevision !== design.revision

  // Rebuilt only when the design actually changes -- a full 75-pocket tray takes
  // ~55 ms, which is fine on commit but would stutter if it ran during a drag.
  const mesh = useMemo(() => buildTrayMesh(design), [design])
  const issues = useMemo(() => validateDesign(design, fab, mesh), [design, fab, mesh])

  const refresh = useCallback(async () => {
    setListLoading(true)
    try { setDesigns(await api.listDesigns()) } catch (e) { setError((e as Error).message) }
    finally { setListLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

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
      setSavedId(id)
      setSavedRevision(0)
      setOpenDialog(false)
      setFitToken(t => t + 1)
    } catch (e) {
      if (generation === loadGeneration.current) setError((e as Error).message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [d])

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
      if (id === savedId) {
        d.setDesign(emptyDesign())
        setSavedId(null)
        setSavedRevision(null)
      }
      await refresh()
      setToast('Deleted')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, d, refresh, confirm])

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

          <ToggleButtonGroup
            exclusive size="small" value={view} onChange={(_e, v) => v && setView(v)}
            aria-label="Canvas mode"
          >
            <ToggleButton value="2d">Layout</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>

          <Stack direction="row" spacing={0.5}>
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
          </Stack>

          <HoverTooltip title="How far a dragged or dropped pocket jumps between positions. 1u pitch lines pockets up key-to-key.">
            <TextField
              select size="small" label="Snap" value={snapMm}
              onChange={e => setSnapMm(parseFloat(e.target.value))}
              sx={{ width: 104 }}
            >
              <MenuItem value={0}>Off</MenuItem>
              {SNAP_STEPS_MM.map(v => (
                <MenuItem key={v} value={v}>{v} mm</MenuItem>
              ))}
              <MenuItem value={19.05}>1u pitch</MenuItem>
            </TextField>
          </HoverTooltip>
          <HoverTooltip title="Reference grid drawn on the canvas — purely visual, independent of Snap.">
            <TextField
              select size="small" label="Grid" value={gridMm}
              onChange={e => setGridMm(parseFloat(e.target.value))}
              sx={{ width: 96 }}
            >
              <MenuItem value={0}>Off</MenuItem>
              <MenuItem value={2}>2 mm</MenuItem>
              <MenuItem value={3}>3 mm</MenuItem>
              <MenuItem value={4}>4 mm</MenuItem>
              <MenuItem value={5}>5 mm</MenuItem>
            </TextField>
          </HoverTooltip>

          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Button size="small" aria-pressed={showLabels} onClick={() => setShowLabels(v => !v)}>
              {showLabels ? 'Hide labels' : 'Show labels'}
            </Button>
            <Tooltip title="Zoom and centre the view on the tray outline">
              <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>
            </Tooltip>
            {target === 'print' && (
              <Tooltip title="Outline of the printer build plate, from Plate W/D in Fabrication">
                <Button size="small" aria-pressed={showPlate} onClick={() => setShowPlate(v => !v)}>
                  {showPlate ? 'Hide plate' : 'Show plate'}
                </Button>
              </Tooltip>
            )}
            <Tooltip title={`A dashed line ${bufferMm} mm inside the tray edge. Keep pockets clear of it for a durable rim; ${fab.minWallMm} mm matches the minimum wall used by the wall-thickness check.`}>
              <Button size="small" aria-pressed={showBuffer} onClick={() => setShowBuffer(v => !v)}>
                {showBuffer ? 'Hide buffer' : 'Show buffer'}
              </Button>
            </Tooltip>
            <HoverTooltip title="Distance the dashed buffer guide sits inside the tray edge. Purely visual — a wider margin than the minimum wall gives pockets more breathing room from the rim.">
              <TextField
                select size="small" label="Buffer" value={bufferMm}
                onChange={e => setBufferMm(parseFloat(e.target.value))}
                disabled={!showBuffer}
                sx={{ width: 104 }}
              >
                {BUFFER_STEPS_MM.map(v => (
                  <MenuItem key={v} value={v}>
                    {v === DEFAULT_FABRICATION.minWallMm ? `${v} mm · min wall` : `${v} mm`}
                  </MenuItem>
                ))}
              </TextField>
            </HoverTooltip>
          </Stack>

          <Box sx={{ flex: 1, minWidth: 0 }} />

          <ExportPanel
            design={design} mesh={mesh} issues={issues}
            target={target} onTarget={setTarget}
          />

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              size="small" startIcon={<AddIcon />}
              disabled={busy}
              onClick={() => {
                loadGeneration.current += 1
                d.setDesign(emptyDesign())
                setSavedId(null)
                setSavedRevision(null)
              }}
            >
              New
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
      </Paper>

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
            imperial={imperial} onImperial={setImperial}
            onProfile={p => { d.setProfile(p); setFitToken(t => t + 1) }} onSizing={d.setSizing}
            onDesign={mutate => d.replace(mutate)}
            onPocket={d.updatePocket} onFab={setFab}
          />
        </Paper>
      </Box>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
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
                  {s.pocketCount} pockets · updated {s.updatedAt}
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

      <Snackbar
        open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast ?? ''}
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Box>
  )
}
