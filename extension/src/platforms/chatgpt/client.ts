import type { NormalizedConversation, NormalizedFile } from '../model';
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  // Back off on rate limiting — a media-heavy chat fires many file requests, and a
  // follow-up conversation fetch can get caught by the limit; retry rather than
  // failing the whole graph load.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await sleep(600 * (attempt + 1));
    res = await get();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PlatformApiError(res.status, `GET /backend-api/conversation -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<ChatGptConversation>;
}

/**
 * Resolve a ChatGPT file id to a viewable URL. `GET /backend-api/files/{id}/download`
 * returns a same-origin, SIGNED, short-lived `download_url` that works directly as
 * an `<img src>`. Returns null on any failure (caller leaves the file url-less).
 */
async function fetchDownloadUrl(fileId: string): Promise<string | null> {
  const url = `${base()}/backend-api/files/${encodeURIComponent(fileId)}/download`;
  const get = async () =>
    fetch(url, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    });
  let res = await get();
  if (res.status === 401) {
    tokenPromise = null;
    res = await get();
  }
  // Rate-limited: back off and retry so the image still resolves on busy chats.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await sleep(500 * (attempt + 1));
    res = await get();
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { download_url?: string } | null;
  return data?.download_url ?? null;
}

// --- Lazy image-URL resolution --------------------------------------------
// A ChatGPT image needs a per-file `download` call to get a (signed) URL.
// Resolving every image up front bursts that endpoint, which rate-limits (429)
// and even stalls the conversation fetch. So we resolve LAZILY: the graph loads
// immediately with whatever URLs are cached; the rest resolve gently in the
// background; a `cg-media-resolved` event then asks the app to re-render. URLs
// are cached in memory + sessionStorage (short TTL, since they expire) so
// re-opening a chat doesn't refetch.

const MEDIA_EVENT = 'cg-media-resolved';
const SS_KEY = 'cg-chatgpt-file-urls';
const SS_TTL = 30 * 60 * 1000; // 30 min — comfortably inside a signed URL's life

const memUrls = new Map<string, string>();

function ssRead(): Record<string, { u: string; t: number }> {
  try {
    return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
  } catch {
    return {};
  }
}
function cachedUrl(fileId: string): string | null {
  const m = memUrls.get(fileId);
  if (m) return m;
  const e = ssRead()[fileId];
  if (e && Date.now() - e.t < SS_TTL) {
    memUrls.set(fileId, e.u);
    return e.u;
  }
  return null;
}
function cacheUrl(fileId: string, url: string): void {
  memUrls.set(fileId, url);
  try {
    const all = ssRead();
    all[fileId] = { u: url, t: Date.now() };
    sessionStorage.setItem(SS_KEY, JSON.stringify(all));
  } catch {
    /* sessionStorage unavailable/full — the memory cache still applies */
  }
}

/**
 * Fill media URLs from cache (synchronous, no network) and return the file ids
 * that still need resolving. Unresolved IMAGES are dropped from the message so
 * they don't briefly render as a bare file row; they reappear as thumbnails once
 * the background pass resolves them and the app reloads. Non-image files are kept
 * (a file row is correct) and get their "open original" URL filled in later.
 */
function applyCachedUrls(conv: NormalizedConversation): string[] {
  const pending = new Set<string>();
  for (const m of conv.chat_messages) {
    if (!m.files_v2) continue;
    const kept: NormalizedFile[] = [];
    for (const f of m.files_v2) {
      if (f.preview_url || !f.file_uuid) {
        kept.push(f);
        continue;
      }
      const url = cachedUrl(f.file_uuid);
      if (url) {
        f.preview_url = url;
        f.thumbnail_url = url;
        kept.push(f);
      } else {
        pending.add(f.file_uuid);
        if (f.file_kind !== 'image') kept.push(f); // keep file rows; drop url-less images
      }
    }
    m.files_v2 = kept;
  }
  return [...pending];
}

const bgRunning = new Set<string>();

/**
 * Resolve pending file ids one at a time (gentle on the rate limiter), caching
 * each, then signal the app to re-render with the new thumbnails. Best-effort:
 * failures (incl. 429 after backoff) are left for the next load to retry.
 */
function resolveInBackground(convId: string, fileIds: string[]): void {
  if (!fileIds.length || bgRunning.has(convId)) return;
  bgRunning.add(convId);
  void (async () => {
    let resolvedAny = false;
    for (const id of fileIds) {
      if (cachedUrl(id)) continue;
      const url = await fetchDownloadUrl(id).catch(() => null);
      if (url) {
        cacheUrl(id, url);
        resolvedAny = true;
      }
      await sleep(150); // space requests so we never burst the endpoint
    }
    bgRunning.delete(convId);
    if (resolvedAny) window.dispatchEvent(new CustomEvent(MEDIA_EVENT));
  })();
}

// --- Conversation fetch management ----------------------------------------
// ChatGPT's /backend-api/conversation endpoint rate-limits HARD: ~3 rapid
// requests → 429, then a ~36s cooldown (measured live). But the app reloads the
// graph on open, on native DOM change (watchConversation), on branch ops, when
// lazy media resolves, and on every chat switch. To stay under the limit:
//   (A) an LRU cache of recent conversations — revisits cost zero fetches;
//   (B) a token-bucket limiter that paces *new* network fetches so a burst of
//       chat-switches never trips the limit (it waits instead);
//   (C) graceful failure — serve the last good copy on a 429, and tell the app
//       we're pacing so it can show a "rate-limited" note instead of an error.

const RATE_EVENT = 'cg-rate-limited';

function nowMs(): number {
  return Date.now();
}

// (A) LRU cache (insertion-ordered Map) + a short freshness window.
const RAW_TTL = 10_000; // ms — within this, reuse with no network at all
const MAX_CACHED = 6;
type RawEntry = { raw: ChatGptConversation; t: number };
const rawCache = new Map<string, RawEntry>();
const rawInFlight = new Map<string, Promise<ChatGptConversation>>();

function lruGet(id: string): RawEntry | undefined {
  const e = rawCache.get(id);
  if (e) {
    rawCache.delete(id);
    rawCache.set(id, e); // bump recency
  }
  return e;
}
function lruSet(id: string, raw: ChatGptConversation): void {
  rawCache.delete(id);
  rawCache.set(id, { raw, t: nowMs() });
  while (rawCache.size > MAX_CACHED) rawCache.delete(rawCache.keys().next().value as string);
}

// (B) Token bucket: allow a small burst, then ~1 fetch / REFILL_MS. The endpoint
// tolerates ~3 per ~36s, so ~1 per 13s stays comfortably under a rolling window.
const BUCKET_CAP = 3;
const REFILL_MS = 13_000;
let tokens = BUCKET_CAP;
let lastRefill = nowMs();

function refillTokens(): void {
  const n = Math.floor((nowMs() - lastRefill) / REFILL_MS);
  if (n > 0) {
    tokens = Math.min(BUCKET_CAP, tokens + n);
    lastRefill += n * REFILL_MS;
  }
}
async function acquireFetchSlot(): Promise<void> {
  refillTokens();
  if (tokens > 0) {
    tokens--;
    return;
  }
  // No slot — let the app note we're pacing ourselves, then wait for a refill.
  window.dispatchEvent(new CustomEvent(RATE_EVENT));
  await sleep(Math.max(500, REFILL_MS - (nowMs() - lastRefill)));
  return acquireFetchSlot();
}

async function getRawConversation(convId: string): Promise<ChatGptConversation> {
  const fresh = lruGet(convId);
  if (fresh && nowMs() - fresh.t < RAW_TTL) return fresh.raw; // (A) recent → no fetch
  const inflight = rawInFlight.get(convId);
  if (inflight) return inflight; // dedupe concurrent loads
  const p = (async () => {
    await acquireFetchSlot(); // (B) stay under the rate (may wait)
    try {
      const raw = await fetchConversationRaw(convId);
      lruSet(convId, raw);
      return raw;
    } catch (err) {
      // (C) serve the last good copy if we have one, rather than erroring.
      const stale = lruGet(convId);
      if (stale) return stale.raw;
      throw err;
    } finally {
      rawInFlight.delete(convId);
    }
  })();
  rawInFlight.set(convId, p);
  return p;
}

// Cache the last normalized conversation so branch-switching can compute its plan
// without an extra round-trip (App.load() populates it via getConversation).
let cache: { id: string; normalized: NormalizedConversation } | null = null;

export async function getConversation(convId: string): Promise<NormalizedConversation> {
  const raw = await getRawConversation(convId);
  const normalized = adaptChatGptConversation(raw, convId);
  // Fill what's cached now (no network) and return immediately, so the graph never
  // waits on — or fails because of — image requests; resolve the rest gently.
  const pending = applyCachedUrls(normalized);
  cache = { id: convId, normalized };
  resolveInBackground(convId, pending);
  return normalized;
}

/** The normalized conversation, from cache when fresh (else fetched). */
export async function getNormalizedConversation(convId: string): Promise<NormalizedConversation> {
  if (cache && cache.id === convId) return cache.normalized;
  return getConversation(convId);
}

/** The last-fetched RAW conversation (any age), for mapping a node to ChatGPT's
 *  own prompt order (the rail). Populated by getConversation during load. */
export function cachedRawConversation(convId: string): ChatGptConversation | null {
  return rawCache.get(convId)?.raw ?? null;
}

/**
 * Drop all cached state for a conversation so the NEXT fetch hits the network.
 * The write actions (edit/regenerate/follow-up in writes.ts) call this after a
 * DOM-driven change has landed, so App.load()'s refetch sees the new branch
 * instead of the <10s-fresh raw cache (RAW_TTL) or the memoized normalized copy.
 * Also frees one token-bucket slot so that forced refetch isn't paced away by the
 * rate limiter — it only ever ADDS a slot for a user-initiated write, so it can't
 * worsen read pacing.
 */
export function invalidateConversation(convId: string): void {
  rawCache.delete(convId);
  rawInFlight.delete(convId);
  if (cache && cache.id === convId) cache = null;
  if (tokens < BUCKET_CAP) tokens++;
}

export function parseConversationIdFromUrl(href: string = window.location.href): string | null {
  // ChatGPT chat URLs are /c/<uuid> (also under /g/g-…/c/<uuid> for GPTs).
  const m = href.match(/\/c\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

/**
 * Whether the pill may show on this chatgpt.com page. The dedicated apps —
 * Images, Sites, Health, Finances, Codex — have (or gain, once onboarded)
 * their own prompt boxes that match our composer selector (`/images` even
 * carries a `#prompt-textarea`) but no conversation tree, so the pill stays
 * hidden there. Chat surfaces (`/`, `/c/…`, `/g/…/c/…`, project homes) and
 * plain list pages keep the composer-anchored behavior (default-allow).
 */
export function isSupportedSurface(href: string): boolean {
  return !/^\/(images|sites|health|finances|codex)(\/|$)/.test(new URL(href).pathname);
}
