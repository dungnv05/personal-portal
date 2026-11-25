import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sessionHandler from '../../api/auth/session.js'
import meHandler from '../../api/auth/me.js'
import logoutHandler from '../../api/auth/logout.js'
import refreshHandler from '../../api/auth/refresh.js'
import profileHandler from '../../api/auth/profile.js'
import saveHandler from '../../api/save.js'
import configHandler from '../../api/config.js'
import {
  SESSION_ABSOLUTE_MAX_AGE,
  clearSessionCookies,
  getPasswordAuthTime,
  isSessionPastAbsoluteCap,
  shouldAllowDevOrigins,
} from '../../api/auth/_helpers.js'
import { resetMemoryRateLimitStore } from '../../api/auth/_ratelimit.js'

type MockRequest = {
  method: string
  headers: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, string | undefined>
  url?: string
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

function makeJwt({
  amr,
  exp,
}: {
  amr?: Array<{ method?: string; timestamp?: unknown }>
  exp?: number
} = {}): string {
  const payload: Record<string, unknown> = { sub: 'user-test' }
  if (amr !== undefined) {
    payload.amr = amr
  }
  if (exp !== undefined) {
    payload.exp = exp
  }
  return createFakeJwt(payload)
}

describe('serverless auth endpoints (/api/auth/*)', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const originalCloudSave = process.env.CLOUD_SAVE_ENABLED
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalVercel = process.env.VERCEL
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetMemoryRateLimitStore()
    process.env.SUPABASE_URL = TEST_SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.CLOUD_SAVE_ENABLED
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL
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

    if (originalUpstashUrl === undefined) {
      delete process.env.UPSTASH_REDIS_REST_URL
    } else {
      process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl
    }

    if (originalUpstashToken === undefined) {
      delete process.env.UPSTASH_REDIS_REST_TOKEN
    } else {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken
    }

    if (originalCloudSave === undefined) {
      delete process.env.CLOUD_SAVE_ENABLED
    } else {
      process.env.CLOUD_SAVE_ENABLED = originalCloudSave
    }

    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = originalVercelEnv
    }

    if (originalVercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = originalVercel
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  describe('POST /api/auth/session', () => {
    it('validates the JWT against Supabase and sets exact cookies using exp - now', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 24, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)

      const nowSeconds = Math.floor(fixedNowMs / 1000)
      const accessToken = createFakeJwt({
        sub: 'user-123',
        exp: nowSeconds + 1800,
        amr: [{ method: 'password', timestamp: nowSeconds - 60 }],
      })
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
          display_name: null,
          avatar_url: null,
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
      const accessToken = makeJwt({
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }],
      })
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
        headers: {
          origin: 'https://yundev.space',
          'content-type': 'application/json',
        },
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
        headers: {
          origin: 'https://yundev.space',
          'content-type': 'application/json',
        },
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
        headers: {
          origin: 'https://yundev.space',
          'content-type': 'application/json',
        },
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

    it('rejects non-JSON content-type with 415 and missing/disallowed origin with 403 before Supabase (S8)', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      // text/plain -> 415
      const textReq = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://yundev.space',
          'content-type': 'text/plain',
        },
        body: JSON.stringify({ access_token: 'tok', refresh_token: 'ref' }),
      })
      const textRes = createMockRes()
      await sessionHandler(textReq, textRes)
      expect(textRes.statusCode).toBe(415)
      expect(textRes.body).toEqual({ ok: false, error: 'unsupported_media_type' })

      // missing origin -> 403
      const noOriginReq = createMockReq({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { access_token: 'tok', refresh_token: 'ref' },
      })
      const noOriginRes = createMockRes()
      await sessionHandler(noOriginReq, noOriginRes)
      expect(noOriginRes.statusCode).toBe(403)
      expect(noOriginRes.body).toEqual({ ok: false, error: 'origin_not_allowed' })

      // bad origin -> 403
      const badOriginReq = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: { access_token: 'tok', refresh_token: 'ref' },
      })
      const badOriginRes = createMockRes()
      await sessionHandler(badOriginReq, badOriginRes)
      expect(badOriginRes.statusCode).toBe(403)
      expect(badOriginRes.body).toEqual({ ok: false, error: 'origin_not_allowed' })

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
          cookie: `other=1; sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=abc`,
        },
      })
      const res = createMockRes()

      await meHandler(req, res)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${TEST_SUPABASE_URL}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: TEST_SUPABASE_ANON_KEY,
          Authorization: expect.stringMatching(/^Bearer eyJ/),
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-789',
          email: 'me@yundev.space',
          display_name: null,
          avatar_url: null,
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
          cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
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

    it('rejects dev origins when VERCEL_ENV is production and rejects vault/evil subdomains', async () => {
      process.env.VERCEL_ENV = 'production'

      for (const origin of [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://vault.yundev.space',
        'https://evil.yundev.space',
        'https://a.b.yundev.space',
      ]) {
        const req = createMockReq({ method: 'OPTIONS', headers: { origin } })
        const res = createMockRes()
        await configHandler(req, res)
        expect(res.statusCode).toBe(204)
        expect(res.getHeader('access-control-allow-origin')).toBe('https://yundev.space')
        expect(res.getHeader('vary')).toBe('Origin')
      }

      const okReq = createMockReq({
        method: 'OPTIONS',
        headers: { origin: 'https://ivf-journey.yundev.space' },
      })
      const okRes = createMockRes()
      await configHandler(okReq, okRes)
      expect(okRes.getHeader('access-control-allow-origin')).toBe('https://ivf-journey.yundev.space')
    })

    it('treats missing VERCEL_ENV as production on Vercel and fails closed for dev origins (S4)', async () => {
      const cases: Array<{
        vercelEnv: string | undefined
        vercel: string | undefined
        nodeEnv: string | undefined
        expected: boolean
      }> = [
        { vercelEnv: 'development', vercel: undefined, nodeEnv: 'test', expected: true },
        { vercelEnv: undefined, vercel: undefined, nodeEnv: 'test', expected: true },
        { vercelEnv: undefined, vercel: '1', nodeEnv: 'test', expected: false },
        { vercelEnv: 'preview', vercel: '1', nodeEnv: 'test', expected: false },
        { vercelEnv: 'production', vercel: '1', nodeEnv: 'production', expected: false },
        { vercelEnv: 'development', vercel: undefined, nodeEnv: 'production', expected: false },
      ]

      for (const c of cases) {
        if (c.vercelEnv === undefined) delete process.env.VERCEL_ENV
        else process.env.VERCEL_ENV = c.vercelEnv
        if (c.vercel === undefined) delete process.env.VERCEL
        else process.env.VERCEL = c.vercel
        if (c.nodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = c.nodeEnv

        expect(shouldAllowDevOrigins()).toBe(c.expected)

        const req = createMockReq({
          method: 'OPTIONS',
          headers: { origin: 'http://localhost:5173' },
        })
        const res = createMockRes()
        await configHandler(req, res)
        expect(res.getHeader('access-control-allow-origin')).toBe(
          c.expected ? 'http://localhost:5173' : 'https://yundev.space',
        )
      }
    })
  })

  describe('POST /api/auth/refresh', () => {
    const validCsrf = 'c'.repeat(64)

    it('rotates tokens, sets 3 cookies, and returns sanitized user on 200', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSeconds = Math.floor(fixedNowMs / 1000)

      const newAccess = createFakeJwt({
        sub: 'user-1',
        exp: nowSeconds + 3600,
        amr: [{ method: 'password', timestamp: nowSeconds - 60 }],
      })
      const newRefresh = 'rotated-refresh-token-xyz'

      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: newAccess,
              refresh_token: newRefresh,
              user: {
                id: 'user-1',
                email: 'yun@yundev.space',
                user_metadata: {
                  full_name: '  Yun Dev  ',
                  avatar_url: 'https://cdn.example.com/a.png',
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=old-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(fetchMock).toHaveBeenCalledWith(
        `${TEST_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            apikey: TEST_SUPABASE_ANON_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: 'old-refresh' }),
        },
      )
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-1',
          email: 'yun@yundev.space',
          display_name: 'Yun Dev',
          avatar_url: 'https://cdn.example.com/a.png',
        },
      })

      const cookies = res.getHeader('set-cookie') as string[]
      expect(cookies).toHaveLength(3)
      expect(cookies[0]).toBe(
        `sb_access=${newAccess}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=3600`,
      )
      expect(cookies[1]).toBe(
        `sb_refresh=${newRefresh}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=2592000`,
      )
      expect(cookies[2]).toMatch(
        /^csrf=[0-9a-f]{64}; Secure; SameSite=Lax; Path=\/; Domain=\.yundev\.space; Max-Age=2592000$/,
      )
    })

    it('returns 403 csrf_mismatch when CSRF token does not match', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=old-refresh; csrf=${validCsrf}`,
          'x-csrf-token': 'wrong',
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false, error: 'csrf_mismatch' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('clears all three cookies and returns 401 refresh_failed when Supabase returns 400', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=revoked-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'refresh_failed' })
      expect(res.getHeader('set-cookie')).toEqual([
        'sb_access=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'sb_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'csrf=; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
      ])
    })

    it('clears all three cookies and returns 401 refresh_failed on refresh_token_not_found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error_code: 'refresh_token_not_found' }), { status: 400 }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=missing-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'refresh_failed' })
      expect(res.getHeader('set-cookie')).toEqual([
        'sb_access=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'sb_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
        'csrf=; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=0',
      ])
    })

    it('returns 409 refresh_retry with no Set-Cookie when Supabase returns refresh_token_already_used', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error_code: 'refresh_token_already_used' }), { status: 400 }),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=used-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({ ok: false, error: 'refresh_retry' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 409 refresh_retry with no Set-Cookie when invalid_grant has Already Used description', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Invalid Refresh Token: Already Used',
              }),
              { status: 400 },
            ),
          ),
        ),
      )

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=used-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({ ok: false, error: 'refresh_retry' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 502 and leaves cookies untouched on network error', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network down'))))

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=old-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()

      await refreshHandler(req, res)

      expect(res.statusCode).toBe(502)
      expect(res.body).toEqual({ ok: false, error: 'auth_upstream_error' })
      expect(res.getHeader('set-cookie')).toBeUndefined()
    })

    it('returns 401 refresh_failed when sb_refresh cookie is absent (S6)', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()
      await refreshHandler(req, res)

      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'refresh_failed' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 502 and leaves cookies untouched on Supabase 401 or non-refresh 400 (S5)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }))
          .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'validation_failed' }), { status: 400 })),
      )

      for (let i = 0; i < 2; i += 1) {
        const req = createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://www.yundev.space',
            cookie: `sb_refresh=old-refresh; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
        })
        const res = createMockRes()
        await refreshHandler(req, res)

        expect(res.statusCode).toBe(502)
        expect(res.body).toEqual({ ok: false, error: 'auth_upstream_error' })
        expect(res.getHeader('set-cookie')).toBeUndefined()
      }
    })

    it('falls back to validateSupabaseAccessToken when refresh payload omits user (S6)', async () => {
      const newAccess = createFakeJwt({
        sub: 'user-fb',
        exp: Math.floor(Date.now() / 1000) + 3600,
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }],
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: newAccess, refresh_token: 'new-ref-fb' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ id: 'user-fb', email: 'fb@yundev.space' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_refresh=old-refresh; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
      })
      const res = createMockRes()
      await refreshHandler(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-fb',
          email: 'fb@yundev.space',
          display_name: null,
          avatar_url: null,
        },
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('14-day absolute session cap (S9)', () => {
    it('allows session and me when password login was 13 days ago', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)

      const token13d = makeJwt({
        exp: nowSec + 1800,
        amr: [{ method: 'password', timestamp: nowSec - 13 * 24 * 60 * 60 }],
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ id: 'user-13d', email: 'u13@yundev.space' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const sessionRes = createMockRes()
      await sessionHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            'content-type': 'application/json',
          },
          body: { access_token: token13d, refresh_token: 'ref-13d' },
        }),
        sessionRes,
      )
      expect(sessionRes.statusCode).toBe(200)
      expect(Array.isArray(sessionRes.getHeader('set-cookie'))).toBe(true)

      const meRes = createMockRes()
      await meHandler(
        createMockReq({
          method: 'GET',
          headers: {
            origin: 'https://yundev.space',
            cookie: `sb_access=${token13d}`,
          },
        }),
        meRes,
      )
      expect(meRes.statusCode).toBe(200)
      expect(meRes.getHeader('set-cookie')).toBeUndefined()
    })

    it('rejects me and session with 401 session_expired when password login was 15 days ago', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)

      const token15d = makeJwt({
        exp: nowSec + 1800,
        amr: [{ method: 'password', timestamp: nowSec - 15 * 24 * 60 * 60 }],
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ id: 'user-15d', email: 'u15@yundev.space' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const meRes = createMockRes()
      await meHandler(
        createMockReq({
          method: 'GET',
          headers: {
            origin: 'https://yundev.space',
            cookie: `sb_access=${token15d}`,
          },
        }),
        meRes,
      )
      expect(meRes.statusCode).toBe(401)
      expect(meRes.body).toEqual({ ok: false, error: 'session_expired' })
      expect(meRes.getHeader('set-cookie')).toBeUndefined()

      const sessionRes = createMockRes()
      await sessionHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            'content-type': 'application/json',
          },
          body: { access_token: token15d, refresh_token: 'ref-15d' },
        }),
        sessionRes,
      )
      expect(sessionRes.statusCode).toBe(401)
      expect(sessionRes.body).toEqual({ ok: false, error: 'session_expired' })
      expect(sessionRes.getHeader('set-cookie')).toBeUndefined()
    })

    it('rejects refresh at 15 days with 401 session_expired and cleared cookies, while allowing 13 days', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)
      const validCsrf = 'f'.repeat(64)

      const token15d = makeJwt({
        exp: nowSec + 3600,
        amr: [{ method: 'password', timestamp: nowSec - 15 * 24 * 60 * 60 }],
      })
      const token13d = makeJwt({
        exp: nowSec + 3600,
        amr: [{ method: 'password', timestamp: nowSec - 13 * 24 * 60 * 60 }],
      })

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: token15d,
                refresh_token: 'new-ref-15d',
                user: { id: 'user-r', email: 'r@yundev.space' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: token13d,
                refresh_token: 'new-ref-13d',
                user: { id: 'user-r', email: 'r@yundev.space' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          ),
      )

      const expiredRes = createMockRes()
      await refreshHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            cookie: `sb_refresh=old-ref; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
        }),
        expiredRes,
      )
      expect(expiredRes.statusCode).toBe(401)
      expect(expiredRes.body).toEqual({ ok: false, error: 'session_expired' })
      expect(expiredRes.getHeader('set-cookie')).toEqual(clearSessionCookies())

      const validRes = createMockRes()
      await refreshHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            cookie: `sb_refresh=old-ref; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
        }),
        validRes,
      )
      expect(validRes.statusCode).toBe(200)
      expect(validRes.body).toEqual({
        ok: true,
        user: {
          id: 'user-r',
          email: 'r@yundev.space',
          display_name: null,
          avatar_url: null,
        },
      })
    })

    it('resets the cap on a new password login (newest password amr wins)', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)

      const oldOnlyToken = makeJwt({
        exp: nowSec + 1800,
        amr: [{ method: 'password', timestamp: nowSec - 20 * 24 * 60 * 60 }],
      })
      const reloginToken = makeJwt({
        exp: nowSec + 1800,
        amr: [
          { method: 'password', timestamp: nowSec - 20 * 24 * 60 * 60 },
          { method: 'password', timestamp: nowSec - 10 },
        ],
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ id: 'user-relogin', email: 'relogin@yundev.space' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      )

      const oldRes = createMockRes()
      await sessionHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            'content-type': 'application/json',
          },
          body: { access_token: oldOnlyToken, refresh_token: 'ref-old' },
        }),
        oldRes,
      )
      expect(oldRes.statusCode).toBe(401)
      expect(oldRes.body).toEqual({ ok: false, error: 'session_expired' })

      const freshRes = createMockRes()
      await sessionHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://yundev.space',
            'content-type': 'application/json',
          },
          body: { access_token: reloginToken, refresh_token: 'ref-fresh' },
        }),
        freshRes,
      )
      expect(freshRes.statusCode).toBe(200)
      expect(Array.isArray(freshRes.getHeader('set-cookie'))).toBe(true)
    })

    it('unit: getPasswordAuthTime and isSessionPastAbsoluteCap handle amr selection, fallback, null, and skew', () => {
      const nowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      const nowSec = Math.floor(nowMs / 1000)

      const multiPassword = makeJwt({
        amr: [
          { method: 'otp', timestamp: 9999999999 },
          { method: 'password', timestamp: 1000 },
          { method: 'password', timestamp: 2000 },
        ],
      })
      expect(getPasswordAuthTime(multiPassword)).toBe(2000)

      const fallbackAny = makeJwt({
        amr: [
          { method: 'otp', timestamp: 1500 },
          { method: 'oauth', timestamp: 2500 },
        ],
      })
      expect(getPasswordAuthTime(fallbackAny)).toBe(2500)

      expect(getPasswordAuthTime(makeJwt({}))).toBeNull()
      expect(getPasswordAuthTime(makeJwt({ amr: [] }))).toBeNull()
      expect(getPasswordAuthTime(makeJwt({ amr: [{ method: 'password', timestamp: Number.NaN }] }))).toBeNull()
      expect(getPasswordAuthTime('not-a-jwt')).toBeNull()
      expect(getPasswordAuthTime('a.!!!.c')).toBeNull()
      expect(getPasswordAuthTime(null as unknown as string)).toBeNull()

      expect(isSessionPastAbsoluteCap('not-a-jwt', nowMs)).toBe(true)
      expect(
        isSessionPastAbsoluteCap(
          makeJwt({ amr: [{ method: 'password', timestamp: nowSec + 301 }] }),
          nowMs,
        ),
      ).toBe(true)
      expect(
        isSessionPastAbsoluteCap(
          makeJwt({ amr: [{ method: 'password', timestamp: nowSec + 300 }] }),
          nowMs,
        ),
      ).toBe(false)
      expect(
        isSessionPastAbsoluteCap(
          makeJwt({ amr: [{ method: 'password', timestamp: nowSec - SESSION_ABSOLUTE_MAX_AGE }] }),
          nowMs,
        ),
      ).toBe(false)
      expect(
        isSessionPastAbsoluteCap(
          makeJwt({ amr: [{ method: 'password', timestamp: nowSec - SESSION_ABSOLUTE_MAX_AGE - 1 }] }),
          nowMs,
        ),
      ).toBe(true)
    })
  })

  describe('Rate limiting', () => {
    it('returns 429 with Retry-After after exceeding per-IP limit', async () => {
      vi.stubGlobal('fetch', vi.fn())

      for (let i = 0; i < 10; i += 1) {
        const req = createMockReq({
          method: 'POST',
          headers: {
            'x-forwarded-for': '203.0.113.9',
            origin: 'https://yundev.space',
            'content-type': 'application/json',
          },
          body: {},
        })
        const res = createMockRes()
        await sessionHandler(req, res)
        expect(res.statusCode).toBe(401)
      }

      const blockedReq = createMockReq({
        method: 'POST',
        headers: {
          'x-forwarded-for': '203.0.113.9',
          origin: 'https://yundev.space',
          'content-type': 'application/json',
        },
        body: {},
      })
      const blockedRes = createMockRes()
      await sessionHandler(blockedReq, blockedRes)

      expect(blockedRes.statusCode).toBe(429)
      expect(blockedRes.body).toEqual({ ok: false, error: 'rate_limited' })
      expect(blockedRes.getHeader('retry-after')).toBeDefined()
    })

    it('uses Upstash REST when env vars are set and falls back to memory on Upstash error', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.test'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-test-token'

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ result: 31 }, { result: 1 }, { result: 42500 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockRejectedValueOnce(new TypeError('Upstash unreachable'))
      vi.stubGlobal('fetch', fetchMock)

      const blockedReq = createMockReq({
        method: 'POST',
        headers: { 'x-real-ip': '198.51.100.2' },
      })
      const blockedRes = createMockRes()
      await logoutHandler(blockedReq, blockedRes)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://redis.upstash.test/pipeline',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer upstash-test-token',
          }),
        }),
      )
      expect(blockedRes.statusCode).toBe(429)
      expect(blockedRes.getHeader('retry-after')).toBe('43')
      expect(blockedRes.body).toEqual({ ok: false, error: 'rate_limited' })

      const fallbackReq = createMockReq({
        method: 'POST',
        headers: { 'x-real-ip': '198.51.100.2' },
      })
      const fallbackRes = createMockRes()
      await logoutHandler(fallbackReq, fallbackRes)

      expect(fallbackRes.statusCode).toBe(403)
      expect(fallbackRes.body).toEqual({ ok: false, error: 'csrf_mismatch' })
    })

    it('falls back to memory on Upstash EXPIRE error, missing/negative PTTL, or timeout/abort (S3)', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.test'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-test-token'

      const fetchMock = vi
        .fn()
        // 1. EXPIRE error
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ result: 31 }, { error: 'ERR expire' }, { result: 5000 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        // 2. PTTL -1
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ result: 31 }, { result: 1 }, { result: -1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        // 3. Timeout/AbortError
        .mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      vi.stubGlobal('fetch', fetchMock)

      for (const ip of ['198.51.100.10', '198.51.100.11', '198.51.100.12']) {
        const req = createMockReq({
          method: 'POST',
          headers: { 'x-real-ip': ip },
        })
        const res = createMockRes()
        await logoutHandler(req, res)
        expect(res.statusCode).toBe(403)
        expect(res.body).toEqual({ ok: false, error: 'csrf_mismatch' })
      }
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('warns once in production when Upstash env vars are missing, and does not warn in dev/test', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn())

      // 1. Local dev/test (VERCEL_ENV undefined, VERCEL undefined, NODE_ENV !== production) -> no warning
      for (let i = 0; i < 3; i += 1) {
        const req = createMockReq({
          method: 'POST',
          headers: { 'x-real-ip': '198.51.100.30' },
        })
        const res = createMockRes()
        await logoutHandler(req, res)
        expect(res.statusCode).toBe(403)
      }
      expect(warnSpy).not.toHaveBeenCalled()

      // 2. Production without Upstash env vars -> emits console.warn once across multiple calls
      process.env.VERCEL = '1'
      process.env.VERCEL_ENV = 'production'
      for (let i = 0; i < 3; i += 1) {
        const req = createMockReq({
          method: 'POST',
          headers: { 'x-real-ip': '198.51.100.31' },
        })
        const res = createMockRes()
        await logoutHandler(req, res)
        expect(res.statusCode).toBe(403)
      }
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const msg = String(warnSpy.mock.calls[0]?.[0] ?? '')
      expect(msg).toContain('[ratelimit]')
      expect(msg).not.toContain(TEST_SUPABASE_URL)
      expect(msg).not.toContain(TEST_SUPABASE_ANON_KEY)
      expect(msg).not.toContain('http')
    })
  })

  describe('POST /api/auth/profile', () => {
    const validCsrf = 'd'.repeat(64)

    it('rejects empty, overlong, or control-char display_name with 400', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      for (const badName of ['   ', 'a'.repeat(51), 'bad\nname', 123]) {
        const req = createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://www.yundev.space',
            cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          body: { display_name: badName },
        })
        const res = createMockRes()
        await profileHandler(req, res)
        expect(res.statusCode).toBe(400)
        expect(res.body).toEqual({ ok: false, error: 'invalid_display_name' })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('updates user_metadata.full_name via Supabase and returns updated user', async () => {
      const validToken = makeJwt({
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }],
      })
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user-99',
              email: 'yun@yundev.space',
              user_metadata: { full_name: 'Yun Nguyen' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const req = createMockReq({
        method: 'POST',
        headers: {
          origin: 'https://www.yundev.space',
          cookie: `sb_access=${validToken}; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
        body: { display_name: '  Yun Nguyen  ' },
      })
      const res = createMockRes()

      await profileHandler(req, res)

      expect(fetchMock).toHaveBeenCalledWith(`${TEST_SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: TEST_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { full_name: 'Yun Nguyen' } }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        user: {
          id: 'user-99',
          email: 'yun@yundev.space',
          display_name: 'Yun Nguyen',
          avatar_url: null,
        },
      })
    })

    it('returns 401 unauthorized when sb_access is past the 14-day absolute cap (S9)', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)

      const expiredToken = makeJwt({
        exp: nowSec + 3600,
        amr: [{ method: 'password', timestamp: nowSec - 15 * 24 * 60 * 60 }],
      })

      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user-99',
              email: 'yun@yundev.space',
              user_metadata: { full_name: 'Yun Nguyen' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const res = createMockRes()
      await profileHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://www.yundev.space',
            cookie: `sb_access=${expiredToken}; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          body: { display_name: 'Yun Nguyen' },
        }),
        res,
      )

      // D3-a: an expired session must never reach the Supabase PUT (no write at all).
      expect(fetchMock).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' })
    })

    it('returns 403 on missing/mismatched CSRF, 401 without sb_access, and 401 on upstream 401 (S6)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
      )
      vi.stubGlobal('fetch', fetchMock)

      // 403 missing CSRF
      const noCsrfRes = createMockRes()
      await profileHandler(
        createMockReq({
          method: 'POST',
          headers: { origin: 'https://www.yundev.space', cookie: `sb_access=tok; csrf=${validCsrf}` },
          body: { display_name: 'Yun' },
        }),
        noCsrfRes,
      )
      expect(noCsrfRes.statusCode).toBe(403)
      expect(noCsrfRes.body).toEqual({ ok: false, error: 'csrf_mismatch' })

      // 401 missing sb_access
      const noAccessRes = createMockRes()
      await profileHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://www.yundev.space',
            cookie: `csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          body: { display_name: 'Yun' },
        }),
        noAccessRes,
      )
      expect(noAccessRes.statusCode).toBe(401)
      expect(noAccessRes.body).toEqual({ ok: false, error: 'unauthorized' })
      expect(fetchMock).not.toHaveBeenCalled()

      // upstream 401 -> 401
      const upstream401Res = createMockRes()
      await profileHandler(
        createMockReq({
          method: 'POST',
          headers: {
            origin: 'https://www.yundev.space',
            cookie: `sb_access=expired-tok; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          body: { display_name: 'Yun' },
        }),
        upstream401Res,
      )
      expect(upstream401Res.statusCode).toBe(401)
      expect(upstream401Res.body).toEqual({ ok: false, error: 'unauthorized' })
    })
  })

  describe('GET/PUT /api/save', () => {
    const validCsrf = 'e'.repeat(64)

    it('returns 401 unauthorized when sb_access is past the 14-day absolute cap (S9)', async () => {
      vi.useFakeTimers()
      const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
      vi.setSystemTime(fixedNowMs)
      const nowSec = Math.floor(fixedNowMs / 1000)

      process.env.CLOUD_SAVE_ENABLED = 'true'
      const expiredToken = makeJwt({
        exp: nowSec + 3600,
        amr: [{ method: 'password', timestamp: nowSec - 15 * 24 * 60 * 60 }],
      })

      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 'user-save', email: 'save@yundev.space' }), { status: 200 }),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const res = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'GET',
          headers: {
            origin: 'https://vang-vong-su-viet.yundev.space',
            cookie: `sb_access=${expiredToken}`,
          },
          query: { game: 'vang-vong', slot: '0' },
        }),
        res,
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' })
    })

    it('returns 503 cloud_save_disabled when CLOUD_SAVE_ENABLED is not true', async () => {
      const req = createMockReq({
        method: 'GET',
        headers: { origin: 'https://vang-vong-su-viet.yundev.space' },
        query: { game: 'vang-vong', slot: '0' },
      })
      const res = createMockRes()

      await saveHandler(req, res)

      expect(res.statusCode).toBe(503)
      expect(res.body).toEqual({ ok: false, error: 'cloud_save_disabled' })
    })

    it('supports GET and PUT happy paths, and rejects bad slot, oversize data, and missing CSRF', async () => {
      process.env.CLOUD_SAVE_ENABLED = 'true'

      const fetchMock = vi
        .fn()
        // 1. GET /auth/v1/user
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-save', email: 'save@yundev.space' }), { status: 200 }),
        )
        // 2. GET /rest/v1/game_saves
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ data: { level: 5 }, version: 2, updated_at: '2026-11-25T00:00:00Z' }]),
            { status: 200 },
          ),
        )
        // 3. GET /auth/v1/user for PUT
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-save', email: 'save@yundev.space' }), { status: 200 }),
        )
        // 4. POST /rest/v1/game_saves
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ updated_at: '2026-11-25T01:00:00Z' }]), { status: 201 }),
        )
        // 5..7. auth checks for error cases
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ id: 'user-save', email: 'save@yundev.space' }), {
              status: 200,
            }),
        )
      vi.stubGlobal('fetch', fetchMock)

      // GET happy path
      const getReq = createMockReq({
        method: 'GET',
        headers: {
          origin: 'https://vang-vong-su-viet.yundev.space',
          cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
        },
        query: { game: 'vang-vong', slot: '1' },
      })
      const getRes = createMockRes()
      await saveHandler(getReq, getRes)
      expect(getRes.statusCode).toBe(200)
      expect(getRes.body).toEqual({
        ok: true,
        save: { data: { level: 5 }, version: 2, updated_at: '2026-11-25T00:00:00Z' },
      })

      // PUT happy path
      const putReq = createMockReq({
        method: 'PUT',
        headers: {
          origin: 'https://vang-vong-su-viet.yundev.space',
          cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
        query: { game: 'vang-vong', slot: '1' },
        body: { data: { level: 6 }, version: 3 },
      })
      const putRes = createMockRes()
      await saveHandler(putReq, putRes)
      expect(putRes.statusCode).toBe(200)
      expect(putRes.body).toEqual({ ok: true, updated_at: '2026-11-25T01:00:00Z' })

      // Bad slot -> 400
      const badSlotReq = createMockReq({
        method: 'GET',
        headers: { cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}` },
        query: { game: 'vang-vong', slot: '3' },
      })
      const badSlotRes = createMockRes()
      await saveHandler(badSlotReq, badSlotRes)
      expect(badSlotRes.statusCode).toBe(400)
      expect(badSlotRes.body).toEqual({ ok: false, error: 'invalid_query' })

      // PUT without CSRF -> 403
      const noCsrfReq = createMockReq({
        method: 'PUT',
        headers: {
          cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { data: { level: 1 }, version: 0 },
      })
      const noCsrfRes = createMockRes()
      await saveHandler(noCsrfReq, noCsrfRes)
      expect(noCsrfRes.statusCode).toBe(403)
      expect(noCsrfRes.body).toEqual({ ok: false, error: 'csrf_mismatch' })

      // Oversize data -> 413
      const bigReq = createMockReq({
        method: 'PUT',
        headers: {
          cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
          'x-csrf-token': validCsrf,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { data: { blob: 'x'.repeat(66000) }, version: 1 },
      })
      const bigRes = createMockRes()
      await saveHandler(bigReq, bigRes)
      expect(bigRes.statusCode).toBe(413)
      expect(bigRes.body).toEqual({ ok: false, error: 'payload_too_large' })
    })

    it('returns 401 without sb_access cookie and 502 on GET upstream failure (S6)', async () => {
      process.env.CLOUD_SAVE_ENABLED = 'true'
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-save', email: 'save@yundev.space' }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('bad gateway', { status: 500 }))
      vi.stubGlobal('fetch', fetchMock)

      const unauthRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'GET',
          headers: { origin: 'https://vang-vong-su-viet.yundev.space' },
          query: { game: 'vang-vong', slot: '0' },
        }),
        unauthRes,
      )
      expect(unauthRes.statusCode).toBe(401)
      expect(unauthRes.body).toEqual({ ok: false, error: 'unauthorized' })
      expect(fetchMock).not.toHaveBeenCalled()

      const upstreamErrRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'GET',
          headers: {
            origin: 'https://vang-vong-su-viet.yundev.space',
            cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}`,
          },
          query: { game: 'vang-vong', slot: '0' },
        }),
        upstreamErrRes,
      )
      expect(upstreamErrRes.statusCode).toBe(502)
      expect(upstreamErrRes.body).toEqual({ ok: false, error: 'upstream_error' })
    })

    it('enforces exact 65536-byte boundary, 70000-byte content-length guard, and per-IP rate limit (S1, S2)', async () => {
      process.env.CLOUD_SAVE_ENABLED = 'true'
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-boundary', email: 'b@yundev.space' }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ updated_at: '2026-11-25T02:00:00Z' }]), { status: 201 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-boundary', email: 'b@yundev.space' }), { status: 200 }),
        )
      vi.stubGlobal('fetch', fetchMock)

      // 1. content-length > 70000 -> 413 with zero fetch calls
      const clRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'PUT',
          headers: {
            'x-forwarded-for': '203.0.113.50',
            'content-length': '70001',
            cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          query: { game: 'vang-vong', slot: '0' },
          body: { data: { k: 'v' }, version: 0 },
        }),
        clRes,
      )
      expect(clRes.statusCode).toBe(413)
      expect(clRes.body).toEqual({ ok: false, error: 'payload_too_large' })
      expect(fetchMock).not.toHaveBeenCalled()

      // 2. Exactly 65536 UTF-8 bytes -> accepted (200)
      const exactPrefix = '{"b":"'
      const exactSuffix = '"}'
      const exactBlob = 'a'.repeat(65536 - exactPrefix.length - exactSuffix.length)
      const exactData = { b: exactBlob }
      expect(Buffer.byteLength(JSON.stringify(exactData), 'utf8')).toBe(65536)

      const exactRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'PUT',
          headers: {
            'x-forwarded-for': '203.0.113.51',
            cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          query: { game: 'vang-vong', slot: '0' },
          body: { data: exactData, version: 0 },
        }),
        exactRes,
      )
      expect(exactRes.statusCode).toBe(200)
      expect(exactRes.body).toEqual({ ok: true, updated_at: '2026-11-25T02:00:00Z' })

      // 3. 65537 UTF-8 bytes -> 413
      const overData = { b: `${exactBlob}x` }
      expect(Buffer.byteLength(JSON.stringify(overData), 'utf8')).toBe(65537)
      const overRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'PUT',
          headers: {
            'x-forwarded-for': '203.0.113.52',
            cookie: `sb_access=${makeJwt({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })}; csrf=${validCsrf}`,
            'x-csrf-token': validCsrf,
          },
          query: { game: 'vang-vong', slot: '0' },
          body: { data: overData, version: 0 },
        }),
        overRes,
      )
      expect(overRes.statusCode).toBe(413)
      expect(overRes.body).toEqual({ ok: false, error: 'payload_too_large' })

      // 4. Per-IP limit (save-ip, 120/60s) blocks before validateSupabaseAccessToken
      fetchMock.mockClear()
      for (let i = 0; i < 120; i += 1) {
        const res = createMockRes()
        await saveHandler(
          createMockReq({
            method: 'PUT',
            headers: { 'x-forwarded-for': '203.0.113.99' },
          }),
          res,
        )
        expect(res.statusCode).toBe(401)
      }
      const ipBlockedRes = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'PUT',
          headers: { 'x-forwarded-for': '203.0.113.99' },
        }),
        ipBlockedRes,
      )
      expect(ipBlockedRes.statusCode).toBe(429)
      expect(ipBlockedRes.body).toEqual({ ok: false, error: 'rate_limited' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
