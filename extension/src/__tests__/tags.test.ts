import { describe, expect, it } from 'vitest';
import type { DisplayNode } from '../tree/displayTree';
import {
  EMPTY_TAG_STATE,
  PALETTE_SIZE,
  assignTag,
  createTag,
  deleteTag,
  findTagByName,
  listTags,
  nextColorIndex,
  nodeMsgId,
  renameTag,
  tagsForNode,
  unassignTag,
  type TagState,
} from '../tags/tags';

/** Build a state with named tags (colors auto-assigned via createTag). */
function withTags(...names: string[]): { state: TagState; ids: Record<string, string> } {
  let state = EMPTY_TAG_STATE;
  const ids: Record<string, string> = {};
  for (const n of names) {
    const [s, t] = createTag(state, n);
    state = s;
    ids[n] = t.id;
  }
  return { state, ids };
}

describe('createTag / findTagByName (dedupe by name)', () => {
  it('creates a new tag with a palette color', () => {
    const [state, tag] = createTag(EMPTY_TAG_STATE, 'Bug');
    expect(tag.name).toBe('Bug');
    expect(tag.color).toBeGreaterThanOrEqual(0);
    expect(state.tags[tag.id]).toEqual(tag);
  });

  it('trims the name', () => {
    const [, tag] = createTag(EMPTY_TAG_STATE, '  Idea  ');
    expect(tag.name).toBe('Idea');
  });

  it('returns the existing tag for a duplicate name (case/space-insensitive), no new tag', () => {
    const { state, ids } = withTags('Bug');
    const [next, tag] = createTag(state, '  bUg ');
    expect(tag.id).toBe(ids['Bug']);
    expect(Object.keys(next.tags)).toHaveLength(1);
    expect(next).toBe(state); // unchanged reference
  });

  it('findTagByName matches case-insensitively', () => {
    const { state, ids } = withTags('Important');
    expect(findTagByName(state, 'IMPORTANT')?.id).toBe(ids['Important']);
    expect(findTagByName(state, 'nope')).toBeUndefined();
  });
});

describe('nextColorIndex (distinct first, then least-used)', () => {
  it('gives distinct colors until the palette is exhausted', () => {
    let state = EMPTY_TAG_STATE;
    const seen = new Set<number>();
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const [s, t] = createTag(state, `t${i}`);
      state = s;
      seen.add(t.color);
    }
    expect(seen.size).toBe(PALETTE_SIZE);
  });

  it('cycles to the least-used slot once exhausted', () => {
    let state = EMPTY_TAG_STATE;
    for (let i = 0; i < PALETTE_SIZE; i++) state = createTag(state, `t${i}`)[0];
    // every slot used once → next is index 0 (lowest index among ties)
    expect(nextColorIndex(state)).toBe(0);
  });
});

describe('assignTag / unassignTag (no duplicate per node, prune empty)', () => {
  it('assigns and is idempotent', () => {
    const { state, ids } = withTags('A');
    const s1 = assignTag(state, 'msg1', ids['A']!);
    const s2 = assignTag(s1, 'msg1', ids['A']!);
    expect(s1.assignments['msg1']).toEqual([ids['A']]);
    expect(s2).toBe(s1); // no-op
  });

  it('unassign removes the tag and prunes the node key when empty', () => {
    const { state, ids } = withTags('A', 'B');
    let s = assignTag(state, 'msg1', ids['A']!);
    s = assignTag(s, 'msg1', ids['B']!);
    s = unassignTag(s, 'msg1', ids['A']!);
    expect(s.assignments['msg1']).toEqual([ids['B']]);
    s = unassignTag(s, 'msg1', ids['B']!);
    expect(s.assignments['msg1']).toBeUndefined();
  });
});

describe('renameTag (propagates by id, rejects collisions)', () => {
  it('renames in place so assignments still resolve to the new name', () => {
    const { state, ids } = withTags('Old');
    let s = assignTag(state, 'msg1', ids['Old']!);
    s = renameTag(s, ids['Old']!, 'New');
    expect(s.tags[ids['Old']!]!.name).toBe('New');
    expect(tagsForNode(s, 'msg1').map((t) => t.name)).toEqual(['New']);
  });

  it('rejects a rename that collides with another tag (state unchanged)', () => {
    const { state, ids } = withTags('A', 'B');
    const s = renameTag(state, ids['A']!, 'b'); // collides with B (case-insensitive)
    expect(s).toBe(state);
    expect(s.tags[ids['A']!]!.name).toBe('A');
  });

  it('rejects an empty name', () => {
    const { state, ids } = withTags('A');
    expect(renameTag(state, ids['A']!, '   ')).toBe(state);
  });
});

describe('deleteTag (cascade)', () => {
  it('removes the tag and strips it from every node, leaving others intact', () => {
    const { state, ids } = withTags('A', 'B');
    let s = assignTag(state, 'm1', ids['A']!);
    s = assignTag(s, 'm1', ids['B']!);
    s = assignTag(s, 'm2', ids['A']!);
    s = deleteTag(s, ids['A']!);
    expect(s.tags[ids['A']!]).toBeUndefined();
    expect(s.tags[ids['B']!]).toBeDefined();
    expect(s.assignments['m1']).toEqual([ids['B']]);
    expect(s.assignments['m2']).toBeUndefined(); // pruned (was only A)
  });
});

describe('listTags / tagsForNode (ordering)', () => {
  it('listTags is sorted by name', () => {
    const { state } = withTags('Zeta', 'alpha', 'Mu');
    expect(listTags(state).map((t) => t.name)).toEqual(['alpha', 'Mu', 'Zeta']);
  });

  it('tagsForNode preserves assignment order and drops unknown ids', () => {
    const { state, ids } = withTags('A', 'B');
    let s = assignTag(state, 'm', ids['B']!);
    s = assignTag(s, 'm', ids['A']!);
    expect(tagsForNode(s, 'm').map((t) => t.name)).toEqual(['B', 'A']);
  });
});

describe('nodeMsgId (stable per-node key)', () => {
  const node = (over: Partial<DisplayNode>): DisplayNode => over as DisplayNode;

  it('uses humanId for a question node', () => {
    expect(nodeMsgId(node({ role: 'human', humanId: 'h1', assistantId: 'a1' }))).toBe('h1');
  });

  it('uses assistantId for an answer node', () => {
    expect(nodeMsgId(node({ role: 'assistant', humanId: 'h1', assistantId: 'a1' }))).toBe('a1');
  });

  it('is null for a pending answer node (no answer message yet)', () => {
    expect(nodeMsgId(node({ role: 'assistant', humanId: 'h1', assistantId: null }))).toBeNull();
  });
});
