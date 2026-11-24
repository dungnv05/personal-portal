const ALLOWED_APEX_HOST = 'yundev.space'
const ALLOWED_SUBDOMAIN_SUFFIX = '.yundev.space'
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

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === ALLOWED_APEX_HOST) {
    return true
  }
  if (!normalized.endsWith(ALLOWED_SUBDOMAIN_SUFFIX)) {
    return false
  }
  if (normalized.length <= ALLOWED_SUBDOMAIN_SUFFIX.length) {
    return false
  }
  if (normalized.startsWith('.') || normalized.includes('..')) {
    return false
  }
  return true
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
