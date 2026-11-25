import { getHeader } from './_helpers.js';

/**
 * Fixed-window rate limiter for Vercel serverless functions.
 *
 * Uses Upstash Redis REST when both UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are configured, falling back to an in-memory Map
 * on any Upstash error or when Upstash is not configured.
 *
 * NOTE: The in-memory store is per-instance only (not shared across
 * serverless instances) until Upstash Redis or a WAF rate-limit rule is enabled.
 */

const MAX_MEMORY_KEYS = 10000;
const memoryStore = new Map();

export function resetMemoryRateLimitStore() {
  memoryStore.clear();
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
    ]),
  });

  if (!response || !response.ok) {
    throw new Error(`Upstash HTTP ${response?.status ?? 'error'}`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('Upstash invalid pipeline response');
  }

  const incrResult = results[0];
  if (!incrResult || incrResult.error || typeof incrResult.result !== 'number') {
    throw new Error('Upstash INCR failed');
  }

  return {
    count: incrResult.result,
    retryAfterSec: windowSec,
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
    outcome = incrementMemory(storeKey, windowSec);
  }

  if (outcome.count > limit) {
    res.setHeader('Retry-After', String(outcome.retryAfterSec));
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return true;
  }

  return false;
}
