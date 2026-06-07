import type { ChatGptConversation, ChatGptMessage } from './types';
import type { DisplayNode } from '../../tree/displayTree';
import { chatgptDom } from './dom';

/**
 * Reaches a lazy-unloaded message in a long ChatGPT chat so click-to-jump and
 * branch-switch can act on it. ChatGPT renders only a window of recent turns and
 * virtualizes the rest, so the target may not be in the DOM. Two mechanisms, tried
 * in order (the second is the fallback when ChatGPT doesn't offer the first):
 *
 *   1. The prompt-navigation rail — the fixed strip of dashes on the right, one per
 *      user prompt. Clicking dash N makes ChatGPT scroll to AND render the Nth user
 *      message. Fast and exact, but ChatGPT only shows the rail on some chats/UI
 *      versions. Indexed by the target's USER-PROMPT ANCESTOR COUNT (branch-
 *      independent: the prefix up to a prompt is shared across branches, so a node
 *      whose `leafId` descends into a *different* branch still maps to the right
 *      dash). We CONVERGE: click the guessed dash, read which prompt we landed on,
 *      step toward the target, confirm by the target's own `data-message-id`.
 *
 *   2. A stepped scroll of the thread — when the rail is absent or fails. Scrolls
 *      toward the target (direction from its tree DEPTH vs. the rendered turns) until
 *      its `data-message-id` mounts. BEST-EFFORT: ChatGPT virtualizes far turns into
 *      zero-height placeholders that a programmatic scroll can't always re-hydrate,
 *      so this can't reach every message — it covers what it can and fails fast
 *      (clean "couldn't reach" toast) rather than janking the chat.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isUserPrompt(m: ChatGptMessage | null | undefined): boolean {
  return (
    !!m &&
    m.author?.role === 'user' &&
    (m.recipient ?? 'all') === 'all' &&
    m.metadata?.is_visually_hidden_from_conversation !== true
  );
}

/** 0-based rail position of a message = (# user prompts from root to it) − 1. */
function rawUserIndex(raw: ChatGptConversation, id: string): number {
  const mapping = raw.mapping ?? {};
  const guard = new Set<string>();
  let count = 0;
  let cur: string | null = id;
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    if (isUserPrompt(mapping[cur]?.message)) count++;
    cur = mapping[cur]?.parent ?? null;
  }
  return count - 1;
}

/** User-message ids along a branch in RAW order (root→leaf). */
export function rawActiveUserIds(raw: ChatGptConversation, leafId: string): string[] {
  const mapping = raw.mapping ?? {};
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = leafId;
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    path.unshift(cur);
    cur = mapping[cur]?.parent ?? null;
  }
  return path.filter((id) => isUserPrompt(mapping[id]?.message));
}

/** The rail's dash buttons. Tries the (English) aria-label first, then falls back
 *  to a fixed right-edge strip of small buttons so it works in any UI language. */
function railButtons(): HTMLButtonElement[] {
  const byAria = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Prompt "]'));
  if (byAria.length) return byAria;
  for (const d of document.querySelectorAll<HTMLElement>('div')) {
    const cls = typeof d.className === 'string' ? d.className : '';
    if (!/\bfixed\b/.test(cls)) continue;
    if (!/inset-e|inset-ie|(^|\s|:)end-|(^|\s|:)right-/.test(cls)) continue;
    const btns = Array.from(d.querySelectorAll<HTMLButtonElement>('button'));
    if (btns.length >= 2) return btns;
  }
  return [];
}

/** Rail position of the user prompt currently nearest the top of the viewport. */
function landedIndex(raw: ChatGptConversation): number | null {
  let bestId: string | null = null;
  let bestTop = Infinity;
  for (const b of document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')) {
    const id = b.getAttribute('data-message-id');
    if (!id) continue;
    const top = b.getBoundingClientRect().top;
    if (top > -150 && top < bestTop) {
      bestTop = top;
      bestId = id;
    }
  }
  return bestId ? rawUserIndex(raw, bestId) : null;
}

/** Is the message `id` mounted in the DOM (ChatGPT keeps loaded turns mounted even
 *  when scrolled off-screen)? Once mounted, the caller's alignToTop positions it, so
 *  this is the success signal for the scroll reveal. */
function messageMounted(id: string): boolean {
  return !!document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
}

/** Is the message `id` mounted AND within (or just past) the viewport? */
function messageInView(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top > -300 && r.top < window.innerHeight;
}

/** Depth of a message in the raw tree (ancestor count). Monotonic with vertical
 *  position along a branch, so two on-path messages compare older(smaller)→newer. */
function depthOf(raw: ChatGptConversation, id: string): number {
  const mapping = raw.mapping ?? {};
  if (!mapping[id]) return -1;
  const guard = new Set<string>();
  let depth = 0;
  let cur: string | null = id;
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const parent: string | null = mapping[cur]?.parent ?? null;
    if (!parent) break;
    cur = parent;
    depth++;
  }
  return depth;
}

/** Depth span of the messages currently rendered, to choose a scroll direction. */
function renderedDepthRange(raw: ChatGptConversation): { min: number; max: number } | null {
  const mapping = raw.mapping ?? {};
  let min = Infinity;
  let max = -Infinity;
  for (const el of document.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const id = el.getAttribute('data-message-id');
    if (!id || !mapping[id]) continue;
    const d = depthOf(raw, id);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return min <= max ? { min, max } : null;
}

/** Mechanism 1: drive the rail to `targetId`. Self-correcting; the caller has
 *  confirmed the rail is present. Returns false if it can't converge. */
async function revealViaRail(raw: ChatGptConversation, targetId: string, ideal: number): Promise<boolean> {
  const verify = async (steps: number): Promise<boolean> => {
    for (let i = 0; i < steps; i++) {
      if (messageInView(targetId)) return true;
      await wait(200);
    }
    return false;
  };
  let btns = railButtons();
  let dash = Math.max(0, Math.min(btns.length - 1, ideal));
  for (let attempt = 0; attempt < 5; attempt++) {
    btns = railButtons();
    if (dash >= btns.length) return false;
    btns[dash]!.click();
    if (await verify(14)) return true; // ~2.8s for the smooth-scroll to land
    const landed = landedIndex(raw);
    if (landed == null) return false;
    if (landed === ideal) return verify(8);
    const next = Math.max(0, Math.min(btns.length - 1, dash + (ideal - landed)));
    if (next === dash) return false;
    dash = next;
  }
  return false;
}

/** Mechanism 2 (fallback): scroll the thread toward `targetId` until it mounts.
 *  Best-effort — direction from the target's depth vs. the rendered window; gives up
 *  fast once a step makes no progress (scroll didn't move AND nothing new rendered),
 *  which is the signal ChatGPT won't hydrate further this way. */
async function revealViaScroll(raw: ChatGptConversation, targetId: string): Promise<boolean> {
  const sc = chatgptDom.findScroller();
  const targetDepth = depthOf(raw, targetId);
  if (!sc || targetDepth < 0) return false;
  const deadline = Date.now() + 6000;
  let prevSig = '';
  let prevTop = -1;
  let stall = 0;
  while (Date.now() < deadline) {
    if (messageMounted(targetId)) return true;
    const rd = renderedDepthRange(raw);
    const sig = rd ? `${rd.min}:${rd.max}` : 'none';
    const moved = Math.abs(sc.scrollTop - prevTop) > 4;
    if (sig === prevSig && !moved) {
      if (++stall >= 3) break; // scroll pinned and nothing new loaded → dead end
    } else {
      stall = 0;
    }
    prevSig = sig;
    prevTop = sc.scrollTop;
    // Older (smaller depth) is above → scroll up; newer → down.
    const dir = !rd ? -1 : targetDepth < rd.min ? -1 : targetDepth > rd.max ? 1 : targetDepth <= (rd.min + rd.max) / 2 ? -1 : 1;
    sc.scrollTop += dir * Math.max(200, sc.clientHeight * 0.8);
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    await wait(280); // let any lazy fetch + render settle
  }
  return messageMounted(targetId);
}

/** Reveal `targetId`: the rail when ChatGPT offers it, else a stepped scroll. */
async function revealByTarget(raw: ChatGptConversation, targetId: string): Promise<boolean> {
  if (messageInView(targetId)) return true;
  const ideal = rawUserIndex(raw, targetId);
  if (ideal >= 0 && railButtons().length) {
    if (await revealViaRail(raw, targetId, ideal)) return true;
  }
  return revealViaScroll(raw, targetId);
}

/** Reveal a graph node's question bubble (for click-to-jump). */
export function revealNodeViaRail(raw: ChatGptConversation, node: DisplayNode): Promise<boolean> {
  return revealByTarget(raw, node.humanId);
}

/** Reveal a specific user message (by id) — used to bring a branch point's
 *  `< n/m >` control into the DOM before driving it. */
export function revealUserMessage(raw: ChatGptConversation, userId: string): Promise<boolean> {
  return revealByTarget(raw, userId);
}
