import type { NormalizedConversation } from '../model';
import { renderedMessageIds } from './selectors';

/**
 * The active branch's leaf, read from the page DOM.
 *
 * The chat can show a branch other than the server's `current_node` (ChatGPT
 * doesn't persist which version is on screen), so the DOM is the source of truth
 * for what's shown.
 *
 * ChatGPT tags each rendered message with its id (see selectors.ts), equal to the
 * normalized node id (the turn representative). A multi-message answer (tool
 * preamble + final) renders several ids, but only the turn rep is a node in the
 * tree — so intersecting with the tree's ids and taking the LAST in document
 * order yields the deepest rendered turn.
 *
 * ChatGPT only mounts a WINDOW of turns, though — the last 5 on load, or the
 * ones around a message we jumped to — so the deepest rendered turn can sit
 * anywhere on the branch. Two rules cover that:
 *   - If every rendered turn lies on the server's branch, the window doesn't
 *     contradict the server, so its leaf stands (see allOnPathTo).
 *   - Otherwise the chat shows another branch: take the deepest rendered turn and
 *     extend it downward through UNAMBIGUOUS continuations — a turn with exactly
 *     one child is necessarily on the same branch — so the highlight reaches the
 *     real leaf even when its turns aren't in the DOM (extendThroughOnlyChildren).
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

/** Whether every one of `ids` lies on the root→`leaf` path. Pure; exported for
 *  unit tests. */
export function allOnPathTo(
  ids: readonly string[],
  leaf: string,
  parentById: ReadonlyMap<string, string | null>,
): boolean {
  const path = new Set<string>();
  let cur: string | null = leaf;
  while (cur && !path.has(cur)) {
    path.add(cur);
    cur = parentById.get(cur) ?? null;
  }
  return ids.every((id) => path.has(id));
}

export function detectActiveLeafFromDom(conv: NormalizedConversation): string | null {
  const ids = new Set(conv.chat_messages.map((m) => m.uuid));
  const rendered = renderedMessageIds().filter((id) => ids.has(id));
  const leaf = activeLeafFromRenderedIds(rendered, ids);
  if (leaf == null) return null;
  const serverLeaf = conv.current_leaf_message_uuid;
  const parentById = new Map(conv.chat_messages.map((m) => [m.uuid, m.parent_message_uuid]));
  if (serverLeaf && allOnPathTo(rendered, serverLeaf, parentById)) return serverLeaf;
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
