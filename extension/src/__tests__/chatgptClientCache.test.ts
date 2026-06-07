import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversation, invalidateConversation } from '../platforms/chatgpt/client';
import type { ChatGptConversation } from '../platforms/chatgpt/types';

/**
 * Verifies the cache-invalidation contract the write actions depend on: a fresh
 * fetch is served from the short-TTL cache on an immediate re-read, but
 * `invalidateConversation` forces the NEXT read back to the network — so the graph
 * reload after an edit/regenerate/follow-up sees the new branch instead of the
 * pre-write copy.
 */

const ORIGIN = 'https://chatgpt.com';

// A minimal media-free raw conversation (so getConversation does no file requests).
const raw: ChatGptConversation = {
  conversation_id: 'c1',
  current_node: 'a1',
  mapping: {
    root: { id: 'root', parent: null, children: ['u1'], message: null },
    u1: {
      id: 'u1',
      parent: 'root',
      children: ['a1'],
      message: {
        id: 'u1',
        author: { role: 'user' },
        recipient: 'all',
        create_time: 1,
        content: { content_type: 'text', parts: ['hi'] },
      },
    },
    a1: {
      id: 'a1',
      parent: 'u1',
      children: [],
      message: {
        id: 'a1',
        author: { role: 'assistant' },
        recipient: 'all',
        create_time: 2,
        content: { content_type: 'text', parts: ['hello'] },
      },
    },
  },
};

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let convFetches = 0;

beforeEach(() => {
  convFetches = 0;
  const fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) return jsonResponse({ accessToken: 'tok' });
    if (u.includes('/backend-api/conversation/')) {
      convFetches++;
      return jsonResponse(raw);
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/c/c1` });
  vi.stubGlobal('window', { location: { origin: ORIGIN }, dispatchEvent: () => true, addEventListener: () => {} });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('CustomEvent', class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('invalidateConversation', () => {
  it('serves a re-read from cache, then refetches after invalidation', async () => {
    await getConversation('c1');
    expect(convFetches).toBe(1);

    // Immediate re-read stays within the freshness window → no network.
    await getConversation('c1');
    expect(convFetches).toBe(1);

    // After invalidation the next read goes back to the network.
    invalidateConversation('c1');
    await getConversation('c1');
    expect(convFetches).toBe(2);
  });
});
