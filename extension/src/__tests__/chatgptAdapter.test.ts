import { describe, expect, it } from 'vitest';
import { adaptChatGptConversation } from '../platforms/chatgpt/adapter';
import type { ChatGptConversation } from '../platforms/chatgpt/types';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree } from '../tree/displayTree';

/**
 * A ChatGPT tree with the wrapper nodes the adapter must strip (synthetic root,
 * hidden system) plus a regenerate branch (u1 → two assistant children).
 */
const raw: ChatGptConversation = {
  conversation_id: 'conv-1',
  title: 'Math',
  current_node: 'a2',
  mapping: {
    root: { id: 'root', parent: null, children: ['sys'], message: null },
    sys: {
      id: 'sys',
      parent: 'root',
      children: ['u1'],
      message: {
        author: { role: 'system' },
        content: { content_type: 'text', parts: [''] },
        metadata: { is_visually_hidden_from_conversation: true },
      },
    },
    u1: {
      id: 'u1',
      parent: 'sys',
      children: ['a1', 'a1b'],
      message: { author: { role: 'user' }, create_time: 1, content: { content_type: 'text', parts: ['What is 2+2?'] } },
    },
    a1: {
      id: 'a1',
      parent: 'u1',
      children: ['u2'],
      message: {
        author: { role: 'assistant' },
        create_time: 2,
        content: { content_type: 'text', parts: ['4'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    },
    a1b: {
      id: 'a1b',
      parent: 'u1',
      children: [],
      message: {
        author: { role: 'assistant' },
        create_time: 3,
        content: { content_type: 'text', parts: ['Four'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    },
    u2: {
      id: 'u2',
      parent: 'a1',
      children: ['a2'],
      message: { author: { role: 'user' }, create_time: 4, content: { content_type: 'text', parts: ['And 3+3?'] } },
    },
    a2: {
      id: 'a2',
      parent: 'u2',
      children: [],
      message: {
        author: { role: 'assistant' },
        create_time: 5,
        content: { content_type: 'text', parts: ['6'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    },
  },
};

describe('adaptChatGptConversation', () => {
  const conv = adaptChatGptConversation(raw, 'conv-1');

  it('drops the synthetic root + hidden system node', () => {
    const ids = conv.chat_messages.map((m) => m.uuid).sort();
    expect(ids).toEqual(['a1', 'a1b', 'a2', 'u1', 'u2']);
  });

  it('re-parents to enforce strict human/assistant alternation', () => {
    const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
    expect(byId.get('u1')!.parent_message_uuid).toBeNull(); // first user is a root
    expect(byId.get('a1')!.parent_message_uuid).toBe('u1');
    expect(byId.get('a1b')!.parent_message_uuid).toBe('u1');
    expect(byId.get('u2')!.parent_message_uuid).toBe('a1');
    expect(byId.get('u1')!.sender).toBe('human');
    expect(byId.get('a1')!.sender).toBe('assistant');
  });

  it('resolves current_node and folds the model up', () => {
    expect(conv.current_leaf_message_uuid).toBe('a2');
    expect(conv.model).toBe('gpt-4o');
  });

  it('feeds buildTree → displayTree: one root, a regenerate branch, correct active path', () => {
    const built = buildTree(conv);
    expect(built.roots.map((r) => r.id)).toEqual(['u1']);
    expect(built.activePath).toEqual(['u1', 'a1', 'u2', 'a2']);

    const display = buildDisplayTree(built);
    // u1 has two assistant children → a regenerate turn (siblingCount 2).
    const u1Questions = display.orderedNodes.filter((n) => n.role === 'human' && n.humanId === 'u1');
    expect(u1Questions.length).toBe(2);
    expect(u1Questions.every((n) => n.siblingCount === 2 && n.branchKind === 'regenerate')).toBe(true);
    // The active path threads the q+a of the active turns.
    expect(display.activePath.length).toBeGreaterThan(0);
  });
});
