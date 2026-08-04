import { describe, it, expect } from 'vitest';
import { isSupportedSurface } from '../platforms/chatgpt/client';

/**
 * chatgpt.com hosts dedicated apps (Images, Sites, Health, Finances, Codex)
 * whose prompt boxes match our composer selector but have no conversation
 * tree — the pill must stay hidden there. Chat surfaces and list pages keep
 * showing (default-allow, so future chat surfaces aren't suppressed).
 */

const u = (path: string) => `https://chatgpt.com${path}`;

describe('chatgpt isSupportedSurface', () => {
  it('keeps the pill on chat surfaces', () => {
    expect(isSupportedSurface(u('/'))).toBe(true);
    expect(isSupportedSurface(u('/c/6a5e854a-632c-83e8-b00a-ff9559106669'))).toBe(true);
    expect(
      isSupportedSurface(
        u('/g/g-p-69989444f07c81919167cb675391692f/c/69993bb2-433c-8328-9fac-cc417fdee199'),
      ),
    ).toBe(true);
  });

  it('leaves list pages default-allowed', () => {
    expect(isSupportedSurface(u('/library'))).toBe(true);
    expect(isSupportedSurface(u('/gpts'))).toBe(true);
    expect(isSupportedSurface(u('/scheduled'))).toBe(true);
    expect(isSupportedSurface(u('/plugins'))).toBe(true);
  });

  it('hides the pill on the dedicated apps', () => {
    expect(isSupportedSurface(u('/images'))).toBe(false);
    expect(isSupportedSurface(u('/images/'))).toBe(false);
    expect(isSupportedSurface(u('/sites'))).toBe(false);
    expect(isSupportedSurface(u('/health'))).toBe(false);
    expect(isSupportedSurface(u('/finances'))).toBe(false);
    expect(isSupportedSurface(u('/codex'))).toBe(false);
    expect(isSupportedSurface(u('/codex/settings'))).toBe(false);
  });

  it('only matches whole path segments', () => {
    expect(isSupportedSurface(u('/imagesque'))).toBe(true);
    expect(isSupportedSurface(u('/healthy'))).toBe(true);
  });
});
