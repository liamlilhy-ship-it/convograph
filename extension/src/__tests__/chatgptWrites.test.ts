import { describe, expect, it } from 'vitest';
import { classifyCreate } from '../platforms/chatgpt/writes';
import type { NormalizedConversation, NormalizedMessage } from '../platforms/model';

/**
 * Pure tests for `classifyCreate` — the edit-vs-follow-up disambiguation the
 * ChatGPT write methods rely on. The DOM driving in writes.ts (clicking the native
 * Edit / Switch-model controls, the composer) is verified live in the browser, not
 * here.
 */

const msg = (
  uuid: string,
  parent: string | null,
  sender: 'human' | 'assistant',
  t: number,
): NormalizedMessage => ({
  uuid,
  parent_message_uuid: parent,
  sender,
  content: [{ type: 'text', text: uuid }],
  created_at: new Date(t * 1000).toISOString(),
});

// u1 → a1 → u2 → a2 (active leaf a2).
const linear: NormalizedConversation = {
  uuid: 'c',
  current_leaf_message_uuid: 'a2',
  chat_messages: [
    msg('u1', null, 'human', 1),
    msg('a1', 'u1', 'assistant', 2),
    msg('u2', 'a1', 'human', 3),
    msg('a2', 'u2', 'assistant', 4),
  ],
};

describe('classifyCreate', () => {
  it('routes the rootParentUuid sentinel to editing the first user message', () => {
    expect(classifyCreate(linear, '')).toEqual({ kind: 'edit', userId: 'u1' });
  });

  it('treats an answer that already has a question child as an edit of that child', () => {
    // parent a1 has the human child u2 → editing u2 (branches a sibling).
    expect(classifyCreate(linear, 'a1')).toEqual({ kind: 'edit', userId: 'u2' });
  });

  it('treats a leaf answer (no question child) as a follow-up', () => {
    expect(classifyCreate(linear, 'a2')).toEqual({ kind: 'followup', answerId: 'a2' });
  });

  it('picks the question child on the active path when the answer is branched', () => {
    // a1 has two question children: u2 (active, leads to leaf a2) and u2b (inactive).
    const branched: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a2',
      chat_messages: [
        msg('u1', null, 'human', 1),
        msg('a1', 'u1', 'assistant', 2),
        msg('u2', 'a1', 'human', 3),
        msg('a2', 'u2', 'assistant', 4),
        msg('u2b', 'a1', 'human', 5), // newer sibling question, off the active path
        msg('a2b', 'u2b', 'assistant', 6),
      ],
    };
    expect(classifyCreate(branched, 'a1')).toEqual({ kind: 'edit', userId: 'u2' });
  });

  it('falls back to the first question child when none is on the active path', () => {
    // Active leaf is a1 itself; a1's question children are both off the active path.
    const conv: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a1',
      chat_messages: [
        msg('u1', null, 'human', 1),
        msg('a1', 'u1', 'assistant', 2),
        msg('u2', 'a1', 'human', 3),
        msg('u2b', 'a1', 'human', 4),
      ],
    };
    expect(classifyCreate(conv, 'a1')).toEqual({ kind: 'edit', userId: 'u2' });
  });
});
