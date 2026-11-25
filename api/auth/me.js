import {
  applyCors,
  getHeader,
  isValidCookieToken,
  parseCookies,
  validateSupabaseAccessToken,
} from './_helpers.js';
import { rateLimit } from './_ratelimit.js';

/**
 * GET /api/auth/me
 * Validates the sb_access cookie against Supabase without modifying cookies.
 *
 * Required Vercel environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 */
export default async function handler(req, res) {
  if (applyCors(req, res, 'GET, OPTIONS')) {
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (await rateLimit(req, res, { bucket: 'me', limit: 120, windowSec: 60 })) {
    return;
  }

  const cookies = parseCookies(getHeader(req, 'cookie'));
  const accessToken = cookies.sb_access;

  if (!isValidCookieToken(accessToken)) {
    return res.status(401).json({ ok: false });
  }

  const verification = await validateSupabaseAccessToken(accessToken);

  if (verification.status === 'misconfigured') {
    return res.status(500).json({ ok: false });
  }

  if (verification.status !== 'ok') {
    return res.status(401).json({ ok: false });
  }

  return res.status(200).json({
    ok: true,
    user: verification.user,
  });
}
