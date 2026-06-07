import { describe, expect, it } from 'vitest';
import { rawActiveUserIds } from '../platforms/chatgpt/promptRail';
import type { ChatGptConversation } from '../platforms/chatgpt/types';

// rawActiveUserIds must match ChatGPT's prompt RAIL exactly (one dash per raw user
// message on the branch), so the reveal clicks the right dash. It reads the RAW
// mapping — the normalized tree can merge turns and drift out of sync.
const node = (id: string, parent: string | null, role: string, recipient = 'all', hidden = false) => ({
  id,
  parent,
  message: { author: { role }, recipient, metadata: { is_visually_hidden_from_conversation: hidden } },
});

describe('rawActiveUserIds', () => {
  it('lists user prompts oldest→newest along the branch, skipping hidden/system', () => {
    const raw = {
      mapping: {
        root: { id: 'root', parent: null, message: null },
        sys: node('sys', 'root', 'system', 'all', true),
        u1: node('u1', 'sys', 'user'),
        a1: node('a1', 'u1', 'assistant'),
        u2: node('u2', 'a1', 'user'),
        a2: node('a2', 'u2', 'assistant'),
      },
    } as unknown as ChatGptConversation;
    expect(rawActiveUserIds(raw, 'a2')).toEqual(['u1', 'u2']);
  });

  it('counts EVERY raw user message — incl. consecutive ones the adapter merges', () => {
    // Two user messages with no assistant between → the adapter collapses them to
    // one turn, but the rail shows TWO dashes. Using raw keeps the index aligned.
    const raw = {
      mapping: {
        u1: node('u1', null, 'user'),
        u1b: node('u1b', 'u1', 'user'),
        a1: node('a1', 'u1b', 'assistant'),
      },
    } as unknown as ChatGptConversation;
    expect(rawActiveUserIds(raw, 'a1')).toEqual(['u1', 'u1b']);
  });

  it('ignores tool/assistant messages and non-user recipients', () => {
    const raw = {
      mapping: {
        u1: node('u1', null, 'user'),
        t1: node('t1', 'u1', 'tool', 'web.run'),
        a1: node('a1', 't1', 'assistant'),
      },
    } as unknown as ChatGptConversation;
    expect(rawActiveUserIds(raw, 'a1')).toEqual(['u1']);
  });
});
