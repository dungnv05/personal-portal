import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sessionHandler from '../../api/auth/session.js'
import meHandler from '../../api/auth/me.js'
import logoutHandler from '../../api/auth/logout.js'

type MockRequest = {
  method: string
  headers: Record<string, string | undefined>
  body?: unknown
}

type MockResponse = {
  statusCode: number
  body: unknown
  ended: boolean
  setHeader: (name: string, value: string | string[]) => void
  getHeader: (name: string) => string | string[] | undefined
  status: (code: number) => MockResponse
  json: (payload: unknown) => MockResponse
  end: () => MockResponse
}

const TEST_SUPABASE_URL = 'https://example.supabase.co'
const TEST_SUPABASE_ANON_KEY = 'test-anon-key'

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    headers: {},
    ...overrides,
  }
}

function createMockRes(): MockResponse {
  const headers = new Map<string, string | string[]>()

  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(name: string, value: string | string[]): void {
      headers.set(name.toLowerCase(), value)
    },
    getHeader(name: string): string | string[] | undefined {
      return headers.get(name.toLowerCase())
    },
    status(code: number): MockResponse {
      res.statusCode = code
      return res
    },
    json(payload: unknown): MockResponse {
      res.body = payload
      res.ended = true
      return res
    },
    end(): MockResponse {
      res.ended = true
      return res
    },
  }

  return res
}

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${header}.${body}.test-signature`
}

describe('serverless auth endpoints (/api/auth/*)', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY

  beforeEach(() => {
    process.env.SUPABASE_URL = TEST_SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()

    if (originalSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL
    } else {
      process.env.SUPABASE_URL = originalSupabaseUrl
    }

    if (originalSupabaseAnonKey === undefined) {
      delete process.env.SUPABASE_ANON_KEY
    } else {
      process.env.SUPABASE_ANON_KEY = originalSupabaseAnonKey
    }
  })

  describe('POST /api/auth/session', () => {
    it('validates the JWT against Supabase and sets exact cookies using exp - now', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 24, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)

      const nowSeconds = Math.floor(fixedNowMs / 1000)
      const accessToken = createFakeJwt({ sub: 'user-123', exp: nowSeconds + 1800 })
      const refreshToken = 'refresh-token-abc123'

      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'user-123', email: 'yun@yundev.space' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://brse.yundev.space',
          'content-type': 'application/json',
        },
        body: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      })
      const res = createMockRes()

      await sessionHandler(req, res)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${TEST_SUPABASE_URL}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: TEST_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-123',
          email: 'yun@yundev.space',
        },
      })

      expect(res.getHeader('access-control-allow-origin')).toBe('https://brse.yundev.space')
      expect(res.getHeader('access-control-allow-credentials')).toBe('true')
      expect(res.getHeader('access-control-allow-headers')).toBe('content-type, x-csrf-token')

      const setCookie = res.getHeader('set-cookie')
      expect(Array.isArray(setCookie)).toBe(true)
      const cookies = setCookie as string[]
      expect(cookies).toHaveLength(3)

      expect(cookies[0]).toBe(
        `sb_access=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=1800`,
      )
      expect(cookies[1]).toBe(
        `sb_refresh=${refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=2592000`,
      )
      expect(cookies[2]).toMatch(
        /^csrf=[0-9a-f]{64}; Secure; SameSite=Lax; Path=\/; Domain=\.yundev\.space; Max-Age=2592000$/,
      )
      expect(cookies[2]).not.toContain('HttpOnly')
    })

    it('falls back to Max-Age=3600 when access_token has no exp claim', async () => {
      const accessToken = 'opaque-valid-access-token'
      const refreshToken = 'opaque-refresh-token'

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ id: 'user-456', email: 'fallback@yundev.space' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: { origin: 'https://yundev.space' },
        body: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      })
      const res = createMockRes()

      await sessionHandler(req, res)

      expect(res.statusCode).toBe(200)
      const cookies = res.getHeader('set-cookie') as string[]
      expect(cookies).toHaveLength(3)
      expect(cookies[0]).toBe(
        `sb_access=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=3600`,
      )
    })

    it('returns 401 and sets zero cookies when Supabase rejects the token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ message: 'Invalid JWT' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: { origin: 'https://yundev.space' },
        body: {
          access_token: 'bad-access-token',
          refresh_token: 'some-refresh-token',
        },
      })
      const res = createMockRes()

      await sessionHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'invalid_token' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 401 and sets zero cookies when tokens contain unsafe cookie characters or are missing', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: { origin: 'https://yundev.space' },
        body: {
          access_token: 'bad; HttpOnly',
          refresh_token: 'valid-refresh',
        },
      })
      const res = createMockRes()

      await sessionHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'invalid_token' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/auth/me', () => {
    it('returns 200 with user when sb_access cookie is valid and does not modify cookies', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'user-789', email: 'me@yundev.space' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'GET',
        headers: {
          origin: 'https://tinh-luong.yundev.space',
          cookie: 'other=1; sb_access=valid-cookie-token; csrf=abc',
        },
      })
      const res = createMockRes()

      await meHandler(req, res)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${TEST_SUPABASE_URL}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: TEST_SUPABASE_ANON_KEY,
          Authorization: 'Bearer valid-cookie-token',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-789',
          email: 'me@yundev.space',
        },
      })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 401 without calling Supabase when sb_access cookie is absent', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'GET',
        headers: {
          origin: 'https://yundev.space',
          cookie: 'csrf=only-csrf',
        },
      })
      const res = createMockRes()

      await meHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false })
      expect(res.getHeader('set-cookie')).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 401 without modifying cookies when Supabase rejects sb_access', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ message: 'Expired' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'GET',
        headers: {
          origin: 'https://yundev.space',
          cookie: 'sb_access=expired-token',
        },
      })
      const res = createMockRes()

      await meHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })
  })

  describe('POST /api/auth/logout', () => {
    const validCsrf = 'a'.repeat(64)

    it('returns 403 when x-csrf-token header is missing', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://yundev.space',
          cookie: `sb_access=tok; csrf=${validCsrf}`,
        },
      })
      const res = createMockRes()

      await logoutHandler(req, res)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false, error: 'csrf_mismatch' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 403 when csrf cookie is missing', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://yundev.space',
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await logoutHandler(req, res)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false, error: 'csrf_mismatch' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 403 when x-csrf-token does not match csrf cookie (same or different length)', async () => {
      for (const wrongToken of ['b'.repeat(64), 'short-token']) {
        const req = createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            cookie: `csrf=${validCsrf}`,
            'x-csrf-token': wrongToken,
          },
        })
        const res = createMockRes()

        await logoutHandler(req, res)

        expect(res.statusCode).toBe(403)
        expect(res.body).toEqual({ ok: false, error: 'csrf_mismatch' })
        expect(res.getHeader('set-cookie')).toBeUndefined()
      }
    })

    it('returns 200 and clears sb_access, sb_refresh, and csrf cookies on matching CSRF token', async () => {
      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://brse.yundev.space',
          cookie: `sb_access=tok; sb_refresh=ref; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await logoutHandler(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(res.getHeader('set-cookie')).toEqual([
        'sb_access=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'sb_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'csrf=; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
      ])
    })
  })

  describe('CORS and OPTIONS preflight', () => {
    it.each([
      { name: 'session', handler: sessionHandler, expectedMethods: 'POST, OPTIONS' },
      { name: 'me', handler: meHandler, expectedMethods: 'GET, OPTIONS' },
      { name: 'logout', handler: logoutHandler, expectedMethods: 'POST, OPTIONS' },
    ])(
      'returns 204 with CORS credentials headers for OPTIONS on /api/auth/$name',
      async ({ handler, expectedMethods }) => {
        const req = createMockReq({
          method: 'OPTIONS',
          headers: {
            origin: 'https://brse.yundev.space',
          },
        })
        const res = createMockRes()

        await handler(req, res)

        expect(res.statusCode).toBe(204)
        expect(res.ended).toBe(true)
        expect(res.getHeader('access-control-allow-origin')).toBe('https://brse.yundev.space')
        expect(res.getHeader('access-control-allow-credentials')).toBe('true')
        expect(res.getHeader('access-control-allow-methods')).toBe(expectedMethods)
        expect(res.getHeader('access-control-allow-headers')).toBe('content-type, x-csrf-token')
        expect(res.getHeader('vary')).toBe('Origin')
      },
    )

    it('does not reflect a disallowed origin and falls back to https://yundev.space', async () => {
      const req = createMockReq({
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
        },
      })
      const res = createMockRes()

      await sessionHandler(req, res)

      expect(res.statusCode).toBe(204)
      expect(res.getHeader('access-control-allow-origin')).toBe('https://yundev.space')
      expect(res.getHeader('access-control-allow-credentials')).toBe('true')
    })
  })
})
