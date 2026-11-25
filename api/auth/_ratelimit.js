import { getHeader, shouldAllowDevOrigins } from './_helpers.js';

/**
 * Fixed-window rate limiter for Vercel serverless functions.
 *
 * Production store: Upstash Redis REST (used whenever both
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, in any
 * environment).
 *
 * The in-memory Map store is used only:
 * (a) in local dev/tests when Upstash env vars are absent,
 * (b) as a fallback in production when Upstash env vars are missing (emits a
 *     one-time console.warn per process without secret/env values), and
 * (c) on Upstash error/timeout (fail-open).
 */

const MAX_MEMORY_KEYS = 10000;
const UPSTASH_TIMEOUT_MS = 800;
const memoryStore = new Map();
let warnedMissingUpstashInProd = false;

export function resetMemoryRateLimitStore() {
  memoryStore.clear();
  warnedMissingUpstashInProd = false;
}

export function getClientIp(req) {
  const forwarded = getHeader(req, 'x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = getHeader(req, 'x-real-ip').trim();
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

function incrementMemory(storeKey, windowSec, now = Date.now()) {
  const windowMs = windowSec * 1000;
  const existing = memoryStore.get(storeKey);
  if (existing && existing.resetAt > now) {
    existing.count += 1;
    return {
      count: existing.count,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  if (memoryStore.size >= MAX_MEMORY_KEYS) {
    for (const [k, entry] of memoryStore.entries()) {
      if (entry.resetAt <= now) {
        memoryStore.delete(k);
      }
    }
    if (memoryStore.size >= MAX_MEMORY_KEYS) {
      const oldestKey = memoryStore.keys().next().value;
      if (oldestKey !== undefined) {
        memoryStore.delete(oldestKey);
      }
    }
  }

  const resetAt = now + windowMs;
  memoryStore.set(storeKey, { count: 1, resetAt });
  return {
    count: 1,
    retryAfterSec: windowSec,
  };
}

async function incrementUpstash(upstashUrl, upstashToken, storeKey, windowSec) {
  const endpoint = `${upstashUrl.replace(/\/+$/, '')}/pipeline`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${upstashToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', storeKey],
      ['EXPIRE', storeKey, windowSec, 'NX'],
      ['PTTL', storeKey],
    ]),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
  });

  if (!response || !response.ok) {
    throw new Error(`Upstash HTTP ${response?.status ?? 'error'}`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length < 3) {
    throw new Error('Upstash invalid pipeline response');
  }

  const incrResult = results[0];
  if (!incrResult || incrResult.error || typeof incrResult.result !== 'number') {
    throw new Error('Upstash INCR failed');
  }

  const expireResult = results[1];
  if (!expireResult || expireResult.error || typeof expireResult.result !== 'number') {
    throw new Error('Upstash EXPIRE failed');
  }

  const pttlResult = results[2];
  if (
    !pttlResult ||
    pttlResult.error ||
    typeof pttlResult.result !== 'number' ||
    pttlResult.result < 0
  ) {
    throw new Error('Upstash PTTL failed');
  }

  return {
    count: incrResult.result,
    retryAfterSec: Math.max(1, Math.ceil(pttlResult.result / 1000)),
  };
}

/**
 * Checks rate limit for a request.
 * Returns true if the request was blocked (429 already written to res).
 */
export async function rateLimit(req, res, { bucket, limit, windowSec = 60, key }) {
  const resolvedKey = typeof key === 'string' && key.length > 0 ? key : getClientIp(req);
  const storeKey = `rl:${bucket}:${resolvedKey}`;

  const upstashUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

  let outcome;
  if (upstashUrl && upstashToken) {
    try {
      outcome = await incrementUpstash(upstashUrl, upstashToken, storeKey, windowSec);
    } catch {
      outcome = incrementMemory(storeKey, windowSec);
    }
  } else {
    if (!shouldAllowDevOrigins() && !warnedMissingUpstashInProd) {
      warnedMissingUpstashInProd = true;
      console.warn(
        '[ratelimit] Upstash env vars missing in production; using per-instance in-memory limiter',
      );
    }
    outcome = incrementMemory(storeKey, windowSec);
  }

  if (outcome.count > limit) {
    res.setHeader('Retry-After', String(outcome.retryAfterSec));
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return true;
  }

  return false;
}
