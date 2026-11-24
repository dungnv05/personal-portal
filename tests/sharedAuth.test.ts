import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js'

const STORAGE_KEY = 'yundev_supabase_auth_token'
const SESSION_COOKIE_KEY = 'yundev_session'

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void

type RecordedClientCall = {
  url: string
  anonKey: string
  options: {
    auth?: {
      persistSession?: boolean
      autoRefreshToken?: boolean
      detectSessionInUrl?: boolean
      storageKey?: string
      storage?: {
        getItem: (key: string) => string | null
        setItem: (key: string, value: string) => void
        removeItem: (key: string) => void
      }
    }
  }
}

type JsdomHandle = {
  reconfigure: (settings: { url: string }) => void
  cookieJar?: {
    removeAllCookiesSync?: () => void
  }
}

const mockState = vi.hoisted(() => {
  const listeners = new Set<AuthListener>()
  const clientCalls: RecordedClientCall[] = []
  let activeSession: Session | null = null

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

  const notifyListeners = (event: AuthChangeEvent, session: Session | null): void => {
    for (const listener of listeners) {
      listener(event, session)
    }
  }

  const createClientMock = vi.fn(
    (url: string, anonKey: string, options?: RecordedClientCall['options']) => {
      clientCalls.push({ url, anonKey, options: options ?? {} })

      const auth = {
        signUp: vi.fn(async ({ email }: { email: string; password: string }) => {
          const user = createMockUser(email)
          return { data: { user, session: null }, error: null }
        }),
        signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
          const session = createMockSession(email, `access-${email}`, `refresh-${email}`)
          activeSession = session
          notifyListeners('SIGNED_IN', session)
          return { data: { user: session.user, session }, error: null }
        }),
        signOut: vi.fn(async () => {
          activeSession = null
          notifyListeners('SIGNED_OUT', null)
          return { error: null }
        }),
        getSession: vi.fn(async () => ({
          data: { session: activeSession },
          error: null,
        })),
        setSession: vi.fn(
          async ({
            access_token,
            refresh_token,
          }: {
            access_token: string
            refresh_token: string
          }) => {
            const session = createMockSession('synced@yundev.space', access_token, refresh_token)
            activeSession = session
            notifyListeners('SIGNED_IN', session)
            return { data: { user: session.user, session }, error: null }
          },
        ),
        onAuthStateChange: vi.fn((callback: AuthListener) => {
          listeners.add(callback)
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(() => {
                  listeners.delete(callback)
                }),
              },
            },
          }
        }),
      }

      return { auth } as unknown as SupabaseClient
    },
  )

  const reset = (): void => {
    listeners.clear()
    clientCalls.length = 0
    activeSession = null
    createClientMock.mockClear()
  }

  return {
    createClientMock,
    clientCalls,
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

async function loadSharedAuth() {
  vi.resetModules()
  return import('../src/utils/sharedAuth')
}

describe('sharedAuth', () => {
  beforeEach(() => {
    setTestUrl('https://portal.yundev.space/')
    clearBrowserStorage()
    mockState.reset()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
  })

  afterEach(() => {
    clearBrowserStorage()
    vi.unstubAllGlobals()
    mockState.reset()
  })

  it('saves and reads back a token round-trip with the configured storage key', async () => {
    const auth = await loadSharedAuth()
    const clientCall = mockState.clientCalls[0]

    expect(clientCall?.options.auth?.storageKey).toBe(STORAGE_KEY)
    expect(clientCall?.options.auth?.storage).toBe(auth.cookieStorage)

    const tokenValue = JSON.stringify({
      access_token: 'roundtrip-access-token',
      refresh_token: 'roundtrip-refresh-token',
    })

    auth.cookieStorage.setItem(STORAGE_KEY, tokenValue)

    expect(auth.cookieStorage.getItem(STORAGE_KEY)).toBe(tokenValue)
    expect(auth.getSharedCookie(STORAGE_KEY)).toBe(tokenValue)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(tokenValue)
  })

  it('persists auth token and session keys on email sign-in', async () => {
    const auth = await loadSharedAuth()
    const response = await auth.signInWithEmail('yun@yundev.space', 'test-password')

    expect(response.data.session).not.toBeNull()
    const expectedSessionJson = JSON.stringify(response.data.session)
    const expectedAccessToken = response.data.session?.access_token ?? ''

    expect(auth.cookieStorage.getItem(STORAGE_KEY)).toBe(expectedSessionJson)
    expect(auth.cookieStorage.getItem(SESSION_COOKIE_KEY)).toBe(expectedAccessToken)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(expectedSessionJson)
    expect(localStorage.getItem(SESSION_COOKIE_KEY)).toBe(expectedAccessToken)
  })

  it('removes the auth token and related session keys on sign-out', async () => {
    const auth = await loadSharedAuth()
    await auth.signInWithEmail('yun@yundev.space', 'test-password')

    expect(auth.cookieStorage.getItem(STORAGE_KEY)).not.toBeNull()
    expect(auth.cookieStorage.getItem(SESSION_COOKIE_KEY)).not.toBeNull()

    await auth.signOutUser()

    expect(auth.cookieStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(auth.cookieStorage.getItem(SESSION_COOKIE_KEY)).toBeNull()
    expect(auth.getSharedCookie(STORAGE_KEY)).toBe('')
    expect(auth.getSharedCookie(SESSION_COOKIE_KEY)).toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_COOKIE_KEY)).toBeNull()
  })

  it('fires auth subscription callbacks on save and clear, then unsubscribes cleanly', async () => {
    const auth = await loadSharedAuth()
    const receivedEvents: Array<{ event: AuthChangeEvent; hasSession: boolean }> = []

    const {
      data: { subscription },
    } = auth.supabase.auth.onAuthStateChange((event, session) => {
      receivedEvents.push({ event, hasSession: session !== null })
    })

    await auth.signInWithEmail('yun@yundev.space', 'test-password')
    await auth.signOutUser()

    expect(receivedEvents).toEqual([
      { event: 'SIGNED_IN', hasSession: true },
      { event: 'SIGNED_OUT', hasSession: false },
    ])

    subscription.unsubscribe()

    await auth.signInWithEmail('yun@yundev.space', 'test-password')
    await auth.signOutUser()

    expect(receivedEvents).toHaveLength(2)
  })

  it('returns null or empty without throwing when no token is present', async () => {
    const auth = await loadSharedAuth()

    expect(() => auth.cookieStorage.getItem(STORAGE_KEY)).not.toThrow()
    expect(auth.cookieStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(auth.cookieStorage.getItem(SESSION_COOKIE_KEY)).toBeNull()
    expect(auth.getSharedCookie(STORAGE_KEY)).toBe('')
    await expect(auth.syncSharedSSOSession()).resolves.toBeNull()
  })

  it('uses the same storage key and shares the cookie across yundev.space subdomains', async () => {
    setTestUrl('https://portal.yundev.space/')
    const portalAuth = await loadSharedAuth()
    const portalStorageKey = mockState.clientCalls[mockState.clientCalls.length - 1]?.options.auth?.storageKey

    const sharedPayload = JSON.stringify({
      access_token: 'cross-subdomain-access-token',
      refresh_token: 'cross-subdomain-refresh-token',
    })
    portalAuth.cookieStorage.setItem(STORAGE_KEY, sharedPayload)

    // Subdomains do not share localStorage; only the wildcard cookie carries the token.
    localStorage.clear()

    setTestUrl('https://brse.yundev.space/')
    const brseAuth = await loadSharedAuth()
    const brseStorageKey = mockState.clientCalls[mockState.clientCalls.length - 1]?.options.auth?.storageKey

    expect(portalStorageKey).toBe(STORAGE_KEY)
    expect(brseStorageKey).toBe(portalStorageKey)
    expect(brseAuth.getSharedCookie(STORAGE_KEY)).toBe(sharedPayload)
    expect(brseAuth.cookieStorage.getItem(STORAGE_KEY)).toBe(sharedPayload)

    const syncedUser = await brseAuth.syncSharedSSOSession()
    expect(syncedUser).not.toBeNull()
  })
})
