import { describe, expect, it } from 'vitest';
import {
  activeLeafFromRenderedIds,
  extendThroughOnlyChildren,
} from '../platforms/chatgpt/activeLeaf';

// The normalized tree's turn ids (one per visible turn). Intermediate
// system/tool message ids ChatGPT also tags with data-message-id are NOT in here.
const treeIds = new Set(['u1', 'a1', 'u2', 'a2', 'a2b']);

describe('activeLeafFromRenderedIds', () => {
  it('returns the deepest (last in document order) rendered turn id', () => {
    // DOM after the user switched to the 2nd version of the last answer (a2b).
    expect(activeLeafFromRenderedIds(['u1', 'a1', 'u2', 'a2b'], treeIds)).toBe('a2b');
  });

  it('reflects a native switch by reading the swapped-in leaf', () => {
    // Same conversation, version 1 of the last answer shown — the leaf differs.
    expect(activeLeafFromRenderedIds(['u1', 'a1', 'u2', 'a2'], treeIds)).toBe('a2');
  });

  it('ignores rendered ids that are not turns in the tree (system/tool nodes)', () => {
    expect(
      activeLeafFromRenderedIds(['u1', 'sys-x', 'a1', 'tool-y', 'u2', 'a2'], treeIds),
    ).toBe('a2');
  });

  it('returns null when no rendered id maps to a turn (empty / virtualized DOM)', () => {
    expect(activeLeafFromRenderedIds([], treeIds)).toBeNull();
    expect(activeLeafFromRenderedIds(['sys-x', 'tool-y'], treeIds)).toBeNull();
  });

  it('handles a multi-message answer: only the turn rep id counts', () => {
    // ChatGPT renders a tool preamble + final bubble for one answer turn; only the
    // turn representative (a2b) is a tree node, so it is the detected leaf.
    expect(
      activeLeafFromRenderedIds(['u1', 'a1', 'u2', 'a2b', 'final-msg-not-a-turn'], treeIds),
    ).toBe('a2b');
  });
});

describe('extendThroughOnlyChildren', () => {
  // a1 → u2 → a2 (each a sole child); a1 is the deepest RENDERED turn, but the
  // branch tail (u2, a2) is virtualized out of the DOM — as with image answers
  // below the fold. Extending through the only-child chain reaches the real leaf.
  const children = new Map<string, string[]>([
    ['a1', ['u2']],
    ['u2', ['a2']],
  ]);

  it('descends through sole children to the real leaf', () => {
    expect(extendThroughOnlyChildren('a1', children)).toBe('a2');
  });

  it('includes a sole-child question whose own answer is unrendered', () => {
    // The reported bug: the deepest rendered turn is the answer (a1); its only
    // child is the next question (u2), which must end up highlighted.
    expect(extendThroughOnlyChildren('a1', new Map([['a1', ['u2']]]))).toBe('u2');
  });

  it('stops at a branch point (≥2 children)', () => {
    // a1 has two regenerated/edited children — the active one is whatever the DOM
    // rendered, so we must NOT guess; stop at a1.
    expect(extendThroughOnlyChildren('a1', new Map([['a1', ['x', 'y']]]))).toBe('a1');
  });

  it('returns the leaf unchanged when it has no children', () => {
    expect(extendThroughOnlyChildren('a2', children)).toBe('a2');
  });
});
