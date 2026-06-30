import { describe, expect, it } from 'vitest';
import { searchNodes, nodeSearchText } from '../tree/search';
import type { DisplayNode } from '../tree/displayTree';
import type { ContentKind } from '../tree/contentKinds';
import { ClaudePlatform } from '../platforms/claude/platform';
import { ChatGptPlatform } from '../platforms/chatgpt/platform';

/** Minimal DisplayNode for matcher tests — only the fields search reads matter. */
function makeNode(
  id: string,
  fullText: string,
  opts: { kinds?: ContentKind[]; isOnActivePath?: boolean; role?: 'human' | 'assistant' } = {},
): DisplayNode {
  return {
    id,
    role: opts.role ?? 'human',
    parentId: null,
    childIds: [],
    preview: { title: '', body: '', kinds: opts.kinds ?? [], wordCount: 0, highlights: [] },
    fullText,
    body: [],
    questionText: fullText,
    leafId: id,
    humanId: id,
    assistantId: null,
    questionParentId: null,
    isOnActivePath: opts.isOnActivePath ?? true,
    siblingIndex: 0,
    siblingCount: 1,
    branchKind: null,
    depth: 0,
    createdAt: 0,
  };
}

describe('searchNodes', () => {
  it('matches case-insensitively', () => {
    const nodes = [makeNode('a', 'The Foo Bar')];
    expect(searchNodes(nodes, 'foo').map((m) => m.id)).toEqual(['a']);
    expect(searchNodes(nodes, 'FOO').map((m) => m.id)).toEqual(['a']);
  });

  it('matches substrings, not just whole words', () => {
    expect(searchNodes([makeNode('a', 'foobar')], 'oob').map((m) => m.id)).toEqual(['a']);
  });

  it('returns nothing for an empty or whitespace query', () => {
    const nodes = [makeNode('a', 'anything')];
    expect(searchNodes(nodes, '')).toEqual([]);
    expect(searchNodes(nodes, '   ')).toEqual([]);
  });

  it('returns matches in input (graph) order', () => {
    const nodes = [
      makeNode('a', 'apple one'),
      makeNode('b', 'banana'),
      makeNode('c', 'apple two'),
      makeNode('d', 'apple three'),
    ];
    expect(searchNodes(nodes, 'apple').map((m) => m.id)).toEqual(['a', 'c', 'd']);
  });

  it('returns nothing when there is no match', () => {
    expect(searchNodes([makeNode('a', 'hello world')], 'zzz')).toEqual([]);
  });

  it('finds a node on a HIDDEN branch just like an active one (core requirement)', () => {
    const nodes = [
      makeNode('active', 'visible message', { isOnActivePath: true }),
      makeNode('hidden', 'a secret on another branch', { isOnActivePath: false }),
    ];
    expect(searchNodes(nodes, 'secret').map((m) => m.id)).toEqual(['hidden']);
  });

  it('returns both the question and answer of a turn when both match (no dedup)', () => {
    const nodes = [
      makeNode('t::q', 'what is the refund policy?', { role: 'human' }),
      makeNode('t::a', 'the refund policy is 30 days', { role: 'assistant' }),
    ];
    expect(searchNodes(nodes, 'refund').map((m) => m.id)).toEqual(['t::q', 't::a']);
  });

  describe('broad scope — content beyond fullText', () => {
    it('matches text inside a generated artifact', () => {
      const nodes = [
        makeNode('a', 'here is the document', {
          kinds: [
            { kind: 'artifact', count: 1, items: [{ name: 'plan.md', content: 'quarterly revenue projections' }] },
          ],
        }),
      ];
      expect(searchNodes(nodes, 'quarterly').map((m) => m.id)).toEqual(['a']);
    });

    it("matches an uploaded file's extracted text", () => {
      const nodes = [
        makeNode('a', 'see attached', {
          kinds: [
            { kind: 'attachment', count: 1, files: [{ name: 'notes.txt', content: 'mitochondria powerhouse' }] },
          ],
        }),
      ];
      expect(searchNodes(nodes, 'mitochondria').map((m) => m.id)).toEqual(['a']);
    });

    it('matches widget source code', () => {
      const nodes = [
        makeNode('a', 'a chart', {
          kinds: [{ kind: 'widget', count: 1, widgets: [{ code: '<svg id="payroll"></svg>', isSvg: true }] }],
        }),
      ];
      expect(searchNodes(nodes, 'payroll').map((m) => m.id)).toEqual(['a']);
    });

    it('matches link text and URLs', () => {
      const nodes = [
        makeNode('a', 'resources', {
          kinds: [{ kind: 'links', count: 1, items: [{ text: 'Docs', url: 'https://example.com/widgets' }] }],
        }),
      ];
      expect(searchNodes(nodes, 'example.com/widgets').map((m) => m.id)).toEqual(['a']);
    });
  });
});

describe('per-occurrence matches', () => {
  it('emits one match per body occurrence, indexed in document order', () => {
    const out = searchNodes([makeNode('a', 'foo and foo and foo')], 'foo');
    expect(out.length).toBe(3);
    expect(out.map((m) => m.id)).toEqual(['a', 'a', 'a']);
    expect(out.map((m) => m.occurrence)).toEqual([0, 1, 2]);
  });

  it('totals body occurrences across nodes (drives the match count)', () => {
    const out = searchNodes(
      [makeNode('a', 'alpha alpha'), makeNode('b', 'alpha')],
      'alpha',
    );
    expect(out.length).toBe(3);
  });

  it('counts an artifact-only match once, not per occurrence', () => {
    const out = searchNodes(
      [
        makeNode('a', 'no hits in the body', {
          kinds: [{ kind: 'artifact', count: 1, items: [{ name: 'doc', content: 'zed zed zed' }] }],
        }),
      ],
      'zed',
    );
    expect(out.length).toBe(1);
    expect(out[0]!.occurrence).toBe(0);
  });

  it('counts body occurrences and ignores extra hits in a same-node attachment', () => {
    const out = searchNodes(
      [
        makeNode('a', 'beta here and beta there', {
          kinds: [{ kind: 'attachment', count: 1, files: [{ name: 'f', content: 'beta beta beta' }] }],
        }),
      ],
      'beta',
    );
    expect(out.length).toBe(2);
    expect(out.map((m) => m.occurrence)).toEqual([0, 1]);
  });
});

describe('nodeSearchText', () => {
  it('concatenates fullText with artifact, file, and widget content', () => {
    const n = makeNode('a', 'prose body', {
      kinds: [
        { kind: 'artifact', count: 1, items: [{ name: 'doc', content: 'ARTIFACT_TEXT' }] },
        { kind: 'attachment', count: 1, files: [{ name: 'f.txt', content: 'FILE_TEXT' }] },
        { kind: 'widget', count: 1, widgets: [{ title: 'WIDGET_TITLE', code: 'WIDGET_CODE', isSvg: false }] },
      ],
    });
    const text = nodeSearchText(n);
    expect(text).toContain('prose body');
    expect(text).toContain('ARTIFACT_TEXT');
    expect(text).toContain('FILE_TEXT');
    expect(text).toContain('WIDGET_TITLE');
    expect(text).toContain('WIDGET_CODE');
  });
});

describe('search capability gating', () => {
  it('is enabled for Claude and disabled for ChatGPT', () => {
    expect(ClaudePlatform.capabilities.search).toBe(true);
    expect(ChatGptPlatform.capabilities.search).toBe(false);
  });
});
