import type {} from '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockSupabase = vi.hoisted(() => {
  const unsubscribe = vi.fn()
  const onAuthStateChange = vi.fn(() => ({
    data: {
      subscription: {
        unsubscribe,
      },
    },
  }))
  const getSession = vi.fn(async () => ({
    data: { session: null },
    error: null,
  }))
  const setSession = vi.fn(async () => ({
    data: { user: null, session: null },
    error: null,
  }))
  const signInWithPassword = vi.fn(async () => ({
    data: { user: null, session: null },
    error: null,
  }))
  const signUp = vi.fn(async () => ({
    data: { user: null, session: null },
    error: null,
  }))
  const signOut = vi.fn(async () => ({
    error: null,
  }))

  const createClient = vi.fn(
    () =>
      ({
        auth: {
          getSession,
          setSession,
          signInWithPassword,
          signUp,
          signOut,
          onAuthStateChange,
        },
      }) as unknown as SupabaseClient,
  )

  return {
    createClient,
    getSession,
    onAuthStateChange,
    unsubscribe,
  }
})

const fetchMock = vi.hoisted(() => {
  const fn = vi.fn(() =>
    Promise.resolve(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fn)
  return fn
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabase.createClient,
}))

import App from '../src/App'

type RenderedCard = {
  name: string
  description: string
  url: string
  linkElement: HTMLAnchorElement | null
}

function readRenderedCards(container: HTMLElement): RenderedCard[] {
  const cardNodes = Array.from(container.querySelectorAll<HTMLElement>('.apps-grid .app-card'))
  return cardNodes.map((card) => {
    const heading = card.querySelector<HTMLElement>('h3')
    const description = card.querySelector<HTMLElement>('p')
    const link = card.querySelector<HTMLAnchorElement>('a[href]')
    return {
      name: heading?.textContent?.trim() ?? '',
      description: description?.textContent?.trim() ?? '',
      url: link?.getAttribute('href')?.trim() ?? '',
      linkElement: link,
    }
  })
}

describe('Portal app cards', () => {
  beforeEach(() => {
    mockSupabase.getSession.mockClear()
    mockSupabase.onAuthStateChange.mockClear()
    mockSupabase.unsubscribe.mockClear()
  })

  it('renders at least 5 app cards', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)

    expect(cards.length).toBeGreaterThanOrEqual(5)
  })

  it('gives every card a non-empty name, description, and url', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)

    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.name.length).toBeGreaterThan(0)
      expect(card.description.length).toBeGreaterThan(0)
      expect(card.url.length).toBeGreaterThan(0)
      expect(card.url).toMatch(/^https:\/\//)
    }
  })

  it('assigns a unique url to every card', () => {
    const { container } = render(<App />)
    const urls = readRenderedCards(container).map((card) => card.url)

    expect(new Set(urls).size).toBe(urls.length)
  })

  it('includes a card linking to https://brse.yundev.space', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)
    const brseCard = cards.find((card) => card.url === 'https://brse.yundev.space')

    expect(brseCard).toBeDefined()
    expect(brseCard?.linkElement).toBeInTheDocument()
    expect(brseCard?.linkElement).toHaveAttribute('href', 'https://brse.yundev.space')
  })

  it('renders app cards under the Supabase mock without attempting real network calls', () => {
    const extractUrl = (args: unknown[]): string => {
      const input = args[0]
      if (typeof input === 'string') return input
      if (typeof input === 'object' && input !== null && 'url' in input) {
        return String((input as { url: unknown }).url)
      }
      return String(input ?? '')
    }

    const priorUrls = (fetchMock.mock.calls as unknown[][]).map(extractUrl)
    expect(
      priorUrls.some((url) => /^https?:\/\//i.test(url) || url.includes('supabase.co')),
    ).toBe(false)

    fetchMock.mockClear()

    const outcome: { rendered?: ReturnType<typeof render> } = {}
    expect(() => {
      outcome.rendered = render(<App />)
    }).not.toThrow()

    expect(globalThis.fetch).toBe(fetchMock)
    const renderUrls = (fetchMock.mock.calls as unknown[][]).map(extractUrl)
    expect(renderUrls.every((url) => url === '/api/auth/me')).toBe(true)
    expect(
      renderUrls.some((url) => /^https?:\/\//i.test(url) || url.includes('supabase.co')),
    ).toBe(false)

    const rendered = outcome.rendered
    expect(rendered).toBeDefined()
    if (!rendered) {
      return
    }

    const cardHeadings = Array.from(
      rendered.container.querySelectorAll<HTMLElement>('.apps-grid .app-card h3'),
    )
    const visibleCardHeadings = cardHeadings.filter(
      (heading) => (heading.textContent?.trim().length ?? 0) > 0,
    )

    expect(visibleCardHeadings.length).toBeGreaterThanOrEqual(5)
    for (const heading of visibleCardHeadings) {
      expect(heading).toBeVisible()
    }

    rendered.unmount()
  })
})
