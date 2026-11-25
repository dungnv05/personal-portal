import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import saveHandler from '../../api/save.js'
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
const ORIGIN = 'https://vang-vong-su-viet.yundev.space'
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

function makeJwt({
  amr,
  exp,
}: {
  amr?: Array<{ method?: string; timestamp?: unknown }>
  exp?: number
} = {}): string {
  const payload: Record<string, unknown> = { sub: USER_A }
  if (amr !== undefined) {
    payload.amr = amr
  }
  if (exp !== undefined) {
    payload.exp = exp
  }
  return createFakeJwt(payload)
}

function makeAccessCookie(offsetSec = -60): string {
  const nowSec = Math.floor(Date.now() / 1000)
  return makeJwt({ amr: [{ method: 'password', timestamp: nowSec + offsetSec }] })
}

function validSave(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    gold: 5000,
    currentStageIndex: 3,
    maxUnlockedStage: 5,
    towerFloor: 12,
    maxTowerFloor: 15,
    worldBossTotalDamage: 123456,
    pvpRank: 8,
    pvpScore: 1250,
    rankLevel: 4,
    battleSpeed: 2,
    lastIdleClaimTime: Date.now() - 1000,
    isMuted: false,
    activeBeastId: 'beast_kim_quy',
    heroes: [
      {
        id: 'hero_1',
        name: 'Lê Lợi',
        level: 10,
        stars: 3,
        slotIndex: 0,
        equippedItemIds: ['item_sword_1', 'item_ring_2'],
      },
      {
        id: 'hero_2',
        name: 'Trần Hưng Đạo',
        level: 12,
        stars: 4,
        slotIndex: 1,
        equippedItemIds: [],
      },
    ],
    shards: {
      'Lê Lợi': 15,
      'Nguyễn Trãi': 30,
    },
    ...overrides,
  }
}

describe('GET / PUT / POST /api/save', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const originalKvUrl = process.env.KV_REST_API_URL
  const originalKvToken = process.env.KV_REST_API_TOKEN
  const originalCloudSave = process.env.CLOUD_SAVE_ENABLED
  const originalExcludedIds = process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalVercel = process.env.VERCEL
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetMemoryRateLimitStore()
    process.env.SUPABASE_URL = TEST_SUPABASE_URL
    process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY
    process.env.CLOUD_SAVE_ENABLED = 'true'
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS
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
    restore('CLOUD_SAVE_ENABLED', originalCloudSave)
    restore('CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS', originalExcludedIds)
    restore('VERCEL_ENV', originalVercelEnv)
    restore('VERCEL', originalVercel)
    restore('NODE_ENV', originalNodeEnv)
  })

  it('1. OPTIONS from ORIGIN returns 204 with exact CORS headers and Vary: Origin', async () => {
    const res = createMockRes()
    await saveHandler(
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
    expect(res.getHeader('access-control-allow-headers')).toBe('content-type, x-csrf-token')
    expect(res.getHeader('access-control-max-age')).toBe('600')
    expect(String(res.getHeader('vary'))).toContain('Origin')
  })

  it('2. OPTIONS from disallowed or missing origins returns 403 with no ACAO', async () => {
    const disallowedOrigins = [
      'https://www.yundev.space',
      'https://brse.yundev.space',
      'https://tinh-luong.yundev.space',
      'https://ivf-journey.yundev.space',
      'https://yundev.space',
      'https://vang-vong-su-viet.yundev.space.evil.com',
      'https://VANG-VONG-SU-VIET.yundev.space',
      'https://vang-vong-su-viet.yundev.space/',
      undefined,
    ]

    for (const origin of disallowedOrigins) {
      const res = createMockRes()
      await saveHandler(
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

  it('3. enforces Origin on PUT/GET: PUT requires ORIGIN, disallowed rejected, GET without Origin allowed', async () => {
    const putNoOrigin = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {},
        query: { game: 'vang-vong', slot: '0' },
      }),
      putNoOrigin,
    )
    expect(putNoOrigin.statusCode).toBe(403)
    expect(putNoOrigin.body).toEqual({ ok: false, error: 'origin_forbidden' })
    expect(putNoOrigin.getHeader('access-control-allow-origin')).toBeUndefined()

    for (const method of ['PUT', 'GET'] as const) {
      const res = createMockRes()
      await saveHandler(
        createMockReq({
          method,
          headers: { origin: 'https://brse.yundev.space' },
          query: { game: 'vang-vong', slot: '0' },
        }),
        res,
      )
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false, error: 'origin_forbidden' })
      expect(res.getHeader('access-control-allow-origin')).toBeUndefined()
    }

    const token = makeAccessCookie()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves')) {
        return new Response(
          JSON.stringify([{ data: validSave(), version: 1, updated_at: '2026-11-25T00:00:00Z' }]),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const getNoOrigin = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { cookie: `sb_access=${token}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      getNoOrigin,
    )
    expect(getNoOrigin.statusCode).toBe(200)
    expect(getNoOrigin.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('4. in production (VERCEL_ENV=production, VERCEL=1), PUT from http://localhost:5173 returns 403', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL = '1'

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: { origin: 'http://localhost:5173' },
        query: { game: 'vang-vong', slot: '0' },
      }),
      res,
    )
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ ok: false, error: 'origin_forbidden' })
  })

  it('5. CLOUD_SAVE_ENABLED unset returns 503 cloud_save_disabled with ACAO set for ORIGIN', async () => {
    delete process.env.CLOUD_SAVE_ENABLED

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN },
        query: { game: 'vang-vong', slot: '0' },
      }),
      res,
    )
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false, error: 'cloud_save_disabled' })
    expect(res.getHeader('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('6. DM-3: production env without Upstash env returns 503 ratelimit_unavailable before any Supabase call', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL = '1'

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${makeAccessCookie()}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      res,
    )
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false, error: 'ratelimit_unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('7. S-2: Upstash fetch rejects -> console.warn called once across 2 requests, no token leaked, falls back to memory', async () => {
    const upstashToken = 'super-secret-upstash-token-xyz'
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL = '1'
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = upstashToken

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = makeAccessCookie()

    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://redis.example.upstash.io')) {
        throw new Error('Upstash network failure')
      }
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/rest/v1/player_profiles')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < 2; i += 1) {
      const res = createMockRes()
      await saveHandler(
        createMockReq({
          method: 'GET',
          headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
          query: { game: 'vang-vong', slot: '0' },
        }),
        res,
      )
      expect(res.statusCode).toBe(200)
    }

    expect(warnSpy).toHaveBeenCalledTimes(1)
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(upstashToken)
      }
    }
  })

  it('8. returns 401 when cookie missing, Supabase rejects, or session past cap, and 403 on CSRF mismatch on PUT', async () => {
    const noCookieRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN },
        query: { game: 'vang-vong', slot: '0' },
      }),
      noCookieRes,
    )
    expect(noCookieRes.statusCode).toBe(401)
    expect(noCookieRes.body).toEqual({ ok: false, error: 'unauthorized' })

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const rejectedRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${makeAccessCookie()}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      rejectedRes,
    )
    expect(rejectedRes.statusCode).toBe(401)
    expect(rejectedRes.body).toEqual({ ok: false, error: 'unauthorized' })

    // Cap exceeded (15 days ago)
    vi.useFakeTimers()
    const fixedNowMs = Date.UTC(2026, 10, 25, 0, 0, 0)
    vi.setSystemTime(fixedNowMs)
    const nowSec = Math.floor(fixedNowMs / 1000)
    const expiredToken = makeJwt({
      exp: nowSec + 3600,
      amr: [{ method: 'password', timestamp: nowSec - 15 * 24 * 60 * 60 }],
    })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: USER_A }), { status: 200 }))
    const capRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${expiredToken}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      capRes,
    )
    expect(capRes.statusCode).toBe(401)
    expect(capRes.body).toEqual({ ok: false, error: 'unauthorized' })

    // CSRF mismatch on PUT
    vi.useRealTimers()
    const validToken = makeAccessCookie()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: USER_A }), { status: 200 }))
    const csrfRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${validToken}; csrf=${VALID_CSRF}`,
          'x-csrf-token': 'f'.repeat(64),
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 0, data: validSave() },
      }),
      csrfRes,
    )
    expect(csrfRes.statusCode).toBe(403)
    expect(csrfRes.body).toEqual({ ok: false, error: 'csrf_mismatch' })
  })

  it('9. GET handles existing row, legacy availability, exclusion, legacy error, and REST auth/filter headers', async () => {
    const token = makeAccessCookie()
    const saveData = validSave()
    const restCalls: Array<{ url: string; headers: Record<string, string> }> = []

    const makeFetch = (gameSavesResp: Response, legacyResp: Response | Error) =>
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        restCalls.push({
          url,
          headers: (init?.headers ?? {}) as Record<string, string>,
        })
        if (url.includes('/rest/v1/game_saves')) {
          return gameSavesResp
        }
        if (url.includes('/rest/v1/player_profiles')) {
          if (legacyResp instanceof Error) throw legacyResp
          return legacyResp
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

    // Row exists
    vi.stubGlobal(
      'fetch',
      makeFetch(
        new Response(JSON.stringify([{ data: saveData, version: 2, updated_at: '2026-11-25T00:00:00Z' }]), {
          status: 200,
        }),
        new Response(JSON.stringify([]), { status: 200 }),
      ),
    )
    const rowRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
        query: { game: 'vang-vong', slot: '1' },
      }),
      rowRes,
    )
    expect(rowRes.statusCode).toBe(200)
    expect(rowRes.body).toEqual({
      ok: true,
      save: { data: saveData, version: 2, updated_at: '2026-11-25T00:00:00Z' },
    })

    // No row + legacy row -> legacy_available: true
    vi.stubGlobal(
      'fetch',
      makeFetch(
        new Response(JSON.stringify([]), { status: 200 }),
        new Response(JSON.stringify([{ id: USER_A }]), { status: 200 }),
      ),
    )
    const legacyTrueRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      legacyTrueRes,
    )
    expect(legacyTrueRes.statusCode).toBe(200)
    expect(legacyTrueRes.body).toEqual({ ok: true, save: null, legacy_available: true })

    // No row + legacy row + excluded user -> legacy_available: false
    process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS = `other-user, ${USER_A}`
    vi.stubGlobal(
      'fetch',
      makeFetch(
        new Response(JSON.stringify([]), { status: 200 }),
        new Response(JSON.stringify([{ id: USER_A }]), { status: 200 }),
      ),
    )
    const excludedRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      excludedRes,
    )
    expect(excludedRes.statusCode).toBe(200)
    expect(excludedRes.body).toEqual({ ok: true, save: null, legacy_available: false })
    delete process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS

    // Legacy query failure -> false, still 200
    vi.stubGlobal(
      'fetch',
      makeFetch(new Response(JSON.stringify([]), { status: 200 }), new Error('legacy network down')),
    )
    const legacyErrRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
        query: { game: 'vang-vong', slot: '0' },
      }),
      legacyErrRes,
    )
    expect(legacyErrRes.statusCode).toBe(200)
    expect(legacyErrRes.body).toEqual({ ok: true, save: null, legacy_available: false })

    // Verify all REST URLs and headers
    expect(restCalls.length).toBeGreaterThanOrEqual(4)
    for (const call of restCalls) {
      expect(call.headers.Authorization).toBe(`Bearer ${token}`)
      expect(call.headers.apikey).toBe(TEST_SUPABASE_ANON_KEY)
      if (call.url.includes('/rest/v1/game_saves')) {
        expect(call.url).toContain(`user_id=eq.${USER_A}`)
      } else if (call.url.includes('/rest/v1/player_profiles')) {
        expect(call.url).toContain(`id=eq.${USER_A}`)
      }
    }
  })

  it('10. PUT baseVersion 0 -> POST to /rest/v1/game_saves with version 1 and user_id USER_A -> 200', async () => {
    const token = makeAccessCookie()
    let postedUrl = ''
    let postedBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves') && init?.method === 'POST') {
        postedUrl = url
        postedBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify([{ version: 1, updated_at: '2026-11-25T01:00:00Z' }]), {
          status: 201,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 0, data: validSave() },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, version: 1, updated_at: '2026-11-25T01:00:00Z' })
    expect(postedUrl).toBe(`${TEST_SUPABASE_URL}/rest/v1/game_saves`)
    expect(postedBody?.version).toBe(1)
    expect(postedBody?.user_id).toBe(USER_A)
  })

  it('11. PUT baseVersion 3 -> PATCH URL contains version=eq.3 and body version 4 -> 200', async () => {
    const token = makeAccessCookie()
    let patchedUrl = ''
    let patchedBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves') && init?.method === 'PATCH') {
        patchedUrl = url
        patchedBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify([{ version: 4, updated_at: '2026-11-25T02:00:00Z' }]), {
          status: 200,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '2' },
        body: { baseVersion: 3, data: validSave() },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, version: 4, updated_at: '2026-11-25T02:00:00Z' })
    expect(patchedUrl).toContain('version=eq.3')
    expect(patchedUrl).toContain(`user_id=eq.${USER_A}`)
    expect(patchedBody?.version).toBe(4)
  })

  it('12. conflict on PATCH returns 409 with 7-key server & client summaries and no hero ids/names or data/previous_data', async () => {
    const token = makeAccessCookie()
    const serverSave = validSave({
      gold: 9999,
      heroes: [
        {
          id: 'server_secret_hero_id',
          name: 'ServerSecretHeroName',
          level: 50,
          stars: 5,
          slotIndex: 0,
          equippedItemIds: [],
        },
      ],
    })
    const clientSave = validSave({
      gold: 7777,
      heroes: [
        {
          id: 'client_secret_hero_id',
          name: 'ClientSecretHeroName',
          level: 20,
          stars: 3,
          slotIndex: 0,
          equippedItemIds: [],
        },
      ],
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves') && init?.method === 'PATCH') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/rest/v1/game_saves') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify([{ data: serverSave, version: 5, updated_at: '2026-11-25T03:00:00Z' }]),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 2, data: clientSave },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
    const body = res.body as {
      ok: boolean
      error: string
      server: { version: number; updated_at: string; schemaVersion: number; summary: Record<string, number> }
      client: { baseVersion: number; summary: Record<string, number> }
    }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('version_conflict')
    expect(Object.keys(body.server.summary)).toHaveLength(7)
    expect(Object.keys(body.client.summary)).toHaveLength(7)

    const raw = JSON.stringify(body)
    expect(raw).not.toContain('server_secret_hero_id')
    expect(raw).not.toContain('ServerSecretHeroName')
    expect(raw).not.toContain('client_secret_hero_id')
    expect(raw).not.toContain('ClientSecretHeroName')
    expect(raw).not.toContain('"data"')
    expect(raw).not.toContain('"previous_data"')
  })

  it('13. conflict when re-read returns no row -> 409 server: null; POST insert 409 -> 409 version_conflict', async () => {
    const token = makeAccessCookie()

    // PATCH [] + GET []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/game_saves') && init?.method === 'PATCH') {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes('/rest/v1/game_saves')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const patchConflictRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 2, data: validSave() },
      }),
      patchConflictRes,
    )
    expect(patchConflictRes.statusCode).toBe(409)
    expect((patchConflictRes.body as Record<string, unknown>).server).toBeNull()

    // POST 409 + GET row
    const existing = validSave({ gold: 8888 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/game_saves') && init?.method === 'POST') {
          return new Response(JSON.stringify({ code: '23505' }), { status: 409 })
        }
        if (url.includes('/rest/v1/game_saves')) {
          return new Response(
            JSON.stringify([{ data: existing, version: 1, updated_at: '2026-11-25T04:00:00Z' }]),
            { status: 200 },
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const postConflictRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 0, data: validSave() },
      }),
      postConflictRes,
    )
    expect(postConflictRes.statusCode).toBe(409)
    expect((postConflictRes.body as Record<string, unknown>).error).toBe('version_conflict')
  })

  it('14. conflict with invalid stored row -> server.summary: null, invalid: true', async () => {
    const token = makeAccessCookie()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/game_saves') && init?.method === 'PATCH') {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes('/rest/v1/game_saves')) {
          return new Response(
            JSON.stringify([{ data: { schemaVersion: 1, broken: true }, version: 7, updated_at: '2026-11-25T05:00:00Z' }]),
            { status: 200 },
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0' },
        body: { baseVersion: 2, data: validSave() },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
    expect((res.body as Record<string, unknown>).server).toEqual({
      version: 7,
      updated_at: '2026-11-25T05:00:00Z',
      schemaVersion: 1,
      summary: null,
      invalid: true,
    })
  })

  it('15. body errors: version key, bad baseVersion, extra key, unknown data key, schemaVersion 2, content-length 70001', async () => {
    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )

    const putReq = (body: unknown, extraHeaders: Record<string, string> = {}) =>
      createMockReq({
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
          ...extraHeaders,
        },
        query: { game: 'vang-vong', slot: '0' },
        body,
      })

    const versionRes = createMockRes()
    await saveHandler(putReq({ data: validSave(), version: 0 }), versionRes)
    expect(versionRes.statusCode).toBe(400)
    expect(versionRes.body).toEqual({ ok: false, error: 'invalid_body', path: 'version' })

    for (const badBase of [-1, 2147483647, 1.5, '1']) {
      const res = createMockRes()
      await saveHandler(putReq({ data: validSave(), baseVersion: badBase }), res)
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ ok: false, error: 'invalid_body', path: 'baseVersion' })
    }

    const extraKeyRes = createMockRes()
    await saveHandler(putReq({ data: validSave(), baseVersion: 0, extra: 1 }), extraKeyRes)
    expect(extraKeyRes.statusCode).toBe(400)
    expect((extraKeyRes.body as Record<string, unknown>).error).toBe('invalid_body')

    const secretUnknownKey = 'secretExtraDataKey123'
    const unknownDataKeyRes = createMockRes()
    await saveHandler(
      putReq({ data: { ...validSave(), [secretUnknownKey]: 1 }, baseVersion: 0 }),
      unknownDataKeyRes,
    )
    expect(unknownDataKeyRes.statusCode).toBe(400)
    expect((unknownDataKeyRes.body as Record<string, unknown>).error).toBe('invalid_save')
    expect(JSON.stringify(unknownDataKeyRes.body)).not.toContain(secretUnknownKey)

    const schema2Res = createMockRes()
    await saveHandler(putReq({ data: validSave({ schemaVersion: 2 }), baseVersion: 0 }), schema2Res)
    expect(schema2Res.statusCode).toBe(400)
    expect((schema2Res.body as Record<string, unknown>).error).toBe('unsupported_schema')

    const tooLargeRes = createMockRes()
    await saveHandler(
      putReq({ data: validSave(), baseVersion: 0 }, { 'content-length': '70001' }),
      tooLargeRes,
    )
    expect(tooLargeRes.statusCode).toBe(413)
    expect(tooLargeRes.body).toEqual({ ok: false, error: 'payload_too_large' })
  })

  it('16. ORIGIN with ?game=other returns 400 invalid_query', async () => {
    const token = makeAccessCookie()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )

    const res = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'GET',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}` },
        query: { game: 'other', slot: '0' },
      }),
      res,
    )
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'invalid_query' })
  })

  it('17. POST ?action=import handles auth/csrf/exclusion, 404, legacy_invalid, success without mutating player_profiles, 409, and 429 on 4th import', async () => {
    const token = makeAccessCookie()

    // Without Origin -> 403
    const noOriginRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {},
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      noOriginRes,
    )
    expect(noOriginRes.statusCode).toBe(403)
    expect(noOriginRes.body).toEqual({ ok: false, error: 'origin_forbidden' })

    // Without CSRF -> 403
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: USER_A }), { status: 200 })),
    )
    const noCsrfRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: { origin: ORIGIN, cookie: `sb_access=${token}; csrf=${VALID_CSRF}` },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      noCsrfRes,
    )
    expect(noCsrfRes.statusCode).toBe(403)
    expect(noCsrfRes.body).toEqual({ ok: false, error: 'csrf_mismatch' })

    // Excluded user -> 403 import_excluded
    process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS = USER_A
    const excludedRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      excludedRes,
    )
    expect(excludedRes.statusCode).toBe(403)
    expect(excludedRes.body).toEqual({ ok: false, error: 'import_excluded' })
    delete process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS

    // Reset rate limit store so the 3-per-hour quota starts fresh for the remaining import cases
    resetMemoryRateLimitStore()

    // 1) No legacy row -> 404
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/player_profiles')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )
    const notFoundRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      notFoundRes,
    )
    expect(notFoundRes.statusCode).toBe(404)
    expect(notFoundRes.body).toEqual({ ok: false, error: 'legacy_not_found' })

    // 2) Legacy invalid (hero level '5') -> 400 legacy_invalid, no POST to game_saves
    const invalidLegacyFetch = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/player_profiles')) {
        return new Response(
          JSON.stringify([
            {
              full_state_json: {
                heroes: [{ id: 'h1', name: 'Lê Lợi', level: '5', stars: 1, slotIndex: 0 }],
              },
            },
          ]),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', invalidLegacyFetch)
    const invalidLegacyRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      invalidLegacyRes,
    )
    expect(invalidLegacyRes.statusCode).toBe(400)
    expect((invalidLegacyRes.body as Record<string, unknown>).error).toBe('legacy_invalid')
    expect(invalidLegacyFetch.mock.calls.some(([u]) => String(u).includes('/rest/v1/game_saves'))).toBe(
      false,
    )

    // 3) Valid legacy -> POST to game_saves with version 1 -> 200 imported: true, no PATCH/DELETE to player_profiles
    const profileMutations: Array<{ url: string; method: string }> = []
    let importedPostBody: Record<string, unknown> | null = null
    const validLegacyFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
      }
      if (url.includes('/rest/v1/player_profiles')) {
        const method = init?.method ?? 'GET'
        if (method !== 'GET') {
          profileMutations.push({ url, method })
        }
        return new Response(
          JSON.stringify([
            {
              full_state_json: {
                gold: 1000,
                heroes: [{ id: 'h1', name: 'Lê Lợi', level: 5, stars: 2, slotIndex: 0 }],
              },
            },
          ]),
          { status: 200 },
        )
      }
      if (url.includes('/rest/v1/game_saves') && init?.method === 'POST') {
        importedPostBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify([{ version: 1, updated_at: '2026-11-25T06:00:00Z' }]), {
          status: 201,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', validLegacyFetch)
    const importedRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      importedRes,
    )
    expect(importedRes.statusCode).toBe(200)
    expect(importedRes.body).toEqual({
      ok: true,
      version: 1,
      updated_at: '2026-11-25T06:00:00Z',
      imported: true,
    })
    expect(importedPostBody?.version).toBe(1)
    expect(profileMutations).toHaveLength(0)

    // 4th import within an hour -> 429 (also verify conflict on a fresh quota first? Let's test 429 right here as the 4th call)
    const rateLimitedRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      rateLimitedRes,
    )
    expect(rateLimitedRes.statusCode).toBe(429)
    expect(rateLimitedRes.body).toEqual({ ok: false, error: 'rate_limited' })

    // Insert conflict on import -> 409
    resetMemoryRateLimitStore()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: USER_A }), { status: 200 })
        }
        if (url.includes('/rest/v1/player_profiles')) {
          return new Response(
            JSON.stringify([
              {
                full_state_json: {
                  gold: 1000,
                  heroes: [{ id: 'h1', name: 'Lê Lợi', level: 5, stars: 2, slotIndex: 0 }],
                },
              },
            ]),
            { status: 200 },
          )
        }
        if (url.includes('/rest/v1/game_saves') && init?.method === 'POST') {
          return new Response(JSON.stringify({ code: '23505' }), { status: 409 })
        }
        if (url.includes('/rest/v1/game_saves')) {
          return new Response(
            JSON.stringify([{ data: validSave(), version: 1, updated_at: '2026-11-25T07:00:00Z' }]),
            { status: 200 },
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )
    const importConflictRes = createMockRes()
    await saveHandler(
      createMockReq({
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: `sb_access=${token}; csrf=${VALID_CSRF}`,
          'x-csrf-token': VALID_CSRF,
        },
        query: { game: 'vang-vong', slot: '0', action: 'import' },
      }),
      importConflictRes,
    )
    expect(importConflictRes.statusCode).toBe(409)
    expect((importConflictRes.body as Record<string, unknown>).error).toBe('version_conflict')
  })

  it('18. api/save.js source does not contain SERVICE_ROLE or SECRET_KEY', () => {
    const source = fs.readFileSync(process.cwd() + '/api/save.js', 'utf8')
    expect(source).not.toContain('SERVICE_ROLE')
    expect(source).not.toContain('SECRET_KEY')
  })
})
