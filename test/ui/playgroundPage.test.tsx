// @vitest-environment jsdom
//
// The Playground's contract with the assistant: a turn produces a proposal that
// is shown with what it would change, and nothing reaches the document until it
// is applied. The model is stubbed at the HTTP boundary.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'

vi.mock('../../src/components/viewport3d/Viewport3D.tsx', () => ({
  default: ({ parts }: { parts: { id: string }[] }) =>
    <div data-testid="viewport" data-parts={parts.length} />,
}))

vi.mock('../../src/components/canvas2d/Canvas2D.tsx', () => ({
  default: ({ shapes }: { shapes: { id: string }[] }) =>
    <div data-testid="canvas2d" data-shapes={shapes.length} />,
}))

// jsdom has no createImageBitmap, so the panel's encoder is stubbed at the
// module boundary -- the same choice the keycap project page test makes.
vi.mock('../../src/import/preparePhoto.ts', () => ({
  PHOTO_ACCEPT: 'image/*',
  MAX_PHOTO_BYTES: 1_000_000,
  preparePhoto: async () => ({
    bytes: new TextEncoder().encode('fake-jpeg').buffer,
    format: 'jpeg', filename: 'logo.jpg', width: 120, height: 90,
  }),
}))

const vectorResponse = {
  drawing: {
    version: 1, units: 'mm', widthMm: 40, heightMm: 30,
    paths: [{
      id: 'monogram', name: 'Monogram', fill: '#101010',
      commands: [
        { cmd: 'M', to: [0, 0] },
        { cmd: 'L', to: [20, 0] },
        { cmd: 'L', to: [20, 14] },
        { cmd: 'L', to: [0, 14] },
        { cmd: 'Z' },
      ],
    }],
  },
  notes: 'Traced the monogram.',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
}

const { default: PlaygroundPage } =
  await import('../../src/features/playground/PlaygroundPage.tsx')

const transform = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] }

const shapeResponse = {
  program: {
    version: 1, units: 'mm',
    parts: [{
      id: 'stand-base', name: 'Stand base', op: 'box',
      params: { widthMm: 80, depthMm: 60, heightMm: 8 }, transform,
    }],
  },
  notes: 'Made an 80 by 60 mm base, 8 mm thick.',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
}

/** A design saved after two turns: the conversation belongs to it. */
const savedIdea = {
  id: 'saved-idea', kind: 'playground', name: 'Phone stand', revision: 0,
  objects: [],
  chat: [
    { id: 't1', role: 'user', text: 'A stand for my phone', at: '2026-09-01T10:00:00Z' },
    { id: 't2', role: 'assistant', text: 'Made a 70 mm stand.', at: '2026-09-01T10:00:05Z', summary: 'added stand' },
  ],
}

let aiAvailable = true
let shapeCalls: unknown[] = []
/** When set, the shape reply waits for this before it is sent. */
let holdShapeReply: Promise<void> | null = null

const renderPage = (path = '/playground') => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[path]}><PlaygroundPage /></MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

let vectorCalls: unknown[] = []
const realCreateObjectURL = globalThis.URL.createObjectURL
const realRevokeObjectURL = globalThis.URL.revokeObjectURL

beforeEach(() => {
  aiAvailable = true
  shapeCalls = []
  holdShapeReply = null
  vectorCalls = []
  globalThis.URL.createObjectURL = () => 'blob:mock'
  globalThis.URL.revokeObjectURL = () => {}
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    })
    if (url.includes('/api/ai/status')) return json({ available: aiAvailable })
    if (url.includes('/api/ai/shape')) {
      shapeCalls.push(JSON.parse(String(init?.body ?? '{}')))
      if (holdShapeReply) await holdShapeReply
      return json(shapeResponse)
    }
    if (url.includes('/api/ai/vector')) {
      vectorCalls.push(JSON.parse(String(init?.body ?? '{}')))
      return json(vectorResponse)
    }
    if (url.includes('/api/design-assets/')) return json({ ok: true })
    if (url.includes('/api/design-documents/saved-idea')) return json(savedIdea)
    if (url.includes('/api/design-documents')) return json([])
    return json({ ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  globalThis.URL.createObjectURL = realCreateObjectURL
  globalThis.URL.revokeObjectURL = realRevokeObjectURL
})

/** Pick a photo and run the trace, leaving a proposal on screen. */
const traceAPhoto = async (user: ReturnType<typeof userEvent.setup>) => {
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(fileInput, new File(['x'], 'logo.png', { type: 'image/png' }))
  const traceButton = await screen.findByRole('button', { name: /Trace to vector/ })
  await waitFor(() => expect(traceButton.hasAttribute('disabled')).toBe(false))
  await user.click(traceButton)
}

test('the page has one h1 and offers example prompts before any conversation', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
  assert.ok(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
})

test('a turn produces a proposal that is not applied on its own', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))

  await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())
  assert.ok(screen.getByText(shapeResponse.notes))
  // The named part is shown as an addition, so the change can be reviewed.
  assert.ok(screen.getByText('+ Stand base'))
  assert.ok(screen.getByRole('button', { name: 'Apply' }))
  assert.ok(screen.getByRole('button', { name: 'Discard' }))
  // The proposal is previewed, but nothing has reached the document: the
  // assistant proposes, it never mutates. No parts list means no objects.
  assert.equal(screen.queryByRole('list', { name: 'Objects' }), null)
  assert.ok(screen.getByRole('button', { name: /Continue in Bambu/ }).hasAttribute('disabled'))
})

test('applying puts the named part into the document', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Apply' }))

  const tree = await screen.findByRole('list', { name: 'Objects' })
  assert.ok(within(tree).getByText('Stand base'))
  assert.equal(screen.queryByText('Proposed change'), null)
})

test('the reply is recorded once, not twice', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Apply' }))

  // Applying used to double-post: the transcript append ran inside a setState
  // updater, which StrictMode invokes twice.
  await waitFor(() => expect(screen.getAllByText(shapeResponse.notes).length).toBe(1))
})

test('discarding leaves the document untouched', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Discard' }))
  assert.equal(screen.queryByText('Proposed change'), null)
  assert.equal(screen.queryByRole('list', { name: 'Objects' }), null)
  await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
})

test('a follow-up turn sends the current design so the edit can be targeted', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Apply' }))

  await user.type(screen.getByLabelText(/Describe what you want/),
    'add a hole towards the bottom')
  await user.click(screen.getByRole('button', { name: /Send/ }))

  await waitFor(() => expect(shapeCalls.length).toBe(2))
  const second = shapeCalls[1] as { program?: { parts: { id: string }[] }; context: string }
  assert.equal(second.context, 'playground')
  // Without the current program the model could only start over.
  assert.deepEqual(second.program?.parts.map(p => p.id), ['stand-base'])
})

test('handoff and export stay disabled until there is something to hand off', async () => {
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /Continue in Bambu/ })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: /Continue in Bambu/ }).hasAttribute('disabled'))
  assert.ok(screen.getByRole('button', { name: 'STL' }).hasAttribute('disabled'))
})

test('an unavailable assistant is reported, not hidden', async () => {
  aiAvailable = false
  renderPage()
  await waitFor(() => expect(screen.getByText(/not configured for this deployment/)).toBeTruthy())
})

test('tracing a photo produces a drawing proposal that is not applied on its own', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy())

  await traceAPhoto(user)

  await waitFor(() => expect(screen.getByText('Proposed drawing')).toBeTruthy())
  assert.ok(screen.getByText(vectorResponse.notes))
  assert.ok(screen.getByRole('button', { name: 'Apply' }))
  assert.ok(screen.getByRole('button', { name: 'Discard' }))
  // Only hashes crossed the wire.
  assert.deepEqual((vectorCalls[0] as { hashes: string[] }).hashes.length, 1)
  // Nothing has reached the document.
  assert.equal(screen.queryByRole('list', { name: 'Objects' }), null)
  assert.ok(screen.getByRole('button', { name: 'SVG' }).hasAttribute('disabled'))
})

test('applying a trace puts path objects in the document and switches to the 2D canvas', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy())
  await traceAPhoto(user)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Apply' }))

  const tree = await screen.findByRole('list', { name: 'Objects' })
  assert.ok(within(tree).getByText('Monogram'))
  // The 3D viewport gave way to the 2D canvas, and SVG export is now live.
  assert.ok(screen.getByTestId('canvas2d'))
  assert.equal(screen.queryByTestId('viewport'), null)
  assert.equal(screen.getByRole('button', { name: 'SVG' }).hasAttribute('disabled'), false)
  assert.equal(screen.queryByText('Proposed drawing'), null)
})

test('discarding a trace leaves the document untouched', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy())
  await traceAPhoto(user)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Discard' }))

  assert.equal(screen.queryByText('Proposed drawing'), null)
  assert.equal(screen.queryByRole('list', { name: 'Objects' }), null)
  await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
})

test('opening a saved design brings its conversation back and sends it as history', async () => {
  const user = userEvent.setup()
  renderPage('/playground?open=saved-idea')

  // The transcript was saved with the design but never read back, so a
  // reopened idea showed an empty conversation and the model lost the thread.
  await waitFor(() => expect(screen.getByText('Made a 70 mm stand.')).toBeTruthy())
  assert.ok(screen.getByText('A stand for my phone'))

  await user.type(screen.getByLabelText(/Describe what you want/), 'make it taller')
  await user.click(screen.getByRole('button', { name: /Send/ }))
  await waitFor(() => expect(shapeCalls.length).toBe(1))
  const call = shapeCalls[0] as { history: { text: string }[] }
  assert.deepEqual(call.history.map(t => t.text), ['A stand for my phone', 'Made a 70 mm stand.'])
})

test('undo takes back the turn along with the geometry it made', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(screen.getByText(shapeResponse.notes)).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(screen.queryByText(shapeResponse.notes)).toBeNull())
  assert.equal(screen.queryByRole('list', { name: 'Objects' }), null)
})

test('discarding a proposal drops its question from the conversation', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Discard' }))

  await user.type(screen.getByLabelText(/Describe what you want/), 'a cable clip')
  await user.click(screen.getByRole('button', { name: /Send/ }))
  await waitFor(() => expect(shapeCalls.length).toBe(2))
  assert.deepEqual((shapeCalls[1] as { history: unknown[] }).history, [])
})

test('starting a new idea leaves a pending proposal behind', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByText('Proposed change')).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'New' }))

  // Apply would otherwise merge a proposal about one design into another.
  await waitFor(() => expect(screen.queryByText('Proposed change')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  // The question went with it. Its text is also an example prompt, which a
  // blank design offers again, so look for the transcript's speaker label.
  expect(screen.queryByText(/^You:/)).toBeNull()
})

test('a reply that lands after switching designs is ignored', async () => {
  let release!: () => void
  holdShapeReply = new Promise(resolve => { release = resolve })
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(shapeCalls.length).toBe(1))

  await user.click(screen.getByRole('button', { name: 'New' }))
  release()

  // Give the stale reply every chance to land before asserting it did not.
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(screen.queryByText('Proposed change')).toBeNull()
  expect(screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy()
})

test('a traced drawing can be given thickness and a plate, which switches to 3D', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy())
  await traceAPhoto(user)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  await screen.findByTestId('canvas2d')

  await user.click(screen.getByRole('button', { name: /Extrude/ }))
  const dialog = within(await screen.findByRole('dialog'))
  await user.clear(dialog.getByLabelText('Artwork thickness'))
  await user.type(dialog.getByLabelText('Artwork thickness'), '3')
  await user.click(dialog.getByRole('button', { name: 'Extrude' }))

  // The plate joins the traced path, and the flat canvas gives way to 3D.
  const tree = await screen.findByRole('list', { name: 'Objects' })
  await waitFor(() => expect(within(tree).getByText('Backing plate')).toBeTruthy())
  await waitFor(() => expect(screen.queryByTestId('canvas2d')).toBeNull())
  expect(screen.getByTestId('viewport')).toBeTruthy()
})

test('a proposal can be compared against the model it would replace', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('button', { name: /phone stand for my iPhone/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /phone stand for my iPhone/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Apply' }))

  await user.type(screen.getByLabelText(/Describe what you want/), 'add a hole')
  await user.click(screen.getByRole('button', { name: /Send/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Current' })).toBeTruthy())

  // It opens on the proposal; Current puts the existing model back.
  expect(screen.getByRole('button', { name: 'Proposed' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Current' }))
  expect(screen.getByRole('button', { name: 'Current' }).getAttribute('aria-pressed')).toBe('true')
})

test('the photo panel follows the tracer, which today shares one AI status', async () => {
  aiAvailable = false
  renderPage()
  // Both the shape assistant and the tracer probe /api/ai/status, so an
  // unconfigured deployment has neither. The panel now reads the tracer's own
  // availability, so the two can part company without the panel following the
  // wrong one.
  await waitFor(() => expect(screen.getByText(/not configured for this deployment/)).toBeTruthy())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull())
})
