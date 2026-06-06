import type { ChatGptConversation } from './types';

/**
 * Switches the live ChatGPT chat to the branch ending at a target leaf by driving
 * ChatGPT's native < / > arrows.
 *
 * ChatGPT has NO server-side branch switch (verified live — clicking an arrow
 * fires only telemetry; `current_node` is unchanged and only updates when you
 * send a message). So this is the faithful equivalent of a user clicking the
 * arrows: it walks the path root→leaf and, at each branch point, clicks toward the
 * sibling on the target path. Mapping node ids equal the DOM's `data-message-id`
 * (verified), which is how we locate each sibling. Best-effort; resets on a full
 * page reload, exactly like native ChatGPT.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Mapping = NonNullable<ChatGptConversation['mapping']>;

const msgChildrenOf = (M: Mapping, id: string): string[] =>
  (M[id]?.children ?? []).filter((c) => !!M[c]?.message);

/** The chain of node ids from the root down to `leafId` (pure; unit-tested). */
export function pathToLeaf(M: Mapping, leafId: string): string[] {
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = leafId;
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    path.unshift(cur);
    cur = M[cur]?.parent ?? null;
  }
  return path;
}

function msgEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
}

type Arrows = { prev: HTMLButtonElement | null; next: HTMLButtonElement | null };

/** The Prev/Next branch arrows for a message's turn — found by walking up to the
 *  nearest ancestor that contains them (the turn container, ~2 levels up). */
function findArrows(el: HTMLElement): Arrows | null {
  let cur: HTMLElement | null = el;
  for (let d = 0; d < 6 && cur; d++, cur = cur.parentElement) {
    const btns = Array.from(cur.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
      /previous|next/i.test(b.getAttribute('aria-label') || ''),
    );
    if (btns.length >= 2) {
      return {
        prev: btns.find((b) => /previous/i.test(b.getAttribute('aria-label') || '')) ?? null,
        next: btns.find((b) => /next/i.test(b.getAttribute('aria-label') || '')) ?? null,
      };
    }
  }
  return null;
}

/** Make the rendered sibling at one branch point be `sibs[targetIdx]`. */
async function selectSibling(parent: string, sibs: string[], targetIdx: number): Promise<boolean> {
  for (let attempt = 0; attempt < sibs.length + 3; attempt++) {
    let shownIdx = -1;
    let shownEl: HTMLElement | null = null;
    for (let i = 0; i < sibs.length; i++) {
      const e = msgEl(sibs[i]!);
      if (e) { shownIdx = i; shownEl = e; break; }
    }
    if (shownIdx === targetIdx) return true;
    if (shownIdx < 0 || !shownEl) {
      // The branch point isn't mounted (virtualized) — scroll its parent into
      // view to render it, then retry.
      const pe = msgEl(parent);
      if (!pe) return false;
      pe.scrollIntoView({ block: 'center' });
      await wait(350);
      continue;
    }
    const arrows = findArrows(shownEl);
    const btn = targetIdx > shownIdx ? arrows?.next : arrows?.prev;
    if (!btn || btn.disabled) return false;
    shownEl.scrollIntoView({ block: 'center' });
    await wait(120);
    btn.click();
    await wait(450);
  }
  return false;
}

export async function switchToLeaf(raw: ChatGptConversation, targetLeafId: string): Promise<boolean> {
  const M = raw.mapping ?? {};
  for (const node of pathToLeaf(M, targetLeafId)) {
    const parent = M[node]?.parent;
    if (!parent) continue;
    const sibs = msgChildrenOf(M, parent);
    if (sibs.length < 2) continue; // not a branch point
    const targetIdx = sibs.indexOf(node);
    if (targetIdx < 0) continue;
    if (!(await selectSibling(parent, sibs, targetIdx))) return false;
  }
  // Success = every branch point on the path was resolved to the target sibling.
  // We do NOT require the leaf itself to be rendered — long chats virtualize it
  // out of the viewport, and jumpToNode scroll-searches to it afterward.
  return true;
}
