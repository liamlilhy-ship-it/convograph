import { describe, it, expect } from 'vitest';

/**
 * Enforces the platform isolation boundary at test time (this repo has no ESLint,
 * so a unit test is the build-failing guard):
 *   1. Nothing under platforms/claude may import platforms/chatgpt, and vice versa
 *      — so editing one platform can never affect the other.
 *   2. The generic core (tree / panel / navigation + the shared content files) may
 *      not import a CONCRETE platform module — only the shared interface/model/
 *      errors. The composition entries (registry, index, mainWorld.*) are exempt.
 *
 * Sources are loaded as raw text via Vite's import.meta.glob (no Node fs, so no
 * @types/node needed).
 */

const files = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function importsOf(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]!);
  return specs;
}

const entries = Object.entries(files);

describe('platform isolation boundary', () => {
  it('loaded the source tree', () => {
    // Sanity: the glob must actually match files, or the checks below are vacuous.
    expect(entries.length).toBeGreaterThan(10);
  });

  it('platforms/claude never imports platforms/chatgpt', () => {
    for (const [path, src] of entries) {
      if (!path.includes('/platforms/claude/')) continue;
      const bad = importsOf(src).filter((s) => s.includes('chatgpt'));
      expect(bad, `${path} imports ChatGPT: ${bad.join(', ')}`).toEqual([]);
    }
  });

  it('platforms/chatgpt never imports platforms/claude', () => {
    for (const [path, src] of entries) {
      if (!path.includes('/platforms/chatgpt/')) continue;
      const bad = importsOf(src).filter((s) => s.includes('claude'));
      expect(bad, `${path} imports Claude: ${bad.join(', ')}`).toEqual([]);
    }
  });

  it('the generic core never imports a concrete platform module', () => {
    const isCore = (p: string) =>
      p.includes('/tree/') ||
      p.includes('/panel/') ||
      p.includes('/navigation/') ||
      p.endsWith('/content/observers.ts') ||
      p.endsWith('/content/anchorComposer.ts') ||
      p.endsWith('/content/mount.tsx');
    for (const [path, src] of entries) {
      if (!isCore(path)) continue;
      const bad = importsOf(src).filter(
        (s) => s.includes('platforms/claude') || s.includes('platforms/chatgpt'),
      );
      expect(bad, `${path} imports a concrete platform: ${bad.join(', ')}`).toEqual([]);
    }
  });
});
