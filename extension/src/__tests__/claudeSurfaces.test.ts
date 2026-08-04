import { describe, it, expect } from 'vitest';
import { isSupportedSurface } from '../platforms/claude/client';

/**
 * claude.ai hosts several apps on one origin. The pill must stay hidden on the
 * two that have a composer but no conversation tree (Design, Code web) and keep
 * showing everywhere else — including future unknown paths (default-allow, so a
 * new chat surface isn't accidentally suppressed).
 */

const u = (path: string) => `https://claude.ai${path}`;

describe('claude isSupportedSurface', () => {
  it('keeps the pill on chat surfaces', () => {
    expect(isSupportedSurface(u('/new'))).toBe(true);
    expect(isSupportedSurface(u('/chat/188859d9-a2c7-4dcd-9883-c3be4ecdefa9'))).toBe(true);
    expect(isSupportedSurface(u('/cowork/project/019f4289-ac99-762b-b4fc-7111c35cd260'))).toBe(true);
    expect(isSupportedSurface(u('/cowork/projects'))).toBe(true);
    expect(isSupportedSurface(u('/chats'))).toBe(true);
  });

  it('hides the pill on Claude Design', () => {
    expect(isSupportedSurface(u('/design'))).toBe(false);
    expect(isSupportedSurface(u('/design?via=web_frame_sidebar'))).toBe(false);
    expect(isSupportedSurface(u('/design/p/4103e510-419b-4940-876a-e74b7007cafa'))).toBe(false);
  });

  it('hides the pill on Claude Code web', () => {
    expect(isSupportedSurface(u('/code'))).toBe(false);
    expect(isSupportedSurface(u('/code/session_019em1zHJf4V99RFiRJ2oqbQ'))).toBe(false);
  });

  it('only matches whole path segments', () => {
    expect(isSupportedSurface(u('/designer'))).toBe(true);
    expect(isSupportedSurface(u('/codex'))).toBe(true);
  });
});
