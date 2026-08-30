// AI Imagination Playground: describe a part, watch it appear, keep talking to
// refine it, then save it or take it into one of the two designers.
//
// The layout is deliberately not the three-column workbench the other two use:
// here the conversation is the tool, so it gets a column of its own rather than
// a corner of the inspector.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, Paper, Snackbar, Stack, Tooltip, Typography,
} from '@mui/material'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import RedoRoundedIcon from '@mui/icons-material/RedoRounded'
import ArchitectureRoundedIcon from '@mui/icons-material/ArchitectureRounded'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import { useNavigate } from 'react-router-dom'

import AiPanel from '../../components/designer/AiPanel.tsx'
import { summarise, useAiDesigner } from '../../components/designer/useAiDesigner.ts'
import { OpenDocumentDialog, SaveAsDialog } from '../../components/designer/DocumentDialogs.tsx'
import { useDocumentLifecycle } from '../../components/designer/useDocumentLifecycle.ts'
import ObjectTree from '../../components/designer/ObjectTree.tsx'
import Viewport3D from '../../components/viewport3d/Viewport3D.tsx'
import type { ViewportPart } from '../../components/viewport3d/Viewport3D.tsx'
import { EmptyState } from '../../components/LoadingState.tsx'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { programToObjects } from '../../csg/toScene.ts'
import { useSceneMeshes } from '../bambu-designer/useSceneMeshes.ts'
import { checkPrint, worstSeverity } from '../bambu-designer/printChecks.ts'
import { BAMBU_X2D } from '../../model/machines.ts'
import { useDesignDocument } from '../../state/useDesignDocument.ts'
import { safeFilename, triggerDownload } from '../../export/download.ts'
import { writeBinaryStl } from '../../export/stl.ts'
import { writeThreeMf } from '../../export/threemf.ts'
import { resolveTextOutlines } from '../../text/fonts.ts'
import { findObject } from '../../model/scene.ts'
import type { ChatTurn } from '../../model/document.ts'
import type { Ring } from '../../geometry/vec.ts'
import type { Mesh } from '../../geometry/mesh.ts'

const EXAMPLES = [
  'I want a phone stand for my iPhone',
  'A desk cable clip that screws down',
  'A 60 mm hex knob with a 6 mm shaft hole',
]

export default function PlaygroundPage() {
  const navigate = useNavigate()
  const doc = useDesignDocument('playground')
  const lifecycle = useDocumentLifecycle({ kind: 'playground', doc: doc.doc, setDoc: doc.setDoc })
  const assistant = useAiDesigner('playground')

  const [fitToken, setFitToken] = useState(0)
  const [openDialog, setOpenDialog] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [textOutlines, setTextOutlines] = useState<Map<string, Ring[]>>(new Map())
  const [previewMesh, setPreviewMesh] = useState<Mesh | null>(null)

  const objects = doc.doc.objects

  useEffect(() => {
    let cancelled = false
    void resolveTextOutlines(objects, id => {
      const found = findObject(objects, id)
      return found?.type === 'text' ? found : undefined
    }).then(resolved => { if (!cancelled) setTextOutlines(resolved) })
    return () => { cancelled = true }
  }, [objects])

  const { parts, evaluating } = useSceneMeshes(doc.doc, textOutlines)

  const currentProgram = useMemo(
    () => programFromScene(objects, { textOutlines }), [objects, textOutlines])

  // A proposal is rendered as a ghost beside the current model, so the change
  // is visible before it is accepted rather than after.
  const proposal = assistant.proposal
  const previewToken = useRef(0)
  useEffect(() => {
    const run = ++previewToken.current
    if (!proposal) { setPreviewMesh(null); return }
    void evaluateProgram(proposal.program)
      .then(mesh => { if (run === previewToken.current) setPreviewMesh(mesh) })
      .catch(() => { if (run === previewToken.current) setPreviewMesh(null) })
  }, [proposal])

  const viewportParts = useMemo<ViewportPart[]>(() => {
    if (previewMesh) {
      // While a proposal is up it is the thing to look at; showing both would
      // be two overlapping solids and no way to read either.
      return [{ id: '__preview', mesh: previewMesh, mode: 'solid' }]
    }
    return parts.map(p => ({
      id: p.object.id, mesh: p.mesh, mode: p.object.mode, color: p.object.color,
    }))
  }, [previewMesh, parts])

  const wholeMesh = useMemo(
    () => (previewMesh ? null : parts.length ? parts[0].mesh : null), [previewMesh, parts])
  const issues = useMemo(() => checkPrint(wholeMesh, BAMBU_X2D), [wholeMesh])
  const severity = worstSeverity(issues)

  const applyProposal = useCallback(() => {
    const pending = assistant.proposal
    if (!pending) return
    const next = programToObjects(pending.program)
    // One replace call: the geometry and the transcript land together, so the
    // whole turn is a single undo step. The transcript is taken from the hook
    // rather than accumulated here, so there is one source of truth for it.
    const transcript: ChatTurn[] = [
      ...assistant.turns,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: pending.notes,
        at: new Date().toISOString(),
        summary: summarise(pending.diff),
      },
    ]
    doc.replace(d => ({ ...d, objects: next, chat: transcript }))
    assistant.accept()
    setFitToken(t => t + 1)
  }, [assistant, doc])

  const exportMesh = useCallback(async (format: 'stl' | '3mf') => {
    if (!currentProgram.parts.length) {
      lifecycle.setError('There is nothing to export yet.')
      return
    }
    try {
      const mesh = await evaluateProgram(currentProgram)
      const name = safeFilename(doc.doc.name)
      if (format === 'stl') {
        triggerDownload(writeBinaryStl(mesh, doc.doc.name), `${name}.stl`, 'model/stl')
      } else {
        triggerDownload(writeThreeMf(mesh, doc.doc.name), `${name}.3mf`, 'model/3mf')
      }
    } catch (cause) {
      lifecycle.setError(cause instanceof Error ? cause.message : 'export failed')
    }
  }, [currentProgram, doc.doc.name, lifecycle])

  const handOff = useCallback(async (kind: 'shaper' | 'bambu') => {
    const id = await lifecycle.handOff(kind)
    const path = kind === 'shaper' ? '/shaper-designer' : '/bambu-designer'
    if (id) navigate(`${path}?open=${id}`)
  }, [lifecycle, navigate])

  return (
    <>
      <Box
        component="section"
        aria-label="AI Imagination Playground"
        sx={{
          display: 'grid', gap: 1.5,
          gridTemplateRows: 'auto minmax(0, 1fr)',
          height: '100%', minHeight: 0,
        }}
      >
        <Paper component="header" elevation={0} sx={{ p: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography
              variant="h1" component="h1"
              sx={{ fontSize: '1.0625rem', pr: 1.5, borderRight: 1, borderColor: 'divider' }}
            >
              AI Imagination Playground
            </Typography>
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
            <Button size="small" onClick={() => setFitToken(t => t + 1)}>Fit</Button>

            <Box sx={{ flex: 1 }} />

            <Button
              size="small" startIcon={<ArchitectureRoundedIcon />}
              disabled={!objects.length}
              onClick={() => void handOff('shaper')}
            >
              Continue in Shaper
            </Button>
            <Button
              size="small" startIcon={<ViewInArRoundedIcon />}
              disabled={!objects.length}
              onClick={() => void handOff('bambu')}
            >
              Continue in Bambu
            </Button>
            <Button size="small" disabled={!objects.length} onClick={() => void exportMesh('stl')}>
              STL
            </Button>
            <Button size="small" disabled={!objects.length} onClick={() => void exportMesh('3mf')}>
              3MF
            </Button>

            <Divider orientation="vertical" flexItem />

            <Button size="small" onClick={lifecycle.create}>New</Button>
            <Button size="small" onClick={() => setOpenDialog(true)}>Open</Button>
            <Button size="small" onClick={() => setSaveAsOpen(true)}>Save as</Button>
            <Button
              size="small" variant="contained" disabled={lifecycle.busy || !objects.length}
              onClick={() => void lifecycle.save()}
            >
              {lifecycle.hasUnsavedChanges ? 'Save *' : 'Save'}
            </Button>
          </Stack>
        </Paper>

        <Box
          sx={{
            display: 'grid', gap: 1.5, minHeight: 0,
            gridTemplateColumns: { xs: '1fr', md: '340px minmax(0, 1fr)' },
            gridTemplateRows: { xs: 'minmax(320px, 45vh) auto', md: 'minmax(0, 1fr)' },
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 1.5, display: 'flex', flexDirection: 'column', minHeight: 0,
              overflowY: 'auto', order: { xs: 2, md: 0 },
            }}
          >
            <Stack spacing={1.5}>
              <Typography variant="h3">Describe your idea</Typography>
              <AiPanel
                available={assistant.available}
                busy={assistant.busy}
                error={assistant.error}
                proposal={assistant.proposal}
                turns={assistant.turns}
                placeholder="I want a phone stand for my iPhone"
                onSend={prompt => void assistant.send(
                  prompt, objects.length ? currentProgram : null)}
                onApply={applyProposal}
                onDiscard={assistant.discard}
                onDismissError={() => assistant.setError(null)}
              />

              {!assistant.turns.length && assistant.available !== false && (
                <Stack spacing={0.5}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Try one of these:
                  </Typography>
                  {EXAMPLES.map(example => (
                    <Button
                      key={example} size="small" sx={{ justifyContent: 'flex-start' }}
                      disabled={assistant.busy}
                      onClick={() => void assistant.send(example, null)}
                    >
                      {example}
                    </Button>
                  ))}
                </Stack>
              )}

              {objects.length > 0 && (
                <>
                  <Divider />
                  <Typography variant="h3">Parts</Typography>
                  <ObjectTree
                    objects={objects}
                    selection={doc.selection}
                    onSelect={doc.toggleSelection}
                    onToggleVisible={(id, visible) => doc.updateObject(id, { visible })}
                    onToggleLocked={(id, locked) => doc.updateObject(id, { locked })}
                  />
                </>
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
            </Stack>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              position: 'relative', display: 'flex', flexDirection: 'column',
              minHeight: 0, overflow: 'hidden', order: { xs: 1, md: 0 },
              bgcolor: 'background.default',
            }}
          >
            {objects.length || previewMesh ? (
              <Viewport3D
                parts={viewportParts}
                selection={doc.selection}
                buildMm={BAMBU_X2D.buildMm}
                gizmo="translate"
                snapMm={1}
                fitToken={fitToken}
                onSelect={(id, additive) => {
                  if (id && id !== '__preview') doc.toggleSelection(id, additive)
                  else doc.clearSelection()
                }}
                onTransform={(id, change) => {
                  const object = findObject(objects, id)
                  if (!object) return
                  const t = object.transform
                  doc.updateObject(id, {
                    transform: {
                      ...t,
                      position: [
                        t.position[0] + change.position[0],
                        t.position[1] + change.position[1],
                        t.position[2] + change.position[2],
                      ],
                    },
                  })
                }}
              />
            ) : (
              <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <EmptyState
                  title="Nothing here yet"
                  description="Describe what you want to make and it will appear here."
                />
              </Box>
            )}
            <Stack
              aria-live="polite"
              sx={{
                position: 'absolute', left: 12, bottom: 10, pointerEvents: 'none',
                color: 'text.secondary', fontSize: '0.75rem',
              }}
            >
              <span>
                {previewMesh
                  ? 'Previewing a proposed change'
                  : `${objects.length} ${objects.length === 1 ? 'part' : 'parts'}`}
                {evaluating && ' · building…'}
              </span>
            </Stack>
          </Paper>
        </Box>
      </Box>

      <OpenDocumentDialog
        open={openDialog}
        documents={lifecycle.documents}
        loading={lifecycle.listLoading}
        kind="playground"
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
