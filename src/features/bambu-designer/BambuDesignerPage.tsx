// Bambu Designer: a Tinkercad-style 3D modeller for the Bambu Lab X2D.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, Menu, MenuItem, Popover, Snackbar, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import RedoRoundedIcon from '@mui/icons-material/RedoRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded'
import FlipRoundedIcon from '@mui/icons-material/FlipRounded'
import ArchitectureRoundedIcon from '@mui/icons-material/ArchitectureRounded'
import VerticalAlignBottomRoundedIcon from '@mui/icons-material/VerticalAlignBottomRounded'
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded'
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded'
import { useNavigate } from 'react-router-dom'

import DesignerLayout from '../../components/designer/DesignerLayout.tsx'
import { OpenDocumentDialog, SaveAsDialog } from '../../components/designer/DocumentDialogs.tsx'
import DocumentNameField from '../../components/designer/DocumentNameField.tsx'
import Inspector from '../../components/designer/Inspector.tsx'
import ObjectTree from '../../components/designer/ObjectTree.tsx'
import AiPanel from '../../components/designer/AiPanel.tsx'
import { appendChat, useAiDesigner } from '../../components/designer/useAiDesigner.ts'
import { useDocumentLifecycle } from '../../components/designer/useDocumentLifecycle.ts'
import Viewport3D from '../../components/viewport3d/Viewport3D.tsx'
import type { GizmoMode, ViewportPart } from '../../components/viewport3d/Viewport3D.tsx'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import ImportButton from '../shaper-designer/components/ImportButton.tsx'
import { BAMBU_IMPORT_FORMATS, bottomCentre, importFile } from '../../import/index.ts'
import type { ObjectMode, PrinterProfile, SceneObject, Triple } from '../../model/document.ts'
import { BAMBU_X2D, PRINTER_PROFILES } from '../../model/machines.ts'
import {
  IDENTITY_TRANSFORM, createSolid, createText, findObject, newId, translateObjects,
} from '../../model/scene.ts'
import { useDesignDocument } from '../../state/useDesignDocument.ts'
import { DEFAULT_FONT_ID, loadFont, resolveTextOutlines } from '../../text/fonts.ts'
import type { Ring } from '../../geometry/vec.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { writeBinaryStl } from '../../export/stl.ts'
import { writeThreeMfParts } from '../../export/threemf.ts'
import { evaluateNode, evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { resolveAssets, storeImportedFile } from '../../import/assets.ts'
import { mergeProposal } from '../../csg/mergeProposal.ts'
import { PREVIEW_PART_ID, useProposalPreview } from '../../components/designer/useProposalPreview.ts'
import SolidPalette from './components/SolidPalette.tsx'
import FilamentSlotField from './components/FilamentSlotField.tsx'
import FilamentColorField from './components/FilamentColorField.tsx'
import { useOwnedColors } from '../filaments/useOwnedColors.ts'
import PrintHistory from './components/PrintHistory.tsx'
import { useAmsTrays } from './useAmsTrays.ts'
import { assignExtruders, filamentWarnings, trayLabel } from './amsTrays.ts'
import { SPOOL_GRAMS, densityOf, formatGrams, printedGrams } from './estimate.ts'
import { overhangSurface } from './surfaces.ts'
import { costOf, formatMoney } from '../filaments/model/cost.ts'
import { getFilamentPrices } from '../filaments/service.ts'
import type { FilamentPrice } from '../filaments/service.ts'
import LibraryPalette from './components/LibraryPalette.tsx'
import type { FastenerEntry, FileEntry, LibraryEntry } from './components/libraryEntries.ts'
import { EL_LOGO } from './components/libraryEntries.ts'
import IdCardDialog from './components/IdCardDialog.tsx'
import type { CardKit } from './components/IdCardDialog.tsx'
import type { CardSpec, FoundCard } from './idCard.ts'
import { CARD_SIZES, DEFAULT_CARD_SPEC, layoutCard, measureWith, readCards } from './idCard.ts'
import FastenerDialog from './components/FastenerDialog.tsx'
import type { MetricSize } from './hardware.ts'
import { createFastenerCutter } from './hardware.ts'
import type { SolidPaletteKind } from './components/solidEntries.ts'
import {
  alignDeltas, combinedBounds, dropToPlateDeltas, meshBounds, mirrorTransform, objectAtPoint,
  ontoPlateDeltas,
} from './align.ts'
import type { AlignEdge, Axis, Bounds } from './align.ts'
import { checkPrint, worstSeverity } from './printChecks.ts'
import { useSceneMeshes } from './useSceneMeshes.ts'
import { designerDefaults } from '../settings/preferences.ts'

const SNAP_OPTIONS = [0, 0.5, 1, 5]
const AXES: { axis: Axis; label: string }[] = [
  { axis: 0, label: 'X' }, { axis: 1, label: 'Y' }, { axis: 2, label: 'Z' },
]
const EDGES: { edge: AlignEdge; label: string }[] = [
  { edge: 'min', label: 'Min' }, { edge: 'centre', label: 'Centre' }, { edge: 'max', label: 'Max' },
]
/** One AMS holds four spools. Exports past the fourth object pile onto the last
 *  slot rather than naming a filament the printer has not got. */
const MAX_FILAMENTS = 4

/** The overhang shell in the viewport; not an object, so it is never selected. */
const OVERHANG_PART_ID = '__overhangs'

/** Arrow-key nudge with snap off; Shift multiplies whatever the step is. */
const FREE_NUDGE_MM = 1
const SHIFT_NUDGE = 10

const KEEP_PROPORTIONS_KEY = 'shapepilot.bambu.keepProportions'

/** Between a new ID card and whatever is already on the plate. */
const CARD_SPACING_MM = 5

/** A shipped part's bytes, and the mesh parsed from them. */
async function fetchLibraryFile(entry: FileEntry) {
  const response = await fetch(entry.url)
  if (!response.ok) throw new Error(`${entry.label} could not be loaded`)
  const bytes = await response.arrayBuffer()
  const parsed = await importFile(new File([bytes], entry.filename))
  return { bytes, mesh: parsed.kind === '3d' ? parsed.mesh : null }
}

const SHORTCUTS: readonly [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘A', 'Select every part'],
  ['⌘D', 'Duplicate'],
  ['Delete', 'Delete the selection'],
  ['G', 'Group'],
  ['M / ⇧M / ⌥M', 'Mirror across X / Y / Z'],
  ['D', 'Drop to the build plate'],
  ['← → ↑ ↓', 'Nudge by the snap step in X and Y'],
  ['Page Up / Down', 'Nudge in Z'],
  ['Shift + nudge', '10× the step'],
  ['?', 'Show these shortcuts'],
]

/**
 * A letter shortcut, by physical key where the event has one -- Option+M types
 * µ, so `key` alone would miss it -- and by the typed letter where it does not,
 * as with some remote keyboards and automation.
 */
const isLetter = (e: KeyboardEvent, letter: string): boolean =>
  e.code === `Key${letter.toUpperCase()}` || (!e.code && e.key.toLowerCase() === letter)

/** Keys a focused control already uses, so the designer must not take them. */
const OWNS_KEYS = 'input, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="slider"]'

export default function BambuDesignerPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const doc = useDesignDocument('bambu')
  const lifecycle = useDocumentLifecycle({ kind: 'bambu', doc: doc.doc, setDoc: doc.setDoc })
  const assistant = useAiDesigner('bambu', doc.doc.chat, doc.doc.id)

  const [imperial, setImperial] = useState(false)
  const [snapMm, setSnapMm] = useState(1)
  const [gizmo, setGizmo] = useState<GizmoMode>('translate')
  // One setting for the scale handles and the typed sizes alike. Remembered on
  // this device: it is how you like to work, not part of any one model.
  const [keepProportions, setKeepProportionsState] = useState(() => {
    try { return localStorage.getItem(KEEP_PROPORTIONS_KEY) !== 'false' } catch { return true }
  })
  const setKeepProportions = useCallback((keep: boolean) => {
    setKeepProportionsState(keep)
    try { localStorage.setItem(KEEP_PROPORTIONS_KEY, String(keep)) } catch { /* not remembered */ }
  }, [])
  const [addMode, setAddMode] = useState<ObjectMode>('solid')
  // How this designer opens, from the settings page. Applied once, on mount,
  // before anything has been touched.
  useEffect(() => {
    let cancelled = false
    void designerDefaults().then(defaults => {
      if (cancelled) return
      setImperial(defaults.bambu.imperial)
      setSnapMm(defaults.bambu.snapMm)
      setGizmo(defaults.bambu.gizmo)
      setAddMode(defaults.bambu.addMode)
    })
    return () => { cancelled = true }
  }, [])
  const [fitToken, setFitToken] = useState(0)
  const [openDialog, setOpenDialog] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [textOutlines, setTextOutlines] = useState<Map<string, Ring[]>>(new Map())
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null)
  const ams = useAmsTrays()
  const ownedColors = useOwnedColors()
  // What the filament costs, when the lines in the AMS are priced. Unpriced
  // lines are left out of the money and named as unpriced, never guessed at.
  const [prices, setPrices] = useState<FilamentPrice[]>([])
  useEffect(() => {
    let cancelled = false
    void getFilamentPrices()
      .then(stored => { if (!cancelled) setPrices(stored) })
      .catch(() => { /* no prices, no cost line */ })
    return () => { cancelled = true }
  }, [])
  const [fastener, setFastener] = useState<FastenerEntry | null>(null)
  const [cardDialog, setCardDialog] = useState<
    { spec: CardSpec; editing: FoundCard | null } | null>(null)
  const [cardKit, setCardKit] = useState<CardKit | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [mirrorAnchor, setMirrorAnchor] = useState<HTMLElement | null>(null)
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLElement | null>(null)
  const [showOverhangs, setShowOverhangs] = useState(false)
  const shortcutsButton = useRef<HTMLButtonElement>(null)

  const objects = doc.doc.objects
  const machine = (doc.doc.machine?.kind === 'printer' ? doc.doc.machine : BAMBU_X2D) as PrinterProfile

  const outlineToken = useRef(0)
  useEffect(() => {
    const generation = ++outlineToken.current
    void resolveTextOutlines(objects, id => {
      const found = findObject(objects, id)
      return found?.type === 'text' ? found : undefined
    }).then(resolved => {
      if (generation === outlineToken.current) setTextOutlines(resolved)
    })
  }, [objects])

  const {
    parts, evaluating, failures, detached, retry: retryBuild,
  } = useSceneMeshes(doc.doc, textOutlines)

  // While a proposal is up, the scene it would leave behind is the thing to
  // look at; drawing it over the current parts would be two overlapping solids.
  const previewMesh = useProposalPreview(assistant.proposal, objects, textOutlines)

  const viewportParts = useMemo<ViewportPart[]>(
    () => previewMesh
      ? [{ id: PREVIEW_PART_ID, mesh: previewMesh, mode: 'solid' }]
      : parts.map(p => ({
        id: p.object.id, mesh: p.mesh, mode: p.object.mode, color: p.object.color,
        // The gizmo pivots here, so a rotation or scale turns the part about the
        // same point the document does.
        origin: p.object.transform.position,
      })),
    [parts, previewMesh],
  )

  const bounds = useMemo(() => {
    const map = new Map<string, Bounds>()
    for (const p of parts) map.set(p.object.id, meshBounds(p.mesh))
    return map
  }, [parts])

  // Print checks run against the whole model, which is the union of what the
  // slicer would see -- not each object on its own.
  const [wholeMesh, setWholeMesh] = useState<Parameters<typeof checkPrint>[0]>(null)
  useEffect(() => {
    let cancelled = false
    const program = programFromScene(objects, { textOutlines })
    if (!program.parts.length) { setWholeMesh(null); return }
    void resolveAssets(objects)
      .then(({ meshes }) => evaluateProgram(program, { meshes }))
      .then(mesh => { if (!cancelled) setWholeMesh(mesh) })
      .catch(() => { if (!cancelled) setWholeMesh(null) })
    return () => { cancelled = true }
  }, [objects, textOutlines])

  const issues = useMemo(() => checkPrint(wholeMesh, machine), [wholeMesh, machine])
  // Drawn only when asked for: a permanently red underside would be noise on
  // every model that needs supports and knows it.
  const overhangs = useMemo(
    () => (showOverhangs && wholeMesh ? overhangSurface(wholeMesh) : null),
    [showOverhangs, wholeMesh])

  /** The model, plus the overhang shell drawn over it when it is asked for. */
  const drawnParts = useMemo<ViewportPart[]>(
    () => (overhangs
      ? [...viewportParts, {
        id: OVERHANG_PART_ID, mesh: overhangs, mode: 'solid' as const, color: '#e5484d',
      }]
      : viewportParts),
    [viewportParts, overhangs])
  const severity = worstSeverity(issues)

  const selectedObject = doc.selection.size === 1
    ? findObject(objects, [...doc.selection][0]) ?? null
    : null
  // Only a top-level solid is its own body in the 3MF, so only it takes a tray.
  const filamentTarget = selectedObject && selectedObject.mode === 'solid'
    && objects.some(o => o.id === selectedObject.id)
    ? selectedObject
    : null

  /**
   * Grams per filament, grouped the way the 3MF export will number them. Each
   * body is weighed on its own, so parts that overlap count the overlap twice;
   * it errs heavy, which is the safe side for "will this spool do".
   */
  const usage = useMemo(() => {
    const bodies = parts.filter(p => p.object.mode === 'solid')
    const extruders = assignExtruders(bodies.map(p => p.object), MAX_FILAMENTS)
    const bySlot = new Map<number, number>()
    bodies.forEach((body, i) => {
      const slot = extruders[i]
      const tray = ams.trays?.find(t => t.slot === slot)
      const grams = printedGrams(body.mesh, densityOf(tray?.material))
      bySlot.set(slot, (bySlot.get(slot) ?? 0) + grams)
    })
    return [...bySlot].sort(([a], [b]) => a - b).map(([slot, grams]) => ({ slot, grams }))
  }, [parts, ams.trays])
  const totalGrams = usage.reduce((sum, u) => sum + u.grams, 0)

  const cost = useMemo(() => costOf(
    usage.flatMap(({ slot, grams }) => {
      const key = ams.trays?.find(tray => tray.slot === slot)?.key
      return key ? [{ key, grams }] : []
    }),
    prices), [usage, ams.trays, prices])

  const trayWarnings = useMemo(() => {
    const warnings = filamentWarnings(objects, ams.trays)
    for (const { slot, grams } of usage) {
      const tray = ams.trays?.find(t => t.slot === slot)
      if (tray?.remainingPercent == null) continue
      const left = (tray.remainingPercent / 100) * SPOOL_GRAMS
      if (grams > left) {
        warnings.push({
          message: `Tray ${trayLabel(slot)} has about ${formatGrams(left)} left, and this model needs`
            + ` roughly ${formatGrams(grams)} of it.`,
        })
      }
    }
    return warnings
  }, [objects, ams.trays, usage])

  /** How big the selection actually came out. The panel can only ask a
   *  parametric shape its dimensions; a mesh or a group has to be measured. */
  const selectedSizeMm = useMemo<Triple | null>(() => {
    const b = selectedObject ? bounds.get(selectedObject.id) : undefined
    return b ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] : null
  }, [bounds, selectedObject])

  const addSolid = useCallback((kind: SolidPaletteKind) => {
    const object: SceneObject = kind === 'text'
      ? { ...createText('Text'), fontId: DEFAULT_FONT_ID }
      : createSolid(kind)
    doc.addObject({ ...object, mode: addMode })
  }, [doc, addMode])

  /** A ready-made part joins the scene as an ordinary imported object: the
   *  bytes go to the asset store and the document keeps only the hash, exactly
   *  as if the file had been picked from disk. */
  const addLibraryFile = useCallback(async (entry: FileEntry) => {
    setLibraryBusy(entry.id)
    try {
      const { bytes, mesh } = await fetchLibraryFile(entry)
      // A part is modelled wherever it sat in the file it came from -- the
      // badge is the raised layer of a two-part print, so its triangles start
      // 1.5 mm up. Hang it from its bottom centre so it sits on the plate
      // rather than hovering, which reads as a mistake and prints as one.
      const asset = await storeImportedFile(bytes, entry.filename, entry.format)
      doc.addObject({
        id: newId(),
        name: entry.label,
        type: 'imported',
        format: entry.format,
        asset,
        transform: IDENTITY_TRANSFORM,
        ...(mesh ? { originMm: bottomCentre(mesh.bbox) } : {}),
        mode: addMode,
        visible: true,
        locked: false,
      })
    } catch (cause) {
      lifecycle.setError(
        cause instanceof Error ? cause.message : `could not add ${entry.label}`)
    } finally {
      setLibraryBusy(null)
    }
  }, [addMode, doc, lifecycle])

  // -- Systainer ID cards ------------------------------------------------------

  const cards = useMemo(() => readCards(objects, EL_LOGO.filename), [objects])
  /** The card the selection belongs to, which "Edit ID card" reopens. */
  const selectedCard = selectedObject
    ? cards.find(card => card.ids.includes(selectedObject.id)) ?? null
    : null

  /** The font and the logo's shape, loaded the first time the template opens. */
  const loadCardKit = useCallback(async () => {
    if (cardKit) return
    try {
      const [font, logo] = await Promise.all([
        loadFont(DEFAULT_FONT_ID),
        fetchLibraryFile(EL_LOGO).catch(() => null),
      ])
      const b = logo?.mesh?.bbox
      setCardKit({
        measure: measureWith(font),
        logoBounds: b
          ? { widthMm: b[3] - b[0], depthMm: b[4] - b[1], minZ: b[2], maxZ: b[5] }
          : null,
      })
    } catch (cause) {
      setCardDialog(null)
      lifecycle.setError(cause instanceof Error ? cause.message : 'could not load the font')
    }
  }, [cardKit, lifecycle])

  /**
   * A new card starts from the last one on the plate -- same size, logo and
   * filaments, blank text -- because a run of labels differs only in what they
   * say. The very first takes its colours from the trays it defaults to.
   */
  const openCardTemplate = useCallback((editing: FoundCard | null) => {
    const trayColor = (slot?: number) => ams.trays?.find(t => t.slot === slot)?.color || undefined
    const previous = cards.at(-1)
    const spec: CardSpec = editing
      ? editing.spec
      : previous
        // A pair is usually one text card and one icon card, so a new card
        // always starts as text rather than repeating the last one's icon.
        ? { ...previous.spec, lines: [''], icon: null }
        : {
          ...DEFAULT_CARD_SPEC,
          card: { ...DEFAULT_CARD_SPEC.card, color: trayColor(DEFAULT_CARD_SPEC.card.filamentSlot) },
          raised: { ...DEFAULT_CARD_SPEC.raised, color: trayColor(DEFAULT_CARD_SPEC.raised.filamentSlot) },
        }
    setCardDialog({ spec, editing })
    void loadCardKit()
  }, [ams.trays, cards, loadCardKit])

  const applyCard = useCallback(async (spec: CardSpec) => {
    if (!cardKit || !cardDialog) return
    setCardBusy(true)
    try {
      let logo = null
      if (spec.logo !== 'none') {
        if (!cardKit.logoBounds) throw new Error(`${EL_LOGO.label} could not be loaded`)
        const { bytes } = await fetchLibraryFile(EL_LOGO)
        const asset = await storeImportedFile(bytes, EL_LOGO.filename, EL_LOGO.format)
        logo = { asset, bounds: cardKit.logoBounds, name: EL_LOGO.label }
      }
      const editing = cardDialog.editing
      // A new card goes beside everything already on the plate, never on it.
      const overall = combinedBounds([...bounds.values()])
      const size = CARD_SIZES[spec.size]
      const at: Triple = editing
        ? editing.at
        : overall
          ? [overall.max[0] + CARD_SPACING_MM + size.widthMm / 2, overall.min[1] + size.depthMm / 2, 0]
          : [0, 0, 0]
      const { objects: made } = layoutCard(spec, cardKit.measure, logo, at)
      const replaced = new Set(editing?.ids ?? [])
      // One replace: re-laying a card is a single undo step, not one per part.
      doc.replace(d => ({ ...d, objects: [...d.objects.filter(o => !replaced.has(o.id)), ...made] }))
      doc.setSelection([made[0].id])
      setCardDialog(null)
    } catch (cause) {
      lifecycle.setError(cause instanceof Error ? cause.message : 'could not make the card')
    } finally {
      setCardBusy(false)
    }
  }, [bounds, cardDialog, cardKit, doc, lifecycle])

  const addLibraryPart = useCallback((entry: LibraryEntry) => {
    if (entry.kind === 'fastener') setFastener(entry)
    else if (entry.kind === 'template') openCardTemplate(null)
    else void addLibraryFile(entry)
  }, [addLibraryFile, openCardTemplate])

  /** The one top-level part a cutter would be sized to and placed in. */
  const fastenerTarget = useMemo(() => {
    if (!selectedObject || selectedObject.mode !== 'solid') return null
    if (!objects.some(o => o.id === selectedObject.id)) return null
    const b = bounds.get(selectedObject.id)
    return b ? { object: selectedObject, bounds: b } : null
  }, [selectedObject, objects, bounds])

  const addFastener = useCallback((size: MetricSize, thicknessMm: number) => {
    if (!fastener) return
    const cutter = createFastenerCutter(fastener.fastener, size, thicknessMm)
    const b = fastenerTarget?.bounds
    doc.addObject(b
      ? {
        ...cutter,
        transform: {
          ...cutter.transform,
          position: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]],
        },
      }
      : cutter)
    setFastener(null)
  }, [doc, fastener, fastenerTarget])

  const removeSelected = useCallback(async () => {
    if (!doc.selection.size) return
    const ok = await confirm({
      title: `Delete ${doc.selection.size === 1 ? 'this object' : `${doc.selection.size} objects`}?`,
      message: 'Undo will bring it back.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) doc.removeObjects(doc.selection)
  }, [confirm, doc])

  /** Align is one history entry for the whole selection, not one per object. */
  const align = useCallback((axis: Axis, edge: AlignEdge) => {
    const deltas = alignDeltas(bounds, doc.selection, axis, edge)
    if (!deltas.size) return
    doc.replace(d => ({
      ...d,
      objects: d.objects.map(o => {
        const delta = deltas.get(o.id)
        if (delta === undefined || delta === 0) return o
        const position = [...o.transform.position] as [number, number, number]
        position[axis] += delta
        return { ...o, transform: { ...o.transform, position: position as Triple } }
      }),
    }))
  }, [bounds, doc])

  /** Select the part a print issue was found in, so it can be seen and fixed. */
  const showIssue = useCallback((at: Triple) => {
    const id = objectAtPoint(bounds, at)
    if (id) doc.setSelection([id])
  }, [bounds, doc])

  const mirror = useCallback((axis: Axis) => {
    const selected = [...doc.selection]
    if (!selected.length) return
    const overall = combinedBounds(
      selected.map(id => bounds.get(id)).filter((b): b is Bounds => Boolean(b)))
    if (!overall) return
    const pivot = (overall.min[axis] + overall.max[axis]) / 2
    doc.replace(d => ({
      ...d,
      objects: d.objects.map(o => {
        if (!doc.selection.has(o.id)) return o
        const next = mirrorTransform(o, bounds.get(o.id), pivot, axis)
        return { ...o, transform: { ...o.transform, ...next } }
      }),
    }))
  }, [bounds, doc])

  /**
   * With a selection, each selected part drops on its own. With none -- and from
   * the print warning, which is about the whole model -- everything moves as one
   * body, so an assembly keeps its shape. Locked parts never move.
   */
  const dropToPlate = useCallback((scope: 'auto' | 'model' = 'auto') => {
    const selected = scope === 'auto' && doc.selection.size > 0
    const ids = (selected ? [...doc.selection] : objects.map(o => o.id))
      .filter(id => !findObject(objects, id)?.locked)
    const deltas = dropToPlateDeltas(bounds, ids, !selected)
    if (!deltas.size) return
    doc.replace(d => ({
      ...d,
      objects: d.objects.map(o => {
        const delta = deltas.get(o.id)
        if (delta === undefined) return o
        const [x, y, z] = o.transform.position
        return { ...o, transform: { ...o.transform, position: [x, y, z + delta] as Triple } }
      }),
    }))
  }, [bounds, doc, objects])

  // Parts hanging off the build plate, which the slicer would refuse. Locked
  // parts count -- they are still off the plate -- but are left where they are.
  const offPlate = useMemo(
    () => ontoPlateDeltas(bounds, objects.map(o => o.id), machine.buildMm),
    [bounds, objects, machine.buildMm])
  const moveOntoPlate = useCallback(() => {
    const movable = new Map([...offPlate].filter(([id]) => !findObject(objects, id)?.locked))
    if (!movable.size) return
    doc.replace(d => ({
      ...d,
      objects: d.objects.map(o => {
        const delta = movable.get(o.id)
        if (!delta) return o
        const [x, y, z] = o.transform.position
        return {
          ...o,
          transform: { ...o.transform, position: [x + delta[0], y + delta[1], z + delta[2]] as Triple },
        }
      }),
    }))
  }, [doc, objects, offPlate])

  const nudge = useCallback((axis: Axis, direction: 1 | -1, large: boolean) => {
    const ids = [...doc.selection].filter(id => !findObject(objects, id)?.locked)
    if (!ids.length) return
    const step = (snapMm || FREE_NUDGE_MM) * (large ? SHIFT_NUDGE : 1) * direction
    const delta: [number, number, number] = [0, 0, 0]
    delta[axis] = step
    doc.replace(
      d => ({ ...d, objects: translateObjects(d.objects, new Set(ids), ...delta) }),
      // One undo step per burst of key presses on the same selection.
      `nudge:${ids.join(',')}`,
    )
  }, [doc, objects, snapMm])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.(OWNS_KEYS)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (doc.selection.size) { e.preventDefault(); void removeSelected() }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) doc.redo(); else doc.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        doc.duplicateObjects(doc.selection)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        // Top level only: that is what align, mirror and group act on, and
        // selecting a group and its children at once means nothing to them.
        e.preventDefault()
        doc.setSelection(objects.filter(o => !o.locked).map(o => o.id))
        return
      }
      if (e.metaKey || e.ctrlKey) return

      const arrows: Record<string, [Axis, 1 | -1]> = {
        ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 1], ArrowDown: [1, -1],
        PageUp: [2, 1], PageDown: [2, -1],
      }
      const arrow = arrows[e.key]
      if (arrow) {
        if (!doc.selection.size) return
        // Held, not just pressed: without this the page scrolls as well.
        e.preventDefault()
        nudge(arrow[0], arrow[1], e.shiftKey)
        return
      }
      if (e.key === '?') {
        setShortcutsAnchor(shortcutsButton.current)
        return
      }

      // Tinkercad's single-key tools.
      if (isLetter(e, 'g') && doc.selection.size > 1) doc.groupObjects(doc.selection)
      if (isLetter(e, 'm')) mirror(e.altKey ? 2 : e.shiftKey ? 1 : 0)
      if (isLetter(e, 'd') && !e.shiftKey && !e.altKey) dropToPlate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, objects, removeSelected, mirror, nudge, dropToPlate])

  const exportMesh = useCallback(async (format: 'stl' | '3mf') => {
    const program = programFromScene(objects, { textOutlines })
    if (!program.parts.length) {
      lifecycle.setError('There is nothing to export yet.')
      return
    }
    try {
      const { meshes } = await resolveAssets(objects)
      const name = safeFilename(doc.doc.name)
      if (format === 'stl') {
        // STL has no concept of a part, so the scene has to collapse to one solid.
        const mesh = await evaluateProgram(program, { meshes })
        triggerDownload(writeBinaryStl(mesh, doc.doc.name), `${name}.stl`, 'model/stl')
      } else {
        // Evaluated per object, not through evaluateProgram: that unions the
        // parts, and a body fused into its neighbour can never be given its own
        // filament again. A part keeps the tray chosen for it; the rest number
        // 1, 2, 3... around those, so a logo dropped onto a model still arrives
        // ready to print in an accent colour.
        const byId = new Map(objects.map(o => [o.id, o]))
        const extruders = assignExtruders(
          program.parts.map(node => ({ filamentSlot: byId.get(node.id)?.filamentSlot })),
          MAX_FILAMENTS)
        const parts = await Promise.all(program.parts.map(async (node, i) => ({
          mesh: await evaluateNode(node, { meshes }),
          name: node.name || `Part ${i + 1}`,
          extruder: extruders[i],
        })))
        triggerDownload(writeThreeMfParts(parts, doc.doc.name), `${name}.3mf`, 'model/3mf')
      }
    } catch (cause) {
      lifecycle.setError(cause instanceof Error ? cause.message : 'export failed')
    }
  }, [objects, textOutlines, doc.doc.name, lifecycle])

  const applyProposal = useCallback(() => {
    const pending = assistant.proposal
    if (!pending) return
    const turns = assistant.accept()
    // One replace call: the geometry and the transcript land together, so the
    // whole turn is a single undo step.
    doc.replace(d => ({
      ...d,
      objects: mergeProposal(d.objects, pending.sent, pending.program),
      chat: appendChat(d.chat, turns),
    }))
  }, [assistant, doc])

  const toolbar = (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="h1" component="h1" sx={{ fontSize: '1.0625rem', pr: 1.5, borderRight: 1, borderColor: 'divider' }}>
        Bambu Designer
      </Typography>
      <DocumentNameField name={doc.doc.name} onRename={doc.rename} />

      <Tooltip title="Undo" describeChild><span>
        <IconButton size="small" aria-label="Undo" disabled={!doc.canUndo} onClick={doc.undo}>
          <UndoRoundedIcon fontSize="small" />
        </IconButton>
      </span></Tooltip>
      <Tooltip title="Redo" describeChild><span>
        <IconButton size="small" aria-label="Redo" disabled={!doc.canRedo} onClick={doc.redo}>
          <RedoRoundedIcon fontSize="small" />
        </IconButton>
      </span></Tooltip>
      <Tooltip title="Duplicate (⌘D)" describeChild><span>
        <IconButton
          size="small" aria-label="Duplicate" disabled={!doc.selection.size}
          onClick={() => doc.duplicateObjects(doc.selection)}
        ><ContentCopyRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>
      <Tooltip title="Group (G) — solids merge, holes are subtracted" describeChild><span>
        <IconButton
          size="small" aria-label="Group" disabled={doc.selection.size < 2}
          onClick={() => doc.groupObjects(doc.selection)}
        ><CallMergeRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>
      <Tooltip title="Ungroup" describeChild><span>
        <IconButton
          size="small" aria-label="Ungroup"
          disabled={!selectedObject || selectedObject.type !== 'group'}
          onClick={() => selectedObject && doc.ungroupObject(selectedObject.id)}
        ><CallSplitRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>
      <Tooltip title="Mirror (M, ⇧M, ⌥M)" describeChild><span>
        <IconButton
          size="small" aria-label="Mirror" disabled={!doc.selection.size}
          aria-haspopup="menu" aria-expanded={Boolean(mirrorAnchor)}
          onClick={e => setMirrorAnchor(e.currentTarget)}
        ><FlipRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>
      <Menu anchorEl={mirrorAnchor} open={Boolean(mirrorAnchor)} onClose={() => setMirrorAnchor(null)}>
        {AXES.map(({ axis, label }) => (
          <MenuItem key={axis} onClick={() => { setMirrorAnchor(null); mirror(axis) }}>
            Mirror across {label}
          </MenuItem>
        ))}
      </Menu>
      <Tooltip title={doc.selection.size ? 'Drop selection to plate (D)' : 'Drop everything to plate (D)'} describeChild><span>
        <IconButton
          size="small" aria-label="Drop to plate" disabled={!objects.length}
          onClick={() => dropToPlate()}
        ><VerticalAlignBottomRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>
      <Tooltip title="Delete" describeChild><span>
        <IconButton
          size="small" aria-label="Delete" disabled={!doc.selection.size}
          onClick={() => void removeSelected()}
        ><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
      </span></Tooltip>

      <Divider orientation="vertical" flexItem />

      <ToggleButtonGroup
        size="small" exclusive value={gizmo}
        onChange={(_e, v: GizmoMode | null) => v && setGizmo(v)}
        aria-label="Transform tool"
      >
        <ToggleButton value="translate" aria-label="Move">Move</ToggleButton>
        <ToggleButton value="rotate" aria-label="Rotate">Turn</ToggleButton>
        <ToggleButton value="scale" aria-label="Scale">Scale</ToggleButton>
      </ToggleButtonGroup>

      <TextField
        select size="small" label="Snap" value={snapMm} sx={{ width: 96 }}
        onChange={e => setSnapMm(Number(e.target.value))}
      >
        {SNAP_OPTIONS.map(v => (
          <MenuItem key={v} value={v}>{v === 0 ? 'Off' : `${v} mm`}</MenuItem>
        ))}
      </TextField>
      <TextField
        select size="small" label="Printer" value={machine.id} sx={{ width: 180 }}
        onChange={e => {
          const next = PRINTER_PROFILES.find(p => p.id === e.target.value)
          if (next) doc.setMachine(next)
        }}
      >
        {PRINTER_PROFILES.map(p => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
      </TextField>
      <ToggleButtonGroup
        size="small" exclusive value={imperial}
        onChange={(_e, v: boolean | null) => v !== null && setImperial(v)}
        aria-label="Units"
      >
        <ToggleButton value={false} aria-label="Millimetres">mm</ToggleButton>
        <ToggleButton value aria-label="Inches">in</ToggleButton>
      </ToggleButtonGroup>
      <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>
      <Tooltip title="Keyboard shortcuts (?)" describeChild>
        <IconButton
          ref={shortcutsButton} size="small" aria-label="Keyboard shortcuts"
          onClick={e => setShortcutsAnchor(e.currentTarget)}
        ><KeyboardRoundedIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Popover
        open={Boolean(shortcutsAnchor)} anchorEl={shortcutsAnchor}
        onClose={() => setShortcutsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box
          component="dl" aria-label="Keyboard shortcuts"
          sx={{ m: 0, p: 2, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.75 }}
        >
          {SHORTCUTS.map(([keys, action]) => (
            <Box key={keys} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{keys}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>{action}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>

      <Box sx={{ flex: 1 }} />

      <ImportButton
        formats={BAMBU_IMPORT_FORMATS}
        accepts3d
        onImported={added => doc.addObjects(added)}
        onError={lifecycle.setError}
      />
      <Button
        size="small" startIcon={<ArchitectureRoundedIcon />}
        onClick={async () => {
          const id = await lifecycle.handOff('shaper')
          if (id) navigate(`/shaper-designer?open=${id}`)
        }}
      >
        To Shaper
      </Button>
      <Button size="small" onClick={() => void exportMesh('stl')}>STL</Button>
      <Button size="small" onClick={() => void exportMesh('3mf')}>3MF</Button>

      <Divider orientation="vertical" flexItem />

      <Button size="small" onClick={lifecycle.create}>New</Button>
      <Button size="small" onClick={() => setOpenDialog(true)}>Open</Button>
      <Button size="small" onClick={() => setSaveAsOpen(true)}>Save as</Button>
      <Button
        size="small" variant="contained" disabled={lifecycle.busy || (!objects.length && !lifecycle.savedId)}
        // A never-saved design has no name but a default one, and writing
        // that default is how a shelf of "Untitled model" gets made. The
        // first save asks; every save after it just saves. An empty design
        // that was never saved has nothing to keep, but a saved one may have
        // been emptied on purpose.
        onClick={() => (lifecycle.savedId ? void lifecycle.save() : setSaveAsOpen(true))}
      >
        {lifecycle.hasUnsavedChanges ? 'Save *' : 'Save'}
      </Button>
    </Stack>
  )

  return (
    <>
      <DesignerLayout
        label="Bambu Designer"
        toolbar={toolbar}
        left={
          <Stack spacing={1.5}>
            <Typography variant="h3">Solids</Typography>
            <SolidPalette mode={addMode} onModeChange={setAddMode} onAdd={addSolid} />
            <Divider />
            <Typography variant="h3">Parts</Typography>
            <LibraryPalette busyId={libraryBusy} onAdd={addLibraryPart} />
            <Divider />
            <Typography variant="h3">Align</Typography>
            <Stack spacing={0.5}>
              {AXES.map(({ axis, label }) => (
                <Stack key={axis} direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" sx={{ width: 14, color: 'text.secondary' }}>
                    {label}
                  </Typography>
                  {EDGES.map(({ edge, label: edgeLabel }) => (
                    <Button
                      key={edge} size="small" sx={{ minWidth: 0, px: 0.75 }}
                      disabled={doc.selection.size < 2}
                      aria-label={`Align ${label} ${edgeLabel}`}
                      onClick={() => align(axis, edge)}
                    >
                      {edgeLabel}
                    </Button>
                  ))}
                </Stack>
              ))}
            </Stack>
            <Divider />
            <Typography variant="h3">Objects</Typography>
            <ObjectTree
              objects={objects}
              selection={doc.selection}
              onSelect={doc.toggleSelection}
              onToggleVisible={(id, visible) => doc.updateObject(id, { visible })}
              onToggleLocked={(id, locked) => doc.updateObject(id, { locked })}
            />
          </Stack>
        }
        canvas={
          <Viewport3D
            parts={drawnParts}
            selection={doc.selection}
            buildMm={machine.buildMm}
            innerBuildMm={machine.dualNozzleBuildMm}
            gizmo={gizmo}
            uniformScale={keepProportions}
            snapMm={snapMm}
            imperial={imperial}
            fitToken={fitToken}
            onSelect={(id, additive) => {
              if (id && id !== PREVIEW_PART_ID && id !== OVERHANG_PART_ID) {
                doc.toggleSelection(id, additive)
              }
              else doc.clearSelection()
            }}
            onTransform={(id, change) => {
              const object = findObject(objects, id)
              if (!object) return
              const t = object.transform
              doc.updateObject(id, {
                transform: {
                  position: [
                    t.position[0] + change.position[0],
                    t.position[1] + change.position[1],
                    t.position[2] + change.position[2],
                  ],
                  rotationDeg: [
                    t.rotationDeg[0] + change.rotationDeg[0],
                    t.rotationDeg[1] + change.rotationDeg[1],
                    t.rotationDeg[2] + change.rotationDeg[2],
                  ],
                  scale: [
                    t.scale[0] * change.scale[0],
                    t.scale[1] * change.scale[1],
                    t.scale[2] * change.scale[2],
                  ],
                },
              })
            }}
          />
        }
        right={
          <Stack spacing={1.5}>
            <Typography variant="h3">Properties</Typography>
            {selectedCard && (
              <Button
                variant="outlined" size="small" startIcon={<BadgeRoundedIcon />}
                onClick={() => openCardTemplate(selectedCard)}
              >
                Edit ID card
              </Button>
            )}
            {lifecycle.savedId && (
              <PrintHistory documentId={lifecycle.savedId} />
            )}
            <Inspector
              object={selectedObject}
              selectionCount={doc.selection.size}
              imperial={imperial}
              measuredMm={selectedSizeMm}
              keepProportions={keepProportions}
              onKeepProportions={setKeepProportions}
              onPatch={patch => selectedObject && doc.updateObject(selectedObject.id, patch)}
            />
            {filamentTarget && (
              <FilamentSlotField
                object={filamentTarget} ams={ams}
                onPatch={patch => doc.updateObject(filamentTarget.id, patch)}
              />
            )}
            {selectedObject && (
              <FilamentColorField
                object={selectedObject} colors={ownedColors}
                onPatch={patch => doc.updateObject(selectedObject.id, patch)}
              />
            )}
            {trayWarnings.length > 0 && (
              <Alert severity="warning" variant="outlined">
                <Stack spacing={0.5}>
                  {trayWarnings.map(warning => (
                    <Typography key={warning.message} variant="body2">{warning.message}</Typography>
                  ))}
                </Stack>
              </Alert>
            )}

            {detached.size > 0 && (
              <Alert severity="info" variant="outlined">
                {detached.size === 1 ? 'One imported file is' : `${detached.size} imported files are`}
                {' '}not available on this device. Import{detached.size === 1 ? ' it' : ' them'}
                {' '}again to restore {detached.size === 1 ? 'that object' : 'those objects'};
                the rest of the design is unaffected.
              </Alert>
            )}
            {failures.size > 0 && (
              <Alert
                severity="warning" variant="outlined"
                action={<Button color="inherit" size="small" onClick={retryBuild}>Try again</Button>}
              >
                {failures.size} {failures.size === 1 ? 'object' : 'objects'} could not be built and
                {' '}{failures.size === 1 ? 'is' : 'are'} not shown.
                {/* The reason, once: when everything fails it is one cause, not N. */}
                {[...new Set(failures.values())].slice(0, 2).map(reason => (
                  <Typography key={reason} variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                    {reason}
                  </Typography>
                ))}
              </Alert>
            )}
            {severity && (
              <Alert severity={severity} variant="outlined">
                <Stack spacing={0.5}>
                  {issues.map((issue, i) => (
                    <Box key={i}>
                      <Typography variant="body2">{issue.message}</Typography>
                      {issue.fix === 'drop-to-plate' && (
                        <Button
                          size="small" startIcon={<VerticalAlignBottomRoundedIcon />}
                          onClick={() => dropToPlate('model')} sx={{ mt: 0.5 }}
                        >
                          Drop to plate
                        </Button>
                      )}
                      {issue.at && (
                        <Button
                          size="small" onClick={() => showIssue(issue.at!)} sx={{ mt: 0.5 }}
                        >
                          Select the part
                        </Button>
                      )}
                      {issue.message.includes('faces downwards') && (
                        <Button
                          size="small" sx={{ mt: 0.5 }}
                          onClick={() => setShowOverhangs(value => !value)}
                        >
                          {showOverhangs ? 'Hide overhangs' : 'Show overhangs'}
                        </Button>
                      )}
                    </Box>
                  ))}
                </Stack>
              </Alert>
            )}

            <Divider />
            <Typography variant="h3">Assistant</Typography>
            <AiPanel
              available={assistant.available}
              busy={assistant.busy}
              error={assistant.error}
              proposal={assistant.proposal}
              turns={assistant.turns}
              placeholder="Make a 40 mm bracket with two 4 mm bolt holes"
              onSend={prompt => void assistant.send(
                prompt, programFromScene(objects, { textOutlines }))}
              onApply={applyProposal}
              onDiscard={assistant.discard}
              onDismissError={() => assistant.setError(null)}
            />
          </Stack>
        }
        status={
          <span>
            {previewMesh && 'Previewing a proposed change · '}
            {objects.length} {objects.length === 1 ? 'object' : 'objects'}
            {doc.selection.size > 0 && ` · ${doc.selection.size} selected`}
            {totalGrams > 0 && (
              <Tooltip title={
                'A rough estimate: two walls and 15% infill, without supports or purge.'
                + (usage.length > 1
                  ? ` By filament: ${usage.map(u => `${trayLabel(u.slot)} ${formatGrams(u.grams)}`).join(', ')}.`
                  : '')
                + (cost.unpricedGrams > 0
                  ? ` ${formatGrams(cost.unpricedGrams)} is on filament with no price set.`
                  : '')
              }>
                <span style={{ pointerEvents: 'auto' }}>
                  {' · ≈ '}{formatGrams(totalGrams)}
                  {cost.amount !== null && <> · {formatMoney(cost.amount, cost.currency!)}</>}
                </span>
              </Tooltip>
            )}
            {offPlate.size > 0 && (
              <Box component="span" sx={{ color: 'warning.main' }}>
                {` · ${offPlate.size} off the plate · `}
                <Box
                  component="button" type="button" onClick={moveOntoPlate}
                  sx={{
                    pointerEvents: 'auto', border: 0, p: 0, background: 'none',
                    cursor: 'pointer', color: 'primary.main', font: 'inherit',
                    textDecoration: 'underline',
                  }}
                >
                  Move onto plate
                </Box>
              </Box>
            )}
            {evaluating && ' · building…'}
          </span>
        }
      />

      <FastenerDialog
        entry={fastener}
        target={fastenerTarget && {
          name: fastenerTarget.object.name,
          thicknessMm: fastenerTarget.bounds.max[2] - fastenerTarget.bounds.min[2],
        }}
        onAdd={addFastener}
        onClose={() => setFastener(null)}
      />
      <IdCardDialog
        initial={cardDialog && { spec: cardDialog.spec, editing: Boolean(cardDialog.editing) }}
        kit={cardKit}
        ams={ams}
        colors={ownedColors}
        busy={cardBusy}
        onApply={spec => void applyCard(spec)}
        onClose={() => setCardDialog(null)}
      />
      <OpenDocumentDialog
        open={openDialog}
        documents={lifecycle.documents}
        loading={lifecycle.listLoading}
        kind="bambu"
        onOpen={id => { setOpenDialog(false); void lifecycle.open(id) }}
        onDelete={id => void lifecycle.remove(id)}
        onClose={() => setOpenDialog(false)}
      />
      <SaveAsDialog
        open={saveAsOpen}
        defaultName={doc.doc.name}
        firstSave={!lifecycle.savedId}
        onSave={name => { setSaveAsOpen(false); void lifecycle.saveAs(name) }}
        onClose={() => setSaveAsOpen(false)}
      />

      <Snackbar
        open={Boolean(lifecycle.toast)} autoHideDuration={3_000}
        onClose={() => lifecycle.setToast(null)} message={lifecycle.toast ?? ''}
      />
      <Snackbar
        open={Boolean(lifecycle.error)} autoHideDuration={6_000}
        onClose={() => lifecycle.setError(null)}
      >
        <Alert severity="error" onClose={() => lifecycle.setError(null)}>{lifecycle.error}</Alert>
      </Snackbar>
    </>
  )
}
