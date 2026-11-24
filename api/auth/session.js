import {
  REFRESH_MAX_AGE,
  applyCors,
  computeAccessMaxAge,
  generateCsrfToken,
  isValidCookieToken,
  parseJsonBody,
  serializeCookie,
  validateSupabaseAccessToken,
} from './_helpers.js';

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

  const body = parseJsonBody(req.body);
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
    user: {
      id: verification.user.id,
      email: verification.user.email,
    },
  });
}
