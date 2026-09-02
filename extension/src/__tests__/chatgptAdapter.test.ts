import { describe, expect, it } from 'vitest';
import { adaptChatGptConversation } from '../platforms/chatgpt/adapter';
import type { ChatGptConversation } from '../platforms/chatgpt/types';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree } from '../tree/displayTree';
import { searchNodes } from '../tree/search';

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

// End-to-end: the whole-conversation search runs over the adapted ChatGPT tree,
// proving ChatGPT's data feeds the (platform-agnostic) search — including hidden
// off-path branches and per-occurrence counting — now that capabilities.search is on.
describe('search over an adapted ChatGPT tree', () => {
  const display = buildDisplayTree(buildTree(adaptChatGptConversation(raw, 'conv-1')));

  it('finds a match on a HIDDEN regenerate branch (off the active path)', () => {
    // a1b ("Four") is the off-path regenerate of a1 ("4") — unreachable in the
    // native chat, but search reads the fetched tree so it still surfaces.
    const matches = searchNodes(display.orderedNodes, 'Four');
    expect(matches.length).toBe(1);
    expect(matches[0]!.node.role).toBe('assistant');
    expect(matches[0]!.node.fullText).toContain('Four');
    expect(matches[0]!.node.isOnActivePath).toBe(false);
  });

  it('counts every occurrence in a ChatGPT message body', () => {
    // The question "And 3+3?" contains "3" twice → two per-occurrence matches.
    const matches = searchNodes(display.orderedNodes, '3');
    expect(matches.length).toBe(2);
    expect(matches.every((m) => m.node.fullText.includes('3+3'))).toBe(true);
    expect(matches.map((m) => m.occurrence)).toEqual([0, 1]);
  });

  it('gives ChatGPT nodes non-empty fullText (so counting + highlight work)', () => {
    expect(display.orderedNodes.some((n) => n.fullText.length > 0)).toBe(true);
  });
});

/**
 * A linear chat where the assistant turns are multi-message (commentary preamble +
 * web.run tool calls + final answer) — the shape that previously rendered as a
 * fake N-way branch. It must collapse to ONE assistant node per turn.
 */
const toolTurns: ChatGptConversation = {
  conversation_id: 'conv-2',
  current_node: 'f2',
  mapping: {
    root: { id: 'root', parent: null, children: ['u1'], message: null },
    u1: { id: 'u1', parent: 'root', children: ['c1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['Plan a trip'] } } },
    c1: { id: 'c1', parent: 'u1', children: ['t1'], message: { author: { role: 'assistant' }, create_time: 2, recipient: 'all', content: { content_type: 'text', parts: ["I'll research this."] } } },
    t1: { id: 't1', parent: 'c1', children: ['f1'], message: { author: { role: 'assistant' }, create_time: 3, recipient: 'web.run', content: { content_type: 'code', parts: ['{"search":"flights"}'] } } },
    f1: { id: 'f1', parent: 't1', children: ['u2'], message: { author: { role: 'assistant' }, create_time: 4, recipient: 'all', content: { content_type: 'text', parts: ['Here is the plan.'] } } },
    u2: { id: 'u2', parent: 'f1', children: ['f2'], message: { author: { role: 'user' }, create_time: 5, recipient: 'all', content: { content_type: 'text', parts: ['Refine it'] } } },
    f2: { id: 'f2', parent: 'u2', children: [], message: { author: { role: 'assistant' }, create_time: 6, recipient: 'all', content: { content_type: 'text', parts: ['Refined plan.'] } } },
  },
};

describe('adapter collapses multi-message assistant turns', () => {
  const conv = adaptChatGptConversation(toolTurns, 'conv-2');

  it('drops tool calls and merges commentary+answer into one assistant node', () => {
    const ids = conv.chat_messages.map((m) => m.uuid).sort();
    expect(ids).toEqual(['c1', 'f2', 'u1', 'u2']); // t1 (web.run) dropped; c1 represents the merged turn
    const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
    expect(byId.get('c1')!.content[0]!.text).toContain("I'll research this.");
    expect(byId.get('c1')!.content[0]!.text).toContain('Here is the plan.');
    expect(byId.get('u2')!.parent_message_uuid).toBe('c1'); // user2 follows the merged turn
  });

  it('produces ONE linear thread — no spurious branches', () => {
    const built = buildTree(conv);
    expect(built.roots.map((r) => r.id)).toEqual(['u1']);
    expect(built.activePath).toEqual(['u1', 'c1', 'u2', 'f2']);
    const display = buildDisplayTree(built);
    // Every turn is a single, unbranched pair (siblingCount 1).
    expect(display.orderedNodes.every((n) => n.siblingCount === 1)).toBe(true);
  });
});

/** A turn whose answer embeds ChatGPT's compose surface as a `:::writing` fence. */
const writingFence: ChatGptConversation = {
  conversation_id: 'conv-3',
  current_node: 'a1',
  mapping: {
    root: { id: 'root', parent: null, children: ['u1'], message: null },
    u1: { id: 'u1', parent: 'root', children: ['a1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['Write me a follow-up email'] } } },
    a1: {
      id: 'a1',
      parent: 'u1',
      children: [],
      message: {
        author: { role: 'assistant' },
        create_time: 2,
        recipient: 'all',
        content: {
          content_type: 'text',
          parts: [
            'Here’s a warm, concise version:\n\n:::writing{variant="email" id="48217" subject="Following up on PM application"}\nHi [Name],\n\nHope you’re doing well!\n\nBest,\n[Your Name]\n:::\n\nIf you want, I can make it more casual.',
          ],
        },
      },
    },
  },
};

describe('adapter rewrites `:::writing` compose fences into message_compose_v1 blocks', () => {
  const conv = adaptChatGptConversation(writingFence, 'conv-3');
  const a1 = conv.chat_messages.find((m) => m.uuid === 'a1')!;

  it('splits the text around the fence and emits a synthetic compose block', () => {
    expect(a1.content.map((c) => c.type)).toEqual(['text', 'tool_use', 'text']);
    const compose = a1.content[1]!;
    expect(compose.name).toBe('message_compose_v1');
    expect(compose.input?.kind).toBe('email');
    const variants = compose.input?.variants as Array<{ subject?: string; body: string }>;
    expect(variants[0]!.subject).toBe('Following up on PM application');
    expect(variants[0]!.body).toContain('Hi [Name],');
    expect(variants[0]!.body).not.toContain(':::');
  });

  it('renders through buildTree as readable markdown with an email kind', () => {
    const node = buildTree(conv).byId.get('a1')!;
    expect(node.fullText).not.toContain(':::writing');
    expect(node.fullText).toContain('**Email**');
    expect(node.fullText).toContain('Subject: Following up on PM application');
    expect(node.fullText.indexOf('Hi [Name],')).toBeLessThan(node.fullText.indexOf('more casual'));
    expect(node.preview.kinds.some((k) => k.kind === 'email')).toBe(true);
    // The email body is searchable.
    const display = buildDisplayTree(buildTree(conv));
    expect(searchNodes(display.orderedNodes, 'hope you').length).toBe(1);
  });
});

/**
 * A voice conversation (modeled on a real one: "签证问题咨询"): voice turns store
 * the transcript as an `audio_transcription` OBJECT part under `multimodal_text`
 * — no string parts at all — while typed turns in the same chat use plain string
 * parts. Regression: the adapter used to keep only string parts, so every voice
 * node came out empty and the whole conversation vanished from the graph.
 */
const voiceChat: ChatGptConversation = {
  conversation_id: 'conv-4',
  title: '签证问题咨询',
  current_node: 'a2',
  mapping: {
    root: { id: 'root', parent: null, children: ['u1'], message: null },
    u1: {
      id: 'u1',
      parent: 'root',
      children: ['thoughts1'],
      message: {
        author: { role: 'user' },
        create_time: 1,
        content: {
          content_type: 'multimodal_text',
          parts: [{ content_type: 'audio_transcription', text: '我想问一下签证的问题', direction: 'in' }],
        },
        metadata: {},
      },
    },
    // Reasoning node between the turns, as in the real conversation.
    thoughts1: {
      id: 'thoughts1',
      parent: 'u1',
      children: ['a1'],
      message: {
        author: { role: 'assistant' },
        create_time: 2,
        content: { content_type: 'thoughts' },
        metadata: { is_visually_hidden_from_conversation: true },
      },
    },
    a1: {
      id: 'a1',
      parent: 'thoughts1',
      children: ['u2'],
      message: {
        author: { role: 'assistant' },
        create_time: 3,
        content: {
          content_type: 'multimodal_text',
          parts: [{ content_type: 'audio_transcription', text: '当然可以，你想了解哪一类签证?', direction: 'out' }],
        },
        metadata: { model_slug: 'gpt-4o' },
      },
    },
    // A TYPED follow-up in the same chat (string part) — must keep working.
    u2: {
      id: 'u2',
      parent: 'a1',
      children: ['a2'],
      message: {
        author: { role: 'user' },
        create_time: 4,
        content: { content_type: 'text', parts: ['H1B转H4需要多久?'] },
      },
    },
    a2: {
      id: 'a2',
      parent: 'u2',
      children: [],
      message: {
        author: { role: 'assistant' },
        create_time: 5,
        content: { content_type: 'text', parts: ['通常几周到几个月不等。'] },
        metadata: { model_slug: 'gpt-4o' },
      },
    },
  },
};

describe('adapter reads voice-mode audio_transcription parts', () => {
  const conv = adaptChatGptConversation(voiceChat, 'conv-4');

  it('keeps every voice turn, with the transcript as the node text', () => {
    const ids = conv.chat_messages.map((m) => m.uuid).sort();
    expect(ids).toEqual(['a1', 'a2', 'u1', 'u2']);
    const textOf = (id: string) =>
      conv.chat_messages.find((m) => m.uuid === id)!.content.map((c) => c.text).join('');
    expect(textOf('u1')).toBe('我想问一下签证的问题');
    expect(textOf('a1')).toBe('当然可以，你想了解哪一类签证?');
    // Typed turns in the same chat are untouched.
    expect(textOf('u2')).toBe('H1B转H4需要多久?');
    expect(textOf('a2')).toBe('通常几周到几个月不等。');
  });

  it('builds a full display tree (nothing filtered), searchable by transcript', () => {
    const display = buildDisplayTree(buildTree(conv));
    expect(display.orderedNodes.length).toBe(4);
    expect(searchNodes(display.orderedNodes, '签证').length).toBeGreaterThan(0);
  });
});
