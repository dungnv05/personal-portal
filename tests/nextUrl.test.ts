import { describe, expect, it } from 'vitest'
import { resolveNextUrl } from '../src/utils/nextUrl'

function toNextSearch(value: string): string {
  return `?next=${encodeURIComponent(value)}`
}

describe('resolveNextUrl', () => {
  it('accepts https://brse.yundev.space/', () => {
    expect(resolveNextUrl(toNextSearch('https://brse.yundev.space/'))).toBe(
      'https://brse.yundev.space/',
    )
    expect(resolveNextUrl('?next=https://brse.yundev.space/')).toBe(
      'https://brse.yundev.space/',
    )
  })

  it('accepts https://tinh-luong.yundev.space/a/b?x=1', () => {
    expect(resolveNextUrl(toNextSearch('https://tinh-luong.yundev.space/a/b?x=1'))).toBe(
      'https://tinh-luong.yundev.space/a/b?x=1',
    )
  })

  it('accepts https://yundev.space/', () => {
    expect(resolveNextUrl(toNextSearch('https://yundev.space/'))).toBe(
      'https://yundev.space/',
    )
  })

  it('rejects non-HTTPS http://www.yundev.space/', () => {
    expect(resolveNextUrl(toNextSearch('http://www.yundev.space/'))).toBeNull()
  })

  it('rejects lookalike host https://yundev.space.evil.com/', () => {
    expect(resolveNextUrl(toNextSearch('https://yundev.space.evil.com/'))).toBeNull()
  })

  it('rejects host mismatch with suffix in query https://evil.com/?x=.yundev.space', () => {
    expect(resolveNextUrl(toNextSearch('https://evil.com/?x=.yundev.space'))).toBeNull()
  })

  it('rejects protocol-relative //evil.com and relative paths', () => {
    expect(resolveNextUrl(toNextSearch('//evil.com'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('//yundev.space/'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('/dashboard'))).toBeNull()
  })

  it('rejects javascript:alert(1)', () => {
    expect(resolveNextUrl(toNextSearch('javascript:alert(1)'))).toBeNull()
  })

  it('returns null when next parameter is missing or empty', () => {
    expect(resolveNextUrl('')).toBeNull()
    expect(resolveNextUrl('?foo=bar')).toBeNull()
    expect(resolveNextUrl('?next=')).toBeNull()
    expect(resolveNextUrl('?next=   ')).toBeNull()
  })

  it('rejects trailing-dot edge case https://yundev.space./', () => {
    expect(resolveNextUrl(toNextSearch('https://yundev.space./'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('https://brse.yundev.space./'))).toBeNull()
  })

  it('rejects credential-bearing, malformed, and leading-dot URLs', () => {
    expect(resolveNextUrl(toNextSearch('https://evil.com@yundev.space/'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('https://.yundev.space/'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('https://notyundev.space/'))).toBeNull()
    expect(resolveNextUrl(toNextSearch('https://[::1'))).toBeNull()
  })
})
