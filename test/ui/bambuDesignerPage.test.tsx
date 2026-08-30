// @vitest-environment jsdom
//
// The Bambu Designer. WebGL does not exist in jsdom, so the viewport itself is
// stubbed and what is asserted here is everything around it: the document
// operations, the Tinkercad solid/hole affordance, and the machine wiring.
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

const { default: BambuDesignerPage } =
  await import('../../src/features/bambu-designer/BambuDesignerPage.tsx')

const renderPage = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter><BambuDesignerPage /></MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('/api/ai/status')) {
      return new Response(JSON.stringify({ available: false }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/design-documents')) {
      return new Response(JSON.stringify([]), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('the page has one h1 and defaults to the X2D', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
  assert.equal(screen.getByLabelText('Printer').textContent, 'Bambu Lab X2D')
})

test('a solid can be added as a hole, which the tree says out loud', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add as hole' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Add as hole' }))
  await user.click(screen.getByRole('button', { name: /Cylinder/ }))

  const tree = await screen.findByRole('list', { name: 'Objects' })
  await waitFor(() => expect(within(tree).getByText(/hole/)).toBeTruthy())
})

test('align needs more than one object', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Align X Centre' })).toBeTruthy())

  assert.ok(screen.getByRole('button', { name: 'Align X Centre' }).hasAttribute('disabled'))
  await user.click(screen.getByRole('button', { name: /^Box/ }))
  // Still one object, so still nothing to align against.
  assert.ok(screen.getByRole('button', { name: 'Align X Centre' }).hasAttribute('disabled'))
})

test('the transform tool can be switched and reports its state', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy())

  assert.equal(screen.getByRole('button', { name: 'Move' }).getAttribute('aria-pressed'), 'true')
  await user.click(screen.getByRole('button', { name: 'Rotate' }))
  assert.equal(screen.getByRole('button', { name: 'Rotate' }).getAttribute('aria-pressed'), 'true')
  assert.equal(screen.getByRole('button', { name: 'Move' }).getAttribute('aria-pressed'), 'false')
})

test('the assistant reports itself unavailable rather than failing', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText(/not configured for this deployment/)).toBeTruthy())
})

test('an added solid lands in the document and the object tree', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /^Box/ }))

  const tree = await screen.findByRole('list', { name: 'Objects' })
  assert.ok(within(tree).getByText('Box'))
  assert.ok(screen.getAllByText(/1 object/).length > 0)
  // Whether it then reaches the viewport is a question about the CSG kernel,
  // which is WASM and does not run under jsdom. That path is covered for real
  // in src/csg/evaluate.test.ts, which asserts watertightness and volume.
})

test('undo removes the object that was just added', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Sphere/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /^Sphere/ }))
  const tree = await screen.findByRole('list', { name: 'Objects' })
  assert.ok(within(tree).getByText('Sphere'))

  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(screen.getAllByText(/0 objects/).length).toBeGreaterThan(0))
})
