import { setCurrentLeaf } from '../api/claudeClient';
import type { DisplayNode } from '../tree/displayTree';

/**
 * Jumps the underlying claude.ai chat to the branch a graph node belongs to.
 *
 * Mechanism (confirmed via spike, see memory claude-ai-branch-switch-api):
 *   1. PUT the node's leaf message uuid to .../current_leaf_message_uuid.
 *   2. Ask the MAIN-world bridge to invalidate the React Query cache so the
 *      chat re-renders to the new branch (a bare PUT doesn't refresh the UI).
 *   3. Locate the node's question bubble and center it.
 *
 * The target leaf is `node.leafId` — a concrete descendant message with no
 * children. The node's own message id cannot be used: the API rejects a leaf
 * that still has children ("Current leaf message has unexpected children").
 */
export function leafUuidOf(node: DisplayNode): string {
  return node.leafId;
}

const REFRESH_REQUEST = 'cg-refresh-conversation';
const REFRESH_DONE = 'cg-refresh-conversation-done';

/** Asks the MAIN-world bridge to re-render; resolves false if it can't. */
function requestRefresh(timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const onDone = (e: Event) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(REFRESH_DONE, onDone);
      resolve(!!(e as CustomEvent).detail?.ok);
    };
    window.addEventListener(REFRESH_DONE, onDone);
    window.dispatchEvent(new CustomEvent(REFRESH_REQUEST));
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener(REFRESH_DONE, onDone);
      resolve(false);
    }, timeoutMs);
  });
}

/**
 * Normalizes API message text to match claude.ai's rendered `textContent`.
 *
 * PRINCIPLE: the DOM strips markdown *syntax* but keeps the *content* a user can
 * read. So this must do the same — remove only the formatting characters
 * (backticks, `*`, `#`, `1.`, fence delimiters, link URLs) and KEEP the words
 * inside them. Deleting content (e.g. inline code `.proto`) makes the API key
 * diverge from the DOM and the match fails. When adding a rule, ask: "does the
 * DOM show this text?" If yes, keep it; only strip the surrounding markers.
 * Pure + exported for unit tests.
 */
export function stripMarkdown(s: string): string {
  return (
    s
      // Code fences: drop the ```/```lang delimiters but KEEP the code text —
      // the DOM renders the code, so the content must survive to match it.
      .replace(/```[a-zA-Z0-9_+\-]*\n?/g, ' ')
      .replace(/```/g, ' ')
      // Inline code: drop the backticks, KEEP the content (e.g. `.proto` -> .proto).
      .replace(/`/g, '')
      // Links: keep the visible text, drop the URL.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Ordered list markers ("1. ") at a line start OR right after ":"/";" — the
      // latter is how inline "do X; 1. detail" prompts render (marker gone in DOM).
      .replace(/(^|\n|[:;])[ \t]*\d+\.[ \t]+/g, '$1 ')
      .replace(/(^|\n|[:;])[ \t]*[-*+][ \t]+/g, '$1 ') // bullet markers
      .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1') // headings
      // Remaining inline emphasis/quote SYNTAX only (never letters/content).
      .replace(/[*_#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

const KEY_SKIP = 8;
const KEY_LEN = 80;

/**
 * Builds a distinctive match key from a node's (already markdown-stripped)
 * question text. Skips the first few chars — where greetings and any residual
 * markers cluster — and takes a mid-slice, which disambiguates near-identical
 * sibling questions (their text diverges past the shared opening).
 * Pure + exported for unit tests.
 */
export function matchKey(strippedQuestion: string): string {
  if (strippedQuestion.length <= KEY_LEN) return strippedQuestion;
  return strippedQuestion.slice(KEY_SKIP, KEY_SKIP + KEY_LEN);
}

function findScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-autoscroll-container]');
}

/** Finds the rendered question bubble matching `key` among mounted bubbles. */
function findBubble(key: string): HTMLElement | null {
  if (!key) return null;
  const bubbles = Array.from(document.querySelectorAll<HTMLElement>('[data-user-message-bubble]'));
  return bubbles.find((b) => stripMarkdown(b.textContent ?? '').includes(key)) ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Centers `el` within the scroll container by adjusting scrollTop directly.
 * `scrollIntoView({behavior:'smooth'})` is unreliable here — claude.ai's
 * autoscroll container interrupts it, leaving the target hundreds of px off
 * (observed live). Manual scrollTop math lands exactly, and a second pass
 * absorbs any reflow nudge.
 */
async function center(el: HTMLElement): Promise<void> {
  const sc = findScroller();
  if (!sc) {
    el.scrollIntoView({ block: 'center' });
    return;
  }
  for (let i = 0; i < 2; i++) {
    const r = el.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    sc.scrollTop += r.top + r.height / 2 - (cr.top + cr.height / 2);
    await sleep(120);
  }
}

/**
 * Centers the node's question bubble. Two obstacles, both observed live:
 *   (a) the branch re-render may not have landed yet — poll briefly in place;
 *   (b) long conversations virtualize, so the bubble may not be mounted —
 *       actively scroll the container in steps until it mounts.
 * Bounded by a time budget so it can never hang. Best effort: if never found,
 * the chat is already on the right branch and the user scrolls manually.
 */
async function scrollToNode(node: DisplayNode, budgetMs = 4000): Promise<boolean> {
  // `questionText` is the turn's human message for BOTH the question node and
  // its answer node — so clicking an answer still centers the question bubble.
  const key = matchKey(stripMarkdown(node.questionText));
  if (!key) return false;
  const deadline = Date.now() + budgetMs;

  // (a) poll in place while the re-render settles.
  for (let i = 0; i < 8 && Date.now() < deadline; i++) {
    const el = findBubble(key);
    if (el) {
      await center(el);
      return true;
    }
    await sleep(150);
  }

  // (b) active scroll-search: walk the container so virtualized bubbles mount.
  const sc = findScroller();
  if (sc) {
    const step = Math.max(200, Math.floor(sc.clientHeight * 0.7));
    for (let y = 0; y <= sc.scrollHeight && Date.now() < deadline; y += step) {
      sc.scrollTop = y;
      await sleep(120);
      const el = findBubble(key);
      if (el) {
        await center(el);
        return true;
      }
    }
  }

  const el = findBubble(key);
  if (el) {
    await center(el);
    return true;
  }
  return false;
}

export type JumpResult = { ok: boolean; refreshed: boolean; centered?: boolean; error?: string };

/**
 * Switches the active branch and centers the node. Throws nothing — returns a
 * result the caller can surface as a toast.
 */
export async function jumpToNode(
  orgId: string,
  convId: string,
  node: DisplayNode,
): Promise<JumpResult> {
  // Already the active branch? Just center it.
  if (node.isOnActivePath) {
    const centered = await scrollToNode(node);
    return { ok: true, refreshed: false, centered };
  }
  try {
    await setCurrentLeaf(orgId, convId, leafUuidOf(node));
  } catch (e) {
    return { ok: false, refreshed: false, error: e instanceof Error ? e.message : String(e) };
  }
  const refreshed = await requestRefresh();
  const centered = await scrollToNode(node);
  return { ok: true, refreshed, centered };
}
