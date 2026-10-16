// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LibraryPage from '../../src/features/library/LibraryPage.tsx'
import {
  DEFAULT_FILTERS, filtersForCollection, filtersMatchSmart, filtersQuery, readFilters, writeFilters,
} from '../../src/features/library/model/filters.ts'
import type { LibraryCollection } from '../../lib/contracts/library.ts'
import * as api from '../../src/features/library/service.ts'

vi.mock('../../src/features/library/service.ts', () => ({
  getOverview: vi.fn(async () => ({
    byStatus: { want: 2 }, byCategory: [], lastSync: null,
  })),
  listModels: vi.fn(async () => ({ items: [], total: 0 })),
  listCollections: vi.fn(async () => []),
  createCollection: vi.fn(async () => ({ id: 1 })),
  updateModel: vi.fn(),
}))

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})
afterEach(cleanup)

test('favorites combine with status and survive returning to the Library', async () => {
  const user = userEvent.setup()
  const page = render(<MemoryRouter><LibraryPage /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'Favorites' }))
  await waitFor(() => expect(api.listModels).toHaveBeenLastCalledWith(expect.objectContaining({ favorite: true })))
  expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Want to print · 2' }))
  await waitFor(() => expect(api.listModels).toHaveBeenLastCalledWith(expect.objectContaining({ favorite: true, status: 'want' })))
  expect(readFilters()).toMatchObject({ favorite: true, status: 'want' })
  page.unmount()
  render(<MemoryRouter><LibraryPage /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Favorites' }))
  await waitFor(() => expect(api.listModels).toHaveBeenLastCalledWith(expect.not.objectContaining({ favorite: true })))
})

test('a favorites-only view can be saved as a smart collection', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><LibraryPage /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'Favorites' }))
  await user.click(screen.getByRole('button', { name: 'Save this view' }))
  await user.type(screen.getByRole('textbox', { name: 'Smart collection name' }), 'My favorites')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.createCollection).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'My favorites', query: expect.objectContaining({ favorite: true }) }),
  ))
})

test('favorites persist, reach model navigation queries, and match smart collections', () => {
  expect(readFilters().favorite).toBe(false)
  sessionStorage.setItem('shapepilot.library.filters', '{"favorite":"false"}')
  expect(readFilters().favorite).toBe(false)
  const filters = { ...DEFAULT_FILTERS, search: ' screw ', favorite: true, category: 'Hardware' }
  writeFilters(filters)
  expect(readFilters()).toEqual(filters)
  expect(filtersQuery(filters)).toMatchObject({ q: 'screw', favorite: true, category: 'Hardware' })
  const collection: LibraryCollection = {
    id: 1, name: 'Favorites', kind: 'smart', query: filtersQuery(filters), count: 2,
    createdAt: '', updatedAt: '',
  }
  expect(filtersForCollection(collection)).toEqual({ ...filters, search: 'screw' })
  expect(filtersMatchSmart(filters, collection)).toBe(true)
  expect(filtersMatchSmart({ ...filters, favorite: false }, collection)).toBe(false)
  expect(filtersForCollection({ ...collection, kind: 'manual' }).favorite).toBe(false)
})
