import { describe, expect, it } from 'vitest';
import { detectKinds } from '../tree/contentKinds';

describe('detectKinds', () => {
  it('detects a python code fence and its language', () => {
    const text = "Here's an example:\n```python\ndef hello():\n    print('hi')\n```\n";
    const kinds = detectKinds(text, []);
    const code = kinds.find((k) => k.kind === 'code');
    expect(code).toBeTruthy();
    if (code && code.kind === 'code') {
      expect(code.language).toBe('python');
      expect(code.blockCount).toBe(1);
    }
  });

  it('flags code as dominant when it takes most of the text', () => {
    const text = '```js\n' + 'console.log("x");\n'.repeat(20) + '```';
    const kinds = detectKinds(text, []);
    const code = kinds.find((k) => k.kind === 'code');
    expect(code && code.kind === 'code' ? code.dominant : false).toBe(true);
  });

  it('detects a markdown list with item count', () => {
    const text = 'Here are three ideas:\n- alpha\n- beta\n- gamma\n';
    const kinds = detectKinds(text, []);
    const list = kinds.find((k) => k.kind === 'list');
    expect(list && list.kind === 'list' ? list.itemCount : 0).toBe(3);
  });

  it('detects a numbered list', () => {
    const text = '1. first\n2. second\n3. third';
    const kinds = detectKinds(text, []);
    expect(kinds.some((k) => k.kind === 'list')).toBe(true);
  });

  it('detects a pipe table', () => {
    const text = '| col | val |\n| --- | --- |\n| a   | 1   |\n| b   | 2   |\n';
    const kinds = detectKinds(text, []);
    expect(kinds.some((k) => k.kind === 'table')).toBe(true);
  });

  it('detects image content blocks', () => {
    const kinds = detectKinds('', [{ type: 'image' }]);
    expect(kinds.some((k) => k.kind === 'image')).toBe(true);
  });

  it('detects attachment content blocks', () => {
    const kinds = detectKinds('', [{ type: 'attachment' }]);
    expect(kinds.some((k) => k.kind === 'attachment')).toBe(true);
  });

  it('detects link-heavy text', () => {
    const text =
      'Refs: [a](https://a.example) [b](https://b.example) and https://c.example';
    const kinds = detectKinds(text, []);
    expect(kinds.some((k) => k.kind === 'links')).toBe(true);
  });

  it('does not count links inside code fences', () => {
    const text = '```\nhttps://a.example\nhttps://b.example\nhttps://c.example\n```';
    const kinds = detectKinds(text, []);
    expect(kinds.some((k) => k.kind === 'links')).toBe(false);
  });

  it('returns an empty array for plain prose', () => {
    expect(detectKinds('Just some text. Nothing special here.', [])).toEqual([]);
  });

  it('captures a code snippet of the first fence body', () => {
    const text = "```python\ndef hello():\n    print('hi')\n    return 1\n```";
    const code = detectKinds(text, []).find((k) => k.kind === 'code');
    expect(code && code.kind === 'code' ? code.snippet : '').toContain('def hello');
    // snippet is capped to a few lines
    if (code && code.kind === 'code') {
      expect(code.snippet.split('\n').length).toBeLessThanOrEqual(3);
    }
  });

  it('captures the first few list items', () => {
    const text = '- alpha\n- beta\n- gamma\n- delta';
    const list = detectKinds(text, []).find((k) => k.kind === 'list');
    if (list && list.kind === 'list') {
      expect(list.itemCount).toBe(4);
      expect(list.items).toEqual(['alpha', 'beta', 'gamma']);
    }
  });

  it('captures table headers and dimensions', () => {
    const text = '| Name | Age |\n| --- | --- |\n| Ana | 30 |\n| Bo | 25 |\n';
    const table = detectKinds(text, []).find((k) => k.kind === 'table');
    if (table && table.kind === 'table') {
      expect(table.headers).toEqual(['Name', 'Age']);
      expect(table.colCount).toBe(2);
      expect(table.rowCount).toBe(2);
    }
  });

  it('builds an image kind from media refs with thumbnails', () => {
    const media = { images: [{ thumbUrl: '/t/1', fullUrl: '/p/1', name: 'a.png' }], files: [] };
    const img = detectKinds('', [], media).find((k) => k.kind === 'image');
    expect(img && img.kind === 'image' ? img.count : 0).toBe(1);
    expect(img && img.kind === 'image' ? img.images[0]?.thumbUrl : '').toBe('/t/1');
  });

  it('builds an attachment kind from media file refs with name/type/size', () => {
    const media = { images: [], files: [{ name: 'report.pdf', type: 'application/pdf', size: 2048 }] };
    const att = detectKinds('', [], media).find((k) => k.kind === 'attachment');
    expect(att && att.kind === 'attachment' ? att.files[0]?.name : '').toBe('report.pdf');
  });

  it('captures link items with text and url', () => {
    const text = 'See [Anthropic](https://anthropic.com) and [Docs](https://docs.example) and https://c.example';
    const links = detectKinds(text, []).find((k) => k.kind === 'links');
    if (links && links.kind === 'links') {
      expect(links.items[0]).toEqual({ text: 'Anthropic', url: 'https://anthropic.com' });
      expect(links.items.some((l) => l.url === 'https://c.example')).toBe(true);
    }
  });
});
