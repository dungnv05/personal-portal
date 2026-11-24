import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

/**
 * Shared helpers for /api/auth/* Vercel serverless functions.
 *
 * Required Vercel environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 */

export const COOKIE_DOMAIN = '.yundev.space';
export const COOKIE_PATH = '/';
export const ACCESS_FALLBACK_MAX_AGE = 3600;
export const REFRESH_MAX_AGE = 2592000;

export const ALLOWED_ORIGINS = [
  'https://yundev.space',
  'https://www.yundev.space',
  'https://tinh-luong.yundev.space',
  'https://brse.yundev.space',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const DEFAULT_ALLOWED_ORIGIN = 'https://yundev.space';
const ALLOWED_HEADERS = 'content-type, x-csrf-token';

export function getHeader(req, targetName) {
  const headers = req?.headers;
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const lower = targetName.toLowerCase();
  if (typeof headers[lower] === 'string') {
    return headers[lower];
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return typeof value === 'string' ? value : '';
    }
  }
  return '';
}

export function applyCors(req, res, allowedMethods) {
  const origin = getHeader(req, 'origin');
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', DEFAULT_ALLOWED_ORIGIN);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', allowedMethods);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req?.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}

export function isValidCookieToken(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      code < 0x21 ||
      code > 0x7e ||
      code === 0x22 ||
      code === 0x2c ||
      code === 0x3b ||
      code === 0x5c
    ) {
      return false;
    }
  }
  return true;
}

export function parseJsonBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body;
  }
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseCookies(cookieHeader) {
  const cookies = Object.create(null);
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return cookies;
  }
  for (const pair of cookieHeader.split(';')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    const rawValue = pair.slice(eqIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function serializeCookie(name, value, { httpOnly, maxAge }) {
  const parts = [`${name}=${value}`];
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  parts.push('Secure');
  parts.push('SameSite=Lax');
  parts.push(`Path=${COOKIE_PATH}`);
  parts.push(`Domain=${COOKIE_DOMAIN}`);
  parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function computeAccessMaxAge(accessToken) {
  if (typeof accessToken !== 'string') {
    return ACCESS_FALLBACK_MAX_AGE;
  }
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return ACCESS_FALLBACK_MAX_AGE;
  }
  try {
    const payloadText = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadText);
    if (payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const remaining = Math.floor(payload.exp - nowSeconds);
      if (remaining > 0) {
        return remaining;
      }
    }
  } catch {
    // Non-JWT or undecodable payload falls back to default Max-Age.
  }
  return ACCESS_FALLBACK_MAX_AGE;
}

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const digestA = crypto.createHash('sha256').update(bufA).digest();
  const digestB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(digestA, digestB) && bufA.length === bufB.length;
}

export async function validateSupabaseAccessToken(accessToken) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { status: 'misconfigured' };
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return { status: 'upstream_error' };
  }

  if (!response || !response.ok) {
    return { status: 'invalid' };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: 'invalid' };
  }

  if (!payload || typeof payload.id !== 'string' || payload.id.length === 0) {
    return { status: 'invalid' };
  }

  return {
    status: 'ok',
    user: {
      id: payload.id,
      email: typeof payload.email === 'string' ? payload.email : null,
    },
  };
}
