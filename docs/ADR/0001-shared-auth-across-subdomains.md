# ADR 0001: Shared Auth Across Subdomains

- Related TRD: [Technical Requirements Document](../TRD.md)

## Status

Accepted — implemented 2026-11-24

## Context

The current portal links and auth behavior operate across multiple hosts in the same domain family:

- `https://yundev.space`
- `https://www.yundev.space`
- `https://tinh-luong.yundev.space`

Evidence in code:

- `api/config.js` CORS allowlist explicitly includes the three origins above.
- `src/App.jsx` UI text states account/session synchronization across `*.yundev.space`.
- Before 2026-11-24, `src/utils/sharedAuth.js` computed cookie domain as `.yundev.space` when hostname included `yundev.space`.

Because users can move between these hosts, the implementation needs shared login state instead of isolated per-subdomain sessions.

## Decision

### Previous (Before 2026-11-24)

Before 2026-11-24, the client used Supabase browser auth with a custom storage adapter in `src/utils/sharedAuth.js`:

- `storageKey` was `yundev_supabase_auth_token`.
- Session artifacts were replicated to both cookie storage and `localStorage`.
- Additional key `yundev_session` mirrored access token state.
- `syncSharedSSOSession()` reconciled local app session with shared cookie state.

This approach was replaced on 2026-11-24 by the server-issued HttpOnly cookie architecture below.

### Target (Implemented 2026-11-24)

Move session issuance to backend endpoints under `/api/auth/*` and store session in:

- `HttpOnly` cookie
- `Secure`
- `SameSite` policy compatible with required flows
- `Domain=.yundev.space`

Add CSRF double-submit protection for state-changing requests.

This target was implemented on 2026-11-24 and is active in the current repository (see Implementation notes below).

## Alternatives Considered

### 1) LocalStorage Replication (previous approach, before 2026-11-24)

- Pros: simple browser-only implementation, no additional backend auth endpoint required.
- Cons: token material is accessible to JavaScript (XSS exposure), logout and sync semantics depend on client polling/events.

### 2) Per-Subdomain Login (no sharing)

- Pros: strongest isolation between applications.
- Cons: repeated login prompts and fragmented user experience when switching hosts.

### 3) Parent-Domain Cookie Session

- Pros: native browser sharing across `*.yundev.space`.
- Cons: requires robust backend issuance, validation, and revocation flow.

### 4) OAuth Redirect Broker

- Pros: centralized auth broker can unify many apps and providers.
- Cons: higher operational complexity and redirect choreography across all apps.

## Consequences

### Security

- Before 2026-11-24, token replication to browser-readable storage increased XSS blast radius; tokens are now stored in server-issued HttpOnly cookies.
- Before 2026-11-24, cookie + localStorage sync did not provide CSRF protections; the server-issued cookie flow now enforces double-submit CSRF validation on `/api/auth/logout`.

### Logout Semantics

- Before 2026-11-24, logout propagation relied on shared cookie/localStorage state and periodic/client event-based sync (`focus`, `visibilitychange`, `storage`, interval polling); logout now clears server-issued cookies via `POST /api/auth/logout`.

### Deploy Coupling

- Before 2026-11-24, the frontend depended on shared storage conventions (`yundev_session`, `yundev_supabase_auth_token`); it still retains the optional `/api/config` runtime config fetch path.
- The 2026-11-24 cookie migration couples frontend and `/api/auth/*` backend contract rollout timing.

## Implementation notes

Shipped on `2026-11-24`, implementing the target cookie-based migration described above.

### Endpoints

- `api/auth/session.js` (`POST /api/auth/session`): requires `Origin` allowlisted by `isAllowedOrigin` (with `shouldAllowDevOrigins()`) and `Content-Type: application/json` before parsing or calling Supabase, validates `{ access_token, refresh_token }` against `/auth/v1/user`, and sets the shared session cookies, returning `{ ok: true, user: { id, email, display_name, avatar_url } }`.
- `api/auth/me.js` (`GET /api/auth/me`): reads and validates the `sb_access` cookie against Supabase `/auth/v1/user` without modifying cookies, returning `{ ok: true, user: { id, email, display_name, avatar_url } }`.
- `api/auth/refresh.js` (`POST /api/auth/refresh`): verifies CSRF double-submit token and `sb_refresh` cookie, rotates the refresh token via Supabase `/auth/v1/token?grant_type=refresh_token`, and sets rotated `sb_access`, `sb_refresh`, and `csrf` cookies (clearing all three only on Supabase `400` with a refresh-token error code; mapping `401` or other upstream errors to `502 auth_upstream_error`).
- `api/auth/logout.js` (`POST /api/auth/logout`): verifies the CSRF double-submit token and clears all shared auth cookies (`Max-Age=0`).
- `api/auth/profile.js` (`POST /api/auth/profile`): verifies CSRF double-submit token and `sb_access` cookie, validates `display_name` (1–50 chars, no control chars), and updates `user_metadata.full_name` via Supabase `PUT /auth/v1/user`.
- `api/auth/_helpers.js`: shared CORS helper (`applyCors` using `isAllowedOrigin` from `shared/allowed-origins.js` and `shouldAllowDevOrigins()`), cookie parsing/serialization, token/metadata validation, and constant-time comparison helpers. Dev origins are fail-closed: `shouldAllowDevOrigins()` returns `true` only when `(VERCEL_ENV === 'development' || (VERCEL_ENV === undefined && VERCEL !== '1')) && NODE_ENV !== 'production'`, so on Vercel (`VERCEL=1`) a missing `VERCEL_ENV`, `preview`, or `production` never allows localhost.
- `api/auth/_ratelimit.js`: fixed-window rate limiter applied after CORS/OPTIONS on all `/api/auth/*` handlers, `api/config.js`, and `api/save.js`. Upstash Redis REST (pipeline `INCR`/`EXPIRE NX`/`PTTL` with 800 ms timeout) is the production rate-limit store whenever both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set; the per-instance in-memory store is used only in local dev/tests when env vars are absent, as a fallback in production when env vars are missing (emitting a one-time `console.warn`), or on Upstash error/timeout.
- `shared/allowed-origins.js`: canonical 6-host allowlist (`yundev.space`, `www.yundev.space`, `tinh-luong.yundev.space`, `brse.yundev.space`, `vang-vong-su-viet.yundev.space`, `ivf-journey.yundev.space`) shared by API CORS, `api/config.js`, `nextUrl.ts`, `nextParam.ts`, and `<yun-header>` (no wildcard `*.yundev.space`).
- `api/config.js`: retained for serving Supabase public runtime configuration (`supabaseUrl`, `supabaseAnonKey`) using the shared `applyCors` + `rateLimit`.
- `api/save.js` (`GET`/`PUT /api/save`): cloud-save skeleton gated by `CLOUD_SAVE_ENABLED=true`, using user `sb_access` JWT + Supabase RLS (`supabase/migrations/20261125000000_game_saves.sql`), CSRF on `PUT`, per-user rate limits, and a 64 KB `data` payload cap.

### Cookie Names and Attributes

All three cookies are issued with `Domain=.yundev.space; Path=/; SameSite=Lax; Secure`:

- `sb_access`: `HttpOnly`, `Max-Age` derived from JWT `exp` (fallback `3600`s).
- `sb_refresh`: `HttpOnly`, `Max-Age=2592000`.
- `csrf`: JS-readable (non-`HttpOnly`), 32 random bytes hex-encoded, `Max-Age=2592000`.

The browser client (`src/utils/sharedAuth.ts`) configures Supabase with `persistSession: false` (no access/refresh tokens persisted in `localStorage`) and uses an exact host check (`host === 'yundev.space' || host.endsWith('.yundev.space')`) when clearing legacy cookies. `vercel.json` now serves an 11-directive `Content-Security-Policy`, `Permissions-Policy`, and `X-XSS-Protection: 0`.

### CSRF Mechanism

Double-submit cookie pattern: `/api/auth/session` issues the JS-readable `csrf` cookie; state-changing `/api/auth/logout` requires the client to echo that value in the `x-csrf-token` request header and validates equality in constant time via SHA-256 + `crypto.timingSafeEqual` (`timingSafeEqualStrings` in `api/auth/_helpers.js`).

### Residual Risks

- If Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) is not configured in production, the rate limiter falls back to a per-instance in-memory store (not shared across serverless instances) and emits a one-time warning.
- Cloud save (`/api/save`) is disabled by default (`503 cloud_save_disabled`) until the `game_saves` migration (`supabase/migrations/20261125000000_game_saves.sql`) is applied and `CLOUD_SAVE_ENABLED=true` is set.
- Sliding 30-day refresh cookie (`REFRESH_MAX_AGE = 2592000` renewed on each rotation) means active sessions do not hit an absolute session lifetime without Supabase paid-plan time-box/inactivity settings (deferred pending Yun's decision).

## Follow-ups

1. Implement server-side refresh-token rotation using the HttpOnly `sb_refresh` cookie.
2. Add rate limiting on `/api/auth/*` endpoints.
3. Complete RLS and edge review items.
