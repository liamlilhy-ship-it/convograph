import { describe, expect, it } from 'vitest';
import { ClaudePlatform } from '../platforms/claude/platform';
import { ChatGptPlatform } from '../platforms/chatgpt/platform';

// Pins the capability contract each platform declares, so a change meant for one
// platform can't silently alter the other's behavior (the app gates every
// branch-switch / write path on these flags).
describe('platform capabilities', () => {
  it('Claude declares no branch switch (no in-place switch exists since Nov 2026)', () => {
    expect(ClaudePlatform.capabilities).toEqual({
      serverBranchSwitch: false,
      serverPersistsActiveBranch: false,
      edit: true,
      followup: true,
      regenerate: true,
      search: true,
    });
    expect(ClaudePlatform.setActiveLeaf).toBeUndefined();
    expect(typeof ClaudePlatform.detectActiveLeaf).toBe('function');
  });

  it('ChatGPT declares no branch switch (no in-place switch exists since Sept 2026)', () => {
    expect(ChatGptPlatform.capabilities.serverBranchSwitch).toBe(false);
    expect(ChatGptPlatform.setActiveLeaf).toBeUndefined();
  });

  it('no platform implements the removed canSwitchToNode hook', () => {
    expect('canSwitchToNode' in ClaudePlatform).toBe(false);
    expect('canSwitchToNode' in ChatGptPlatform).toBe(false);
  });
});
