// @vitest-environment jsdom
//
// The home page answers two questions in the order a maker asks them: what was
// I doing, and what am I doing now. Both are pinned here, along with the states
// that only appear when something is wrong or nothing exists yet.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HomePage from '../../src/features/home/HomePage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'

interface StubState {
  projects: unknown[]
  trays: unknown[]
  documents: unknown[]
  failWith?: number
}

let state: StubState

const tray = (over: Record<string, unknown> = {}) => ({
  id: '4', projectId: '9', projectName: 'Womier', name: 'Middle tray',
  profileKind: 'preset', pocketCount: 29,
  createdAt: '2026-08-30 09:00:00', updatedAt: '2026-08-31 10:00:00', ...over,
})

const design = (id: string) => ({
  id, name: 'Middle tray',
  profile: { kind: 'rect', widthMm: 200, heightMm: 120, cornerRadiusMm: 4 },
  sizing: { pitch: 19.05, widthOffset: -0.25, height: 18.8, cornerRadius: 1, cornerSegments: 16 },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets: [{ id: 'a', units: 1, heightUnits: 1, x: 10, y: 10, rotationDeg: 0,
    isThrough: false, labelMode: 'guide' }],
  createdAt: '2026-08-30 09:00:00', updatedAt: '2026-08-31 10:00:00', revision: 0,
})

beforeEach(() => {
  state = {
    projects: [{
      id: '9', name: 'Womier', capCount: 70, trayCount: 2, photoCount: 2,
      createdAt: '2026-08-30 09:00:00', updatedAt: '2026-08-30 09:00:00',
    }],
    trays: [tray(), tray({ id: '5', name: 'Top tray', pocketCount: 18,
      updatedAt: '2026-08-29 10:00:00' })],
    documents: [{ id: '1', kind: 'bambu', name: 'Bracket', objectCount: 4,
      createdAt: '2026-08-20 09:00:00', updatedAt: '2026-08-20 09:00:00' }],
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json' },
      })
    if (state.failWith) {
      return json(state.failWith, {
        error: { code: 'unavailable', message: 'The workshop could not be read.' },
      })
    }
    if (path === '/api/keycap-projects') return json(200, state.projects)
    if (/^\/api\/keycap-trays\/\d+$/.test(path)) return json(200, design(path.split('/').pop()!))
    if (path.startsWith('/api/keycap-trays')) return json(200, state.trays)
    if (path.startsWith('/api/design-documents')) return json(200, state.documents)
    return json(202, { ok: true })
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const renderHome = () => render(
  <ThemeModeProvider initialPreference="light">
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>
  </ThemeModeProvider>,
)

test('the hero is the thing you last touched, with one way back into it', async () => {
  renderHome()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Middle tray' })).toBeTruthy())

  const hero = screen.getByRole('region', { name: 'Where you left off' })
  // The project it belongs to is context worth having; the tray alone is not.
  assert.match(within(hero).getByText(/Last touched/).textContent ?? '', /Womier/)
  assert.ok(within(hero).getByText('29 pockets'))
  assert.equal(
    within(hero).getByRole('link', { name: /Resume/ }).getAttribute('href'), '/keycap-tray/4')
  // And it is drawn, not described.
  assert.ok(within(hero).getByRole('img', { name: /Middle tray, drawn/ }))
})

test('the counts are what the workshop actually holds', async () => {
  renderHome()
  const band = await screen.findByRole('region', { name: 'What the workshop holds' })
  // 29 + 18 pockets across two trays; 4 objects in the one document.
  assert.ok(within(band).getByText('47'))
  assert.ok(within(band).getByText('70'))
  assert.ok(within(band).getByText('4'))
})

test('all four ways in are present and addressable', async () => {
  renderHome()
  const paths = await screen.findByRole('region', { name: 'Start something' })
  for (const [name, href] of [
    ['Keycap tray', '/keycap-tray'],
    ['Shaper designer', '/shaper-designer'],
    ['Bambu designer', '/bambu-designer'],
    ['AI playground', '/playground'],
  ] as const) {
    const card = within(paths).getByRole('link', { name: new RegExp(name) })
    assert.equal(card.getAttribute('href'), href)
  }
})

test('a document is the hero when it is the most recent thing', async () => {
  state.documents = [{ id: '1', kind: 'shaper', name: 'Cut sheet', objectCount: 7,
    createdAt: '2026-08-31 09:00:00', updatedAt: '2026-09-01 09:00:00' }]
  renderHome()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Cut sheet' })).toBeTruthy())
  assert.equal(
    screen.getByRole('link', { name: /Resume/ }).getAttribute('href'), '/shaper-designer')
  assert.ok(screen.getByText('7 objects'))
})

test('an empty workshop invites rather than showing zeroes as achievement', async () => {
  state = { projects: [], trays: [], documents: [] }
  renderHome()
  await waitFor(() => expect(
    screen.getByRole('heading', { name: 'Nothing on the bench yet' })).toBeTruthy())
  // No hero to resume, and no counts worth reading.
  assert.equal(screen.queryByRole('region', { name: 'Where you left off' }), null)
  assert.equal(screen.queryByRole('region', { name: 'What the workshop holds' }), null)
  // The four ways in are the whole point of the page in this state.
  assert.ok(screen.getByRole('region', { name: 'Start something' }))
})

test('a workshop that cannot be read offers a retry, not a blank page', async () => {
  state.failWith = 503
  renderHome()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy())
})
