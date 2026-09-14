// Bambu Designer: a Tinkercad-style 3D modeller for the Bambu Lab X2D.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, MenuItem, Snackbar, Stack, TextField,
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
import { useNavigate } from 'react-router-dom'

import DesignerLayout from '../../components/designer/DesignerLayout.tsx'
import { OpenDocumentDialog, SaveAsDialog } from '../../components/designer/DocumentDialogs.tsx'
import DocumentNameField from '../../components/designer/DocumentNameField.tsx'
import Inspector from '../../components/designer/Inspector.tsx'
import ObjectTree from '../../components/designer/ObjectTree.tsx'
import AiPanel from '../../components/designer/AiPanel.tsx'
import { useAiDesigner } from '../../components/designer/useAiDesigner.ts'
import { useDocumentLifecycle } from '../../components/designer/useDocumentLifecycle.ts'
import Viewport3D from '../../components/viewport3d/Viewport3D.tsx'
import type { GizmoMode, ViewportPart } from '../../components/viewport3d/Viewport3D.tsx'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import ImportButton from '../shaper-designer/components/ImportButton.tsx'
import { BAMBU_IMPORT_FORMATS, importFile } from '../../import/index.ts'
import type { ObjectMode, PrinterProfile, SceneObject, Triple } from '../../model/document.ts'
import { BAMBU_X2D, PRINTER_PROFILES } from '../../model/machines.ts'
import { IDENTITY_TRANSFORM, createSolid, createText, findObject, newId } from '../../model/scene.ts'
import { useDesignDocument } from '../../state/useDesignDocument.ts'
import { DEFAULT_FONT_ID, resolveTextOutlines } from '../../text/fonts.ts'
import type { Ring } from '../../geometry/vec.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { writeBinaryStl } from '../../export/stl.ts'
import { writeThreeMfParts } from '../../export/threemf.ts'
import { evaluateNode, evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { resolveAssets, storeImportedFile } from '../../import/assets.ts'
import { programToObjects } from '../../csg/toScene.ts'
import SolidPalette from './components/SolidPalette.tsx'
import LibraryPalette from './components/LibraryPalette.tsx'
import type { LibraryEntry } from './components/libraryEntries.ts'
import type { SolidPaletteKind } from './components/solidEntries.ts'
import { alignDeltas, combinedBounds, meshBounds, mirrorTransform } from './align.ts'
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

export default function BambuDesignerPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const doc = useDesignDocument('bambu')
  const lifecycle = useDocumentLifecycle({ kind: 'bambu', doc: doc.doc, setDoc: doc.setDoc })
  const assistant = useAiDesigner('bambu')

  const [imperial, setImperial] = useState(false)
  const [snapMm, setSnapMm] = useState(1)
  const [gizmo, setGizmo] = useState<GizmoMode>('translate')
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

  const { parts, evaluating, failures, detached } = useSceneMeshes(doc.doc, textOutlines)

  const viewportParts = useMemo<ViewportPart[]>(
    () => parts.map(p => ({
      id: p.object.id, mesh: p.mesh, mode: p.object.mode, color: p.object.color,
      // The gizmo pivots here, so a rotation or scale turns the part about the
      // same point the document does.
      origin: p.object.transform.position,
    })),
    [parts],
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
  const severity = worstSeverity(issues)

  const selectedObject = doc.selection.size === 1
    ? findObject(objects, [...doc.selection][0]) ?? null
    : null

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
  const addLibraryPart = useCallback(async (entry: LibraryEntry) => {
    setLibraryBusy(entry.id)
    try {
      const response = await fetch(entry.url)
      if (!response.ok) throw new Error(`${entry.label} could not be loaded`)
      const bytes = await response.arrayBuffer()
      // A part is modelled wherever it sat in the file it came from -- the
      // badge is the raised layer of a two-part print, so its triangles start
      // 1.5 mm up. Seat it on the plate rather than leaving it hovering, which
      // reads as a mistake and prints as one.
      const parsed = await importFile(new File([bytes], entry.filename))
      const seatZ = parsed.kind === '3d' ? -parsed.mesh.bbox[2] : 0
      const asset = await storeImportedFile(bytes, entry.filename, entry.format)
      doc.addObject({
        id: newId(),
        name: entry.label,
        type: 'imported',
        format: entry.format,
        asset,
        transform: { ...IDENTITY_TRANSFORM, position: [0, 0, seatZ] },
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
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
      // Tinkercad's single-key tools.
      if (e.key.toLowerCase() === 'g' && doc.selection.size > 1) doc.groupObjects(doc.selection)
      if (e.key.toLowerCase() === 'm') mirror(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, removeSelected, mirror])

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
        // filament again. Slots run 1, 2, 3... so a logo dropped onto a model
        // arrives ready to print in an accent colour.
        const parts = await Promise.all(program.parts.map(async (node, i) => ({
          mesh: await evaluateNode(node, { meshes }),
          name: node.name || `Part ${i + 1}`,
          extruder: Math.min(i + 1, MAX_FILAMENTS),
        })))
        triggerDownload(writeThreeMfParts(parts, doc.doc.name), `${name}.3mf`, 'model/3mf')
      }
    } catch (cause) {
      lifecycle.setError(cause instanceof Error ? cause.message : 'export failed')
    }
  }, [objects, textOutlines, doc.doc.name, lifecycle])

  const applyProposal = useCallback(() => {
    if (!assistant.proposal) return
    const added = programToObjects(assistant.proposal.program)
    // One replace call, so the whole turn is a single undo step.
    doc.replace(d => ({ ...d, objects: added }))
    assistant.accept()
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
      <Tooltip title="Mirror across X (M)" describeChild><span>
        <IconButton
          size="small" aria-label="Mirror across X" disabled={!doc.selection.size}
          onClick={() => mirror(0)}
        ><FlipRoundedIcon fontSize="small" /></IconButton>
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
        size="small" variant="contained" disabled={lifecycle.busy}
        // A never-saved design has no name but a default one, and writing
        // that default is how a shelf of "Untitled model" gets made. The
        // first save asks; every save after it just saves.
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
            <LibraryPalette busyId={libraryBusy} onAdd={entry => void addLibraryPart(entry)} />
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
            parts={viewportParts}
            selection={doc.selection}
            buildMm={machine.buildMm}
            innerBuildMm={machine.dualNozzleBuildMm}
            gizmo={gizmo}
            snapMm={snapMm}
            imperial={imperial}
            fitToken={fitToken}
            onSelect={(id, additive) => {
              if (id) doc.toggleSelection(id, additive)
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
            <Inspector
              object={selectedObject}
              selectionCount={doc.selection.size}
              imperial={imperial}
              measuredMm={selectedSizeMm}
              onPatch={patch => selectedObject && doc.updateObject(selectedObject.id, patch)}
            />

            {detached.size > 0 && (
              <Alert severity="info" variant="outlined">
                {detached.size === 1 ? 'One imported file is' : `${detached.size} imported files are`}
                {' '}not available on this device. Import{detached.size === 1 ? ' it' : ' them'}
                {' '}again to restore {detached.size === 1 ? 'that object' : 'those objects'};
                the rest of the design is unaffected.
              </Alert>
            )}
            {failures.size > 0 && (
              <Alert severity="warning" variant="outlined">
                {failures.size} {failures.size === 1 ? 'object' : 'objects'} could not be built and
                {' '}{failures.size === 1 ? 'is' : 'are'} not shown.
              </Alert>
            )}
            {severity && (
              <Alert severity={severity} variant="outlined">
                <Stack spacing={0.5}>
                  {issues.map((issue, i) => (
                    <Typography key={i} variant="body2">{issue.message}</Typography>
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
            {objects.length} {objects.length === 1 ? 'object' : 'objects'}
            {doc.selection.size > 0 && ` · ${doc.selection.size} selected`}
            {evaluating && ' · building…'}
          </span>
        }
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
