import { useEffect, useRef } from 'react'
import {
  consumeMissingSiteKeyLogFlag,
  getTurnstileSiteKey,
  loadTurnstileScript,
  type TurnstileRenderOptions,
} from '../utils/turnstile'

export type TurnstileProps = {
  onToken: (token: string | null) => void
  siteKey?: string
  theme?: 'light' | 'dark' | 'auto'
  scriptLoader?: () => Promise<void>
}

export function Turnstile({
  onToken,
  siteKey,
  theme,
  scriptLoader = loadTurnstileScript,
}: TurnstileProps) {
  const resolvedSiteKey = (siteKey ?? getTurnstileSiteKey()).trim()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onTokenRef = useRef(onToken)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!resolvedSiteKey) {
      if (consumeMissingSiteKeyLogFlag()) {
        console.info('[Turnstile] VITE_TURNSTILE_SITE_KEY is not configured; CAPTCHA disabled.')
      }
      onTokenRef.current(null)
      return
    }

    let cancelled = false
    let widgetId: string | null = null

    void scriptLoader()
      .then(() => {
        if (cancelled) {
          return
        }
        const container = containerRef.current
        const api = typeof window !== 'undefined' ? window.turnstile : undefined
        if (!container || !api) {
          onTokenRef.current(null)
          return
        }

        const options: TurnstileRenderOptions = {
          sitekey: resolvedSiteKey,
          ...(theme ? { theme } : {}),
          callback: (token: string) => {
            if (!cancelled) {
              onTokenRef.current(token)
            }
          },
          'expired-callback': () => {
            if (!cancelled) {
              onTokenRef.current(null)
            }
          },
          'error-callback': () => {
            if (!cancelled) {
              onTokenRef.current(null)
            }
          },
        }

        const renderedId = api.render(container, options)
        widgetId = renderedId && renderedId.length > 0 ? renderedId : null
      })
      .catch(() => {
        if (!cancelled) {
          onTokenRef.current(null)
        }
      })

    return () => {
      cancelled = true
      if (widgetId !== null && typeof window !== 'undefined' && window.turnstile) {
        try {
          window.turnstile.remove(widgetId)
        } catch {
          // Ignore teardown errors if the widget was already detached.
        }
      }
      widgetId = null
    }
  }, [resolvedSiteKey, theme, scriptLoader])

  if (!resolvedSiteKey) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="turnstile-container"
      data-testid="turnstile-widget"
    />
  )
}

export default Turnstile
