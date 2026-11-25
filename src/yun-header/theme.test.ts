import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetThemeInitForTests,
  applyTheme,
  buildThemeCookie,
  initTheme,
  readStoredTheme,
  resolveTheme,
  setTheme,
  systemTheme,
  THEME_COOKIE,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  type YunThemeChangeDetail,
} from './theme'

function clearThemeCookie(): void {
  document.cookie = `${THEME_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

describe('theme module', () => {
  beforeEach(() => {
    __resetThemeInitForTests()
    clearThemeCookie()
    window.localStorage.removeItem(THEME_STORAGE_KEY)
    window.localStorage.removeItem('theme')
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    clearThemeCookie()
  })

  it('prefers yun_theme cookie over localStorage yun-theme and legacy theme', () => {
    window.localStorage.setItem('theme', 'light')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    document.cookie = `${THEME_COOKIE}=dark; path=/`

    expect(readStoredTheme()).toBe('dark')
  })

  it('prefers localStorage yun-theme over legacy theme key', () => {
    window.localStorage.setItem('theme', 'dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')

    expect(readStoredTheme()).toBe('light')
  })

  it('honors legacy theme key when yun_theme cookie and yun-theme are absent', () => {
    window.localStorage.setItem('theme', 'dark')

    expect(readStoredTheme()).toBe('dark')
  })

  it('ignores invalid theme values in cookie and localStorage', () => {
    document.cookie = `${THEME_COOKIE}=purple; path=/`
    window.localStorage.setItem(THEME_STORAGE_KEY, 'auto')
    window.localStorage.setItem('theme', 'sepia')

    expect(readStoredTheme()).toBeNull()
  })

  it('falls back to systemTheme when no stored theme exists', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    expect(systemTheme()).toBe('dark')
    expect(resolveTheme()).toBe('dark')
  })

  it('defaults systemTheme to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(systemTheme()).toBe('light')
    expect(resolveTheme()).toBe('light')
  })

  it('buildThemeCookie includes Domain=.yundev.space only for yundev.space hosts and Secure only for https', () => {
    expect(buildThemeCookie('dark', 'www.yundev.space', 'https:')).toBe(
      'yun_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.yundev.space',
    )
    expect(buildThemeCookie('light', 'yundev.space', 'https:')).toBe(
      'yun_theme=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.yundev.space',
    )
    expect(buildThemeCookie('dark', 'tinh-luong.yundev.space', 'https:')).toBe(
      'yun_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.yundev.space',
    )
    expect(buildThemeCookie('dark', 'preview-123.vercel.app', 'https:')).toBe(
      'yun_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    )
    expect(buildThemeCookie('light', 'evil-yundev.space', 'https:')).toBe(
      'yun_theme=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    )
    expect(buildThemeCookie('dark', 'localhost', 'http:')).toBe(
      'yun_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax',
    )
  })

  it('setTheme writes localStorage and cookie, sets data-theme + colorScheme, and dispatches yh-theme-change', () => {
    const events: YunThemeChangeDetail[] = []
    const onTheme = (e: Event) => {
      events.push((e as CustomEvent<YunThemeChangeDetail>).detail)
    }
    document.addEventListener(THEME_EVENT, onTheme)

    setTheme('dark')

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(events).toEqual([{ theme: 'dark', source: 'user' }])

    // Calling setTheme with same value does not re-dispatch
    setTheme('dark')
    expect(events).toHaveLength(1)

    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(events).toEqual([
      { theme: 'dark', source: 'user' },
      { theme: 'light', source: 'user' },
    ])

    document.removeEventListener(THEME_EVENT, onTheme)
  })

  it('applyTheme dispatches event on source=init even when dataset.theme already matches', () => {
    document.documentElement.dataset.theme = 'dark'
    const events: YunThemeChangeDetail[] = []
    const onTheme = (e: Event) => {
      events.push((e as CustomEvent<YunThemeChangeDetail>).detail)
    }
    document.addEventListener(THEME_EVENT, onTheme)

    applyTheme('dark', 'init')
    expect(events).toEqual([{ theme: 'dark', source: 'init' }])

    document.removeEventListener(THEME_EVENT, onTheme)
  })

  it('does not throw when localStorage throws SecurityError', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    expect(() => readStoredTheme()).not.toThrow()
    expect(() => setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('initTheme applies resolved theme and syncs on storage and visibilitychange', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    const events: YunThemeChangeDetail[] = []
    const onTheme = (e: Event) => {
      events.push((e as CustomEvent<YunThemeChangeDetail>).detail)
    }
    document.addEventListener(THEME_EVENT, onTheme)

    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(events).toEqual([{ theme: 'light', source: 'init' }])

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: THEME_STORAGE_KEY,
        newValue: 'dark',
      }),
    )
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(events).toEqual([
      { theme: 'light', source: 'init' },
      { theme: 'dark', source: 'sync' },
    ])

    document.cookie = `${THEME_COOKIE}=light; path=/`
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(events).toEqual([
      { theme: 'light', source: 'init' },
      { theme: 'dark', source: 'sync' },
      { theme: 'light', source: 'sync' },
    ])

    document.removeEventListener(THEME_EVENT, onTheme)
  })
})
