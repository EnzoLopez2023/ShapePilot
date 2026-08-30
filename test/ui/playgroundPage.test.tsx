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

let aiAvailable = true
let shapeCalls: unknown[] = []

const renderPage = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter><PlaygroundPage /></MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  aiAvailable = true
  shapeCalls = []
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
      return json(shapeResponse)
    }
    if (url.includes('/api/design-documents')) return json([])
    return json({ ok: true })
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
