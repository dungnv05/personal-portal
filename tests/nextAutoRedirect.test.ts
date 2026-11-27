import { describe, expect, it } from 'vitest'
import {
  NEXT_REDIRECT_GUARD_KEY,
  NEXT_REDIRECT_GUARD_WINDOW_MS,
  clearNextRedirectGuard,
  decideNextAction,
  getInitialAuthModalOpen,
  recordNextRedirect,
} from '../src/utils/nextAutoRedirect'
import { resolveNextUrl } from '../src/utils/nextUrl'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

const PORTAL_ORIGIN = 'https://www.yundev.space'
const VALID_NEXT =
  'https://brse.yundev.space/courses/lesson?course=a2-1-youken-teigi&lesson=1&tab=assignment'
const VALID_SEARCH = `?next=${encodeURIComponent(VALID_NEXT)}`

describe('getInitialAuthModalOpen', () => {
  it('returns false when next param is present even with auth=signin', () => {
    expect(getInitialAuthModalOpen(VALID_SEARCH)).toBe(false)
    expect(getInitialAuthModalOpen(`${VALID_SEARCH}&auth=signin`)).toBe(false)
    expect(getInitialAuthModalOpen(`${VALID_SEARCH}&auth=signup`)).toBe(false)
  })

  it('returns true for auth=signin or auth=signup without next param', () => {
    expect(getInitialAuthModalOpen('?auth=signin')).toBe(true)
    expect(getInitialAuthModalOpen('?auth=signup')).toBe(true)
    expect(getInitialAuthModalOpen('')).toBe(false)
  })
})

describe('decideNextAction', () => {
  it('(a) redirects signed-in user with valid next and (b) blocks repeat within 60s', () => {
    const storage = createMemoryStorage()
    const expectedUrl = resolveNextUrl(VALID_SEARCH)
    expect(expectedUrl).toBe(VALID_NEXT)

    const now = 1_700_000_000_000
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now,
      }),
    ).toEqual({ kind: 'redirect', url: VALID_NEXT })

    expect(recordNextRedirect(storage, VALID_NEXT, now)).toBe(true)

    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: now + NEXT_REDIRECT_GUARD_WINDOW_MS - 1,
      }),
    ).toEqual({ kind: 'blocked', url: VALID_NEXT })

    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: now + NEXT_REDIRECT_GUARD_WINDOW_MS,
      }),
    ).toEqual({ kind: 'redirect', url: VALID_NEXT })

    const otherNext = 'https://tinh-luong.yundev.space/'
    expect(
      decideNextAction({
        search: `?next=${encodeURIComponent(otherNext)}`,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: now + 1_000,
      }),
    ).toEqual({ kind: 'redirect', url: otherNext })
  })

  it('(c) opens sign-in when auth is resolved and user is signed out', () => {
    const storage = createMemoryStorage()
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: false,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ kind: 'open-signin' })
  })

  it('(d) waits while authResolved is false regardless of signedIn', () => {
    const storage = createMemoryStorage()
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: false,
        signedIn: false,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ kind: 'wait' })

    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: false,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ kind: 'wait' })
  })

  it('(e) never redirects for unsafe, invalid, or same-origin next URLs', () => {
    const storage = createMemoryStorage()
    const rejectedTargets = [
      'https://evil.com/',
      'http://brse.yundev.space/',
      '//evil.com/',
      'https://user:pass@brse.yundev.space/',
      'https://brse.yundev.space:8443/',
      'https://brse.yundev.space/\u0000',
      'javascript:alert(1)',
      'https://yundev.space.evil.com/',
      'https://www.yundev.space/x',
    ]

    for (const target of rejectedTargets) {
      const action = decideNextAction({
        search: `?next=${encodeURIComponent(target)}`,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now: 1_700_000_000_000,
      })
      expect(action.kind).not.toBe('redirect')
      expect(action).toEqual({ kind: 'none' })
    }
  })

  it('blocks when storage is null or getItem throws', () => {
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage: null,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ kind: 'blocked', url: VALID_NEXT })

    const throwingStorage: Pick<Storage, 'getItem'> = {
      getItem() {
        throw new Error('storage disabled')
      },
    }

    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage: throwingStorage,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ kind: 'blocked', url: VALID_NEXT })
  })

  it('allows redirect when stored guard JSON is corrupt or timestamp is in the future', () => {
    const storage = createMemoryStorage()
    const now = 1_700_000_000_000

    storage.setItem(NEXT_REDIRECT_GUARD_KEY, '{not-valid-json')
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now,
      }),
    ).toEqual({ kind: 'redirect', url: VALID_NEXT })

    storage.setItem(
      NEXT_REDIRECT_GUARD_KEY,
      JSON.stringify({ url: VALID_NEXT, at: now + 5_000 }),
    )
    expect(
      decideNextAction({
        search: VALID_SEARCH,
        authResolved: true,
        signedIn: true,
        currentOrigin: PORTAL_ORIGIN,
        storage,
        now,
      }),
    ).toEqual({ kind: 'redirect', url: VALID_NEXT })
  })
})

describe('recordNextRedirect & clearNextRedirectGuard', () => {
  it('returns false when storage is null or setItem throws', () => {
    expect(recordNextRedirect(null, VALID_NEXT, 1_700_000_000_000)).toBe(false)

    const throwingStorage: Pick<Storage, 'setItem'> = {
      setItem() {
        throw new Error('quota exceeded')
      },
    }
    expect(recordNextRedirect(throwingStorage, VALID_NEXT, 1_700_000_000_000)).toBe(false)
  })

  it('swallows exceptions in clearNextRedirectGuard', () => {
    const throwingStorage: Pick<Storage, 'removeItem'> = {
      removeItem() {
        throw new Error('storage blocked')
      },
    }
    expect(() => clearNextRedirectGuard(throwingStorage)).not.toThrow()
    expect(() => clearNextRedirectGuard(null)).not.toThrow()
  })
})
