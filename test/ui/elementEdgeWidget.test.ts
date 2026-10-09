// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })
test('iCUE wrapper fixes the HTTPS display URL, validates handshake and never reloads on data ticks', () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<main><p id="status"></p><button id="reload"></button><iframe id="website"></iframe></main>'
  const source = readFileSync('widgets/element-edge/widget.js', 'utf8')
  const icue = {
    addEventListener: window.addEventListener.bind(window),
    icueEvents: { onDataUpdated() {} },
  }
  runInNewContext(source, { document, window: icue, setTimeout, clearTimeout })
  const frame = document.getElementById('website') as HTMLIFrameElement
  expect(frame.src).toBe('https://shapepilot.nintek.com/display/element')
  window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://untrusted.invalid', source: frame.contentWindow, data: { type: 'shapepilot:element-display:ready' },
  }))
  expect(document.body.classList.contains('ready')).toBe(false)
  window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://shapepilot.nintek.com', source: window, data: { type: 'shapepilot:element-display:ready' },
  }))
  expect(document.body.classList.contains('ready')).toBe(false)
  window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://shapepilot.nintek.com', source: frame.contentWindow, data: { type: 'shapepilot:element-display:ready' },
  }))
  expect(document.body.classList.contains('ready')).toBe(true)
  icue.icueEvents.onDataUpdated()
  expect(document.body.classList.contains('ready')).toBe(true)
  vi.advanceTimersByTime(25_000)
  expect(document.body.classList.contains('ready')).toBe(true)
})
