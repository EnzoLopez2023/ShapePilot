// Shaper Designer: 2D CNC design for the Shaper Origin.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Divider, FormControlLabel, ListItemText, ListSubheader, Menu,
  MenuItem, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'

import Canvas2D from '../../components/canvas2d/Canvas2D.tsx'
import type { CanvasShape } from '../../components/canvas2d/Canvas2D.tsx'
import DesignerLayout from '../../components/designer/DesignerLayout.tsx'
import { OpenDocumentDialog, SaveAsDialog } from '../../components/designer/DocumentDialogs.tsx'
import DocumentNameField from '../../components/designer/DocumentNameField.tsx'
import Inspector from '../../components/designer/Inspector.tsx'
import ObjectTree from '../../components/designer/ObjectTree.tsx'
import { useDocumentLifecycle } from '../../components/designer/useDocumentLifecycle.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { standardMenu, useAppMenu } from '../../components/menu/AppMenu.tsx'
import { union, difference } from '../../geometry/boolean.ts'
import { LoadingState } from '../../components/LoadingState.tsx'
import { compileObject, openPathRings } from '../../geometry/sceneShapes.ts'
import type { PathObject, SceneObject } from '../../model/document.ts'
import { BENCHPILOT_REACH, fitsReach } from '../../model/benchpilot.ts'
import type { BenchPilotMount } from '../../model/benchpilot.ts'
import { SHAPER_ORIGIN } from '../../model/machines.ts'
import { IDENTITY_TRANSFORM, createShape2D, createText, findObject, newId } from '../../model/scene.ts'
import { useDesignDocument } from '../../state/useDesignDocument.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { writeShaperSvg } from '../../export/shaperSvg.ts'
import { writeDxf } from '../../export/dxf.ts'
import { DEFAULT_FONT_ID, resolveTextOutlines } from '../../text/fonts.ts'
import type { Ring } from '../../geometry/vec.ts'
import { nearestRing, openRingBetween } from '../../geometry/openPath.ts'
import { SHAPER_IMPORT_FORMATS } from '../../import/index.ts'
import ShapePalette from './components/ShapePalette.tsx'
import type { PaletteKind } from './components/paletteEntries.ts'
import ImportButton from './components/ImportButton.tsx'
import { conflictingPocketDepths, sceneCutDrawing } from './cutDrawing.ts'
import { designerDefaults } from '../settings/preferences.ts'
import type { ShaperTemplate } from './templates/index.ts'
import { SHAPER_TEMPLATES, TEMPLATE_CATEGORIES } from './templates/index.ts'

const SNAP_OPTIONS = [0, 0.5, 1, 5, 10]
const GRID_OPTIONS = [0, 5, 10, 25]

// three.js and the CSG kernel only load when someone switches to 3D.
const ShaperView3D = lazy(() => import('./components/ShaperView3D.tsx'))

export default function ShaperDesignerPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const doc = useDesignDocument('shaper')
  const lifecycle = useDocumentLifecycle({ kind: 'shaper', doc: doc.doc, setDoc: doc.setDoc })

  const [imperial, setImperial] = useState(false)
  const [snapMm, setSnapMm] = useState(1)
  const [gridMm, setGridMm] = useState(10)
  // How this designer opens, from the settings page. Applied once, on mount,
  // before anything has been touched.
  useEffect(() => {
    let cancelled = false
    void designerDefaults().then(defaults => {
      if (cancelled) return
      setImperial(defaults.shaper.imperial)
      setSnapMm(defaults.shaper.snapMm)
      setGridMm(defaults.shaper.gridMm)
    })
    return () => { cancelled = true }
  }, [])
  const [showBenchPilot, setShowBenchPilot] = useState(false)
  const [benchPilotMount, setBenchPilotMount] = useState<BenchPilotMount>('workstation')
  const [fitToken, setFitToken] = useState(0)
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const [openDialog, setOpenDialog] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [templatesAnchor, setTemplatesAnchor] = useState<HTMLElement | null>(null)
  const [textOutlines, setTextOutlines] = useState<Map<string, Ring[]>>(new Map())

  const objects = doc.doc.objects

  // Glyph tracing needs the font, which loads asynchronously; the canvas cannot
  // await, so outlines are resolved into state and passed in as data.
  const outlineToken = useRef(0)
  useEffect(() => {
    const generation = ++outlineToken.current
    void resolveTextOutlines(
      objects,
      id => {
        const found = findObject(objects, id)
        return found?.type === 'text' ? found : undefined
      },
    ).then(resolved => {
      if (generation === outlineToken.current) setTextOutlines(resolved)
    })
  }, [objects])

  const compileOptions = useMemo(() => ({ textOutlines }), [textOutlines])

  const shapes = useMemo<CanvasShape[]>(
    () => objects
      .filter(o => o.visible)
      .map(o => {
        const open = openPathRings(o)
        return {
          id: o.id,
          name: o.name,
          // An open polyline has no area, but it still needs a box to be picked
          // and framed by, so it rides along as a one-ring polygon.
          polygons: [...compileObject(o, compileOptions), ...open.map(r => [r])],
          ...(open.length ? { openRings: open } : {}),
          mode: o.mode,
          cutType: open.length ? (o.cut?.type === 'guide' ? 'guide' as const : 'online' as const) : o.cut?.type,
          locked: o.locked,
        }
      })
      .filter(s => s.polygons.length),
    [objects, compileOptions],
  )

  const reach = showBenchPilot ? BENCHPILOT_REACH[benchPilotMount] : null
  const designBounds = useMemo(() => {
    const pts = shapes.flatMap(sh => sh.polygons.flat(2))
    if (!pts.length) return null
    const xs = pts.map(pt => pt[0]), ys = pts.map(pt => pt[1])
    const minX = Math.min(...xs), minY = Math.min(...ys)
    return { minX, minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
  }, [shapes])
  const needsTurn = !!reach && !!designBounds
    && fitsReach(reach, designBounds.w, designBounds.h)
    && !(designBounds.w <= reach.widthMm && designBounds.h <= reach.heightMm)

  // Quarter-turn the whole design about its centre, then slide it back onto the
  // reach's origin corner: each object turns about its own origin, so its
  // position has to orbit the centre as well.
  const turnToFit = useCallback(() => {
    if (!designBounds) return
    const cx = designBounds.minX + designBounds.w / 2
    const cy = designBounds.minY + designBounds.h / 2
    const dx = designBounds.h / 2 - cx
    const dy = designBounds.w / 2 - cy
    for (const o of objects) {
      if (o.locked) continue
      const [px, py] = o.transform.position
      const r = o.transform.rotationDeg
      doc.updateObject(o.id, {
        transform: {
          ...o.transform,
          position: [cx - (py - cy) + dx, cy + (px - cx) + dy, o.transform.position[2]],
          rotationDeg: [r[0], r[1], r[2] + 90],
        },
      })
    }
    setFitToken(t => t + 1)
  }, [designBounds, objects, doc])

  // Opening a contour: two clicks on the outline mark the section to remove.
  const [gapPicks, setGapPicks] = useState<[number, number][] | null>(null)
  useEffect(() => {
    if (!gapPicks) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setGapPicks(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gapPicks])

  const openAt = useCallback((object: SceneObject, a: [number, number], b: [number, number]) => {
    if (object.type !== 'path') return false
    const { position: [px, py], rotationDeg: [, , rz], scale: [sx, sy] } = object.transform
    const rad = (-rz * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const local = (p: [number, number]): [number, number] => {
      const dx = p[0] - px, dy = p[1] - py
      return [(dx * cos - dy * sin) / (sx || 1), (dx * sin + dy * cos) / (sy || 1)]
    }
    const already = new Set(object.openRings ?? [])
    const index = nearestRing(object.rings, already, local(a))
    if (index < 0) return false
    const open = openRingBetween(object.rings[index], local(a), local(b))
    if (!open) return false
    doc.updateObject(object.id, {
      rings: object.rings.map((r, i) => (i === index ? open : r)),
      openRings: [...already, index],
      cut: { type: 'online' },
    } as Partial<SceneObject>)
    return true
  }, [doc])

  const closeOpenRings = useCallback((object: SceneObject) => {
    if (object.type !== 'path') return
    doc.updateObject(object.id, { openRings: [] } as Partial<SceneObject>)
  }, [doc])

  // Merge: the selection resolved the way a group resolves -- solids joined,
  // holes subtracted -- and kept as one outline in place of the parts.
  const selectedObjects = useMemo(
    () => objects.filter(o => doc.selection.has(o.id)), [objects, doc.selection])
  const canMerge = selectedObjects.length >= 2
    && selectedObjects.some(o => o.mode !== 'hole')
    && selectedObjects.every(o => !(o.type === 'path' && o.openRings?.length) && !o.locked)

  const mergeSelected = useCallback(() => {
    if (!canMerge) return
    const solids = selectedObjects.filter(o => o.mode !== 'hole')
      .map(o => compileObject(o, compileOptions)).filter(mp => mp.length)
    const holes = selectedObjects.filter(o => o.mode === 'hole')
      .map(o => compileObject({ ...o, mode: 'solid' }, compileOptions)).filter(mp => mp.length)
    if (!solids.length) return
    const joined = union(...solids)
    const result = holes.length ? difference(joined, ...holes) : joined
    if (!result.length) return
    const first = selectedObjects.find(o => o.mode !== 'hole')!
    const thickness = Math.max(
      ...selectedObjects.map(o => (o.type === 'path' || o.type === 'shape2d' || o.type === 'text'
        ? o.thicknessMm : undefined) ?? 5))
    const merged: PathObject = {
      id: newId(), name: 'Merged outline', type: 'path', mode: 'solid', visible: true, locked: false,
      transform: IDENTITY_TRANSFORM, color: first.color, cut: first.cut ?? { type: 'exterior' },
      rings: result.flat(), thicknessMm: thickness,
    }
    doc.removeObjects(selectedObjects.map(o => o.id))
    const id = doc.addObject(merged)
    doc.setSelection([id])
  }, [canMerge, selectedObjects, compileOptions, doc])

  const depthConflict = useMemo(() => conflictingPocketDepths(doc.doc), [doc.doc])

  const addShape = useCallback((kind: PaletteKind, x = 0, y = 0) => {
    const object: SceneObject = kind === 'text'
      ? { ...createText('Text', [x, y, 0]), fontId: DEFAULT_FONT_ID }
      : createShape2D(kind, [x, y, 0])
    // Everything cut on the Origin needs a cut type; exterior is the safe
    // default because it is the only one that frees a part.
    doc.addObject({ ...object, cut: { type: 'exterior' } })
  }, [doc])

  const selectedObject = doc.selection.size === 1
    ? findObject(objects, [...doc.selection][0]) ?? null
    : null

  const patchSelected = useCallback((patch: Partial<SceneObject>) => {
    if (!selectedObject) return
    doc.updateObject(selectedObject.id, patch)
  }, [doc, selectedObject])

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

  // Delete and undo/redo, skipping text inputs so typing a dimension is safe.
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
        if (e.shiftKey) doc.redo()
        else doc.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        doc.duplicateObjects(doc.selection)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        // Top level and unlocked, as in the Bambu Designer: it is what the
        // multi-object tools act on.
        e.preventDefault()
        doc.setSelection(objects.filter(o => !o.locked).map(o => o.id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, objects, removeSelected])

  const exportFile = useCallback((format: 'svg' | 'dxf') => {
    const drawing = sceneCutDrawing(doc.doc, compileOptions)
    if (!drawing.layers.length) {
      lifecycle.setError('There is nothing to export yet.')
      return
    }
    const name = safeFilename(doc.doc.name)
    if (format === 'svg') {
      triggerDownload(writeShaperSvg(drawing), `${name}.svg`, 'image/svg+xml')
    } else {
      triggerDownload(writeDxf(drawing), `${name}.dxf`, 'image/vnd.dxf')
    }
  }, [doc.doc, compileOptions, lifecycle])

  const openTemplate = useCallback(async (template: ShaperTemplate) => {
    setTemplatesAnchor(null)
    // A template replaces the canvas and clears undo, so work on it is only
    // thrown away on purpose.
    if (objects.length && (!lifecycle.savedId || lifecycle.hasUnsavedChanges)) {
      const ok = await confirm({
        title: `Start from ${template.name}?`,
        message: 'This replaces the current design, and its unsaved changes are lost.',
        confirmLabel: 'Replace',
        destructive: true,
      })
      if (!ok) return
    }
    lifecycle.startFrom(template.build())
    setFitToken(t => t + 1)
  }, [confirm, lifecycle, objects.length])

  const stock = useMemo(() => ({ widthMm: 300, heightMm: 200 }), [])

  const saveDisabled = lifecycle.busy || (!objects.length && !lifecycle.savedId)
  const selectedGroup = selectedObject?.type === 'group' ? selectedObject : null

  useAppMenu(standardMenu({
    onNew: lifecycle.create,
    onOpen: () => setOpenDialog(true),
    // A never-saved design has no name but a default one, and writing that
    // default is how a shelf of "Untitled model" gets made. The first save
    // asks; every save after it just saves. An empty design that was never
    // saved has nothing to keep, but a saved one may have been emptied on
    // purpose.
    onSave: () => (lifecycle.savedId ? void lifecycle.save() : setSaveAsOpen(true)),
    onSaveAs: () => setSaveAsOpen(true),
    saveDisabled,
    exports: [
      { label: 'Export SVG', onClick: () => exportFile('svg') },
      { label: 'Export DXF', onClick: () => exportFile('dxf') },
    ],
    file: [{
      label: 'To Bambu Designer',
      onClick: () => {
        void (async () => {
          const id = await lifecycle.handOff('bambu')
          // The clone's id rides along so the target opens it rather than a
          // fresh empty document.
          if (id) navigate(`/bambu-designer?open=${id}`)
        })()
      },
    }],
    onUndo: doc.undo,
    onRedo: doc.redo,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    onDuplicate: () => doc.duplicateObjects(doc.selection),
    onDelete: () => void removeSelected(),
    canDuplicate: doc.selection.size > 0,
    canDelete: doc.selection.size > 0,
    edit: [
      {
        label: 'Group',
        onClick: () => doc.groupObjects(doc.selection),
        disabled: doc.selection.size < 2,
      },
      {
        label: 'Ungroup',
        onClick: () => { if (selectedGroup) doc.ungroupObject(selectedGroup.id) },
        disabled: !selectedGroup,
      },
    ],
    view: [
      { label: 'Fit to window', onClick: () => setFitToken(t => t + 1) },
      { label: 'Units: millimetres', onClick: () => setImperial(false), dividerBefore: true },
      { label: 'Units: inches', onClick: () => setImperial(true) },
    ],
  }))

  const toolbar = (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="h1" component="h1" sx={{ fontSize: '1.0625rem', pr: 1.5, borderRight: 1, borderColor: 'divider' }}>
        Shaper Designer
      </Typography>
      <DocumentNameField name={doc.doc.name} onRename={doc.rename} />
      {lifecycle.hasUnsavedChanges && (
        <Typography component="span" title="Unsaved changes" aria-label="Unsaved changes" sx={{ color: 'text.secondary' }}>
          *
        </Typography>
      )}

      <Divider orientation="vertical" flexItem />

      <TextField
        select size="small" label="Snap" value={snapMm} sx={{ width: 96 }}
        onChange={e => setSnapMm(Number(e.target.value))}
      >
        {SNAP_OPTIONS.map(v => (
          <MenuItem key={v} value={v}>{v === 0 ? 'Off' : `${v} mm`}</MenuItem>
        ))}
      </TextField>
      <TextField
        select size="small" label="Grid" value={gridMm} sx={{ width: 96 }}
        onChange={e => setGridMm(Number(e.target.value))}
      >
        {GRID_OPTIONS.map(v => (
          <MenuItem key={v} value={v}>{v === 0 ? 'Off' : `${v} mm`}</MenuItem>
        ))}
      </TextField>
      <ToggleButtonGroup
        size="small" exclusive value={imperial}
        onChange={(_e, v: boolean | null) => v !== null && setImperial(v)}
        aria-label="Units"
      >
        <ToggleButton value={false} aria-label="Millimetres">mm</ToggleButton>
        <ToggleButton value aria-label="Inches">in</ToggleButton>
      </ToggleButtonGroup>

      <ToggleButtonGroup
        size="small" exclusive value={view}
        onChange={(_e, v: '2d' | '3d' | null) => { if (v) { setView(v); setFitToken(t => t + 1) } }}
        aria-label="View"
      >
        <ToggleButton value="2d">2D</ToggleButton>
        <ToggleButton value="3d">3D</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ flex: 1 }} />

      <ImportButton
        formats={SHAPER_IMPORT_FORMATS}
        onImported={objects => doc.addObjects(objects)}
        onError={lifecycle.setError}
      />
      <Button
        size="small" aria-haspopup="menu" aria-expanded={Boolean(templatesAnchor)}
        onClick={e => setTemplatesAnchor(e.currentTarget)}
      >
        Templates
      </Button>
      <Menu
        anchorEl={templatesAnchor}
        open={Boolean(templatesAnchor)}
        onClose={() => setTemplatesAnchor(null)}
      >
        {/* A Menu wants its items as direct children, not wrapped in fragments. */}
        {TEMPLATE_CATEGORIES.flatMap(category => [
          <ListSubheader key={category}>{category}</ListSubheader>,
          ...SHAPER_TEMPLATES.filter(t => t.category === category).map(template => (
            <MenuItem key={template.id} onClick={() => void openTemplate(template)}>
              <ListItemText primary={template.name} secondary={template.summary} />
            </MenuItem>
          )),
        ])}
      </Menu>
    </Stack>
  )

  return (
    <>
      <DesignerLayout
        label="Shaper Designer"
        toolbar={toolbar}
        left={
          <Stack spacing={1.5}>
            <Typography variant="h3">Shapes</Typography>
            <ShapePalette onAdd={kind => addShape(kind)} />
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
        canvas={view === '3d' ? (
          <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
            <ShaperView3D
              doc={doc.doc}
              textOutlines={textOutlines}
              selection={doc.selection}
              snapMm={snapMm}
              imperial={imperial}
              fitToken={fitToken}
              onSelect={doc.toggleSelection}
              onClearSelection={doc.clearSelection}
              onMove={(id, dx, dy) => doc.moveObjects([id], dx, dy, 0)}
            />
          </Suspense>
        ) : (
          <Canvas2D
            shapes={shapes}
            objects={objects}
            selection={doc.selection}
            gridMm={gridMm}
            snapMm={snapMm}
            stockMm={stock}
            reachMm={reach}
            pickPoints={gapPicks && selectedObject ? {
              markers: gapPicks,
              onPick: (x, y) => {
                const next: [number, number][] = [...gapPicks, [x, y]]
                if (next.length < 2) { setGapPicks(next); return }
                openAt(selectedObject, next[0], next[1])
                setGapPicks(null)
              },
            } : null}
            fitToken={fitToken}
            imperial={imperial}
            onSelect={doc.toggleSelection}
            onClearSelection={doc.clearSelection}
            onMove={(ids, dx, dy) => doc.moveObjects(ids, dx, dy, 0)}
            onRotate={(id, deg) => {
              const object = findObject(objects, id)
              if (!object) return
              const r = object.transform.rotationDeg
              doc.updateObject(id, {
                transform: { ...object.transform, rotationDeg: [r[0], r[1], deg] },
              })
            }}
            // The canvas has already worked out the new dimensions and the
            // position that keeps the held edge still; one patch, one undo step.
            onResize={(id, patch) => doc.updateObject(id, patch)}
            onDropPaletteItem={(payload, x, y) => {
              const kind = (payload as { kind?: PaletteKind }).kind
              if (kind) addShape(kind, x, y)
            }}
            emptyHint="Add a shape from the left, or import an SVG or DXF."
          />
        )}
        right={
          <Stack spacing={1.5}>
            <Typography variant="h3">Properties</Typography>
            <Inspector
              object={selectedObject}
              selectionCount={doc.selection.size}
              imperial={imperial}
              showCut
              showZ={false}
              showThickness
              onPatch={patchSelected}
            />
            <Divider />
            {doc.selection.size >= 2 && (
              <>
                <Typography variant="h3">Merge</Typography>
                <Button size="small" variant="outlined" disabled={!canMerge} onClick={mergeSelected}>
                  Merge {doc.selection.size} objects
                </Button>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Joins them into one outline; a hole object is cut out of the rest.
                </Typography>
              </>
            )}
            {selectedObject?.type === 'path' && (
              <>
                <Typography variant="h3">Outline</Typography>
                {gapPicks ? (
                  <Alert
                    severity="info" variant="outlined"
                    action={<Button size="small" onClick={() => setGapPicks(null)}>Cancel</Button>}
                  >
                    {gapPicks.length === 0
                      ? 'Click where the removed section starts.'
                      : 'Click where it ends. The shorter way round is removed.'}
                  </Alert>
                ) : (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small" variant="outlined" disabled={selectedObject.locked}
                      onClick={() => setGapPicks([])}
                    >
                      Remove a section…
                    </Button>
                    {!!selectedObject.openRings?.length && (
                      <Button size="small" onClick={() => closeOpenRings(selectedObject)}>
                        Close path
                      </Button>
                    )}
                  </Stack>
                )}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Removing a section leaves an open path and switches the cut to On line.
                </Typography>
              </>
            )}
            <Typography variant="h3">Machine</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {SHAPER_ORIGIN.label} · {SHAPER_ORIGIN.toolDiameterMm} mm bit
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  size="small" checked={showBenchPilot}
                  onChange={e => setShowBenchPilot(e.target.checked)}
                />
              }
              label="Show BenchPilot cut area"
            />
            {showBenchPilot && (
              <TextField
                select size="small" label="BenchPilot mounted" value={benchPilotMount}
                onChange={e => setBenchPilotMount(e.target.value as BenchPilotMount)}
              >
                <MenuItem value="workstation">On Workstation</MenuItem>
                <MenuItem value="bench">Directly on bench</MenuItem>
              </TextField>
            )}
            {showBenchPilot && needsTurn && (
              <Alert
                severity="info" variant="outlined"
                action={<Button size="small" onClick={turnToFit}>Turn</Button>}
              >
                The design fits the cut area only turned a quarter.
              </Alert>
            )}
            {depthConflict.length > 0 && (
              <Alert severity="warning" variant="outlined">
                Pockets are set to different depths ({depthConflict.join(', ')} mm). An SVG
                carries one depth per layer, so the deepest is written and Origin will cut
                them all to it.
              </Alert>
            )}
          </Stack>
        }
        status={
          <span>
            {objects.length} {objects.length === 1 ? 'object' : 'objects'}
            {doc.selection.size > 0 && ` · ${doc.selection.size} selected`}
          </span>
        }
      />

      <OpenDocumentDialog
        open={openDialog}
        documents={lifecycle.documents}
        loading={lifecycle.listLoading}
        kind="shaper"
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
        open={Boolean(lifecycle.toast)}
        autoHideDuration={3_000}
        onClose={() => lifecycle.setToast(null)}
        message={lifecycle.toast ?? ''}
      />
      <Snackbar
        open={Boolean(lifecycle.error)}
        autoHideDuration={6_000}
        onClose={() => lifecycle.setError(null)}
      >
        <Alert severity="error" onClose={() => lifecycle.setError(null)}>
          {lifecycle.error}
        </Alert>
      </Snackbar>
    </>
  )
}
