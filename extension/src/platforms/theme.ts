import type { ThemeName } from './types';

/**
 * Resolve the page's effective light/dark appearance.
 *
 * Platforms signal dark mode inconsistently, so a single check isn't enough:
 *   - ChatGPT toggles a literal `dark` class on <html>.
 *   - claude.ai sets a *named* theme (`data-theme="claude"`) and only reflects the
 *     actual mode through the CSS `color-scheme` property + a dark background — its
 *     <html> carries no `dark`/`light` token, so a class/data-theme check alone
 *     mislabels a dark page as light and the toggle renders light-on-dark.
 *
 * We check, in order of confidence: an explicit dark/light token, the page's
 * declared `color-scheme`, the luminance of the page background (theme-name
 * agnostic), then the OS preference.
 */
export function resolveTheme(): ThemeName {
  const de = document.documentElement;

  // 1. Explicit dark/light token on <html> (ChatGPT's `dark` class; some apps use data-theme).
  const ds = de.dataset.theme;
  if (ds === 'dark' || ds === 'light') return ds;
  const cls = de.className;
  if (/\bdark\b/.test(cls)) return 'dark';
  if (/\blight\b/.test(cls)) return 'light';

  // 2. The `color-scheme` the page declares for its active theme (claude.ai sets this).
  const scheme = getComputedStyle(de).colorScheme;
  const schemeDark = /\bdark\b/.test(scheme);
  const schemeLight = /\blight\b/.test(scheme);
  if (schemeDark && !schemeLight) return 'dark';
  if (schemeLight && !schemeDark) return 'light';

  // 3. Luminance of the first opaque page background — independent of theme naming.
  const lum = backgroundLuminance();
  if (lum != null) return lum < 0.5 ? 'dark' : 'light';

  // 4. OS preference.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Relative luminance (0 = black, 1 = white) of the nearest opaque page background. */
function backgroundLuminance(): number | null {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const c = parseRgb(getComputedStyle(el).backgroundColor);
    if (c && c.a > 0.5) return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }
  return null;
}

function parseRgb(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
}
