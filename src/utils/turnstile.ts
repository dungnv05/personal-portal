export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileRenderOptions = {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: (errorCode?: string) => void
  theme?: 'light' | 'dark' | 'auto'
}

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined
  remove: (widgetId: string) => void
  reset?: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptLoadPromise: Promise<void> | null = null
let loggedMissingSiteKey = false

export function getTurnstileSiteKey(): string {
  const raw: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY
  return typeof raw === 'string' ? raw.trim() : ''
}

export function hasTurnstileSiteKey(): boolean {
  return getTurnstileSiteKey().length > 0
}

export function consumeMissingSiteKeyLogFlag(): boolean {
  if (loggedMissingSiteKey) {
    return false
  }
  loggedMissingSiteKey = true
  return true
}

export function resetTurnstileLoaderForTests(): void {
  scriptLoadPromise = null
  loggedMissingSiteKey = false
}

export function loadTurnstileScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.resolve()
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
  )

  if (existing) {
    if (typeof window !== 'undefined' && window.turnstile) {
      return Promise.resolve()
    }
    if (scriptLoadPromise) {
      return scriptLoadPromise
    }
    scriptLoadPromise = new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => {
          scriptLoadPromise = null
          existing.remove()
          reject(new Error('Failed to load Cloudflare Turnstile script.'))
        },
        { once: true },
      )
    })
    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.defer = true
    script.async = true

    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => {
        scriptLoadPromise = null
        script.remove()
        reject(new Error('Failed to load Cloudflare Turnstile script.'))
      },
      { once: true },
    )

    document.head.appendChild(script)

    if (typeof window !== 'undefined' && window.turnstile) {
      resolve()
    }
  })

  return scriptLoadPromise
}
