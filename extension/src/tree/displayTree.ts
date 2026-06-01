import type { BuiltTree, TreeNode } from './buildTree';
import type { NodePreview } from './preview';
import { siblingHighlights } from './siblingDiff';

/**
 * A DisplayNode pairs a human question with one of its assistant answers.
 * Two divergence scenarios both produce sibling DisplayNodes:
 *   - Edit (different Q, different A): two humans share a parent assistant.
 *     Each (H_i, A_i) becomes its own card; cards have different Q text.
 *   - Regenerate (same Q, different A): one human has multiple assistant
 *     children. Each (H, A_i) becomes its own card; cards share Q text.
 * In both cases the tree visibly diverges at this turn.
 */
export type DisplayNode = {
  id: string;                    // `${humanId}::${assistantId | 'pending'}`
  humanId: string;
  assistantId: string | null;    // null while a reply is in flight / aborted
  /** A concrete leaf MESSAGE uuid under this node (no children). This is what
   *  claude.ai's current_leaf_message_uuid must be set to — the node's own
   *  message id is rejected when it has descendants. */
  leafId: string;
  parentId: string | null;
  childIds: string[];
  humanSnippet: string;
  humanFullText: string;
  humanPreview: NodePreview;
  assistantSnippet: string;
  assistantFullText: string;
  assistantPreview: NodePreview;
  isOnActivePath: boolean;
  siblingIndex: number;
  siblingCount: number;
  depth: number;
  createdAt: number;
  /** True when the human Q is identical to at least one sibling's Q
   *  (i.e. this group is a regenerate, not an edit). Useful for optional
   *  visual de-emphasis of the repeated question. */
  shareQWithSiblings: boolean;
};

export type DisplayTree = {
  byId: Map<string, DisplayNode>;
  roots: DisplayNode[];
  activePath: string[];
  orderedNodes: DisplayNode[];
};

const PENDING = 'pending';

function pairId(humanId: string, assistantId: string | null): string {
  return `${humanId}::${assistantId ?? PENDING}`;
}

function emptyPreview(): NodePreview {
  return { title: '', body: '', kinds: [], wordCount: 0, highlights: [] };
}

/**
 * Descends the MESSAGE tree from `startId` to the NEAREST concrete leaf — the
 * childless descendant reachable in the fewest hops, tie-broken by oldest. This
 * honors "jump to the exact (Q, A) I clicked": when the clicked answer is itself
 * a leaf (the common tip-node case) it resolves to that message directly, and
 * when it has descendants we stop at the closest endpoint rather than diving
 * into the deepest/newest regenerate of a sibling sub-branch.
 *
 * The returned uuid is safe as current_leaf_message_uuid; the start node's own
 * id is rejected by the API when it still has children.
 */
function descendToLeaf(startId: string, built: BuiltTree): string {
  // Memoized distance from a node to its nearest descendant leaf.
  const distCache = new Map<string, number>();
  const distToLeaf = (id: string, seen: Set<string>): number => {
    const cached = distCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return Infinity; // cycle guard
    const node = built.byId.get(id);
    if (!node || node.childIds.length === 0) {
      distCache.set(id, 0);
      return 0;
    }
    seen.add(id);
    let best = Infinity;
    for (const cid of node.childIds) best = Math.min(best, 1 + distToLeaf(cid, seen));
    seen.delete(id);
    distCache.set(id, best);
    return best;
  };

  let cur = startId;
  const guard = new Set<string>();
  for (;;) {
    if (guard.has(cur)) return cur;
    guard.add(cur);
    const node = built.byId.get(cur);
    if (!node || node.childIds.length === 0) return cur;
    // childIds are sorted oldest-first; pick the child closest to a leaf,
    // tie-broken by that ordering (oldest), so descent is deterministic.
    let bestChild = node.childIds[0]!;
    let bestDist = Infinity;
    for (const cid of node.childIds) {
      const d = distToLeaf(cid, new Set());
      if (d < bestDist) {
        bestDist = d;
        bestChild = cid;
      }
    }
    cur = bestChild;
  }
}

export function buildDisplayTree(built: BuiltTree): DisplayTree {
  const byId = new Map<string, DisplayNode>();
  const pairsByHuman = new Map<string, string[]>();

  // Pass 1: create a DisplayNode for every (human, assistant-child) pair.
  // Humans with no assistant child still get a (H, null) pending card.
  for (const node of built.orderedNodes) {
    if (node.sender !== 'human') continue;
    const assistantChildren = node.childIds
      .map((id) => built.byId.get(id))
      .filter((n): n is TreeNode => !!n && n.sender === 'assistant')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (assistantChildren.length === 0) {
      const id = pairId(node.id, null);
      byId.set(id, {
        id,
        humanId: node.id,
        assistantId: null,
        leafId: descendToLeaf(node.id, built),
        parentId: null,
        childIds: [],
        humanSnippet: node.preview.title,
        humanFullText: node.fullText,
        humanPreview: node.preview,
        assistantSnippet: '',
        assistantFullText: '',
        assistantPreview: emptyPreview(),
        isOnActivePath: false,
        siblingIndex: 0,
        siblingCount: 1,
        depth: 0,
        createdAt: node.createdAt,
        shareQWithSiblings: false,
      });
      pairsByHuman.set(node.id, [id]);
    } else {
      const ids: string[] = [];
      for (const a of assistantChildren) {
        const id = pairId(node.id, a.id);
        ids.push(id);
        byId.set(id, {
          id,
          humanId: node.id,
          assistantId: a.id,
          leafId: descendToLeaf(a.id, built),
          parentId: null,
          childIds: [],
          humanSnippet: node.preview.title,
          humanFullText: node.fullText,
          humanPreview: node.preview,
          assistantSnippet: a.preview.title,
          assistantFullText: a.fullText,
          // Clone so sibling-diff writes don't mutate the shared TreeNode preview.
          assistantPreview: { ...a.preview, highlights: [] },
          isOnActivePath: false,
          siblingIndex: 0,
          siblingCount: 1,
          depth: 0,
          createdAt: a.createdAt,
          shareQWithSiblings: assistantChildren.length > 1,
        });
      }
      pairsByHuman.set(node.id, ids);
    }
  }

  // Sibling diff pass: for each regenerate group (one human → multiple
  // assistant children), compute the 1–2 most distinctive tokens per card and
  // store them as highlights on the assistant preview.
  for (const [humanId, displayIds] of pairsByHuman) {
    if (displayIds.length < 2) continue;
    const dns = displayIds.map((d) => byId.get(d)!);
    if (!dns.every((d) => d.shareQWithSiblings && d.assistantId)) continue;
    const texts = dns.map((d) => d.assistantFullText);
    const highlightsByCard = siblingHighlights(texts);
    for (let i = 0; i < dns.length; i++) {
      dns[i]!.assistantPreview = {
        ...dns[i]!.assistantPreview,
        highlights: highlightsByCard[i] ?? [],
      };
    }
    void humanId;
  }

  // Pass 2: wire parent/child between DisplayNodes.
  // The parent of (H, A) is the DisplayNode whose assistantId === H.parentId
  // (i.e. the prior turn whose assistant message spawned this human Q).
  for (const dn of byId.values()) {
    const human = built.byId.get(dn.humanId);
    if (!human) continue;
    const parentAssistantId = human.parentId;
    if (!parentAssistantId) continue;
    const parentAssistant = built.byId.get(parentAssistantId);
    if (!parentAssistant || parentAssistant.sender !== 'assistant') continue;
    const grandHuman = parentAssistant.parentId
      ? built.byId.get(parentAssistant.parentId)
      : null;
    if (!grandHuman || grandHuman.sender !== 'human') continue;
    const parentDisplayId = pairId(grandHuman.id, parentAssistant.id);
    const parent = byId.get(parentDisplayId);
    if (!parent) continue;
    dn.parentId = parent.id;
    parent.childIds.push(dn.id);
  }

  // Sort children by createdAt for stable layout.
  for (const dn of byId.values()) {
    dn.childIds.sort((a, b) => byId.get(a)!.createdAt - byId.get(b)!.createdAt);
  }

  const roots: DisplayNode[] = [];
  for (const dn of byId.values()) {
    if (dn.parentId == null) roots.push(dn);
  }
  roots.sort((a, b) => a.createdAt - b.createdAt);

  // Siblings.
  for (const dn of byId.values()) {
    const siblingList = dn.parentId
      ? byId.get(dn.parentId)!.childIds
      : roots.map((r) => r.id);
    dn.siblingCount = siblingList.length;
    dn.siblingIndex = siblingList.indexOf(dn.id);
  }

  // Depths + ordered traversal.
  const orderedNodes: DisplayNode[] = [];
  const visit = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    n.depth = depth;
    orderedNodes.push(n);
    for (const cid of n.childIds) visit(cid, depth + 1);
  };
  for (const r of roots) visit(r.id, 0);

  // Active path: walk the message-level active path *in pairs*. A DisplayNode
  // spans (H, A_active), so we consume two messages per pair.  Trailing humans
  // with no assistant child become a pending half-card on the path.
  void pairsByHuman; // kept for clarity; not needed past this point
  const activePath: string[] = [];
  const msgs = built.activePath;
  let i = 0;
  while (i < msgs.length) {
    const cur = built.byId.get(msgs[i]!);
    if (!cur) {
      i++;
      continue;
    }
    if (cur.sender === 'human') {
      const next = i + 1 < msgs.length ? built.byId.get(msgs[i + 1]!) : null;
      const isPairableAssistant =
        next && next.sender === 'assistant' && next.parentId === cur.id;
      const targetId = isPairableAssistant
        ? pairId(cur.id, next.id)
        : pairId(cur.id, null);
      const dn = byId.get(targetId);
      if (dn) {
        activePath.push(dn.id);
        dn.isOnActivePath = true;
      }
      i += isPairableAssistant ? 2 : 1;
      continue;
    }
    // Orphan assistant (no preceding human) — skip; shouldn't normally happen.
    i++;
  }

  return { byId, roots, activePath, orderedNodes };
}
