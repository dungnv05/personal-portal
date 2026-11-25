import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pregnancyHandler from '../../api/pregnancy.js'
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
const ORIGIN = 'https://ivf-journey.yundev.space'
const USER_A = '11111111-1111-4111-8111-111111111111'
const VALID_CSRF = 'e'.repeat(64)

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

function makeAccessCookie(offsetSec = -60): string {
  const nowSec = Math.floor(Date.now() / 1000)
  return createFakeJwt({
    sub: USER_A,
    amr: [{ method: 'password', timestamp: nowSec + offsetSec }],
  })
}

describe('GET / PUT /api/pregnancy', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const originalKvUrl = process.env.KV_REST_API_URL
  const originalKvToken = process.env.KV_REST_API_TOKEN
  const originalSyncEnabled = process.env.IVF_DUE_DATE_SYNC_ENABLED
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalVercel = process.env.VERCEL
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetMemoryRateLimitStore()
    process.env.SUPABASE_URL = TEST_SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY
    process.env.IVF_DUE_DATE_SYNC_ENABLED = 'true'
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    restore('SUPABASE_URL', originalSupabaseUrl)
    restore('SUPABASE_ANON_KEY', originalSupabaseAnonKey)
    restore('UPSTASH_REDIS_REST_URL', originalUpstashUrl)
    restore('UPSTASH_REDIS_REST_TOKEN', originalUpstashToken)
    restore('KV_REST_API_URL', originalKvUrl)
    restore('KV_REST_API_TOKEN', originalKvToken)
    restore('IVF_DUE_DATE_SYNC_ENABLED', originalSyncEnabled)
    restore('VERCEL_ENV', originalVercelEnv)
    restore('VERCEL', originalVercel)
    restore('NODE_ENV', originalNodeEnv)
  })

  it('1. OPTIONS allowed origin returns 204 with CORS headers and Vary: Origin', async () => {
    const res = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'OPTIONS',
        headers: { origin: ORIGIN },
      }),
      res,
    )

    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
    expect(res.getHeader('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.getHeader('access-control-allow-credentials')).toBe('true')
    expect(res.getHeader('access-control-allow-methods')).toBe('GET, PUT, OPTIONS')
    expect(res.getHeader('access-control-allow-headers')).toBe('content-type, x-csrf-token')
    expect(res.getHeader('access-control-max-age')).toBe('600')
    expect(String(res.getHeader('vary'))).toContain('Origin')
    expect(res.getHeader('cache-control')).toBe('private, no-store')
  })

  it('2. OPTIONS evil or missing origin returns 403 origin_forbidden with no ACAO', async () => {
    const disallowed = [
      'https://evil.com',
      'https://vang-vong-su-viet.yundev.space',
      'https://ivf-journey.yundev.space.evil.com',
      undefined,
    ]

    for (const origin of disallowed) {
      const res = createMockRes()
      await pregnancyHandler(
        createMockReq({
          method: 'OPTIONS',
          headers: origin ? { origin } : {},
        }),
        res,
      )
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false, error: 'origin_forbidden' })
      expect(res.getHeader('access-control-allow-origin')).toBeUndefined()
    }
  })

  it('3. GET evil origin -> 403; PUT no origin or suffix attack origin -> 403; GET no origin allowed', async () => {
    const getEvil = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: 'https://evil.example.com' },
      }),
      getEvil,
    )
    expect(getEvil.statusCode).toBe(403)
    expect(getEvil.body).toEqual({ ok: false, error: 'origin_forbidden' })
    expect(getEvil.getHeader('access-control-allow-origin')).toBeUndefined()

    const putNoOrigin = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {},
      }),
      putNoOrigin,
    )
    expect(putNoOrigin.statusCode).toBe(403)
    expect(putNoOrigin.body).toEqual({ ok: false, error: 'origin_forbidden' })

    const putSuffix = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: { origin: 'https://ivf-journey.yundev.space.evil.com' },
      }),
      putSuffix,
    )
    expect(putSuffix.statusCode).toBe(403)
    expect(putSuffix.body).toEqual({ ok: false, error: 'origin_forbidden' })
    expect(putSuffix.getHeader('access-control-allow-origin')).toBeUndefined()

    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/pregnancy_profiles')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const getNoOrigin = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { cookie: `sb_access=${token}` },
      }),
      getNoOrigin,
    )
    expect(getNoOrigin.statusCode).toBe(200)
    expect(getNoOrigin.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('4. DELETE returns 405 method_not_allowed with Allow header', async () => {
    const res = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'DELETE',
        headers: { origin: ORIGIN },
      }),
      res,
    )
    expect(res.statusCode).toBe(405)
    expect(res.body).toEqual({ ok: false, error: 'method_not_allowed' })
    expect(res.getHeader('allow')).toBe('GET, PUT, OPTIONS')
  })

  it('5. IVF_DUE_DATE_SYNC_ENABLED off -> 503 due_date_sync_disabled', async () => {
    delete process.env.IVF_DUE_DATE_SYNC_ENABLED

    const res = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN },
      }),
      res,
    )
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false, error: 'due_date_sync_disabled' })
    expect(res.getHeader('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('6. outside dev without Upstash env -> 503 ratelimit_unavailable', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL = '1'

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${makeAccessCookie()}` },
      }),
      res,
    )
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false, error: 'ratelimit_unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('7. missing cookie -> 401 unauthorized; CSRF mismatch -> 403 csrf_mismatch', async () => {
    const noCookie = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN },
      }),
      noCookie,
    )
    expect(noCookie.statusCode).toBe(401)
    expect(noCookie.body).toEqual({ ok: false, error: 'unauthorized' })

    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )

    const csrfMismatch = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': 'f'.repeat(64),
          'content-type': 'application/json',
        },
        body: { dueDate: '2026-08-15' },
      }),
      csrfMismatch,
    )
    expect(csrfMismatch.statusCode).toBe(403)
    expect(csrfMismatch.body).toEqual({ ok: false, error: 'csrf_mismatch' })
  })

  it('8. PUT wrong content-type -> 415; Content-Length 2000 -> 413 payload_too_large', async () => {
    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )

    const wrongCt = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          'content-type': 'text/plain',
        },
        body: { dueDate: '2026-08-15' },
      }),
      wrongCt,
    )
    expect(wrongCt.statusCode).toBe(415)

    const tooLarge = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          'content-type': 'application/json',
          'content-length': '2000',
        },
        body: { dueDate: '2026-08-15' },
      }),
      tooLarge,
    )
    expect(tooLarge.statusCode).toBe(413)
    expect(tooLarge.body).toEqual({ ok: false, error: 'payload_too_large' })
  })

  it('9. PUT body validation: extra key, user_id key, array -> 400 invalid_body; invalid dueDate -> 400 invalid_due_date', async () => {
    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )

    const sendPut = async (body: unknown) => {
      const res = createMockRes()
      await pregnancyHandler(
        createMockReq({
          method: 'PUT',
          headers: {
            origin: ORIGIN,
            cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
            'x-csrf-token': VALID_CSRF,
            'content-type': 'application/json',
          },
          body,
        }),
        res,
      )
      return res
    }

    const extraKey = await sendPut({ dueDate: '2026-08-15', extra: 1 })
    expect(extraKey.statusCode).toBe(400)
    expect(extraKey.body).toEqual({ ok: false, error: 'invalid_body' })

    const bodyUserId = await sendPut({ dueDate: '2026-08-15', user_id: 'other-user' })
    expect(bodyUserId.statusCode).toBe(400)
    expect(bodyUserId.body).toEqual({ ok: false, error: 'invalid_body' })

    const arrayBody = await sendPut(['2026-08-15'])
    expect(arrayBody.statusCode).toBe(400)
    expect(arrayBody.body).toEqual({ ok: false, error: 'invalid_body' })

    const invalidDates = ['2025-02-30', '2019-12-31', '2101-01-01', '2025-1-01', 20250101]
    for (const dueDate of invalidDates) {
      const res = await sendPut({ dueDate })
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ ok: false, error: 'invalid_due_date' })
    }
  })

  it('10. GET maps existing row and empty result to nulls', async () => {
    const token = makeAccessCookie()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/pregnancy_profiles')) {
          const headers = (init?.headers ?? {}) as Record<string, string>
          expect(headers.apikey).toBe(TEST_SUPABASE_ANON_KEY)
          expect(headers.Authorization).toBe(`Bearer ${token}`)
          expect(url).toBe(
            `${TEST_SUPABASE_URL}/rest/v1/pregnancy_profiles?select=due_date,updated_at&user_id=eq.${USER_A}&limit=1`,
          )
          return new Response(
            JSON.stringify([{ due_date: '2026-08-15', updated_at: '2026-11-25T10:00:00Z' }]),
            { status: 200 },
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const existingRes = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
      }),
      existingRes,
    )
    expect(existingRes.statusCode).toBe(200)
    expect(existingRes.body).toEqual({
      ok: true,
      dueDate: '2026-08-15',
      updatedAt: '2026-11-25T10:00:00Z',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/pregnancy_profiles')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const emptyRes = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
      }),
      emptyRes,
    )
    expect(emptyRes.statusCode).toBe(200)
    expect(emptyRes.body).toEqual({
      ok: true,
      dueDate: null,
      updatedAt: null,
    })
  })

  it('11. PUT sends upsert URL, Prefer header, Bearer user token, user_id from token, and accepts null', async () => {
    const token = makeAccessCookie()
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/pregnancy_profiles')) {
          const parsedBody = JSON.parse(String(init?.body))
          calls.push({
            url,
            method: String(init?.method),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: parsedBody,
          })
          return new Response(
            JSON.stringify([{ due_date: parsedBody.due_date, updated_at: '2026-11-25T11:00:00Z' }]),
            { status: 200 },
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const setRes = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          'content-type': 'application/json',
        },
        body: { dueDate: '2026-08-15' },
      }),
      setRes,
    )
    expect(setRes.statusCode).toBe(200)
    expect(setRes.body).toEqual({
      ok: true,
      dueDate: '2026-08-15',
      updatedAt: '2026-11-25T11:00:00Z',
    })

    const clearRes = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          'content-type': 'application/json',
        },
        body: { dueDate: null },
      }),
      clearRes,
    )
    expect(clearRes.statusCode).toBe(200)
    expect(clearRes.body).toEqual({
      ok: true,
      dueDate: null,
      updatedAt: '2026-11-25T11:00:00Z',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(`${TEST_SUPABASE_URL}/rest/v1/pregnancy_profiles?on_conflict=user_id`)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers.Prefer).toBe('resolution=merge-duplicates,return=representation')
    expect(calls[0].headers.Authorization).toBe(`Bearer ${token}`)
    expect(calls[0].headers.apikey).toBe(TEST_SUPABASE_ANON_KEY)
    expect(calls[0].body).toEqual({ user_id: USER_A, due_date: '2026-08-15' })
    expect(calls[1].body).toEqual({ user_id: USER_A, due_date: null })
  })

  it('12. PostgREST 500 -> 502 storage_error', async () => {
    const token = makeAccessCookie()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/pregnancy_profiles')) {
          return new Response(JSON.stringify({ error: 'db_down' }), { status: 500 })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const getErr = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
      }),
      getErr,
    )
    expect(getErr.statusCode).toBe(502)
    expect(getErr.body).toEqual({ ok: false, error: 'storage_error' })

    const putErr = createMockRes()
    await pregnancyHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          'content-type': 'application/json',
        },
        body: { dueDate: '2026-08-15' },
      }),
      putErr,
    )
    expect(putErr.statusCode).toBe(502)
    expect(putErr.body).toEqual({ ok: false, error: 'storage_error' })
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('13. api/pregnancy.js source does not contain SERVICE_ROLE or SECRET_KEY', () => {
    const source = fs.readFileSync(process.cwd() + '/api/pregnancy.js', 'utf8')
    expect(source).not.toContain('SERVICE_ROLE')
    expect(source).not.toContain('SECRET_KEY')
  })
})
