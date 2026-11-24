import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined') {
  let hasWorkingStorage = false

  try {
    if (
      typeof window.localStorage !== 'undefined' &&
      typeof window.localStorage.getItem === 'function' &&
      typeof window.localStorage.setItem === 'function' &&
      typeof window.localStorage.removeItem === 'function' &&
      typeof window.localStorage.clear === 'function'
    ) {
      const probeKey = '__vitest_storage_probe__'
      window.localStorage.setItem(probeKey, '1')
      hasWorkingStorage = window.localStorage.getItem(probeKey) === '1'
      window.localStorage.removeItem(probeKey)
    }
  } catch {
    hasWorkingStorage = false
  }

  if (!hasWorkingStorage) {
    const store = new Map<string, string>()

    const localStorageStub: Storage = {
      get length(): number {
        return store.size
      },
      clear(): void {
        store.clear()
      },
      getItem(key: string): string | null {
        const value = store.get(key)
        return value === undefined ? null : value
      },
      key(index: number): string | null {
        const keys = Array.from(store.keys())
        return keys[index] ?? null
      },
      removeItem(key: string): void {
        store.delete(key)
      },
      setItem(key: string, value: string): void {
        store.set(key, String(value))
      },
    }

    Object.defineProperty(window, 'localStorage', {
      value: localStorageStub,
      configurable: true,
      writable: true,
    })

    if (typeof globalThis !== 'undefined' && globalThis !== window) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: localStorageStub,
        configurable: true,
        writable: true,
      })
    }
  }
}
