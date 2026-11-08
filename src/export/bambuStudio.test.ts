import { expect, it } from 'vitest'
import { studioLink } from './bambuStudio.ts'

it('uses the link form each platform’s Bambu Studio registers', () => {
  const url = 'https://shapepilot.nintek.com/api/print-links/files/abc/My_bin.3mf'
  expect(studioLink(url, 'MacIntel')).toBe(`bambustudioopen://${encodeURIComponent(url)}`)
  expect(studioLink(url, 'Win32')).toBe(`bambustudio://open?file=${encodeURIComponent(url)}`)
})
