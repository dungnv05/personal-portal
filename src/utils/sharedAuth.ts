import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared authentication client for *.yundev.space backed by HttpOnly cookies.
 *
 * Session state is owned by /api/auth/* (HttpOnly sb_access/sb_refresh cookies
 * plus JS-readable csrf cookie on Domain=.yundev.space). No access or refresh
 * tokens are persisted in localStorage or JS-writable cookies.
 */

export type SessionUser = {
  id: string
  email: string | null
  display_name?: string | null
  avatar_url?: string | null
}

export type SignInResult = {
  data: {
    user: SessionUser | null
  }
  error: Error | null
}

export type LogoutResult = {
  error: Error | null
}

export const LEGACY_STORAGE_KEYS = [
  'yundev_session',
  'yundev_supabase_auth_token',
] as const

const CSRF_COOKIE_NAME = 'csrf'

const env = import.meta.env as Record<string, string | undefined>
const rawUrl = env.VITE_SUPABASE_URL || ''
const rawKey = env.VITE_SUPABASE_ANON_KEY || ''

const isDummyUrl =
  !rawUrl || rawUrl.includes('your-project') || rawUrl.includes('abcdefghijklmnopqrst')

export const SUPABASE_CONFIG = {
  url: isDummyUrl ? 'https://placeholder-supabase.supabase.co' : rawUrl,
  anonKey: isDummyUrl ? 'dummy-key' : rawKey,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value
  }
  if (isRecord(value) && typeof value.message === 'string' && value.message.length > 0) {
    return new Error(value.message)
  }
  return new Error(fallbackMessage)
}

function extractSessionUser(payload: unknown): SessionUser | null {
  if (!isRecord(payload) || payload.ok === false) {
    return null
  }
  const candidate = payload.user
  if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return null
  }
  const email = typeof candidate.email === 'string' ? candidate.email : null
  const displayName = typeof candidate.display_name === 'string' ? candidate.display_name : null
  const avatarUrl = typeof candidate.avatar_url === 'string' ? candidate.avatar_url : null
  return {
    id: candidate.id,
    email,
    display_name: displayName,
    avatar_url: avatarUrl,
  }
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error
    }
  } catch {
    // Ignore non-JSON error responses.
  }
  return null
}

function readCookie(name: string): string {
  if (typeof document === 'undefined' || !document.cookie) {
    return ''
  }
  let matched = ''
  for (const segment of document.cookie.split(';')) {
    const eqIndex = segment.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const cookieKey = segment.slice(0, eqIndex).trim()
    if (cookieKey !== name) {
      continue
    }
    const rawValue = segment.slice(eqIndex + 1).trim()
    try {
      matched = decodeURIComponent(rawValue)
    } catch {
      matched = rawValue
    }
  }
  return matched
}

function getCookieDomain(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const host = window.location.hostname.toLowerCase()
  const isPortalDomain = host === 'yundev.space' || host.endsWith('.yundev.space')
  return isPortalDomain ? '.yundev.space' : ''
}

function expireLegacyCookie(name: string): void {
  if (typeof document === 'undefined') {
    return
  }
  const domain = getCookieDomain()
  if (domain) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; Domain=${domain}`
  }
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

export function getCsrfToken(): string {
  return readCookie(CSRF_COOKIE_NAME)
}

export function clearLegacyAuthStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      for (const key of LEGACY_STORAGE_KEYS) {
        window.localStorage.removeItem(key)
      }
    } catch {
      // Ignore storage errors in restricted browsing modes.
    }
  }
  for (const key of LEGACY_STORAGE_KEYS) {
    expireLegacyCookie(key)
  }
}

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

// Initialize Supabase client without localStorage token persistence.
export let supabase: SupabaseClient = createSupabaseClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey,
)

// If static build had placeholder URL, attempt dynamic runtime fetch from /api/config.
if (isDummyUrl && typeof fetch === 'function') {
  fetch('/api/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((data: unknown) => {
      if (
        isRecord(data) &&
        typeof data.supabaseUrl === 'string' &&
        data.supabaseUrl.length > 0 &&
        typeof data.supabaseAnonKey === 'string' &&
        data.supabaseAnonKey.length > 0
      ) {
        SUPABASE_CONFIG.url = data.supabaseUrl
        SUPABASE_CONFIG.anonKey = data.supabaseAnonKey
        supabase = createSupabaseClient(data.supabaseUrl, data.supabaseAnonKey)
      }
    })
    .catch(() => {})
}

// Auth helpers
export async function signUpWithEmail(
  email: string,
  password: string,
  captchaToken?: string | null,
): ReturnType<SupabaseClient['auth']['signUp']> {
  const credentials = captchaToken
    ? { email, password, options: { captchaToken } }
    : { email, password }
  return await supabase.auth.signUp(credentials)
}

export async function signInWithEmail(
  email: string,
  password: string,
  captchaToken?: string | null,
): Promise<SignInResult> {
  const credentials = captchaToken
    ? { email, password, options: { captchaToken } }
    : { email, password }
  const res = await supabase.auth.signInWithPassword(credentials)
  if (res.error) {
    return {
      data: { user: null },
      error: toError(res.error, 'Sign-in failed.'),
    }
  }

  const session = res.data?.session
  if (!session?.access_token || !session.refresh_token) {
    await supabase.auth.signOut().catch(() => {})
    return {
      data: { user: null },
      error: new Error('Sign-in did not return a valid session.'),
    }
  }

  let response: Response
  try {
    response = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    })
  } catch (err: unknown) {
    await supabase.auth.signOut().catch(() => {})
    const reason = err instanceof Error ? err.message : 'Network error'
    return {
      data: { user: null },
      error: new Error(`Failed to establish auth session: ${reason}`),
    }
  }

  if (response.status !== 200) {
    await supabase.auth.signOut().catch(() => {})
    const errorCode = await readErrorCode(response)
    const message = errorCode
      ? `Failed to establish auth session (${response.status}: ${errorCode}).`
      : `Failed to establish auth session (${response.status}).`
    return {
      data: { user: null },
      error: new Error(message),
    }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (isRecord(payload) && payload.ok === false) {
    await supabase.auth.signOut().catch(() => {})
    const errorCode =
      typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : 'session_error'
    return {
      data: { user: null },
      error: new Error(`Failed to establish auth session (${errorCode}).`),
    }
  }

  const user = extractSessionUser(payload) ?? {
    id: session.user.id,
    email: session.user.email ?? null,
  }

  clearLegacyAuthStorage()

  return {
    data: { user },
    error: null,
  }
}

let refreshInFlight: Promise<boolean> | null = null

async function tryRefreshSession(): Promise<boolean> {
  if (typeof fetch !== 'function') {
    return false
  }
  const csrfToken = getCsrfToken()
  if (!csrfToken) {
    return false
  }
  if (refreshInFlight) {
    return refreshInFlight
  }

  refreshInFlight = (async () => {
    try {
      const freshCsrf = getCsrfToken()
      if (!freshCsrf) {
        return false
      }
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': freshCsrf,
        },
      })
      return response.status === 200
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function fetchMe(): Promise<Response | null> {
  try {
    return await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    })
  } catch {
    return null
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (typeof fetch !== 'function') {
    return null
  }

  let response = await fetchMe()
  if (!response) {
    return null
  }

  if (response.status === 401 && getCsrfToken()) {
    const refreshed = await tryRefreshSession()
    if (!refreshed) {
      return null
    }
    response = await fetchMe()
    if (!response) {
      return null
    }
  }

  if (response.status !== 200) {
    return null
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }

  return extractSessionUser(payload)
}

export type UpdateProfileResult = {
  user: SessionUser | null
  error: Error | null
}

async function postProfileDisplayName(name: string): Promise<Response> {
  const csrfToken = getCsrfToken()
  return fetch('/api/auth/profile', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ display_name: name }),
  })
}

export async function updateDisplayName(name: string): Promise<UpdateProfileResult> {
  if (typeof fetch !== 'function') {
    return { user: null, error: new Error('Fetch unavailable.') }
  }

  let response: Response
  try {
    response = await postProfileDisplayName(name)
  } catch (err: unknown) {
    return {
      user: null,
      error: toError(err, 'Failed to update profile.'),
    }
  }

  if (response.status === 401 && getCsrfToken()) {
    const refreshed = await tryRefreshSession()
    if (refreshed) {
      try {
        response = await postProfileDisplayName(name)
      } catch (err: unknown) {
        return {
          user: null,
          error: toError(err, 'Failed to update profile.'),
        }
      }
    }
  }

  if (response.status !== 200) {
    const errorCode = await readErrorCode(response)
    const message = errorCode
      ? `Failed to update profile (${response.status}: ${errorCode}).`
      : `Failed to update profile (${response.status}).`
    return {
      user: null,
      error: new Error(message),
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      user: null,
      error: new Error('Invalid profile response.'),
    }
  }

  const user = extractSessionUser(payload)
  if (!user) {
    return {
      user: null,
      error: new Error('Invalid profile response.'),
    }
  }

  return { user, error: null }
}

export async function logout(): Promise<LogoutResult> {
  let logoutError: Error | null = null
  const csrfToken = getCsrfToken()

  if (typeof fetch === 'function') {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrfToken,
        },
      })
      if (response.status !== 200) {
        const errorCode = await readErrorCode(response)
        const message = errorCode
          ? `Failed to clear auth session (${response.status}: ${errorCode}).`
          : `Failed to clear auth session (${response.status}).`
        logoutError = new Error(message)
      }
    } catch (err: unknown) {
      logoutError = toError(err, 'Failed to clear auth session.')
    }
  }

  try {
    const signOutRes = await supabase.auth.signOut()
    if (signOutRes?.error && !logoutError) {
      logoutError = toError(signOutRes.error, 'Local sign-out failed.')
    }
  } catch (err: unknown) {
    if (!logoutError) {
      logoutError = toError(err, 'Local sign-out failed.')
    }
  }

  clearLegacyAuthStorage()

  return { error: logoutError }
}

/** Backwards-compatible alias for logout(). */
export async function signOutUser(): Promise<LogoutResult> {
  return logout()
}

/** Backwards-compatible alias for getSessionUser(). */
export async function syncSharedSSOSession(): Promise<SessionUser | null> {
  return getSessionUser()
}
