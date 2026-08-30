// Shaper Designer: 2D CNC design for the Shaper Origin.
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
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import { useNavigate } from 'react-router-dom'

import Canvas2D from '../../components/canvas2d/Canvas2D.tsx'
import type { CanvasShape } from '../../components/canvas2d/Canvas2D.tsx'
import DesignerLayout from '../../components/designer/DesignerLayout.tsx'
import { OpenDocumentDialog, SaveAsDialog } from '../../components/designer/DocumentDialogs.tsx'
import Inspector from '../../components/designer/Inspector.tsx'
import ObjectTree from '../../components/designer/ObjectTree.tsx'
import { useDocumentLifecycle } from '../../components/designer/useDocumentLifecycle.ts'
import { useConfirm } from '../../components/ConfirmDialogProvider.tsx'
import { compileObject } from '../../geometry/sceneShapes.ts'
import type { SceneObject } from '../../model/document.ts'
import { SHAPER_ORIGIN } from '../../model/machines.ts'
import { createShape2D, createText, findObject } from '../../model/scene.ts'
import { useDesignDocument } from '../../state/useDesignDocument.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { writeShaperSvg } from '../../export/shaperSvg.ts'
import { writeDxf } from '../../export/dxf.ts'
import { DEFAULT_FONT_ID, resolveTextOutlines } from '../../text/fonts.ts'
import type { Ring } from '../../geometry/vec.ts'
import { SHAPER_IMPORT_FORMATS } from '../../import/index.ts'
import ShapePalette from './components/ShapePalette.tsx'
import type { PaletteKind } from './components/paletteEntries.ts'
import ImportButton from './components/ImportButton.tsx'
import { conflictingPocketDepths, sceneCutDrawing } from './cutDrawing.ts'

const SNAP_OPTIONS = [0, 0.5, 1, 5, 10]
const GRID_OPTIONS = [0, 5, 10, 25]

export default function ShaperDesignerPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const doc = useDesignDocument('shaper')
  const lifecycle = useDocumentLifecycle({ kind: 'shaper', doc: doc.doc, setDoc: doc.setDoc })

  const [imperial, setImperial] = useState(false)
  const [snapMm, setSnapMm] = useState(1)
  const [gridMm, setGridMm] = useState(10)
  const [fitToken, setFitToken] = useState(0)
  const [openDialog, setOpenDialog] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
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
      .map(o => ({
        id: o.id,
        name: o.name,
        polygons: compileObject(o, compileOptions),
        mode: o.mode,
        cutType: o.cut?.type,
        locked: o.locked,
      }))
      .filter(s => s.polygons.length),
    [objects, compileOptions],
  )

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, removeSelected])

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

  const stock = useMemo(() => ({ widthMm: 300, heightMm: 200 }), [])

  const toolbar = (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="h1" component="h1" sx={{ fontSize: '1.0625rem', pr: 1.5, borderRight: 1, borderColor: 'divider' }}>
        Shaper Designer
      </Typography>

      <Tooltip title="Undo" describeChild>
        <span>
          <IconButton size="small" aria-label="Undo" disabled={!doc.canUndo} onClick={doc.undo}>
            <UndoRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Redo" describeChild>
        <span>
          <IconButton size="small" aria-label="Redo" disabled={!doc.canRedo} onClick={doc.redo}>
            <RedoRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Duplicate" describeChild>
        <span>
          <IconButton
            size="small" aria-label="Duplicate" disabled={!doc.selection.size}
            onClick={() => doc.duplicateObjects(doc.selection)}
          >
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Group" describeChild>
        <span>
          <IconButton
            size="small" aria-label="Group" disabled={doc.selection.size < 2}
            onClick={() => doc.groupObjects(doc.selection)}
          >
            <CallMergeRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Ungroup" describeChild>
        <span>
          <IconButton
            size="small" aria-label="Ungroup"
            disabled={!selectedObject || selectedObject.type !== 'group'}
            onClick={() => selectedObject && doc.ungroupObject(selectedObject.id)}
          >
            <CallSplitRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Delete" describeChild>
        <span>
          <IconButton
            size="small" aria-label="Delete" disabled={!doc.selection.size}
            onClick={() => void removeSelected()}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

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
      <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>

      <Box sx={{ flex: 1 }} />

      <ImportButton
        formats={SHAPER_IMPORT_FORMATS}
        onImported={objects => doc.addObjects(objects)}
        onError={lifecycle.setError}
      />
      <Button
        size="small" startIcon={<ViewInArRoundedIcon />}
        onClick={async () => {
          const id = await lifecycle.handOff('bambu')
          // The clone's id rides along so the target opens it rather than a
          // fresh empty document.
          if (id) navigate(`/bambu-designer?open=${id}`)
        }}
      >
        To Bambu
      </Button>
      <Button size="small" onClick={() => exportFile('svg')}>SVG</Button>
      <Button size="small" onClick={() => exportFile('dxf')}>DXF</Button>

      <Divider orientation="vertical" flexItem />

      <Button size="small" onClick={lifecycle.create}>New</Button>
      <Button size="small" onClick={() => setOpenDialog(true)}>Open</Button>
      <Button size="small" onClick={() => setSaveAsOpen(true)}>Save as</Button>
      <Button
        size="small" variant="contained" disabled={lifecycle.busy}
        onClick={() => void lifecycle.save()}
      >
        {lifecycle.hasUnsavedChanges ? 'Save *' : 'Save'}
      </Button>
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
        canvas={
          <Canvas2D
            shapes={shapes}
            objects={objects}
            selection={doc.selection}
            gridMm={gridMm}
            snapMm={snapMm}
            stockMm={stock}
            fitToken={fitToken}
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
            onDropPaletteItem={(payload, x, y) => {
              const kind = (payload as { kind?: PaletteKind }).kind
              if (kind) addShape(kind, x, y)
            }}
            emptyHint="Add a shape from the left, or import an SVG or DXF."
          />
        }
        right={
          <Stack spacing={1.5}>
            <Typography variant="h3">Properties</Typography>
            <Inspector
              object={selectedObject}
              selectionCount={doc.selection.size}
              imperial={imperial}
              showCut
              showZ={false}
              onPatch={patchSelected}
            />
            <Divider />
            <Typography variant="h3">Machine</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {SHAPER_ORIGIN.label} · {SHAPER_ORIGIN.toolDiameterMm} mm bit
            </Typography>
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
