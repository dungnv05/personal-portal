# personal-portal

## What this is

This repository is a React single-page application built with Vite, with one Vercel serverless endpoint at `/api/config`.  
The frontend renders a personal portal UI and includes Supabase email/password authentication in the main app flow.  
Session data is synchronized across `*.yundev.space` using shared cookie and local storage logic in the auth utility.

## Stack

- React `^19.2.8`
- React DOM `^19.2.8`
- Vite `^8.2.0`
- `@vitejs/plugin-react` `^6.0.4`
- Supabase JS client `^2.111.0`
- `lucide-react` `^1.28.0`
- Oxlint `^1.75.0`
- Vercel serverless function (`api/config.js`)

## Prerequisites

- Node 20+ (no `engines` field is defined in `package.json`)

## Local setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd personal-portal
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment template:
   ```bash
   cp .env.example .env
   ```
4. Fill `.env` with your values for:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Start local development:
   ```bash
   npm run dev
   ```

## Scripts

| Script | Command (from `package.json`) |
| --- | --- |
| `dev` | `vite` |
| `build` | `vite build` |
| `lint` | `oxlint` |
| `preview` | `vite preview` |

## Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `src/utils/sharedAuth.js`, `api/config.js` | Primary frontend Supabase URL; also used as fallback in API config response. |
| `VITE_SUPABASE_ANON_KEY` | `src/utils/sharedAuth.js`, `api/config.js` | Primary frontend Supabase anon key; also used as fallback in API config response. |
| `SUPABASE_URL` | `api/config.js` | Optional server-side override for `/api/config` response. |
| `SUPABASE_ANON_KEY` | `api/config.js` | Optional server-side override for `/api/config` response. |

## Architecture in 5 lines

1. `index.html` loads `/src/main.jsx` and mounts the app into `#root`.
2. `src/main.jsx` renders `App` inside React `StrictMode`.
3. `src/App.jsx` provides the SPA UI, auth modal, and authenticated user state handling.
4. `src/utils/sharedAuth.js` configures Supabase client auth storage and cross-subdomain session sync.
5. `api/config.js` serves runtime Supabase config and applies CORS allowlisting for known origins.

## Deploy

- Create a Vercel project for this repository.
- Add required environment variables in the Vercel dashboard (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; optionally `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Security headers are configured through `vercel.json` and applied for `/(.*)`.
- Current domain set referenced by auth/CORS logic includes:
  - `yundev.space`
  - `www.yundev.space`
  - `tinh-luong.yundev.space`
  - `brse.yundev.space`

## Troubleshooting

- **CORS blocked on a new subdomain**: `api/config.js` uses a static `allowedOrigins` list. Add the new origin there and redeploy.
- **401 after login**: shared-session sync in `src/utils/sharedAuth.js` relies on `yundev_session` and `yundev_supabase_auth_token` cookies/storage keys; verify those values are present and consistent across subdomains.
- **Build fails on missing env**: ensure Supabase env variables are defined before `npm run build`, especially if your pipeline enforces required envs.

## Documentation index

- [Product Requirements](./docs/PRD.md)
- [Technical Requirements](./docs/TRD.md)
- [ADR 0001: Shared Auth Across Subdomains](./docs/ADR/0001-shared-auth-across-subdomains.md)

## Roadmap

- Migrate frontend code to TypeScript.
- Add automated tests with Vitest.
- Move to HttpOnly cookie based auth session handling.
- Run a full security pass for SPA and serverless auth/config flows.
