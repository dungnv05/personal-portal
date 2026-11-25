const LITERAL_MARKERS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_JWT_SECRET',
  'service_role',
]

const SB_SECRET_KEY_REGEX = /sb_secret_[A-Za-z0-9_-]{20,}/g
const JWT_REGEX = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

function countLiteralOccurrences(text, needle) {
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

function decodeBase64Url(segment) {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (normalized.length % 4)) % 4
    const padded = normalized + '='.repeat(padLen)

    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf8')
    }
    if (typeof atob === 'function') {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new TextDecoder().decode(bytes)
    }
    return null
  } catch {
    return null
  }
}

function isServiceRoleJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) {
    return false
  }
  const decoded = decodeBase64Url(parts[1])
  if (!decoded) {
    return false
  }
  try {
    const payload = JSON.parse(decoded)
    return Boolean(payload && typeof payload === 'object' && payload.role === 'service_role')
  } catch {
    return false
  }
}

/**
 * Scan bundle text for forbidden server-side secret markers.
 * Returns only marker names and counts, never matched secret values.
 */
export function findSecretMarkers(code) {
  if (typeof code !== 'string' || code.length === 0) {
    return []
  }

  const results = []

  for (const name of LITERAL_MARKERS) {
    const count = countLiteralOccurrences(code, name)
    if (count > 0) {
      results.push({ name, count })
    }
  }

  const sbSecretMatches = code.match(SB_SECRET_KEY_REGEX)
  if (sbSecretMatches && sbSecretMatches.length > 0) {
    results.push({ name: 'sb_secret_key', count: sbSecretMatches.length })
  }

  const jwtMatches = code.match(JWT_REGEX)
  if (jwtMatches && jwtMatches.length > 0) {
    let serviceRoleJwtCount = 0
    for (const token of jwtMatches) {
      if (isServiceRoleJwt(token)) {
        serviceRoleJwtCount += 1
      }
    }
    if (serviceRoleJwtCount > 0) {
      results.push({ name: 'service_role_jwt', count: serviceRoleJwtCount })
    }
  }

  return results
}

function extractOutputText(output, decoder) {
  if (!output || typeof output !== 'object') {
    return ''
  }
  if (typeof output.code === 'string') {
    return output.code
  }
  if (typeof output.source === 'string') {
    return output.source
  }
  if (output.source instanceof Uint8Array || ArrayBuffer.isView(output.source)) {
    return decoder.decode(output.source)
  }
  return ''
}

/**
 * Vite build plugin that fails the build if any chunk or asset contains
 * forbidden server secret markers.
 */
export function bundleSecretGuard() {
  const decoder = new TextDecoder()

  return {
    name: 'bundle-secret-guard',
    apply: 'build',
    generateBundle(_, bundle) {
      if (!bundle || typeof bundle !== 'object') {
        return
      }

      const offenses = []

      for (const [fileName, output] of Object.entries(bundle)) {
        const text = extractOutputText(output, decoder)
        if (!text) {
          continue
        }

        const markers = findSecretMarkers(text)
        if (markers.length > 0) {
          const summary = markers.map((marker) => `${marker.name}=${marker.count}`).join(', ')
          offenses.push(`${fileName}: ${summary}`)
        }
      }

      if (offenses.length > 0) {
        this.error(`bundle-secret-guard: forbidden secret markers in ${offenses.join('; ')}`)
      }
    },
  }
}
