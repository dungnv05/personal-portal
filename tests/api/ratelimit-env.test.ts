import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getUpstashCredentials,
  isSharedRateLimitConfigured,
  rateLimit,
  resetMemoryRateLimitStore,
} from '../../api/auth/_ratelimit.js'

type MockRequest = {
  method: string
  headers: Record<string, string | undefined>
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

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'POST',
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

describe('ratelimit env credential resolution', () => {
  let savedUpstashUrl: string | undefined
  let savedUpstashToken: string | undefined
  let savedKvUrl: string | undefined
  let savedKvToken: string | undefined
  let savedKvReadOnlyToken: string | undefined

  beforeEach(() => {
    resetMemoryRateLimitStore()
    savedUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
    savedUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
    savedKvUrl = process.env.KV_REST_API_URL
    savedKvToken = process.env.KV_REST_API_TOKEN
    savedKvReadOnlyToken = process.env.KV_REST_API_READ_ONLY_TOKEN

    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.KV_REST_API_READ_ONLY_TOKEN
  })

  afterEach(() => {
    vi.restoreAllMocks()

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    restore('UPSTASH_REDIS_REST_URL', savedUpstashUrl)
    restore('UPSTASH_REDIS_REST_TOKEN', savedUpstashToken)
    restore('KV_REST_API_URL', savedKvUrl)
    restore('KV_REST_API_TOKEN', savedKvToken)
    restore('KV_REST_API_READ_ONLY_TOKEN', savedKvReadOnlyToken)
  })

  it('returns UPSTASH pair when only UPSTASH pair is set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-test-token'

    expect(getUpstashCredentials()).toEqual({
      url: 'https://redis.upstash.test',
      token: 'upstash-test-token',
    })
    expect(isSharedRateLimitConfigured()).toBe(true)
  })

  it('returns KV pair when only KV pair is set', () => {
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_TOKEN = 'kv-test-token'

    expect(getUpstashCredentials()).toEqual({
      url: 'https://kv.upstash.test',
      token: 'kv-test-token',
    })
    expect(isSharedRateLimitConfigured()).toBe(true)
  })

  it('prefers UPSTASH pair when both pairs are set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-test-token'
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_TOKEN = 'kv-test-token'

    expect(getUpstashCredentials()).toEqual({
      url: 'https://redis.upstash.test',
      token: 'upstash-test-token',
    })
    expect(isSharedRateLimitConfigured()).toBe(true)
  })

  it('falls back to KV pair without mixing when UPSTASH URL is set but UPSTASH token is missing', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.test'
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_TOKEN = 'kv-test-token'

    expect(getUpstashCredentials()).toEqual({
      url: 'https://kv.upstash.test',
      token: 'kv-test-token',
    })
    expect(isSharedRateLimitConfigured()).toBe(true)
  })

  it('returns null when KV_REST_API_URL is set with only KV_REST_API_READ_ONLY_TOKEN', () => {
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_READ_ONLY_TOKEN = 'kv-readonly-token'

    expect(getUpstashCredentials()).toBeNull()
    expect(isSharedRateLimitConfigured()).toBe(false)
  })

  it('treats whitespace-only values as missing', () => {
    process.env.UPSTASH_REDIS_REST_URL = '   \t\n '
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-test-token'
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_TOKEN = '   '

    expect(getUpstashCredentials()).toBeNull()
    expect(isSharedRateLimitConfigured()).toBe(false)
  })

  it('uses KV credentials in rateLimit() fetch calls when only KV pair is set', async () => {
    process.env.KV_REST_API_URL = 'https://kv.upstash.test'
    process.env.KV_REST_API_TOKEN = 'kv-test-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60000 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const req = createMockReq({
      headers: { 'x-real-ip': '198.51.100.2' },
    })
    const res = createMockRes()
    const blocked = await rateLimit(req, res, {
      bucket: 'test',
      limit: 5,
      windowSec: 60,
    })

    expect(blocked).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/kv\.upstash\.test/),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer kv-test-token',
        }),
      }),
    )
  })
})
