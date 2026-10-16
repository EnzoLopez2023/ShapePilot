// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })
test('source and shipped archive explicitly enable iCUE dashboard click forwarding', () => {
  const source = JSON.parse(readFileSync('widgets/element-edge/manifest.json', 'utf8'))
  const archive = unzipSync(readFileSync('widgets/shapepilot-el-ement-edge.icuewidget'))
  const packaged = JSON.parse(strFromU8(archive['manifest.json']))
  expect(source.interactive).toBe(true)
  expect(source.supported_devices).toEqual([{ type: 'dashboard_lcd' }])
  expect(source.version).toBe('1.0.1')
  expect(packaged).toEqual(source)
  expect(strFromU8(archive['index.html'])).toBe(readFileSync('widgets/element-edge/index.html', 'utf8'))
  expect(strFromU8(archive['widget.js'])).toBe(readFileSync('widgets/element-edge/widget.js', 'utf8'))
  expect(strFromU8(archive['style.css'])).toBe(readFileSync('widgets/element-edge/style.css', 'utf8'))
})

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
