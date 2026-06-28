import type { NormalizedConversation, NormalizedMessage } from '../model';
import type { ChatGptConversation } from './types';
import { rawActiveUserIds, revealUserMessage } from './promptRail';
import { detectActiveLeafFromDom } from './activeLeaf';
import { isBranchArrow, navArrowsIn } from './controls';

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
 * Sentinel key grouping the conversation's root turns. A branch on the FIRST
 * message (an edited opening question) makes every version a parent-less root, but
 * ChatGPT still renders a `< n/m >` control for it on the first user bubble — so
 * these must count as a branch point too. Without this, editing the first message
 * left `branchPlan` empty and click-to-jump to the other version silently no-oped.
 */
const ROOT = ' root';

/**
 * Pure: the branch-point selections needed to put `targetLeafId` on the active
 * path, derived from the normalized tree. Siblings are ordered oldest-first to
 * match ChatGPT's 1-based `< i/m >` counter. Exported for unit tests.
 */
export function branchPlan(conv: NormalizedConversation, targetLeafId: string): BranchStep[] {
  const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
  const children = new Map<string, NormalizedMessage[]>();
  for (const m of conv.chat_messages) {
    const key = m.parent_message_uuid ?? ROOT;
    const arr = children.get(key) ?? children.set(key, []).get(key)!;
    arr.push(m);
  }
  // path root -> leaf
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = targetLeafId;
  while (cur && !guard.has(cur)) { guard.add(cur); path.unshift(cur); cur = byId.get(cur)?.parent_message_uuid ?? null; }

  const steps: BranchStep[] = [];
  for (const id of path) {
    const parent = byId.get(id)?.parent_message_uuid ?? ROOT;
    const sibs = (children.get(parent) ?? []).slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    if (sibs.length < 2) continue; // not a branch point
    const targetIdx = sibs.findIndex((s) => s.uuid === id);
    if (targetIdx >= 0) steps.push({ parent, siblingCount: sibs.length, targetIdx });
  }
  return steps;
}

function hasText(m: NormalizedMessage): boolean {
  return m.content.some((b) => b.type === 'text' && (b.text ?? '').trim() !== '');
}

/**
 * Whether switching to `targetLeafId` is REVERSIBLE. ChatGPT only renders the
 * `< n/m >` version arrows on TEXT answers, so a regenerate sibling that is an
 * image-only assistant answer (e.g. a DALL·E generation) is a one-way trap — you
 * could switch onto it but not back. We report such a branch non-switchable so the
 * app blocks the switch up front instead of stranding the user. Pure + unit-tested.
 */
export function isReversiblySwitchable(conv: NormalizedConversation, targetLeafId: string): boolean {
  const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
  const children = new Map<string, NormalizedMessage[]>();
  for (const m of conv.chat_messages) {
    const key = m.parent_message_uuid ?? ROOT;
    (children.get(key) ?? children.set(key, []).get(key)!).push(m);
  }
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = targetLeafId;
  while (cur && !guard.has(cur)) { guard.add(cur); path.unshift(cur); cur = byId.get(cur)?.parent_message_uuid ?? null; }
  for (const id of path) {
    const parent = byId.get(id)?.parent_message_uuid ?? ROOT;
    const sibs = children.get(parent) ?? [];
    if (sibs.length < 2) continue; // not a branch point
    const sib = byId.get(id);
    // The sibling we'd switch ONTO must be able to show the arrows to switch back.
    if (sib && sib.sender === 'assistant' && !hasText(sib)) return false;
  }
  return true;
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

/** Does the turn holding a candidate control display a CHILD of `parent`? Every
 *  sibling at the branch point under `parent` is a child of `parent`, so this is
 *  true no matter which sibling is currently shown — and false for a control that
 *  belongs to a different branch point. (Turn ids equal the DOM's data-message-id;
 *  intermediate system/tool ids aren't in `byId`, so they're ignored.) */
function turnAtParent(
  turn: HTMLElement | null,
  parent: string,
  byId: Map<string, NormalizedMessage>,
): boolean {
  if (!turn) return false;
  for (const el of turn.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const m = byId.get(el.getAttribute('data-message-id') ?? '');
    if (m && (m.parent_message_uuid ?? ROOT) === parent) return true;
  }
  return false;
}

/**
 * Finds the `< i/m >` control FOR THE SPECIFIC branch point under `parent`. Matching
 * by counter denominator ALONE is ambiguous: when several branch points share the
 * same sibling count (e.g. two regenerated answers AND an edited question all show
 * "/2"), the first count-N control in DOM order belongs to the wrong turn, so a
 * multi-level switch drives the wrong arrows and never converges. So we additionally
 * require the control's turn to display a child of `parent` (turnAtParent). Locating
 * by the COUNTER still handles both branch shapes — a question-edit (control on the
 * user message) and an answer-regenerate (control below the multi-message answer).
 * Returns null when the matching control isn't rendered.
 */
function findBranchControl(
  siblingCount: number,
  parent: string,
  byId: Map<string, NormalizedMessage>,
): BranchControl | null {
  const navBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(isBranchArrow);
  for (const btn of navBtns) {
    const turn = btn.closest<HTMLElement>('[data-testid^="conversation-turn"]');
    if (!turnAtParent(turn, parent, byId)) continue; // a control for a DIFFERENT branch point
    let cur: HTMLElement | null = btn;
    for (let d = 0; d < 6 && cur; d++, cur = cur.parentElement) {
      const counterEl = Array.from(cur.querySelectorAll<HTMLElement>('*')).find(
        (e) => e.childElementCount === 0 && /^\d+\s*\/\s*\d+$/.test((e.textContent || '').trim()),
      );
      if (!counterEl) continue;
      const parts = (counterEl.textContent || '').trim().split('/').map((s) => parseInt(s.trim(), 10));
      if (parts[1] !== siblingCount) continue;
      const arrows = navArrowsIn(cur);
      return {
        current: parts[0]!,
        // DOM order is [prev, next]; the `data-rtl-flip` marker (not the localized
        // aria-label) identifies the arrows, so this holds in any UI language.
        prev: arrows[0] ?? null,
        next: arrows[1] ?? null,
        anchor: cur,
      };
    }
  }
  return null;
}

/**
 * Drive one branch point's control until its `targetIdx`-th sibling is selected.
 * The control is lazy-unloaded in long chats — both initially (the branch point
 * is off-window) and AFTER each click (switching re-renders/scrolls the answer
 * out of the window). `scrollIntoView` can't bring it back (ChatGPT's virtual
 * window ignores programmatic scroll), so when the control is missing we call
 * `reveal()` — the prompt rail — which does mount it. Falls back to scrollIntoView
 * when no reveal is available (short chats / other platforms unaffected).
 */
async function selectSibling(
  parent: string,
  siblingCount: number,
  targetIdx: number,
  byId: Map<string, NormalizedMessage>,
  progress: { switched: boolean },
  reveal?: () => Promise<boolean>,
): Promise<boolean> {
  const want = targetIdx + 1; // ChatGPT's counter is 1-based, in children order
  let clicks = 0;
  let needed: number | null = null;
  for (let attempt = 0; attempt < siblingCount + 5; attempt++) {
    let ctrl = findBranchControl(siblingCount, parent, byId);
    if (!ctrl && reveal) {
      // Bring the (lazy-unloaded) control back via the rail, then re-find it. The
      // control renders a tick after its bubble mounts, so poll briefly rather than
      // checking once.
      if (await reveal()) {
        for (let i = 0; i < 5 && !ctrl; i++) {
          await wait(200);
          ctrl = findBranchControl(siblingCount, parent, byId);
        }
      }
    }
    if (!ctrl) {
      if (reveal) {
        // We can't see this branch point's control — ChatGPT virtualizes old turns
        // into empty placeholders and, with its prompt rail gone, reveal can't always
        // remount one. Three cases:
        //   1. We've issued the clicks this branch point needed → the switch HAS
        //      applied (clicking the arrow re-renders the answer and drops its own
        //      control; an image answer shows no arrows at all). Succeed.
        if (needed != null && clicks >= needed) return true;
        //   2. Nothing has been switched yet ANYWHERE on the path → we're still in the
        //      shared prefix the current and target branches agree on, so this branch
        //      point is already on the target sibling (just not rendered). Skip it.
        //      Without this, ANY switch whose path crosses a virtualized already-correct
        //      branch point (e.g. an early edited question far up a long chat) failed
        //      outright — and the prior switch's re-render is what virtualizes it.
        if (!progress.switched && clicks === 0) return true;
        //   3. We're past the divergence and genuinely can't drive this one. Give up.
        return false;
      }
      const pe = msgEl(parent);
      if (!pe) return false;
      pe.scrollIntoView({ block: 'center' });
      await wait(350);
      continue;
    }
    if (ctrl.current === want) return true;
    if (needed == null) needed = Math.abs(want - ctrl.current);
    const btn = want > ctrl.current ? ctrl.next : ctrl.prev;
    if (!btn || btn.disabled) return false;
    ctrl.anchor.scrollIntoView({ block: 'center' });
    await wait(120);
    btn.click();
    clicks++;
    progress.switched = true; // a real divergence: everything below must now be driven
    await wait(650);
  }
  return false;
}

/**
 * The child of `parent` (a branchPlan key — ROOT for a parent-less root turn) on the
 * branch ending at `leaf`: i.e. the sibling CURRENTLY shown at that branch point.
 * That turn's bubble is the one carrying the `< n/m >` version control, so it's what
 * the prompt rail must land on to re-mount the control. Pure; exported for tests.
 */
export function activeChildOf(
  byId: Map<string, NormalizedMessage>,
  leaf: string,
  parent: string,
): string | null {
  const guard = new Set<string>();
  for (let cur: string | null = leaf; cur && !guard.has(cur); ) {
    guard.add(cur);
    const p = byId.get(cur)?.parent_message_uuid ?? ROOT;
    if (p === parent) return cur;
    cur = byId.get(cur)?.parent_message_uuid ?? null;
  }
  return null;
}

export async function switchToLeaf(
  conv: NormalizedConversation,
  targetLeafId: string,
  raw?: ChatGptConversation,
): Promise<boolean> {
  const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
  // Tracks whether we've driven any arrow yet — shared across branch points so that,
  // before the first real switch, an unreachable (virtualized) branch point can be
  // treated as already-correct shared prefix rather than failing the whole switch.
  const progress = { switched: false };
  for (const step of branchPlan(conv, targetLeafId)) {
    // ChatGPT lazy-unloads the branch's `< n/m >` control when its turn is out of the
    // window. selectSibling re-mounts it by driving the prompt rail to the bubble that
    // CARRIES the control — the branch point's currently-shown child (e.g. the active
    // edited question), NOT the assistant turn above it. Revealing the parent lands the
    // rail one prompt short, so the control never mounts (verified live). Recomputed at
    // reveal time so it tracks the active branch after an upper point has been switched;
    // falls back to the active branch's first prompt for a ROOT (edited-first) branch.
    const reveal = raw
      ? () => {
          const leaf = detectActiveLeafFromDom(conv) ?? conv.current_leaf_message_uuid;
          const childId =
            (leaf ? activeChildOf(byId, leaf, step.parent) : null) ??
            (step.parent === ROOT ? rawActiveUserIds(raw, raw.current_node ?? '')[0] : step.parent);
          return childId ? revealUserMessage(raw, childId) : Promise.resolve(false);
        }
      : undefined;
    if (!(await selectSibling(step.parent, step.siblingCount, step.targetIdx, byId, progress, reveal))) {
      return false;
    }
  }
  // Success = every branch point on the path was resolved to the target sibling.
  // We do NOT require the leaf itself to be rendered — long chats virtualize it
  // out of the viewport, and jumpToNode scroll-searches to it afterward.
  return true;
}
