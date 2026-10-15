// @vitest-environment jsdom
//
// A Library card opens its model, and changes the status and the favorite in
// place. Pinned here: the controls are real buttons outside the card's link (a
// link cannot hold buttons), and each one asks the page for exactly one change.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { LibraryModel } from '../../lib/contracts/library.ts'
import { ModelCard } from '../../src/features/library/components/ModelCard.tsx'

afterEach(cleanup)

const model: LibraryModel = {
  id: '0b5f6c2e-1111-4222-8333-944455556666',
  title: 'S76 rack bottom_R',
  category: 'ShapePilot',
  folder: 'ShapePilot/S76 rack bottom_R',
  status: 'want',
  tags: [],
  notes: '',
  favorite: false,
  designer: null,
  license: null,
  description: null,
  sourceSite: null,
  sourceUrl: null,
  sourceModelId: null,
  bambuHubUrl: null,
  thumbHash: null,
  gallery: [],
  formats: ['stl'],
  fileCount: 1,
  totalBytes: 1,
  plateCount: 0,
  printer: null,
  filaments: [],
  estSeconds: null,
  estGrams: null,
  isSliced: false,
  bbox: [143, 48, 10],
  state: 'present',
  firstSeenAt: '2026-09-01T00:00:00.000Z',
  lastSeenAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  printedCount: 0,
  failedCount: 0,
  lastPrintedAt: null,
}

const renderCard = (overrides: Partial<LibraryModel> = {}) => {
  const onChange = vi.fn()
  render(<MemoryRouter><ModelCard model={{ ...model, ...overrides }} onChange={onChange} /></MemoryRouter>)
  return onChange
}

test('the title links to the model and the controls are not inside the link', () => {
  renderCard()
  const link = screen.getByRole('link', { name: 'S76 rack bottom_R' })
  expect(link.getAttribute('href')).toBe(`/library/${model.id}`)
  expect(link.querySelector('button')).toBeNull()
  expect(link.contains(screen.getByRole('button', { name: /Change status/ }))).toBe(false)
})

test('the status chip opens the statuses and picking one asks for that change', async () => {
  const user = userEvent.setup()
  const onChange = renderCard()
  await user.click(screen.getByRole('button', { name: 'Status: Want to print. Change status' }))
  await user.click(screen.getByRole('menuitem', { name: 'Printed' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: 'printed' })
})

test('picking the current status changes nothing', async () => {
  const user = userEvent.setup()
  const onChange = renderCard()
  await user.click(screen.getByRole('button', { name: /Change status/ }))
  await user.click(screen.getByRole('menuitem', { name: 'Want to print' }))
  expect(onChange).not.toHaveBeenCalled()
})

test('the heart toggles the favorite both ways', async () => {
  const user = userEvent.setup()
  const onChange = renderCard()
  const heart = screen.getByRole('button', { name: 'Mark S76 rack bottom_R favorite' })
  expect(heart.getAttribute('aria-pressed')).toBe('false')
  await user.click(heart)
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ favorite: true })

  cleanup()
  const again = renderCard({ favorite: true })
  const filled = screen.getByRole('button', { name: 'Remove S76 rack bottom_R from favorites' })
  expect(filled.getAttribute('aria-pressed')).toBe('true')
  await user.click(filled)
  expect(again).toHaveBeenCalledExactlyOnceWith({ favorite: false })
})
