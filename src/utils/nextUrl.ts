import { isAllowedHost } from '../../shared/allowed-origins.js'

const HTTPS_SCHEME_PREFIX = /^https:\/\//i

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

export function resolveNextUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get('next')
  if (raw === null || hasControlChars(raw)) {
    return null
  }

  const candidate = raw.trim()
  if (candidate.length === 0 || !HTTPS_SCHEME_PREFIX.test(candidate)) {
    return null
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:') {
      return null
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return null
    }
    if (parsed.port !== '') {
      return null
    }
    if (!isAllowedHost(parsed.hostname)) {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}
