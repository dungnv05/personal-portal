import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRefreshCoordinatorForTests,
  sharedRefresh,
} from '../src/shared-auth/refreshCoordinator'

describe('sharedRefresh (refreshCoordinator)', () => {
  beforeEach(() => {
    __resetRefreshCoordinatorForTests()
  })

  afterEach(() => {
    __resetRefreshCoordinatorForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('coalesces three concurrent calls into a single fetch and resolves all to ok', async () => {
    let resolveFetch!: (res: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => pending)
    vi.stubGlobal('fetch', fetchMock)

    const p1 = sharedRefresh('/api/auth/refresh', () => 'csrf-1')
    const p2 = sharedRefresh('/api/auth/refresh', () => 'csrf-1')
    const p3 = sharedRefresh('/api/auth/refresh', () => 'csrf-1')

    expect(p2).toBe(p1)
    expect(p3).toBe(p1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-csrf-token': 'csrf-1',
      },
    })

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const outcomes = await Promise.all([p1, p2, p3])
    expect(outcomes).toEqual(['ok', 'ok', 'ok'])
  })

  it('resolves ok without fetching within 2 s after a successful refresh, then fetches again after 2 s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 25, 0, 0, 0))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-a')).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-a')).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-a')).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps 409 to retry, 401/500/network errors to failed, and empty CSRF to failed without fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'refresh_retry' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'refresh_failed' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'server_error' }), { status: 500 }))
      .mockRejectedValueOnce(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await sharedRefresh('/api/auth/refresh', () => '')).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()

    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-b')).toBe('retry')
    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-b')).toBe('failed')
    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-b')).toBe('failed')
    expect(await sharedRefresh('/api/auth/refresh', () => 'csrf-b')).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('shares in-flight promise across separately imported module copies via globalThis', async () => {
    let resolveFetch!: (res: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => pending)
    vi.stubGlobal('fetch', fetchMock)

    const p1 = sharedRefresh('/api/auth/refresh', () => 'csrf-cross')

    vi.resetModules()
    const mod2 = await import('../src/shared-auth/refreshCoordinator')
    expect(mod2.sharedRefresh).not.toBe(sharedRefresh)

    const p2 = mod2.sharedRefresh('/api/auth/refresh', () => 'csrf-cross')
    expect(p2).toBe(p1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    expect(await Promise.all([p1, p2])).toEqual(['ok', 'ok'])
  })
})
