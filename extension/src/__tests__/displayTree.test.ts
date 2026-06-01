import { describe, expect, it } from 'vitest';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree } from '../tree/displayTree';
import linear from './fixtures/linear.json';
import singleEdit from './fixtures/single-edit.json';
import regenerate from './fixtures/regenerate.json';
import nested from './fixtures/nested.json';
import type { ApiConversation } from '../api/types';

const build = (fixture: unknown) => buildDisplayTree(buildTree(fixture as ApiConversation));

describe('buildDisplayTree — linear', () => {
  it('pairs the single (H, A) and shows a pending half-card for the trailing H', () => {
    const dt = build(linear);
    // linear.json: m1(H), m2(A), m3(H, no A yet) — current_leaf=m3
    const pairs = [...dt.byId.values()];
    expect(pairs).toHaveLength(2);

    const ready = pairs.find((p) => p.assistantId === 'm2')!;
    expect(ready.humanId).toBe('m1');
    expect(ready.humanSnippet).toBe('Hello Claude');
    // New snippet heuristic skips short "Hi!" sentence and picks the first
    // 4+ word sentence — better scanability.
    expect(ready.assistantSnippet).toBe('How can I help?');

    const pending = pairs.find((p) => p.assistantId === null)!;
    expect(pending.humanId).toBe('m3');
    expect(pending.assistantSnippet).toBe('');

    expect(dt.activePath).toEqual([ready.id, pending.id]);
    expect(ready.isOnActivePath).toBe(true);
    expect(pending.isOnActivePath).toBe(true);
  });
});

describe('buildDisplayTree — scenario #2: edit-question diverges', () => {
  it('renders sibling cards with different Q text', () => {
    const dt = build(singleEdit);
    // single-edit.json:
    //   m1(H) -> m2(A) -> { m3a(H, dead branch), m3b(H) -> m4b(A) }
    //   current_leaf = m4b
    const pairs = [...dt.byId.values()];

    const root = pairs.find((p) => p.humanId === 'm1' && p.assistantId === 'm2')!;
    const editA = pairs.find((p) => p.humanId === 'm3a')!;
    const editB = pairs.find((p) => p.humanId === 'm3b' && p.assistantId === 'm4b')!;

    expect(editA.parentId).toBe(root.id);
    expect(editB.parentId).toBe(root.id);
    expect(root.childIds).toEqual([editA.id, editB.id]);

    // Siblings have DIFFERENT Q text — not flagged as shared
    expect(editA.shareQWithSiblings).toBe(false);
    expect(editB.shareQWithSiblings).toBe(false);
    expect(editA.humanSnippet).not.toBe(editB.humanSnippet);

    expect(editA.siblingCount).toBe(2);
    expect(editB.siblingCount).toBe(2);

    expect(editA.isOnActivePath).toBe(false);
    expect(editB.isOnActivePath).toBe(true);
    expect(dt.activePath).toEqual([root.id, editB.id]);
  });
});

describe('buildDisplayTree — scenario #1: regenerate diverges as separate cards', () => {
  it('produces N sibling cards sharing the same Q text', () => {
    const dt = build(regenerate);
    // regenerate.json: h1 -> { a1, a2, a3 }  current_leaf = a2
    const pairs = [...dt.byId.values()];
    expect(pairs).toHaveLength(3);

    const p1 = pairs.find((p) => p.assistantId === 'a1')!;
    const p2 = pairs.find((p) => p.assistantId === 'a2')!;
    const p3 = pairs.find((p) => p.assistantId === 'a3')!;

    // All three share the same human Q and the shared flag is set
    expect(p1.humanId).toBe('h1');
    expect(p2.humanId).toBe('h1');
    expect(p3.humanId).toBe('h1');
    expect(p1.humanSnippet).toBe(p2.humanSnippet);
    expect(p2.humanSnippet).toBe(p3.humanSnippet);
    expect(p1.shareQWithSiblings).toBe(true);
    expect(p2.shareQWithSiblings).toBe(true);
    expect(p3.shareQWithSiblings).toBe(true);

    // All three are roots (no preceding turn), each their own card
    expect(p1.parentId).toBeNull();
    expect(p2.parentId).toBeNull();
    expect(p3.parentId).toBeNull();
    expect(dt.roots.map((r) => r.id).sort()).toEqual([p1.id, p2.id, p3.id].sort());

    // Different A text per card
    expect(p1.assistantSnippet).toBe('Red');
    expect(p2.assistantSnippet).toBe('Indigo');
    expect(p3.assistantSnippet).toBe('Forest green');

    // Sibling pips at 1/3, 2/3, 3/3
    expect(p1.siblingCount).toBe(3);
    expect(p2.siblingCount).toBe(3);

    // Only the active-leaf variant is on the active path
    expect(p1.isOnActivePath).toBe(false);
    expect(p2.isOnActivePath).toBe(true);
    expect(p3.isOnActivePath).toBe(false);
    expect(dt.activePath).toEqual([p2.id]);
  });
});

describe('buildDisplayTree — nested edit + regenerate combination', () => {
  it('builds depths and active path correctly', () => {
    const dt = build(nested);
    // nested.json:
    //   h1(H) -> a1(A) -> { h2a -> a2a }, { h2b -> a3, a4 }
    //   current_leaf = a4
    const pairs = [...dt.byId.values()];

    const root = pairs.find((p) => p.humanId === 'h1' && p.assistantId === 'a1')!;
    const branchCats = pairs.find((p) => p.humanId === 'h2a' && p.assistantId === 'a2a')!;
    const branchDogs3 = pairs.find((p) => p.humanId === 'h2b' && p.assistantId === 'a3')!;
    const branchDogs4 = pairs.find((p) => p.humanId === 'h2b' && p.assistantId === 'a4')!;

    // depths
    expect(root.depth).toBe(0);
    expect(branchCats.depth).toBe(1);
    expect(branchDogs3.depth).toBe(1);
    expect(branchDogs4.depth).toBe(1);

    // The two dogs cards are regenerate siblings — share Q
    expect(branchDogs3.shareQWithSiblings).toBe(true);
    expect(branchDogs4.shareQWithSiblings).toBe(true);
    // The cats card branches from the same parent but has a different Q — not shared
    expect(branchCats.shareQWithSiblings).toBe(false);

    // Cats and dogs siblings under the same parent display node (root)
    expect(root.childIds).toContain(branchCats.id);
    expect(root.childIds).toContain(branchDogs3.id);
    expect(root.childIds).toContain(branchDogs4.id);
    expect(root.childIds).toHaveLength(3);

    // Active leaf is a4 → only branchDogs4 is on the active path (plus root)
    expect(dt.activePath).toEqual([root.id, branchDogs4.id]);
    expect(branchCats.isOnActivePath).toBe(false);
    expect(branchDogs3.isOnActivePath).toBe(false);
    expect(branchDogs4.isOnActivePath).toBe(true);
  });

  it('resolves leafId to the NEAREST childless leaf (not the newest deep branch)', () => {
    const dt = build(nested);
    const pairs = [...dt.byId.values()];
    const root = pairs.find((p) => p.humanId === 'h1' && p.assistantId === 'a1')!;
    const branchCats = pairs.find((p) => p.humanId === 'h2a' && p.assistantId === 'a2a')!;
    const branchDogs3 = pairs.find((p) => p.humanId === 'h2b' && p.assistantId === 'a3')!;
    const branchDogs4 = pairs.find((p) => p.humanId === 'h2b' && p.assistantId === 'a4')!;

    // a1 has children. Nearest-leaf descent: both h2a and h2b reach a leaf in
    // 2 hops, so tie-break by oldest child (h2a, created before h2b) -> a2a.
    // Crucially NOT a4 (the newest deep regenerate) — that was the bug.
    expect(root.leafId).toBe('a2a');
    // Tip nodes (clicked answer is itself a leaf) resolve to exactly that message.
    expect(branchCats.leafId).toBe('a2a');
    expect(branchDogs3.leafId).toBe('a3');
    expect(branchDogs4.leafId).toBe('a4');
  });
});
