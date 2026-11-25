import { Buffer } from 'node:buffer';
import {
  applyCors,
  getHeader,
  isSessionPastAbsoluteCap,
  isValidCookieToken,
  parseCookies,
  parseJsonBody,
  timingSafeEqualStrings,
  validateSupabaseAccessToken,
} from './auth/_helpers.js';
import { rateLimit } from './auth/_ratelimit.js';

const ALLOWED_GAMES = new Set(['vang-vong']);
const MAX_DATA_BYTES = 65536;
const MAX_CONTENT_LENGTH_BYTES = 70000;

function parseSaveQuery(req) {
  let game = req?.query?.game;
  let slotRaw = req?.query?.slot;

  if ((game === undefined || slotRaw === undefined) && typeof req?.url === 'string') {
    try {
      const parsed = new URL(req.url, 'https://yundev.space');
      if (game === undefined) {
        game = parsed.searchParams.get('game') ?? undefined;
      }
      if (slotRaw === undefined) {
        slotRaw = parsed.searchParams.get('slot') ?? undefined;
      }
    } catch {
      return null;
    }
  }

  if (typeof game !== 'string' || !ALLOWED_GAMES.has(game)) {
    return null;
  }

  let slot;
  if (typeof slotRaw === 'number') {
    slot = slotRaw;
  } else if (typeof slotRaw === 'string' && /^[0-2]$/.test(slotRaw.trim())) {
    slot = Number(slotRaw.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(slot) || slot < 0 || slot > 2) {
    return null;
  }

  return { game, slot };
}

/**
 * GET / PUT /api/save
 * Cloud-save skeleton gated by CLOUD_SAVE_ENABLED=true and Supabase RLS.
 */
export default async function handler(req, res) {
  if (applyCors(req, res, 'GET, PUT, OPTIONS')) {
    return;
  }

  if (process.env.CLOUD_SAVE_ENABLED !== 'true') {
    return res.status(503).json({ ok: false, error: 'cloud_save_disabled' });
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (req.method === 'PUT') {
    const rawContentLength = getHeader(req, 'content-length').trim();
    if (rawContentLength.length > 0) {
      const contentLength = Number(rawContentLength);
      if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
        return res.status(413).json({ ok: false, error: 'payload_too_large' });
      }
    }
  }

  if (await rateLimit(req, res, { bucket: 'save-ip', limit: 120, windowSec: 60 })) {
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
  if (
    await rateLimit(req, res, {
      bucket: req.method === 'PUT' ? 'save-put' : 'save-get',
      limit: req.method === 'PUT' ? 30 : 60,
      windowSec: 60,
      key: userId,
    })
  ) {
    return;
  }

  if (req.method === 'PUT') {
    const csrfCookie = cookies.csrf;
    const csrfHeader = getHeader(req, 'x-csrf-token').trim();
    if (!timingSafeEqualStrings(csrfCookie, csrfHeader)) {
      return res.status(403).json({ ok: false, error: 'csrf_mismatch' });
    }
  }

  const query = parseSaveQuery(req);
  if (!query) {
    return res.status(400).json({ ok: false, error: 'invalid_query' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  if (req.method === 'GET') {
    const url =
      `${supabaseUrl}/rest/v1/game_saves` +
      `?select=data,version,updated_at` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&game=eq.${encodeURIComponent(query.game)}` +
      `&slot=eq.${query.slot}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    if (!response.ok) {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    let rows;
    try {
      rows = await response.json();
    } catch {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    const save = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return res.status(200).json({ ok: true, save });
  }

  // PUT
  // TODO(N5): version is stored but not compared (last write wins across devices); decide compare-and-swap before enabling CLOUD_SAVE_ENABLED.
  const body = parseJsonBody(req.body);
  const data = body?.data;
  const version = body?.version;

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    return res.status(400).json({ ok: false, error: 'invalid_body' });
  }

  const serializedData = JSON.stringify(data);
  if (Buffer.byteLength(serializedData, 'utf8') > MAX_DATA_BYTES) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  let response;
  try {
    response = await fetch(
      `${supabaseUrl}/rest/v1/game_saves?on_conflict=user_id,game,slot`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          user_id: userId,
          game: query.game,
          slot: query.slot,
          data,
          version,
        }),
      },
    );
  } catch {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  if (!response.ok) {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  const updatedAt = Array.isArray(rows) && rows[0]?.updated_at ? rows[0].updated_at : null;
  return res.status(200).json({ ok: true, updated_at: updatedAt });
}
