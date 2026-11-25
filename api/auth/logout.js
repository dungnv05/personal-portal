import {
  applyCors,
  getHeader,
  parseCookies,
  serializeCookie,
  timingSafeEqualStrings,
} from './_helpers.js';
import { rateLimit } from './_ratelimit.js';

/**
 * POST /api/auth/logout
 * Verifies double-submit CSRF token in constant time and clears shared *.yundev.space cookies.
 *
 * Required Vercel environment variables (shared /api/auth/* suite):
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

  if (await rateLimit(req, res, { bucket: 'logout', limit: 30, windowSec: 60 })) {
    return;
  }

  const cookies = parseCookies(getHeader(req, 'cookie'));
  const csrfCookie = cookies.csrf;
  const csrfHeader = getHeader(req, 'x-csrf-token').trim();

  if (!timingSafeEqualStrings(csrfCookie, csrfHeader)) {
    return res.status(403).json({ ok: false, error: 'csrf_mismatch' });
  }

  res.setHeader('Set-Cookie', [
    serializeCookie('sb_access', '', { httpOnly: true, maxAge: 0 }),
    serializeCookie('sb_refresh', '', { httpOnly: true, maxAge: 0 }),
    serializeCookie('csrf', '', { httpOnly: false, maxAge: 0 }),
  ]);

  return res.status(200).json({ ok: true });
}
