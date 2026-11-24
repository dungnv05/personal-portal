# ADR 0001: Shared Auth Across Subdomains

- Related TRD: [Technical Requirements Document](../TRD.md)

## Status

Accepted (current implementation in place, migration target defined).

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

## Follow-ups

1. Migration task reference: `AUTH-MIG-0001` (to be created) for `/api/auth/*` cookie-based auth rollout.
2. Add `Content-Security-Policy` in deployment headers and enforce it before or during auth migration.
3. Define explicit CSRF double-submit token format and verification points for `/api/auth/*`.
