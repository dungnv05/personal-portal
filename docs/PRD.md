# Product Requirements Document (PRD)

Related docs: [README](../README.md) · [TRD](./TRD.md) · [PRD](./PRD.md)

## 1. Purpose and Problem

`personal-portal` is a single-page React application that serves as Yun’s personal gateway page: it presents a grid of project cards and provides one authentication flow intended to be shared across `yundev.space` subdomains, so one login state can be synchronized when moving between related apps.

## 2. Users and Access Model

- **Primary user**: Yun (site owner) and users with an email/password account in Supabase Auth (login and sign-up are both exposed in the modal UI).
- **Public access**: The landing page, hero section, technology section, and app cards render without authentication.
- **Authenticated access in this app**: The header shows signed-in identity (`currentUser.email`) and a logout action; unauthenticated state shows a login button.
- **Card definition**: A card is an item in the `apps` array rendered in the apps grid, with `name`, `desc`, `icon`, `url`, `status`, `color`, and `tags`.

## 3. Scope (In)

- Landing page with branded header, hero, app card grid, tech stack section, and footer.
- Email/password authentication flows in modal UI: login, sign-up, and logout.
- Session persistence and synchronization behavior across `*.yundev.space` via shared cookie domain plus local storage, including periodic and event-driven re-sync.

## 4. Non-Goals

- Multi-tenant account model.
- Public self-service signup controls beyond the existing modal (no tenant/workspace concepts).
- Billing, subscriptions, or payments.
- Product analytics platform features.

## 5. Requirements

- **R1. SPA bootstrap**
  - The app must mount React into `#root` through `src/main.jsx` and load from `index.html`.
  - **Acceptance signal**: Opening the site renders the React UI (header, hero, cards) instead of an empty document.

- **R2. Card-based project gateway**
  - The landing page must render cards from the `apps` data structure in `src/App.jsx`.
  - **Acceptance signal**: Each object in `apps` appears as one visible card with name, description, tags, status, and launch action.

- **R3. Auth modal flows**
  - The UI must provide login and sign-up forms (email + password) and allow toggling between modes.
  - **Acceptance signal**: Clicking login opens modal; submitting triggers `signInWithEmail` or `signUpWithEmail` based on mode.

- **R4. Logout behavior**
  - Logout must clear shared session artifacts and local session artifacts, then call Supabase sign-out.
  - **Acceptance signal**: After logout, `currentUser` is cleared and login button returns.

- **R5. Shared session sync across subdomains**
  - The app must attempt to synchronize auth state from shared cookie/local storage using `syncSharedSSOSession`, and re-run sync on focus, visibility changes, storage events, and interval polling.
  - **Acceptance signal**: Session changes in one `*.yundev.space` app can be reflected in this portal without full manual re-login.

- **R6. Runtime Supabase config fallback**
  - When build-time Supabase env values are placeholder/missing, the frontend must fetch `/api/config` and reinitialize Supabase client from response values.
  - **Acceptance signal**: In placeholder env scenario, successful `/api/config` response updates `SUPABASE_CONFIG` and client instance.

- **R7. Config endpoint and origin control**
  - `api/config.js` must return `supabaseUrl` and `supabaseAnonKey`, handle `OPTIONS`, and apply allowlisted CORS origin behavior with cache disabled.
  - **Acceptance signal**: `GET /api/config` returns JSON keys; `OPTIONS /api/config` returns `200`; response includes expected CORS/cache headers.

- **R8. Baseline response security headers**
  - Deployment config must include static security headers defined in `vercel.json`.
  - **Acceptance signal**: Responses include `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, and `Referrer-Policy`.

## 6. Card Inventory (Derived from `src/App.jsx`)

1. **SalaryFlow** → `https://tinh-luong.yundev.space`
2. **Vang Vọng Sử Việt** → `https://vang-vong-su-viet.yundev.space`
3. **SecretVault** → `https://vault.yundev.space`
4. **IVF Journey** → `https://ivf-journey.yundev.space`
5. **PM / BrSE Track** → `https://brse.yundev.space` — Vietnamese-language PM/BrSE-for-Japan course hub (courses, glossary, career path).

## 7. Success Signals

- **S1. Initial load performance target**: Deployed site should load in under 2 seconds (target signal; not directly instrumented in current code/config files).
- **S2. Cross-subdomain login continuity**: Login state persists/synchronizes across `yundev.space` subdomains through the current shared-session mechanism.
- **S3. Post-migration secret handling target**: After planned HttpOnly-cookie migration, no session secret should be readable from JavaScript.

## 8. Open Questions

- **HttpOnly-cookie migration status**: Decided but not implemented. Current implementation stores session data in JavaScript-accessible cookies/local storage (`yundev_session`, `yundev_supabase_auth_token`), so migration design and rollout steps remain to be implemented.

## Source Traceability

- App runtime and UX flow: `src/main.jsx`, `src/App.jsx`, `src/App.css`, `src/index.css`, `index.html`
- Auth and session-sharing mechanics: `src/utils/sharedAuth.js`
- Runtime config endpoint: `api/config.js`
- Dependency/runtime stack and scripts: `package.json`
- Deployment headers: `vercel.json`
- Environment variable contract: `.env.example`
