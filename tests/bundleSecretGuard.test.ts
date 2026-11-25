import { describe, expect, it, vi } from 'vitest'
import { bundleSecretGuard, findSecretMarkers } from '../scripts/bundle-secret-guard.mjs'

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = toBase64Url(JSON.stringify(payload))
  const signature = 'fake_signature_for_test_only'
  return `${header}.${body}.${signature}`
}

describe('bundle-secret-guard', () => {
  it('detects each forbidden literal marker with exact counts', () => {
    const sample = [
      'const a = "SUPABASE_SERVICE_ROLE_KEY";',
      'const b = "SUPABASE_SERVICE_ROLE_KEY";',
      'const c = "SUPABASE_SECRET_KEY";',
      'const d = "SUPABASE_JWT_SECRET";',
      'const e = "SUPABASE_JWT_SECRET";',
      'const f = "service_role";',
      'const g = "service_role";',
      'const h = "service_role";',
    ].join('\n')

    expect(findSecretMarkers(sample)).toEqual([
      { name: 'SUPABASE_SERVICE_ROLE_KEY', count: 2 },
      { name: 'SUPABASE_SECRET_KEY', count: 1 },
      { name: 'SUPABASE_JWT_SECRET', count: 2 },
      { name: 'service_role', count: 3 },
    ])
  })

  it('flags sb_secret_ keys with 20+ chars but allows bare sb_secret_ prefix', () => {
    const bareLiteral = 'const prefix = "sb_secret_";'
    expect(findSecretMarkers(bareLiteral)).toEqual([])

    const fakeKey = 'sb_secret_fake_test_key_1234567890'
    const withFakeKey = `const k = "${fakeKey}";`
    expect(findSecretMarkers(withFakeKey)).toEqual([{ name: 'sb_secret_key', count: 1 }])
  })

  it('flags fake service_role JWTs but allows anon JWTs and malformed JWT-like strings', () => {
    const anonJwt = makeFakeJwt({ role: 'anon', iss: 'fake-test' })
    const serviceRoleJwt = makeFakeJwt({ role: 'service_role', iss: 'fake-test' })
    const malformedJwt = 'eyJnot_valid_json_12345.eyJbm90LWpzb24tYXQtYWxs.fake_signature_for_test_only'

    expect(findSecretMarkers(`const token = "${anonJwt}";`)).toEqual([])
    expect(findSecretMarkers(`const bad = "${malformedJwt}";`)).toEqual([])
    expect(findSecretMarkers(`const admin = "${serviceRoleJwt}";`)).toEqual([
      { name: 'service_role_jwt', count: 1 },
    ])
  })

  it('plugin generateBundle calls this.error with marker names and counts without leaking secret text', () => {
    const fakeSbSecret = 'sb_secret_fake_test_key_1234567890'
    const fakeServiceJwt = makeFakeJwt({ role: 'service_role', iss: 'fake-test' })
    const plugin = bundleSecretGuard()
    const errorSpy = vi.fn()

    const bundle = {
      'assets/index.js': {
        type: 'chunk',
        code: `const x = "SUPABASE_SERVICE_ROLE_KEY"; const y = "${fakeSbSecret}";`,
      },
      'assets/data.txt': {
        type: 'asset',
        source: new TextEncoder().encode(`token=${fakeServiceJwt}`),
      },
    }

    plugin.generateBundle.call({ error: errorSpy }, {}, bundle)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const msg = String(errorSpy.mock.calls[0]?.[0] ?? '')

    expect(msg).toContain('assets/index.js')
    expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY=1')
    expect(msg).toContain('sb_secret_key=1')
    expect(msg).not.toContain(fakeSbSecret)

    expect(msg).toContain('assets/data.txt')
    expect(msg).toContain('service_role_jwt=1')
    expect(msg).not.toContain(fakeServiceJwt)
  })

  it('plugin generateBundle does not error on a clean bundle', () => {
    const anonJwt = makeFakeJwt({ role: 'anon', iss: 'fake-test' })
    const plugin = bundleSecretGuard()
    const errorSpy = vi.fn()

    const bundle = {
      'assets/index.js': {
        type: 'chunk',
        code: `const prefix = "sb_secret_"; const anon = "${anonJwt}";`,
      },
      'assets/readme.txt': {
        type: 'asset',
        source: 'clean asset content',
      },
      'assets/bytes.txt': {
        type: 'asset',
        source: new TextEncoder().encode('clean binary asset content'),
      },
    }

    plugin.generateBundle.call({ error: errorSpy }, {}, bundle)

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
