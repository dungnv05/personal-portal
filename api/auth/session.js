import { isAllowedOrigin } from '../../shared/allowed-origins.js';
import {
  REFRESH_MAX_AGE,
  applyCors,
  computeAccessMaxAge,
  generateCsrfToken,
  getHeader,
  isValidCookieToken,
  serializeCookie,
  shouldAllowDevOrigins,
  validateSupabaseAccessToken,
} from './_helpers.js';
import { rateLimit } from './_ratelimit.js';

/**
 * POST /api/auth/session
 * Validates a Supabase access token server-side and issues shared *.yundev.space cookies.
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

  if (await rateLimit(req, res, { bucket: 'session', limit: 10, windowSec: 60 })) {
    return;
  }

  const origin = getHeader(req, 'origin').trim();
  if (!isAllowedOrigin(origin, { allowDev: shouldAllowDevOrigins() })) {
    return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
  }

  const contentType = getHeader(req, 'content-type').trim().toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return res.status(415).json({ ok: false, error: 'unsupported_media_type' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  const accessToken = typeof body?.access_token === 'string' ? body.access_token.trim() : '';
  const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : '';

  if (!isValidCookieToken(accessToken) || !isValidCookieToken(refreshToken)) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }

  const verification = await validateSupabaseAccessToken(accessToken);

  if (verification.status === 'misconfigured') {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  if (verification.status === 'upstream_error') {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (verification.status !== 'ok') {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }

  const accessMaxAge = computeAccessMaxAge(accessToken);
  const csrfToken = generateCsrfToken();

  res.setHeader('Set-Cookie', [
    serializeCookie('sb_access', accessToken, { httpOnly: true, maxAge: accessMaxAge }),
    serializeCookie('sb_refresh', refreshToken, { httpOnly: true, maxAge: REFRESH_MAX_AGE }),
    serializeCookie('csrf', csrfToken, { httpOnly: false, maxAge: REFRESH_MAX_AGE }),
  ]);

  return res.status(200).json({
    ok: true,
    user: verification.user,
  });
}
