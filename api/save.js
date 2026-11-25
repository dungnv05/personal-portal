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
import {
  mapLegacyVangVongState,
  summarizeVangVongSave,
  validateVangVongSave,
} from './_vang-vong-save.js';

const VANG_VONG_ORIGIN = 'https://vang-vong-su-viet.yundev.space';
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const ORIGIN_GAME = { [VANG_VONG_ORIGIN]: 'vang-vong' };
const ALLOWED_GAMES = new Set(['vang-vong']);
const MAX_CONTENT_LENGTH_BYTES = 70000;
const MAX_BASE_VERSION = 2147483646;
const ALLOWED_HEADERS = 'content-type, x-csrf-token';

function resolveOriginGame(origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(ORIGIN_GAME, origin)) {
    return ORIGIN_GAME[origin];
  }
  if (shouldAllowDevOrigins()) {
    for (let i = 0; i < DEV_ORIGINS.length; i += 1) {
      if (origin === DEV_ORIGINS[i]) {
        return 'vang-vong';
      }
    }
  }
  return null;
}

function parseSaveQuery(req) {
  let game = req?.query?.game;
  let slotRaw = req?.query?.slot;
  let action = req?.query?.action;

  if (
    (game === undefined || slotRaw === undefined || (req?.method === 'POST' && action === undefined)) &&
    typeof req?.url === 'string'
  ) {
    try {
      const parsed = new URL(req.url, 'https://yundev.space');
      if (game === undefined) {
        game = parsed.searchParams.get('game') ?? undefined;
      }
      if (slotRaw === undefined) {
        slotRaw = parsed.searchParams.get('slot') ?? undefined;
      }
      if (action === undefined) {
        action = parsed.searchParams.get('action') ?? undefined;
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
  } else if (typeof slotRaw === 'string' && /^[0-2]$/.test(slotRaw)) {
    slot = Number(slotRaw);
  } else {
    return null;
  }

  if (!Number.isInteger(slot) || slot < 0 || slot > 2) {
    return null;
  }

  if (req?.method === 'POST' && action !== 'import') {
    return null;
  }

  return { game, slot, action };
}

function isImportExcluded(userId) {
  const raw = process.env.CLOUD_SAVE_IMPORT_EXCLUDED_USER_IDS || '';
  if (!raw) {
    return false;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

function isEmptyImportBody(rawBody) {
  if (rawBody === undefined || rawBody === null || rawBody === '') {
    return true;
  }
  const parsed = parseJsonBody(rawBody);
  return parsed !== null && Object.keys(parsed).length === 0;
}

function buildUserHeaders(supabaseAnonKey, accessToken, extra = {}) {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function gameSaveFilter(userId, game, slot) {
  return `user_id=eq.${encodeURIComponent(userId)}&game=eq.${encodeURIComponent(game)}&slot=eq.${slot}`;
}

async function resolveConflict(supabaseUrl, supabaseAnonKey, accessToken, userId, game, slot, clientValue, baseVersion) {
  const url = `${supabaseUrl}/rest/v1/game_saves?select=data,version,updated_at&${gameSaveFilter(userId, game, slot)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: buildUserHeaders(supabaseAnonKey, accessToken),
    });
  } catch {
    return { ok: false };
  }

  if (!response.ok) {
    return { ok: false };
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    return { ok: false };
  }

  if (!Array.isArray(rows)) {
    return { ok: false };
  }

  let server = null;
  if (rows.length > 0) {
    const row = rows[0];
    const sv = validateVangVongSave(row.data, { nowMs: Number.MAX_SAFE_INTEGER });
    if (sv.ok) {
      server = {
        version: row.version,
        updated_at: row.updated_at,
        schemaVersion: sv.value.schemaVersion,
        summary: summarizeVangVongSave(sv.value),
      };
    } else {
      server = {
        version: row.version,
        updated_at: row.updated_at,
        schemaVersion: Number.isSafeInteger(row.data?.schemaVersion) ? row.data.schemaVersion : null,
        summary: null,
        invalid: true,
      };
    }
  }

  return {
    ok: true,
    body: {
      ok: false,
      error: 'version_conflict',
      server,
      client: {
        baseVersion,
        summary: summarizeVangVongSave(clientValue),
      },
    },
  };
}

async function insertInitialSave(supabaseUrl, supabaseAnonKey, accessToken, userId, game, slot, validatedValue) {
  let response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/game_saves`, {
      method: 'POST',
      headers: buildUserHeaders(supabaseAnonKey, accessToken, {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify({
        user_id: userId,
        game,
        slot,
        data: validatedValue,
        version: 1,
      }),
    });
  } catch {
    return { status: 'upstream_error' };
  }

  let parsedBody = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (response.status === 409 || parsedBody?.code === '23505') {
    return { status: 'conflict' };
  }

  if (!response.ok || !Array.isArray(parsedBody) || parsedBody.length === 0) {
    return { status: 'upstream_error' };
  }

  return {
    status: 'ok',
    version: parsedBody[0].version,
    updated_at: parsedBody[0].updated_at ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Origin');

  const origin = getHeader(req, 'origin');
  const originGame = resolveOriginGame(origin);

  if (originGame) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req?.method === 'OPTIONS') {
    if (!origin || !originGame) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }

  if (req?.method === 'GET') {
    if (origin && !originGame) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }
  } else if (req?.method === 'PUT' || req?.method === 'POST') {
    if (!origin || !originGame) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }
  } else if (origin && !originGame) {
    return res.status(403).json({ ok: false, error: 'origin_forbidden' });
  }

  if (process.env.CLOUD_SAVE_ENABLED !== 'true') {
    return res.status(503).json({ ok: false, error: 'cloud_save_disabled' });
  }

  if (req?.method !== 'GET' && req?.method !== 'PUT' && req?.method !== 'POST') {
    res.setHeader('Allow', 'GET, PUT, POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (!shouldAllowDevOrigins() && !isSharedRateLimitConfigured()) {
    return res.status(503).json({ ok: false, error: 'ratelimit_unavailable' });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
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
  const userLimitConfig =
    req.method === 'GET'
      ? { bucket: 'save-get', limit: 60, windowSec: 60, key: userId }
      : req.method === 'PUT'
        ? { bucket: 'save-put', limit: 30, windowSec: 60, key: userId }
        : { bucket: 'save-import', limit: 3, windowSec: 3600, key: userId };

  if (await rateLimit(req, res, userLimitConfig)) {
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
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

  if (originGame && query.game !== originGame) {
    return res.status(403).json({ ok: false, error: 'origin_game_mismatch' });
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
      `&${gameSaveFilter(userId, query.game, query.slot)}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: buildUserHeaders(supabaseAnonKey, accessToken),
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

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      return res.status(200).json({
        ok: true,
        save: {
          data: row.data,
          version: row.version,
          updated_at: row.updated_at,
        },
      });
    }

    let legacyAvailable = false;
    try {
      const legacyUrl =
        `${supabaseUrl}/rest/v1/player_profiles` +
        `?select=id&id=eq.${encodeURIComponent(userId)}&full_state_json=not.is.null&limit=1`;
      const legacyResponse = await fetch(legacyUrl, {
        method: 'GET',
        headers: buildUserHeaders(supabaseAnonKey, accessToken),
      });
      if (legacyResponse.ok) {
        const legacyRows = await legacyResponse.json();
        legacyAvailable =
          Array.isArray(legacyRows) && legacyRows.length === 1 && !isImportExcluded(userId);
      }
    } catch {
      legacyAvailable = false;
    }

    return res.status(200).json({
      ok: true,
      save: null,
      legacy_available: legacyAvailable,
    });
  }

  if (req.method === 'PUT') {
    const body = parseJsonBody(req.body);
    if (!body) {
      return res.status(400).json({ ok: false, error: 'invalid_body', path: '' });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'version')) {
      return res.status(400).json({ ok: false, error: 'invalid_body', path: 'version' });
    }

    if (
      !Number.isSafeInteger(body.baseVersion) ||
      body.baseVersion < 0 ||
      body.baseVersion > MAX_BASE_VERSION
    ) {
      return res.status(400).json({ ok: false, error: 'invalid_body', path: 'baseVersion' });
    }

    const bodyKeys = Object.keys(body);
    for (let i = 0; i < bodyKeys.length; i += 1) {
      if (bodyKeys[i] !== 'data' && bodyKeys[i] !== 'baseVersion') {
        return res.status(400).json({ ok: false, error: 'invalid_body', path: '' });
      }
    }

    const v = validateVangVongSave(body.data);
    if (!v.ok) {
      if (v.error === 'unsupported_schema') {
        return res.status(400).json({ ok: false, error: 'unsupported_schema', path: v.path });
      }
      if (v.error === 'payload_too_large') {
        return res.status(413).json({ ok: false, error: 'payload_too_large' });
      }
      return res.status(400).json({ ok: false, error: 'invalid_save', path: v.path });
    }

    const baseVersion = body.baseVersion;
    if (baseVersion === 0) {
      const inserted = await insertInitialSave(
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        userId,
        query.game,
        query.slot,
        v.value,
      );
      if (inserted.status === 'ok') {
        return res.status(200).json({
          ok: true,
          version: inserted.version,
          updated_at: inserted.updated_at,
        });
      }
      if (inserted.status === 'conflict') {
        const conflict = await resolveConflict(
          supabaseUrl,
          supabaseAnonKey,
          accessToken,
          userId,
          query.game,
          query.slot,
          v.value,
          0,
        );
        if (!conflict.ok) {
          return res.status(502).json({ ok: false, error: 'upstream_error' });
        }
        return res.status(409).json(conflict.body);
      }
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    const patchUrl =
      `${supabaseUrl}/rest/v1/game_saves` +
      `?${gameSaveFilter(userId, query.game, query.slot)}&version=eq.${baseVersion}`;
    let patchResponse;
    try {
      patchResponse = await fetch(patchUrl, {
        method: 'PATCH',
        headers: buildUserHeaders(supabaseAnonKey, accessToken, {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        }),
        body: JSON.stringify({
          data: v.value,
          version: baseVersion + 1,
        }),
      });
    } catch {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    if (!patchResponse.ok) {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    let patchedRows;
    try {
      patchedRows = await patchResponse.json();
    } catch {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    if (!Array.isArray(patchedRows)) {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }

    if (patchedRows.length === 1) {
      return res.status(200).json({
        ok: true,
        version: patchedRows[0].version,
        updated_at: patchedRows[0].updated_at ?? null,
      });
    }

    const conflict = await resolveConflict(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      userId,
      query.game,
      query.slot,
      v.value,
      baseVersion,
    );
    if (!conflict.ok) {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }
    return res.status(409).json(conflict.body);
  }

  // POST ?action=import
  if (!isEmptyImportBody(req.body)) {
    return res.status(400).json({ ok: false, error: 'invalid_body', path: '' });
  }

  if (isImportExcluded(userId)) {
    return res.status(403).json({ ok: false, error: 'import_excluded' });
  }

  const legacyUrl =
    `${supabaseUrl}/rest/v1/player_profiles` +
    `?select=full_state_json&id=eq.${encodeURIComponent(userId)}&limit=1`;
  let legacyResponse;
  try {
    legacyResponse = await fetch(legacyUrl, {
      method: 'GET',
      headers: buildUserHeaders(supabaseAnonKey, accessToken),
    });
  } catch {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  if (!legacyResponse.ok) {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  let legacyRows;
  try {
    legacyRows = await legacyResponse.json();
  } catch {
    return res.status(502).json({ ok: false, error: 'upstream_error' });
  }

  if (
    !Array.isArray(legacyRows) ||
    legacyRows.length === 0 ||
    legacyRows[0]?.full_state_json === null ||
    legacyRows[0]?.full_state_json === undefined
  ) {
    return res.status(404).json({ ok: false, error: 'legacy_not_found' });
  }

  const cand = mapLegacyVangVongState(legacyRows[0].full_state_json);
  if (cand === null) {
    return res.status(400).json({ ok: false, error: 'legacy_invalid', path: '' });
  }

  const v = validateVangVongSave(cand);
  if (!v.ok) {
    return res.status(400).json({ ok: false, error: 'legacy_invalid', path: v.path });
  }

  const inserted = await insertInitialSave(
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    userId,
    query.game,
    query.slot,
    v.value,
  );
  if (inserted.status === 'ok') {
    return res.status(200).json({
      ok: true,
      version: inserted.version,
      updated_at: inserted.updated_at,
      imported: true,
    });
  }
  if (inserted.status === 'conflict') {
    const conflict = await resolveConflict(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      userId,
      query.game,
      query.slot,
      v.value,
      0,
    );
    if (!conflict.ok) {
      return res.status(502).json({ ok: false, error: 'upstream_error' });
    }
    return res.status(409).json(conflict.body);
  }
  return res.status(502).json({ ok: false, error: 'upstream_error' });
}
