import { describe, expect, it } from 'vitest';
import { adaptChatGptConversation } from '../platforms/chatgpt/adapter';
import type { ChatGptConversation } from '../platforms/chatgpt/types';

/**
 * Media extraction in the ChatGPT adapter. The adapter is PURE: it emits
 * `files_v2` entries with the file id in `file_uuid` and NO urls (the client
 * resolves download URLs later). These tests assert the normalized media shape,
 * that image-only messages survive, and that a generated-image `role:'tool'`
 * message folds into the assistant turn.
 */

const imgPart = (ptr: string, sizeBytes?: number) => ({
  content_type: 'image_asset_pointer' as const,
  asset_pointer: ptr,
  size_bytes: sizeBytes,
});

describe('chatgpt adapter media extraction', () => {
  it('keeps an image-only user upload (empty text) and dedupes part+attachment', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['a1'],
          message: {
            author: { role: 'user' },
            create_time: 1,
            recipient: 'all',
            content: { content_type: 'multimodal_text', parts: [imgPart('sediment://file_img1', 100), ''] },
            metadata: {
              attachments: [{ id: 'file_img1', name: 'photo.jpg', mime_type: 'image/jpeg', size: 100 }],
            },
          },
        },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: { author: { role: 'assistant' }, create_time: 2, recipient: 'all', content: { content_type: 'text', parts: ['nice'] } },
        },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const u1 = conv.chat_messages.find((m) => m.uuid === 'u1');
    expect(u1).toBeTruthy(); // not dropped despite empty text
    expect(u1!.files_v2).toHaveLength(1); // part + attachment merged by id
    const f = u1!.files_v2![0]!;
    expect(f).toMatchObject({
      file_uuid: 'file_img1',
      file_kind: 'image',
      file_name: 'photo.jpg',
      file_type: 'image/jpeg',
      file_size_bytes: 100,
    });
    expect(f.preview_url).toBeUndefined(); // urls are resolved by the client, not the adapter
  });

  it('emits a non-image file (no file_kind) from a document attachment', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['a1'],
          message: {
            author: { role: 'user' },
            create_time: 1,
            recipient: 'all',
            content: { content_type: 'multimodal_text', parts: ['see attached'] },
            metadata: {
              attachments: [{ id: 'file_doc1', name: 'report.pdf', mime_type: 'application/pdf', size: 2048 }],
            },
          },
        },
        a1: { id: 'a1', parent: 'u1', children: [], message: { author: { role: 'assistant' }, create_time: 2, recipient: 'all', content: { content_type: 'text', parts: ['ok'] } } },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const u1 = conv.chat_messages.find((m) => m.uuid === 'u1')!;
    expect(u1.files_v2).toHaveLength(1);
    expect(u1.files_v2![0]).toMatchObject({ file_uuid: 'file_doc1', file_name: 'report.pdf', file_type: 'application/pdf' });
    expect(u1.files_v2![0]!.file_kind).toBeUndefined(); // non-image → renders as a file row
  });

  it('folds a generated-image (role:tool) message into the assistant turn', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 't1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['a1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['draw a cat'] } } },
        a1: { id: 'a1', parent: 'u1', children: ['t1'], message: { author: { role: 'assistant' }, create_time: 2, recipient: 'all', content: { content_type: 'text', parts: ['here you go'] }, metadata: { model_slug: 'gpt-4o' } } },
        t1: { id: 't1', parent: 'a1', children: [], message: { author: { role: 'tool' }, create_time: 3, recipient: 'all', content: { content_type: 'multimodal_text', parts: [imgPart('sediment://file_gen1')] } } },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const ids = conv.chat_messages.map((m) => m.uuid).sort();
    expect(ids).toEqual(['a1', 'u1']); // t1 folded into a1, not its own turn
    const a1 = conv.chat_messages.find((m) => m.uuid === 'a1')!;
    expect(a1.sender).toBe('assistant');
    expect(a1.content[0]!.text).toBe('here you go');
    expect(a1.files_v2).toHaveLength(1);
    expect(a1.files_v2![0]).toMatchObject({ file_uuid: 'file_gen1', file_kind: 'image' });
    expect(conv.current_leaf_message_uuid).toBe('a1'); // current_node t1 → its turn rep
  });

  it('represents a lone generated-image answer as an assistant turn', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 't1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['t1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['make art'] } } },
        t1: { id: 't1', parent: 'u1', children: [], message: { author: { role: 'tool' }, create_time: 2, recipient: 'all', content: { content_type: 'multimodal_text', parts: [imgPart('sediment://file_gen2')] } } },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const t1 = conv.chat_messages.find((m) => m.uuid === 't1')!;
    expect(t1.sender).toBe('assistant');
    expect(t1.parent_message_uuid).toBe('u1');
    expect(t1.files_v2![0]).toMatchObject({ file_uuid: 'file_gen2', file_kind: 'image' });
  });

  // ChatGPT weaves inline reference tokens into answer text, wrapped in private-use
  // sentinels U+E200 (start) … U+E201 (end) with U+E202 separators. The UI renders
  // them as images/citation chips; raw, they read as garbage. The adapter must strip
  // the token span from the text AND (for image_v2) surface the images as media with
  // their direct cdn urls.
  it('strips inline ref tokens from text and surfaces image_v2 images as media', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['a1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['plan a trip'] } } },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: {
            author: { role: 'assistant' },
            create_time: 2,
            recipient: 'all',
            // leading image token span + a trailing citation span, both PUA-wrapped
            content: { content_type: 'text', parts: ['iturn8image3turn8image6\n\nHere is the planciteturn1search2.'] },
            metadata: {
              content_references: [
                {
                  type: 'image_v2',
                  images: [
                    { url: 'https://getty.example/p', content_url: 'https://images.openai.com/full1', thumbnail_url: 'https://images.openai.com/thumb1', title: 'Everglades' },
                    { url: 'https://bing.example/p', content_url: 'https://images.openai.com/full2', thumbnail_url: 'https://tse1.mm.bing.net/thumb2', title: 'Worth Avenue' },
                  ],
                },
                { type: 'grouped_webpages' },
              ],
            },
          },
        },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const a1 = conv.chat_messages.find((m) => m.uuid === 'a1')!;
    // text is clean prose — no PUA chars, no token garbage
    expect(a1.content[0]!.text).toBe('Here is the plan.');
    expect(/[-]/.test(a1.content[0]!.text ?? '')).toBe(false);
    // both web images surfaced with direct urls already set (no resolution needed)
    expect(a1.files_v2).toHaveLength(2);
    expect(a1.files_v2![0]).toMatchObject({
      file_kind: 'image',
      thumbnail_url: 'https://images.openai.com/thumb1',
      preview_url: 'https://images.openai.com/full1',
      file_name: 'Everglades',
    });
    expect(a1.files_v2![1]).toMatchObject({ file_kind: 'image', thumbnail_url: 'https://tse1.mm.bing.net/thumb2', preview_url: 'https://images.openai.com/full2' });
  });

  // `image_group` is a second inline-image reference type whose entries nest the url
  // fields under `image_result` (vs `image_v2`'s flat entries). Extraction is generic
  // (any reference with an `images[]`, unwrapping `image_result`), so both work.
  it('surfaces image_group images (nested image_result shape)', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['a1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['show me windows'] } } },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: {
            author: { role: 'assistant' },
            create_time: 2,
            recipient: 'all',
            content: { content_type: 'text', parts: ['Here are some examples.'] },
            metadata: {
              content_references: [
                {
                  type: 'image_group',
                  images: [
                    { image_result: { content_url: 'https://images.openai.com/ig-full', thumbnail_url: 'https://images.openai.com/ig-thumb', title: 'Windows in Thick Walls' } },
                  ],
                },
              ],
            },
          },
        },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const a1 = conv.chat_messages.find((m) => m.uuid === 'a1')!;
    expect(a1.content[0]!.text).toBe('Here are some examples.');
    expect(a1.files_v2).toHaveLength(1);
    expect(a1.files_v2![0]).toMatchObject({
      file_kind: 'image',
      thumbnail_url: 'https://images.openai.com/ig-thumb',
      preview_url: 'https://images.openai.com/ig-full',
      file_name: 'Windows in Thick Walls',
    });
  });

  it('keeps a citation-only answer as clean text with no media', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['a1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['q'] } } },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: {
            author: { role: 'assistant' },
            create_time: 2,
            recipient: 'all',
            content: { content_type: 'text', parts: ['The answer is 42citeturn0search0 exactly.'] },
            metadata: { content_references: [{ type: 'grouped_webpages' }] },
          },
        },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    const a1 = conv.chat_messages.find((m) => m.uuid === 'a1')!;
    expect(a1.content[0]!.text).toBe('The answer is 42 exactly.');
    expect(a1.files_v2).toBeUndefined();
  });

  it('does NOT promote ordinary tool messages (no image) to visible turns', () => {
    const raw: ChatGptConversation = {
      conversation_id: 'c',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['tool1'], message: { author: { role: 'user' }, create_time: 1, recipient: 'all', content: { content_type: 'text', parts: ['hi'] } } },
        // a tool message addressed to the user but carrying code (no image) — must stay dropped
        tool1: { id: 'tool1', parent: 'u1', children: ['a1'], message: { author: { role: 'tool' }, create_time: 2, recipient: 'all', content: { content_type: 'code', parts: ['{"x":1}'] } } },
        a1: { id: 'a1', parent: 'tool1', children: [], message: { author: { role: 'assistant' }, create_time: 3, recipient: 'all', content: { content_type: 'text', parts: ['hello'] } } },
      },
    };
    const conv = adaptChatGptConversation(raw, 'c');
    expect(conv.chat_messages.map((m) => m.uuid).sort()).toEqual(['a1', 'u1']);
    expect(conv.chat_messages.find((m) => m.uuid === 'a1')!.parent_message_uuid).toBe('u1');
  });
});
