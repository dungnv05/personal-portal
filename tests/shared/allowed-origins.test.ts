import { describe, expect, it } from 'vitest'
import {
  DEV_ORIGINS,
  PROD_HOSTS,
  PROD_ORIGINS,
  isAllowedHost,
  isAllowedOrigin,
} from '../../shared/allowed-origins.js'
import { resolveNextUrl } from '../../src/utils/nextUrl'
import { resolveNextTarget } from '../../src/utils/nextParam'
import { isAllowedAuthOrigin } from '../../src/yun-header/yun-header'

const REJECTED_SUBDOMAINS = [
  'evil.yundev.space',
  'vault.yundev.space',
  'a.b.yundev.space',
]

describe('SH-3 shared allowed-host list', () => {
  it('accepts the exact 6 production hosts and rejects evil/vault/nested subdomains', () => {
    expect(PROD_HOSTS).toEqual([
      'yundev.space',
      'www.yundev.space',
      'tinh-luong.yundev.space',
      'brse.yundev.space',
      'vang-vong-su-viet.yundev.space',
      'ivf-journey.yundev.space',
    ])

    for (const host of PROD_HOSTS) {
      expect(isAllowedHost(host)).toBe(true)
      expect(isAllowedHost(host.toUpperCase())).toBe(true)
      expect(isAllowedOrigin(`https://${host}`, { allowDev: false })).toBe(true)
      expect(isAllowedAuthOrigin(`https://${host}`, { allowLocalhost: false })).toBe(true)
      expect(resolveNextUrl(`?next=${encodeURIComponent(`https://${host}/app`)}`)).toBe(
        `https://${host}/app`,
      )
      expect(resolveNextTarget(`?next=${encodeURIComponent(`https://${host}/app`)}`)).toBe(
        `https://${host}/app`,
      )
    }

    for (const badHost of REJECTED_SUBDOMAINS) {
      expect(isAllowedHost(badHost)).toBe(false)
      expect(isAllowedOrigin(`https://${badHost}`, { allowDev: true })).toBe(false)
      expect(isAllowedAuthOrigin(`https://${badHost}`, { allowLocalhost: true })).toBe(false)
      expect(resolveNextUrl(`?next=${encodeURIComponent(`https://${badHost}/app`)}`)).toBeNull()
      expect(resolveNextTarget(`?next=${encodeURIComponent(`https://${badHost}/app`)}`)).toBe('/')
    }
  })

  it('gates dev origins behind allowDev', () => {
    expect(PROD_ORIGINS).toHaveLength(6)
    for (const devOrigin of DEV_ORIGINS) {
      expect(isAllowedOrigin(devOrigin, { allowDev: false })).toBe(false)
      expect(isAllowedOrigin(devOrigin, { allowDev: true })).toBe(true)
    }
  })
})
