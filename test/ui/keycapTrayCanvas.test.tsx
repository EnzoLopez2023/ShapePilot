// @vitest-environment jsdom
//
// The palette and the canvas: pockets, snap, overlays and rotation.
//
// The half of the designer that is direct manipulation rather than documents.
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
import { installHarness, renderWorkbench, state } from './keycapTrayHarness.tsx'
//
// TIMEOUT. Longer than the 30 s default. The cost here is real work, not
// waste: mounting the designer is ~570 ms and any interaction reaching the
// canvas is ~300 ms, of which the canvas itself is under 40 ms -- the rest is
// the event sequence and MUI re-rendering the page. Measured, not assumed.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

installHarness()
describe('designer canvas', () => {
  test('the pocket palette filters, pins and unpins', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(screen.getByRole('button', { name: 'Add a 6.25u pocket' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter pockets' }), 'Spacebar')
    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Add a 1.5u pocket' })).toBe(null))
    assert.ok(screen.getByRole('button', { name: 'Add a 6.25u pocket' }))

    await user.clear(screen.getByRole('textbox', { name: 'Filter pockets' }))
    await user.click(await screen.findByRole('button', { name: 'Unpin 1u' }))
    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Add a 1u pocket' })).toBe(null))
  })

  test('the custom tab lists the seeded library pocket and can delete it', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Custom' }))
    assert.ok(await screen.findByRole('button', { name: 'Add a 14mm square pocket' }))

    await user.click(screen.getByRole('button', { name: 'Delete 14mm square' }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'DELETE'
        && c.path.startsWith('/api/keycap-trays/library/pockets/'))).toBe(true))
  })

  test('the 14 mm seed is created once, only when the library is empty', async () => {
    state.library = []
    renderWorkbench()
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST'
        && c.path === '/api/keycap-trays/library/pockets')).toBe(true))
    const seeds = state.calls.filter(
      c => c.method === 'POST' && c.path === '/api/keycap-trays/library/pockets')
    assert.equal(seeds.length, 1, 'the seed is idempotent')
    assert.equal((seeds[0].body as { name: string }).name, '14mm square')
  })

  test('a custom pocket can be defined by exact dimensions', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Custom' }))
    await user.click(screen.getByRole('button', { name: 'Add custom pocket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a custom pocket' })

    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    assert.equal(add.disabled, true, 'a nameless pocket cannot be added')

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Artisan')
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Width (mm)' }), '17')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(state.calls.some(
      c => c.method === 'POST' && c.path === '/api/keycap-trays/library/pockets'
        && (c.body as { name: string }).name === 'Artisan')).toBe(true))
  })

  test('the snap and grid controls are labelled', async () => {
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByRole('combobox', { name: 'Snap' }))
    assert.ok(screen.getByRole('combobox', { name: 'Grid' }))
  })

  test('snap offers 0.5 mm steps through 5 mm plus the key pitch', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('combobox', { name: 'Snap' }))
    const labels = screen.getAllByRole('option').map(o => o.textContent)
    assert.deepEqual(labels, [
      'Off', '0.5 mm', '1 mm', '1.5 mm', '2 mm', '2.5 mm',
      '3 mm', '3.5 mm', '4 mm', '4.5 mm', '5 mm', '1u pitch',
    ])
  })

  test('the buffer distance dropdown is gated on Show buffer', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const buffer = screen.getByRole('combobox', { name: 'Buffer' })
    assert.equal(buffer.getAttribute('aria-disabled'), 'true')

    await user.click(screen.getByRole('button', { name: 'Show buffer' }))
    await waitFor(() => expect(
      screen.getByRole('combobox', { name: 'Buffer' }).getAttribute('aria-disabled'),
    ).not.toBe('true'))

    await user.click(screen.getByRole('combobox', { name: 'Buffer' }))
    assert.ok(screen.getByRole('option', { name: '6 mm' }))
  })

  test('the plate, buffer and label toggles report their pressed state', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const plate = screen.getByRole('button', { name: 'Show plate' })
    assert.equal(plate.getAttribute('aria-pressed'), 'false')
    await user.click(plate)
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Hide plate' }).getAttribute('aria-pressed')).toBe('true'))

    await user.click(screen.getByRole('button', { name: 'Show buffer' }))
    assert.ok(screen.getByRole('button', { name: 'Hide buffer' }))
    await user.click(screen.getByRole('button', { name: 'Hide labels' }))
    assert.ok(screen.getByRole('button', { name: 'Show labels' }))
  })

  test('the plate control is hidden for the Shaper Origin (CNC) target', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(screen.getByRole('button', { name: 'Show plate' }))

    await user.click(screen.getByRole('button', { name: 'Shaper Origin' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show plate' })).toBeNull())
    assert.equal(screen.queryByRole('button', { name: 'Hide plate' }), null)

    await user.click(screen.getByRole('button', { name: 'Bambu X2D' }))
    assert.ok(await screen.findByRole('button', { name: 'Show plate' }))
  })

  test('the selected pocket shows four rotate handles on the canvas', async () => {
    const user = userEvent.setup()
    const { container } = renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 0)

    // addPocket drops the pocket and selects it.
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await waitFor(() =>
      assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 4))

    // A second pocket takes the selection; still exactly one pocket's worth.
    await user.click(screen.getByRole('button', { name: 'Add a 2u pocket' }))
    await waitFor(() =>
      assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 4))
  })

  test('the Angle field rotates the selected pocket and normalises the value', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))

    const angle = screen.getByRole('textbox', { name: 'Angle in degrees' })
    await user.clear(angle)
    await user.type(angle, '400')
    await user.tab()
    await waitFor(() => assert.equal((angle as HTMLInputElement).value, '40'))

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => {
      const put = state.calls.find(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')
      const pocket = (put?.body as { pockets: { rotationDeg: number }[] }).pockets[0]
      assert.equal(pocket.rotationDeg, 40)
    })
  })

  test('Mirror and Flip toggle the ISO Enter shape, not its position', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a ISO Enter pocket' }))

    await user.click(await screen.findByRole('switch', { name: 'Mirror' }))
    await user.click(screen.getByRole('switch', { name: 'Flip' }))

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => {
      const put = state.calls.find(c => c.method === 'PUT' && c.path === '/api/keycap-trays/1')
      const pocket = (put?.body as {
        pockets: { mirrorX?: boolean; flipY?: boolean; x: number; y: number }[]
      }).pockets[0]
      assert.equal(pocket.mirrorX, true)
      assert.equal(pocket.flipY, true)
      assert.equal(pocket.x, 10) // position untouched -- addPocket dropped it at (10, 10)
      assert.equal(pocket.y, 10)
    })
  })

  test('Mirror and Flip are disabled for a rectangular pocket', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))

    assert.equal((screen.getByRole('button', { name: 'Mirror' }) as HTMLButtonElement).disabled, true)
    assert.equal((screen.getByRole('button', { name: 'Flip' }) as HTMLButtonElement).disabled, true)
    assert.equal(screen.queryByRole('switch', { name: 'Mirror' }), null)
  })
})
