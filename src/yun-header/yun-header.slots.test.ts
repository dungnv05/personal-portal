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

  it('(l) closes the mobile sheet when clicking the .yh-sheet-section link', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('shared-nav', '')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const toggleBtn = shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!
    toggleBtn.click()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')

    const sectionLink = shadow.querySelector<HTMLAnchorElement>('.yh-sheet-section a')!
    sectionLink.addEventListener('click', (event) => event.preventDefault())
    sectionLink.click()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')
  })

  it('(m) falls back to https://www.yundev.space/ for .yh-shared-link when auth-base is disallowed', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('shared-nav', '')
    el.setAttribute('auth-base', 'https://evil.example')
    document.body.appendChild(el)
    await flushMicrotasks()

    const sharedLink = el.shadowRoot!.querySelector<HTMLAnchorElement>('.yh-shared-link')!
    expect(sharedLink.getAttribute('href')).toBe('https://www.yundev.space/')
  })

  it('(n) skips hidden .yh-sheet-account controls in the sheet focus trap', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('shared-nav', '')
    el.setAttribute('collapse', 'lg')

    const link1 = document.createElement('a')
    link1.slot = 'app-nav'
    link1.href = '/one'
    link1.textContent = 'One'

    const link2 = document.createElement('a')
    link2.slot = 'app-nav'
    link2.href = '/two'
    link2.textContent = 'Two'

    el.append(link1, link2)
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!.click()

    const sheetAccount = shadow.querySelector<HTMLElement>('.yh-sheet-account')!
    sheetAccount.style.display = 'none'

    const sheet = shadow.querySelector<HTMLElement>('.yh-sheet')!
    const closeBtn = shadow.querySelector<HTMLButtonElement>('.yh-sheet-header button')!
    const lastVisibleLink = shadow.querySelector<HTMLAnchorElement>('.yh-sheet-section a')!

    lastVisibleLink.focus()
    expect(shadow.activeElement).toBe(lastVisibleLink)

    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true }))
    expect(shadow.activeElement).toBe(closeBtn)

    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, composed: true }))
    expect(shadow.activeElement).toBe(lastVisibleLink)
  })

  it('(o) removes .yh-nav--app when all app-nav links are removed after render', async () => {
    const el = document.createElement('yun-header') as YunHeader
    const link = document.createElement('a')
    link.slot = 'app-nav'
    link.href = '/roadmap'
    link.textContent = 'Lộ trình'
    el.appendChild(link)
    document.body.appendChild(el)
    await flushMicrotasks()

    const nav = el.shadowRoot!.querySelector<HTMLElement>('.yh-nav')!
    expect(nav.classList.contains('yh-nav--app')).toBe(true)

    link.remove()
    await flushMicrotasks()
    expect(nav.classList.contains('yh-nav--app')).toBe(false)
  })

  it('(p) closes an open sheet when collapse changes and the mobile toggle becomes hidden', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'lg')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const toggleBtn = shadow.querySelector<HTMLButtonElement>('.yh-mobile-toggle')!
    toggleBtn.click()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')

    const origGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((target, pseudoElt) => {
      const style = origGetComputedStyle(target, pseudoElt)
      if (target === toggleBtn) {
        return new Proxy(style, {
          get(obj, prop) {
            return prop === 'display' ? 'none' : Reflect.get(obj, prop, obj)
          },
        })
      }
      return style
    })

    el.setAttribute('collapse', 'md')
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')
  })

  it('(q) accepts collapse="xl" and collapse="auto" and includes 1279px and .yh-collapsed rules in STYLES', async () => {
    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'xl')
    document.body.appendChild(el)
    await flushMicrotasks()

    const styleText = Array.from(el.shadowRoot!.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')

    expect(styleText).toContain('max-width: 1279px')
    expect(styleText).toContain(':host([collapse="xl"])')
    expect(styleText).toContain(':host([collapse="auto"])')
    expect(styleText).toContain('.yh-bar.yh-collapsed')
    expect(styleText).toContain('.yh-sheet-backdrop.yh-collapsed .yh-sheet-account')

    el.setAttribute('collapse', 'auto')
    expect(el.getAttribute('collapse')).toBe('auto')
  })

  it('(r) auto collapse toggles yh-collapsed via ResizeObserver with hysteresis', async () => {
    let roCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'auto')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const bar = shadow.querySelector<HTMLElement>('.yh-bar')!
    const nav = shadow.querySelector<HTMLElement>('.yh-nav')!
    const backdrop = shadow.querySelector<HTMLElement>('.yh-sheet-backdrop')!

    let barClientWidth = 1200
    let navClientWidth = 500
    let navScrollWidth = 800
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => barClientWidth })
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, get: () => barClientWidth })
    Object.defineProperty(nav, 'clientWidth', { configurable: true, get: () => navClientWidth })
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, get: () => navScrollWidth })

    roCallback?.([], {} as ResizeObserver)
    expect(bar.classList.contains('yh-collapsed')).toBe(true)
    expect(backdrop.classList.contains('yh-collapsed')).toBe(true)

    barClientWidth = 1250
    roCallback?.([], {} as ResizeObserver)
    expect(bar.classList.contains('yh-collapsed')).toBe(true)
    expect(backdrop.classList.contains('yh-collapsed')).toBe(true)

    barClientWidth = 1400
    navClientWidth = 700
    navScrollWidth = 700
    roCallback?.([], {} as ResizeObserver)
    expect(bar.classList.contains('yh-collapsed')).toBe(false)
    expect(backdrop.classList.contains('yh-collapsed')).toBe(false)
  })

  it('(s) auto collapse never collapses when bar.clientWidth is 0', async () => {
    let roCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'auto')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const bar = shadow.querySelector<HTMLElement>('.yh-bar')!
    const nav = shadow.querySelector<HTMLElement>('.yh-nav')!
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => 0 })
    Object.defineProperty(nav, 'clientWidth', { configurable: true, get: () => 100 })
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, get: () => 500 })

    roCallback?.([], {} as ResizeObserver)
    expect(bar.classList.contains('yh-collapsed')).toBe(false)
  })

  it('(t) auto collapse falls back to window.innerWidth <= 1279 when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1200 })

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'auto')
    document.body.appendChild(el)
    await flushMicrotasks()

    const bar = el.shadowRoot!.querySelector<HTMLElement>('.yh-bar')!
    expect(bar.classList.contains('yh-collapsed')).toBe(true)

    window.innerWidth = 1400
    window.dispatchEvent(new Event('resize'))
    expect(bar.classList.contains('yh-collapsed')).toBe(false)
  })

  it('(u) disconnects ResizeObserver on disconnectedCallback and observes again on reconnect', async () => {
    const observeSpy = vi.fn()
    const disconnectSpy = vi.fn()
    class MockResizeObserver {
      observe = observeSpy
      unobserve = vi.fn()
      disconnect = disconnectSpy
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('collapse', 'auto')
    document.body.appendChild(el)
    await flushMicrotasks()

    expect(observeSpy).toHaveBeenCalledTimes(1)
    expect(disconnectSpy).not.toHaveBeenCalled()

    el.remove()
    expect(disconnectSpy).toHaveBeenCalledTimes(1)

    document.body.appendChild(el)
    await flushMicrotasks()
    expect(observeSpy).toHaveBeenCalledTimes(2)
  })

  it('(v) omits "Về YunDev.space" in dropdown and sheet account when shared-nav is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          user: { id: 'u1', email: 'yun@yundev.space', display_name: 'Yun' },
        }),
      ),
    )

    const el = document.createElement('yun-header') as YunHeader
    el.setAttribute('shared-nav', '')
    document.body.appendChild(el)
    await flushMicrotasks()

    const shadow = el.shadowRoot!
    const dropdownTexts = Array.from(shadow.querySelectorAll('.yh-menu .yh-menu-item')).map(
      (n) => n.textContent,
    )
    const sheetTexts = Array.from(shadow.querySelectorAll('.yh-sheet-account .yh-menu-item')).map(
      (n) => n.textContent,
    )
    expect(dropdownTexts).not.toContain('Về YunDev.space')
    expect(sheetTexts).not.toContain('Về YunDev.space')

    el.removeAttribute('shared-nav')
    const dropdownTextsAfter = Array.from(shadow.querySelectorAll('.yh-menu .yh-menu-item')).map(
      (n) => n.textContent,
    )
    const sheetTextsAfter = Array.from(shadow.querySelectorAll('.yh-sheet-account .yh-menu-item')).map(
      (n) => n.textContent,
    )
    expect(dropdownTextsAfter).toContain('Về YunDev.space')
    expect(sheetTextsAfter).toContain('Về YunDev.space')
  })

  it('(w) uses --yh-control-border first on .yh-theme-toggle and keeps .yh-mobile-toggle unchanged', async () => {
    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const styleText = Array.from(el.shadowRoot!.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')

    expect(styleText).toMatch(
      /\.yh-theme-toggle\s*\{[^}]*border:\s*1px\s+solid\s+var\(--yh-control-border,\s*var\(--yh-toggle-border,/,
    )
    expect(styleText).toMatch(
      /\.yh-mobile-toggle\s*\{[^}]*border-color:\s*var\(--yh-control-border,\s*var\(--yh-muted,\s*#B8B3C7\)\)/,
    )
  })

  it('(x) toggles .yh-left--app on app-title slotchange', async () => {
    const el = document.createElement('yun-header') as YunHeader
    document.body.appendChild(el)
    await flushMicrotasks()

    const left = el.shadowRoot!.querySelector<HTMLElement>('.yh-left')!
    expect(left.classList.contains('yh-left--app')).toBe(false)

    const title = document.createElement('a')
    title.slot = 'app-title'
    title.href = '/'
    title.textContent = 'BrSE Study'
    el.appendChild(title)
    await flushMicrotasks()
    expect(left.classList.contains('yh-left--app')).toBe(true)

    title.remove()
    await flushMicrotasks()
    expect(left.classList.contains('yh-left--app')).toBe(false)
  })
})
