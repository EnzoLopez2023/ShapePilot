// @vitest-environment jsdom
//
// The designer as a document: saving, opening, deleting, units and export.
//
// Everything here is about the tray as data and the shell around it. The
// palette and canvas live in keycapTrayCanvas.test.tsx.
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
import KeycapTrayPage from '../../src/features/keycap-tray/KeycapTrayPage.tsx'
import {
  awaitTrayLoaded, closeOpenMenu, installHarness, renderPage, renderWorkbench, SAVE_ITEM, state,
} from './keycapTrayHarness.tsx'
import { chooseMenu, menuItemDisabled, openMenuItem } from './menuHelpers.tsx'
//
// TIMEOUT. Longer than the 30 s default. The cost here is real work, not
// waste: mounting the designer is ~570 ms and any interaction reaching the
// canvas is ~300 ms, of which the canvas itself is under 40 ms -- the rest is
// the event sequence and MUI re-rendering the page. Measured, not assumed.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

installHarness()
describe('designer page', () => {
  test('it renders the workbench with an accessible canvas and panels', async () => {
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByRole('heading', { name: 'Pockets' }))
    assert.ok(screen.getByRole('heading', { name: 'Tray' }))
    assert.ok(screen.getByRole('group', { name: 'Fabrication target' }))
    assert.ok(screen.getByRole('group', { name: 'Canvas mode' }))
  })

  test('undo, redo and delete are disabled until there is something to act on', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    for (const name of ['Undo', 'Redo', 'Delete']) {
      assert.equal(await menuItemDisabled(user, 'Edit', name), true, name)
    }
  })

  test('adding a pocket from the palette updates the status line and enables undo', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByText(/^0 pockets/))

    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await waitFor(() => expect(screen.getByText(/^1 pockets/)).toBeTruthy())
    assert.equal(await menuItemDisabled(user, 'Edit', 'Undo'), false)

    await chooseMenu(user, 'Edit', 'Undo')
    await waitFor(() => expect(screen.getByText(/^0 pockets/)).toBeTruthy())
  })

  test('saving a project tray issues an update, and clone is available', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    // A saved tray can be cloned once it has loaded -- there is no unsaved
    // scratch state to guard against any more.
    await awaitTrayLoaded()

    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await chooseMenu(user, 'File', SAVE_ITEM)
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')).toBe(true))
    assert.ok(!state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays'))
  })

  test('adding a tray to the project stays disabled while the create is in flight', async () => {
    let releaseCreate: () => void = () => {}
    state.createGate = new Promise<void>((resolveCreate) => { releaseCreate = resolveCreate })
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await awaitTrayLoaded()

    await chooseMenu(user, 'File', 'New')
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays')).toBe(true))
    for (const name of ['New', 'Open', 'Clone']) {
      assert.equal(await menuItemDisabled(user, 'File', name), true, name)
    }

    releaseCreate()
    await waitFor(async () => expect(await menuItemDisabled(user, 'File', 'New')).toBe(false))
    assert.equal(await menuItemDisabled(user, 'File', 'Clone'), false)
  })

  test('edits made during save remain explicitly unsaved', async () => {
    let releaseUpdate: () => void = () => {}
    state.updateGate = new Promise<void>((resolveUpdate) => { releaseUpdate = resolveUpdate })
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await awaitTrayLoaded()

    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await chooseMenu(user, 'File', SAVE_ITEM)
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')).toBe(true))
    await user.click(await screen.findByRole('button', { name: 'Add a 2u pocket' }))
    releaseUpdate()

    assert.ok(await screen.findByText('Saved earlier changes — newer edits are still unsaved'))
    // The title carries the asterisk for unsaved edits; Save's label is fixed.
    assert.match(screen.getByRole('heading', { level: 1 }).textContent ?? '', / *$/)
    assert.ok(screen.getByText(/^2 pockets/))
  })

  test('tabbing through rounded imperial values does not rewrite millimetres', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'in' }))
    const floor = screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement
    assert.equal(floor.value, '3/32"')
    await user.click(floor)
    await user.tab()
    await chooseMenu(user, 'File', SAVE_ITEM)
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')).toBe(true))
    const update = state.calls.find(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')
    assert.equal((update?.body as { floorThicknessMm?: number }).floorThicknessMm, 2.4)
  })

  test('the open dialog lists a saved tray and loads it into the canvas', async () => {
    const user = userEvent.setup()
    state.designs = [
      { id: '1', name: 'Saved tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
      { id: '2', name: 'Start tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    ]
    renderPage(<KeycapTrayPage />, '/keycap-tray/2')
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    // Open is disabled until the tray finishes loading; on a slow runner the
    // canvas appears first, and clicking a disabled button is refused.
    await awaitTrayLoaded()
    assert.ok(screen.getByText(/^0 pockets/))

    await chooseMenu(user, 'File', 'Open')
    const dialog = await screen.findByRole('dialog')
    assert.ok(await within(dialog).findByText('Saved tray'))
    await user.click((await within(dialog).findAllByRole('button', { name: 'Open' }))[0])

    await waitFor(() => expect(screen.getByText(/^1 pockets/)).toBeTruthy())
  })

  test('open actions stay disabled while a load is in flight', async () => {
    state.designs = [
      { id: '1', name: 'First tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
      { id: '2', name: 'Second tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    ]
    const user = userEvent.setup()
    renderPage(<KeycapTrayPage />, '/keycap-tray/1')
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await awaitTrayLoaded()

    let releaseLoad: () => void = () => {}
    state.loadGate = new Promise<void>((resolveLoad) => { releaseLoad = resolveLoad })

    await chooseMenu(user, 'File', 'Open')
    const dialog = await screen.findByRole('dialog')
    const openButtons = within(dialog).getAllByRole('button', { name: 'Open' })
    await user.click(openButtons[1])
    await waitFor(() => expect(
      state.calls.some(call => call.path === '/api/keycap-trays/2')).toBe(true))
    for (const button of within(dialog).getAllByRole('button', { name: 'Open' })) {
      assert.equal((button as HTMLButtonElement).disabled, true)
    }
    assert.equal(
      (within(dialog).getByRole('button', { name: 'Delete First tray' }) as HTMLButtonElement)
        .disabled,
      true,
    )
    releaseLoad()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('deleting a saved tray asks for confirmation first', async () => {
    const user = userEvent.setup()
    state.designs = [{
      id: '1', name: 'Doomed tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: '9', projectName: 'Womier',
    }]
    renderPage(<KeycapTrayPage />, '/keycap-tray/1')
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await awaitTrayLoaded()

    await chooseMenu(user, 'File', 'Open')
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: 'Delete Doomed tray' }))

    const confirm = await screen.findByRole('dialog', { name: 'Delete this tray?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    assert.ok(!state.calls.some(c => c.method === 'DELETE'))

    await user.click(await within(dialog).findByRole('button', { name: 'Delete Doomed tray' }))
    const again = await screen.findByRole('dialog', { name: 'Delete this tray?' })
    await user.click(within(again).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(state.calls.some(c => c.method === 'DELETE')).toBe(true))
  })

  test('a failing list surfaces the server message instead of an empty screen', async () => {
    state.failListWith = 503
    renderPage()
    assert.ok(await screen.findByText('The list could not be loaded.'))
  })

  test('the unit toggle switches the length fields between mm and inches', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const floor = screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement
    assert.equal(floor.value, '2.4')

    await user.click(screen.getByRole('button', { name: 'in' }))
    await waitFor(() => expect(
      (screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement).value).toBe('3/32"'))

    await user.click(screen.getByRole('button', { name: 'mm' }))
    await waitFor(() => expect(
      (screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement).value).toBe('2.4'))
  })

  test('an invalid length is rejected and the field falls back to the old value', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const depth = screen.getAllByRole('textbox', { name: 'Depth' })[0] as HTMLInputElement
    await user.clear(depth)
    await user.type(depth, 'not a number')
    await user.tab()
    await waitFor(() => expect(
      (screen.getAllByRole('textbox', { name: 'Depth' })[0] as HTMLInputElement).value).toBe('10'))
  })

  test('the export target switches between the printer and the CNC formats', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(await openMenuItem(user, 'File', 'Export STL'))
    assert.ok(screen.getByRole('menuitem', { name: /^Export 3MF/ }))
    assert.equal(screen.queryByRole('menuitem', { name: /^Export SVG/ }), null)
    await closeOpenMenu(user)

    await user.click(screen.getByRole('button', { name: 'Shaper Origin' }))
    assert.ok(await openMenuItem(user, 'File', 'Export SVG'))
    assert.ok(screen.getByRole('menuitem', { name: /^Export DXF/ }))
    assert.equal(screen.queryByRole('menuitem', { name: /^Export STL/ }), null)
    await closeOpenMenu(user)
  })

  test('an export writes a file through the browser download path', async () => {
    const user = userEvent.setup()
    const clicks: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag)
      if (tag === 'a') {
        vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push((element as HTMLAnchorElement).download)
        })
      }
      return element
    })

    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await chooseMenu(user, 'File', 'Export STL')

    assert.deepEqual(clicks, ['Untitled_tray.stl'])
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    // Revoking synchronously cancels the download in Safari.
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
