import { expect, test } from 'vitest'
import { parsePersonalization, personalizationStyle } from '../../src/features/element-display/personalization.ts'

const valid = {
  type: 'icue:personalization', textColor: '#ffffff', accentColor: '#ff9b3d',
  backgroundColor: '#102030', transparency: 25,
}

test('accepts only well-formed personalization messages', () => {
  expect(parsePersonalization(valid)).toEqual({ textColor: valid.textColor, accentColor: valid.accentColor, backgroundColor: valid.backgroundColor, transparency: valid.transparency })
  expect(parsePersonalization({ ...valid, type: 'other' })).toBeNull()
  expect(parsePersonalization({ ...valid, textColor: 'red; background: url(x)' })).toBeNull()
  expect(parsePersonalization({ ...valid, accentColor: '#fff' })).toBeNull()
  expect(parsePersonalization({ ...valid, transparency: '5' })).toBeNull()
  expect(parsePersonalization({ ...valid, transparency: Number.NaN })).toBeNull()
  expect(parsePersonalization(null)).toBeNull()
  expect(parsePersonalization('icue:personalization')).toBeNull()
})

test('clamps transparency and derives an rgba surface', () => {
  expect(parsePersonalization({ ...valid, transparency: 500 })?.transparency).toBe(100)
  expect(parsePersonalization({ ...valid, transparency: -4 })?.transparency).toBe(0)
  const style = personalizationStyle(parsePersonalization(valid)!)
  expect(style['--edge-surface']).toBe('rgba(16,32,48, 0.75)')
  expect(style['--edge-accent']).toBe('#ff9b3d')
})
