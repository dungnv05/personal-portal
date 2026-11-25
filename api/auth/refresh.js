import {
  REFRESH_MAX_AGE,
  applyCors,
  buildUserPayload,
  clearSessionCookies,
  computeAccessMaxAge,
  generateCsrfToken,
  getHeader,
  isSessionPastAbsoluteCap,
  isValidCookieToken,
  parseCookies,
  serializeCookie,
  timingSafeEqualStrings,
  validateSupabaseAccessToken,
} from './_helpers.js';
import { rateLimit } from './_ratelimit.js';

const REFRESH_TOKEN_ERRORS = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'invalid_grant',
  'session_not_found',
  'session_expired',
]);

async function isRevokedRefreshResponse(response) {
  if (response.status !== 400) {
    return false;
  }
  let errPayload = null;
  try {
    errPayload = await response.json();
  } catch {
    return false;
  }
  if (!errPayload || typeof errPayload !== 'object') {
    return false;
  }
  const errorCode = typeof errPayload.error_code === 'string' ? errPayload.error_code : '';
  const errorName = typeof errPayload.error === 'string' ? errPayload.error : '';
  return REFRESH_TOKEN_ERRORS.has(errorCode) || REFRESH_TOKEN_ERRORS.has(errorName);
}

/**
 * POST /api/auth/refresh
 * Rotates the HttpOnly sb_refresh cookie via Supabase and issues fresh session cookies.
 *
 * Required Vercel environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 */
export default async function handler(req, res) {
  if (applyCors(req, res, 'POST, OPTIONS')) {
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (await rateLimit(req, res, { bucket: 'refresh', limit: 30, windowSec: 60 })) {
    return;
  }

  const cookies = parseCookies(getHeader(req, 'cookie'));
  const csrfCookie = cookies.csrf;
  const csrfHeader = getHeader(req, 'x-csrf-token').trim();

  if (!timingSafeEqualStrings(csrfCookie, csrfHeader)) {
    return res.status(403).json({ ok: false, error: 'csrf_mismatch' });
  }

  const refreshToken = cookies.sb_refresh;
  if (!isValidCookieToken(refreshToken)) {
    return res.status(401).json({ ok: false, error: 'refresh_failed' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (response.status === 400) {
    if (await isRevokedRefreshResponse(response)) {
      res.setHeader('Set-Cookie', clearSessionCookies());
      return res.status(401).json({ ok: false, error: 'refresh_failed' });
    }
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (!response.ok) {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  const newAccessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
  const newRefreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token.trim() : '';

  if (!isValidCookieToken(newAccessToken) || !isValidCookieToken(newRefreshToken)) {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (isSessionPastAbsoluteCap(newAccessToken)) {
    res.setHeader('Set-Cookie', clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'session_expired' });
  }

  let user = null;
  if (payload?.user && typeof payload.user.id === 'string' && payload.user.id.length > 0) {
    user = buildUserPayload(payload.user);
  } else {
    const verification = await validateSupabaseAccessToken(newAccessToken);
    if (verification.status === 'ok') {
      user = verification.user;
    } else if (verification.status === 'upstream_error') {
      return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
    } else {
      return res.status(401).json({ ok: false, error: 'refresh_failed' });
    }
  }

  const accessMaxAge = computeAccessMaxAge(newAccessToken);
  const csrfToken = generateCsrfToken();

  res.setHeader('Set-Cookie', [
    serializeCookie('sb_access', newAccessToken, { httpOnly: true, maxAge: accessMaxAge }),
    serializeCookie('sb_refresh', newRefreshToken, { httpOnly: true, maxAge: REFRESH_MAX_AGE }),
    serializeCookie('csrf', csrfToken, { httpOnly: false, maxAge: REFRESH_MAX_AGE }),
  ]);

  return res.status(200).json({
    ok: true,
    user,
  });
}
