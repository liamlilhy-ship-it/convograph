import type { DisplayNode } from '../tree/displayTree';
import type { Platform } from '../platforms/types';

/**
 * Jumps the underlying chat to the branch a graph node belongs to.
 *
 * Mechanism (Claude; confirmed via spike, see memory claude-ai-branch-switch-api):
 *   1. Switch the active branch server-side (platform.setActiveLeaf).
 *   2. Ask the MAIN-world bridge to re-render the chat to the new branch (a bare
 *      branch-switch doesn't refresh the UI).
 *   3. Locate the node's question bubble and scroll it to the top.
 *
 * The selectors, the top margin, and the branch-switch itself all come from the
 * active `Platform`, so the algorithm here is platform-agnostic. Platforms with
 * no server-side branch switch degrade to step 3 (scroll only).
 */

const REFRESH_REQUEST = 'cg-refresh-conversation';
const REFRESH_DONE = 'cg-refresh-conversation-done';

/** Asks the MAIN-world bridge to re-render; resolves false if it can't. */
export function requestRefresh(timeoutMs = 2500): Promise<boolean> {
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

/** Drops all whitespace so containment ignores it (see bubbleMatches). */
const collapse = (s: string): string => s.replace(/\s+/g, '');

/**
 * True when a rendered bubble's raw `textContent` contains the match `key`.
 *
 * Matching is WHITESPACE-INSENSITIVE: claude.ai joins consecutive block elements
 * (list items, paragraphs) with NO separator in `textContent`, whereas the API
 * text has newlines that `stripMarkdown` turns into spaces. So a pure list
 * question like "1. Claude code\n2. Most recent 6 months" yields the key
 * "...code most..." while the DOM reads "...codemost..." — `.includes` with the
 * space would miss it. Removing whitespace from both sides bridges the gap.
 * Pure + exported for unit tests.
 */
export function bubbleMatches(bubbleText: string, key: string): boolean {
  const target = collapse(key);
  if (!target) return false;
  return collapse(stripMarkdown(bubbleText)).includes(target);
}

/** Finds the rendered question bubble matching `key` among mounted bubbles. */
function findBubble(platform: Platform, key: string): HTMLElement | null {
  if (!collapse(key)) return null;
  const bubbles = platform.dom.findQuestionBubbles();
  return bubbles.find((b) => bubbleMatches(b.textContent ?? '', key)) ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scrolls `el` to the TOP of the scroll container by adjusting scrollTop directly
 * (leaving `platform.dom.scrollTopMargin` above it to clear the sticky header).
 * `scrollIntoView({behavior:'smooth'})` is unreliable here — the page's autoscroll
 * container interrupts it, leaving the target hundreds of px off (observed live).
 * Manual scrollTop math lands exactly, and a second pass absorbs any reflow nudge.
 */
async function alignToTop(platform: Platform, el: HTMLElement): Promise<void> {
  const sc = platform.dom.findScroller();
  if (!sc) {
    el.scrollIntoView({ block: 'start' });
    return;
  }
  for (let i = 0; i < 2; i++) {
    const r = el.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    sc.scrollTop += r.top - cr.top - platform.dom.scrollTopMargin;
    await sleep(120);
  }
}

/**
 * Scrolls the node's question bubble to the top. Two obstacles, both observed live:
 *   (a) the branch re-render may not have landed yet — poll briefly in place;
 *   (b) long conversations virtualize, so the bubble may not be mounted —
 *       actively scroll the container in steps until it mounts.
 * Bounded by a time budget so it can never hang. Best effort: if never found,
 * the chat is already on the right branch and the user scrolls manually.
 */
async function scrollToNode(platform: Platform, node: DisplayNode, budgetMs = 4000): Promise<boolean> {
  // `questionText` is the turn's human message for BOTH the question node and
  // its answer node — so clicking an answer still scrolls to the question bubble.
  const key = matchKey(stripMarkdown(node.questionText));
  if (!key) return false;
  const deadline = Date.now() + budgetMs;

  // (a) poll in place while the re-render settles.
  for (let i = 0; i < 8 && Date.now() < deadline; i++) {
    const el = findBubble(platform, key);
    if (el) {
      await alignToTop(platform, el);
      return true;
    }
    await sleep(150);
  }

  // (b) active scroll-search: walk the container so virtualized bubbles mount.
  const sc = platform.dom.findScroller();
  if (sc) {
    const step = Math.max(200, Math.floor(sc.clientHeight * 0.7));
    for (let y = 0; y <= sc.scrollHeight && Date.now() < deadline; y += step) {
      sc.scrollTop = y;
      await sleep(120);
      const el = findBubble(platform, key);
      if (el) {
        await alignToTop(platform, el);
        return true;
      }
    }
  }

  const el = findBubble(platform, key);
  if (el) {
    await alignToTop(platform, el);
    return true;
  }
  return false;
}

/**
 * Scrolls the chat to a node's question bubble (top-aligned) WITHOUT changing the
 * active branch. Used to re-align after exiting full-screen: the scroll done
 * during a full-screen jump happens while the chat is hidden behind the graph and
 * doesn't stick, so we replay it once the chat is visible again.
 */
export function scrollChatToNode(platform: Platform, node: DisplayNode): Promise<boolean> {
  return scrollToNode(platform, node);
}

export type JumpResult = { ok: boolean; refreshed: boolean; centered?: boolean; error?: string };

/**
 * Switches the active branch and scrolls the node to the top. Throws nothing — returns a
 * result the caller can surface as a toast. On a platform with no server-side
 * branch switch (or a node already on the active path), it scrolls only.
 */
export async function jumpToNode(
  platform: Platform,
  convId: string,
  node: DisplayNode,
): Promise<JumpResult> {
  // Already the active branch, or no server-side switch available? Just scroll.
  if (node.isOnActivePath || !platform.capabilities.serverBranchSwitch) {
    const centered = await scrollToNode(platform, node);
    return { ok: true, refreshed: false, centered };
  }
  try {
    await platform.setActiveLeaf(convId, node);
  } catch (e) {
    return { ok: false, refreshed: false, error: e instanceof Error ? e.message : String(e) };
  }
  const refreshed = await requestRefresh();
  const centered = await scrollToNode(platform, node);
  return { ok: true, refreshed, centered };
}
