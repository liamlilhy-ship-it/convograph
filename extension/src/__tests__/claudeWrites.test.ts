import { describe, expect, it } from 'vitest';
import { classifyCreate, ROOT_PARENT_UUID } from '../platforms/claude/writes';
import type { NormalizedConversation } from '../platforms/model';

// root → u1 → a1 → { u2 → a2,  u2b → a2b }
const conv = {
  current_leaf_message_uuid: 'a2',
  chat_messages: [
    ['u1', ROOT_PARENT_UUID, 'human'],
    ['a1', 'u1', 'assistant'],
    ['u2', 'a1', 'human'],
    ['a2', 'u2', 'assistant'],
    ['u2b', 'a1', 'human'],
    ['a2b', 'u2b', 'assistant'],
  ].map(([uuid, parent_message_uuid, sender]) => ({ uuid, parent_message_uuid, sender })),
} as unknown as NormalizedConversation;

describe('classifyCreate (Claude)', () => {
  it('a parent with no question under it is a follow-up', () => {
    expect(classifyCreate(conv, 'a2', 'a2')).toEqual({ kind: 'followup', answerId: 'a2' });
  });

  it('edits the question on the shown branch', () => {
    expect(classifyCreate(conv, 'a1', 'a2')).toEqual({ kind: 'edit', userId: 'u2' });
    expect(classifyCreate(conv, 'a1', 'a2b')).toEqual({ kind: 'edit', userId: 'u2b' });
  });

  it('edits the first message via the root sentinel', () => {
    expect(classifyCreate(conv, ROOT_PARENT_UUID, 'a2')).toEqual({ kind: 'edit', userId: 'u1' });
  });

  it('returns null when the questions are all off the shown branch', () => {
    expect(classifyCreate(conv, 'a1', 'u1')).toBeNull();
    expect(classifyCreate(conv, 'a1', null)).toBeNull();
  });
});
