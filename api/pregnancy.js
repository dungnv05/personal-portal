import { DEV_ORIGINS } from '../shared/allowed-origins.js';
import {
  getHeader,
  isSessionPastAbsoluteCap,
  isValidCookieToken,
  parseCookies,
  parseJsonBody,
  shouldAllowDevOrigins,
  timingSafeEqualStrings,
  validateSupabaseAccessToken,
} from './auth/_helpers.js';
import { isSharedRateLimitConfigured, rateLimit } from './auth/_ratelimit.js';

const ALLOWED_ORIGINS = Object.freeze({
  'https://ivf-journey.yundev.space': true,
});
const ALLOWED_METHODS = 'GET, PUT, OPTIONS';
const ALLOWED_HEADERS = 'content-type, x-csrf-token';
const MAX_CONTENT_LENGTH_BYTES = 1024;
const DUE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DUE_DATE_YEAR = 2020;
const MAX_DUE_DATE_YEAR = 2100;

function isAllowedPregnancyOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(ALLOWED_ORIGINS, origin)) {
    return true;
  }
  if (shouldAllowDevOrigins()) {
    for (let i = 0; i < DEV_ORIGINS.length; i += 1) {
      if (origin === DEV_ORIGINS[i]) {
        return true;
      }
    }
  }
  return false;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidDueDate(value) {
  if (value === null) {
    return true;
  }
  if (typeof value !== 'string' || !DUE_DATE_REGEX.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    year < MIN_DUE_DATE_YEAR ||
    year > MAX_DUE_DATE_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() + 1 === month &&
    utc.getUTCDate() === day
  );
}

function buildUserHeaders(supabaseAnonKey, accessToken, extra = {}) {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

export default async function handler(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'private, no-store');

  const origin = getHeader(req, 'origin');
  const allowedOrigin = isAllowedPregnancyOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req?.method === 'OPTIONS') {
    if (!origin || !allowedOrigin) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }

  if (req?.method !== 'GET' && req?.method !== 'PUT') {
    res.setHeader('Allow', ALLOWED_METHODS);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    if (origin && !allowedOrigin) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }
  } else if (!origin || !allowedOrigin) {
    return res.status(403).json({ ok: false, error: 'origin_forbidden' });
  }

  if (process.env.IVF_DUE_DATE_SYNC_ENABLED !== 'true') {
    return res.status(503).json({ ok: false, error: 'due_date_sync_disabled' });
  }

  if (!isSharedRateLimitConfigured() && !shouldAllowDevOrigins()) {
    return res.status(503).json({ ok: false, error: 'ratelimit_unavailable' });
  }

  if (await rateLimit(req, res, { bucket: 'preg-ip', limit: 120, windowSec: 60 })) {
    return;
  }

  const cookies = parseCookies(getHeader(req, 'cookie'));
  const accessToken = cookies.sb_access;

  if (!isValidCookieToken(accessToken)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const verification = await validateSupabaseAccessToken(accessToken);
  if (verification.status === 'misconfigured') {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }
  if (verification.status === 'upstream_error') {
    return res.status(502).json({ ok: false, error: 'auth_upstream_error' });
  }
  if (verification.status !== 'ok') {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (isSessionPastAbsoluteCap(accessToken)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const userId = verification.user.id;
  const userLimitConfig =
    req.method === 'GET'
      ? { bucket: 'preg-get', limit: 60, windowSec: 60, key: userId }
      : { bucket: 'preg-put', limit: 20, windowSec: 60, key: userId };

  if (await rateLimit(req, res, userLimitConfig)) {
    return;
  }

  if (req.method === 'PUT') {
    const csrfCookie = cookies.csrf;
    const csrfHeader = getHeader(req, 'x-csrf-token').trim();
    if (!timingSafeEqualStrings(csrfCookie, csrfHeader)) {
      return res.status(403).json({ ok: false, error: 'csrf_mismatch' });
    }

    const contentType = getHeader(req, 'content-type').trim().toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return res.status(415).json({ ok: false, error: 'unsupported_media_type' });
    }

    const rawContentLength = getHeader(req, 'content-length').trim();
    if (rawContentLength.length === 0) {
      return res.status(411).json({ ok: false, error: 'length_required' });
    }
    if (!/^\d+$/.test(rawContentLength)) {
      return res.status(400).json({ ok: false, error: 'invalid_content_length' });
    }
    const contentLength = Number(rawContentLength);
    if (contentLength > MAX_CONTENT_LENGTH_BYTES) {
      return res.status(413).json({ ok: false, error: 'payload_too_large' });
    }

    const parsedBody = parseJsonBody(req.body);
    if (!isPlainObject(parsedBody)) {
      return res.status(400).json({ ok: false, error: 'invalid_body' });
    }

    const keys = Object.keys(parsedBody);
    if (keys.length !== 1 || keys[0] !== 'dueDate') {
      return res.status(400).json({ ok: false, error: 'invalid_body' });
    }

    if (!isValidDueDate(parsedBody.dueDate)) {
      return res.status(400).json({ ok: false, error: 'invalid_due_date' });
    }

    const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({ ok: false, error: 'server_misconfigured' });
    }

    if (parsedBody.dueDate === null) {
      const deleteUrl = `${supabaseUrl}/rest/v1/pregnancy_profiles?user_id=eq.${encodeURIComponent(userId)}`;
      let deleteResponse;
      try {
        deleteResponse = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: buildUserHeaders(supabaseAnonKey, accessToken, {
            Prefer: 'return=minimal',
          }),
        });
      } catch {
        console.warn('[pregnancy] PostgREST DELETE network error');
        return res.status(502).json({ ok: false, error: 'storage_error' });
      }

      if (!deleteResponse.ok) {
        console.warn('[pregnancy] PostgREST DELETE failed', deleteResponse.status);
        return res.status(502).json({ ok: false, error: 'storage_error' });
      }

      return res.status(200).json({
        ok: true,
        dueDate: null,
        updatedAt: null,
      });
    }

    const upsertUrl = `${supabaseUrl}/rest/v1/pregnancy_profiles?on_conflict=user_id`;
    let upsertResponse;
    try {
      upsertResponse = await fetch(upsertUrl, {
        method: 'POST',
        headers: buildUserHeaders(supabaseAnonKey, accessToken, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        }),
        body: JSON.stringify({
          user_id: userId,
          due_date: parsedBody.dueDate,
        }),
      });
    } catch {
      console.warn('[pregnancy] PostgREST PUT network error');
      return res.status(502).json({ ok: false, error: 'storage_error' });
    }

    if (!upsertResponse.ok) {
      console.warn('[pregnancy] PostgREST PUT failed', upsertResponse.status);
      return res.status(502).json({ ok: false, error: 'storage_error' });
    }

    let rows;
    try {
      rows = await upsertResponse.json();
    } catch {
      console.warn('[pregnancy] PostgREST PUT invalid JSON');
      return res.status(502).json({ ok: false, error: 'storage_error' });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn('[pregnancy] PostgREST PUT empty representation');
      return res.status(502).json({ ok: false, error: 'storage_error' });
    }

    const row = rows[0];
    return res.status(200).json({
      ok: true,
      dueDate: row.due_date ?? null,
      updatedAt: row.updated_at ?? null,
    });
  }

  // GET
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  const getUrl =
    `${supabaseUrl}/rest/v1/pregnancy_profiles` +
    `?select=due_date,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  let getResponse;
  try {
    getResponse = await fetch(getUrl, {
      method: 'GET',
      headers: buildUserHeaders(supabaseAnonKey, accessToken),
    });
  } catch {
    console.warn('[pregnancy] PostgREST GET network error');
    return res.status(502).json({ ok: false, error: 'storage_error' });
  }

  if (!getResponse.ok) {
    console.warn('[pregnancy] PostgREST GET failed', getResponse.status);
    return res.status(502).json({ ok: false, error: 'storage_error' });
  }

  let rows;
  try {
    rows = await getResponse.json();
  } catch {
    console.warn('[pregnancy] PostgREST GET invalid JSON');
    return res.status(502).json({ ok: false, error: 'storage_error' });
  }

  if (!Array.isArray(rows)) {
    console.warn('[pregnancy] PostgREST GET non-array JSON');
    return res.status(502).json({ ok: false, error: 'storage_error' });
  }

  if (rows.length === 0) {
    return res.status(200).json({
      ok: true,
      dueDate: null,
      updatedAt: null,
    });
  }

  const row = rows[0];
  return res.status(200).json({
    ok: true,
    dueDate: row.due_date ?? null,
    updatedAt: row.updated_at ?? null,
  });
}
