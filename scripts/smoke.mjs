#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'https://www.yundev.space';
const ALLOWED_ORIGIN = 'https://www.yundev.space';
const EVIL_ORIGIN = 'https://evil.example';
const REQUEST_TIMEOUT_MS = 10_000;

const rawBaseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).trim();
const BASE_URL = rawBaseUrl.replace(/\/+$/, '');

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
    });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
  }
  return String(error);
}

async function main() {
  const results = [];
  let rootResult = null;

  const record = (name, ok, measured) => {
    results.push({ name, ok, measured });
    const statusLabel = ok ? 'PASS' : 'FAIL';
    console.log(`${statusLabel} ${name} — ${measured}`);
  };

  console.log(`smoke target: ${BASE_URL}`);

  // 1. GET /
  try {
    rootResult = await request('/', { method: 'GET' });
    const { response, body } = rootResult;
    const hasPortalName = body.includes('personal-portal');
    const hasRootElement = /<div\b[^>]*\bid=["']root["']/i.test(body);
    const marker = hasPortalName ? 'personal-portal' : hasRootElement ? '<div id="root">' : 'missing';
    const ok = response.status === 200 && (hasPortalName || hasRootElement);
    record('GET /', ok, `status=${response.status}, marker=${marker}`);
  } catch (error) {
    record('GET /', false, `error=${formatError(error)}`);
  }

  // 2. GET /api/config
  try {
    const { response, body } = await request('/api/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }

    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    const urlField = isObject
      ? ['supabaseUrl', 'url'].find((field) => typeof parsed[field] === 'string' && parsed[field].trim().length > 0)
      : undefined;
    const keyField = isObject
      ? ['supabaseAnonKey', 'anonKey', 'key'].find(
          (field) => typeof parsed[field] === 'string' && parsed[field].trim().length > 0,
        )
      : undefined;
    const hasServiceRole = /service_role/i.test(body);
    const ok = response.status === 200 && Boolean(urlField) && Boolean(keyField) && !hasServiceRole;

    record(
      'GET /api/config',
      ok,
      `status=${response.status}, urlField=${urlField ?? 'missing'}, keyField=${keyField ?? 'missing'}, service_role=${hasServiceRole ? 'FOUND' : 'absent'}`,
    );
  } catch (error) {
    record('GET /api/config', false, `error=${formatError(error)}`);
  }

  // 3. Security response headers (from GET /)
  if (!rootResult) {
    record('Security headers', false, 'no response from GET /');
  } else {
    const headers = rootResult.response.headers;
    const csp = headers.get('content-security-policy');
    const permissionsPolicy = headers.get('permissions-policy');
    const xFrameOptions = headers.get('x-frame-options');
    const hsts = headers.get('strict-transport-security');

    const hasCsp = Boolean(csp && csp.trim().length > 0);
    const hasPermissions = Boolean(permissionsPolicy && permissionsPolicy.trim().length > 0);
    const hasDenyXfo = (xFrameOptions ?? '').trim().toUpperCase() === 'DENY';
    const hasHsts = Boolean(hsts && hsts.trim().length > 0);
    const ok = hasCsp && hasPermissions && hasDenyXfo && hasHsts;

    record(
      'Security headers',
      ok,
      `CSP=${hasCsp ? 'present' : 'missing'}, Permissions-Policy=${hasPermissions ? 'present' : 'missing'}, X-Frame-Options=${xFrameOptions ?? 'missing'}, HSTS=${hasHsts ? 'present' : 'missing'}`,
    );
  }

  // 4. OPTIONS /api/auth/session with allowed Origin
  try {
    const { response } = await request('/api/auth/session', {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN },
    });
    const acao = response.headers.get('access-control-allow-origin');
    const acac = response.headers.get('access-control-allow-credentials');
    const ok =
      response.status === 204 &&
      acao === ALLOWED_ORIGIN &&
      (acac ?? '').trim().toLowerCase() === 'true';

    record(
      'OPTIONS /api/auth/session (allowed origin)',
      ok,
      `status=${response.status}, ACAO=${acao ?? 'missing'}, ACAC=${acac ?? 'missing'}`,
    );
  } catch (error) {
    record('OPTIONS /api/auth/session (allowed origin)', false, `error=${formatError(error)}`);
  }

  // 5. POST /api/auth/logout without x-csrf-token
  try {
    const { response } = await request('/api/auth/logout', {
      method: 'POST',
    });
    const ok = response.status === 403;
    record('POST /api/auth/logout (CSRF guard)', ok, `status=${response.status}`);
  } catch (error) {
    record('POST /api/auth/logout (CSRF guard)', false, `error=${formatError(error)}`);
  }

  // 6. Cross-origin check: OPTIONS /api/auth/session with evil Origin
  try {
    const { response } = await request('/api/auth/session', {
      method: 'OPTIONS',
      headers: { Origin: EVIL_ORIGIN },
    });
    const acao = response.headers.get('access-control-allow-origin');
    const ok = acao !== EVIL_ORIGIN && acao !== '*';
    record(
      'OPTIONS /api/auth/session (cross-origin block)',
      ok,
      `status=${response.status}, ACAO=${acao ?? 'absent'}`,
    );
  } catch (error) {
    record('OPTIONS /api/auth/session (cross-origin block)', false, `error=${formatError(error)}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`smoke: ${passed}/${total} passed`);

  if (passed !== total) {
    process.exitCode = 1;
  }
}

await main();
