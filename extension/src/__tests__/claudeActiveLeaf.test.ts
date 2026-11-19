import { describe, expect, it } from 'vitest';
import { activeLeafFromRendered } from '../platforms/claude/activeLeaf';
import type { NormalizedConversation } from '../platforms/model';

// u1 → a1 → { u2 → a2 → u3 → a3 (server leaf),  u2b → a2b }
const conv = (leaf: string) =>
  ({
    current_leaf_message_uuid: leaf,
    chat_messages: [
      ['u1', null],
      ['a1', 'u1'],
      ['u2', 'a1'],
      ['a2', 'u2'],
      ['u3', 'a2'],
      ['a3', 'u3'],
      ['u2b', 'a1'],
      ['a2b', 'u2b'],
    ].map(([uuid, parent_message_uuid]) => ({ uuid, parent_message_uuid })),
  }) as unknown as NormalizedConversation;

describe('activeLeafFromRendered (Claude)', () => {
  it('keeps the server leaf when every rendered turn is on its branch', () => {
    expect(activeLeafFromRendered(conv('a3'), ['u2', 'u2', 'u3', 'u3'])).toBe('a3');
  });

  it('follows the chat when it shows another branch, extending past the window', () => {
    expect(activeLeafFromRendered(conv('a3'), ['u1', 'u2b'])).toBe('a2b');
    expect(activeLeafFromRendered(conv('a2b'), ['u1', 'u2'])).toBe('a3');
  });

  it('ignores keys that are not messages, and returns null with nothing rendered', () => {
    expect(activeLeafFromRendered(conv('a3'), ['x', 'u2b', 'y'])).toBe('a2b');
    expect(activeLeafFromRendered(conv('a3'), ['x'])).toBeNull();
  });
});
