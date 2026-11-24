const ALLOWED_APEX_HOST = 'yundev.space'
const ALLOWED_SUBDOMAIN_SUFFIX = '.yundev.space'
const HTTPS_PREFIX_PATTERN = /^https:\/\//i
const SAME_ORIGIN_BASE = 'https://yundev.space'

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function isAllowedHost(host: string): boolean {
  const normalized = host.toLowerCase()
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

function readNextParam(search: string): string | null {
  return new URLSearchParams(search).get('next')
}

export function hasNextParam(search: string): boolean {
  const raw = readNextParam(search)
  return raw !== null && raw.trim().length > 0
}

export function resolveNextTarget(search: string, fallback = '/'): string {
  const raw = readNextParam(search)
  if (raw === null || hasControlChars(raw)) {
    return fallback
  }

  const candidate = raw.trim()
  if (candidate.length === 0) {
    return fallback
  }

  if (candidate.startsWith('/')) {
    if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
      return fallback
    }
    try {
      const parsed = new URL(candidate, SAME_ORIGIN_BASE)
      if (parsed.origin !== SAME_ORIGIN_BASE) {
        return fallback
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      return fallback
    }
  }

  if (!HTTPS_PREFIX_PATTERN.test(candidate)) {
    return fallback
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:') {
      return fallback
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return fallback
    }
    if (parsed.port !== '') {
      return fallback
    }
    if (!isAllowedHost(parsed.hostname)) {
      return fallback
    }
    return parsed.href
  } catch {
    return fallback
  }
}

export function getNextTargetLabel(search: string): string | null {
  if (!hasNextParam(search)) {
    return null
  }
  const resolved = resolveNextTarget(search)
  if (resolved.startsWith('/')) {
    return 'this site'
  }
  try {
    const parsed = new URL(resolved)
    return parsed.host || 'this site'
  } catch {
    return 'this site'
  }
}
