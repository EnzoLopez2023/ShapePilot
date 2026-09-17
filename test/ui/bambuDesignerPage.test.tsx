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
import { unzipSync, strFromU8 } from 'fflate'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import type * as AssetsModule from '../../src/import/assets.ts'

vi.mock('../../src/components/viewport3d/Viewport3D.tsx', () => ({
  default: ({ parts }: { parts: { id: string }[] }) =>
    <div data-testid="viewport" data-parts={parts.length} />,
}))

// The asset store is IndexedDB, which jsdom has not got. Only the storing half
// is replaced; resolving still runs for real, and reports the part detached --
// exactly what a browser without a store would do.
const assets = vi.hoisted(() => ({
  storeImportedFile: vi.fn(async (bytes: ArrayBuffer, filename: string) =>
    ({ hash: 'a'.repeat(64), filename, byteLength: bytes.byteLength })),
}))
vi.mock('../../src/import/assets.ts', async original => ({
  ...(await original<typeof AssetsModule>()),
  storeImportedFile: assets.storeImportedFile,
}))

const { default: BambuDesignerPage } =
  await import('../../src/features/bambu-designer/BambuDesignerPage.tsx')

/** A binary STL holding a single triangle, floating 1.5 mm above the plate --
 *  the same way the real badge is modelled. */
function oneTriangleStl(): ArrayBuffer {
  const bytes = new Uint8Array(84 + 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  const corners = [[0, 0, 1.5], [10, 0, 1.5], [0, 10, 3]]
  corners.forEach(([x, y, z], i) => {
    const at = 84 + 12 + i * 12
    view.setFloat32(at, x, true)
    view.setFloat32(at + 4, y, true)
    view.setFloat32(at + 8, z, true)
  })
  return bytes.buffer
}

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
    if (url.endsWith('/models/el-logo-badge.stl')) {
      return new Response(oneTriangleStl(), {
        status: 200, headers: { 'content-type': 'model/stl' },
      })
    }
    // Nothing was ever uploaded from this run, so the asset resolve misses.
    if (url.includes('/api/design-assets/')) return new Response(null, { status: 404 })
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

test('a library part is fetched, stored and added like any import', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /EL logo badge/ })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: /EL logo badge/ }))

  const tree = await screen.findByRole('list', { name: 'Objects' })
  await waitFor(() => expect(within(tree).getByText('EL logo badge')).toBeTruthy())
  // The document carries a hash, not the triangles: the bytes went to the
  // asset store under the name the file has on disk.
  assert.equal(assets.storeImportedFile.mock.calls[0]?.[1], 'el-logo-badge.stl')
  assert.ok(within(tree).getByText('stl'))
  // Modelled 1.5 mm up, so it is dropped by that much and sits on the plate.
  assert.equal((screen.getByLabelText('Z') as HTMLInputElement).value, '-1.5')
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

test('the first save asks for a name instead of writing the default one', async () => {
  const user = userEvent.setup()
  const posted: unknown[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('/api/ai/status')) {
      return new Response(JSON.stringify({ available: false }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/design-documents') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: 'doc-1' }), {
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

  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /^Box/ }))

  await user.click(screen.getByRole('button', { name: /^Save$/ }))

  // Nothing is written until the name is given.
  assert.equal(posted.length, 0)
  assert.ok(screen.getByRole('heading', { name: 'Name this design' }))

  // Scoped to the dialog: the inspector has a Name field and the toolbar a
  // Save button, and both are still on screen behind it.
  const dialog = within(screen.getByRole('dialog'))
  await user.clear(dialog.getByLabelText('Name'))
  await user.type(dialog.getByLabelText('Name'), 'rounded 10mm post')
  await user.click(dialog.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(posted.length).toBe(1))
  assert.equal((posted[0] as { name: string }).name, 'rounded 10mm post')
})

test('renaming in the toolbar reaches the document, not just the field', async () => {
  const user = userEvent.setup()
  const posted: unknown[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('/api/ai/status')) {
      return new Response(JSON.stringify({ available: false }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/design-documents') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: 'doc-1' }), {
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

  renderPage()
  const field = await screen.findByLabelText('Design name')
  assert.equal((field as HTMLInputElement).value, 'Untitled model')
  // Save waits for something to save in a design that was never saved.
  await user.click(screen.getByRole('button', { name: /^Box/ }))

  await user.clear(field)
  await user.type(field, 'bench dog')
  await user.tab()

  // The field keeping its own text proves nothing -- it is its own state. What
  // matters is that the save dialog and the request agree with it.
  await user.click(screen.getByRole('button', { name: /^Save$/ }))
  const dialog = within(screen.getByRole('dialog'))
  assert.equal((dialog.getByLabelText('Name') as HTMLInputElement).value, 'bench dog')

  await user.click(dialog.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(posted.length).toBe(1))
  assert.equal((posted[0] as { name: string }).name, 'bench dog')
})

test('a blank name reverts rather than saving an unnameable design', async () => {
  const user = userEvent.setup()
  renderPage()
  const field = await screen.findByLabelText('Design name')

  await user.clear(field)
  await user.tab()

  await waitFor(() =>
    expect((screen.getByLabelText('Design name') as HTMLInputElement).value).toBe('Untitled model'))
})

test('a 3MF export gives every object its own colourable part', async () => {
  const user = userEvent.setup()
  const blobs: Blob[] = []
  const realCreateElement = document.createElement.bind(document)
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = realCreateElement(tag)
    // jsdom would try to navigate to the blob: URL.
    if (tag === 'a') vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {})
    return element
  })
  // Patch the two statics rather than stubbing URL wholesale: the router still
  // needs the constructor.
  const realCreateUrl = URL.createObjectURL
  const realRevokeUrl = URL.revokeObjectURL
  URL.createObjectURL =
    ((blob: Blob) => { blobs.push(blob); return 'blob:stub' }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

  try {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^Box/ }))
    await user.click(screen.getByRole('button', { name: /^Cylinder/ }))

    await user.click(screen.getByRole('button', { name: '3MF' }))
    await waitFor(() => expect(blobs.length).toBe(1), { timeout: 20_000 })

    const zip = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()))
    const model = strFromU8(zip['3D/3dmodel.model'])
    // The box and the cylinder each keep their own mesh. Before this, the whole
    // scene went through evaluateProgram and arrived as one welded lump that no
    // slicer could take apart again.
    assert.equal((model.match(/<mesh>/g) ?? []).length, 2)
    assert.equal((model.match(/<component /g) ?? []).length, 2)

    const cfg = strFromU8(zip['Metadata/model_settings.config'])
    assert.equal((cfg.match(/<part /g) ?? []).length, 2)
    assert.match(cfg, /key="extruder" value="1"/)
    assert.match(cfg, /key="extruder" value="2"/)
  } finally {
    URL.createObjectURL = realCreateUrl
    URL.revokeObjectURL = realRevokeUrl
    createSpy.mockRestore()
  }
})

// DOM elements are compared with expect(), never node:assert: a failing assert
// on a jsdom element inspects the whole window and exhausts memory.
const positionX = () => Number((screen.getByLabelText('X') as HTMLInputElement).value)

test('arrow keys nudge the selection by the snap step, Shift by ten', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /^Box/ }))
  await waitFor(() => expect(positionX()).toBe(0))

  await user.keyboard('{ArrowRight}')
  const step = positionX()
  expect(step).toBeGreaterThan(0)

  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(positionX()).toBeCloseTo(step * 11)

  await user.keyboard('{ArrowLeft}')
  expect(positionX()).toBeCloseTo(step * 10)
})

test('a burst of nudges is one undo step', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /^Box/ }))
  await waitFor(() => expect(positionX()).toBe(0))

  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
  expect(positionX()).toBeGreaterThan(0)

  await user.click(screen.getByRole('button', { name: 'Undo' }))
  // Back to where the burst started, with the box still there.
  expect(positionX()).toBe(0)
  expect(screen.getAllByText(/1 object/).length).toBeGreaterThan(0)
})

test('a nudge leaves a focused text field alone', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /^Box/ }))
  await waitFor(() => expect(positionX()).toBe(0))

  await user.click(screen.getByLabelText('Name'))
  await user.keyboard('{ArrowRight}')
  expect(positionX()).toBe(0)
})

test('mirror offers every axis', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /^Box/ }))

  await user.click(screen.getByRole('button', { name: 'Mirror' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent))
    .toEqual(['Mirror across X', 'Mirror across Y', 'Mirror across Z'])
})

test('? opens the keyboard shortcuts', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())

  await user.keyboard('?')
  const list = await screen.findByLabelText('Keyboard shortcuts', { selector: 'dl' })
  expect(within(list).getByText('Drop to the build plate')).toBeTruthy()
})

test('save waits for something to save in a design that was never saved', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
})

test('a part set to an AMS tray exports on that filament; the rest fill in around it', async () => {
  const user = userEvent.setup()
  const blobs: Blob[] = []
  const realCreateElement = document.createElement.bind(document)
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = realCreateElement(tag)
    if (tag === 'a') vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {})
    return element
  })
  const realCreateUrl = URL.createObjectURL
  const realRevokeUrl = URL.revokeObjectURL
  URL.createObjectURL =
    ((blob: Blob) => { blobs.push(blob); return 'blob:stub' }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

  try {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Box/ })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^Box/ }))
    await user.click(screen.getByRole('button', { name: /^Cylinder/ }))

    // The cylinder is selected. No AMS report in this run, so trays are by number.
    await user.click(await screen.findByLabelText('Filament'))
    await user.click(await screen.findByRole('option', { name: 'A3' }))

    await user.click(screen.getByRole('button', { name: '3MF' }))
    await waitFor(() => expect(blobs.length).toBe(1), { timeout: 20_000 })

    const zip = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()))
    const cfg = strFromU8(zip['Metadata/model_settings.config'])
    const extruders = [...cfg.matchAll(/<part [^>]*>[\s\S]*?key="extruder" value="(\d+)"/g)].map(m => m[1])
    expect(extruders).toEqual(['1', '3'])
  } finally {
    URL.createObjectURL = realCreateUrl
    URL.revokeObjectURL = realRevokeUrl
    createSpy.mockRestore()
  }
})
