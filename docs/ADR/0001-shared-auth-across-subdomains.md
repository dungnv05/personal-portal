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
- `src/utils/sharedAuth.js` computes cookie domain as `.yundev.space` when hostname includes `yundev.space`.

Because users can move between these hosts, the implementation needs shared login state instead of isolated per-subdomain sessions.

## Decision

### Current (Implemented Today)

Use Supabase browser auth with a custom storage adapter in `src/utils/sharedAuth.js`:

- `storageKey` is `yundev_supabase_auth_token`.
- Session artifacts are replicated to both cookie storage and `localStorage`.
- Additional key `yundev_session` mirrors access token state.
- `syncSharedSSOSession()` reconciles local app session with shared cookie state.

This decision is implemented and active.

### Target (Planned Migration)

Move session issuance to backend endpoints under `/api/auth/*` and store session in:

- `HttpOnly` cookie
- `Secure`
- `SameSite` policy compatible with required flows
- `Domain=.yundev.space`

Add CSRF double-submit protection for state-changing requests.

This target is not implemented in current repository files and is recorded here as migration direction.

## Alternatives Considered

### 1) LocalStorage Replication (current approach)

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

- Current token replication to browser-readable storage increases XSS blast radius.
- Current approach uses cookie + localStorage sync and does not provide CSRF protections associated with server-issued cookie sessions.

### Logout Semantics

- Current logout propagation relies on shared cookie/localStorage state and periodic/client event-based sync (`focus`, `visibilitychange`, `storage`, interval polling).

### Deploy Coupling

- Current frontend depends on shared storage conventions (`yundev_session`, `yundev_supabase_auth_token`) and optional `/api/config` runtime config fetch path.
- Planned cookie migration couples frontend and `/api/auth/*` backend contract rollout timing.

## Implementation notes

Shipped on `2026-11-24`, implementing the target cookie-based migration described above.

### Endpoints

- `api/auth/session.js` (`POST /api/auth/session`): validates `{ access_token, refresh_token }` by calling Supabase `/auth/v1/user` and sets the shared session cookies.
- `api/auth/me.js` (`GET /api/auth/me`): reads and validates the `sb_access` cookie against Supabase `/auth/v1/user` without modifying cookies, returning `{ ok: true, user: { id, email } }`.
- `api/auth/logout.js` (`POST /api/auth/logout`): verifies the CSRF double-submit token and clears all shared auth cookies (`Max-Age=0`).
- `api/auth/_helpers.js`: shared CORS allowlist (`ALLOWED_ORIGINS`), cookie parsing/serialization, token validation, and constant-time comparison helpers.
- `api/config.js`: retained for serving Supabase public runtime configuration (`supabaseUrl`, `supabaseAnonKey`) when build-time values are placeholders.

### Cookie Names and Attributes

All three cookies are issued with `Domain=.yundev.space; Path=/; SameSite=Lax; Secure`:

- `sb_access`: `HttpOnly`, `Max-Age` derived from JWT `exp` (fallback `3600`s).
- `sb_refresh`: `HttpOnly`, `Max-Age=2592000`.
- `csrf`: JS-readable (non-`HttpOnly`), 32 random bytes hex-encoded, `Max-Age=2592000`.

The browser client (`src/utils/sharedAuth.ts`) configures Supabase with `persistSession: false` (no access/refresh tokens persisted in `localStorage`) and uses an exact host check (`host === 'yundev.space' || host.endsWith('.yundev.space')`) when clearing legacy cookies. `vercel.json` now serves an 11-directive `Content-Security-Policy`, `Permissions-Policy`, and `X-XSS-Protection: 0`.

### CSRF Mechanism

Double-submit cookie pattern: `/api/auth/session` issues the JS-readable `csrf` cookie; state-changing `/api/auth/logout` requires the client to echo that value in the `x-csrf-token` request header and validates equality in constant time via SHA-256 + `crypto.timingSafeEqual` (`timingSafeEqualStrings` in `api/auth/_helpers.js`).

### Residual Risks

- Refresh token rotation is not implemented (`sb_refresh` is stored as an HttpOnly cookie, but no server-side refresh/rotation endpoint exists yet).
- No rate limit is enforced on `/api/auth/*` endpoints.

## Follow-ups

1. Migration task reference: `AUTH-MIG-0001` (to be created) for `/api/auth/*` cookie-based auth rollout.
2. Add `Content-Security-Policy` in deployment headers and enforce it before or during auth migration.
3. Define explicit CSRF double-submit token format and verification points for `/api/auth/*`.
