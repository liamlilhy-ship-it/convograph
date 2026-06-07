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
