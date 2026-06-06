import type { NormalizedConversation, NormalizedMessage } from '../model';

/**
 * Switches the live ChatGPT chat to the branch ending at a target leaf by driving
 * ChatGPT's native < / > arrows.
 *
 * ChatGPT has NO server-side branch switch (verified live — clicking an arrow
 * fires only telemetry; `current_node` is unchanged and only updates when you
 * send a message). So this is the faithful equivalent of a user clicking the
 * arrows: it walks the path root→leaf and, at each branch point, drives the
 * `< i/m >` control to the sibling on the target path.
 *
 * It operates on the NORMALIZED tree (one node per visible turn), NOT the raw
 * mapping — so hidden system/tool/reasoning nodes never create a spurious branch,
 * and the branch points line up exactly with the `< n/m >` controls ChatGPT
 * renders. Turn-representative ids equal the DOM's `data-message-id`. Best-effort;
 * resets on a full page reload, exactly like native ChatGPT.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type BranchStep = { parent: string; siblingCount: number; targetIdx: number };

/**
 * Pure: the branch-point selections needed to put `targetLeafId` on the active
 * path, derived from the normalized tree. Siblings are ordered oldest-first to
 * match ChatGPT's 1-based `< i/m >` counter. Exported for unit tests.
 */
export function branchPlan(conv: NormalizedConversation, targetLeafId: string): BranchStep[] {
  const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
  const children = new Map<string, NormalizedMessage[]>();
  for (const m of conv.chat_messages) {
    if (!m.parent_message_uuid) continue;
    const arr = children.get(m.parent_message_uuid) ?? children.set(m.parent_message_uuid, []).get(m.parent_message_uuid)!;
    arr.push(m);
  }
  // path root -> leaf
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = targetLeafId;
  while (cur && !guard.has(cur)) { guard.add(cur); path.unshift(cur); cur = byId.get(cur)?.parent_message_uuid ?? null; }

  const steps: BranchStep[] = [];
  for (const id of path) {
    const parent = byId.get(id)?.parent_message_uuid;
    if (!parent) continue;
    const sibs = (children.get(parent) ?? []).slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    if (sibs.length < 2) continue; // not a branch point
    const targetIdx = sibs.findIndex((s) => s.uuid === id);
    if (targetIdx >= 0) steps.push({ parent, siblingCount: sibs.length, targetIdx });
  }
  return steps;
}

function msgEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
}

type BranchControl = {
  current: number; // 1-based position currently shown
  prev: HTMLButtonElement | null;
  next: HTMLButtonElement | null;
  anchor: HTMLElement;
};

/**
 * Finds the branch `< i/m >` control whose denominator matches `siblingCount`.
 * Locating by the COUNTER (rather than by a sibling's message element) handles
 * both branch shapes: a question-edit (the control sits on the user message) and
 * an answer-regenerate (the control sits below the multi-message answer, far from
 * the turn's first message — where the old element-based lookup failed). Returns
 * null when no matching control is rendered.
 */
function findBranchControl(siblingCount: number): BranchControl | null {
  const navBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
    /previous|next/i.test(b.getAttribute('aria-label') || ''),
  );
  for (const btn of navBtns) {
    let cur: HTMLElement | null = btn;
    for (let d = 0; d < 6 && cur; d++, cur = cur.parentElement) {
      const counterEl = Array.from(cur.querySelectorAll<HTMLElement>('*')).find(
        (e) => e.childElementCount === 0 && /^\d+\s*\/\s*\d+$/.test((e.textContent || '').trim()),
      );
      if (!counterEl) continue;
      const parts = (counterEl.textContent || '').trim().split('/').map((s) => parseInt(s.trim(), 10));
      if (parts[1] !== siblingCount) continue;
      const btns = Array.from(cur.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
        /previous|next/i.test(b.getAttribute('aria-label') || ''),
      );
      return {
        current: parts[0]!,
        prev: btns.find((b) => /previous/i.test(b.getAttribute('aria-label') || '')) ?? null,
        next: btns.find((b) => /next/i.test(b.getAttribute('aria-label') || '')) ?? null,
        anchor: cur,
      };
    }
  }
  return null;
}

/** Drive one branch point's control until its `targetIdx`-th sibling is selected. */
async function selectSibling(parent: string, siblingCount: number, targetIdx: number): Promise<boolean> {
  const want = targetIdx + 1; // ChatGPT's counter is 1-based, in children order
  for (let attempt = 0; attempt < siblingCount + 3; attempt++) {
    const ctrl = findBranchControl(siblingCount);
    if (!ctrl) {
      // The control isn't rendered (virtualized) — scroll the branch point into
      // view to mount it, then retry.
      const pe = msgEl(parent);
      if (!pe) return false;
      pe.scrollIntoView({ block: 'center' });
      await wait(350);
      continue;
    }
    if (ctrl.current === want) return true;
    const btn = want > ctrl.current ? ctrl.next : ctrl.prev;
    if (!btn || btn.disabled) return false;
    ctrl.anchor.scrollIntoView({ block: 'center' });
    await wait(120);
    btn.click();
    await wait(450);
  }
  return false;
}

export async function switchToLeaf(
  conv: NormalizedConversation,
  targetLeafId: string,
): Promise<boolean> {
  for (const step of branchPlan(conv, targetLeafId)) {
    if (!(await selectSibling(step.parent, step.siblingCount, step.targetIdx))) return false;
  }
  // Success = every branch point on the path was resolved to the target sibling.
  // We do NOT require the leaf itself to be rendered — long chats virtualize it
  // out of the viewport, and jumpToNode scroll-searches to it afterward.
  return true;
}
