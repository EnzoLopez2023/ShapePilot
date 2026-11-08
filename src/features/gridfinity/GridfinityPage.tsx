import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Paper, Snackbar, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { standardMenu, useAppMenu } from '../../components/menu/AppMenu.tsx'
import { writeBinaryStl } from '../../export/stl.ts'
import { writeThreeMf, writeThreeMfParts, writeThreeMfPlates, type ThreeMfPart } from '../../export/threemf.ts'
import { fillPlates } from '../../export/plates.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { zipParts } from '../../export/zip.ts'
import { openInBambuStudio } from '../../export/bambuStudio.ts'
import { formatLength } from '../../units.ts'
import { GRID_PITCH_MM } from '../../../lib/contracts/gridfinity.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { formatUpdated } from '../keycap-projects/model/formatUpdated.ts'
import { buildBinParts, type BinParts } from './geometry/bin.ts'
import { buildLid, lidHasText, type LidParts } from './geometry/lid.ts'
import { useOwnedColors } from '../filaments/useOwnedColors.ts'
import { useAmsTrays } from '../bambu-designer/useAmsTrays.ts'
import { assignExtruders, loadedFirst } from '../bambu-designer/amsTrays.ts'
import { BASEPLATE_HEIGHT_MM, buildBaseplate, planBaseplate, type BuiltTile } from './geometry/baseplate.ts'
import { mergeMeshes, translateMesh } from './geometry/place.ts'
import type { Mesh } from '../../geometry/mesh.ts'
import {
  describe, emptyDesign, fromRecord, type GridfinityKind, type GridfinityRecord, type LabelList,
} from './model/types.ts'
import { useGridfinityDesign } from './state/useGridfinityDesign.ts'
import { loadViewSettings, saveViewSettings, type ViewSettings } from './state/viewSettings.ts'
import * as api from './service.ts'
import BinPanel from './components/BinPanel.tsx'
import BaseplatePanel from './components/BaseplatePanel.tsx'
import BaseplatePlanView from './components/BaseplatePlanView.tsx'
import LabelListsPanel, { type BatchOptions } from './components/LabelListsPanel.tsx'
import { suggestBinSize } from './model/labelSize.ts'
import { densityOf, formatGrams, formatMinutes, printMinutes, printedGrams } from '../bambu-designer/estimate.ts'
import LayoutPanel from './components/LayoutPanel.tsx'
import { binCounts, canPlace, resolveLayout, stackAt, type LayoutBin } from './model/layout.ts'
import { DEFAULT_BIN, type GridfinityBinParams } from '../../../lib/contracts/gridfinity.ts'

const SolidViewer3D = lazy(() => import('../../components/viewport3d/SolidViewer3D.tsx'))

/** Long enough that dragging through a select does not rebuild every step. */
const REBUILD_DELAY_MS = 200
/** Space between tiles in the 3D preview, so the cuts read. */
const TILE_GAP_MM = 6
/** How far above its bin the lid floats in the preview, so the catches show. */
const LID_LIFT_MM = 15
/** Gap between the bin and its lid when the lid is shown as printed. */
const LID_SIDE_GAP_MM = 10
/** The label's preview colour when no owned filament is picked, so it still reads as its own body. */
const LABEL_FALLBACK = '#e8b04a'

/** STL carries no colour, so a two-colour bin is two files aligned by their shared origin. */
function binFiles(parts: BinParts, stem: string, title: string): Record<string, Uint8Array> {
  return parts.label
    ? {
        [`${stem}_bin.stl`]: new Uint8Array(writeBinaryStl(parts.body, `${title} bin`)),
        [`${stem}_label.stl`]: new Uint8Array(writeBinaryStl(parts.label, `${title} label`)),
      }
    : { [`${stem}.stl`]: new Uint8Array(writeBinaryStl(parts.body, title)) }
}

/** A lid's STL files: one, or the lid and its inlaid label, aligned by their shared origin. */
function lidFiles(lid: LidParts, stem: string, title: string): Record<string, Uint8Array> {
  return lid.label
    ? {
        [`${stem}.stl`]: new Uint8Array(writeBinaryStl(lid.print, title)),
        [`${stem}_label.stl`]: new Uint8Array(writeBinaryStl(lid.label.print, `${title} label`)),
      }
    : { [`${stem}.stl`]: new Uint8Array(writeBinaryStl(lid.print, title)) }
}

type Built<T> = { status: 'idle' | 'building' } | { status: 'ready'; value: T } | { status: 'error'; message: string }

export default function GridfinityPage() {
  const confirm = useConfirm()
  const { designId } = useParams()
  const navigate = useNavigate()
  const d = useGridfinityDesign()
  const { design } = d
  const isBin = design.kind === 'bin'

  const [settings, setSettings] = useState<ViewSettings>(loadViewSettings)
  const [designs, setDesigns] = useState<GridfinityRecord[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [lists, setLists] = useState<LabelList[]>([])
  const [listsLoading, setListsLoading] = useState(true)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [lidView, setLidView] = useState<'seated' | 'print'>('seated')

  const loadGeneration = useRef(0)
  const answeredForUrl = useRef<string | null>(null)
  const designRevision = useRef(design.revision)
  designRevision.current = design.revision
  const hasUnsavedChanges = savedId !== null && savedRevision !== design.revision

  const view = (patch: Partial<ViewSettings>) => setSettings(s => ({ ...s, ...patch }))
  useEffect(() => { saveViewSettings(settings) }, [settings])

  // ---- Geometry. Both are built off the main render, newest request wins. ----

  const [bin, setBin] = useState<Built<BinParts & { lid: LidParts | null }>>({ status: 'idle' })
  const [lastBin, setLastBin] = useState<(BinParts & { lid: LidParts | null }) | null>(null)
  const binParams = design.bin
  useEffect(() => {
    if (!isBin) return
    let cancelled = false
    setBin({ status: 'building' })
    const timer = setTimeout(() => {
      Promise.all([buildBinParts(binParams), buildLid(binParams)])
        .then(([parts, lid]) => {
          if (cancelled) return
          const value = { ...parts, lid }
          setBin({ status: 'ready', value })
          setLastBin(value)
        })
        .catch((e: unknown) => {
          if (!cancelled) setBin({ status: 'error', message: (e as Error).message })
        })
    }, REBUILD_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [isBin, binParams])

  const plateParams = design.baseplate
  const plan = useMemo(() => planBaseplate(plateParams), [plateParams])
  const [tiles, setTiles] = useState<Built<BuiltTile[]>>({ status: 'idle' })
  const wantTiles = !isBin && (settings.view === '3d')
  useEffect(() => {
    if (!wantTiles || plan.problem) { setTiles({ status: 'idle' }); return }
    let cancelled = false
    setTiles({ status: 'building' })
    const timer = setTimeout(() => {
      buildBaseplate(plan)
        .then(value => { if (!cancelled) setTiles({ status: 'ready', value }) })
        .catch((e: unknown) => {
          if (!cancelled) setTiles({ status: 'error', message: (e as Error).message })
        })
    }, REBUILD_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [wantTiles, plan])

  const tilePreview = useMemo(() => {
    if (tiles.status !== 'ready' || !tiles.value.length) return null
    const placed = tiles.value.map(({ tile, mesh }) =>
      translateMesh(mesh, tile.x + (tile.col - 1) * TILE_GAP_MM, tile.y + (tile.row - 1) * TILE_GAP_MM))
    return mergeMeshes(placed)
  }, [tiles])

  // ---- Case layout: saved bins placed on the plate. ----

  const [placingId, setPlacingId] = useState<string | null>(null)
  const [placeRotated, setPlaceRotated] = useState(false)
  const [selectedStack, setSelectedStack] = useState<number | null>(null)
  const layoutBins = useMemo<LayoutBin[]>(() => designs
    .filter(r => r.kind === 'bin')
    .map(r => ({ id: r.id, name: r.name, params: { ...DEFAULT_BIN, ...(r.params as Partial<typeof DEFAULT_BIN>) } })),
  [designs])
  const binMap = useMemo(() => new Map(layoutBins.map(b => [b.id, b])), [layoutBins])
  const stacks = useMemo(
    () => (plan.problem ? [] : resolveLayout(plateParams, plan, binMap)), [plateParams, plan, binMap])

  const onCell = (col: number, row: number) => {
    const hit = stackAt(stacks, col, row)
    if (hit) { setSelectedStack(hit.index); return }
    const bin = placingId ? binMap.get(placingId) : undefined
    if (!bin) { setSelectedStack(null); return }
    const box = placeRotated
      ? { col, row, cellsX: bin.params.gridY, cellsY: bin.params.gridX }
      : { col, row, cellsX: bin.params.gridX, cellsY: bin.params.gridY }
    if (!canPlace(stacks, plan, box)) {
      setToast(`${bin.name} (${box.cellsX} × ${box.cellsY}) does not fit there`)
      return
    }
    const layout = [...(plateParams.layout ?? []), { col, row, stack: [bin.id], ...(placeRotated ? { rotated: true } : {}) }]
    d.setBaseplate({ layout })
    setSelectedStack(layout.length - 1)
  }

  /** Every bin the layout uses, each once with how many to print, and its lid. */
  const exportLayout = async () => {
    setBusy(true)
    try {
      const files: Record<string, Uint8Array> = {}
      for (const [id, count] of binCounts(plateParams.layout ?? [])) {
        const bin = binMap.get(id)
        if (!bin) continue
        const stem = `${safeFilename(bin.name)}_x${count}`
        Object.assign(files, binFiles(await buildBinParts(bin.params), stem, bin.name))
        const lid = await buildLid(bin.params)
        if (lid) Object.assign(files, lidFiles(lid, `${stem}_lid`, `${bin.name} lid`))
      }
      triggerDownload(zipParts(files), `${baseName}_bins.zip`, 'application/zip')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  // ---- Label lists. The first fetch is also what gives a new account the Kreg list. ----

  const refreshLists = useCallback(async () => {
    setListsLoading(true)
    try { setLists(await api.listLabelLists()) } catch (e) { setError((e as Error).message) }
    finally { setListsLoading(false) }
  }, [])
  useEffect(() => { void refreshLists() }, [refreshLists])

  const applyList = useCallback((list: LabelList) => {
    d.setKind('bin')
    d.setBin({
      labelListId: list.id,
      labelTab: true,
      labelText: list.items.includes(design.bin.labelText) ? design.bin.labelText : list.items[0] ?? '',
    })
  }, [d, design.bin.labelText])

  // ---- Colours: an owned filament paints the preview, and its AMS tray sets the 3MF slot. ----

  const ownedColors = useOwnedColors()
  const ams = useAmsTrays()
  const amsTrayFor = useCallback(
    (key: string) => ams.trays?.find(tray => tray.key === key), [ams.trays])
  const hexOf = useCallback(
    (key: string | undefined) => ownedColors.find(c => c.key === key)?.hexes[0], [ownedColors])
  const slotOf = useCallback(
    (key: string | undefined) => (key ? amsTrayFor(key)?.slot : undefined), [amsTrayFor])
  const colorsByTray = useMemo(() => loadedFirst(ownedColors, ams.trays), [ownedColors, ams.trays])
  const maxSlot = ams.trays?.length ? Math.max(...ams.trays.map(tray => tray.slot)) : 4
  const { colors } = settings

  // ---- Export ----

  const baseName = safeFilename(design.name)
  const bedMm = design.baseplate.bedMm

  const downloadBin = (format: 'stl' | '3mf' | 'studio') => {
    if (bin.status !== 'ready') return
    const { body, label } = bin.value
    const send = (bytes: ArrayBuffer) => (format === 'studio'
      ? void openInBambuStudio(bytes, design.name)
      : triggerDownload(bytes, `${baseName}.3mf`, 'model/3mf'))
    if (format === 'stl') {
      if (label) triggerDownload(zipParts(binFiles(bin.value, baseName, design.name)), `${baseName}_2-colour.zip`, 'application/zip')
      else triggerDownload(writeBinaryStl(body, design.name), `${baseName}.stl`, 'model/stl')
      return
    }
    if (!label) { send(writeThreeMf(body, design.name)); return }
    const [bodySlot, labelSlot] = assignExtruders(
      [{ filamentSlot: slotOf(colors.bin) }, { filamentSlot: slotOf(colors.label) }], maxSlot)
    send(writeThreeMfParts([
      { mesh: body, name: `${design.name} bin`, extruder: bodySlot },
      { mesh: label, name: `${design.name} label`, extruder: labelSlot },
    ], design.name))
  }

  const downloadLid = (format: 'stl' | '3mf' | 'studio') => {
    const lid = bin.status === 'ready' ? bin.value.lid : null
    if (!lid) return
    const title = `${design.name} lid`
    if (format === 'stl') {
      if (lid.label) triggerDownload(zipParts(lidFiles(lid, `${baseName}_lid`, title)), `${baseName}_lid_2-colour.zip`, 'application/zip')
      else triggerDownload(writeBinaryStl(lid.print, title), `${baseName}_lid.stl`, 'model/stl')
      return
    }
    if (format === 'studio') void openInBambuStudio(lidThreeMf(lid, title), title)
    else triggerDownload(lidThreeMf(lid, title), `${baseName}_lid.3mf`, 'model/3mf')
  }

  /** The lid as a 3MF, its inlaid label a second part on the label's filament. */
  const lidThreeMf = (lid: LidParts, title: string): ArrayBuffer => {
    if (!lid.label) return writeThreeMf(lid.print, title)
    const [lidSlot, labelSlot] = assignExtruders(
      [{ filamentSlot: slotOf(colors.bin) }, { filamentSlot: slotOf(colors.label) }], maxSlot)
    return writeThreeMfParts([
      { mesh: lid.print, name: title, extruder: lidSlot },
      { mesh: lid.label.print, name: `${title} label`, extruder: labelSlot },
    ], title)
  }

  const downloadBaseplate = async () => {
    setBusy(true)
    try {
      const built = tiles.status === 'ready' ? tiles.value : await buildBaseplate(plan)
      if (built.length === 1) {
        triggerDownload(writeBinaryStl(built[0].mesh, design.name), `${baseName}.stl`, 'model/stl')
        return
      }
      const files: Record<string, Uint8Array> = {}
      for (const { tile, mesh } of built) {
        files[`${baseName}_tile_${tile.col}-${tile.row}.stl`] =
          new Uint8Array(writeBinaryStl(mesh, `${design.name} tile ${tile.col}-${tile.row}`))
      }
      triggerDownload(zipParts(files), `${baseName}_${built.length}-tiles.zip`, 'application/zip')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const exportPerLabel = useCallback(async (
    list: LabelList, options: BatchOptions, progress: (done: number, total: number) => void,
  ) => {
    const used = new Set<string>()
    const sizeOf = (b: GridfinityBinParams) => `${b.gridX}x${b.gridY}x${b.heightUnits}u`
    const objects: { name: string; parts: ThreeMfPart[] }[] = []
    const files: Record<string, Uint8Array> = {}
    /** Plain lids are alike for a size, so the STL zip carries one per size. */
    const plainLidSizes = new Map<string, GridfinityBinParams>()
    const [bodySlot, labelSlot] = assignExtruders(
      [{ filamentSlot: slotOf(colors.bin) }, { filamentSlot: slotOf(colors.label) }], maxSlot)
    const withLabel = (main: ThreeMfPart, label: Mesh | null | undefined, name: string): ThreeMfPart[] =>
      label ? [main, { mesh: label, name: `${name} label`, extruder: labelSlot }] : [main]

    for (let i = 0; i < list.items.length; i++) {
      progress(i, list.items.length)
      const text = list.items[i]
      const fit = options.sizeToLabel ? suggestBinSize(text) : null
      const item = {
        ...design.bin, labelTab: true, labelText: text,
        ...(fit ? { gridX: fit.gridX, gridY: fit.gridY } : {}),
      }
      const size = sizeOf(item)
      const parts = await buildBinParts(item)
      const lid = await buildLid(item)
      if (options.format === 'zip') {
        let stem = `${String(i + 1).padStart(2, '0')}_${safeFilename(text)}_${size}`
        while (used.has(stem)) stem = `_${stem}`
        used.add(stem)
        Object.assign(files, binFiles(parts, stem, text))
        // A labelled lid is one per bin; a plain one is shared, below.
        if (lid && lidHasText(item)) Object.assign(files, lidFiles(lid, `${stem}_lid`, `${text} lid`))
        else if (lid) plainLidSizes.set(size, item)
      } else {
        // On a plate every bin gets its own lid: they are printed, not shared.
        objects.push({ name: text, parts: withLabel({ mesh: parts.body, name: text, extruder: bodySlot }, parts.label, text) })
        if (lid) {
          objects.push({
            name: `${text} lid`,
            parts: withLabel({ mesh: lid.print, name: `${text} lid`, extruder: bodySlot }, lid.label?.print, `${text} lid`),
          })
        }
      }
      // Yield so the progress bar paints between bins.
      await new Promise(r => setTimeout(r, 0))
    }
    progress(list.items.length, list.items.length)
    const stem = `${safeFilename(list.name)}_bins`
    if (options.format === 'zip') {
      for (const [size, item] of plainLidSizes) {
        const lid = await buildLid(item)
        if (lid) files[`lid_${size}.stl`] = new Uint8Array(writeBinaryStl(lid.print, `${size} lid`))
      }
      triggerDownload(zipParts(files), `${stem}.zip`, 'application/zip')
      setToast(`Exported ${list.items.length} bins`)
      return
    }
    const { placed, plates } = fillPlates(objects, bedMm)
    const bytes = writeThreeMfPlates(placed, list.name, bedMm)
    if (options.format === 'studio') void openInBambuStudio(bytes, list.name)
    else triggerDownload(bytes, `${stem}.3mf`, 'model/3mf')
    setToast(`${objects.length} parts on ${plates} ${plates === 1 ? 'plate' : 'plates'}`)
  }, [design.bin, slotOf, colors.bin, colors.label, maxSlot, bedMm])

  // ---- Saved designs ----

  const refresh = useCallback(async () => {
    setListLoading(true)
    try { setDesigns(await api.listDesigns()) } catch (e) { setError((e as Error).message) }
    finally { setListLoading(false) }
  }, [])

  const save = useCallback(async () => {
    const submittedRevision = design.revision
    setBusy(true)
    try {
      let id = savedId
      if (id) await api.updateDesign(id, design)
      else { id = (await api.createDesign(design)).id; setSavedId(id) }
      setSavedRevision(submittedRevision)
      setToast(
        designRevision.current === submittedRevision
          ? (savedId ? 'Saved' : 'Saved as a new design')
          : 'Saved earlier changes — newer edits are still unsaved',
      )
      if (!savedId && id) { answeredForUrl.current = id; navigate(`/gridfinity/${id}`) }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, design, navigate])

  const load = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current
    setBusy(true)
    try {
      const record = await api.getDesign(id)
      if (generation !== loadGeneration.current) return
      d.setDesign(fromRecord(record))
      answeredForUrl.current = id
      setSavedId(id)
      setSavedRevision(0)
      setOpenDialog(false)
      if (designId !== id) navigate(`/gridfinity/${id}`)
    } catch (e) {
      if (generation === loadGeneration.current) setError((e as Error).message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [d, designId, navigate])

  // The layout places saved bins, so the baseplate needs the list of them.
  useEffect(() => { if (!isBin) void refresh() }, [isBin, refresh])

  useEffect(() => {
    if (!designId) { answeredForUrl.current = null; return }
    if (answeredForUrl.current === designId) return
    void load(designId)
  }, [designId, load])

  const startNew = useCallback((kind: GridfinityKind = design.kind) => {
    if (designId) navigate('/gridfinity')
    answeredForUrl.current = null
    d.setDesign(emptyDesign(kind))
    setSavedId(null)
    setSavedRevision(null)
  }, [d, designId, navigate, design.kind])

  const clone = useCallback(async () => {
    if (!savedId) return
    setBusy(true)
    try {
      const { id } = await api.cloneDesign(savedId)
      await load(id)
      setToast('Cloned — editing the copy')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, load])

  const remove = useCallback(async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete this design?',
      message: `"${name}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteDesign(id)
      if (id === savedId) startNew()
      await refresh()
      setToast('Deleted')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [savedId, refresh, confirm, startNew])

  // ---- Render ----

  const len = (mm: number) => `${formatLength(mm, settings.imperial)}${settings.imperial ? '' : ' mm'}`
  const binParts = bin.status === 'ready' ? bin.value : lastBin
  const binMesh = binParts?.body ?? null
  const binExtras = useMemo(() => {
    const extras: { mesh: Mesh; color?: string }[] = []
    if (binParts?.label) extras.push({ mesh: binParts.label, color: hexOf(colors.label) ?? LABEL_FALLBACK })
    const lid = binParts?.lid
    if (lid && binParts) {
      // Seated: floating over the bin so the catches show. As printed: beside
      // it, turned over onto its top, the way it goes on the plate.
      const asPrinted = lidView === 'print'
      const place = (mesh: Mesh) => (asPrinted
        ? translateMesh(mesh, binParts.body.bbox[3] + LID_SIDE_GAP_MM - mesh.bbox[0], 0, 0)
        : translateMesh(mesh, 0, 0, LID_LIFT_MM))
      extras.push({ mesh: place(asPrinted ? lid.print : lid.seated), color: hexOf(colors.bin) })
      if (lid.label) {
        extras.push({
          mesh: asPrinted
            ? translateMesh(lid.label.print, binParts.body.bbox[3] + LID_SIDE_GAP_MM - lid.print.bbox[0], 0, 0)
            : place(lid.label.seated),
          color: hexOf(colors.label) ?? LABEL_FALLBACK,
        })
      }
    }
    return extras.length ? extras : undefined
  }, [binParts, hexOf, colors.label, colors.bin, lidView])

  /** Rough filament and time, bin and lid apart: they are often printed separately. */
  const estimate = useMemo(() => {
    if (!binParts) return null
    const density = densityOf(colors.bin?.split('/')[1])
    const of = (meshes: (Mesh | null | undefined)[]) => {
      const present = meshes.filter((m): m is Mesh => !!m)
      return {
        grams: present.reduce((g, m) => g + printedGrams(m, density), 0),
        minutes: present.reduce((t, m) => t + printMinutes(m), 0),
      }
    }
    return {
      bin: of([binParts.body, binParts.label]),
      lid: binParts.lid ? of([binParts.lid.print, binParts.lid.label?.print]) : null,
    }
  }, [binParts, colors.bin])
  const exportReady = isBin ? bin.status === 'ready' : !plan.problem

  const canvas = isBin ? (
    bin.status === 'error' ? (
      <ErrorState
        title="This bin could not be built"
        message={`${bin.message} Try a smaller label or a different size.`}
      />
    ) : binMesh ? (
      <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
        <SolidViewer3D
          mesh={binMesh} color={hexOf(colors.bin)} extras={binExtras} label="the Gridfinity bin" up="z"
        />
      </Suspense>
    ) : <LoadingState label="Building the bin…" />
  ) : plan.problem ? (
    <EmptyState title="No baseplate fits" description={plan.problem} />
  ) : settings.view === '2d' ? (
    <BaseplatePlanView
      plan={plan}
      drawerWidthMm={plan.outline ? plan.plateWidthMm : plateParams.drawerWidthMm}
      drawerDepthMm={plan.outline ? plan.plateDepthMm : plateParams.drawerDepthMm}
      stacks={stacks} selected={selectedStack} onCell={onCell}
    />
  ) : tiles.status === 'error' ? (
    <ErrorState title="The baseplate could not be built" message={tiles.message} />
  ) : tilePreview ? (
    <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
      <SolidViewer3D
        mesh={tilePreview} label="the baseplate tiles" up="z"
      />
    </Suspense>
  ) : <LoadingState label={`Building ${plan.tiles.length} baseplate tiles…`} />

  const canvasStatus = isBin
    ? (bin.status === 'building' && binMesh ? 'Rebuilding…' : estimate
        ? [
            `Bin ≈ ${formatGrams(estimate.bin.grams)}, ${formatMinutes(estimate.bin.minutes)}`,
            estimate.lid ? `lid ≈ ${formatGrams(estimate.lid.grams)}, ${formatMinutes(estimate.lid.minutes)}` : '',
          ].filter(Boolean).join(' · ')
        : '')
    : plan.problem ? '' : `${plan.cellsX} × ${plan.cellsY} cells · ${plan.tiles.length} ${plan.tiles.length === 1 ? 'tile' : 'tiles'}`

  useAppMenu(standardMenu({
    onNew: () => startNew(),
    onOpen: () => { setOpenDialog(true); void refresh() },
    onSave: () => void save(),
    saveDisabled: busy,
    exports: isBin
      ? [
          { label: 'Export STL', onClick: () => downloadBin('stl'), disabled: !exportReady },
          { label: 'Export 3MF', onClick: () => downloadBin('3mf'), disabled: !exportReady },
          { label: 'Open in Bambu Studio', onClick: () => downloadBin('studio'), disabled: !exportReady },
          ...(design.bin.lid && design.bin.stackingLip
            ? [
                { label: 'Export lid STL', onClick: () => downloadLid('stl'), disabled: !exportReady },
                { label: 'Export lid 3MF', onClick: () => downloadLid('3mf'), disabled: !exportReady },
                { label: 'Open lid in Bambu Studio', onClick: () => downloadLid('studio'), disabled: !exportReady },
              ]
            : []),
        ]
      : [
          {
            label: plan.tiles.length > 1 ? `Export ${plan.tiles.length} tiles (STL zip)` : 'Export STL',
            onClick: () => void downloadBaseplate(),
            disabled: !exportReady || busy,
          },
        ],
    file: [
      { label: 'Make a copy', onClick: savedId ? () => void clone() : undefined, disabled: busy },
    ],
    onUndo: d.undo,
    onRedo: d.redo,
    canUndo: d.canUndo,
    canRedo: d.canRedo,
  }))

  return (
    <Stack sx={{ height: '100%', minHeight: 0, overflowY: { xs: 'auto', lg: 'visible' } }}>
      <Paper variant="outlined" sx={{ p: 1, borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h3" component="h1" sx={{ mr: 1 }}>
            {design.name || 'Untitled'}
            {hasUnsavedChanges || savedId === null ? ' •' : ''}
          </Typography>

          <ToggleButtonGroup
            exclusive size="small" value={design.kind} aria-label="What to design"
            onChange={(_e, v: GridfinityKind | null) => v && d.setKind(v)}
          >
            <ToggleButton value="bin">Storage bin</ToggleButton>
            <ToggleButton value="baseplate">Drawer baseplate</ToggleButton>
          </ToggleButtonGroup>

          {isBin && design.bin.lid && design.bin.stackingLip && (
            <ToggleButtonGroup
              exclusive size="small" value={lidView} aria-label="How the lid is shown"
              onChange={(_e, v: 'seated' | 'print' | null) => v && setLidView(v)}
            >
              <ToggleButton value="seated">Lid on the bin</ToggleButton>
              <ToggleButton value="print">Lid as printed</ToggleButton>
            </ToggleButtonGroup>
          )}

          {!isBin && (
            <ToggleButtonGroup
              exclusive size="small" value={settings.view} aria-label="Baseplate view"
              onChange={(_e, v: ViewSettings['view'] | null) => v && view({ view: v })}
            >
              <ToggleButton value="2d">Plan</ToggleButton>
              <ToggleButton value="3d">3D</ToggleButton>
            </ToggleButtonGroup>
          )}

        </Stack>
      </Paper>

      <Box
        sx={{
          flex: { xs: 'none', lg: 1 },
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '300px 1fr 320px' },
          gridTemplateRows: { xs: 'auto 420px auto', lg: '1fr' },
        }}
      >
        <Paper variant="outlined" sx={{ borderRadius: 0, borderTop: 0, borderLeft: 0, minHeight: 0 }}>
          {isBin ? (
            <BinPanel
              name={design.name} bin={design.bin} lists={lists}
              onName={d.setName} onBin={d.setBin}
              ownedColors={colorsByTray} colors={colors} onColors={next => view({ colors: next })}
              amsNote={key => { const tray = amsTrayFor(key); return tray ? `in ${tray.label}` : null }}
            />
          ) : (
            <BaseplatePanel
              name={design.name} plate={design.baseplate} imperial={settings.imperial}
              onImperial={v => view({ imperial: v })} onName={d.setName} onPlate={d.setBaseplate}
            />
          )}
        </Paper>

        <Box sx={{ position: 'relative', minHeight: 0 }}>
          {canvas}
          <Typography
            variant="body2" color="text.secondary"
            sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}
          >
            {canvasStatus}
          </Typography>
        </Box>

        <Paper
          variant="outlined"
          sx={{ borderRadius: 0, borderTop: 0, borderRight: 0, minHeight: 0, overflowY: 'auto', p: 2 }}
        >
          {isBin ? (
            <LabelListsPanel
              lists={lists} loading={listsLoading} activeListId={design.bin.labelListId}
              onChanged={refreshLists} onUse={applyList}
              onToast={setToast} onError={setError} onExportAll={exportPerLabel}
            />
          ) : plan.problem ? (
            <Typography variant="body2" color="text.secondary">
              Make the drawer larger or the clearance smaller to fit at least one 42 mm cell.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <LayoutPanel
                plate={plateParams} bins={layoutBins} stacks={stacks} selected={selectedStack}
                placingId={placingId} rotated={placeRotated} busy={busy}
                onPlacing={id => { setPlacingId(id); if (id) view({ view: '2d' }) }}
                onRotated={setPlaceRotated} onSelect={setSelectedStack}
                onLayout={layout => d.setBaseplate({ layout })}
                onHeightLimit={mm => d.setBaseplate({ heightLimitMm: mm })}
                onExport={() => void exportLayout()}
              />
              <Divider />
              <Typography variant="h3" component="h2">Plate</Typography>
              <Typography variant="body2">
                {plan.cellsX} × {plan.cellsY} cells ({plan.cellsX * plan.cellsY} total),
                {' '}{len(plan.plateWidthMm)} × {len(plan.plateDepthMm)}, {BASEPLATE_HEIGHT_MM} mm tall.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Solid padding: {len(plan.gridX)} left,
                {' '}{len(plan.plateWidthMm - plan.gridX - plan.cellsX * GRID_PITCH_MM)} right,
                {' '}{len(plan.gridY)} front,
                {' '}{len(plan.plateDepthMm - plan.gridY - plan.cellsY * GRID_PITCH_MM)} back.
              </Typography>
              <Divider />
              <Typography variant="h3" component="h2">
                {plan.tiles.length === 1 ? 'One tile' : `${plan.tiles.length} tiles`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {plan.tiles.length === 1
                  ? `Prints in one piece on a ${plateParams.bedMm} mm bed.`
                  : `Each fits a ${plateParams.bedMm} mm bed. Named column-row from the front-left corner; lay them out the same way in the ${plan.outline ? 'case' : 'drawer'}.`}
              </Typography>
              <Stack divider={<Divider />}>
                {plan.tiles.map(t => (
                  <Stack key={`${t.col}-${t.row}`} direction="row" sx={{ py: 0.75, justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Tile {t.col}-{t.row}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t.cellsX} × {t.cellsY} · {len(t.widthMm)} × {len(t.depthMm)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          )}
        </Paper>
      </Box>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Open a Gridfinity design</DialogTitle>
        <DialogContent dividers>
          {listLoading && <CircularProgress size={20} />}
          {!listLoading && designs.length === 0 && (
            <EmptyState
              title="No saved designs yet"
              description="Close this and press Save to keep the one you are working on."
            />
          )}
          <Stack divider={<Divider />}>
            {designs.map(s => (
              <Stack key={s.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
                <Button sx={{ justifyContent: 'flex-start', flex: 1 }} onClick={() => void load(s.id)}>
                  <Stack sx={{ alignItems: 'flex-start' }}>
                    <Typography>{s.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {describe(s.kind, s.params)} · {formatUpdated(s.updatedAt)}
                    </Typography>
                  </Stack>
                </Button>
                <Tooltip title="Delete">
                  <IconButton size="small" aria-label={`Delete ${s.name}`} onClick={() => void remove(s.id, s.name)}>
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

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
      <Snackbar open={!!error} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Stack>
  )
}
