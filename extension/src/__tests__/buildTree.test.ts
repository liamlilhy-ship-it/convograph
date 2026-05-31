import { describe, expect, it } from 'vitest';
import { buildTree } from '../tree/buildTree';
import linear from './fixtures/linear.json';
import singleEdit from './fixtures/single-edit.json';
import type { ApiConversation } from '../api/types';

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
});
