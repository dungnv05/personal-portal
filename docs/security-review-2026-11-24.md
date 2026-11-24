# Security Review — `personal-portal`

- **Date:** 2026-11-24
- **Repository:** `personal-portal` (`yundev.space`)
- **Review Type:** Read-only static code and configuration review
- **Overall Assessment:** **Not publish-ready for production auth without closing blocking header, CORS, rate-limiting, and secret-history checks; long-term session architecture requires completing `AUTH-MIG-0001`.**

> **Static Review Disclaimer:** This review is strictly a **static analysis** of repository source files, configuration, and architecture documents. **No dynamic testing, live HTTP probing, browser penetration testing, dependency vulnerability scanning (`npm audit`), Supabase backend/RLS inspection, or git commit history inspection (`git log` / secret scanners) was performed**, because command execution is disabled in this environment. All findings and evidence are derived solely from the files listed below.

---

## 1. Scope and Method

### 1.1 Files Read

| File | Role in Review |
|---|---|
| `api/config.js` | Vercel serverless runtime config endpoint, CORS policy, caching, method handling |
| `vercel.json` | Global HTTP security response headers |
| `src/utils/sharedAuth.ts` | Supabase client initialization, runtime config fetch, cookie/`localStorage` storage adapter, cross-subdomain SSO sync |
| `src/App.tsx` | UI rendering, auth form/modal, event/interval session sync, linked sibling subdomains, external links |
| `src/main.tsx` | Application bootstrap (`StrictMode`, `createRoot`) |
| `index.html` | Document entry, third-party font origins, script loading |
| `.env.example` | Environment variable template and placeholder hygiene |
| `.gitignore` | Secret file exclusion rules for `.env*` |
| `package.json` | Production and development dependency surface |
| `docs/TRD.md` | Documented architecture, headers, and known limitations |
| `docs/ADR/0001-shared-auth-across-subdomains.md` | Shared authentication decision record and planned migration (`AUTH-MIG-0001`) |

### 1.2 Conceptual Evaluation Areas

1. **Authentication & Session Storage:** Token storage locations (`localStorage` and browser cookies), cookie attributes (`HttpOnly`, `Secure`, `SameSite`, `Domain`), session synchronization, and XSS blast radius.
2. **Cross-Subdomain Trust Boundary:** Which origins can read or overwrite shared session tokens under `*.yundev.space`, hostname matching accuracy, and cross-app privilege/sensitivity mixing.
3. **Serverless Endpoint Security (`/api/config`):** Public exposure of the Supabase `anon` key, CORS allowlist logic and fallback origin behavior, HTTP method validation, caching, and abuse/rate-limiting controls.
4. **HTTP Security Headers:** Coverage of `Content-Security-Policy` (CSP), `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and legacy `X-XSS-Protection`.
5. **Client Input/Output & Runtime Initialization:** React rendering safety (XSS sinks), runtime config bootstrapping, error handling, and URL session parsing.
6. **Dependency Surface & Supply Chain:** Runtime/dev package footprint (React 19, `@supabase/supabase-js`, Vite), semver pinning, and third-party external assets.
7. **Repository Secret Hygiene:** Working-tree secret presence, `.gitignore` rules, and public GitHub history exposure considerations.

---

## 2. Findings Summary Table

| ID | Title | Severity | Evidence (`file:line` + quote) | Impact | Recommended Fix | Status |
|---|---|---|---|---|---|---|
| **SEC-01** | Session access and refresh tokens stored in JS-readable `localStorage` and non-`HttpOnly` cookies | **High** | `src/utils/sharedAuth.ts:29` (`document.cookie = \`${name}=...; SameSite=Lax; Secure\``); `src/utils/sharedAuth.ts:56-60` (`localStorage.setItem(key, value)`); `src/utils/sharedAuth.ts:124-129` (writes `access_token` to `yundev_session` and full JSON session to `yundev_supabase_auth_token`) | Any XSS vulnerability on `yundev.space`—or on any sibling subdomain—allows arbitrary JavaScript to exfiltrate both `access_token` and long-lived `refresh_token`, enabling persistent account takeover across the ecosystem until server-side revocation. | Complete ADR-0001 (`AUTH-MIG-0001`): move session issuance to backend `/api/auth/*` endpoints setting `HttpOnly; Secure; SameSite` cookies with CSRF double-submit protection, and stop persisting tokens in `localStorage` or JS-readable cookies. | **To-do** |
| **SEC-02** | Wildcard `.yundev.space` cookie collapses cross-subdomain trust boundary and allows cross-app session fixation; loose `.includes()` hostname check | **High** | `src/utils/sharedAuth.ts:7-8` (`window.location.hostname.includes('yundev.space') ? '.yundev.space' : ''`); `src/utils/sharedAuth.ts:162-177` (parses `yundev_supabase_auth_token` cookie and calls `supabase.auth.setSession(...)`); `src/App.tsx:143-179` (lists 5 sibling subdomains including `vault.yundev.space`, `ivf-journey.yundev.space`, and `vang-vong-su-viet.yundev.space`) | Every host under `*.yundev.space` (including static apps, a 3D game, planned/unmaintained subdomains, or any future dangling DNS CNAME) can read and overwrite session cookies used by high-sensitivity apps (`vault.yundev.space`, `ivf-journey.yundev.space`). A compromised sibling can also inject an attacker-controlled session cookie that `syncSharedSSOSession()` adopts within 2.5 s. Separately, `.includes('yundev.space')` loosely matches substrings instead of exact domain suffixes. | Replace `.includes('yundev.space')` with strict matching (`hostname === 'yundev.space' \|\| hostname.endsWith('.yundev.space')`). Isolate high-sensitivity apps (`vault`, `ivf-journey`) from wildcard cookie SSO (use per-subdomain sessions or an OAuth/OIDC broker flow), and audit all DNS records under `*.yundev.space` to prevent subdomain takeover. | **To-do** |
| **SEC-03** | Missing `Content-Security-Policy` (CSP) header | **High** | `vercel.json:1-29` (configures 5 headers; omits `Content-Security-Policy`); `docs/ADR/0001-shared-auth-across-subdomains.md:92` (listed as follow-up) | No browser-enforced defense-in-depth restricting script execution (`script-src`), outbound data exfiltration (`connect-src`), framing (`frame-ancestors`), or base/form hijacking. Because tokens are currently readable by JS (`SEC-01`), missing CSP directly maximizes XSS blast radius. | Add a strict `Content-Security-Policy` in `vercel.json` restricting `default-src 'self'`, explicit `script-src 'self'`, `connect-src 'self' https://<project-ref>.supabase.co`, `style-src` / `font-src` for Google Fonts (or `'self'` if self-hosted), `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'none'`. Test in `Content-Security-Policy-Report-Only` first if needed, then enforce. | **To-do** |
| **SEC-04** | Unsafe CORS default fallback origin, missing `Vary: Origin`, unvalidated HTTP methods, and hardcoded `localhost` origins in `/api/config` | **Medium** | `api/config.js:8-9` (`'http://localhost:5173'`, `'http://127.0.0.1:5173'`); `api/config.js:13-17` (`else { res.setHeader('Access-Control-Allow-Origin', 'https://yundev.space'); }`); `api/config.js:24-34` (only branches on `OPTIONS`; all other methods return `200` JSON; no `Vary: Origin`) | Emitting a fallback `ACAO` header for disallowed origins is an anti-pattern that breaks cache correctness when `Vary: Origin` is absent and fails to reject unauthorized requests cleanly. Keeping `localhost:5173` in production allows any local page on port 5173 to read production config cross-origin. Allowing arbitrary HTTP methods (e.g., `POST`, `DELETE`) unnecessarily widens endpoint behavior. Also, 3 active/dev subdomains from `src/App.tsx` (`vang-vong-su-viet`, `vault`, `ivf-journey`) are missing from `allowedOrigins`. | Set `Vary: Origin` on all responses. Only emit `Access-Control-Allow-Origin` when `origin` matches `allowedOrigins`; omit it (or return `403` for disallowed `Origin`) otherwise. Enforce `req.method === 'GET'` (return `405` for other methods). Gate `localhost`/`127.0.0.1` behind non-production environment checks (`process.env.VERCEL_ENV !== 'production'`). | **To-do** |
| **SEC-05** | Missing rate limiting and `Cache-Control: no-store` on `/api/config` | **Medium** | `api/config.js:21` (`res.setHeader('Cache-Control', 'no-store, max-age=0');`); `api/config.js:1-35` (no rate-limiting middleware or edge caching); `vercel.json:1-29` (no WAF/rate-limit config) | Because `/api/config` returns static, non-user-specific public configuration with `no-store`, every request bypasses Vercel's edge cache and invokes a serverless function execution. Automated floods can exhaust serverless invocation quotas (denial-of-wallet / availability degradation). | Since `supabaseUrl` and `supabaseAnonKey` are public config values, either inject `VITE_SUPABASE_*` at build time so `/api/config` is unused in production, or replace `no-store` with edge caching (e.g., `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` paired with `Vary: Origin`) and configure Vercel Firewall rate limiting on `/api/*`. | **To-do** |
| **SEC-06** | Public GitHub repository commit history unverified for leaked secrets | **Medium** | `src/App.tsx:238` (`https://github.com/dungnv05`); `.env.example:4-5` (placeholder values only); `.gitignore:14-16` (`.env`, `.env.*`, `!.env.example`) | Current working-tree files reviewed contain no live secrets. However, because git history could not be inspected in this static review, any `.env` file or credential (especially `SUPABASE_SERVICE_ROLE_KEY`) committed in an earlier commit would remain publicly retrievable. | Run `gitleaks detect` or `trufflehog git` across all git branches and tags before publishing, enable GitHub Secret Scanning and Push Protection on the repository, and immediately rotate any key found in history. | **To-do** |
| **SEC-07** | Unvalidated `/api/config` runtime bootstrap, async client-reassignment race, and leaked `storage` listener | **Low** | `src/utils/sharedAuth.ts:95-114` (`export let supabase = ...`; `fetch('/api/config')...supabase = createSupabaseClient(...)` with `.catch(() => {})`); `src/App.tsx:78-98` (binds `onAuthStateChange` on mount to initial `supabase`; anonymous `storage` listener never removed) | If build-time env vars are placeholders, `App` attaches `onAuthStateChange` to the initial dummy `supabase` instance before `/api/config` resolves, causing auth state desync. `/api/config` response status (`res.ok`) and `supabaseUrl` format/origin (`https://*.supabase.co`) are not validated before client instantiation, and errors are silently swallowed. | Validate `res.ok` and enforce that `supabaseUrl` parses as `https://` on an expected Supabase host before creating the client. Await runtime config initialization via an explicit async initializer (or provide build-time `VITE_SUPABASE_*` vars) so `App` never binds to a dummy client. Store the `storage` handler reference and remove it in the `useEffect` cleanup. | **To-do** |
| **SEC-08** | Deprecated `X-XSS-Protection: 1; mode=block` response header | **Low** | `vercel.json:14-17` (`"key": "X-XSS-Protection", "value": "1; mode=block"`) | Deprecated and removed in modern browsers; legacy XSS filters in older browsers can introduce cross-origin info-leak or script-blocking side channels. | Change `"1; mode=block"` to `"0"` (or remove the header) alongside implementing CSP (`SEC-03`). | **To-do** |
| **SEC-09** | Missing `Permissions-Policy` response header | **Low** | `vercel.json:1-29` (no `Permissions-Policy` header) | Browser hardware and privacy-sensitive APIs (camera, microphone, geolocation, payment, USB, etc.) are not denied by default for this origin, increasing impact if third-party or injected script executes. | Add `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` (adjusting only if a feature genuinely requires an API) to `vercel.json`. | **To-do** |
| **SEC-10** | Dependency surface: unpinned semver ranges, unverified lockfile/CVEs, external Google Fonts, and `detectSessionInUrl: true` | **Low** | `package.json:15-32` (`react: "^19.2.8"`, `@supabase/supabase-js: "^2.111.0"`, `vite: "^8.2.0"`); `index.html:9-11` (`fonts.googleapis.com`, `fonts.gstatic.com`); `src/utils/sharedAuth.ts:87` (`detectSessionInUrl: true`) | Caret ranges (`^`) permit minor/patch drift across installs if lockfile discipline lapses; transitive CVEs could not be checked without `npm audit`. External Google Fonts leaks visitor IP/metadata and widens CSP. `detectSessionInUrl: true` parses auth tokens from URL parameters/fragments, requiring strict Supabase redirect-URL allowlisting. | Run `npm audit` in CI and enable Dependabot/Renovate alerts. Verify `package-lock.json` is committed and installed via `npm ci`. Verify Supabase Auth Redirect URL allowlist is strictly scoped to `*.yundev.space` (or disable `detectSessionInUrl` if email-link/OAuth callbacks do not land on the portal). Optionally self-host fonts to tighten CSP. | **To-do** |
| **SEC-11** | Public exposure of Supabase `anon` key via `/api/config` | **Info** | `api/config.js:28-34` (`res.status(200).json({ supabaseUrl, supabaseAnonKey })`); `src/utils/sharedAuth.ts:71-80` | Acceptable by design in Supabase's security model **only if** Row-Level Security (RLS) is enforced on all database tables, Auth protections (rate limits, redirect allowlists, CAPTCHA) are enabled, and `SUPABASE_SERVICE_ROLE_KEY` is never exposed. Moving the `anon` key to `/api/config` does not make it secret. | Confirm `SUPABASE_SERVICE_ROLE_KEY` is never configured in frontend or `/api/config` env vars; conduct an independent Supabase dashboard/SQL audit confirming RLS is enabled and tested on every table across all shared apps. | **Accepted** (conditional on Supabase RLS) |

---

## 3. Detailed Security Analysis by Topic

### 3.1 Supabase `anon` Key Exposure via `/api/config` (`SEC-11`)

- **Is this acceptable by design?** **Yes, with strict backend prerequisites.** By Supabase's architecture, the `anon` (publishable) key is intended for untrusted browser environments and must be sent in the `apikey` header on client requests. Serving it from `/api/config` instead of bundling it via `VITE_SUPABASE_ANON_KEY` does not hide it—any client can call `GET /api/config` or inspect browser network traffic.
- **What must remain true for this to stay safe:**
  1. `SUPABASE_SERVICE_ROLE_KEY` must **never** be referenced by `api/config.js` or prefixed with `VITE_`. (Verified absent in the reviewed files.)
  2. **Row-Level Security (RLS)** must be enabled with least-privilege policies on every table in the shared Supabase project—especially tables backing sensitive sibling apps (`ivf-journey.yundev.space`, `vault.yundev.space`). This could not be verified statically from this repository.
  3. **Supabase Auth hardening** (sign-up/login rate limits, strict Redirect URL allowlist, email confirmation, and optional CAPTCHA/Turnstile) must be enabled to prevent abuse using the public `anon` key.

### 3.2 CORS Allowlist & Unsafe Default Fallback Origin (`SEC-04`)

In `api/config.js:12-17`:
- If `req.headers.origin` is in `allowedOrigins`, the handler echoes `origin`.
- Otherwise, it **unconditionally sets** `Access-Control-Allow-Origin: https://yundev.space`.
- **Why this is unsafe/problematic:**
  - Without `Vary: Origin`, intermediate caches or proxies can serve a response stamped with one origin's `ACAO` header to another origin.
  - Emitting a hardcoded fallback `ACAO` header when an origin is disallowed obscures policy intent and still executes the handler body and returns `200 OK` JSON for non-browser callers and non-`GET` methods (e.g., `POST`, `PUT`, `DELETE`).
  - `http://localhost:5173` and `http://127.0.0.1:5173` are hardcoded in production (`api/config.js:8-9`), permitting local processes/pages on those ports to query production `/api/config`.
  - Allowlist drift already exists: `src/App.tsx:149-174` lists `vang-vong-su-viet.yundev.space`, `vault.yundev.space`, and `ivf-journey.yundev.space`, none of which appear in `api/config.js:3-10`.

### 3.3 Missing CSP, Missing `Permissions-Policy`, and Deprecated `X-XSS-Protection` (`SEC-03`, `SEC-08`, `SEC-09`)

`vercel.json:1-29` applies five headers globally to `/(.*)`:
- **Good controls already present:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, and `Referrer-Policy: strict-origin-when-cross-origin`. (Note: HSTS with `includeSubDomains; preload` requires every `*.yundev.space` subdomain to maintain valid HTTPS continuously.)
- **Missing `Content-Security-Policy` (`SEC-03`):** Leaves the portal without browser-side script/connect/frame restrictions. Given JS-accessible session tokens (`SEC-01`), adding CSP is the highest-leverage immediate hardening step. Note that `index.html:9-11` loads external fonts from `https://fonts.googleapis.com` and `https://fonts.gstatic.com`, and `src/App.tsx` uses inline `style={{ ... }}` attributes (`src/App.tsx:214,272,306`), which must be accounted for when crafting `style-src` (or refactored into CSS classes to avoid `'unsafe-inline'` in `style-src`).
- **Missing `Permissions-Policy` (`SEC-09`):** No explicit opt-out of browser hardware/sensor features (`camera`, `microphone`, `geolocation`, `payment`, `usb`).
- **Deprecated `X-XSS-Protection: 1; mode=block` (`SEC-08`):** Superseded by CSP and known to cause side-channel issues in legacy XSS auditors; should be set to `0` or removed.

### 3.4 Session Tokens in `localStorage` & XSS Blast Radius (`SEC-01`)

`src/utils/sharedAuth.ts` stores session material in **four places simultaneously**:
1. Cookie `yundev_supabase_auth_token` (full serialized Supabase session JSON, including `access_token` and `refresh_token`, 30-day expiry, non-`HttpOnly`, `Domain=.yundev.space`).
2. `localStorage['yundev_supabase_auth_token']` (same full session JSON).
3. Cookie `yundev_session` (raw `access_token`, 30-day expiry, non-`HttpOnly`, `Domain=.yundev.space`).
4. `localStorage['yundev_session']` (raw `access_token`).

**Blast radius:** Any XSS vulnerability on `yundev.space` (or via a compromised dependency) grants immediate synchronous access to `localStorage` and `document.cookie`, allowing silent exfiltration of the long-lived `refresh_token`. Because `refresh_token` can mint fresh JWTs indefinitely until revoked server-side, a single transient XSS becomes persistent cross-ecosystem account compromise. `docs/ADR/0001-shared-auth-across-subdomains.md` recognizes this risk and designates `AUTH-MIG-0001` (server-issued `HttpOnly; Secure; SameSite` cookies via `/api/auth/*` + CSRF double-submit) as the target state, which is not yet implemented.

### 3.5 Cross-Subdomain Trust Boundary (`SEC-02`)

Because `setSharedCookie` writes `Domain=.yundev.space` (`src/utils/sharedAuth.ts:7-8,28-29`), **every current and future origin matching `*.yundev.space`** can both **read** and **write** `yundev_supabase_auth_token` and `yundev_session`:
- Currently linked in `src/App.tsx:138-184`:
  - `https://yundev.space` / `https://www.yundev.space` (Portal)
  - `https://tinh-luong.yundev.space` (SalaryFlow — HTML/JS/Chart.js)
  - `https://vang-vong-su-viet.yundev.space` (3D Web Game — React, Three.js, R3F, Zustand)
  - `https://vault.yundev.space` (SecretVault — E2EE notes, In Dev)
  - `https://ivf-journey.yundev.space` (IVF Journey — personal health/fertility data, Active)
  - `https://brse.yundev.space` (PM / BrSE Track — Planned)
- **Any other subdomain** ever pointed under `yundev.space` (staging deployments, Vercel preview aliases if mapped under `*.yundev.space`, or dangling CNAMEs subject to subdomain takeover).

**Key trust risks:**
1. **Lowest-common-denominator security:** A single XSS bug in a complex third-party library on the 3D game (`vang-vong-su-viet.yundev.space`) or a static calculator (`tinh-luong.yundev.space`) compromises sessions for sensitive apps (`ivf-journey.yundev.space`, `vault.yundev.space`).
2. **Cross-subdomain session fixation:** `syncSharedSSOSession()` (`src/utils/sharedAuth.ts:162-177`) runs every 2.5 seconds (`src/App.tsx:84`) and calls `supabase.auth.setSession(...)` with whatever `access_token`/`refresh_token` is present in the `.yundev.space` cookie. A compromised sibling subdomain can overwrite the cookie with an attacker-owned session token, forcing the victim's portal/sibling app into the attacker's account.
3. **Loose hostname matching:** `window.location.hostname.includes('yundev.space')` (`src/utils/sharedAuth.ts:8`) uses substring matching rather than exact apex/suffix validation (`hostname === 'yundev.space' || hostname.endsWith('.yundev.space')`).

### 3.6 Missing Rate Limiting & Caching on `/api/config` (`SEC-05`)

`api/config.js:21` sets `Cache-Control: no-store, max-age=0` with no rate limiting in code or `vercel.json`. Every request triggers a serverless function invocation despite the payload being static and public. Enabling CDN edge caching (`s-maxage` + `Vary: Origin`) or supplying build-time `VITE_SUPABASE_*` variables—combined with Vercel Firewall rate limiting—eliminates unnecessary function execution and mitigates invocation-flooding / denial-of-wallet risk.

### 3.7 Dependency Surface (`SEC-10`)

- **Runtime footprint (`package.json:15-20`):** Only 4 direct dependencies (`react@19.2.8`, `react-dom@19.2.8`, `@supabase/supabase-js@2.111.0`, `lucide-react@1.28.0`). This small surface is a security positive.
- **React 19:** This project is a client-only Vite SPA (`src/main.tsx`), so React Server Components / Server Actions attack surfaces do not apply. Reviewed JSX in `src/App.tsx` relies on React's default escaping with zero `dangerouslySetInnerHTML`, `innerHTML`, or `eval` usage.
- **Supabase JS (`@supabase/supabase-js@^2.111.0`):** High-trust dependency managing auth tokens, auto-refresh, and URL session detection (`detectSessionInUrl: true` at `src/utils/sharedAuth.ts:87`). Because caret ranges (`^`) are used and `npm audit` / lockfile inspection could not be executed in this static review, transitive dependency vulnerability status is unverified and must be checked in CI.
- **External assets:** `index.html:9-11` loads Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), introducing a third-party runtime dependency and widening CSP `style-src`/`font-src`.

### 3.8 Public GitHub Repository & Secret Hygiene (`SEC-06`)

- **Verified clean in working tree:** `.env.example` contains only dummy placeholder values (`abcdefghijklmnopqrst.supabase.co` and a truncated JWT header prefix `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`). `.gitignore:14-16` properly excludes `.env` and `.env.*` while preserving `!.env.example`. No secrets or service-role keys were found in any of the 11 read files.
- **Unverified gap:** Because shell commands (`git log`, `gitleaks`, `trufflehog`) cannot be run in this environment, **git commit history across branches and tags has NOT been verified**. For a public GitHub repository, a full history scan and GitHub Secret Scanning + Push Protection are mandatory before considering the repository clean.

---

## 4. Existing Positive Controls Observed

- **Transport & Framing Headers (`vercel.json`):** `Strict-Transport-Security` (`max-age=31536000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` are configured globally.
- **XSS Sink Hygiene (`src/App.tsx`):** No `dangerouslySetInnerHTML`, `eval`, or raw DOM injection; user-controlled values (`currentUser.email`, `authMessage.text`) are rendered via React JSX escaping.
- **External Link Safety (`src/App.tsx:238,301-304`):** External links opened in new tabs include `rel="noopener noreferrer"`.
- **Minimal Runtime Dependencies (`package.json:15-20`):** Only 4 direct production packages, limiting supply-chain attack surface.
- **Secret Exclusion Baseline (`.gitignore:14-16`, `.env.example`):** `.env` and `.env.*` are gitignored; no `SUPABASE_SERVICE_ROLE_KEY` appears anywhere in the reviewed files.

---

## 5. Release Gate

### 5.1 Must-Close Before Publish-Ready (Blocking)

| ID | Requirement | Rationale |
|---|---|---|
| **SEC-03** | Enforce a strict `Content-Security-Policy` in `vercel.json`. | Essential defense-in-depth against XSS, especially critical while session tokens remain JS-accessible. |
| **SEC-04** | Fix `/api/config` CORS logic: remove fallback `ACAO`, add `Vary: Origin`, restrict to `GET`/`OPTIONS`, gate `localhost` out of production, and align `allowedOrigins`. | Prevents CORS/cache policy bugs and removes production `localhost` trust. |
| **SEC-05** | Replace `no-store` with edge caching (`s-maxage` + `Vary: Origin`) or build-time env injection, and enable Vercel Firewall rate limiting on `/api/*`. | Prevents unauthenticated serverless invocation exhaustion. |
| **SEC-06** | Run a full git history secret scan (`gitleaks` / `trufflehog`) and enable GitHub Secret Scanning + Push Protection. | Public repo history was not verifiable statically; confirms zero historical credential leaks. |
| **SEC-08 & SEC-09** | Update `vercel.json` to set `X-XSS-Protection: 0` (or remove it) and add a deny-by-default `Permissions-Policy`. | Low-effort hardening completed in the same `vercel.json` header update as `SEC-03`. |
| **SEC-02 (partial — immediate)** | Fix `.includes('yundev.space')` hostname check in `src/utils/sharedAuth.ts:8` to exact apex/suffix match, and verify DNS records for `*.yundev.space` have no dangling CNAMEs. | Prevents hostname-matching bugs and wildcard subdomain takeover exposure. |

### 5.2 Conditional Release Gate (Auth & High-Sensitivity Subdomains)

- **SEC-01 & SEC-02 (Wildcard JS-readable SSO tokens):**
  - **Hard block before connecting sensitive apps (`vault.yundev.space`, `ivf-journey.yundev.space`) or onboarding general public users:** Complete ADR-0001 (`AUTH-MIG-0001` — backend `/api/auth/*` issuing `HttpOnly; Secure; SameSite` cookies + CSRF protection) **and** isolate high-sensitivity subdomains from sharing wildcard cookies with lower-trust/higher-surface apps (such as `vang-vong-su-viet.yundev.space`).
  - **Temporary exception (personal portal launch only):** If the portal is published solely as a personal showcase with non-sensitive demo/owner auth *after* `SEC-03` (CSP) is enforced, `SEC-01` may be carried as a **time-boxed risk** tracked against `AUTH-MIG-0001`, not a permanently accepted risk.

### 5.3 Accepted Risks (With Mandatory Conditions)

- **SEC-11 (Supabase `anon` key exposed via `/api/config`):** Accepted by design for Supabase browser clients, **strictly contingent on** an independent audit confirming that Row-Level Security (RLS) is enabled and tested on all Supabase tables, Auth rate-limiting/redirect allowlists are configured, and `SUPABASE_SERVICE_ROLE_KEY` is never exposed to client or `/api/config` runtimes.

### 5.4 Non-Blocking Post-Launch Hardening

- **SEC-07:** Fix the `/api/config` async client-reassignment race, validate `res.ok` and `supabaseUrl` origin, and clean up the anonymous `storage` event listener.
- **SEC-10:** Add `npm audit` and `npm ci` checks in CI, enable Dependabot, review whether `detectSessionInUrl: true` is needed on the portal, and optionally self-host Google Fonts.
