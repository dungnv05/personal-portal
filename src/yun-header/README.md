# `<yun-header>`

Framework-free Web Component for the shared YunDev ecosystem header (`*.yundev.space`). Uses Shadow DOM, zero external runtime dependencies, and CSS custom properties for per-app theming.

## Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `app` | `"portal" \| "tinh-luong" \| "brse" \| "vang-vong" \| "ivf"` | — | Identifies the host application. |
| `auth-base` | `string` | `"https://www.yundev.space"` | Base URL for `/api/auth/me`, `/api/auth/refresh`, `/api/auth/logout`, and sign-in/sign-up redirects. Allowlisted to the exact production hosts (`yundev.space`, `www.yundev.space`, `tinh-luong.yundev.space`, `brse.yundev.space`, `vang-vong-su-viet.yundev.space`, `ivf-journey.yundev.space` over `https` with no explicit non-443 port) or `http://localhost` / `http://127.0.0.1` in dev builds only; values with control chars, whitespace, or `\` fall back to the default. |
| `variant` | `"bar" \| "overlay"` | `"bar"` | `"bar"` renders a 64px sticky bar (56px on `<=640px`); `"overlay"` renders a 48px translucent bar. |
| `profile-url` | `string` | `${authBase}/?view=profile` | Destination for the "Hồ sơ" menu item. Accepts allowlisted origins (same as `auth-base`) or a same-origin relative path starting with `/` (not `//`); values with control chars, whitespace, or `\` or disallowed origins fall back to `${authBase}/?view=profile`. |
| `hide-account` | `boolean` | `false` | Hides the account block, expired-session notice, and logout-error notice. |
| `skip-target` | `string` | `"#main"` | `href` for the skip link ("Bỏ qua đến nội dung"). Must match `/^#[A-Za-z][\w-]*$/`; otherwise falls back to `"#main"`. |
| `no-theme-toggle` | `boolean` | `false` | Hides the built-in light/dark theme toggle button (escape hatch). |
| `nav-label` | `string` | `"Điều hướng chính"` | Accessible `aria-label` for the `<nav>` landmark (desktop and mobile sheet) and the mobile sheet nav heading when app slots are used. Trimmed, control characters stripped, max 60 characters; empty/invalid falls back to `"Điều hướng chính"`. |
| `collapse` | `"md" \| "lg"` | `"md"` | Breakpoint at which `.yh-nav` (and `.yh-shared-link`) collapse into the mobile menu sheet: `"md"` (`<=640px`) or `"lg"` (`<=1023px`, keeping the desktop account block visible at `641px–1023px`). |
| `shared-nav` | `boolean` | `false` | Opt-in. Renders a desktop 4-square grid icon link (`Về YunDev.space` → `${authBase}/`) before the theme toggle (hidden when collapsed) and a `YunDev.space` section in the mobile sheet. |

## Slots

| Slot | Description |
| --- | --- |
| `app-title` | Styled app logo/title on the left (`inline-flex`, `min-height: 44px`, `--yh-ink`, bold). |
| `app-nav` | Styled primary navigation links (`<a slot="app-nav" href="...">` directly, no nested `<nav>`). Centers `.yh-nav`, supports `aria-current="page"`, and merges into the mobile sheet. |
| `app-actions` | App action controls placed before the shared link, theme toggle, and account block (`inline-flex`). Stays in the bar on mobile (not cloned into the sheet) so JS event listeners keep working. |
| `brand` | Legacy alias for left-side brand content (unstyled, kept for backward compatibility). |
| `nav` | Legacy alias for primary navigation links (unstyled, cloned into the mobile sheet before `app-nav`). |
| `actions` | Legacy alias for action controls (unstyled, placed before `app-actions`). |

## App slots — single header bar (SLOT_API 1)

Subdomains (`brse.yundev.space`, etc.) can render a single unified header bar by injecting their app title, navigation links, and actions directly into `<yun-header>`.

### Slots & Legacy Aliases

| Slot | Status | Role | Shadow Styling |
| --- | --- | --- | --- |
| `app-title` | New (`SLOT_API 1`) | App logo / title in `.yh-left` | `inline-flex`, `gap: 8px`, `min-height: 44px`, `--yh-ink`, `font-weight: 700` |
| `app-nav` | New (`SLOT_API 1`) | Direct `<a href="...">` links in `.yh-nav` | `inline-flex`, `min-height: 40px`, `--yh-muted`, hover pill, `aria-current="page"` underline, focus ring |
| `app-actions` | New (`SLOT_API 1`) | App controls (search, CTA, etc.) in `.yh-right` | `inline-flex`, `align-items: center` |
| `brand` | Legacy alias | Left-side brand | Unstyled |
| `nav` | Legacy alias | Navigation links | Unstyled |
| `actions` | Legacy alias | Right-side actions | Unstyled |

Use `aria-current="page"` on the active `<a slot="app-nav">` link to highlight it with `--yh-primary` both in the desktop bar and inside the mobile menu sheet.

### Mobile Menu Merge Rules

When the mobile sheet (`#yh-sheet`) opens:
1. **App & legacy navigation**: Clones assigned elements from `nav` (first) and `app-nav` (second) into `<nav class="yh-sheet-nav">`. Every `slot` attribute and every `id` attribute in the cloned subtree is stripped to prevent duplicate IDs, while `aria-current` is preserved. When `app-nav` has items or `shared-nav` is set, a `<p class="yh-sheet-heading">` with `nav-label` is rendered above the links.
2. **YunDev.space section**: When `shared-nav` is present, a `<div class="yh-sheet-section">` with heading `YunDev.space` and link `Về trang chủ YunDev.space` → `${authBase}/` is rendered after the nav.
3. **Account block**: Rendered at the bottom (hidden on `641px–1023px` when `collapse="lg"` since the desktop account button remains visible there).
4. **`app-actions` are NOT cloned**: Controls in `app-actions` remain in `.yh-right` at all viewport widths so their DOM state and JS event listeners keep working without duplication.

### Feature Detection & Fallback

```js
customElements.whenDefined('yun-header').then((Ctor) => {
  if (Ctor.SLOT_API >= 1) {
    // Mount app-title, app-nav, app-actions into <yun-header>
  } else {
    legacyFallback()
  }
})
```

You can also import `YUN_HEADER_SLOT_API` from the module (`1`).

### Full HTML Example (Subdomain)

```html
<yun-header
  app="brse"
  auth-base="https://www.yundev.space"
  nav-label="Điều hướng BrSE"
  collapse="lg"
  shared-nav
>
  <a slot="app-title" href="/">BrSE Study</a>

  <a slot="app-nav" href="/roadmap" aria-current="page">Lộ trình</a>
  <a slot="app-nav" href="/kanji">Kanji</a>
  <a slot="app-nav" href="/mock-test">Thi thử</a>

  <button slot="app-actions" type="button" id="open-search">Tìm kiếm</button>
</yun-header>
```

### CSP & Security Notes

- All Shadow DOM nodes are built with `document.createElement` and `textContent` only (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, or inline `on*=` handler strings).
- `nav-label` strips ASCII control characters and truncates to 60 characters.
- `shared-nav` links always use the allowlisted, sanitized `authBase`.

### Backward Compatibility

Pages that do not use `app-title`, `app-nav`, `app-actions`, `nav-label`, `collapse`, or `shared-nav` render identically to previous versions (no `.yh-nav--app` class, no `.yh-sheet-heading`, no `.yh-sheet-section`, `.yh-shared-link` hidden), with one intentional contrast fix: `.yh-mobile-toggle` now uses `var(--yh-control-border, var(--yh-muted, #B8B3C7))` for its border colour (WCAG 1.4.11 >= 3:1).

## Properties & Methods

- `el.state` (read-only): `'loading' | 'signed-out' | 'signed-in' | 'expired' | 'error'`
- `el.user` (read-only): `{ id, email, displayName, avatarUrl, initials } | null` (`avatarUrl` only accepts `https:` URLs; other schemes or relative paths fall back to initials. The `<img>` sets `referrerPolicy="no-referrer"`, `decoding="async"`, and falls back to initials on `error`. Note: portal CSP `img-src` currently allows only `'self' data:`, so external avatar hosts will be blocked until PR2 decides the CSP `img-src` list.)
- `el.stale` (read-only): `boolean` — `true` when a background `refresh()` times out after 3s while already `signed-in` (the header keeps the existing user in `signed-in` state instead of dropping to `signed-out`; the 3s → `signed-out` fallback applies only when no user was signed in).
- `el.theme` (read-only): `'light' | 'dark'` — current resolved theme (`document.documentElement.dataset.theme` or `resolveTheme()`).
- `el.setTheme(theme: 'light' | 'dark')`: Persists user theme choice to `localStorage` (`yun-theme`) and cookie (`yun_theme`), sets `data-theme` and `colorScheme` on `<html>`, and dispatches `yh-theme-change`.
- `el.refresh()`: Re-fetches `${authBase}/api/auth/me` with `credentials: 'include'`. If `/me` returns `401` and a `csrf` cookie is present, calls `POST ${authBase}/api/auth/refresh` once (single-flight per element) and re-fetches `/me` once on `200`.

## Built-in Light / Dark Theme

`<yun-header>` includes a built-in 42×42px light/dark toggle button in `.yh-right` (after `slot="actions"`, `slot="app-actions"`, and `.yh-shared-link`, and before the account block), visible at all viewport widths unless `no-theme-toggle` is set:

- Shows a moon icon while `light` and a sun icon while `dark` (`title` / `aria-label` = `"Chuyển chế độ sáng/tối"`, `aria-pressed="true"` when dark).
- Read precedence: cookie `yun_theme` → `localStorage['yun-theme']` → legacy `localStorage['theme']` → `prefers-color-scheme: dark` (defaulting to `'light'`).
- On `setTheme(theme)`, writes `localStorage['yun-theme']` and cookie `yun_theme` (`Path=/; Max-Age=31536000; SameSite=Lax`, plus `; Secure` on HTTPS and `; Domain=.yundev.space` on `*.yundev.space` / `yundev.space`).
- Applies `data-theme="light|dark"` and `style.colorScheme` on `<html>` (`document.documentElement`).
- Syncs across tabs (`storage` event), subdomains (`visibilitychange` to `visible`), and OS preference changes (when no stored choice exists).

### Site Integration Recipe

1. Load `/vendor/yun-theme-init.js` as a classic blocking script **first** in `<head>` to prevent FOUC (no inline `<script>` needed, CSP-safe):
   ```html
   <script src="/vendor/yun-theme-init.js"></script>
   ```
2. Define `--yh-*` tokens for `:root[data-theme="light"] yun-header` and `:root[data-theme="dark"] yun-header` from the site's own palette.
3. Key the site's own CSS off `html[data-theme="light"]` / `html[data-theme="dark"]` (with `@media (prefers-color-scheme: light)` guarded by `:root:not([data-theme="dark"])` as pre-JS fallback).

## Events

All events bubble and are `composed: true` (except `yh-theme-change`, which is dispatched on `document` with `{ bubbles: true }`).

| Event | Cancelable | `detail` | Description |
| --- | --- | --- | --- |
| `yh-auth-change` | No | `{ state, user }` | Fired when auth state or user settles. |
| `yh-signin-click` | Yes | — | Fired on "Đăng nhập" / "Đăng nhập lại". If not `preventDefault()`, navigates to `${authBase}/?auth=signin&next=...`. |
| `yh-signup-click` | Yes | — | Fired on "Đăng ký". If not `preventDefault()`, navigates to `${authBase}/?auth=signup&next=...`. |
| `yh-logout` | No | — | Fired after `POST ${authBase}/api/auth/logout` succeeds (`response.ok`) and `refresh()` completes. |
| `yh-menu-toggle` | No | `{ open }` | Fired when the mobile menu sheet opens or closes. |
| `yh-theme-change` | No | `{ theme, source }` | Dispatched on `document` when theme is initialized or changes (`source`: `'init' \| 'user' \| 'system' \| 'sync'`). |

## CSS Parts

- `::part(bar)` — Root `<header>` element.
- `::part(account-button)` — Signed-in account menu trigger button.
- `::part(menu)` — Signed-in dropdown menu (`role="menu"`).

## Theme Tokens

Set these CSS custom properties on `yun-header` (or `:root`):

`--yh-bg`, `--yh-surface`, `--yh-ink`, `--yh-muted`, `--yh-primary`, `--yh-on-primary`, `--yh-focus`, `--yh-border`, `--yh-control-border`, `--yh-font`, `--yh-radius`, `--yh-toggle-border`, `--yh-toggle-hover-bg`, `--yh-toggle-radius`

`--yh-control-border` controls the border colour of `.yh-mobile-toggle` and `.yh-shared-link`, defaulting to `var(--yh-muted, #B8B3C7)` so interactive icon controls meet WCAG 1.4.11 (`>= 3:1` non-text contrast).

### Per-App Token Table

| Token | `portal` | `tinh-luong` | `brse` | `vang-vong` | `ivf` |
| --- | --- | --- | --- | --- | --- |
| `--yh-bg` | `color-mix(in srgb, var(--bg-soft) 84%, transparent)` | `#090d16` (dark) / `#f4f6f9` (light) | `#faf6ef` | `rgba(17,17,17,.72)` | `#f8fafc` |
| `--yh-surface` | `var(--surface)` | `#111827` (proposed) / `#ffffff` (proposed) | `#ffffff` | `#1c1917` (proposed) | `#fff` |
| `--yh-ink` | `var(--text)` | `#f8fafc` (proposed) / `#0f172a` (proposed) | `#1e242b` | `#f5f5f4` (proposed) | `#0f172a` |
| `--yh-muted` | `var(--muted)` | `#94a3b8` (proposed) / `#475569` (proposed) | `#52606d` | `#a8a29e` (proposed) | `#475569` |
| `--yh-primary` | `var(--accent)` | `#4f46e5` | `#c93b2b` | `#D4A24C` (proposed) | `#be185d` |
| `--yh-on-primary` | `var(--accent-ink)` | `#ffffff` | `#ffffff` | `#111111` | `#fff` |
| `--yh-focus` | `var(--accent)` | `#10b981` | `#1e3a5f` | `#D4A24C` (proposed) | `#0369a1` |
| `--yh-border` | `var(--border)` | `rgba(148,163,184,.2)` (proposed) | `#e6dccb` | `rgba(212,162,76,.24)` (proposed) | `#e2e8f0` |
| `--yh-toggle-border` | `var(--btn-secondary-border)` | `#29203a38` / `#ffffff14` | — | — | — |
| `--yh-toggle-hover-bg` | `var(--surface-2)` | `#f7f4fa` / `#252031` | — | — | — |
| `--yh-toggle-radius` | `var(--radius-sm)` | `12px` | — | — | — |
| `--yh-radius` | `var(--radius-sm)` | `10px` (proposed) | `12px` | `8px` (proposed) | `10px` (proposed) |
| `--yh-font` | `var(--font-sans)` | `system-ui, sans-serif` (proposed) | `system-ui, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif` | `system-ui, sans-serif` (proposed) | `system-ui, sans-serif` (proposed) |

## Vendoring Steps (for other YunDev apps)

1. Build the standalone ES bundle in `personal-portal`:
   ```bash
   npm run build:header
   ```
   This outputs `public/vendor/yun-header.js`.
2. Copy `public/vendor/yun-header.js` and `public/vendor/yun-theme-init.js` into your app's static assets (e.g. `public/vendor/`).
3. Load `yun-theme-init.js` first in `<head>`, and `yun-header.js` as a module (it auto-defines `<yun-header>` on load):
   ```html
   <script src="/vendor/yun-theme-init.js"></script>
   <script type="module" src="/vendor/yun-header.js"></script>
   ```
4. Render `<yun-header>` in your app shell with your `app` name and token overrides:
   ```html
   <yun-header app="tinh-luong" auth-base="https://www.yundev.space">
     <a slot="brand" href="/">SalaryFlow</a>
     <nav slot="nav">
       <a href="/gross-to-net">Gross → Net</a>
     </nav>
   </yun-header>
   ```
