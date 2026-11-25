import {
  applyCors,
  buildUserPayload,
  getHeader,
  isSessionPastAbsoluteCap,
  isValidCookieToken,
  parseCookies,
  parseJsonBody,
  sanitizeDisplayName,
  timingSafeEqualStrings,
} from './_helpers.js';
import { rateLimit } from './_ratelimit.js';

/**
 * POST /api/auth/profile
 * Updates the signed-in user's display name (user_metadata.full_name) via Supabase Auth.
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

  if (await rateLimit(req, res, { bucket: 'profile', limit: 20, windowSec: 60 })) {
    return;
  }

  const cookies = parseCookies(getHeader(req, 'cookie'));
  const csrfCookie = cookies.csrf;
  const csrfHeader = getHeader(req, 'x-csrf-token').trim();

  if (!timingSafeEqualStrings(csrfCookie, csrfHeader)) {
    return res.status(403).json({ ok: false, error: 'csrf_mismatch' });
  }

  const accessToken = cookies.sb_access;
  if (!isValidCookieToken(accessToken)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = parseJsonBody(req.body);
  const displayName = sanitizeDisplayName(body?.display_name, 50);
  if (!displayName) {
    return res.status(400).json({ ok: false, error: 'invalid_display_name' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          full_name: displayName,
        },
      }),
    });
  } catch {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (response.status === 401 || response.status === 403) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (!response.ok) {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (isSessionPastAbsoluteCap(accessToken)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  if (!payload || typeof payload.id !== 'string' || payload.id.length === 0) {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }

  const user = buildUserPayload(payload);
  if (!user.display_name) {
    user.display_name = displayName;
  }

  return res.status(200).json({
    ok: true,
    user,
  });
}
