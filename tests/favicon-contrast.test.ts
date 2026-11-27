import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://yundev.space https://www.yundev.space https://tinh-luong.yundev.space https://brse.yundev.space https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";

type RGBA = { r: number; g: number; b: number; a: number };

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function extractBraceBlock(css: string, openBraceIndex: number): string {
  let depth = 0;
  let i = openBraceIndex;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        return css.slice(openBraceIndex + 1, i);
      }
    }
  }
  throw new Error('Unclosed CSS block');
}

function parseTokens(blockBody: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const cleaned = blockBody.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function resolveToken(
  name: string,
  block: Record<string, string>,
  fallback: Record<string, string>,
  seen = new Set<string>(),
): string {
  if (seen.has(name)) {
    throw new Error(`Circular CSS variable reference: ${name}`);
  }
  seen.add(name);
  const raw = block[name] ?? fallback[name];
  if (!raw) {
    throw new Error(`Missing CSS token: ${name}`);
  }
  const varMatch = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec(raw);
  if (varMatch) {
    return resolveToken(varMatch[1], block, fallback, seen);
  }
  return raw;
}

function parseColor(value: string): RGBA {
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgbaMatch =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/.exec(
      value.trim(),
    );
  if (rgbaMatch) {
    return {
      r: Number(rgbaMatch[1]),
      g: Number(rgbaMatch[2]),
      b: Number(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1,
    };
  }

  throw new Error(`Unsupported color format: ${value}`);
}

function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a;
  return {
    r: a * fg.r + (1 - a) * bg.r,
    g: a * fg.g + (1 - a) * bg.g,
    b: a * fg.b + (1 - a) * bg.b,
    a: 1,
  };
}

function linearizeChannel(channel255: number): number {
  const srgb = channel255 / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RGBA): number {
  const r = linearizeChannel(color.r);
  const g = linearizeChannel(color.g);
  const b = linearizeChannel(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: RGBA, bg: RGBA): number {
  const solidBg = bg.a < 1 ? compositeOver(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const solidFg = fg.a < 1 ? compositeOver(fg, solidBg) : fg;
  const l1 = relativeLuminance(solidFg);
  const l2 = relativeLuminance(solidBg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractThemeBlocks(css: string): {
  dark: Record<string, string>;
  lightAttr: Record<string, string>;
  lightMedia: Record<string, string>;
} {
  const darkMatch = /:root\s*\{/.exec(css);
  if (!darkMatch) throw new Error('Dark :root block not found');
  const dark = parseTokens(extractBraceBlock(css, darkMatch.index + darkMatch[0].length - 1));

  const lightAttrMatch = /:root\[data-theme="light"\]\s*\{/.exec(css);
  if (!lightAttrMatch) throw new Error(':root[data-theme="light"] block not found');
  const lightAttr = parseTokens(
    extractBraceBlock(css, lightAttrMatch.index + lightAttrMatch[0].length - 1),
  );

  const mediaMatch = /@media\s*\(\s*prefers-color-scheme:\s*light\s*\)\s*\{/.exec(css);
  if (!mediaMatch) throw new Error('prefers-color-scheme: light media block not found');
  const mediaBody = extractBraceBlock(css, mediaMatch.index + mediaMatch[0].length - 1);
  const innerLightMatch = /:root:not\(\[data-theme="dark"\]\)\s*\{/.exec(mediaBody);
  if (!innerLightMatch) throw new Error(':root:not([data-theme="dark"]) block not found');
  const lightMedia = parseTokens(
    extractBraceBlock(mediaBody, innerLightMatch.index + innerLightMatch[0].length - 1),
  );

  return { dark, lightAttr, lightMedia };
}

describe('favicon and CSP integrity', () => {
  it('index.html declares the three expected icon links and has no inline scripts or on* handlers', () => {
    const html = readFile('index.html');
    const iconLinks = [...html.matchAll(/<link\b[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>/gi)];
    const hrefs = iconLinks.map((m) => {
      const hrefMatch = /href=["']([^"']+)["']/i.exec(m[0]);
      return hrefMatch ? hrefMatch[1] : '';
    });

    expect(hrefs).toEqual(['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']);

    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
    for (const script of scripts) {
      expect(script[1]).toMatch(/\bsrc\s*=/i);
    }

    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('every icon href resolves to an existing file under public/', () => {
    const html = readFile('index.html');
    const iconLinks = [...html.matchAll(/<link\b[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>/gi)];
    expect(iconLinks.length).toBe(3);

    for (const match of iconLinks) {
      const hrefMatch = /href=["']([^"']+)["']/i.exec(match[0]);
      expect(hrefMatch).not.toBeNull();
      const rel = hrefMatch![1].replace(/^\//, '');
      const fullPath = path.join(ROOT, 'public', rel);
      expect(fs.existsSync(fullPath), `Missing public/${rel}`).toBe(true);
    }
  });

  it('public/favicon.ico has valid ICO header and >= 2 images; public/apple-touch-icon.png is 180x180 PNG', () => {
    const ico = fs.readFileSync(path.join(ROOT, 'public', 'favicon.ico'));
    expect(ico.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]));
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);

    const png = fs.readFileSync(path.join(ROOT, 'public', 'apple-touch-icon.png'));
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });

  it('public/favicon.svg is safe and self-contained', () => {
    const svg = readFile('public/favicon.svg');
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).not.toMatch(/(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/)/i);
    expect(svg).not.toMatch(/<image\b/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
  });

  it('vercel.json CSP header is unchanged and allows self + data: images', () => {
    const vercel = JSON.parse(readFile('vercel.json')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const allHeaders = vercel.headers.flatMap((rule) => rule.headers);
    const csp = allHeaders.find((h) => h.key === 'Content-Security-Policy');
    expect(csp).toBeDefined();
    expect(csp!.value).toBe(EXPECTED_CSP);
    expect(csp!.value).toContain("img-src 'self' data:");
  });
});

describe('WCAG 2.x contrast and theme tokens', () => {
  const css = readFile('src/index.css');
  const { dark, lightAttr, lightMedia } = extractThemeBlocks(css);

  const colorOf = (
    name: string,
    block: Record<string, string>,
    fallback: Record<string, string>,
  ): RGBA => parseColor(resolveToken(name, block, fallback));

  it('both light theme blocks define identical values for every shared token', () => {
    const sharedKeys = Object.keys(lightAttr).filter((k) => k in lightMedia);
    expect(sharedKeys.length).toBeGreaterThan(0);
    for (const key of sharedKeys) {
      expect(lightMedia[key], `Mismatch for ${key}`).toBe(lightAttr[key]);
    }
    expect(Object.keys(lightMedia).sort()).toEqual(Object.keys(lightAttr).sort());
  });

  it('light theme meets WCAG AA contrast ratios', () => {
    const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
    const surfaces = ['--bg', '--surface', '--surface-2'] as const;
    const textTokens = ['--text', '--muted', '--accent-text', '--accent-badge-text'] as const;

    for (const fgToken of textTokens) {
      const fg = colorOf(fgToken, lightAttr, dark);
      for (const bgToken of surfaces) {
        const bg = colorOf(bgToken, lightAttr, dark);
        expect(
          contrastRatio(fg, bg),
          `Light ${fgToken} on ${bgToken}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    const lightSurface = colorOf('--surface', lightAttr, dark);
    const lightBg = colorOf('--bg', lightAttr, dark);

    const mintBg = compositeOver(colorOf('--mint-soft', lightAttr, dark), lightSurface);
    expect(
      contrastRatio(colorOf('--mint-text', lightAttr, dark), mintBg),
      'Light --mint-text on --mint-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const peachBg = compositeOver(colorOf('--peach-soft', lightAttr, dark), lightSurface);
    expect(
      contrastRatio(colorOf('--peach-text', lightAttr, dark), peachBg),
      'Light --peach-text on --peach-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const accentBg = compositeOver(colorOf('--accent-soft', lightAttr, dark), lightSurface);
    expect(
      contrastRatio(colorOf('--accent-badge-text', lightAttr, dark), accentBg),
      'Light --accent-badge-text on --accent-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const heroAccentBg = compositeOver(colorOf('--accent-soft', lightAttr, dark), lightBg);
    expect(
      contrastRatio(colorOf('--accent-badge-text', lightAttr, dark), heroAccentBg),
      'Light --accent-badge-text on --accent-soft over --bg',
    ).toBeGreaterThanOrEqual(4.5);

    const danger = colorOf('--danger', lightAttr, dark);
    expect(
      contrastRatio(danger, lightSurface),
      'Light --danger on --surface',
    ).toBeGreaterThanOrEqual(4.5);

    const dangerBg = compositeOver(colorOf('--danger-soft', lightAttr, dark), lightSurface);
    expect(
      contrastRatio(danger, dangerBg),
      'Light --danger on --danger-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const btnBorder = colorOf('--btn-secondary-border', lightAttr, dark);
    expect(
      contrastRatio(btnBorder, white),
      'Light --btn-secondary-border on #FFFFFF',
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(btnBorder, colorOf('--bg', lightAttr, dark)),
      'Light --btn-secondary-border on --bg',
    ).toBeGreaterThanOrEqual(3);

    const lightBgSoft = colorOf('--bg-soft', lightAttr, dark);
    expect(
      contrastRatio(colorOf('--muted', lightAttr, dark), lightBgSoft),
      'Light --muted on --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(colorOf('--text', lightAttr, dark), lightBgSoft),
      'Light --text on --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
    const disabledPeachBg = compositeOver(colorOf('--peach-soft', lightAttr, dark), lightBgSoft);
    expect(
      contrastRatio(colorOf('--peach-text', lightAttr, dark), disabledPeachBg),
      'Light --peach-text on --peach-soft over --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('dark theme meets WCAG AA contrast ratios', () => {
    const surfaces = ['--bg', '--surface', '--surface-2'] as const;
    const textTokens = ['--text', '--muted', '--accent-text', '--accent-badge-text'] as const;

    for (const fgToken of textTokens) {
      const fg = colorOf(fgToken, dark, dark);
      for (const bgToken of surfaces) {
        const bg = colorOf(bgToken, dark, dark);
        expect(
          contrastRatio(fg, bg),
          `Dark ${fgToken} on ${bgToken}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    const darkSurface = colorOf('--surface', dark, dark);

    const mintBg = compositeOver(colorOf('--mint-soft', dark, dark), darkSurface);
    expect(
      contrastRatio(colorOf('--mint-text', dark, dark), mintBg),
      'Dark --mint-text on --mint-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const peachBg = compositeOver(colorOf('--peach-soft', dark, dark), darkSurface);
    expect(
      contrastRatio(colorOf('--peach-text', dark, dark), peachBg),
      'Dark --peach-text on --peach-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const accentBg = compositeOver(colorOf('--accent-soft', dark, dark), darkSurface);
    expect(
      contrastRatio(colorOf('--accent-badge-text', dark, dark), accentBg),
      'Dark --accent-badge-text on --accent-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const danger = colorOf('--danger', dark, dark);
    expect(
      contrastRatio(danger, darkSurface),
      'Dark --danger on --surface',
    ).toBeGreaterThanOrEqual(4.5);

    const dangerBg = compositeOver(colorOf('--danger-soft', dark, dark), darkSurface);
    expect(
      contrastRatio(danger, dangerBg),
      'Dark --danger on --danger-soft',
    ).toBeGreaterThanOrEqual(4.5);

    const btnBorder = colorOf('--btn-secondary-border', dark, dark);
    expect(
      contrastRatio(btnBorder, colorOf('--bg', dark, dark)),
      'Dark --btn-secondary-border on --bg',
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(btnBorder, darkSurface),
      'Dark --btn-secondary-border on --surface',
    ).toBeGreaterThanOrEqual(3);

    const darkBgSoft = colorOf('--bg-soft', dark, dark);
    expect(
      contrastRatio(colorOf('--muted', dark, dark), darkBgSoft),
      'Dark --muted on --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(colorOf('--text', dark, dark), darkBgSoft),
      'Dark --text on --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
    const disabledPeachBg = compositeOver(colorOf('--peach-soft', dark, dark), darkBgSoft);
    expect(
      contrastRatio(colorOf('--peach-text', dark, dark), disabledPeachBg),
      'Dark --peach-text on --peach-soft over --bg-soft',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('App.css wires status badges and auth input borders to the contrast tokens', () => {
    const appCss = readFile('src/App.css');
    expect(appCss).toMatch(/\.status-active\s*\{[^}]*color:\s*var\(--mint-text\)/s);
    expect(appCss).toMatch(/\.status-dev\s*\{[^}]*color:\s*var\(--peach-text\)/s);
    expect(appCss).toMatch(/\.auth-input-group\s+input\s*\{[^}]*border:\s*1px\s+solid\s+var\(--input-border\)/s);
    expect(appCss).toMatch(/\.profile-feedback-success\s*\{[^}]*color:\s*var\(--mint-text\)/s);
    expect(appCss).toMatch(/\.auth-alert-success\s*\{[^}]*color:\s*var\(--mint-text\)/s);
  });

  it('App.css disabled card and button rules avoid text opacity and use --bg-soft', () => {
    const appCss = readFile('src/App.css');

    const cardMatch = /\.app-card-disabled\s*\{/.exec(appCss);
    expect(cardMatch).not.toBeNull();
    const cardBody = extractBraceBlock(appCss, cardMatch!.index + cardMatch![0].length - 1);
    expect(cardBody).not.toMatch(/\bopacity\s*:/i);
    expect(cardBody).toMatch(/background:\s*var\(--bg-soft\)/);

    const btnMatch = /\.btn-launch-disabled\s*\{/.exec(appCss);
    expect(btnMatch).not.toBeNull();
    const btnBody = extractBraceBlock(appCss, btnMatch!.index + btnMatch![0].length - 1);
    expect(btnBody).not.toMatch(/\bopacity\s*:/i);
  });
});
