import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'

const LEGACY_SESSION_KEY = 'yundev_session'
const LEGACY_TOKEN_KEY = 'yundev_supabase_auth_token'

type RecordedClientCall = {
  url: string
  anonKey: string
  options: {
    auth?: {
      persistSession?: boolean
      autoRefreshToken?: boolean
      detectSessionInUrl?: boolean
      storageKey?: string
      storage?: unknown
    }
  }
}

type JsdomHandle = {
  reconfigure: (settings: { url: string }) => void
  cookieJar?: {
    removeAllCookiesSync?: () => void
  }
}

type AuthCredentialsArg = {
  email: string
  password: string
  options?: {
    captchaToken?: string
  }
}

const mockState = vi.hoisted(() => {
  const clientCalls: RecordedClientCall[] = []
  let nextSignInError: Error | null = null

  const createMockUser = (email: string): User => ({
    id: 'user-123',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
    email,
  })

  const createMockSession = (email: string, accessToken: string, refreshToken: string): Session => ({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    token_type: 'bearer',
    user: createMockUser(email),
  })

  const signUp = vi.fn(async ({ email }: AuthCredentialsArg) => {
    const user = createMockUser(email)
    return { data: { user, session: null }, error: null }
  })

  const signInWithPassword = vi.fn(async ({ email }: AuthCredentialsArg) => {
    if (nextSignInError) {
      const error = nextSignInError
      nextSignInError = null
      return { data: { user: null, session: null }, error }
    }
    const session = createMockSession(email, `access-token-${email}`, `refresh-token-${email}`)
    return { data: { user: session.user, session }, error: null }
  })

  const signOut = vi.fn(async () => ({ error: null }))
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }))
  const setSession = vi.fn(async () => ({ data: { user: null, session: null }, error: null }))

  const createClientMock = vi.fn(
    (url: string, anonKey: string, options?: RecordedClientCall['options']) => {
      clientCalls.push({ url, anonKey, options: options ?? {} })
      return {
        auth: {
          signUp,
          signInWithPassword,
          signOut,
          getSession,
          setSession,
        },
      } as unknown as SupabaseClient
    },
  )

  const setNextSignInError = (error: Error | null): void => {
    nextSignInError = error
  }

  const reset = (): void => {
    clientCalls.length = 0
    nextSignInError = null
    createClientMock.mockClear()
    signUp.mockClear()
    signInWithPassword.mockClear()
    signOut.mockClear()
    getSession.mockClear()
    setSession.mockClear()
  }

  return {
    createClientMock,
    clientCalls,
    signUp,
    signInWithPassword,
    signOut,
    getSession,
    setSession,
    setNextSignInError,
    reset,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockState.createClientMock,
}))

function getJsdom(): JsdomHandle {
  const dom = (globalThis as { jsdom?: JsdomHandle }).jsdom
  if (!dom) {
    throw new Error('Expected Vitest jsdom instance on globalThis.jsdom')
  }
  return dom
}

function setTestUrl(url: string): void {
  getJsdom().reconfigure({ url })
}

function clearBrowserStorage(): void {
  getJsdom().cookieJar?.removeAllCookiesSync?.()
  localStorage.clear()
}

function getStorageSpyTarget(): Storage {
  const proto = Object.getPrototypeOf(window.localStorage) as Storage | null
  if (proto && proto !== Object.prototype && typeof proto.setItem === 'function') {
    return proto
  }
  return window.localStorage
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

async function loadSharedAuth() {
  vi.resetModules()
  return import('../src/utils/sharedAuth')
}

describe('sharedAuth (HttpOnly cookie flow)', () => {
  beforeEach(() => {
    setTestUrl('https://portal.yundev.space/')
    clearBrowserStorage()
    mockState.reset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}, 200)),
    )
  })

  afterEach(() => {
    clearBrowserStorage()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockState.reset()
  })

  it('configures the Supabase client without localStorage session persistence', async () => {
    await loadSharedAuth()
    const clientCall = mockState.clientCalls[0]

    expect(clientCall).toBeDefined()
    expect(clientCall?.options.auth?.persistSession).toBe(false)
    expect(clientCall?.options.auth?.autoRefreshToken).toBe(false)
    expect(clientCall?.options.auth?.detectSessionInUrl).toBe(false)
    expect(clientCall?.options.auth?.storage).toBeUndefined()
    expect(clientCall?.options.auth?.storageKey).toBeUndefined()
  })

  it('POSTs access_token and refresh_token to /api/auth/session with credentials include on sign-in and writes no tokens to localStorage', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/session') {
        return jsonResponse(
          {
            ok: true,
            user: { id: 'user-123', email: 'yun@yundev.space' },
          },
          200,
        )
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const setItemSpy = vi.spyOn(getStorageSpyTarget(), 'setItem')
    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const result = await auth.signInWithEmail('yun@yundev.space', 'secret-password')

    expect(result.error).toBeNull()
    expect(result.data.user).toEqual({
      id: 'user-123',
      email: 'yun@yundev.space',
      display_name: null,
      avatar_url: null,
    })
    expect(mockState.signInWithPassword).toHaveBeenCalledWith({
      email: 'yun@yundev.space',
      password: 'secret-password',
    })

    const sessionCall = fetchMock.mock.calls.find(
      (call) => getRequestUrl(call[0]) === '/api/auth/session',
    )
    expect(sessionCall).toBeDefined()

    const requestInit = sessionCall?.[1]
    expect(requestInit?.method).toBe('POST')
    expect(requestInit?.credentials).toBe('include')
    expect(new Headers(requestInit?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(requestInit?.body ?? '{}'))).toEqual({
      access_token: 'access-token-yun@yundev.space',
      refresh_token: 'refresh-token-yun@yundev.space',
    })

    expect(mockState.setSession).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull()
  })

  it('forwards captchaToken in options for signInWithEmail and signUpWithEmail and omits options when falsy', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/session') {
        return jsonResponse(
          { ok: true, user: { id: 'user-123', email: 'yun@yundev.space' } },
          200,
        )
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const auth = await loadSharedAuth()

    await auth.signInWithEmail('yun@yundev.space', 'secret-password', 'cf-signin-token')
    expect(mockState.signInWithPassword).toHaveBeenLastCalledWith({
      email: 'yun@yundev.space',
      password: 'secret-password',
      options: { captchaToken: 'cf-signin-token' },
    })

    await auth.signInWithEmail('yun@yundev.space', 'secret-password', '')
    expect(mockState.signInWithPassword).toHaveBeenLastCalledWith({
      email: 'yun@yundev.space',
      password: 'secret-password',
    })

    await auth.signUpWithEmail('yun@yundev.space', 'secret-password', 'cf-signup-token')
    expect(mockState.signUp).toHaveBeenLastCalledWith({
      email: 'yun@yundev.space',
      password: 'secret-password',
      options: { captchaToken: 'cf-signup-token' },
    })

    await auth.signUpWithEmail('yun@yundev.space', 'secret-password', null)
    expect(mockState.signUp).toHaveBeenLastCalledWith({
      email: 'yun@yundev.space',
      password: 'secret-password',
    })
  })

  it('signs out locally and surfaces an error when /api/auth/session returns a non-200 status', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/session') {
        return jsonResponse({ ok: false, error: 'invalid_token' }, 401)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const setItemSpy = vi.spyOn(getStorageSpyTarget(), 'setItem')
    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const result = await auth.signInWithEmail('yun@yundev.space', 'secret-password')

    expect(result.data.user).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toContain('401')
    expect(result.error?.message).toContain('invalid_token')
    expect(mockState.signOut).toHaveBeenCalledTimes(1)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('returns an error without calling /api/auth/session when Supabase sign-in fails', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({}, 200),
    )
    vi.stubGlobal('fetch', fetchMock)

    mockState.setNextSignInError(new Error('Invalid login credentials'))
    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const result = await auth.signInWithEmail('yun@yundev.space', 'wrong-password')

    expect(result.data.user).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('Invalid login credentials')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('getSessionUser returns user on 200 from /api/auth/me without reading localStorage', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/me') {
        return jsonResponse(
          {
            ok: true,
            user: { id: 'user-99', email: 'cookie@yundev.space' },
          },
          200,
        )
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const getItemSpy = vi.spyOn(getStorageSpyTarget(), 'getItem')
    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const user = await auth.getSessionUser()

    expect(user).toEqual({
      id: 'user-99',
      email: 'cookie@yundev.space',
      display_name: null,
      avatar_url: null,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    })
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(mockState.getSession).not.toHaveBeenCalled()
  })

  it('getSessionUser returns null on 401 even if legacy tokens exist in localStorage', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/me') {
        return jsonResponse({ ok: false }, 401)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    localStorage.setItem(LEGACY_SESSION_KEY, 'stale-access-token')
    localStorage.setItem(
      LEGACY_TOKEN_KEY,
      JSON.stringify({ access_token: 'stale-access-token', refresh_token: 'stale-refresh-token' }),
    )

    const getItemSpy = vi.spyOn(getStorageSpyTarget(), 'getItem')
    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const user = await auth.getSessionUser()

    expect(user).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    })
    expect(getItemSpy).not.toHaveBeenCalled()
  })

  it('logout sends x-csrf-token matching the csrf cookie, calls supabase signOut, and clears legacy localStorage keys', async () => {
    const callOrder: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/logout') {
        callOrder.push('fetch:/api/auth/logout')
        return jsonResponse({ ok: true }, 200)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    mockState.signOut.mockImplementationOnce(async () => {
      callOrder.push('supabase.auth.signOut')
      return { error: null }
    })

    const csrfValue = '0123456789abcdef0123456789abcdef'
    document.cookie = 'theme=dark; path=/'
    document.cookie = `csrf=${csrfValue}; path=/`

    localStorage.setItem(LEGACY_SESSION_KEY, 'legacy-access-token')
    localStorage.setItem(
      LEGACY_TOKEN_KEY,
      JSON.stringify({ access_token: 'legacy-access-token', refresh_token: 'legacy-refresh-token' }),
    )
    localStorage.setItem('unrelated_ui_pref', 'compact')

    const auth = await loadSharedAuth()
    fetchMock.mockClear()

    const result = await auth.logout()

    expect(result.error).toBeNull()

    const logoutCall = fetchMock.mock.calls.find(
      (call) => getRequestUrl(call[0]) === '/api/auth/logout',
    )
    expect(logoutCall).toBeDefined()

    const requestInit = logoutCall?.[1]
    expect(requestInit?.method).toBe('POST')
    expect(requestInit?.credentials).toBe('include')
    expect(new Headers(requestInit?.headers).get('x-csrf-token')).toBe(csrfValue)

    expect(mockState.signOut).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['fetch:/api/auth/logout', 'supabase.auth.signOut'])

    expect(localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem('unrelated_ui_pref')).toBe('compact')
  })

  it('never writes any access or refresh token to localStorage across sign-in, session check, and logout', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/session') {
        document.cookie = 'csrf=lifecycle-csrf-token; path=/'
        return jsonResponse(
          { ok: true, user: { id: 'user-123', email: 'yun@yundev.space' } },
          200,
        )
      }
      if (url === '/api/auth/me') {
        return jsonResponse(
          { ok: true, user: { id: 'user-123', email: 'yun@yundev.space' } },
          200,
        )
      }
      if (url === '/api/auth/logout') {
        return jsonResponse({ ok: true }, 200)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const setItemSpy = vi.spyOn(getStorageSpyTarget(), 'setItem')
    const auth = await loadSharedAuth()

    const signInRes = await auth.signInWithEmail('yun@yundev.space', 'secret-password')
    expect(signInRes.error).toBeNull()

    const sessionUser = await auth.getSessionUser()
    expect(sessionUser).toEqual({
      id: 'user-123',
      email: 'yun@yundev.space',
      display_name: null,
      avatar_url: null,
    })

    const logoutRes = await auth.logout()
    expect(logoutRes.error).toBeNull()

    expect(setItemSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('getSessionUser refreshes once on 401 when csrf cookie exists (single-flight) and retries /api/auth/me', async () => {
    document.cookie = 'csrf=csrf-single-flight; path=/'
    let meCalls = 0
    let refreshCalls = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/me') {
        meCalls += 1
        if (meCalls <= 2) {
          return jsonResponse({ ok: false }, 401)
        }
        return jsonResponse(
          { ok: true, user: { id: 'user-sf', email: 'sf@yundev.space', display_name: 'SF' } },
          200,
        )
      }
      if (url === '/api/auth/refresh') {
        refreshCalls += 1
        return jsonResponse({ ok: true }, 200)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const auth = await loadSharedAuth()
    const [u1, u2] = await Promise.all([auth.getSessionUser(), auth.getSessionUser()])

    expect(refreshCalls).toBe(1)
    expect(u1).toEqual({
      id: 'user-sf',
      email: 'sf@yundev.space',
      display_name: 'SF',
      avatar_url: null,
    })
    expect(u2).toEqual(u1)
  })

  it('getSessionUser does not refresh without csrf cookie and returns null without loop when refresh fails', async () => {
    const auth = await loadSharedAuth()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/me') {
        return jsonResponse({ ok: false }, 401)
      }
      if (url === '/api/auth/refresh') {
        return jsonResponse({ ok: false, error: 'refresh_failed' }, 401)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    // No csrf cookie -> no refresh call
    expect(await auth.getSessionUser()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // With csrf cookie, refresh fails -> returns null, never loops
    fetchMock.mockClear()
    document.cookie = 'csrf=csrf-fail-tok; path=/'
    expect(await auth.getSessionUser()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('updateDisplayName sends x-csrf-token and JSON body, handles success and error', async () => {
    document.cookie = 'csrf=csrf-upd-tok; path=/'
    const auth = await loadSharedAuth()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-1', email: 'yun@yundev.space', display_name: 'Yun New' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'invalid_display_name' }, 400))
    vi.stubGlobal('fetch', fetchMock)

    const okRes = await auth.updateDisplayName('Yun New')
    expect(okRes.error).toBeNull()
    expect(okRes.user).toEqual({
      id: 'user-1',
      email: 'yun@yundev.space',
      display_name: 'Yun New',
      avatar_url: null,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/profile', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': 'csrf-upd-tok',
      },
      body: JSON.stringify({ display_name: 'Yun New' }),
    })

    const errRes = await auth.updateDisplayName('Bad')
    expect(errRes.user).toBeNull()
    expect(errRes.error?.message).toContain('400')
    expect(errRes.error?.message).toContain('invalid_display_name')
  })
})
