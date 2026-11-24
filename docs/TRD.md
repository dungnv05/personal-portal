# Technical Requirements Document (Current Implementation)

Related decision record: [ADR 0001 - Shared Auth Across Subdomains](./ADR/0001-shared-auth-across-subdomains.md)

## 1) Scope and Evidence

This document describes the system as implemented today in this repository.  
All implementation claims in this document are derived from:

- `package.json`
- `vercel.json`
- `.env.example`
- `api/config.js`
- `index.html`
- `src/main.jsx`
- `src/App.jsx`
- `src/utils/sharedAuth.js`
- `src/index.css`
- `src/App.css`
- `src/assets/react.svg`
- `src/assets/vite.svg`
- `src/assets/hero.png`

## 2) System Context (Text Diagram)

```text
[End User Browser]
  -> loads index.html
  -> loads /src/main.jsx bundle (React StrictMode + <App />)
  -> renders UI from src/App.jsx and styles from src/index.css + src/App.css
  -> uses Supabase JS client from src/utils/sharedAuth.js
       -> reads/writes browser cookie + localStorage for auth tokens
       -> may call GET /api/config when build-time Supabase config is placeholder

[Vercel Deployment]
  -> serves SPA static assets
  -> applies response headers from vercel.json to /(.*)
  -> runs serverless function /api/config (api/config.js)
       -> reads env vars (SUPABASE_* or VITE_SUPABASE_*)
       -> returns { supabaseUrl, supabaseAnonKey } JSON

[Supabase Auth Service]
  <- called by browser Supabase client for sign-in/sign-up/sign-out/session APIs
```

Sources: `index.html`, `src/main.jsx`, `src/App.jsx`, `src/utils/sharedAuth.js`, `vercel.json`, `api/config.js`.

## 3) Frontend Architecture

### 3.1 Vite Entry and Bootstrap

- `index.html` defines `<div id="root"></div>` and loads `<script type="module" src="/src/main.jsx"></script>`.
- `src/main.jsx` mounts React with `createRoot(document.getElementById('root'))` and wraps `<App />` in `<StrictMode>`.
- `package.json` scripts identify the Vite workflow:
  - `dev`: `vite`
  - `build`: `vite build`
  - `preview`: `vite preview`

Sources: `index.html`, `src/main.jsx`, `package.json`.

### 3.2 React Tree and Runtime Modules

- `src/main.jsx` imports:
  - `./index.css`
  - `./App.jsx`
- `src/App.jsx` imports:
  - `./App.css`
  - auth helpers from `./utils/sharedAuth`
  - icon components from `lucide-react`
- `src/App.jsx` holds the main application tree, including:
  - auth modal and auth handlers (`handleAuthSubmit`, `handleLogout`)
  - app cards data (`apps`)
  - session-driven header state (`currentUser`)

Sources: `src/main.jsx`, `src/App.jsx`, `src/index.css`, `src/App.css`, `package.json`.

### 3.3 Assets in `src/`

- `src/assets/react.svg`
- `src/assets/vite.svg`
- `src/assets/hero.png`

These files exist in `src/assets`. Current imports in `src/main.jsx` and `src/App.jsx` do not reference these asset paths directly.

Sources: `src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`, `src/main.jsx`, `src/App.jsx`.

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

`src/utils/sharedAuth.js` initializes the browser Supabase client. When local build config is detected as placeholder/dummy, it fetches `/api/config` and recreates the client using returned `supabaseUrl` and `supabaseAnonKey`.

This is why the endpoint returns both values: the SPA needs runtime client configuration in the browser path that starts from placeholder settings.

Sources: `src/utils/sharedAuth.js`, `api/config.js`.

## 5) Security Headers from `vercel.json`

Configured on `source: "/(.*)"`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`

Source: `vercel.json`.

## 6) Auth Flow (Supabase + `src/utils/sharedAuth.js`)

### 6.1 Storage Strategy and Keys

- Supabase client auth options include:
  - `persistSession: true`
  - `autoRefreshToken: true`
  - `detectSessionInUrl: true`
  - `storageKey: 'yundev_supabase_auth_token'`
  - `storage: cookieStorage`
- `cookieStorage` writes both:
  - shared cookie (via `setSharedCookie`)
  - `localStorage`
- Additional key used for access token replication:
  - `yundev_session`

Sources: `src/utils/sharedAuth.js`.

### 6.2 Cross-Subdomain Behavior

- `COOKIE_DOMAIN` becomes `.yundev.space` when `window.location.hostname` contains `yundev.space`; otherwise empty domain attribute.
- Shared cookies are written with `SameSite=Lax; Secure`.
- Login (`signInWithEmail`) stores session data in both shared cookie and `localStorage`.
- Logout (`signOutUser`) removes both cookie and `localStorage` tokens.

Sources: `src/utils/sharedAuth.js`.

### 6.3 Sync and Event Listeners in App Runtime

In `src/App.jsx`, initial and continuous session synchronization is done by:

- initial `syncSharedSSOSession()` call on mount
- `window` `focus` listener
- `document` `visibilitychange` listener
- `window` `storage` listener (keys: `yundev_session`, `yundev_supabase_auth_token`)
- polling interval: every `2500ms`
- `supabase.auth.onAuthStateChange` subscription to update `currentUser`

`syncSharedSSOSession()` behavior:

- If shared cookies are missing but local session exists -> signs out local session.
- If shared session cookie exists and local session is missing/different -> calls `supabase.auth.setSession(...)` from shared cookie payload.

Sources: `src/App.jsx`, `src/utils/sharedAuth.js`.

## 7) Environment Variables

### 7.1 Example Variables

`.env.example` defines:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Source: `.env.example`.

### 7.2 Runtime Variable Resolution

- Frontend (`src/utils/sharedAuth.js`) reads:
  - `import.meta.env.SUPABASE_URL` or `import.meta.env.VITE_SUPABASE_URL`
  - `import.meta.env.SUPABASE_ANON_KEY` or `import.meta.env.VITE_SUPABASE_ANON_KEY`
- Serverless endpoint (`api/config.js`) reads:
  - `process.env.SUPABASE_URL` or `process.env.VITE_SUPABASE_URL`
  - `process.env.SUPABASE_ANON_KEY` or `process.env.VITE_SUPABASE_ANON_KEY`

Sources: `.env.example`, `src/utils/sharedAuth.js`, `api/config.js`.

## 8) Build and Deploy Shape on Vercel

- Build command defined in repository: `vite build` (`package.json` -> `scripts.build`).
- SPA entry point is `index.html` with module entry `src/main.jsx`.
- Vercel runtime configuration in `vercel.json` currently defines global security headers only.
- Serverless function path used by frontend runtime is `api/config.js`, consumed via `fetch('/api/config')` when placeholder config is detected.

Sources: `package.json`, `index.html`, `src/main.jsx`, `vercel.json`, `api/config.js`, `src/utils/sharedAuth.js`.

## 9) Failure Modes (Current)

### 9.1 Config Endpoint Blocked by CORS

If frontend origin is not in `allowedOrigins`, response header is forced to `https://yundev.space`.  
Browsers on other origins can fail CORS checks when calling `/api/config`.

Source: `api/config.js`.

### 9.2 Expired / Invalid Session State

- If shared cookies are absent while local Supabase session exists, `syncSharedSSOSession()` triggers `signOutUser()`.
- If shared cookie JSON cannot be parsed, sync is skipped and warning is logged.
- If remote session data is stale/invalid, `setSession` may not establish user state; app falls back to `currentSession?.user || null`.

Sources: `src/utils/sharedAuth.js`, `src/App.jsx`.

### 9.3 Missing Environment Variables

- Frontend uses placeholder URL/key when env values look dummy/missing.
- It then fetches `/api/config`; if endpoint returns empty values, runtime client is not reconfigured with usable credentials.
- This can prevent successful Supabase auth operations.

Sources: `src/utils/sharedAuth.js`, `api/config.js`, `.env.example`.

## 10) Current Limitations

- Token in browser storage (cookie + `localStorage`) for shared auth state.
- No `Content-Security-Policy` header configured in `vercel.json`.
- Deprecated `X-XSS-Protection` header is configured.
- Hardcoded origin list in `api/config.js`.
- No tests (no test script in `package.json`, and no test/spec files in current `src/` tree).

Sources: `src/utils/sharedAuth.js`, `vercel.json`, `api/config.js`, `package.json`, `src/`.
