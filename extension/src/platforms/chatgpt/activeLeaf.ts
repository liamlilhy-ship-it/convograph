import type { NormalizedConversation } from '../model';

/**
 * The active branch's leaf, read from the page DOM.
 *
 * ChatGPT does NOT persist branch selection server-side: clicking its native
 * `‹ ›` version arrows changes only the DOM, leaving `current_node` untouched
 * (verified live — a re-fetch still reports the pre-switch branch). So the API
 * can't tell us which branch is shown; the DOM is the source of truth.
 *
 * ChatGPT tags each rendered turn's bubble with `data-message-id` equal to the
 * normalized node id (the turn representative). A multi-message answer (tool
 * preamble + final) renders several `data-message-id`s, but only the turn rep is
 * a node in the tree — so intersecting with the tree's ids and taking the LAST in
 * document order (deepest rendered turn) yields the deepest rendered turn.
 *
 * That deepest RENDERED turn may still be short of the true leaf: a long chat
 * virtualizes the branch tail, and image-only answers below the viewport aren't
 * mounted, so neither carries a `data-message-id`. We close that gap by extending
 * the leaf downward through UNAMBIGUOUS continuations — a turn with exactly one
 * child is necessarily on the same branch — so the highlight reaches the real leaf
 * even when its turns aren't in the DOM (see extendThroughOnlyChildren).
 *
 * Returns null when nothing maps (DOM not yet rendered) — the caller then keeps
 * its existing highlight.
 */

/** Pure core: the deepest rendered id (last in top→bottom document order) that is
 *  a real turn in the tree. Exported for unit tests. */
export function activeLeafFromRenderedIds(
  renderedIdsTopToBottom: readonly string[],
  treeNodeIds: ReadonlySet<string>,
): string | null {
  let leaf: string | null = null;
  for (const id of renderedIdsTopToBottom) {
    if (treeNodeIds.has(id)) leaf = id;
  }
  return leaf;
}

/**
 * Extend a detected leaf downward through unambiguous continuations: while the
 * current turn has exactly ONE child, that child is necessarily on the same branch
 * (there's no other turn to diverge to), so it belongs on the active path even if
 * ChatGPT hasn't rendered it. Stops at a branch point (≥2 children — the active
 * sibling is whichever is rendered, already captured by the rendered-leaf scan) or
 * at a true leaf. Pure; exported for unit tests.
 */
export function extendThroughOnlyChildren(
  leaf: string,
  childrenById: ReadonlyMap<string, readonly string[]>,
): string {
  let cur = leaf;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const kids = childrenById.get(cur);
    if (kids && kids.length === 1) cur = kids[0]!;
    else break;
  }
  return cur;
}

export function detectActiveLeafFromDom(conv: NormalizedConversation): string | null {
  const rendered = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
    .map((el) => el.getAttribute('data-message-id') ?? '')
    .filter(Boolean);
  const ids = new Set(conv.chat_messages.map((m) => m.uuid));
  const leaf = activeLeafFromRenderedIds(rendered, ids);
  if (leaf == null) return null;
  const childrenById = new Map<string, string[]>();
  for (const m of conv.chat_messages) {
    const p = m.parent_message_uuid;
    if (p == null) continue;
    const arr = childrenById.get(p);
    if (arr) arr.push(m.uuid);
    else childrenById.set(p, [m.uuid]);
  }
  return extendThroughOnlyChildren(leaf, childrenById);
}
