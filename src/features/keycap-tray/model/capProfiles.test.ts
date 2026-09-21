import { describe, expect, test } from 'vitest'
import { advisePosts, capProfileOf, matchCapProfile } from './capProfiles.ts'

const cherry = capProfileOf('cherry')!
const sa = capProfileOf('sa')!

describe('corner post advice', () => {
  test('Cherry in a 4 mm pocket: 6.5 mm posts, and every row stays in', () => {
    const a = advisePosts(cherry, 2.4, 4)
    expect(a.postMm).toBe(6.5)
    expect(a.looseMm).toBeCloseTo(3.2)
    expect(a.retained).toBe(true)
    expect(a.pitchMm).toBeCloseTo(12.9)
    expect(a.traysInS76).toBe(3)
  })

  test('KSA in a 4 mm pocket lets the short rows out, and says how deep to go', () => {
    const a = advisePosts(sa, 2.4, 4)
    expect(a.postMm).toBe(13.5)
    expect(a.retained).toBe(false)
    expect(a.depthNeededMm).toBe(6)
  })

  test('KSA in a 6 mm pocket holds every row', () => {
    const a = advisePosts(sa, 2.4, 6)
    expect(a.postMm).toBe(11.5)
    expect(a.retained).toBe(true)
    expect(a.pitchMm).toBeCloseTo(19.9)
    expect(a.traysInS76).toBe(2)
  })

  test('caps that sit below the rim need no posts at all', () => {
    const a = advisePosts(cherry, 2.4, 11)
    expect(a.postMm).toBe(0)
    expect(a.retained).toBe(true)
  })
})

describe('reading a project’s cap profile', () => {
  test.each([
    ['Cherry', 'cherry'], ['GMK Cherry profile', 'cherry'], ['KSA', 'sa'],
    ['sa', 'sa'], ['OSA', 'oem'], ['MT3', 'mt3'], ['kat', 'mda'],
  ])('%s → %s', (text, id) => {
    expect(matchCapProfile(text)?.id).toBe(id)
  })

  test('an unknown or empty profile matches nothing', () => {
    expect(matchCapProfile('Custom sculpt')).toBeUndefined()
    expect(matchCapProfile(undefined)).toBeUndefined()
  })
})
