# Technical Requirements Document (Current Implementation)

Related decision record: [ADR 0001 - Shared Auth Across Subdomains](./ADR/0001-shared-auth-across-subdomains.md)

## 1) Scope and Evidence

This document describes the system as implemented today in this repository.  
All implementation claims in this document are derived from:

- `package.json`
- `vercel.json`
- `.env.example`
- `api/config.js`
- `api/auth/_helpers.js`
- `api/auth/session.js`
- `api/auth/me.js`
- `api/auth/logout.js`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/utils/sharedAuth.ts`
- `src/index.css`
- `src/App.css`
- `src/assets/react.svg`
- `src/assets/vite.svg`
- `src/assets/hero.png`

## 2) System Context (Text Diagram)

```text
[End User Browser]
  -> loads index.html
  -> loads /src/main.tsx bundle (React StrictMode + <App />)
  -> renders UI from src/App.tsx and styles from src/index.css + src/App.css
  -> uses Supabase JS client (persistSession: false) from src/utils/sharedAuth.ts
       -> signs in via Supabase Auth, then calls POST /api/auth/session to set shared cookies
       -> checks active session via GET /api/auth/me (credentials: include)
       -> logs out via POST /api/auth/logout with x-csrf-token double-submit header
       -> may call GET /api/config when build-time Supabase config is placeholder

[Vercel Deployment]
  -> serves SPA static assets
  -> applies response headers from vercel.json to /(.*)
  -> runs serverless function /api/config (api/config.js)
       -> reads env vars (SUPABASE_* or VITE_SUPABASE_*)
       -> returns { supabaseUrl, supabaseAnonKey } JSON
  -> runs serverless auth endpoints under /api/auth/* (api/auth/session.js, me.js, logout.js, _helpers.js)
       -> validates access tokens against Supabase /auth/v1/user
       -> issues/clears shared *.yundev.space cookies (HttpOnly sb_access/sb_refresh + JS-readable csrf)

[Supabase Auth Service]
  <- called by browser Supabase client for sign-in/sign-up/sign-out
  <- called by /api/auth/session and /api/auth/me to verify access tokens
```

Sources: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/utils/sharedAuth.ts`, `vercel.json`, `api/config.js`, `api/auth/_helpers.js`, `api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js`.

## 3) Frontend Architecture

### 3.1 Vite Entry and Bootstrap

- `index.html` defines `<div id="root"></div>` and loads `<script type="module" src="/src/main.tsx"></script>`.
- `src/main.tsx` mounts React with `createRoot(document.getElementById('root')!)` and wraps `<App />` in `<StrictMode>`.
- `package.json` scripts identify the Vite workflow:
  - `dev`: `vite`
  - `build`: `vite build`
  - `preview`: `vite preview`

Sources: `index.html`, `src/main.tsx`, `package.json`.

### 3.2 React Tree and Runtime Modules

- `src/main.tsx` imports:
  - `./index.css`
  - `./App`
- `src/App.tsx` imports:
  - `./App.css`
  - auth helpers from `./utils/sharedAuth`
  - icon components from `lucide-react`
- `src/App.tsx` holds the main application tree, including:
  - auth modal and auth handlers (`handleAuthSubmit`, `handleLogout`)
  - app cards data (`apps`)
  - session-driven header state (`currentUser`)

Sources: `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/App.css`, `package.json`.

### 3.3 Assets in `src/`

- `src/assets/react.svg`
- `src/assets/vite.svg`
- `src/assets/hero.png`

These files exist in `src/assets`. Current imports in `src/main.tsx` and `src/App.tsx` do not reference these asset paths directly.

Sources: `src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`, `src/main.tsx`, `src/App.tsx`.

## 4) Serverless Contract: `api/config.js`

### 4.1 Route Behavior

- The handler responds to `OPTIONS` preflight with `200` and empty body.
- For non-`OPTIONS` requests, it returns status `200` JSON:
  - `supabaseUrl`
  - `supabaseAnonKey`
- Response values are resolved from:
  - `process.env.SUPABASE_URL` or `process.env.VITE_SUPABASE_URL`
  - `process.env.SUPABASE_ANON_KEY` or `process.env.VITE_SUPABASE_ANON_KEY`
  - fallback `''` when missing

Source: `api/config.js`.

### 4.2 CORS Policy (Exact Implementation)

`allowedOrigins` is hardcoded to:

- `https://yundev.space`
- `https://www.yundev.space`
- `https://tinh-luong.yundev.space`
- `https://brse.yundev.space`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

This list includes sibling static deployments, including PM / BrSE Track at `https://brse.yundev.space`.

If request `Origin` is in the list, `Access-Control-Allow-Origin` echoes that origin.  
Otherwise, it sets `Access-Control-Allow-Origin: https://yundev.space`.

Additional response headers:

- `Access-Control-Allow-Methods: GET, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Cache-Control: no-store, max-age=0`

Source: `api/config.js`.

### 4.3 Why `supabaseAnonKey` Is Returned

`api/config.js` remains for serving Supabase public runtime configuration. `src/utils/sharedAuth.ts` initializes the browser Supabase client (used for sign-in and sign-up) and, when local build config is detected as placeholder/dummy, fetches `/api/config` and recreates the client using the returned `supabaseUrl` and `supabaseAnonKey`.

Session persistence and validation are handled separately by the `/api/auth/*` endpoints.

Sources: `src/utils/sharedAuth.ts`, `api/config.js`.

## 5) Security Headers from `vercel.json`

Configured on `source: "/(.*)"`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (11 directives):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://yundev.space https://www.yundev.space https://tinh-luong.yundev.space https://brse.yundev.space; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`

Source: `vercel.json`.

## 6) Auth Flow (Supabase + `src/utils/sharedAuth.ts`)

### Auth flow (current)

As of 2026-11-24, shared authentication across `*.yundev.space` is backed by serverless endpoints (`api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js`, and shared helper `api/auth/_helpers.js`). On login, the client authenticates with Supabase (`persistSession: false`) and sends `{ access_token, refresh_token }` to `POST /api/auth/session`, which verifies the access token against Supabase `/auth/v1/user` and sets three cookies scoped to `Domain=.yundev.space; Path=/; SameSite=Lax; Secure`: HttpOnly `sb_access`, HttpOnly `sb_refresh`, and JS-readable `csrf`. On page load, focus, and visibility changes, the client calls `GET /api/auth/me` with `credentials: 'include'` to verify the `sb_access` cookie server-side and hydrate `currentUser` (`{ id, email }`). Logout calls `POST /api/auth/logout` with the `csrf` cookie echoed in the `x-csrf-token` header; the server enforces double-submit CSRF verification using constant-time comparison and clears all three cookies (`Max-Age=0`). `api/config.js` remains for supplying Supabase public runtime config (`supabaseUrl`, `supabaseAnonKey`) when build-time values are placeholders.

### 6.1 Storage Strategy and Cookies

- Supabase client auth options in `src/utils/sharedAuth.ts`:
  - `persistSession: false`
  - `autoRefreshToken: false`
  - `detectSessionInUrl: false`
- The client no longer stores access or refresh tokens in `localStorage` or JS-writable cookies.
- Server-issued cookies (`api/auth/_helpers.js`, `api/auth/session.js`):
  - `sb_access`: `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space` (`Max-Age` from JWT `exp`, fallback `3600`s)
  - `sb_refresh`: `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=2592000`
  - `csrf`: JS-readable (`HttpOnly` omitted), `Secure; SameSite=Lax; Path=/; Domain=.yundev.space; Max-Age=2592000`
- Legacy client keys (`yundev_session`, `yundev_supabase_auth_token`) are proactively cleared from `localStorage` and expired as cookies on sign-in and logout (`clearLegacyAuthStorage`).

Sources: `src/utils/sharedAuth.ts`, `api/auth/_helpers.js`, `api/auth/session.js`.

### 6.2 Cross-Subdomain Behavior and CSRF

- Server-issued cookies are always scoped to `Domain=.yundev.space; Path=/; SameSite=Lax; Secure`.
- Client-side domain check for expiring legacy cookies uses an exact host match: `host === 'yundev.space' || host.endsWith('.yundev.space')`.
- `/api/auth/*` responses enforce the shared CORS allowlist (`ALLOWED_ORIGINS` in `api/auth/_helpers.js`) with `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and `Cache-Control: no-store, max-age=0`.
- `POST /api/auth/logout` verifies the `csrf` cookie against the `x-csrf-token` request header using SHA-256 + `crypto.timingSafeEqual` (`timingSafeEqualStrings`), rejecting mismatches with `403`.

Sources: `src/utils/sharedAuth.ts`, `api/auth/_helpers.js`, `api/auth/logout.js`.

### 6.3 Sync and Event Listeners in App Runtime

In `src/App.tsx`, session state synchronization is performed via `getSessionUser()` (`GET /api/auth/me`):

- initial `getSessionUser()` call on mount
- `window` `focus` listener
- `document` `visibilitychange` listener (when `document.visibilityState === 'visible'`)

`getSessionUser()` behavior:

- Calls `GET /api/auth/me` with `credentials: 'include'`.
- Returns `{ id, email }` on HTTP `200` with a valid user payload, or `null` otherwise.

Sources: `src/App.tsx`, `src/utils/sharedAuth.ts`, `api/auth/me.js`.

## 7) Environment Variables

### 7.1 Example Variables

`.env.example` defines:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Source: `.env.example`.

### 7.2 Runtime Variable Resolution

- Frontend (`src/utils/sharedAuth.ts`) reads:
  - `import.meta.env.SUPABASE_URL` or `import.meta.env.VITE_SUPABASE_URL`
  - `import.meta.env.SUPABASE_ANON_KEY` or `import.meta.env.VITE_SUPABASE_ANON_KEY`
- Public config endpoint (`api/config.js`) reads:
  - `process.env.SUPABASE_URL` or `process.env.VITE_SUPABASE_URL`
  - `process.env.SUPABASE_ANON_KEY` or `process.env.VITE_SUPABASE_ANON_KEY`
- Auth endpoints (`api/auth/_helpers.js`) read:
  - `process.env.SUPABASE_URL`
  - `process.env.SUPABASE_ANON_KEY`

Sources: `.env.example`, `src/utils/sharedAuth.ts`, `api/config.js`, `api/auth/_helpers.js`.

## 8) Build and Deploy Shape on Vercel

- Build command defined in repository: `vite build` (`package.json` -> `scripts.build`).
- SPA entry point is `index.html` with module entry `src/main.tsx`.
- Vercel runtime configuration in `vercel.json` defines global security headers for `/(.*)`.
- Serverless function paths used by frontend runtime:
  - `api/config.js` (consumed via `fetch('/api/config')` when placeholder config is detected)
  - `api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js` (sharing `api/auth/_helpers.js`)

Sources: `package.json`, `index.html`, `src/main.tsx`, `vercel.json`, `api/config.js`, `api/auth/_helpers.js`, `api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js`, `src/utils/sharedAuth.ts`.

## 9) Failure Modes (Current)

### 9.1 Config and Auth Endpoints Blocked by CORS

If frontend origin is not in the hardcoded allowlist (`allowedOrigins` in `api/config.js` / `ALLOWED_ORIGINS` in `api/auth/_helpers.js`), `Access-Control-Allow-Origin` defaults to `https://yundev.space`.  
Browsers on other origins fail CORS checks when calling `/api/config` or `/api/auth/*`.

Sources: `api/config.js`, `api/auth/_helpers.js`.

### 9.2 Expired / Invalid Session State or CSRF Mismatch

- If `sb_access` is missing, malformed, expired, or rejected by Supabase `/auth/v1/user`, `GET /api/auth/me` returns `401` and the frontend sets `currentUser` to `null`.
- If `POST /api/auth/session` fails token validation (`401`), upstream fetch (`502`), or server config (`500`), the client signs out of the in-memory Supabase instance and returns an error.
- If `POST /api/auth/logout` receives a missing or mismatched `x-csrf-token` header relative to the `csrf` cookie, it returns `403` (`csrf_mismatch`) without clearing cookies.

Sources: `src/utils/sharedAuth.ts`, `src/App.tsx`, `api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js`.

### 9.3 Missing Environment Variables

- Frontend uses placeholder URL/key when env values look dummy/missing.
- It then fetches `/api/config`; if the endpoint returns empty values, the runtime client is not reconfigured with usable credentials.
- If `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing on the server, `/api/auth/session` and `/api/auth/me` return `500` (`server_misconfigured` / `{ ok: false }`).

Sources: `src/utils/sharedAuth.ts`, `api/config.js`, `api/auth/_helpers.js`, `api/auth/session.js`, `api/auth/me.js`, `.env.example`.

## 10) Current Limitations

- Refresh token rotation is not implemented (no server-side refresh flow using `sb_refresh`).
- No rate limiting on `/api/auth/*` endpoints.
- Hardcoded origin allowlists in `api/config.js` and `api/auth/_helpers.js`.

### Implemented 2026-11-24

- Auth tokens are no longer stored in `localStorage` or JS-writable cookies (`persistSession: false` on the Supabase client; `sb_access` and `sb_refresh` are HttpOnly cookies issued by `/api/auth/session`, with double-submit `csrf` verification on `/api/auth/logout`).
- `vercel.json` serves an 11-directive `Content-Security-Policy` and `Permissions-Policy`.
- `X-XSS-Protection` is set to `0` (disabling the deprecated XSS auditor).

Sources: `src/utils/sharedAuth.ts`, `vercel.json`, `api/config.js`, `api/auth/_helpers.js`, `api/auth/session.js`, `api/auth/me.js`, `api/auth/logout.js`.
