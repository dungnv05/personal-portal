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
  statusText: string
  statusElement: HTMLElement | null
  url: string
  linkElement: HTMLAnchorElement | null
  element: HTMLElement
}

function readRenderedCards(container: HTMLElement): RenderedCard[] {
  const cardNodes = Array.from(container.querySelectorAll<HTMLElement>('.apps-grid .app-card'))
  return cardNodes.map((card) => {
    const heading = card.querySelector<HTMLElement>('h3')
    const description = card.querySelector<HTMLElement>('p')
    const statusElement = card.querySelector<HTMLElement>('.app-status')
    const link = card.querySelector<HTMLAnchorElement>('a[href]')
    return {
      name: heading?.textContent?.trim() ?? '',
      description: description?.textContent?.trim() ?? '',
      statusText: statusElement?.textContent?.trim() ?? '',
      statusElement,
      url: link?.getAttribute('href')?.trim() ?? '',
      linkElement: link,
      element: card,
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

  it('gives every card a non-empty name and description, and launchable cards an https url', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)

    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.name.length).toBeGreaterThan(0)
      expect(card.description.length).toBeGreaterThan(0)
      if (card.linkElement) {
        expect(card.url.length).toBeGreaterThan(0)
        expect(card.url).toMatch(/^https:\/\//)
      } else {
        expect(card.element).toHaveClass('app-card-disabled')
      }
    }
  })

  it('assigns a unique url to every launchable card', () => {
    const { container } = render(<App />)
    const urls = readRenderedCards(container)
      .filter((card) => card.linkElement !== null)
      .map((card) => card.url)

    expect(urls.length).toBeGreaterThan(0)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('renders Vang Vọng Sử Việt as non-clickable In Dev after all Active and Beta cards', () => {
    const { container, queryByRole } = render(<App />)
    const cards = readRenderedCards(container)

    expect(queryByRole('link', { name: /vang-vong/i })).toBeNull()
    expect(container.querySelector('[href*="vang-vong-su-viet"]')).toBeNull()

    const vangVongIndex = cards.findIndex((card) => card.name === 'Vang Vọng Sử Việt')
    expect(vangVongIndex).toBeGreaterThan(-1)

    const vangVongCard = cards[vangVongIndex]
    expect(vangVongCard.linkElement).toBeNull()
    expect(vangVongCard.element).toHaveClass('app-card-disabled')

    const disabledAction = vangVongCard.element.querySelector<HTMLElement>('[aria-disabled="true"]')
    expect(disabledAction).not.toBeNull()
    expect(disabledAction).toHaveTextContent('Đang phát triển')
    expect(disabledAction).toHaveAttribute('aria-disabled', 'true')
    expect(disabledAction).not.toHaveAttribute('tabindex')

    const lastLaunchableIndex = cards.reduce(
      (lastIdx, card, idx) =>
        card.statusText === 'Active' || card.statusText === 'Beta' ? idx : lastIdx,
      -1,
    )
    expect(lastLaunchableIndex).toBeGreaterThan(-1)
    expect(vangVongIndex).toBeGreaterThan(lastLaunchableIndex)
  })

  it('renders PM / BrSE Track with Beta badge and link to https://brse.yundev.space', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)
    const brseCard = cards.find((card) => card.url === 'https://brse.yundev.space')

    expect(brseCard).toBeDefined()
    expect(brseCard?.statusElement).toHaveClass('status-beta')
    expect(brseCard?.statusText).toBe('Beta')
    expect(brseCard?.linkElement).toBeInTheDocument()
    expect(brseCard?.linkElement).toHaveAttribute('href', 'https://brse.yundev.space')
  })

  it('links Active cards (e.g. SalaryFlow) with target _blank', () => {
    const { container } = render(<App />)
    const cards = readRenderedCards(container)
    const salaryFlowCard = cards.find((card) => card.name === 'SalaryFlow')

    expect(salaryFlowCard).toBeDefined()
    expect(salaryFlowCard?.statusText).toBe('Active')
    expect(salaryFlowCard?.linkElement).toHaveAttribute('target', '_blank')
    expect(salaryFlowCard?.linkElement).toHaveAttribute('rel', 'noopener noreferrer')
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
