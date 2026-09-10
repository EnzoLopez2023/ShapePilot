// @vitest-environment jsdom
//
// A tray inside a project: the gate, set coverage, and what is remembered.
//
// These mount the designer repeatedly -- proving view settings are remembered
// per tray rather than globally needs three mounts -- so they are the slowest
// of the four and belong on their own.
//
// Split out of what was a single 1,054-line file: vitest parallelises by file
// and cannot overlap a file with itself, so one 160 s suite was the long pole
// of the whole quality job. The stub and render helpers live in
// test/helpers/keycapTrayHarness.tsx so every part still exercises the same
// client stack -- service, HTTP client, state hook, components -- against the
// same fetch boundary.
import assert from 'node:assert/strict'
import { describe, expect, test, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SHIPPED_DESIGNER_DEFAULTS } from '../../src/features/settings/preferences.ts'
import KeycapTrayPage from '../../src/features/keycap-tray/KeycapTrayPage.tsx'
import {
  awaitTrayLoaded, installHarness, renderPage, renderWorkbench, state,
} from './keycapTrayHarness.tsx'
//
// TIMEOUT. Longer than the 30 s default. The cost here is real work, not
// waste: mounting the designer is ~570 ms and any interaction reaching the
// canvas is ~300 ms, of which the canvas itself is under 40 ms -- the rest is
// the event sequence and MUI re-rendering the page. Measured, not assumed.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

installHarness()
describe('project gate', () => {
  test('with no tray open, the canvas area offers a project instead of a blank tray', async () => {
    state.projectList = [{ id: '9', name: 'Womier', trayCount: 2, updatedAt: '2026-08-28 12:00:00' }]
    renderPage()
    assert.ok(await screen.findByRole('button', { name: 'New project' }))
    assert.ok(await screen.findByRole('button', { name: /Womier/ }))
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Keycap tray')
    // No workbench: no canvas, no palette, no Save.
    assert.equal(screen.queryByRole('application'), null)
    assert.equal(screen.queryByRole('heading', { name: 'Pockets' }), null)
    assert.equal(screen.queryByRole('button', { name: /^Save/ }), null)
  })

  test('creating a project from the gate posts it with a first tray', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'GMK Olivia')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-projects')).toBe(true))
    await waitFor(() => {
      const tray = state.calls.find(c => c.method === 'POST' && c.path === '/api/keycap-trays')
      assert.ok(tray, 'the project gets a first tray')
      assert.equal((tray.body as { name: string; projectId: string }).name, 'Tray 1')
      assert.equal((tray.body as { name: string; projectId: string }).projectId, 'p-new')
    })
  })

  test('opening a project from the gate loads its most recently edited tray', async () => {
    state.projectList = [{ id: '9', name: 'Womier', trayCount: 2, updatedAt: '2026-08-28 12:00:00' }]
    state.designs = [
      { id: '1', name: 'Older tray', pocketCount: 0, updatedAt: '2026-08-01 09:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
      { id: '2', name: 'Newer tray', pocketCount: 0, updatedAt: '2026-08-28 18:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    ]
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Womier/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'GET' && c.path === '/api/keycap-trays/2')).toBe(true))
  })

  test('the toolbar New button adds a tray to the current project', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await awaitTrayLoaded()

    await user.click(screen.getByRole('button', { name: 'New tray' }))
    await waitFor(() => {
      const tray = state.calls.find(c => c.method === 'POST' && c.path === '/api/keycap-trays')
      assert.ok(tray)
      assert.equal((tray.body as { name: string; projectId: string }).projectId, '9')
      assert.equal((tray.body as { name: string; projectId: string }).name, 'Tray 2')
    })
  })

  test('the project menu no longer offers attach or detach', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(await screen.findByRole('button', { name: /Womier/ }))
    const menu = await screen.findByRole('menu', { name: 'Project' })
    assert.ok(within(menu).getByRole('menuitem', { name: /New tray in this project/ }))
    assert.equal(within(menu).queryByRole('menuitem', { name: /Add to project/ }), null)
    assert.equal(within(menu).queryByRole('menuitem', { name: /Remove from project/ }), null)
  })
})

test('the designer says what is left of the set, and a trough counts every cap in it', async () => {
  // A set is cut across several trays, so this is a question about the project:
  // the other trays come from the server and this one is read live, before
  // anything is saved.
  state.designs = [{
    id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: '9', projectName: 'Womier - Brown Grey',
  }]
  state.project = {
    id: '9',
    items: [
      { units: 1, count: 20, legend: 'alphas' },
      { units: 2.25, count: 1, legend: 'Enter' },
    ],
    // Another tray in the project already holds five 1u caps.
    coverage: [{ units: 1, heightUnits: 1, shape: null, pockets: 5 }],
  }

  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Set coverage' })).toBeTruthy())

  // Five 1u pockets on the other tray, plus the one this tray already carries.
  await waitFor(() => expect(screen.getByText(/6 of 21 placed/)).toBeTruthy())
  assert.ok(screen.getByText(/14 more 1u caps need room/))
  // The Enter has no home anywhere yet.
  assert.ok(screen.getByText('2.25u × 1'))

  // Drop one 10u pocket on this tray: ten more 1u caps have a home, live,
  // before anything is saved.
  await user.click(screen.getByRole('tab', { name: 'All 1u–13u' }))
  await user.click(await screen.findByRole('button', { name: 'Add a 10u pocket' }))
  await waitFor(() => expect(screen.getByText(/16 of 21 placed/)).toBeTruthy())
  assert.ok(screen.getByText(/4 more 1u caps need room/))
  // The Enter still needs a pocket of its own size; a trough will not do.
  assert.ok(screen.getByText('2.25u × 1'))
})

test('a tray in no project shows no coverage panel', async () => {
  state.designs = [{
    id: '1', name: 'Loose tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: null, projectName: null,
  }]
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Tray' })).toBeTruthy())
  assert.equal(screen.queryByRole('heading', { name: 'Set coverage' }), null)
})

test('a project’s trays are switchable from the designer', async () => {
  // A set is laid out across several trays at once, so moving between them is
  // part of the work -- and the list is already in hand, so it costs nothing.
  state.designs = [
    { id: '1', name: 'Top tray', pocketCount: 3, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    { id: '2', name: 'Middle tray', pocketCount: 29, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    { id: '3', name: 'Someone else’s tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: null, projectName: null },
  ]
  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')

  const projectButton = await screen.findByRole('button', { name: /Womier/ })
  await user.click(projectButton)

  const menu = await screen.findByRole('menu', { name: 'Project' })
  assert.ok(within(menu).getByRole('menuitem', { name: /Top tray/ }))
  assert.ok(within(menu).getByRole('menuitem', { name: /Middle tray/ }))
  // Only this project's trays; a loose tray is not in the set being laid out.
  assert.equal(within(menu).queryByRole('menuitem', { name: /Someone else/ }), null)

  await user.click(within(menu).getByRole('menuitem', { name: /Middle tray/ }))
  // Switching loads that tray, and the URL follows so the back button works.
  await waitFor(() => expect(
    state.calls.some(c => c.method === 'GET' && c.path === '/api/keycap-trays/2')).toBe(true))
})

test('a tray comes back the way it was last being looked at', async () => {
  // Snap, grid and the buffer guide are how someone was working on a tray, not
  // facts about it -- but retyping four dropdowns on every open is a tax.
  state.designs = [
    { id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset' },
    { id: '2', name: 'Middle tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset' },
  ]
  const user = userEvent.setup()
  const first = renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Hide labels' }))
  await user.click(screen.getByRole('button', { name: 'Show buffer' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide buffer' })).toBeTruthy())
  first.unmount()

  // A different tray is unaffected: each is remembered on its own.
  const second = renderPage(<KeycapTrayPage />, '/keycap-tray/2')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: 'Show buffer' }))
  second.unmount()

  // Reopening the first brings its settings back.
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: 'Hide buffer' }))
})

test('a new tray in the project opens fresh, not the last tray’s working state', async () => {
  state.designs = [{
    id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: '9', projectName: 'Womier',
  }]
  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(
    (screen.getByRole('button', { name: 'Clone' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(screen.getByRole('button', { name: 'Hide labels' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'New tray' }))
  // The new tray is created in the same project and opened. It starts from the
  // designer defaults -- labels shown -- not the toggled state of Top tray.
  await waitFor(() => expect(
    state.calls.some(c => c.method === 'GET' && c.path === '/api/keycap-trays/2')).toBe(true))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  assert.notEqual(screen.getByRole('heading', { level: 1 }).textContent, 'Top tray')
})

test('a tray with nothing remembered opens the way the settings page says', async () => {
  // Defaults belong to the designer, not to any one tray: a tray that has been
  // worked on before comes back the way it was left instead.
  state.designerDefaults = {
    ...SHIPPED_DESIGNER_DEFAULTS,
    keycapTray: {
      ...SHIPPED_DESIGNER_DEFAULTS.keycapTray,
      showLabels: false,
      showBuffer: true,
      snapMm: 19.05,
    },
  }
  state.designs = [{
    id: '1', name: 'Fresh tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: '9', projectName: 'Womier',
  }]
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: 'Hide buffer' }))
  assert.equal(screen.getByRole('combobox', { name: 'Snap' }).textContent, '1u pitch')
})

test('a remembered tray beats the settings defaults', async () => {
  state.designerDefaults = {
    ...SHIPPED_DESIGNER_DEFAULTS,
    keycapTray: { ...SHIPPED_DESIGNER_DEFAULTS.keycapTray, showLabels: false },
  }
  state.designs = [{
    id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset',
  }]
  const user = userEvent.setup()
  const first = renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  // Opens from the default -- labels off.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Show labels' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  first.unmount()

  // Reopened, the tray's own memory wins over the designer default.
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
})
