import type { NormalizedConversation } from '../model';
import { PlatformApiError } from '../errors';
import { adaptChatGptConversation } from './adapter';
import type { ChatGptConversation } from './types';

/**
 * ChatGPT backend client. Unlike claude.ai's cookie-only API, ChatGPT's
 * `backend-api` needs a bearer access token (from `/api/auth/session`). We fetch
 * + cache it, and refetch once on a 401 (tokens expire). All requests are
 * same-origin against whichever host we're on (chatgpt.com / chat.openai.com).
 */

function base(): string {
  return location.origin;
}

let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch(`${base()}/api/auth/session`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new PlatformApiError(res.status, `GET /api/auth/session -> ${res.status}`);
  const data = (await res.json().catch(() => null)) as { accessToken?: string } | null;
  const tok = data?.accessToken;
  if (!tok) throw new PlatformApiError(401, 'No ChatGPT access token (sign in to chatgpt.com?)');
  return tok;
}

function token(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = fetchToken().catch((e) => {
      tokenPromise = null;
      throw e;
    });
  }
  return tokenPromise;
}

async function fetchConversationRaw(convId: string): Promise<ChatGptConversation> {
  const url = `${base()}/backend-api/conversation/${convId}`;
  const get = async () =>
    fetch(url, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    });
  let res = await get();
  if (res.status === 401) {
    // Token likely expired — drop the cache and try once more.
    tokenPromise = null;
    res = await get();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PlatformApiError(res.status, `GET /backend-api/conversation -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<ChatGptConversation>;
}

// Cache the last raw conversation so branch-switching can compute the path
// without an extra round-trip (App.load() populates it via getConversation).
let rawCache: { id: string; data: ChatGptConversation } | null = null;

export async function getConversation(convId: string): Promise<NormalizedConversation> {
  const raw = await fetchConversationRaw(convId);
  rawCache = { id: convId, data: raw };
  return adaptChatGptConversation(raw, convId);
}

/** The raw mapping/current_node, from cache when fresh (else fetched). */
export async function getRawConversation(convId: string): Promise<ChatGptConversation> {
  if (rawCache && rawCache.id === convId) return rawCache.data;
  const raw = await fetchConversationRaw(convId);
  rawCache = { id: convId, data: raw };
  return raw;
}

export function parseConversationIdFromUrl(href: string = window.location.href): string | null {
  // ChatGPT chat URLs are /c/<uuid> (also under /g/g-…/c/<uuid> for GPTs).
  const m = href.match(/\/c\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}
