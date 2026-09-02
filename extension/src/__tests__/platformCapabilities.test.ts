import { describe, expect, it } from 'vitest';
import { ClaudePlatform } from '../platforms/claude/platform';
import { ChatGptPlatform } from '../platforms/chatgpt/platform';

// Pins the capability contract each platform declares, so a change meant for one
// platform can't silently alter the other's behavior (the app gates every
// branch-switch / write path on these flags).
describe('platform capabilities', () => {
  it('Claude keeps server-side branch switching (unchanged contract)', () => {
    expect(ClaudePlatform.capabilities).toEqual({
      serverBranchSwitch: true,
      serverPersistsActiveBranch: true,
      edit: true,
      followup: true,
      regenerate: true,
      search: true,
    });
    expect(typeof ClaudePlatform.setActiveLeaf).toBe('function');
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
