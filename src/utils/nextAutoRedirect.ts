import { hasNextParam } from './nextParam'
import { resolveNextUrl } from './nextUrl'

export const NEXT_REDIRECT_GUARD_KEY = 'yundev.nextAutoRedirect.v1'
export const NEXT_REDIRECT_GUARD_WINDOW_MS = 60_000

export type NextAction =
  | { kind: 'none' }
  | { kind: 'wait' }
  | { kind: 'open-signin' }
  | { kind: 'redirect'; url: string }
  | { kind: 'blocked'; url: string }

export type DecideNextActionInput = {
  search: string
  authResolved: boolean
  signedIn: boolean
  currentOrigin: string
  storage: Pick<Storage, 'getItem'> | null
  now: number
}

type RedirectGuardRecord = {
  url: string
  at: number
}

function parseGuardRecord(raw: string | null): RedirectGuardRecord | null {
  if (raw === null) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.url !== 'string' || typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
      return null
    }
    return {
      url: candidate.url,
      at: candidate.at,
    }
  } catch {
    return null
  }
}

export function getInitialAuthModalOpen(search: string): boolean {
  if (hasNextParam(search)) {
    return false
  }
  const authParam = new URLSearchParams(search).get('auth')
  return authParam === 'signin' || authParam === 'signup'
}

export function decideNextAction(input: DecideNextActionInput): NextAction {
  if (!hasNextParam(input.search)) {
    return { kind: 'none' }
  }
  if (!input.authResolved) {
    return { kind: 'wait' }
  }
  if (!input.signedIn) {
    return { kind: 'open-signin' }
  }

  const safeUrl = resolveNextUrl(input.search)
  if (safeUrl === null) {
    return { kind: 'none' }
  }

  let targetOrigin: string
  try {
    targetOrigin = new URL(safeUrl).origin
  } catch {
    return { kind: 'none' }
  }

  if (targetOrigin === input.currentOrigin) {
    return { kind: 'none' }
  }

  if (input.storage === null) {
    return { kind: 'blocked', url: safeUrl }
  }

  let rawRecord: string | null
  try {
    rawRecord = input.storage.getItem(NEXT_REDIRECT_GUARD_KEY)
  } catch {
    return { kind: 'blocked', url: safeUrl }
  }

  const guardRecord = parseGuardRecord(rawRecord)
  if (
    guardRecord !== null &&
    guardRecord.url === safeUrl &&
    input.now - guardRecord.at >= 0 &&
    input.now - guardRecord.at < NEXT_REDIRECT_GUARD_WINDOW_MS
  ) {
    return { kind: 'blocked', url: safeUrl }
  }

  return { kind: 'redirect', url: safeUrl }
}

export function recordNextRedirect(
  storage: Pick<Storage, 'setItem'> | null,
  url: string,
  now: number,
): boolean {
  if (storage === null) {
    return false
  }
  try {
    storage.setItem(NEXT_REDIRECT_GUARD_KEY, JSON.stringify({ url, at: now }))
    return true
  } catch {
    return false
  }
}

export function clearNextRedirectGuard(storage: Pick<Storage, 'removeItem'> | null): void {
  if (storage === null) {
    return
  }
  try {
    storage.removeItem(NEXT_REDIRECT_GUARD_KEY)
  } catch {
    // Ignore storage errors when clearing the redirect guard.
  }
}

export function readSessionStorageSafe(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null
    }
    return window.sessionStorage
  } catch {
    return null
  }
}
