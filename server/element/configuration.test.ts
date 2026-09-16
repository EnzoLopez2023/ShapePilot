import { describe, expect, test } from 'vitest'
import { testConfig } from '../../test/helpers/server.ts'

describe('server-only Bambu configuration', () => {
  test('defaults to an inactive absent credential and fixed global region', () => {
    expect(testConfig().element).toEqual({
      accessToken: null, region: 'global', unresolvedSecret: false,
    })
  })

  test('recognizes unresolved secret references without treating them as a bearer token', () => {
    const config = testConfig({
      SHAPEPILOT_BAMBU_ACCESS_TOKEN: '@Microsoft.KeyVault(SecretUri=https://synthetic.invalid/secrets/bambu/)',
    })
    expect(config.element.accessToken).toBeNull()
    expect(config.element.unresolvedSecret).toBe(true)
  })

  test('accepts server credentials only under fixed region values', () => {
    expect(testConfig({
      SHAPEPILOT_BAMBU_ACCESS_TOKEN: 'synthetic-token', SHAPEPILOT_BAMBU_REGION: 'china',
    }).element).toEqual({ accessToken: 'synthetic-token', region: 'china', unresolvedSecret: false })
    expect(() => testConfig({ SHAPEPILOT_BAMBU_REGION: 'https://attacker.invalid' })).toThrow('global or china')
    expect(testConfig({ VITE_BAMBU_ACCESS_TOKEN: 'not-a-server-setting' }).element.accessToken).toBeNull()
  })

  test('validation never reflects credential contents', () => {
    for (const token of ['Bearer synthetic-token', 'synthetic\ntoken', 'x'.repeat(8193)]) {
      try {
        testConfig({ SHAPEPILOT_BAMBU_ACCESS_TOKEN: token })
        throw new Error('validation unexpectedly accepted the token')
      } catch (error) {
        expect(error).toMatchObject({ code: 'CONFIG_INVALID' })
        expect((error as Error).message).not.toContain(token)
      }
    }
  })
})
