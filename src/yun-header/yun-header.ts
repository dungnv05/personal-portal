import { isAllowedHost } from '../../shared/allowed-origins.js'

export type YunHeaderApp = 'portal' | 'tinh-luong' | 'brse' | 'vang-vong' | 'ivf'
export type YunHeaderVariant = 'bar' | 'overlay'
export type YunHeaderState = 'loading' | 'signed-out' | 'signed-in' | 'expired' | 'error'

export interface YunHeaderUser {
  id: string
  email: string | null
  displayName: string
  rawDisplayName: string | null
  avatarUrl: string | null
  initials: string
}

export interface YunHeaderAuthChangeDetail {
  state: YunHeaderState
  user: YunHeaderUser | null
}

export interface YunHeaderMenuToggleDetail {
  open: boolean
}

const DEFAULT_AUTH_BASE = 'https://www.yundev.space'
const LOADING_TIMEOUT_MS = 3000
const ALLOW_LOCALHOST: boolean = import.meta.env.DEV === true
const SKIP_TARGET_PATTERN = /^#[A-Za-z][\w-]*$/

const STYLES = `
:host {
  display: block;
  position: sticky;
  top: 0;
  z-index: 40;
  font-family: var(--yh-font, system-ui, -apple-system, 'Segoe UI', sans-serif);
  color: var(--yh-ink, #F2EFF7);
}

*, *::before, *::after {
  box-sizing: border-box;
}

.yh-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 64px;
  padding: 0 24px;
  background: var(--yh-bg, #15121D);
  border-bottom: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

:host([variant="overlay"]) .yh-bar {
  min-height: 48px;
  background: color-mix(in srgb, var(--yh-bg, #15121D) 72%, transparent);
  border-bottom-color: transparent;
}

.yh-skip-link {
  position: absolute;
  left: -9999px;
  top: 8px;
  z-index: 60;
  padding: 10px 16px;
  border-radius: var(--yh-radius, 12px);
  background: var(--yh-primary, #A78BFA);
  color: var(--yh-on-primary, #1B1526);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}

.yh-skip-link:focus,
.yh-skip-link:focus-visible {
  left: 16px;
}

.yh-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.yh-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.yh-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.yh-account-desktop {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.yh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 14px;
  border-radius: var(--yh-radius, 12px);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  text-decoration: none;
  background: transparent;
  color: var(--yh-ink, #F2EFF7);
  transition: background-color 150ms ease, border-color 150ms ease, opacity 150ms ease;
}

.yh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.yh-btn-text:hover:not(:disabled) {
  background: color-mix(in srgb, var(--yh-ink, #F2EFF7) 8%, transparent);
}

.yh-btn-primary {
  background: var(--yh-primary, #A78BFA);
  color: var(--yh-on-primary, #1B1526);
}

.yh-btn-primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.yh-btn-icon {
  padding: 0;
  width: 44px;
  height: 44px;
  border: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  color: var(--yh-muted, #B8B3C7);
}

.yh-btn-icon:hover:not(:disabled) {
  color: var(--yh-ink, #F2EFF7);
  background: color-mix(in srgb, var(--yh-ink, #F2EFF7) 8%, transparent);
}

.yh-account-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 4px 10px 4px 6px;
  border-radius: var(--yh-radius, 12px);
  border: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  background: var(--yh-surface, #1D1927);
  color: var(--yh-ink, #F2EFF7);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.yh-account-btn:hover {
  background: color-mix(in srgb, var(--yh-surface, #1D1927) 86%, var(--yh-ink, #F2EFF7));
}

.yh-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--yh-primary, #A78BFA);
  color: var(--yh-on-primary, #1B1526);
  font-size: 0.8125rem;
  font-weight: 700;
}

.yh-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.yh-account-name {
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yh-chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--yh-muted, #B8B3C7);
}

.yh-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 240px;
  padding: 8px;
  border-radius: var(--yh-radius, 12px);
  background: var(--yh-surface, #1D1927);
  border: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yh-menu[hidden] {
  display: none;
}

.yh-menu-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 10px;
}

.yh-menu-identity {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yh-menu-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--yh-ink, #F2EFF7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yh-menu-email {
  font-size: 0.75rem;
  color: var(--yh-muted, #B8B3C7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yh-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--yh-border, rgba(255, 255, 255, 0.1));
  border: 0;
}

.yh-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border-radius: calc(var(--yh-radius, 12px) - 4px);
  border: 0;
  background: transparent;
  color: var(--yh-ink, #F2EFF7);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.yh-menu-item:hover:not(:disabled),
.yh-menu-item:focus-visible {
  background: color-mix(in srgb, var(--yh-ink, #F2EFF7) 8%, transparent);
}

.yh-menu-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.yh-skeleton {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 6px;
}

.yh-skeleton-circle {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--yh-muted, #B8B3C7) 25%, transparent);
}

.yh-skeleton-bar {
  width: 72px;
  height: 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--yh-muted, #B8B3C7) 25%, transparent);
}

.yh-error-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.yh-muted-text {
  font-size: 0.8125rem;
  color: var(--yh-muted, #B8B3C7);
}

.yh-expired-notice,
.yh-logout-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 24px;
  background: var(--yh-surface, #1D1927);
  border-bottom: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  font-size: 0.875rem;
  color: var(--yh-ink, #F2EFF7);
}

.yh-mobile-toggle {
  display: none;
}

.yh-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.52);
  z-index: 60;
  display: flex;
  justify-content: flex-end;
}

.yh-sheet-backdrop[hidden] {
  display: none;
}

.yh-expired-notice[hidden], .yh-logout-notice[hidden] { display: none; }

.yh-sheet {
  width: 85vw;
  max-width: 360px;
  height: 100%;
  background: var(--yh-surface, #1D1927);
  color: var(--yh-ink, #F2EFF7);
  border-left: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.yh-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.yh-sheet-title {
  font-size: 1rem;
  font-weight: 700;
}

.yh-sheet-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.yh-sheet-nav:empty {
  display: none;
}

.yh-sheet-account {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--yh-border, rgba(255, 255, 255, 0.1));
}

.yh-sheet-account-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yh-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:focus-visible {
  outline: 2px solid var(--yh-focus, #A78BFA);
  outline-offset: 2px;
}

@media (min-width: 641px) and (max-width: 1023px) {
  .yh-account-name {
    display: none;
  }
}

@media (max-width: 640px) {
  .yh-bar {
    min-height: 56px;
    padding: 0 16px;
  }

  .yh-nav,
  .yh-account-desktop {
    display: none;
  }

  .yh-mobile-toggle {
    display: inline-flex;
  }

  .yh-expired-notice,
  .yh-logout-notice {
    padding: 8px 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeAvatarUrl(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

function hasUnsafeUrlChars(value: string): boolean {
  if (/\s/.test(value)) {
    return true
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || code === 0x5c) {
      return true
    }
  }
  return false
}

function extractRawAuthorityHost(raw: string): string | null {
  const schemeIdx = raw.indexOf('://')
  if (schemeIdx < 0) {
    return null
  }
  const afterScheme = raw.slice(schemeIdx + 3)
  const endIdx = afterScheme.search(/[/?#]/)
  const authority = endIdx >= 0 ? afterScheme.slice(0, endIdx) : afterScheme
  if (!authority || authority.includes('@') || authority.startsWith('[')) {
    return null
  }
  const colonIdx = authority.indexOf(':')
  const host = colonIdx >= 0 ? authority.slice(0, colonIdx) : authority
  return host.toLowerCase()
}

export function isAllowedAuthOrigin(
  input: URL | string,
  opts: { allowLocalhost: boolean } = { allowLocalhost: ALLOW_LOCALHOST },
): boolean {
  let url: URL
  if (typeof input === 'string') {
    if (!input || hasUnsafeUrlChars(input)) {
      return false
    }
    try {
      url = new URL(input)
    } catch {
      return false
    }
  } else {
    url = input
  }

  if (url.username || url.password) {
    return false
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'https:') {
    if (url.port !== '') {
      return false
    }
    return isAllowedHost(host)
  }
  if (url.protocol === 'http:') {
    if (!opts.allowLocalhost) {
      return false
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return false
    }
    if (typeof input === 'string') {
      const rawHost = extractRawAuthorityHost(input)
      return rawHost === 'localhost' || rawHost === '127.0.0.1'
    }
    return true
  }
  return false
}

function sanitizeAuthBase(raw: string | null): string {
  if (!raw || hasUnsafeUrlChars(raw)) {
    return DEFAULT_AUTH_BASE
  }
  try {
    const parsed = new URL(raw)
    return isAllowedAuthOrigin(raw, { allowLocalhost: ALLOW_LOCALHOST }) ? parsed.origin : DEFAULT_AUTH_BASE
  } catch {
    return DEFAULT_AUTH_BASE
  }
}

function sanitizeProfileUrl(raw: string | null, authBase: string): string {
  const fallback = `${authBase}/?view=profile`
  if (!raw || hasUnsafeUrlChars(raw)) {
    return fallback
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw
  }
  try {
    const parsed = new URL(raw)
    return isAllowedAuthOrigin(raw, { allowLocalhost: ALLOW_LOCALHOST }) ? parsed.href : fallback
  } catch {
    return fallback
  }
}

function buildNextUrl(currentHref: string): string {
  try {
    const url = new URL(currentHref)
    url.hash = ''
    url.searchParams.delete('auth')
    return url.toString()
  } catch {
    return currentHref
  }
}

function computeInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (words.length === 0) {
    return 'U'
  }
  return words
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}

function parseUserPayload(payload: unknown): YunHeaderUser | null {
  if (!isRecord(payload) || payload.ok === false) {
    return null
  }
  const rawUser = payload.user
  if (!isRecord(rawUser)) {
    return null
  }
  const id = readNonEmptyString(rawUser.id)
  if (!id) {
    return null
  }
  const email = readNonEmptyString(rawUser.email)
  const metadata = isRecord(rawUser.user_metadata) ? rawUser.user_metadata : null

  const rawDisplayName =
    readNonEmptyString(rawUser.display_name) ??
    (metadata ? readNonEmptyString(metadata.full_name) : null)

  const emailLocal = email ? email.split('@')[0]?.trim() || null : null
  const displayName = rawDisplayName ?? emailLocal ?? 'User'

  const rawAvatar =
    readNonEmptyString(rawUser.avatar_url) ??
    (metadata ? readNonEmptyString(metadata.avatar_url) : null)
  const avatarUrl = sanitizeAvatarUrl(rawAvatar)

  return {
    id,
    email,
    displayName,
    rawDisplayName,
    avatarUrl,
    initials: computeInitials(displayName),
  }
}

function readCsrfCookie(): string {
  if (typeof document === 'undefined' || !document.cookie) {
    return ''
  }
  let matched = ''
  for (const segment of document.cookie.split(';')) {
    const eqIndex = segment.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const key = segment.slice(0, eqIndex).trim()
    if (key !== 'csrf') {
      continue
    }
    const value = segment.slice(eqIndex + 1).trim()
    try {
      matched = decodeURIComponent(value)
    } catch {
      matched = value
    }
  }
  return matched
}

function createSvgIcon(pathD: string, className?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  if (className) {
    svg.setAttribute('class', className)
  }
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', pathD)
  svg.appendChild(path)
  return svg
}

function createAvatarNode(user: YunHeaderUser): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'yh-avatar'
  wrapper.setAttribute('aria-hidden', 'true')

  if (user.avatarUrl) {
    const img = document.createElement('img')
    img.src = user.avatarUrl
    img.alt = ''
    img.referrerPolicy = 'no-referrer'
    img.decoding = 'async'
    img.addEventListener('error', () => {
      img.remove()
      wrapper.textContent = user.initials
    })
    wrapper.appendChild(img)
  } else {
    wrapper.textContent = user.initials
  }
  return wrapper
}

export class YunHeader extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['app', 'auth-base', 'variant', 'profile-url', 'hide-account', 'skip-target']
  }

  private _state: YunHeaderState = 'loading'
  private _lastStableState: YunHeaderState = 'loading'
  private _user: YunHeaderUser | null = null
  private _stale = false
  private _menuOpen = false
  private _sheetOpen = false
  private _loggingOut = false
  private _logoutError = false
  private _abortController: AbortController | null = null
  private _refreshPromise: Promise<boolean> | null = null
  private _loadingTimer: ReturnType<typeof setTimeout> | null = null
  private _lastAnnouncedAuthKey: string | null = null
  private _rendered = false

  private _shadow: ShadowRoot
  private _skipLink!: HTMLAnchorElement
  private _accountDesktop!: HTMLDivElement
  private _expiredNotice!: HTMLDivElement
  private _logoutNotice!: HTMLDivElement
  private _mobileToggleBtn!: HTMLButtonElement
  private _sheetBackdrop!: HTMLDivElement
  private _sheetDialog!: HTMLDivElement
  private _sheetCloseBtn!: HTMLButtonElement
  private _sheetNav!: HTMLDivElement
  private _sheetAccount!: HTMLDivElement
  private _navSlot!: HTMLSlotElement
  private _liveRegion!: HTMLDivElement
  private _accountButtonEl: HTMLButtonElement | null = null
  private _menuEl: HTMLDivElement | null = null

  private readonly _onWindowFocus = () => {
    void this.refresh()
  }

  private readonly _onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.refresh()
    }
  }

  private readonly _onDocumentClick = (event: MouseEvent) => {
    if (!this._menuOpen) {
      return
    }
    const path = event.composedPath()
    if (!path.includes(this._accountDesktop)) {
      this._setMenuOpen(false, false)
    }
  }

  private readonly _onDocumentKeyDown = (event: KeyboardEvent) => {
    if (this._sheetOpen && event.key === 'Escape') {
      event.preventDefault()
      this._setSheetOpen(false, true)
      return
    }
    if (this._menuOpen && event.key === 'Escape') {
      event.preventDefault()
      this._setMenuOpen(false, true)
    }
  }

  constructor() {
    super()
    this._shadow = this.attachShadow({ mode: 'open' })
  }

  get state(): YunHeaderState {
    return this._state
  }

  get user(): YunHeaderUser | null {
    return this._user
  }

  get stale(): boolean {
    return this._stale
  }

  private get authBase(): string {
    return sanitizeAuthBase(this.getAttribute('auth-base'))
  }

  private get profileUrl(): string {
    return sanitizeProfileUrl(this.getAttribute('profile-url'), this.authBase)
  }

  private get hideAccount(): boolean {
    return this.hasAttribute('hide-account')
  }

  private get skipTarget(): string {
    const raw = this.getAttribute('skip-target')?.trim()
    return raw && SKIP_TARGET_PATTERN.test(raw) ? raw : '#main'
  }

  connectedCallback(): void {
    this._ensureDom()
    this._syncAttributes()
    window.addEventListener('focus', this._onWindowFocus)
    document.addEventListener('visibilitychange', this._onVisibilityChange)
    document.addEventListener('click', this._onDocumentClick)
    document.addEventListener('keydown', this._onDocumentKeyDown)
    void this.refresh()
  }

  disconnectedCallback(): void {
    window.removeEventListener('focus', this._onWindowFocus)
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    document.removeEventListener('click', this._onDocumentClick)
    document.removeEventListener('keydown', this._onDocumentKeyDown)
    this._abortPending()
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this._rendered) {
      return
    }
    this._syncAttributes()
    if (name === 'auth-base') {
      void this.refresh()
    } else if (name === 'hide-account' || name === 'profile-url') {
      this._renderAccountRegions()
    }
  }

  async refresh(): Promise<void> {
    this._abortPending()

    const controller = new AbortController()
    this._abortController = controller
    const wasSignedIn = this._lastStableState === 'signed-in'

    if (this._state !== 'signed-in') {
      this._state = 'loading'
      this._renderAccountRegions()
    }

    let timedOut = false
    const timerId = setTimeout(() => {
      timedOut = true
      controller.abort('timeout')
    }, LOADING_TIMEOUT_MS)
    this._loadingTimer = timerId

    try {
      let response = await fetch(`${this.authBase}/api/auth/me`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        if (timedOut) {
          throw new Error('Request timed out')
        }
        return
      }

      if (response.status === 401 && readCsrfCookie()) {
        const refreshed = await this._raceWithAbort(this._tryRefreshSession(), controller.signal)
        if (controller.signal.aborted) {
          if (timedOut) {
            throw new Error('Request timed out')
          }
          return
        }
        if (refreshed) {
          response = await fetch(`${this.authBase}/api/auth/me`, {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
          })
          if (controller.signal.aborted) {
            if (timedOut) {
              throw new Error('Request timed out')
            }
            return
          }
        }
      }

      if (response.status === 200) {
        let payload: unknown = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        const parsedUser = parseUserPayload(payload)
        if (parsedUser) {
          const shouldAnnounce =
            this._lastStableState !== 'signed-in' || this._user?.id !== parsedUser.id
          this._stale = false
          this._state = 'signed-in'
          this._lastStableState = 'signed-in'
          this._user = parsedUser
          if (shouldAnnounce) {
            this._announce(`Đã đăng nhập với tên ${parsedUser.displayName}`)
          }
        } else {
          this._applySignedOutOrExpired(wasSignedIn)
        }
      } else if (response.status === 401) {
        this._applySignedOutOrExpired(wasSignedIn)
      } else {
        this._stale = false
        this._logoutError = false
        this._state = 'error'
        this._lastStableState = 'error'
        this._user = null
      }
    } catch {
      if (timedOut) {
        if (wasSignedIn && this._user) {
          this._stale = true
          this._state = 'signed-in'
          this._lastStableState = 'signed-in'
        } else {
          this._stale = false
          this._logoutError = false
          this._state = 'signed-out'
          this._lastStableState = 'signed-out'
          this._user = null
        }
      } else if (controller.signal.aborted) {
        return
      } else {
        this._stale = false
        this._logoutError = false
        this._state = 'error'
        this._lastStableState = 'error'
        this._user = null
      }
    } finally {
      clearTimeout(timerId)
      if (this._loadingTimer === timerId) {
        this._loadingTimer = null
      }
      if (this._abortController === controller) {
        this._abortController = null
      }
    }

    this._renderAccountRegions()
    this._dispatchAuthChange()
  }

  private _raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new Error('Aborted'))
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(new Error('Aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (err: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(err instanceof Error ? err : new Error('Refresh failed'))
        },
      )
    })
  }

  private async _tryRefreshSession(): Promise<boolean> {
    const csrfToken = readCsrfCookie()
    if (!csrfToken) {
      return false
    }
    if (this._refreshPromise) {
      return this._refreshPromise
    }

    this._refreshPromise = (async () => {
      try {
        const freshCsrf = readCsrfCookie()
        if (!freshCsrf) {
          return false
        }
        const response = await fetch(`${this.authBase}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'x-csrf-token': freshCsrf,
          },
        })
        return response.status === 200
      } catch {
        return false
      } finally {
        this._refreshPromise = null
      }
    })()

    return this._refreshPromise
  }

  private _applySignedOutOrExpired(wasSignedIn: boolean): void {
    this._stale = false
    this._logoutError = false
    this._user = null
    this._menuOpen = false
    if (wasSignedIn) {
      this._state = 'expired'
      this._lastStableState = 'expired'
    } else {
      this._state = 'signed-out'
      this._lastStableState = 'signed-out'
    }
  }

  private _abortPending(): void {
    if (this._loadingTimer !== null) {
      clearTimeout(this._loadingTimer)
      this._loadingTimer = null
    }
    if (this._abortController) {
      this._abortController.abort('superseded')
      this._abortController = null
    }
  }

  private _ensureDom(): void {
    if (this._rendered) {
      return
    }
    this._rendered = true

    const styleEl = document.createElement('style')
    styleEl.textContent = STYLES

    const header = document.createElement('header')
    header.setAttribute('part', 'bar')
    header.className = 'yh-bar'

    this._skipLink = document.createElement('a')
    this._skipLink.className = 'yh-skip-link'
    this._skipLink.textContent = 'Bỏ qua đến nội dung'

    const left = document.createElement('div')
    left.className = 'yh-left'
    const brandSlot = document.createElement('slot')
    brandSlot.name = 'brand'
    left.appendChild(brandSlot)

    const nav = document.createElement('nav')
    nav.className = 'yh-nav'
    nav.setAttribute('aria-label', 'Điều hướng chính')
    this._navSlot = document.createElement('slot')
    this._navSlot.name = 'nav'
    this._navSlot.addEventListener('slotchange', () => {
      if (this._sheetOpen) {
        this._syncMobileNavClone()
      }
    })
    nav.appendChild(this._navSlot)

    const right = document.createElement('div')
    right.className = 'yh-right'
    const actionsSlot = document.createElement('slot')
    actionsSlot.name = 'actions'
    this._accountDesktop = document.createElement('div')
    this._accountDesktop.className = 'yh-account-desktop'

    this._mobileToggleBtn = document.createElement('button')
    this._mobileToggleBtn.type = 'button'
    this._mobileToggleBtn.className = 'yh-btn yh-btn-icon yh-mobile-toggle'
    this._mobileToggleBtn.setAttribute('aria-label', 'Mở menu')
    this._mobileToggleBtn.setAttribute('aria-expanded', 'false')
    this._mobileToggleBtn.appendChild(createSvgIcon('M4 6h16M4 12h16M4 18h16'))
    this._mobileToggleBtn.addEventListener('click', () => {
      this._setSheetOpen(!this._sheetOpen, false)
    })

    right.append(actionsSlot, this._accountDesktop, this._mobileToggleBtn)
    header.append(this._skipLink, left, nav, right)

    this._expiredNotice = document.createElement('div')
    this._expiredNotice.className = 'yh-expired-notice'
    this._expiredNotice.setAttribute('role', 'status')
    this._expiredNotice.hidden = true

    const expiredText = document.createElement('span')
    expiredText.textContent = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    const reloginBtn = document.createElement('button')
    reloginBtn.type = 'button'
    reloginBtn.className = 'yh-btn yh-btn-primary'
    reloginBtn.textContent = 'Đăng nhập lại'
    reloginBtn.addEventListener('click', () => {
      this._handleAuthClick('signin')
    })
    this._expiredNotice.append(expiredText, reloginBtn)

    this._logoutNotice = document.createElement('div')
    this._logoutNotice.className = 'yh-logout-notice'
    this._logoutNotice.setAttribute('role', 'alert')
    this._logoutNotice.hidden = true

    const logoutErrorText = document.createElement('span')
    logoutErrorText.textContent = 'Đăng xuất không thành công, bạn vẫn đang đăng nhập.'
    const logoutRetryBtn = document.createElement('button')
    logoutRetryBtn.type = 'button'
    logoutRetryBtn.className = 'yh-btn yh-btn-primary'
    logoutRetryBtn.textContent = 'Thử lại'
    logoutRetryBtn.addEventListener('click', () => {
      void this._handleLogout()
    })
    this._logoutNotice.append(logoutErrorText, logoutRetryBtn)

    this._sheetBackdrop = document.createElement('div')
    this._sheetBackdrop.className = 'yh-sheet-backdrop'
    this._sheetBackdrop.hidden = true
    this._sheetBackdrop.addEventListener('click', (event) => {
      if (event.target === this._sheetBackdrop) {
        this._setSheetOpen(false, true)
      }
    })

    this._sheetDialog = document.createElement('div')
    this._sheetDialog.className = 'yh-sheet'
    this._sheetDialog.setAttribute('role', 'dialog')
    this._sheetDialog.setAttribute('aria-modal', 'true')
    this._sheetDialog.setAttribute('aria-label', 'Menu')
    this._sheetDialog.addEventListener('keydown', (event) => {
      this._handleSheetKeyDown(event)
    })

    const sheetHeader = document.createElement('div')
    sheetHeader.className = 'yh-sheet-header'
    const sheetTitle = document.createElement('span')
    sheetTitle.className = 'yh-sheet-title'
    sheetTitle.textContent = 'Menu'
    this._sheetCloseBtn = document.createElement('button')
    this._sheetCloseBtn.type = 'button'
    this._sheetCloseBtn.className = 'yh-btn yh-btn-icon'
    this._sheetCloseBtn.setAttribute('aria-label', 'Đóng menu')
    this._sheetCloseBtn.appendChild(createSvgIcon('M18 6L6 18M6 6l12 12'))
    this._sheetCloseBtn.addEventListener('click', () => {
      this._setSheetOpen(false, true)
    })
    sheetHeader.append(sheetTitle, this._sheetCloseBtn)

    this._sheetNav = document.createElement('div')
    this._sheetNav.className = 'yh-sheet-nav'

    this._sheetAccount = document.createElement('div')
    this._sheetAccount.className = 'yh-sheet-account'

    this._sheetDialog.append(sheetHeader, this._sheetNav, this._sheetAccount)
    this._sheetBackdrop.appendChild(this._sheetDialog)

    this._liveRegion = document.createElement('div')
    this._liveRegion.className = 'yh-sr-only'
    this._liveRegion.setAttribute('aria-live', 'polite')
    this._liveRegion.setAttribute('aria-atomic', 'true')

    this._shadow.append(
      styleEl,
      header,
      this._expiredNotice,
      this._logoutNotice,
      this._sheetBackdrop,
      this._liveRegion,
    )
  }

  private _syncAttributes(): void {
    this._skipLink.href = this.skipTarget
  }

  private _announce(message: string): void {
    if (!this._liveRegion || this._lastAnnouncedAuthKey === message) {
      return
    }
    this._lastAnnouncedAuthKey = message
    this._liveRegion.textContent = message
  }

  private _dispatchAuthChange(): void {
    this.dispatchEvent(
      new CustomEvent<YunHeaderAuthChangeDetail>('yh-auth-change', {
        detail: { state: this._state, user: this._user },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _handleAuthClick(mode: 'signin' | 'signup'): void {
    const eventName = mode === 'signin' ? 'yh-signin-click' : 'yh-signup-click'
    const ev = new CustomEvent(eventName, {
      bubbles: true,
      composed: true,
      cancelable: true,
    })
    const notPrevented = this.dispatchEvent(ev)
    if (this._sheetOpen) {
      this._setSheetOpen(false, false)
    }
    if (notPrevented) {
      const next = encodeURIComponent(buildNextUrl(window.location.href))
      window.location.assign(`${this.authBase}/?auth=${mode}&next=${next}`)
    }
  }

  private async _handleLogout(): Promise<void> {
    if (this._loggingOut) {
      return
    }
    this._loggingOut = true
    this._logoutError = false
    this._renderAccountRegions()

    let ok = false
    try {
      const csrfToken = readCsrfCookie()
      const response = await fetch(`${this.authBase}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrfToken,
        },
      })
      ok = response.ok
    } catch {
      ok = false
    }

    this._loggingOut = false
    this._menuOpen = false
    if (this._sheetOpen) {
      this._setSheetOpen(false, false)
    }

    if (!ok) {
      this._logoutError = true
      this._renderAccountRegions()
      return
    }

    this._logoutError = false
    this._stale = false
    this._lastStableState = 'signed-out'
    this._announce('Đã đăng xuất')
    await this.refresh()
    this.dispatchEvent(
      new CustomEvent('yh-logout', {
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _setMenuOpen(open: boolean, returnFocus: boolean): void {
    if (this._menuOpen === open) {
      return
    }
    this._menuOpen = open
    if (this._accountButtonEl) {
      this._accountButtonEl.setAttribute('aria-expanded', String(open))
    }
    if (this._menuEl) {
      this._menuEl.hidden = !open
    }
    if (!open && returnFocus) {
      this._accountButtonEl?.focus()
    }
  }

  private _focusMenuItem(index: number): void {
    if (!this._menuEl) {
      return
    }
    const items = Array.from(this._menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    if (items.length === 0) {
      return
    }
    const normalized = ((index % items.length) + items.length) % items.length
    items[normalized]?.focus()
  }

  private _handleMenuKeyDown(event: KeyboardEvent): void {
    if (!this._menuEl) {
      return
    }
    const items = Array.from(this._menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    if (items.length === 0) {
      return
    }
    const active = this._shadow.activeElement as HTMLElement | null
    const currentIndex = active ? items.indexOf(active) : -1

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        this._focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        this._focusMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1)
        break
      case 'Home':
        event.preventDefault()
        this._focusMenuItem(0)
        break
      case 'End':
        event.preventDefault()
        this._focusMenuItem(items.length - 1)
        break
      case 'Escape':
        event.preventDefault()
        this._setMenuOpen(false, true)
        break
      case 'Tab':
        this._setMenuOpen(false, false)
        break
    }
  }

  private _setSheetOpen(open: boolean, returnFocus: boolean): void {
    if (this._sheetOpen === open) {
      return
    }
    this._sheetOpen = open
    this._sheetBackdrop.hidden = !open
    this._mobileToggleBtn.setAttribute('aria-expanded', String(open))
    this._mobileToggleBtn.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu')

    if (open) {
      this._syncMobileNavClone()
      this._sheetCloseBtn.focus()
    } else if (returnFocus) {
      this._mobileToggleBtn.focus()
    }

    this.dispatchEvent(
      new CustomEvent<YunHeaderMenuToggleDetail>('yh-menu-toggle', {
        detail: { open },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _syncMobileNavClone(): void {
    this._sheetNav.replaceChildren()
    const assigned = this._navSlot.assignedElements({ flatten: true })
    for (const node of assigned) {
      const cloned = node.cloneNode(true)
      if (cloned instanceof HTMLElement) {
        cloned.removeAttribute('slot')
        cloned.addEventListener('click', (event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('a')) {
            this._setSheetOpen(false, false)
          }
        })
      }
      this._sheetNav.appendChild(cloned)
    }
  }

  private _handleSheetKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return
    }
    const focusables = Array.from(
      this._sheetDialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('hidden'))

    if (focusables.length === 0) {
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = this._shadow.activeElement as HTMLElement | null

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  private _renderAccountRegions(): void {
    if (!this._rendered) {
      return
    }

    this._expiredNotice.hidden = this.hideAccount || this._state !== 'expired'
    this._logoutNotice.hidden = this.hideAccount || !this._logoutError || this._state !== 'signed-in'

    if (this.hideAccount) {
      this._accountDesktop.hidden = true
      this._accountDesktop.replaceChildren()
      this._sheetAccount.hidden = true
      this._sheetAccount.replaceChildren()
      this._accountButtonEl = null
      this._menuEl = null
      return
    }

    this._accountDesktop.hidden = false
    this._sheetAccount.hidden = false
    this._renderDesktopAccount()
    this._renderSheetAccount()
  }

  private _renderDesktopAccount(): void {
    this._accountDesktop.replaceChildren()
    this._accountButtonEl = null
    this._menuEl = null

    if (this._state === 'loading') {
      const skel = document.createElement('div')
      skel.className = 'yh-skeleton'
      skel.setAttribute('aria-busy', 'true')
      skel.setAttribute('aria-label', 'Đang tải tài khoản')
      const circle = document.createElement('span')
      circle.className = 'yh-skeleton-circle'
      const bar = document.createElement('span')
      bar.className = 'yh-skeleton-bar'
      skel.append(circle, bar)
      this._accountDesktop.appendChild(skel)
      return
    }

    if (this._state === 'error') {
      const errWrap = document.createElement('div')
      errWrap.className = 'yh-error-inline'
      const msg = document.createElement('span')
      msg.className = 'yh-muted-text'
      msg.textContent = 'Không tải được tài khoản'
      const retryBtn = document.createElement('button')
      retryBtn.type = 'button'
      retryBtn.className = 'yh-btn yh-btn-icon'
      retryBtn.setAttribute('aria-label', 'Thử lại')
      retryBtn.title = 'Thử lại'
      retryBtn.appendChild(createSvgIcon('M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'))
      retryBtn.addEventListener('click', () => {
        void this.refresh()
      })
      errWrap.append(msg, retryBtn)
      this._accountDesktop.appendChild(errWrap)
      return
    }

    if (this._state === 'signed-in' && this._user) {
      const user = this._user
      const accountBtn = document.createElement('button')
      accountBtn.type = 'button'
      accountBtn.className = 'yh-account-btn'
      accountBtn.setAttribute('part', 'account-button')
      accountBtn.setAttribute('aria-haspopup', 'menu')
      accountBtn.setAttribute('aria-expanded', String(this._menuOpen))
      accountBtn.setAttribute('aria-label', `Tài khoản: ${user.displayName}`)

      const nameSpan = document.createElement('span')
      nameSpan.className = 'yh-account-name'
      nameSpan.textContent = user.displayName

      const chevron = createSvgIcon('M6 9l6 6 6-6', 'yh-chevron')
      accountBtn.append(createAvatarNode(user), nameSpan, chevron)

      accountBtn.addEventListener('click', () => {
        this._setMenuOpen(!this._menuOpen, false)
      })
      accountBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault()
          this._setMenuOpen(true, false)
          this._focusMenuItem(0)
        } else if (event.key === 'Escape' && this._menuOpen) {
          event.preventDefault()
          this._setMenuOpen(false, false)
        }
      })

      const menu = document.createElement('div')
      menu.className = 'yh-menu'
      menu.setAttribute('part', 'menu')
      menu.setAttribute('role', 'menu')
      menu.hidden = !this._menuOpen
      menu.addEventListener('keydown', (event) => {
        this._handleMenuKeyDown(event)
      })

      const headerRow = document.createElement('div')
      headerRow.className = 'yh-menu-header'
      const identity = document.createElement('div')
      identity.className = 'yh-menu-identity'
      const menuName = document.createElement('span')
      menuName.className = 'yh-menu-name'
      menuName.textContent = user.displayName
      const menuEmail = document.createElement('span')
      menuEmail.className = 'yh-menu-email'
      menuEmail.textContent = user.email ?? ''
      identity.append(menuName, menuEmail)
      headerRow.append(createAvatarNode(user), identity)

      const profileLink = document.createElement('a')
      profileLink.className = 'yh-menu-item'
      profileLink.setAttribute('role', 'menuitem')
      profileLink.href = this.profileUrl
      profileLink.textContent = 'Hồ sơ'

      const homeLink = document.createElement('a')
      homeLink.className = 'yh-menu-item'
      homeLink.setAttribute('role', 'menuitem')
      homeLink.href = this.authBase
      homeLink.textContent = 'Về YunDev.space'

      const divider = document.createElement('hr')
      divider.className = 'yh-menu-divider'
      divider.setAttribute('role', 'separator')

      const logoutBtn = document.createElement('button')
      logoutBtn.type = 'button'
      logoutBtn.className = 'yh-menu-item'
      logoutBtn.setAttribute('role', 'menuitem')
      logoutBtn.disabled = this._loggingOut
      logoutBtn.textContent = this._loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất (mọi site)'
      logoutBtn.addEventListener('click', () => {
        void this._handleLogout()
      })

      menu.append(headerRow, profileLink, homeLink, divider, logoutBtn)

      this._accountButtonEl = accountBtn
      this._menuEl = menu
      this._accountDesktop.append(accountBtn, menu)
      return
    }

    // signed-out or expired
    const signInBtn = document.createElement('button')
    signInBtn.type = 'button'
    signInBtn.className = 'yh-btn yh-btn-text'
    signInBtn.textContent = 'Đăng nhập'
    signInBtn.addEventListener('click', () => {
      this._handleAuthClick('signin')
    })

    const signUpBtn = document.createElement('button')
    signUpBtn.type = 'button'
    signUpBtn.className = 'yh-btn yh-btn-primary'
    signUpBtn.textContent = 'Đăng ký'
    signUpBtn.addEventListener('click', () => {
      this._handleAuthClick('signup')
    })

    this._accountDesktop.append(signInBtn, signUpBtn)
  }

  private _renderSheetAccount(): void {
    this._sheetAccount.replaceChildren()

    if (this._state === 'loading') {
      const skel = document.createElement('div')
      skel.className = 'yh-skeleton'
      skel.setAttribute('aria-busy', 'true')
      const circle = document.createElement('span')
      circle.className = 'yh-skeleton-circle'
      const bar = document.createElement('span')
      bar.className = 'yh-skeleton-bar'
      skel.append(circle, bar)
      this._sheetAccount.appendChild(skel)
      return
    }

    if (this._state === 'error') {
      const errWrap = document.createElement('div')
      errWrap.className = 'yh-error-inline'
      const msg = document.createElement('span')
      msg.className = 'yh-muted-text'
      msg.textContent = 'Không tải được tài khoản'
      const retryBtn = document.createElement('button')
      retryBtn.type = 'button'
      retryBtn.className = 'yh-btn yh-btn-icon'
      retryBtn.setAttribute('aria-label', 'Thử lại')
      retryBtn.appendChild(createSvgIcon('M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'))
      retryBtn.addEventListener('click', () => {
        void this.refresh()
      })
      errWrap.append(msg, retryBtn)
      this._sheetAccount.appendChild(errWrap)
      return
    }

    if (this._state === 'signed-in' && this._user) {
      const user = this._user
      const headerRow = document.createElement('div')
      headerRow.className = 'yh-menu-header'
      const identity = document.createElement('div')
      identity.className = 'yh-menu-identity'
      const nameEl = document.createElement('span')
      nameEl.className = 'yh-menu-name'
      nameEl.textContent = user.displayName
      const emailEl = document.createElement('span')
      emailEl.className = 'yh-menu-email'
      emailEl.textContent = user.email ?? ''
      identity.append(nameEl, emailEl)
      headerRow.append(createAvatarNode(user), identity)

      const actions = document.createElement('div')
      actions.className = 'yh-sheet-account-actions'

      const profileLink = document.createElement('a')
      profileLink.className = 'yh-menu-item'
      profileLink.href = this.profileUrl
      profileLink.textContent = 'Hồ sơ'

      const homeLink = document.createElement('a')
      homeLink.className = 'yh-menu-item'
      homeLink.href = this.authBase
      homeLink.textContent = 'Về YunDev.space'

      const logoutBtn = document.createElement('button')
      logoutBtn.type = 'button'
      logoutBtn.className = 'yh-menu-item'
      logoutBtn.disabled = this._loggingOut
      logoutBtn.textContent = this._loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất (mọi site)'
      logoutBtn.addEventListener('click', () => {
        void this._handleLogout()
      })

      actions.append(profileLink, homeLink, logoutBtn)
      this._sheetAccount.append(headerRow, actions)
      return
    }

    const actions = document.createElement('div')
    actions.className = 'yh-sheet-account-actions'
    const signInBtn = document.createElement('button')
    signInBtn.type = 'button'
    signInBtn.className = 'yh-btn yh-btn-text'
    signInBtn.textContent = 'Đăng nhập'
    signInBtn.addEventListener('click', () => {
      this._handleAuthClick('signin')
    })

    const signUpBtn = document.createElement('button')
    signUpBtn.type = 'button'
    signUpBtn.className = 'yh-btn yh-btn-primary'
    signUpBtn.textContent = 'Đăng ký'
    signUpBtn.addEventListener('click', () => {
      this._handleAuthClick('signup')
    })

    actions.append(signInBtn, signUpBtn)
    this._sheetAccount.appendChild(actions)
  }
}
