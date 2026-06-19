import { describe, expect, it } from 'vitest';
import { activeChildOf, branchPlan, isReversiblySwitchable } from '../platforms/chatgpt/branchSwitch';
import type { NormalizedConversation, NormalizedMessage } from '../platforms/model';

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

/** An image-only assistant answer (no text) — like a DALL·E generation. */
const imgMsg = (uuid: string, parent: string | null, t: number): NormalizedMessage => ({
  uuid,
  parent_message_uuid: parent,
  sender: 'assistant',
  content: [{ type: 'text', text: '' }],
  created_at: new Date(t * 1000).toISOString(),
  files_v2: [{ file_kind: 'image', file_uuid: 'f', preview_url: 'u' }],
});

// u1 → (a1 | a1b regenerate sibling) ; the active branch a1 → u2 → a2.
const conv: NormalizedConversation = {
  uuid: 'c',
  current_leaf_message_uuid: 'a2',
  chat_messages: [
    msg('u1', null, 'human', 1),
    msg('a1', 'u1', 'assistant', 2),
    msg('a1b', 'u1', 'assistant', 3), // newer regenerate sibling
    msg('u2', 'a1', 'human', 4),
    msg('a2', 'u2', 'assistant', 5),
  ],
};

describe('branchPlan (normalized-tree branch points)', () => {
  it('plans the single selection needed to reach a regenerate sibling', () => {
    expect(branchPlan(conv, 'a1b')).toEqual([{ parent: 'u1', siblingCount: 2, targetIdx: 1 }]);
  });

  it('orders siblings oldest-first (the older answer is targetIdx 0)', () => {
    expect(branchPlan(conv, 'a2')).toEqual([{ parent: 'u1', siblingCount: 2, targetIdx: 0 }]);
  });

  it('returns no steps for a linear path', () => {
    const lin: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a',
      chat_messages: [msg('u', null, 'human', 1), msg('a', 'u', 'assistant', 2)],
    };
    expect(branchPlan(lin, 'a')).toEqual([]);
  });

  it('ignores nodes that are not on the path (no spurious branch)', () => {
    // x is a separate branch off u1; targeting a2 must not include it.
    const c2: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a2',
      chat_messages: [...conv.chat_messages, msg('x', 'u1', 'assistant', 6)],
    };
    // u1 now has 3 children; reaching a2 selects a1 (oldest = idx 0) of 3.
    expect(branchPlan(c2, 'a2')).toEqual([{ parent: 'u1', siblingCount: 3, targetIdx: 0 }]);
  });

  // Editing the FIRST message makes every version a parent-less root. ChatGPT
  // still renders a `< n/m >` control on the first bubble, so a root-level branch
  // must produce a step (the bug: it was skipped, so click-to-jump silently
  // no-oped on these chats).
  const rootBranch: NormalizedConversation = {
    uuid: 'c',
    current_leaf_message_uuid: 'a_r2',
    chat_messages: [
      msg('r1', null, 'human', 1), // original first message
      msg('a_r1', 'r1', 'assistant', 2),
      msg('r2', null, 'human', 3), // newer edit of the first message (active)
      msg('a_r2', 'r2', 'assistant', 4),
    ],
  };

  it('plans a root-level branch (edited first message) reaching the newer root', () => {
    const steps = branchPlan(rootBranch, 'a_r2');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ siblingCount: 2, targetIdx: 1 });
  });

  it('plans a root-level branch reaching the older root (oldest-first ordering)', () => {
    const steps = branchPlan(rootBranch, 'a_r1');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ siblingCount: 2, targetIdx: 0 });
  });
});

describe('isReversiblySwitchable (block one-way image-regenerate branches)', () => {
  // user u → [a_text (text answer), a_img (image-only answer)].
  const conv: NormalizedConversation = {
    uuid: 'c',
    current_leaf_message_uuid: 'a_text',
    chat_messages: [msg('u', null, 'human', 1), msg('a_text', 'u', 'assistant', 2), imgMsg('a_img', 'u', 3)],
  };

  it('blocks switching to an image-only regenerate sibling (no version arrows to return)', () => {
    expect(isReversiblySwitchable(conv, 'a_img')).toBe(false);
  });

  it('allows switching to a text regenerate sibling', () => {
    expect(isReversiblySwitchable(conv, 'a_text')).toBe(true);
  });

  it('allows a linear path (no branch point)', () => {
    const lin: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a',
      chat_messages: [msg('u', null, 'human', 1), msg('a', 'u', 'assistant', 2)],
    };
    expect(isReversiblySwitchable(lin, 'a')).toBe(true);
  });
});

describe('activeChildOf (the bubble carrying a branch point control)', () => {
  const byId = (c: NormalizedConversation) => new Map(c.chat_messages.map((m) => [m.uuid, m]));

  it('returns the edited-question child shown at an assistant branch point', () => {
    // assistant `a` → [edited questions q1, q2]; active branch q1 → ans1.
    const c: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'ans1',
      chat_messages: [
        msg('u', null, 'human', 1),
        msg('a', 'u', 'assistant', 2),
        msg('q1', 'a', 'human', 3),
        msg('q2', 'a', 'human', 4),
        msg('ans1', 'q1', 'assistant', 5),
      ],
    };
    // The control sits on q1 (the shown edited question), NOT on the assistant `a`.
    expect(activeChildOf(byId(c), 'ans1', 'a')).toBe('q1');
  });

  it('returns the shown answer at a regenerate (user-parent) branch point', () => {
    // user `u1` → [a1, a1b]; active branch a1 → u2 → a2.
    expect(activeChildOf(byId(conv), 'a2', 'u1')).toBe('a1');
  });

  it('returns the active root turn for a ROOT (edited-first-message) branch', () => {
    // r1/r2 are both parent-less roots; active leaf is under r2.
    const c: NormalizedConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'ar2',
      chat_messages: [
        msg('r1', null, 'human', 1),
        msg('ar1', 'r1', 'assistant', 2),
        msg('r2', null, 'human', 3),
        msg('ar2', 'r2', 'assistant', 4),
      ],
    };
    expect(activeChildOf(byId(c), 'ar2', ' root')).toBe('r2');
  });

  it('returns null when the parent is not on the leaf path', () => {
    expect(activeChildOf(byId(conv), 'a2', 'nonexistent')).toBeNull();
  });
});
