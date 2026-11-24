import { createClient, type User, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Utility for Wildcard Cookie Management & Supabase Client Config across *.yundev.space
 */

const COOKIE_DOMAIN =
  typeof window !== 'undefined' && window.location.hostname.includes('yundev.space') ? '.yundev.space' : ''

type CookieStorageAdapter = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type RuntimeConfigPayload = {
  supabaseUrl?: string
  supabaseAnonKey?: string
}

type SharedSessionPayload = {
  access_token?: string
  refresh_token?: string
}

export function setSharedCookie(name: string, value: string, days = 30): void {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  const domainAttr = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/${domainAttr}; SameSite=Lax; Secure`
}

export function getSharedCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  return document.cookie.split('; ').reduce((result, segment) => {
    const parts = segment.split('=')
    const cookieKey = parts[0]?.trim()
    const cookieValue = parts[1] ?? ''
    return cookieKey === name ? decodeURIComponent(cookieValue) : result
  }, '')
}

export function removeSharedCookie(name: string): void {
  const domainAttr = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ''
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainAttr}`
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

// Hybrid Shared Cookie Storage Adapter for Wildcard SSO (*.yundev.space)
export const cookieStorage: CookieStorageAdapter = {
  getItem: (key) => {
    if (typeof document === 'undefined') return null
    const cookieVal = getSharedCookie(key)
    if (cookieVal) return cookieVal
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null
  },
  setItem: (key, value) => {
    setSharedCookie(key, value)
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, value)
    }
  },
  removeItem: (key) => {
    removeSharedCookie(key)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(key)
    }
  },
}

const env = import.meta.env as Record<string, string | undefined>
const rawUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''
const rawKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''

const isDummyUrl =
  !rawUrl || rawUrl.includes('your-project') || rawUrl.includes('abcdefghijklmnopqrst')

export const SUPABASE_CONFIG = {
  url: isDummyUrl ? 'https://placeholder-supabase.supabase.co' : rawUrl,
  anonKey: isDummyUrl ? 'dummy-key' : rawKey,
}

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'yundev_supabase_auth_token',
      storage: cookieStorage,
    },
  })
}

// Initialize Supabase Client
export let supabase: SupabaseClient = createSupabaseClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
)

// If static build had placeholder URL, attempt dynamic runtime fetch from /api/config
if (isDummyUrl) {
  fetch('/api/config')
    .then((res) => res.json())
    .then((data: unknown) => {
      // /api/config response is runtime JS data; narrow unknown shape before property access.
      const runtimeConfig = data as RuntimeConfigPayload
      if (runtimeConfig.supabaseUrl && runtimeConfig.supabaseAnonKey) {
        SUPABASE_CONFIG.url = runtimeConfig.supabaseUrl
        SUPABASE_CONFIG.anonKey = runtimeConfig.supabaseAnonKey
        supabase = createSupabaseClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey)
      }
    })
    .catch(() => {})
}

// Auth Helpers
export async function signUpWithEmail(email: string, password: string) {
  return await supabase.auth.signUp({ email, password })
}

export async function signInWithEmail(email: string, password: string) {
  const res = await supabase.auth.signInWithPassword({ email, password })
  if (res.data?.session) {
    setSharedCookie('yundev_session', res.data.session.access_token)
    setSharedCookie('yundev_supabase_auth_token', JSON.stringify(res.data.session))
    if (typeof window !== 'undefined') {
      localStorage.setItem('yundev_session', res.data.session.access_token)
      localStorage.setItem('yundev_supabase_auth_token', JSON.stringify(res.data.session))
    }
  }
  return res
}

export async function signOutUser() {
  removeSharedCookie('yundev_session')
  removeSharedCookie('yundev_supabase_auth_token')
  if (typeof window !== 'undefined') {
    localStorage.removeItem('yundev_session')
    localStorage.removeItem('yundev_supabase_auth_token')
  }
  return await supabase.auth.signOut()
}

// Export helper function to synchronize wildcard session across yundev.space
export async function syncSharedSSOSession(): Promise<User | null> {
  if (typeof window === 'undefined') return null

  const sharedSessionCookie = getSharedCookie('yundev_supabase_auth_token')
  const sharedAccessToken = getSharedCookie('yundev_session')
  const {
    data: { session: currentSession },
  } = await supabase.auth.getSession()

  // 1. If yundev.space has NO shared session cookie, but local app has active session -> User logged out elsewhere!
  if (!sharedSessionCookie && !sharedAccessToken && currentSession) {
    console.log('[SSO Sync] Logout detected on shared domain. Signing out...')
    await signOutUser()
    return null
  }

  // 2. If yundev.space HAS a shared session cookie, but local app has no session or token differs -> Sync login!
  if (sharedSessionCookie) {
    try {
      // Cookie is raw JSON string from previous auth writes; narrow unknown payload before using tokens.
      const parsedSession = JSON.parse(sharedSessionCookie) as SharedSessionPayload
      if (parsedSession && parsedSession.access_token) {
        if (!currentSession || currentSession.access_token !== parsedSession.access_token) {
          console.log('[SSO Sync] New login detected on shared domain. Synchronizing session...')
          const { data, error } = await supabase.auth.setSession({
            access_token: parsedSession.access_token,
            refresh_token: parsedSession.refresh_token || '',
          })
          if (!error && data.session) {
            return data.session.user
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[SSO Sync Parsing Error]:', err)
    }
  }

  return currentSession?.user || null
}
