import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../src/utils/sharedAuth'

const {
  mockGetSessionUser,
  mockSignInWithEmail,
  mockSignUpWithEmail,
  mockUpdateDisplayName,
  mockLogout,
  mockReplaceLocation,
  mockAssignLocation,
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn<() => Promise<SessionUser | null>>(),
  mockSignInWithEmail: vi.fn(),
  mockSignUpWithEmail: vi.fn(),
  mockUpdateDisplayName: vi.fn(),
  mockLogout: vi.fn(),
  mockReplaceLocation: vi.fn<(url: string) => void>(),
  mockAssignLocation: vi.fn<(url: string) => void>(),
}))

vi.mock('../src/utils/sharedAuth', () => ({
  getSessionUser: mockGetSessionUser,
  signInWithEmail: mockSignInWithEmail,
  signUpWithEmail: mockSignUpWithEmail,
  updateDisplayName: mockUpdateDisplayName,
  logout: mockLogout,
}))

vi.mock('../src/utils/navigation', () => ({
  replaceLocation: mockReplaceLocation,
  assignLocation: mockAssignLocation,
}))

import App from '../src/App'
import { NEXT_REDIRECT_GUARD_KEY } from '../src/utils/nextAutoRedirect'

const TARGET_URL =
  'https://brse.yundev.space/courses/lesson?course=a2-1-youken-teigi&lesson=1&tab=assignment'

const SAMPLE_USER: SessionUser = {
  id: 'user-1',
  email: 'yun@yundev.space',
  display_name: 'Yun',
  avatar_url: null,
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('App ?next= auto-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('(d) keeps modal closed while session check is pending and (a) auto-redirects when signed in', async () => {
    const deferred = createDeferred<SessionUser | null>()
    mockGetSessionUser.mockReturnValue(deferred.promise)
    window.history.replaceState({}, '', `/?next=${encodeURIComponent(TARGET_URL)}`)

    const { container } = render(<App />)

    expect(screen.queryByText('Đăng Nhập YunDev')).not.toBeInTheDocument()
    expect(container.querySelector('.auth-modal-card')).not.toBeInTheDocument()
    expect(mockReplaceLocation).not.toHaveBeenCalled()

    await act(async () => {
      deferred.resolve(SAMPLE_USER)
      await deferred.promise
    })

    await waitFor(() => {
      expect(mockReplaceLocation).toHaveBeenCalledTimes(1)
    })
    expect(mockReplaceLocation).toHaveBeenCalledWith(TARGET_URL)

    const rawGuard = window.sessionStorage.getItem(NEXT_REDIRECT_GUARD_KEY)
    expect(rawGuard).not.toBeNull()
    const parsedGuard = JSON.parse(rawGuard!) as { url: string; at: number }
    expect(parsedGuard.url).toBe(TARGET_URL)
    expect(typeof parsedGuard.at).toBe('number')

    mockGetSessionUser.mockResolvedValueOnce({ ...SAMPLE_USER })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(mockGetSessionUser).toHaveBeenCalledTimes(2)
    })
    expect(mockReplaceLocation).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.auth-next-loop-notice')).not.toBeInTheDocument()
  })

  it('(b) shows non-blocking notice and does not auto-redirect when guard blocks repeat redirect', async () => {
    window.sessionStorage.setItem(
      NEXT_REDIRECT_GUARD_KEY,
      JSON.stringify({ url: TARGET_URL, at: Date.now() }),
    )
    mockGetSessionUser.mockResolvedValue(SAMPLE_USER)
    window.history.replaceState({}, '', `/?next=${encodeURIComponent(TARGET_URL)}`)

    const { container } = render(<App />)

    const button = await screen.findByRole('button', {
      name: 'Tiếp tục tới brse.yundev.space',
    })
    expect(button).toBeInTheDocument()
    expect(screen.getByText('Bạn đã đăng nhập. Mở lại brse.yundev.space?')).toBeInTheDocument()
    expect(mockReplaceLocation).not.toHaveBeenCalled()
    expect(container.querySelector('.auth-modal-card')).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(mockAssignLocation).toHaveBeenCalledTimes(1)
    expect(mockAssignLocation).toHaveBeenCalledWith(TARGET_URL)
  })

  it('(c) opens sign-in modal with next hint when session resolves to null', async () => {
    const deferred = createDeferred<SessionUser | null>()
    mockGetSessionUser.mockReturnValue(deferred.promise)
    window.history.replaceState({}, '', `/?next=${encodeURIComponent(TARGET_URL)}`)

    const { container } = render(<App />)
    expect(screen.queryByText('Đăng Nhập YunDev')).not.toBeInTheDocument()

    await act(async () => {
      deferred.resolve(null)
      await deferred.promise
    })

    expect(await screen.findByText('Đăng Nhập YunDev')).toBeInTheDocument()
    expect(screen.getByText('Sign in to continue to brse.yundev.space')).toBeInTheDocument()
    expect(mockReplaceLocation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(container.querySelector('.auth-modal-card')).not.toBeInTheDocument()

    mockGetSessionUser.mockResolvedValueOnce(null)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(mockGetSessionUser).toHaveBeenCalledTimes(2)
    })
    expect(container.querySelector('.auth-modal-card')).not.toBeInTheDocument()
  })

  it('(e) does not redirect for invalid next URL when signed in', async () => {
    mockGetSessionUser.mockResolvedValue(SAMPLE_USER)
    window.history.replaceState({}, '', `/?next=${encodeURIComponent('https://evil.com/')}`)

    const { container } = render(<App />)

    await waitFor(() => {
      expect(mockGetSessionUser).toHaveBeenCalled()
    })

    expect(mockReplaceLocation).not.toHaveBeenCalled()
    expect(container.querySelector('.auth-modal-card')).not.toBeInTheDocument()
    expect(container.querySelector('.auth-next-loop-notice')).not.toBeInTheDocument()
  })

  it('opens modal immediately for ?auth=signin without next and clears existing guard', async () => {
    window.sessionStorage.setItem(
      NEXT_REDIRECT_GUARD_KEY,
      JSON.stringify({ url: TARGET_URL, at: Date.now() }),
    )
    mockGetSessionUser.mockReturnValue(createDeferred<SessionUser | null>().promise)
    window.history.replaceState({}, '', '/?auth=signin')

    render(<App />)

    expect(screen.getByText('Đăng Nhập YunDev')).toBeInTheDocument()
    await waitFor(() => {
      expect(window.sessionStorage.getItem(NEXT_REDIRECT_GUARD_KEY)).toBeNull()
    })
  })
})
