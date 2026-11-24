import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineYunHeader, YunHeader } from './index'

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
})
