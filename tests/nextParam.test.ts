import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { getNextTargetLabel, resolveNextTarget } from '../src/utils/nextParam'

vi.hoisted(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

import App from '../src/App'

type JsdomHandle = {
  reconfigure: (settings: { url: string }) => void
}

function getJsdom(): JsdomHandle {
  const dom = (globalThis as { jsdom?: JsdomHandle }).jsdom
  if (!dom) {
    throw new Error('Expected Vitest jsdom instance on globalThis.jsdom')
  }
  return dom
}

function setTestUrl(url: string): void {
  getJsdom().reconfigure({ url })
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

describe('resolveNextTarget', () => {
  it('allows an https subdomain of yundev.space', () => {
    expect(resolveNextTarget('?next=https://brse.yundev.space/')).toBe(
      'https://brse.yundev.space/',
    )
    expect(
      resolveNextTarget('?next=https%3A%2F%2Fbrse.yundev.space%2Ftrack%3Ftab%3D1%23top'),
    ).toBe('https://brse.yundev.space/track?tab=1#top')
  })

  it('allows the https apex host yundev.space', () => {
    expect(resolveNextTarget('?next=https://yundev.space')).toBe('https://yundev.space/')
    expect(resolveNextTarget('?next=https://yundev.space/account')).toBe(
      'https://yundev.space/account',
    )
  })

  it('allows a same-origin relative path', () => {
    expect(resolveNextTarget('?next=/dashboard')).toBe('/dashboard')
    expect(resolveNextTarget('?next=/courses/pm?level=2#overview')).toBe(
      '/courses/pm?level=2#overview',
    )
  })

  it('rejects protocol-relative URLs such as //evil.com', () => {
    expect(resolveNextTarget('?next=//evil.com')).toBe('/')
    expect(resolveNextTarget('?next=//yundev.space/')).toBe('/')
    expect(resolveNextTarget('?next=/\\evil.com')).toBe('/')
  })

  it('rejects non-HTTPS http://yundev.space', () => {
    expect(resolveNextTarget('?next=http://yundev.space')).toBe('/')
    expect(resolveNextTarget('?next=http://brse.yundev.space/')).toBe('/')
  })

  it('rejects hosts that are not dot-anchored to yundev.space', () => {
    expect(resolveNextTarget('?next=https://yundev.space.evil.com')).toBe('/')
    expect(resolveNextTarget('?next=https://notyundev.space/')).toBe('/')
    expect(resolveNextTarget('?next=https://evil.com@yundev.space/')).toBe('/')
  })

  it('rejects javascript: URLs', () => {
    expect(resolveNextTarget('?next=javascript:alert(1)')).toBe('/')
  })

  it('returns fallback when next is empty, missing, unparsable, or double-encoded', () => {
    expect(resolveNextTarget('')).toBe('/')
    expect(resolveNextTarget('?next=')).toBe('/')
    expect(resolveNextTarget('?next=   ', '/home')).toBe('/home')
    expect(resolveNextTarget('?next=https://[::1', '/home')).toBe('/home')
    expect(resolveNextTarget('?next=%252F%252Fevil.com')).toBe('/')
  })

  it('derives the display label safely', () => {
    expect(getNextTargetLabel('?next=https://brse.yundev.space/')).toBe('brse.yundev.space')
    expect(getNextTargetLabel('?next=https://yundev.space/')).toBe('yundev.space')
    expect(getNextTargetLabel('?next=/dashboard')).toBe('this site')
    expect(getNextTargetLabel('?next=https://yundev.space.evil.com')).toBe('this site')
    expect(getNextTargetLabel('')).toBeNull()
  })
})

describe('App next param hint', () => {
  beforeEach(() => {
    setTestUrl('https://yundev.space/?next=https://brse.yundev.space/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setTestUrl('https://yundev.space/')
  })

  it('renders the hint above the login form when ?next=https://brse.yundev.space/ is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = getRequestUrl(input)
      if (url === '/api/auth/me') {
        return jsonResponse({ ok: false }, 401)
      }
      return jsonResponse({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(createElement(App))

    const hint = await screen.findByText('Sign in to continue to brse.yundev.space')
    expect(hint).toBeInTheDocument()

    const form = container.querySelector('form.auth-form')
    expect(form).not.toBeNull()
    expect(
      hint.compareDocumentPosition(form as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
