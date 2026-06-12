import { describe, expect, it } from 'vitest';
import { buildTree } from '../tree/buildTree';
import linear from './fixtures/linear.json';
import singleEdit from './fixtures/single-edit.json';
import type { ApiConversation } from '../platforms/model';

describe('buildTree', () => {
  it('handles a linear conversation', () => {
    const t = buildTree(linear as ApiConversation);
    expect(t.roots.map((r) => r.id)).toEqual(['m1']);
    expect(t.activePath).toEqual(['m1', 'm2', 'm3']);
    expect(t.byId.get('m1')!.childIds).toEqual(['m2']);
    expect(t.byId.get('m2')!.childIds).toEqual(['m3']);
    expect(t.byId.get('m3')!.isOnActivePath).toBe(true);
    expect(t.byId.get('m3')!.siblingCount).toBe(1);
  });

  it('handles an edit branch with two siblings on the active path going to the second', () => {
    const t = buildTree(singleEdit as ApiConversation);
    expect(t.activePath).toEqual(['m1', 'm2', 'm3b', 'm4b']);
    expect(t.byId.get('m2')!.childIds).toEqual(['m3a', 'm3b']);
    expect(t.byId.get('m3a')!.siblingCount).toBe(2);
    expect(t.byId.get('m3a')!.siblingIndex).toBe(0);
    expect(t.byId.get('m3b')!.siblingIndex).toBe(1);
    expect(t.byId.get('m3a')!.isOnActivePath).toBe(false);
    expect(t.byId.get('m3b')!.isOnActivePath).toBe(true);
  });

  it('produces a snippet that collapses whitespace and respects length', () => {
    const t = buildTree(singleEdit as ApiConversation);
    expect(t.byId.get('m1')!.snippet).toBe('Pick a color');
    expect(t.byId.get('m1')!.snippet.length).toBeLessThanOrEqual(120);
  });

  it('assigns depths from root', () => {
    const t = buildTree(singleEdit as ApiConversation);
    expect(t.byId.get('m1')!.depth).toBe(0);
    expect(t.byId.get('m2')!.depth).toBe(1);
    expect(t.byId.get('m3a')!.depth).toBe(2);
    expect(t.byId.get('m4b')!.depth).toBe(3);
  });

  it('merges media from files_v2, legacy files, and attachments without dupes', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'h1',
      chat_messages: [
        {
          uuid: 'h1',
          parent_message_uuid: null,
          sender: 'human',
          created_at: '2026-05-27T10:00:00Z',
          content: [{ type: 'text', text: 'See attached' }],
          files_v2: [
            { file_kind: 'image', file_uuid: 'img1', file_name: 'a.png', thumbnail_url: '/api/t/1', preview_url: '/api/p/1' },
            { file_kind: 'document', file_uuid: 'doc1', file_name: 'report.pdf', file_size_bytes: 2048 },
          ],
          // legacy `files` repeats the same image (must dedupe by uuid)
          files: [
            { file_kind: 'image', file_uuid: 'img1', file_name: 'a.png', thumbnail_url: '/api/t/1' },
          ],
          attachments: [{ file_uuid: 'att1', file_name: 'notes.txt', file_type: 'text/plain', file_size: 100 }],
        },
      ],
    };
    const kinds = buildTree(conv).byId.get('h1')!.preview.kinds;
    const img = kinds.find((k) => k.kind === 'image');
    const att = kinds.find((k) => k.kind === 'attachment');
    expect(img && img.kind === 'image' ? img.images.length : 0).toBe(1); // deduped
    expect(img && img.kind === 'image' ? img.images[0]?.thumbUrl : '').toBe('/api/t/1');
    expect(att && att.kind === 'attachment' ? att.files.map((f) => f.name).sort() : []).toEqual(
      ['notes.txt', 'report.pdf'],
    );
  });

  it('carries an attachment\'s extracted_content onto the FileRef (for previewing)', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'h1',
      chat_messages: [
        {
          uuid: 'h1',
          parent_message_uuid: null,
          sender: 'human',
          created_at: '2026-06-04T10:00:00Z',
          content: [{ type: 'text', text: 'see file' }],
          attachments: [
            { id: 'a1', file_name: 'excerpt.txt', file_type: 'text/plain', file_size: 273, extracted_content: 'The quick brown fox.' },
            { id: 'a2', file_name: 'empty.txt' }, // no extracted_content → content stays undefined
          ],
        },
      ],
    };
    const att = buildTree(conv).byId.get('h1')!.preview.kinds.find((k) => k.kind === 'attachment');
    if (att && att.kind === 'attachment') {
      const withText = att.files.find((f) => f.name === 'excerpt.txt');
      const without = att.files.find((f) => f.name === 'empty.txt');
      expect(withText?.content).toBe('The quick brown fox.');
      expect(without?.content).toBeUndefined();
    }
  });

  it('parses the `artifacts` tool into a clickable artifact (latest version wins, content inline)', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a1',
      chat_messages: [
        {
          uuid: 'a1',
          parent_message_uuid: null,
          sender: 'assistant',
          created_at: '2026-06-04T10:00:00Z',
          content: [
            { type: 'text', text: 'Your report is ready.' },
            {
              type: 'tool_use',
              name: 'artifacts',
              input: { command: 'create', id: 'art-1', title: 'Research Report', type: 'text/markdown', content: '# Draft' },
            },
            // a rewrite re-emits the same id → must supersede the create
            {
              type: 'tool_use',
              name: 'artifacts',
              input: { command: 'rewrite', id: 'art-1', title: 'Research Report', type: 'text/markdown', content: '# Final\n\nbody' },
            },
          ],
        },
      ],
    };
    const kinds = buildTree(conv).byId.get('a1')!.preview.kinds;
    const art = kinds.find((k) => k.kind === 'artifact');
    expect(art && art.kind === 'artifact' ? art.items.length : 0).toBe(1); // deduped by id
    if (art && art.kind === 'artifact') {
      expect(art.items[0]?.name).toBe('Research Report');
      expect(art.items[0]?.type).toBe('markdown');
      expect(art.items[0]?.id).toBe('art-1');
      expect(art.items[0]?.content).toBe('# Final\n\nbody'); // latest version
    }
  });

  it('ignores an `artifacts` tool call with no inline content', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a1',
      chat_messages: [
        {
          uuid: 'a1',
          parent_message_uuid: null,
          sender: 'assistant',
          created_at: '2026-06-04T10:00:00Z',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', name: 'artifacts', input: { command: 'update', id: 'art-1' } },
          ],
        },
      ],
    };
    const kinds = buildTree(conv).byId.get('a1')!.preview.kinds;
    expect(kinds.some((k) => k.kind === 'artifact')).toBe(false);
  });

  it('rebases text-block citations onto the coalesced md block and numbers them answer-wide', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a1',
      chat_messages: [
        {
          uuid: 'a1',
          parent_message_uuid: null,
          sender: 'assistant',
          created_at: '2026-06-08T10:00:00Z',
          content: [
            // "Alpha beta." (len 11), cited at its end → url a
            {
              type: 'text',
              text: 'Alpha beta.',
              citations: [
                { url: 'https://a.example/x', end_index: 11, metadata: { site_name: 'A Site' } },
              ],
            },
            // a non-widget tool_use does NOT flush, so the two text blocks coalesce
            { type: 'tool_use', name: 'web_search', input: { query: 'x' } },
            // "Gamma delta." (len 12), cited at its end → url b (no title/site → host)
            {
              type: 'text',
              text: 'Gamma delta.',
              citations: [{ url: 'https://b.example/y', end_index: 12 }],
            },
          ],
        },
      ],
    };
    const body = buildTree(conv).byId.get('a1')!.body;
    expect(body).toHaveLength(1);
    const md = body[0]!;
    expect(md.kind).toBe('md');
    if (md.kind !== 'md') return;
    expect(md.text).toBe('Alpha beta.\nGamma delta.'); // 11 + 1 + 12 = 24
    expect(md.citations).toBeDefined();
    expect(md.citations).toHaveLength(2);
    // first block citation: end == 11 (end of "Alpha beta."), number 1, titled by site_name
    expect(md.citations![0]).toMatchObject({ end: 11, ref: { n: 1, url: 'https://a.example/x', title: 'A Site' } });
    // second block citation: rebased to base(12) + 12 = 24, number 2, title falls back to host
    expect(md.citations![1]).toMatchObject({ end: 24, ref: { n: 2, url: 'https://b.example/y', title: 'b.example' } });
  });

  it('reuses one footnote number for repeated urls and omits citations when there are none', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'a2',
      chat_messages: [
        {
          uuid: 'a2',
          parent_message_uuid: null,
          sender: 'assistant',
          created_at: '2026-06-08T10:00:00Z',
          content: [
            {
              type: 'text',
              text: 'See one. See two.',
              citations: [
                { url: 'https://same.example/p', end_index: 8 }, // after "See one."
                { url: 'https://same.example/p', end_index: 17 }, // after "See two." → same url
              ],
            },
          ],
        },
        {
          uuid: 'a3',
          parent_message_uuid: 'a2',
          sender: 'assistant',
          created_at: '2026-06-08T10:01:00Z',
          content: [{ type: 'text', text: 'No sources here.' }],
        },
      ],
    };
    const t = buildTree(conv);
    const cited = t.byId.get('a2')!.body[0]!;
    expect(cited.kind === 'md' && cited.citations?.map((b) => b.ref.n)).toEqual([1, 1]);
    const plain = t.byId.get('a3')!.body[0]!;
    expect(plain.kind === 'md' && plain.citations).toBeUndefined();
  });

  it('reads claude.ai legacy `files` shape (uuid key, file_kind image/blob, size_bytes)', () => {
    const conv: ApiConversation = {
      uuid: 'c',
      current_leaf_message_uuid: 'h1',
      chat_messages: [
        {
          uuid: 'h1',
          parent_message_uuid: null,
          sender: 'human',
          created_at: '2026-05-27T10:00:00Z',
          content: [{ type: 'text', text: 'see files' }],
          files: [
            { file_kind: 'image', uuid: 'i1', file_name: 'pg-1.jpg', thumbnail_url: '/api/x/thumbnail', preview_url: '/api/x/preview' },
            { file_kind: 'blob', uuid: 'b1', file_name: 'Dev doc.md', size_bytes: 4096 },
          ],
        },
      ],
    };
    const kinds = buildTree(conv).byId.get('h1')!.preview.kinds;
    const img = kinds.find((k) => k.kind === 'image');
    const att = kinds.find((k) => k.kind === 'attachment');
    expect(img && img.kind === 'image' ? img.images[0]?.thumbUrl : '').toBe('/api/x/thumbnail');
    // blob doc is shown as a file, type derived from extension (not "blob")
    if (att && att.kind === 'attachment') {
      expect(att.files[0]?.name).toBe('Dev doc.md');
      expect(att.files[0]?.type).toBe('md');
      expect(att.files[0]?.size).toBe(4096);
    }
  });
});
