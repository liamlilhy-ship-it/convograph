import type { ChatGptConversation, ChatGptMessage } from './types';
import type { DisplayNode } from '../../tree/displayTree';

/**
 * Reaches a lazy-unloaded message via ChatGPT's prompt-navigation rail — the
 * fixed strip of dashes on the right of a long chat, one per user prompt (oldest→
 * newest along the active branch). Clicking dash N makes ChatGPT scroll to AND
 * render the Nth user message — the one lever that defeats the lazy-load window
 * (verified live; a plain scrollTop won't). Used both for click-to-jump and to
 * bring a branch point's `< n/m >` arrows into the DOM before driving them.
 *
 * Index source = the target's USER-PROMPT ANCESTOR COUNT in the raw tree, i.e. how
 * many user prompts precede it on the path from the root. That's exactly its rail
 * position and it's BRANCH-INDEPENDENT (the prefix up to a prompt is shared across
 * branches) — crucial because a node's `leafId` can descend into a *different*
 * branch (e.g. an image regenerate below the prompt), whose prompt list wouldn't
 * match the rail. We then CONVERGE: click the guessed dash, read which prompt we
 * landed on (same ancestor-count metric), step toward the target, and confirm by
 * the target's own `data-message-id` (a mis-index can't succeed).
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

/** Drive the rail until the message `targetId` is shown. Self-correcting. */
async function revealByTarget(raw: ChatGptConversation, targetId: string): Promise<boolean> {
  const ideal = rawUserIndex(raw, targetId);
  if (ideal < 0) return false;

  let btns: HTMLButtonElement[] = [];
  for (let i = 0; i < 12; i++) {
    btns = railButtons();
    if (btns.length) break;
    await wait(150);
  }
  if (!btns.length) return false; // no rail (short chat / different UI)

  const sel = `[data-message-id="${CSS.escape(targetId)}"]`;
  const inView = (): boolean => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top > -300 && r.top < window.innerHeight;
  };
  const verify = async (steps: number): Promise<boolean> => {
    for (let i = 0; i < steps; i++) {
      if (inView()) return true;
      await wait(200);
    }
    return false;
  };

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

/** Reveal a graph node's question bubble (for click-to-jump). */
export function revealNodeViaRail(raw: ChatGptConversation, node: DisplayNode): Promise<boolean> {
  return revealByTarget(raw, node.humanId);
}

/** Reveal a specific user message (by id) — used to bring a branch point's
 *  `< n/m >` control into the DOM before driving it. */
export function revealUserMessage(raw: ChatGptConversation, userId: string): Promise<boolean> {
  return revealByTarget(raw, userId);
}
