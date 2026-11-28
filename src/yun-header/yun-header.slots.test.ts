import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineYunHeader, YUN_HEADER_SLOT_API, YunHeader } from './index'
import { __resetRefreshCoordinatorForTests } from '../shared-auth/refreshCoordinator'
import yunHeaderSource from './yun-header.ts?raw'

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

describe('<yun-header> app slots (SLOT_API 1)', () => {
  beforeAll(() => {
    defineYunHeader()
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    __resetRefreshCoordinatorForTests()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 401)))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('(a) exposes YunHeader.SLOT_API === 1 and exports YUN_HEADER_SLOT_API from index', () => {
    expect(YUN_HEADER_SLOT_API).toBe(1)
    expect(YunHeader.SLOT_API).toBe(1)
    expect((customElements.get('yun-header') as typeof YunHeader | undefined)?.SLOT_API).toBe(1)
  })

  it('(b) renders legacy and app slots in expected DOM order', async () => {
    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const slotNames = Array.from(el.shadowRoot!.querySelectorAll('slot')).map((s) => s.getAttribute('name'))
    expect(slotNames).toEqual(['brand', 'app-title', 'nav', 'app-nav', 'app-actions', 'actions'])
  })

  it('(c) preserves legacy rendering when no app slots or new attributes are used', async () => {
    const el = document.createElement('yun-header') as YunHeader
    const legacyLink = document.createElement('a')
    legacyLink.slot = 'nav'
    legacyLink.href = '/docs'
    legacyLink.textContent = 'Docs'
    el.appendChild(legacyLink)
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const nav = shadow.querySelector<HTMLElement>('.yh-nav')!
    expect(nav.classList.contains('yh-nav--app')).toBe(false)
    expect(nav.getAttribute('aria-label')).toBe('Điều hướng chính')

    const sharedLink = shadow.querySelector<HTMLAnchorElement>('.yh-shared-link')!
    expect(sharedLink.hidden).toBe(true)

    const toggleBtn = shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!
    toggleBtn.click()

    expect(shadow.querySelector('.yh-sheet-heading')).toBeNull()
    expect(shadow.querySelector('.yh-sheet-section')).toBeNull()
    expect(shadow.querySelectorAll('.yh-sheet-nav a')).toHaveLength(1)
  })

  it('(d) clones app-nav links into sheet, strips slot and all id attrs, keeps aria-current, adds heading and yh-nav--app', async () => {
    const el = document.createElement('yun-header') as YunHeader

    const link1 = document.createElement('a')
    link1.slot = 'app-nav'
    link1.id = 'nav-roadmap'
    link1.href = '/roadmap'
    link1.setAttribute('aria-current', 'page')
    const innerSpan = document.createElement('span')
    innerSpan.id = 'nav-roadmap-label'
    innerSpan.textContent = 'Lộ trình'
    link1.appendChild(innerSpan)

    const link2 = document.createElement('a')
    link2.slot = 'app-nav'
    link2.href = '/kanji'
    link2.textContent = 'Kanji'

    el.append(link1, link2)
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const desktopNav = shadow.querySelector<HTMLElement>('.yh-nav')!
    expect(desktopNav.classList.contains('yh-nav--app')).toBe(true)

    shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!.click()

    const sheetNav = shadow.querySelector<HTMLElement>('.yh-sheet-nav')!
    const heading = sheetNav.querySelector<HTMLElement>('.yh-sheet-heading')
    expect(heading?.textContent).toBe('Điều hướng chính')

    const clonedLinks = Array.from(sheetNav.querySelectorAll<HTMLAnchorElement>('a'))
    expect(clonedLinks).toHaveLength(2)
    expect(clonedLinks.map((a) => a.textContent)).toEqual(['Lộ trình', 'Kanji'])
    expect(clonedLinks[0]?.getAttribute('aria-current')).toBe('page')
    expect(clonedLinks[0]?.hasAttribute('slot')).toBe(false)
    expect(clonedLinks[1]?.hasAttribute('slot')).toBe(false)
    expect(sheetNav.querySelector('[id]')).toBeNull()
  })

  it('(e) places legacy nav slot items before app-nav items in the mobile sheet', async () => {
    const el = document.createElement('yun-header') as YunHeader

    const legacyLink = document.createElement('a')
    legacyLink.slot = 'nav'
    legacyLink.href = '/legacy'
    legacyLink.textContent = 'Legacy'

    const appLink = document.createElement('a')
    appLink.slot = 'app-nav'
    appLink.href = '/app'
    appLink.textContent = 'App'

    el.append(appLink, legacyLink)
    document.body.appendChild(el)
    await flushMicrotasks()

    el.shadowRoot!.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!.click()

    const links = Array.from(el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.yh-sheet-nav a'))
    expect(links.map((a) => a.textContent)).toEqual(['Legacy', 'App'])
  })

  it('(f) closes the mobile sheet when clicking a cloned nav link', async () => {
    const el = document.createElement('yun-header') as YunHeader
    const appLink = document.createElement('a')
    appLink.slot = 'app-nav'
    appLink.href = '#section'
    appLink.textContent = 'Section'
    el.appendChild(appLink)
    document.body.appendChild(el)
    await flushMicrotasks()

    const toggleBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!
    toggleBtn.click()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')

    const clonedLink = el.shadowRoot!.querySelector<HTMLAnchorElement>('.yh-sheet-nav a')!
    clonedLink.click()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')
  })

  it('(g) sanitizes nav-label, updates both nav aria-labels, and truncates to 60 chars', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('nav-label', '  Điều hướng\u0007 BrSE\n ')
    document.body.appendChild(el)
    await flushMicrotasks()

    const desktopNav = el.shadowRoot!.querySelector<HTMLElement>('.yh-nav')!
    const sheetNav = el.shadowRoot!.querySelector<HTMLElement>('.yh-sheet-nav')!
    expect(desktopNav.getAttribute('aria-label')).toBe('Điều hướng BrSE')
    expect(sheetNav.getAttribute('aria-label')).toBe('Điều hướng BrSE')

    el.setAttribute('nav-label', '   \u0000\u001f   ')
    expect(desktopNav.getAttribute('aria-label')).toBe('Điều hướng chính')
    expect(sheetNav.getAttribute('aria-label')).toBe('Điều hướng chính')

    const longLabel = 'A'.repeat(75)
    el.setAttribute('nav-label', longLabel)
    expect(desktopNav.getAttribute('aria-label')).toBe('A'.repeat(60))
    expect(sheetNav.getAttribute('aria-label')).toBe('A'.repeat(60))
  })

  it('(h) toggles shared-nav desktop link and sheet section and updates href on auth-base change', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('shared-nav', '')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const sharedLink = shadow.querySelector<HTMLAnchorElement>('.yh-shared-link')!
    expect(sharedLink.hidden).toBe(false)
    expect(sharedLink.getAttribute('href')).toBe('https://www.yundev.space/')
    expect(sharedLink.getAttribute('aria-label')).toBe('Về YunDev.space')

    const sheetSection = shadow.querySelector<HTMLElement>('.yh-sheet-section')!
    expect(sheetSection).not.toBeNull()
    expect(sheetSection.querySelector('.yh-sheet-heading')?.textContent).toBe('YunDev.space')
    const sheetSectionLink = sheetSection.querySelector<HTMLAnchorElement>('a')!
    expect(sheetSectionLink.textContent).toBe('Về trang chủ YunDev.space')
    expect(sheetSectionLink.getAttribute('href')).toBe('https://www.yundev.space/')

    el.setAttribute('auth-base', 'https://brse.yundev.space')
    expect(sharedLink.getAttribute('href')).toBe('https://brse.yundev.space/')
    expect(sheetSectionLink.getAttribute('href')).toBe('https://brse.yundev.space/')

    el.removeAttribute('shared-nav')
    expect(sharedLink.hidden).toBe(true)
    expect(shadow.querySelector('.yh-sheet-section')).toBeNull()
  })

  it('(i) sets aria-haspopup="dialog" and aria-controls matching sheet dialog id on mobile toggle', async () => {
    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const toggleBtn = shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!
    const dialog = shadow.querySelector<HTMLElement>('[role="dialog"]')!

    expect(toggleBtn.getAttribute('aria-haspopup')).toBe('dialog')
    const controlsId = toggleBtn.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    expect(dialog.id).toBe(controlsId)
    expect(shadow.getElementById(controlsId!)).toBe(dialog)
  })

  it('(j) includes --yh-control-border on .yh-mobile-toggle and :host([collapse="lg"]) rules in STYLES', async () => {
    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const styleText = Array.from(el.shadowRoot!.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')

    expect(styleText).toMatch(/\.yh-mobile-toggle\s*\{[^}]*--yh-control-border/)
    expect(styleText).toContain(':host([collapse="lg"])')
  })

  it('(k) keeps yun-header.ts free of unsafe DOM/eval patterns', () => {
    expect(yunHeaderSource).not.toMatch(/\binnerHTML\b/)
    expect(yunHeaderSource).not.toMatch(/\bouterHTML\b/)
    expect(yunHeaderSource).not.toMatch(/\binsertAdjacentHTML\b/)
    expect(yunHeaderSource).not.toMatch(/\beval\s*\(/)
    expect(yunHeaderSource).not.toMatch(/\bnew\s+Function\b/)
    expect(yunHeaderSource).not.toMatch(/['"`]\s*on[a-z]+\s*=/)
  })
})
