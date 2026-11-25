import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineYunHeader, isAllowedAuthOrigin, YunHeader } from './index'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function abortablePendingFetch(): {
  fetchMock: ReturnType<typeof vi.fn>
  signals: AbortSignal[]
} {
  const signals: AbortSignal[] = []
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal
    if (signal) {
      signals.push(signal)
    }
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
  })
  return { fetchMock, signals }
}

describe('<yun-header>', () => {
  const originalLocation = window.location

  beforeAll(() => {
    defineYunHeader()
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    })
  })

  it('renders both sign-in and sign-up buttons when signed out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://www.yundev.space')
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(el.state).toBe('signed-out')
    expect(el.user).toBeNull()

    const shadow = el.shadowRoot!
    const buttons = Array.from(shadow.querySelectorAll('.yh-account-desktop button'))
    const labels = buttons.map((btn) => btn.textContent?.trim())
    expect(labels).toContain('Đăng nhập')
    expect(labels).toContain('Đăng ký')
  })

  it('renders initials and accessible name on 200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: {
          id: 'user-1',
          email: 'minh.nguyen@yundev.space',
          display_name: 'Minh Nguyen',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(el.state).toBe('signed-in')
    expect(el.user?.initials).toBe('MN')
    expect(el.user?.displayName).toBe('Minh Nguyen')

    const accountBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[part="account-button"]')
    expect(accountBtn).not.toBeNull()
    expect(accountBtn?.getAttribute('aria-label')).toBe('Tài khoản: Minh Nguyen')
    expect(accountBtn?.querySelector('.yh-avatar')?.textContent?.trim()).toBe('MN')
  })

  it('renders img when avatar_url is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: {
          id: 'user-2',
          email: 'avatar@yundev.space',
          user_metadata: {
            full_name: 'Avatar User',
            avatar_url: 'https://cdn.yundev.space/avatar.png',
          },
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const img = el.shadowRoot!.querySelector<HTMLImageElement>('[part="account-button"] .yh-avatar img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://cdn.yundev.space/avatar.png')
    expect(img?.getAttribute('alt')).toBe('')
  })

  it('shows expired notice on 401 after being signed in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-1', email: 'alice@yundev.space' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()
    expect(el.state).toBe('signed-in')

    await el.refresh()

    expect(el.state).toBe('expired')
    const notice = el.shadowRoot!.querySelector<HTMLElement>('.yh-expired-notice')
    expect(notice?.hidden).toBe(false)
    expect(notice?.textContent).toContain('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    expect(notice?.querySelector('button')?.textContent?.trim()).toBe('Đăng nhập lại')
  })

  it('shows error state on 500 and retries when clicking Thử lại', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, 500))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-3', email: 'retry@yundev.space' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(el.state).toBe('error')
    const desktop = el.shadowRoot!.querySelector('.yh-account-desktop')!
    expect(desktop.textContent).toContain('Không tải được tài khoản')

    const retryBtn = desktop.querySelector<HTMLButtonElement>('button[aria-label="Thử lại"]')
    expect(retryBtn).not.toBeNull()
    retryBtn?.click()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(el.state).toBe('signed-in')
  })

  it('dispatches cancelable yh-signin-click and navigates with auth=signin and encoded next', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        href: 'https://tinh-luong.yundev.space/calc?tab=gross',
        assign: assignMock,
      },
      configurable: true,
      writable: true,
    })

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://www.yundev.space')
    document.body.appendChild(el)
    await flushMicrotasks()

    const eventSpy = vi.fn()
    el.addEventListener('yh-signin-click', eventSpy)

    const signInBtn = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.yh-account-desktop button'))
      .find((b) => b.textContent?.trim() === 'Đăng nhập')!
    signInBtn.click()

    expect(eventSpy).toHaveBeenCalledTimes(1)
    const dispatched = eventSpy.mock.calls[0]?.[0] as CustomEvent
    expect(dispatched.cancelable).toBe(true)
    expect(assignMock).toHaveBeenCalledWith(
      `https://www.yundev.space/?auth=signin&next=${encodeURIComponent('https://tinh-luong.yundev.space/calc?tab=gross')}`,
    )
  })

  it('sends POST logout with x-csrf-token from cookie and dispatches yh-logout', async () => {
    document.cookie = 'csrf=csrf-token-123; path=/'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-4', email: 'logout@yundev.space' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://www.yundev.space')
    document.body.appendChild(el)
    await flushMicrotasks()

    const logoutSpy = vi.fn()
    el.addEventListener('yh-logout', logoutSpy)

    const accountBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[part="account-button"]')!
    accountBtn.click()

    const logoutBtn = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Đăng xuất'))!
    logoutBtn.click()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('https://www.yundev.space/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-csrf-token': 'csrf-token-123',
      },
    })
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(el.state).toBe('signed-out')
  })

  it('closes the account menu on Escape and returns focus to the account button', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: { id: 'user-5', email: 'esc@yundev.space' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const accountBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[part="account-button"]')!
    const focusSpy = vi.spyOn(accountBtn, 'focus')
    accountBtn.click()

    const menu = el.shadowRoot!.querySelector<HTMLElement>('[part="menu"]')!
    expect(menu.hidden).toBe(false)

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(menu.hidden).toBe(true)
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('transitions to signed-out after 3 s timeout when no user is signed in', async () => {
    vi.useFakeTimers()
    const { fetchMock } = abortablePendingFetch()
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    expect(el.state).toBe('loading')

    await vi.advanceTimersByTimeAsync(3100)
    expect(el.state).toBe('signed-out')
    expect(el.user).toBeNull()
  })

  it('handles overlapping refresh() calls without losing the 3 s timeout (M2)', async () => {
    vi.useFakeTimers()
    const { fetchMock } = abortablePendingFetch()
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    void el.refresh()

    await vi.advanceTimersByTimeAsync(3100)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(el.state).toBe('signed-out')
  })

  it('transitions to error on network rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(el.state).toBe('error')
    expect(el.user).toBeNull()
  })

  it('aborts in-flight fetch on disconnect and dispatches no state change', async () => {
    const { fetchMock, signals } = abortablePendingFetch()
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    const authChangeSpy = vi.fn()
    el.addEventListener('yh-auth-change', authChangeSpy)
    document.body.appendChild(el)

    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    el.remove()
    await flushMicrotasks()

    expect(signals[0]?.aborted).toBe(true)
    expect(el.state).toBe('loading')
    expect(authChangeSpy).not.toHaveBeenCalled()
  })

  it('does not navigate when yh-signin-click is cancelled with preventDefault', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        href: 'https://www.yundev.space/',
        assign: assignMock,
      },
      configurable: true,
      writable: true,
    })

    const el = document.createElement('yun-header') as YunHeader
    el.addEventListener('yh-signin-click', (event) => {
      event.preventDefault()
    })
    document.body.appendChild(el)
    await flushMicrotasks()

    const signInBtn = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.yh-account-desktop button'))
      .find((b) => b.textContent?.trim() === 'Đăng nhập')!
    signInBtn.click()

    expect(assignMock).not.toHaveBeenCalled()
  })

  it('keeps signed-in state, shows inline alert notice, and retries when logout returns 403', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-6', email: 'csrf@yundev.space' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'csrf_mismatch' }, 403))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const logoutSpy = vi.fn()
    el.addEventListener('yh-logout', logoutSpy)

    const accountBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[part="account-button"]')!
    accountBtn.click()

    const logoutBtn = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Đăng xuất'))!
    logoutBtn.click()
    await flushMicrotasks()

    expect(el.state).toBe('signed-in')
    expect(el.user?.id).toBe('user-6')
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(el.shadowRoot!.querySelector('.yh-sr-only')?.textContent).not.toContain('Đã đăng xuất')

    const notice = el.shadowRoot!.querySelector<HTMLElement>('.yh-logout-notice')!
    expect(notice.hidden).toBe(false)
    expect(notice.getAttribute('role')).toBe('alert')
    expect(notice.textContent).toContain('Đăng xuất không thành công, bạn vẫn đang đăng nhập.')

    const retryBtn = notice.querySelector<HTMLButtonElement>('button')!
    expect(retryBtn.textContent?.trim()).toBe('Thử lại')
    retryBtn.click()
    await flushMicrotasks()

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(el.state).toBe('signed-out')
    expect(notice.hidden).toBe(true)
  })

  it('keeps signed-in state and marks stale on timeout while already signed in', async () => {
    vi.useFakeTimers()
    const { fetchMock: pendingFetch } = abortablePendingFetch()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          user: { id: 'user-7', email: 'stale@yundev.space', display_name: 'Stale User' },
        }),
      )
      .mockImplementationOnce(pendingFetch as typeof fetch)
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await vi.advanceTimersByTimeAsync(0)

    expect(el.state).toBe('signed-in')
    expect(el.stale).toBe(false)

    const refreshPromise = el.refresh()
    await vi.advanceTimersByTimeAsync(3100)
    await refreshPromise

    expect(el.state).toBe('signed-in')
    expect(el.user?.id).toBe('user-7')
    expect(el.stale).toBe(true)
  })

  it('allowlists auth-base and profile-url and falls back to defaults for disallowed values', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse({
        ok: true,
        user: { id: 'user-8', email: 'allow@yundev.space' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://evil-yundev.space')
    el.setAttribute('profile-url', '//evil.com/phish')
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('https://www.yundev.space/api/auth/me', expect.any(Object))
    const profileLink = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'))
      .find((a) => a.textContent?.trim() === 'Hồ sơ')
    expect(profileLink?.getAttribute('href')).toBe('https://www.yundev.space/?view=profile')

    el.setAttribute('auth-base', 'http://localhost:5173/')
    el.setAttribute('profile-url', '/profile')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:5173/api/auth/me', expect.any(Object))
    const updatedProfileLink = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'))
      .find((a) => a.textContent?.trim() === 'Hồ sơ')
    expect(updatedProfileLink?.getAttribute('href')).toBe('/profile')

    el.setAttribute('auth-base', 'javascript:alert(1)')
    el.setAttribute('profile-url', 'https://yundev.space.evil.com/p')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenLastCalledWith('https://www.yundev.space/api/auth/me', expect.any(Object))
    const fallbackProfileLink = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'))
      .find((a) => a.textContent?.trim() === 'Hồ sơ')
    expect(fallbackProfileLink?.getAttribute('href')).toBe('https://www.yundev.space/?view=profile')
  })

  it('renders avatar img only for https URLs and falls back to initials otherwise', async () => {
    const disallowed = [
      'http://cdn.yundev.space/avatar.png',
      '//cdn.yundev.space/avatar.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '/avatar.png',
    ]

    for (const badUrl of disallowed) {
      document.body.innerHTML = ''
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          user: {
            id: 'user-avatar',
            display_name: 'Minh Nguyen',
            avatar_url: badUrl,
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const el = document.createElement('yun-header') as YunHeader
      document.body.appendChild(el)
      await flushMicrotasks()

      const avatar = el.shadowRoot!.querySelector('[part="account-button"] .yh-avatar')!
      expect(avatar.querySelector('img')).toBeNull()
      expect(avatar.textContent?.trim()).toBe('MN')
    }
  })

  it('rejects control chars, whitespace, and backslashes in profile-url and auth-base (SH-1)', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          user: { id: 'user-sh1', email: 'sh1@yundev.space' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const badProfileUrls = ['/\t/evil.com', '/\n/evil.com', '/\\evil.com', '\\\\evil.com', ' /x']
    const badAuthBases = [
      'https://www.yundev.space\t',
      'https://www.yundev.space\n',
      'https://www.yundev.space\\evil',
      '\\\\evil.com',
      ' https://www.yundev.space',
    ]

    for (let i = 0; i < badProfileUrls.length; i += 1) {
      document.body.innerHTML = ''
      fetchMock.mockClear()
      const el = document.createElement('yun-header') as YunHeader
      el.setAttribute('auth-base', badAuthBases[i]!)
      el.setAttribute('profile-url', badProfileUrls[i]!)
      document.body.appendChild(el)
      await flushMicrotasks()

      expect(fetchMock).toHaveBeenCalledWith('https://www.yundev.space/api/auth/me', expect.any(Object))
      const profileLink = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'))
        .find((a) => a.textContent?.trim() === 'Hồ sơ')
      expect(profileLink?.getAttribute('href')).toBe('https://www.yundev.space/?view=profile')
    }
  })

  it('gates localhost/127.0.0.1 behind allowLocalhost and rejects numeric or IPv6 variants (SH-2)', () => {
    expect(isAllowedAuthOrigin('http://localhost:5173', { allowLocalhost: false })).toBe(false)
    expect(isAllowedAuthOrigin('http://127.0.0.1:5173', { allowLocalhost: false })).toBe(false)
    expect(isAllowedAuthOrigin(new URL('http://localhost:5173'), { allowLocalhost: false })).toBe(false)

    expect(isAllowedAuthOrigin('http://localhost:5173', { allowLocalhost: true })).toBe(true)
    expect(isAllowedAuthOrigin('http://127.0.0.1:5173', { allowLocalhost: true })).toBe(true)
    expect(isAllowedAuthOrigin('https://www.yundev.space', { allowLocalhost: false })).toBe(true)

    expect(isAllowedAuthOrigin('http://0x7f.0.0.1', { allowLocalhost: true })).toBe(false)
    expect(isAllowedAuthOrigin('http://2130706433', { allowLocalhost: true })).toBe(false)
    expect(isAllowedAuthOrigin('http://127.1', { allowLocalhost: true })).toBe(false)
    expect(isAllowedAuthOrigin('http://[::1]', { allowLocalhost: true })).toBe(false)
  })

  it('rejects https URLs with explicit non-443 ports for auth-base and profile-url (NIT)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: { id: 'user-nit', email: 'nit@yundev.space' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://www.yundev.space:8443')
    el.setAttribute('profile-url', 'https://www.yundev.space:8443/profile')
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('https://www.yundev.space/api/auth/me', expect.any(Object))
    const profileLink = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'))
      .find((a) => a.textContent?.trim() === 'Hồ sơ')
    expect(profileLink?.getAttribute('href')).toBe('https://www.yundev.space/?view=profile')
    expect(isAllowedAuthOrigin('https://www.yundev.space:443', { allowLocalhost: false })).toBe(true)
    expect(isAllowedAuthOrigin('https://www.yundev.space:8443', { allowLocalhost: false })).toBe(false)
  })

  it('strips hash fragment and auth query param from next URL on sign-in/sign-up (SH-4)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        href: 'https://tinh-luong.yundev.space/calc?tab=gross&auth=signin#access_token=secret',
        assign: assignMock,
      },
      configurable: true,
      writable: true,
    })

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('auth-base', 'https://www.yundev.space')
    document.body.appendChild(el)
    await flushMicrotasks()

    const signUpBtn = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.yh-account-desktop button'))
      .find((b) => b.textContent?.trim() === 'Đăng ký')!
    signUpBtn.click()

    expect(assignMock).toHaveBeenCalledWith(
      `https://www.yundev.space/?auth=signup&next=${encodeURIComponent('https://tinh-luong.yundev.space/calc?tab=gross')}`,
    )
  })

  it('sets no-referrer and async decoding on avatar img and falls back to initials on error (SH-5)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: {
          id: 'user-avatar-err',
          display_name: 'Minh Nguyen',
          avatar_url: 'https://cdn.yundev.space/broken.png',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const avatar = el.shadowRoot!.querySelector('[part="account-button"] .yh-avatar')!
    const img = avatar.querySelector('img')!
    expect(img).not.toBeNull()
    expect(img.referrerPolicy).toBe('no-referrer')
    expect(img.decoding).toBe('async')

    img.dispatchEvent(new Event('error'))
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar.textContent?.trim()).toBe('MN')
  })

  it('validates skip-target against /^#[A-Za-z][\\w-]*$/ and falls back to #main (SH-6)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('skip-target', 'javascript:alert(1)')
    document.body.appendChild(el)
    await flushMicrotasks()

    const skipLink = el.shadowRoot!.querySelector<HTMLAnchorElement>('.yh-skip-link')!
    expect(skipLink.getAttribute('href')).toBe('#main')

    el.setAttribute('skip-target', '#123bad')
    expect(skipLink.getAttribute('href')).toBe('#main')

    el.setAttribute('skip-target', '#main-content_1')
    expect(skipLink.getAttribute('href')).toBe('#main-content_1')
  })
})
