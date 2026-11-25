import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProfilePage } from '../../src/components/ProfilePage'

describe('ProfilePage', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    document.body.innerHTML = ''
  })

  it('renders loading status while auth is not yet resolved (S7a)', () => {
    render(<ProfilePage user={null} authResolved={false} onOpenSignIn={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toBe('Đang tải hồ sơ…')
    expect(screen.queryByText('Vui lòng đăng nhập để xem hồ sơ của bạn.')).toBeNull()
  })

  it('renders signed-out prompt and opens sign-in modal on click', () => {
    const onOpenSignIn = vi.fn()
    render(<ProfilePage user={null} onOpenSignIn={onOpenSignIn} />)

    expect(screen.getByText('Vui lòng đăng nhập để xem hồ sơ của bạn.')).toBeTruthy()
    const signInBtn = screen.getByRole('button', { name: 'Đăng nhập' })
    fireEvent.click(signInBtn)
    expect(onOpenSignIn).toHaveBeenCalledTimes(1)
  })

  it('renders initials, display name, email, and saves successfully', async () => {
    document.cookie = 'csrf=csrf-profile-123; path=/'
    const refreshMock = vi.fn().mockResolvedValue(undefined)
    const fakeHeader = document.createElement('yun-header') as HTMLElement & {
      refresh: () => Promise<void>
    }
    fakeHeader.refresh = refreshMock
    document.body.appendChild(fakeHeader)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          user: {
            id: 'user-1',
            email: 'yun@yundev.space',
            display_name: 'Yun Updated',
            avatar_url: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onUserUpdated = vi.fn()
    render(
      <ProfilePage
        user={{ id: 'user-1', email: 'yun@yundev.space', display_name: 'Minh Nguyen' }}
        onOpenSignIn={vi.fn()}
        onUserUpdated={onUserUpdated}
      />,
    )

    expect(screen.getByText('MN')).toBeTruthy()
    expect(screen.getByText('Minh Nguyen')).toBeTruthy()
    expect(screen.getByText('yun@yundev.space')).toBeTruthy()

    const input = screen.getByLabelText('Tên hiển thị') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Yun Updated' } })

    const saveBtn = screen.getByRole('button', { name: 'Lưu' })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Đã lưu.')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': 'csrf-profile-123',
      },
      body: JSON.stringify({ display_name: 'Yun Updated' }),
    })
    expect(onUserUpdated).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'yun@yundev.space',
      display_name: 'Yun Updated',
      avatar_url: null,
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('shows error alert when save fails', async () => {
    document.cookie = 'csrf=csrf-profile-err; path=/'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'auth_upstream_error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ProfilePage
        user={{ id: 'user-1', email: 'yun@yundev.space', display_name: null }}
        onOpenSignIn={vi.fn()}
      />,
    )

    expect(screen.getByText('Y')).toBeTruthy()
    const input = screen.getByLabelText('Tên hiển thị')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Không lưu được, thử lại.')
    })
  })

  it('retries profile save once after 401 via /api/auth/refresh (S7b)', async () => {
    document.cookie = 'csrf=csrf-initial; path=/'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockImplementationOnce(async () => {
        document.cookie = 'csrf=csrf-rotated; path=/'
        return new Response(JSON.stringify({ ok: true, user: { id: 'user-1', email: 'yun@yundev.space' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: { id: 'user-1', email: 'yun@yundev.space', display_name: 'Retried Name', avatar_url: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ProfilePage
        user={{ id: 'user-1', email: 'yun@yundev.space', display_name: null }}
        onOpenSignIn={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Tên hiển thị')
    fireEvent.change(input, { target: { value: 'Retried Name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Đã lưu.')
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': 'csrf-initial' },
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/auth/profile',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-rotated',
        },
      }),
    )
  })

  it('prefills empty input with email local part placeholder when display_name is null and does not save fallback (S7c)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ProfilePage
        user={{ id: 'user-1', email: 'yun@yundev.space', display_name: null }}
        onOpenSignIn={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Tên hiển thị') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('yun')

    const form = input.closest('form')!
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toBe('Không lưu được, thử lại.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
