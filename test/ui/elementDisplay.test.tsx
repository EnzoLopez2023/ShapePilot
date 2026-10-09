// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ElementDisplayPage, { JobDisplay } from '../../src/features/element-display/ElementDisplayPage.tsx'
import type { DisplayStatus } from '../../lib/contracts/elementDisplay.ts'
import { syntheticElementSnapshot } from '../fixtures/elementStatistics.ts'

const live: DisplayStatus = {
  paired: true, expiresAt: '2027-01-01T00:00:00.000Z', printerName: 'Synthetic EDGE printer',
  connectionState: 'connected', freshness: 'fresh',
  snapshot: { ...syntheticElementSnapshot },
}
const now = Date.parse(syntheticElementSnapshot.receivedAt)
beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('job-only readings include progress, minutes, layers, actual/target temperatures and errors without controls or spools', () => {
  render(<JobDisplay status={live} error={null} now={now} />)
  expect(screen.getByText('42%')).toBeTruthy()
  expect(screen.getByText('35 min')).toBeTruthy()
  expect(screen.getByText('84')).toBeTruthy()
  expect(screen.getByText('215 \u00b0C')).toBeTruthy()
  expect(screen.getByText('/ 220 \u00b0C')).toBeTruthy()
  expect(screen.getByText('59 \u00b0C')).toBeTruthy()
  expect(screen.getByText('/ 60 \u00b0C')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('Live report')
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('42')
  expect(screen.queryByText(/AMS|spool|history/i)).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('navigation')).toBeNull()
})

test('offline, stale, missing readings and request failure never masquerade as live or zero', () => {
  const { rerender } = render(<JobDisplay status={{ ...live, connectionState: 'offline', freshness: 'stale' }} error={null} now={now} />)
  expect(screen.getByRole('status').textContent).toBe('Printer offline')
  expect(screen.getByText(/RUNNING \/ last known/)).toBeTruthy()
  rerender(<JobDisplay status={live} error={null} now={now + 180_001} />)
  expect(screen.getByRole('status').textContent).toBe('Stale report')
  rerender(<JobDisplay status={live} error="Synthetic API outage" now={now} />)
  expect(screen.getByRole('status').textContent).toBe('ShapePilot unreachable')
  expect(screen.getByText('Synthetic API outage')).toBeTruthy()
  rerender(<JobDisplay status={{ ...live, snapshot: null, freshness: 'unavailable' }} error={null} now={now} />)
  expect(screen.getAllByText(/Unavailable/i).length).toBeGreaterThan(3)
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText('0%')).toBeNull()
})

test('pairing stays in origin storage, transports its scoped key only in a header, and survives a page remount', async () => {
  const credential = 'a'.repeat(64)
  const calls: { path: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    calls.push({ path, init })
    return new Response(JSON.stringify(path.endsWith('pairings')
      ? { credential, code: 'AABBCCDDEE', expiresAt: '2099-01-01T00:00:00Z' }
      : live), { status: path.endsWith('pairings') ? 201 : 200 })
  })
  const user = userEvent.setup()
  const first = render(<ElementDisplayPage />)
  await user.click(screen.getByRole('button', { name: 'Start pairing' }))
  await screen.findByText('Synthetic EDGE printer')
  expect(calls[0].path).toBe('/api/element-display/pairings')
  const request = calls.find(call => call.path.endsWith('/status'))!
  expect(request.init.headers).toEqual({ authorization: `Display ${credential}` })
  expect(request.init.credentials).toBe('omit')
  expect(calls.every(call => !call.path.includes(credential))).toBe(true)
  first.unmount()
  render(<ElementDisplayPage />)
  await screen.findByText('Synthetic EDGE printer')
  expect(calls.filter(call => call.path.endsWith('pairings'))).toHaveLength(1)
})

test('blocked browser storage reports an actionable error without minting a display key', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
  const user = userEvent.setup()
  render(<ElementDisplayPage />)
  await user.click(screen.getByRole('button', { name: 'Start pairing' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Storage blocked')
  expect(fetcher).not.toHaveBeenCalled()
})

test('revoked access clears previously displayed telemetry and prompts re-pairing', async () => {
  localStorage.setItem('shapepilot:element-display:v1', JSON.stringify({
    credential: 'a'.repeat(64), code: 'AABBCCDDEE', expiresAt: '2099-01-01T00:00:00Z',
  }))
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    error: { code: 'unauthorized', message: 'Display access was revoked. Pair again.' },
  }), { status: 401 }))
  render(<ElementDisplayPage />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('revoked'))
  expect(screen.queryByText('Synthetic organiser')).toBeNull()
  expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy()
})
