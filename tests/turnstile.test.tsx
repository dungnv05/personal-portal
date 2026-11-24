import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Turnstile } from '../src/components/Turnstile'
import {
  TURNSTILE_SCRIPT_SRC,
  resetTurnstileLoaderForTests,
  type TurnstileRenderOptions,
} from '../src/utils/turnstile'

const authMocks = vi.hoisted(() => {
  const getSessionUser = vi.fn(async () => null)
  const logout = vi.fn(async () => ({ error: null }))
  const signInWithEmail = vi.fn(
    async (email: string, _password: string, _captchaToken?: string | null) => ({
      data: { user: { id: 'user-1', email } },
      error: null,
    }),
  )
  const signUpWithEmail = vi.fn(
    async (_email: string, _password: string, _captchaToken?: string | null) => ({
      data: { user: null, session: null },
      error: null,
    }),
  )

  const reset = () => {
    getSessionUser.mockClear()
    logout.mockClear()
    signInWithEmail.mockClear()
    signUpWithEmail.mockClear()
  }

  return {
    getSessionUser,
    logout,
    signInWithEmail,
    signUpWithEmail,
    reset,
  }
})

vi.mock('../src/utils/sharedAuth', () => ({
  getSessionUser: authMocks.getSessionUser,
  logout: authMocks.logout,
  signInWithEmail: authMocks.signInWithEmail,
  signUpWithEmail: authMocks.signUpWithEmail,
}))

import App from '../src/App'

function clearTurnstileScripts(): void {
  for (const script of document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) {
    script.remove()
  }
}

describe('Turnstile component', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetTurnstileLoaderForTests()
    clearTurnstileScripts()
    delete window.turnstile
    authMocks.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetTurnstileLoaderForTests()
    clearTurnstileScripts()
    delete window.turnstile
  })

  it('renders nothing and calls onToken(null) when VITE_TURNSTILE_SITE_KEY is missing', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const onToken = vi.fn()

    const { container } = render(<Turnstile onToken={onToken} />)

    expect(container.innerHTML).toBe('')
    expect(onToken).toHaveBeenCalledWith(null)
    expect(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)).toHaveLength(0)
    expect(infoSpy).toHaveBeenCalledTimes(1)

    // Mounting a second widget must not spam console.info again.
    render(<Turnstile onToken={vi.fn()} />)
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('injects the script once, renders with sitekey, propagates token/expire/error, and removes on unmount', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAA_test_sitekey')

    const capturedOptions: TurnstileRenderOptions[] = []
    let nextWidgetNum = 1
    const renderMock = vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      capturedOptions.push(options)
      return `widget-${nextWidgetNum++}`
    })
    const removeMock = vi.fn()
    const onToken = vi.fn()

    const { container, unmount } = render(<Turnstile onToken={onToken} />)

    const injectedScripts = document.querySelectorAll<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    )
    expect(injectedScripts).toHaveLength(1)
    expect(injectedScripts[0]?.defer).toBe(true)

    // Simulate Cloudflare Turnstile script finishing load without any network call.
    window.turnstile = {
      render: renderMock,
      remove: removeMock,
    }
    await act(async () => {
      injectedScripts[0]?.dispatchEvent(new Event('load'))
    })

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    const widgetContainer = container.querySelector('[data-testid="turnstile-widget"]')
    expect(widgetContainer).not.toBeNull()
    expect(renderMock).toHaveBeenCalledWith(
      widgetContainer,
      expect.objectContaining({ sitekey: '0x4AAAA_test_sitekey' }),
    )

    // Mounting another Turnstile instance reuses the existing script tag (still injected once).
    const second = render(<Turnstile onToken={vi.fn()} />)
    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(2)
    })
    expect(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)).toHaveLength(1)

    act(() => {
      capturedOptions[0]?.callback?.('turnstile-token-abc')
    })
    expect(onToken).toHaveBeenLastCalledWith('turnstile-token-abc')

    act(() => {
      capturedOptions[0]?.['expired-callback']?.()
    })
    expect(onToken).toHaveBeenLastCalledWith(null)

    act(() => {
      capturedOptions[0]?.['error-callback']?.('timeout')
    })
    expect(onToken).toHaveBeenLastCalledWith(null)

    unmount()
    expect(removeMock).toHaveBeenCalledWith('widget-1')

    second.unmount()
    expect(removeMock).toHaveBeenCalledWith('widget-2')
  })

  it('supports a mocked scriptLoader and removes the widget on unmount', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAA_mocked_loader')

    const capturedOptions: TurnstileRenderOptions[] = []
    const renderMock = vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      capturedOptions.push(options)
      return 'widget-mock-loader'
    })
    const removeMock = vi.fn()
    const scriptLoader = vi.fn(async () => undefined)
    const onToken = vi.fn()

    window.turnstile = {
      render: renderMock,
      remove: removeMock,
    }

    const { unmount } = render(<Turnstile onToken={onToken} scriptLoader={scriptLoader} />)

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    expect(scriptLoader).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ sitekey: '0x4AAAA_mocked_loader' }),
    )

    act(() => {
      capturedOptions[0]?.callback?.('loader-token-xyz')
    })
    expect(onToken).toHaveBeenCalledWith('loader-token-xyz')

    unmount()
    expect(removeMock).toHaveBeenCalledWith('widget-mock-loader')
  })

  it('calls onToken(null) and removes the failed script element when script loading errors', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAA_error_recovery')
    const onToken = vi.fn()

    const { unmount } = render(<Turnstile onToken={onToken} />)

    const script = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    )
    expect(script).not.toBeNull()

    await act(async () => {
      script?.dispatchEvent(new Event('error'))
    })

    await waitFor(() => {
      expect(onToken).toHaveBeenCalledWith(null)
    })
    expect(document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)).toHaveLength(0)

    unmount()
  })
})

function openSignInModalFromHeader(): void {
  const header = document.querySelector('yun-header')
  expect(header).not.toBeNull()
  act(() => {
    header?.dispatchEvent(
      new CustomEvent('yh-signin-click', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    )
  })
}

describe('App login and signup forms with Turnstile', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response),
    )
    resetTurnstileLoaderForTests()
    clearTurnstileScripts()
    delete window.turnstile
    authMocks.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetTurnstileLoaderForTests()
    clearTurnstileScripts()
    delete window.turnstile
  })

  it('keeps submit buttons enabled for both sign-in and sign-up when no site key is configured', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const { container } = render(<App />)

    openSignInModalFromHeader()

    const signInSubmit = container.querySelector<HTMLButtonElement>('button.btn-auth-submit')
    expect(signInSubmit).not.toBeNull()
    expect(signInSubmit).not.toBeDisabled()
    expect(container.querySelector('[data-testid="turnstile-widget"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký tài khoản' }))

    const signUpSubmit = container.querySelector<HTMLButtonElement>('button.btn-auth-submit')
    expect(signUpSubmit).not.toBeNull()
    expect(signUpSubmit).not.toBeDisabled()
    expect(container.querySelector('[data-testid="turnstile-widget"]')).toBeNull()
  })

  it('gates sign-in submit until Turnstile resolves and forwards the token to signInWithEmail', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAA_signin_key')

    const capturedOptions: TurnstileRenderOptions[] = []
    const renderMock = vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      capturedOptions.push(options)
      return `widget-signin-${capturedOptions.length}`
    })
    const removeMock = vi.fn()
    window.turnstile = {
      render: renderMock,
      remove: removeMock,
    }

    const { container } = render(<App />)

    openSignInModalFromHeader()

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    const submitButton = container.querySelector<HTMLButtonElement>('button.btn-auth-submit')
    expect(submitButton).toBeDisabled()

    act(() => {
      capturedOptions[0]?.callback?.('signin-captcha-token')
    })

    expect(submitButton).not.toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('name@yundev.space'), {
      target: { value: 'yun@yundev.space' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'super-secret' },
    })

    const form = container.querySelector('form.auth-form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(authMocks.signInWithEmail).toHaveBeenCalledWith(
        'yun@yundev.space',
        'super-secret',
        'signin-captcha-token',
      )
    })
  })

  it('maintains separate captcha token state for sign-up and forwards the token to signUpWithEmail', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAA_signup_key')

    const capturedOptions: TurnstileRenderOptions[] = []
    const renderMock = vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      capturedOptions.push(options)
      return `widget-auth-${capturedOptions.length}`
    })
    const removeMock = vi.fn()
    window.turnstile = {
      render: renderMock,
      remove: removeMock,
    }

    const { container } = render(<App />)

    openSignInModalFromHeader()

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    // Solve sign-in widget first.
    act(() => {
      capturedOptions[0]?.callback?.('signin-only-token')
    })
    expect(container.querySelector('button.btn-auth-submit')).not.toBeDisabled()

    // Switch to sign-up: previous widget is cleaned up and sign-up starts disabled.
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký tài khoản' }))

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(2)
    })
    expect(removeMock).toHaveBeenCalledWith('widget-auth-1')
    expect(container.querySelector('button.btn-auth-submit')).toBeDisabled()

    // Solve sign-up widget and submit.
    act(() => {
      capturedOptions[1]?.callback?.('signup-captcha-token')
    })
    expect(container.querySelector('button.btn-auth-submit')).not.toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('name@yundev.space'), {
      target: { value: 'newuser@yundev.space' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'new-secret-123' },
    })

    const form = container.querySelector('form.auth-form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(authMocks.signUpWithEmail).toHaveBeenCalledWith(
        'newuser@yundev.space',
        'new-secret-123',
        'signup-captcha-token',
      )
    })
  })
})
