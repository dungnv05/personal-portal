export type RefreshOutcome = 'ok' | 'retry' | 'failed'

const REFRESH_SLOT_KEY = Symbol.for('yundev.auth.refresh.v1')
const RECENT_OK_MS = 2000

interface RefreshSlot {
  inFlight: Promise<RefreshOutcome> | null
  lastOkAt: number
}

function getSlot(): RefreshSlot {
  const store = globalThis as Record<symbol, RefreshSlot | undefined>
  let slot = store[REFRESH_SLOT_KEY]
  if (!slot) {
    slot = { inFlight: null, lastOkAt: Number.NEGATIVE_INFINITY }
    store[REFRESH_SLOT_KEY] = slot
  }
  return slot
}

/**
 * Coordinates /api/auth/refresh across independent bundles on the same page
 * (e.g. the <yun-header> vendor bundle and the host app's sharedAuth).
 */
export function sharedRefresh(url: string, readCsrf: () => string): Promise<RefreshOutcome> {
  const slot = getSlot()

  if (Date.now() - slot.lastOkAt < RECENT_OK_MS) {
    return Promise.resolve('ok')
  }

  if (slot.inFlight) {
    return slot.inFlight
  }

  const csrf = readCsrf()
  if (!csrf) {
    return Promise.resolve('failed')
  }

  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrf,
        },
      })
      if (response.status === 200) {
        slot.lastOkAt = Date.now()
        return 'ok'
      }
      if (response.status === 409) {
        return 'retry'
      }
      return 'failed'
    } catch {
      return 'failed'
    }
  })()

  slot.inFlight = promise
  void promise.finally(() => {
    if (slot.inFlight === promise) {
      slot.inFlight = null
    }
  })
  return promise
}

export function __resetRefreshCoordinatorForTests(): void {
  const store = globalThis as Record<symbol, RefreshSlot | undefined>
  delete store[REFRESH_SLOT_KEY]
}
