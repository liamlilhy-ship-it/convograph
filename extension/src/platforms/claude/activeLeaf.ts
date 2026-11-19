import type { NormalizedConversation } from '../model';

/**
 * The active branch's leaf, read from the page DOM.
 *
 * Since Nov 2026 claude.ai renders the chat from its own timeline store and no
 * longer follows the REST `current_leaf_message_uuid` (the PUT still succeeds,
 * but neither a cache refresh nor a page reload moves the chat), and it dropped
 * its `< n/m >` version arrows. So the branch on screen is the truth.
 *
 * Each rendered turn (question + its answer) carries `data-turn-key` = the
 * question's message uuid. claude.ai only mounts a window of turns (the last few
 * on load, more on scroll), so:
 *   - if every rendered turn lies on the server leaf's branch, the window doesn't
 *     contradict the server and its leaf stands;
 *   - otherwise take the deepest rendered turn and extend it down through
 *     only-children (a message with exactly one child is necessarily followed by
 *     it), so the highlight reaches the real leaf past the rendered window.
 *
 * Returns null when no rendered turn maps to the tree (chat not rendered yet).
 */

/** Pure core; `renderedIds` are the rendered turn keys in top→bottom order.
 *  Exported for unit tests. */
export function activeLeafFromRendered(
  conv: NormalizedConversation,
  renderedIds: readonly string[],
): string | null {
  const parentById = new Map(conv.chat_messages.map((m) => [m.uuid, m.parent_message_uuid]));
  const rendered = renderedIds.filter((id) => parentById.has(id));
  let leaf = rendered[rendered.length - 1];
  if (leaf == null) return null;

  const serverLeaf = conv.current_leaf_message_uuid;
  if (serverLeaf) {
    const path = new Set<string>();
    for (let cur: string | null | undefined = serverLeaf; cur && !path.has(cur); cur = parentById.get(cur)) {
      path.add(cur);
    }
    if (rendered.every((id) => path.has(id))) return serverLeaf;
  }

  const childrenById = new Map<string, string[]>();
  for (const m of conv.chat_messages) {
    const p = m.parent_message_uuid;
    if (p == null) continue;
    const arr = childrenById.get(p);
    if (arr) arr.push(m.uuid);
    else childrenById.set(p, [m.uuid]);
  }
  const seen = new Set<string>();
  while (!seen.has(leaf)) {
    seen.add(leaf);
    const kids = childrenById.get(leaf);
    if (kids?.length !== 1) break;
    leaf = kids[0]!;
  }
  return leaf;
}

export function detectActiveLeafFromDom(conv: NormalizedConversation): string | null {
  const els = document.querySelectorAll('[data-autoscroll-container] [data-turn-key]');
  return activeLeafFromRendered(
    conv,
    Array.from(els, (el) => el.getAttribute('data-turn-key') ?? ''),
  );
}
