import { describe, expect, it } from 'vitest';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree } from '../tree/displayTree';
import linear from './fixtures/linear.json';
import singleEdit from './fixtures/single-edit.json';
import regenerate from './fixtures/regenerate.json';
import nested from './fixtures/nested.json';
import type { ApiConversation } from '../api/types';

const build = (fixture: unknown) => buildDisplayTree(buildTree(fixture as ApiConversation));

// Display-node id helpers: a turn pair `${humanId}::${assistantId|'pending'}`
// explodes into a question node (`::q`) and an answer node (`::a`).
const qid = (h: string, a: string | null) => `${h}::${a ?? 'pending'}::q`;
const aid = (h: string, a: string) => `${h}::${a}::a`;

describe('buildDisplayTree — linear', () => {
  it('emits alternating Q → A → Q nodes with a trailing leaf question', () => {
    const dt = build(linear);
    // linear.json: m1(H) → m2(A) → m3(H, no A) — current_leaf = m3
    expect(dt.byId.size).toBe(3);

    const q1 = dt.byId.get(qid('m1', 'm2'))!;
    const a1 = dt.byId.get(aid('m1', 'm2'))!;
    const q3 = dt.byId.get(qid('m3', null))!;

    expect(q1.role).toBe('human');
    expect(q1.preview.title).toBe('Hello Claude');
    expect(q1.parentId).toBeNull();
    expect(q1.childIds).toEqual([a1.id]);
    expect(q1.branchKind).toBeNull();

    expect(a1.role).toBe('assistant');
    // Shown from the beginning — no filler/sentence skipping.
    expect(a1.preview.title).toBe('Hi! How can I help?');
    expect(a1.parentId).toBe(q1.id);
    expect(a1.childIds).toEqual([q3.id]);
    // Clicking the answer centers the QUESTION bubble → same text as its question.
    expect(a1.questionText).toBe(q1.fullText);

    expect(q3.role).toBe('human');
    expect(q3.preview.title).toBe('Tell me a joke');
    expect(q3.parentId).toBe(a1.id);
    expect(q3.childIds).toEqual([]);
    expect(q3.leafId).toBe('m3');

    expect(dt.roots.map((r) => r.id)).toEqual([q1.id]);
    expect(dt.activePath).toEqual([q1.id, a1.id, q3.id]);
    expect([q1, a1, q3].every((n) => n.isOnActivePath)).toBe(true);
  });
});

describe('buildDisplayTree — regenerate (question duplicated per answer)', () => {
  it('duplicates the question per branch, each tagged regenerate', () => {
    const dt = build(regenerate);
    // regenerate.json: h1 → { a1, a2, a3 }  current_leaf = a2
    expect(dt.byId.size).toBe(6);

    const branches = ['a1', 'a2', 'a3'];
    for (const a of branches) {
      const q = dt.byId.get(qid('h1', a))!;
      const ans = dt.byId.get(aid('h1', a))!;
      expect(q.role).toBe('human');
      expect(q.preview.title).toBe('Pick a color'); // same question text
      expect(q.branchKind).toBe('regenerate');
      expect(q.siblingCount).toBe(3);
      expect(q.parentId).toBeNull(); // all roots
      expect(q.childIds).toEqual([ans.id]);
      expect(q.leafId).toBe(a); // each branch resolves to ITS own answer
      expect(ans.role).toBe('assistant');
      expect(ans.parentId).toBe(q.id);
      expect(ans.branchKind).toBeNull();
      expect(ans.questionText).toBe(q.fullText);
    }

    // The three duplicated questions are the roots.
    expect(dt.roots.map((r) => r.id).sort()).toEqual(
      [qid('h1', 'a1'), qid('h1', 'a2'), qid('h1', 'a3')].sort(),
    );

    // Distinctive-token highlights survive on the answers.
    expect(dt.byId.get(aid('h1', 'a1'))!.preview.highlights).toContain('red');
    expect(dt.byId.get(aid('h1', 'a2'))!.preview.highlights).toContain('indigo');
    expect(dt.byId.get(aid('h1', 'a3'))!.preview.highlights.length).toBeGreaterThan(0);

    // Only the active leaf's branch (a2) is highlighted.
    expect(dt.activePath).toEqual([qid('h1', 'a2'), aid('h1', 'a2')]);
    expect(dt.byId.get(qid('h1', 'a1'))!.isOnActivePath).toBe(false);
    expect(dt.byId.get(qid('h1', 'a2'))!.isOnActivePath).toBe(true);
    expect(dt.byId.get(aid('h1', 'a2'))!.isOnActivePath).toBe(true);
    expect(dt.byId.get(qid('h1', 'a3'))!.isOnActivePath).toBe(false);
  });
});

describe('buildDisplayTree — edit (different question siblings)', () => {
  it('branches into sibling question nodes with different text, no tag', () => {
    const dt = build(singleEdit);
    // single-edit.json:
    //   m1(H) → m2(A) → { m3a(H, dead), m3b(H) → m4b(A) }  current_leaf = m4b
    const rootA = dt.byId.get(aid('m1', 'm2'))!;
    const editA = dt.byId.get(qid('m3a', null))!;
    const editB = dt.byId.get(qid('m3b', 'm4b'))!;
    const answerB = dt.byId.get(aid('m3b', 'm4b'))!;

    // Both edited questions hang off the prior turn's ANSWER node.
    expect(rootA.childIds).toEqual([editA.id, editB.id]);
    expect(editA.parentId).toBe(rootA.id);
    expect(editB.parentId).toBe(rootA.id);

    // Different question text, flagged 'edit' (not 'regenerate').
    expect(editA.preview.title).not.toBe(editB.preview.title);
    expect(editA.branchKind).toBe('edit');
    expect(editB.branchKind).toBe('edit');
    expect(editA.siblingCount).toBe(2);
    expect(editB.siblingCount).toBe(2);

    // The dead branch is a leaf question (no answer node).
    expect(editA.childIds).toEqual([]);
    expect(dt.byId.has(aid('m3a', 'm4b'))).toBe(false);

    // The live branch carries its answer; clicking it centers m3b's question.
    expect(editB.childIds).toEqual([answerB.id]);
    expect(answerB.questionText).toBe(editB.fullText);

    expect(editA.isOnActivePath).toBe(false);
    expect(editB.isOnActivePath).toBe(true);
    expect(dt.activePath).toEqual([qid('m1', 'm2'), aid('m1', 'm2'), editB.id, answerB.id]);
  });
});

describe('buildDisplayTree — nested edit + regenerate', () => {
  it('mixes an edit and a regenerate under the same answer node', () => {
    const dt = build(nested);
    // nested.json:
    //   h1(H) → a1(A) → { h2a → a2a, h2b → { a3, a4 } }  current_leaf = a4
    const rootQ = dt.byId.get(qid('h1', 'a1'))!;
    const rootA = dt.byId.get(aid('h1', 'a1'))!;
    const cats = dt.byId.get(qid('h2a', 'a2a'))!;
    const dogs3 = dt.byId.get(qid('h2b', 'a3'))!;
    const dogs4 = dt.byId.get(qid('h2b', 'a4'))!;

    // depths alternate Q(0) → A(1) → Q(2) → A(3)
    expect(rootQ.depth).toBe(0);
    expect(rootA.depth).toBe(1);
    expect(cats.depth).toBe(2);
    expect(dt.byId.get(aid('h2b', 'a4'))!.depth).toBe(3);

    // Three question children under the root answer: cats (edit) + two dogs (regen).
    expect(rootA.childIds).toEqual([cats.id, dogs3.id, dogs4.id]);
    expect(cats.branchKind).toBe('edit');
    expect(dogs3.branchKind).toBe('regenerate');
    expect(dogs4.branchKind).toBe('regenerate');
    expect([cats, dogs3, dogs4].every((n) => n.siblingCount === 3)).toBe(true);

    // leafId resolves to the NEAREST childless leaf (unchanged from before).
    expect(rootQ.leafId).toBe('a2a');
    expect(rootA.leafId).toBe('a2a');
    expect(cats.leafId).toBe('a2a');
    expect(dogs3.leafId).toBe('a3');
    expect(dogs4.leafId).toBe('a4');

    // Active leaf a4 → only the dogs4 branch (plus root) is on the path.
    expect(dt.activePath).toEqual([rootQ.id, rootA.id, dogs4.id, aid('h2b', 'a4')]);
    expect(cats.isOnActivePath).toBe(false);
    expect(dogs3.isOnActivePath).toBe(false);
    expect(dogs4.isOnActivePath).toBe(true);
  });
});
