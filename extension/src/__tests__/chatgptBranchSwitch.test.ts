import { describe, expect, it } from 'vitest';
import { pathToLeaf } from '../platforms/chatgpt/branchSwitch';
import type { ChatGptConversation } from '../platforms/chatgpt/types';

// A small branched tree: a1 has two user children (u2 / u2b), each leading to a
// different leaf — the shape pathToLeaf must walk for branch switching.
const M: NonNullable<ChatGptConversation['mapping']> = {
  root: { parent: null, children: ['u1'], message: null },
  u1: { parent: 'root', children: ['a1'], message: { author: { role: 'user' } } },
  a1: { parent: 'u1', children: ['u2', 'u2b'], message: { author: { role: 'assistant' } } },
  u2: { parent: 'a1', children: ['a2'], message: { author: { role: 'user' } } },
  u2b: { parent: 'a1', children: ['a2b'], message: { author: { role: 'user' } } },
  a2: { parent: 'u2', children: [], message: { author: { role: 'assistant' } } },
  a2b: { parent: 'u2b', children: [], message: { author: { role: 'assistant' } } },
};

describe('pathToLeaf', () => {
  it('returns the root→leaf chain through the chosen branch', () => {
    expect(pathToLeaf(M, 'a2b')).toEqual(['root', 'u1', 'a1', 'u2b', 'a2b']);
    expect(pathToLeaf(M, 'a2')).toEqual(['root', 'u1', 'a1', 'u2', 'a2']);
  });

  it('returns a single node when the leaf is a root', () => {
    expect(pathToLeaf(M, 'root')).toEqual(['root']);
  });

  it('is cycle-safe', () => {
    const cyclic: NonNullable<ChatGptConversation['mapping']> = {
      x: { parent: 'y', children: [], message: null },
      y: { parent: 'x', children: [], message: null },
    };
    expect(pathToLeaf(cyclic, 'x').length).toBeLessThanOrEqual(2);
  });
});
