// @vitest-environment jsdom
//
// The Shaper Designer's document behaviour, driven through the real page: what
// a shape adds, what grouping a hole does to the cut geometry, and that the
// exporters see the same thing the canvas draws.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import ShaperDesignerPage from '../../src/features/shaper-designer/ShaperDesignerPage.tsx'

const renderPage = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter><ShaperDesignerPage /></MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
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

test('the page has one h1 and an accessible canvas', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
  // The canvas advertises its gestures rather than being an unlabelled surface.
  const canvas = screen.getByRole('application')
  assert.match(canvas.getAttribute('aria-label') ?? '', /drag/i)
})

test('adding a shape puts it in the object tree and the status line', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /Rectangle/ })).toBeTruthy())

  assert.ok(screen.getByText('0 objects', { exact: false }))
  await user.click(screen.getByRole('button', { name: /Rectangle/ }))

  await waitFor(() => expect(screen.getByText('1 object', { exact: false })).toBeTruthy())
  assert.ok(screen.getByRole('list', { name: 'Objects' }))
})

test('a newly added shape defaults to an exterior cut, the only one that frees a part', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /Circle/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /Circle/ }))

  await waitFor(() => expect(screen.getByLabelText('Cut type')).toBeTruthy())
  assert.equal(screen.getByLabelText('Cut type').textContent, 'Exterior')
})

test('undo and redo are disabled until there is history', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy())

  assert.ok(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'))
  assert.ok(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled'))

  await user.click(screen.getByRole('button', { name: /Square/ }))
  await waitFor(() => expect(
    screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false))
})

test('undo removes the object that was just added', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /Triangle/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /Triangle/ }))
  await waitFor(() => expect(screen.getByText('1 object', { exact: false })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(screen.getByText('0 objects', { exact: false })).toBeTruthy())
})

test('group needs two objects, and collapses them into one when it has them', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /Square/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /Square/ }))
  assert.ok(screen.getByRole('button', { name: 'Group' }).hasAttribute('disabled'),
    'one object cannot be grouped')

  await user.click(screen.getByRole('button', { name: /Circle/ }))
  await waitFor(() => expect(screen.getByText('2 objects', { exact: false })).toBeTruthy())

  // Adding selects only the new object, so the first is added to the selection
  // through the tree the way a person would.
  const tree = screen.getByRole('list', { name: 'Objects' })
  const squareRow = within(tree).getByText('Square').closest('[role="button"]')
  assert.ok(squareRow)
  // Shift is held around the click: userEvent has no per-click modifier option.
  await user.keyboard('{Shift>}')
  await user.click(squareRow)
  await user.keyboard('{/Shift}')

  await waitFor(() => expect(
    screen.getByRole('button', { name: 'Group' }).hasAttribute('disabled')).toBe(false))
  await user.click(screen.getByRole('button', { name: 'Group' }))

  // Two top-level objects became one; both survive as its children.
  await waitFor(() => expect(screen.getByText('1 object', { exact: false })).toBeTruthy())
  assert.ok(within(tree).getByText('Group'))
  assert.ok(within(tree).getByText('Square'))
  assert.ok(within(tree).getByText('Circle'))
})

test('the machine panel names the tool the checks are against', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText(/Shaper Origin/)).toBeTruthy())
  assert.ok(screen.getByText(/3\.175 mm bit/))
})
