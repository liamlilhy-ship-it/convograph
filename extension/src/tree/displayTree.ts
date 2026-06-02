import type { BuiltTree, TreeNode } from './buildTree';
import type { NodePreview } from './preview';
import { siblingHighlights } from './siblingDiff';

/**
 * A DisplayNode is a single conversation message — either a question (human) or
 * an answer (assistant). Each turn of the chat becomes TWO display nodes wired
 * `… A(prev) → Q(this) → A(this) → Q(next) …`.
 *
 * Branches:
 *   - Edit (different Q): an answer node has multiple question children, each
 *     with different text and `branchKind: 'edit'`.
 *   - Regenerate (same Q, different A): the single question message is
 *     DUPLICATED once per answer branch — each duplicate question node carries
 *     `branchKind: 'regenerate'` and leads to exactly one answer, so a click
 *     resolves to a single, unambiguous branch.
 */
export type DisplayRole = 'human' | 'assistant';
export type BranchKind = 'regenerate' | 'edit' | null;

export type DisplayNode = {
  id: string; // `${pairId}::q` or `${pairId}::a`
  role: DisplayRole;
  parentId: string | null;
  childIds: string[];
  preview: NodePreview;
  fullText: string;
  /** Question text of this turn (the human message). Same on the question node
   *  AND its answer node, so clicking either centers the question bubble. */
  questionText: string;
  /** A concrete leaf MESSAGE uuid for this branch — what current_leaf must be
   *  set to. Shared by the turn's question and answer nodes. */
  leafId: string;
  isOnActivePath: boolean;
  /** Branch position of this TURN (carried on both the question and answer). */
  siblingIndex: number;
  siblingCount: number;
  /** Set on question nodes only: 'regenerate' (Q shared with a sibling) |
   *  'edit' (>1 sibling, different Q) | null. Drives the tag/badge. */
  branchKind: BranchKind;
  depth: number;
  createdAt: number;
};

export type DisplayTree = {
  byId: Map<string, DisplayNode>;
  roots: DisplayNode[];
  activePath: string[];
  orderedNodes: DisplayNode[];
};

/**
 * Internal: one (human, assistant-child) turn pair. This is the intermediate
 * structure that carries all the branch/leaf/active-path/sibling-diff logic;
 * `buildDisplayTree` then explodes each pair into a question + answer node.
 */
type TurnPair = {
  id: string; // `${humanId}::${assistantId | 'pending'}`
  humanId: string;
  assistantId: string | null;
  leafId: string;
  parentId: string | null;
  childIds: string[];
  humanFullText: string;
  humanPreview: NodePreview;
  assistantFullText: string;
  assistantPreview: NodePreview;
  isOnActivePath: boolean;
  siblingIndex: number;
  siblingCount: number;
  createdAt: number;
  /** True when the human Q is identical to at least one sibling's Q (i.e. this
   *  group is a regenerate, not an edit). */
  shareQWithSiblings: boolean;
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
  const pairById = new Map<string, TurnPair>();
  const pairsByHuman = new Map<string, string[]>();

  // Pass 1: create a pair for every (human, assistant-child). Humans with no
  // assistant child still get a (H, null) pending pair.
  for (const node of built.orderedNodes) {
    if (node.sender !== 'human') continue;
    const assistantChildren = node.childIds
      .map((id) => built.byId.get(id))
      .filter((n): n is TreeNode => !!n && n.sender === 'assistant')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (assistantChildren.length === 0) {
      const id = pairId(node.id, null);
      pairById.set(id, {
        id,
        humanId: node.id,
        assistantId: null,
        leafId: descendToLeaf(node.id, built),
        parentId: null,
        childIds: [],
        humanFullText: node.fullText,
        humanPreview: node.preview,
        assistantFullText: '',
        assistantPreview: emptyPreview(),
        isOnActivePath: false,
        siblingIndex: 0,
        siblingCount: 1,
        createdAt: node.createdAt,
        shareQWithSiblings: false,
      });
      pairsByHuman.set(node.id, [id]);
    } else {
      const ids: string[] = [];
      for (const a of assistantChildren) {
        const id = pairId(node.id, a.id);
        ids.push(id);
        pairById.set(id, {
          id,
          humanId: node.id,
          assistantId: a.id,
          leafId: descendToLeaf(a.id, built),
          parentId: null,
          childIds: [],
          humanFullText: node.fullText,
          humanPreview: node.preview,
          assistantFullText: a.fullText,
          // Clone so sibling-diff writes don't mutate the shared TreeNode preview.
          assistantPreview: { ...a.preview, highlights: [] },
          isOnActivePath: false,
          siblingIndex: 0,
          siblingCount: 1,
          createdAt: a.createdAt,
          shareQWithSiblings: assistantChildren.length > 1,
        });
      }
      pairsByHuman.set(node.id, ids);
    }
  }

  // Sibling diff: for each regenerate group (one human → multiple assistant
  // children), compute the 1–2 most distinctive tokens per answer and store
  // them as highlights on the assistant preview.
  for (const [, displayIds] of pairsByHuman) {
    if (displayIds.length < 2) continue;
    const dns = displayIds.map((d) => pairById.get(d)!);
    if (!dns.every((d) => d.shareQWithSiblings && d.assistantId)) continue;
    const texts = dns.map((d) => d.assistantFullText);
    const highlightsByCard = siblingHighlights(texts);
    for (let i = 0; i < dns.length; i++) {
      dns[i]!.assistantPreview = {
        ...dns[i]!.assistantPreview,
        highlights: highlightsByCard[i] ?? [],
      };
    }
  }

  // Pass 2: wire parent/child between pairs. The parent of (H, A) is the pair
  // whose assistantId === H.parentId (the prior turn whose assistant spawned
  // this human Q).
  for (const p of pairById.values()) {
    const human = built.byId.get(p.humanId);
    if (!human) continue;
    const parentAssistantId = human.parentId;
    if (!parentAssistantId) continue;
    const parentAssistant = built.byId.get(parentAssistantId);
    if (!parentAssistant || parentAssistant.sender !== 'assistant') continue;
    const grandHuman = parentAssistant.parentId
      ? built.byId.get(parentAssistant.parentId)
      : null;
    if (!grandHuman || grandHuman.sender !== 'human') continue;
    const parentPairId = pairId(grandHuman.id, parentAssistant.id);
    const parent = pairById.get(parentPairId);
    if (!parent) continue;
    p.parentId = parent.id;
    parent.childIds.push(p.id);
  }

  // Sort children by createdAt for stable layout.
  for (const p of pairById.values()) {
    p.childIds.sort((a, b) => pairById.get(a)!.createdAt - pairById.get(b)!.createdAt);
  }

  const pairRoots: TurnPair[] = [];
  for (const p of pairById.values()) {
    if (p.parentId == null) pairRoots.push(p);
  }
  pairRoots.sort((a, b) => a.createdAt - b.createdAt);

  // Siblings (per pair).
  for (const p of pairById.values()) {
    const siblingList = p.parentId
      ? pairById.get(p.parentId)!.childIds
      : pairRoots.map((r) => r.id);
    p.siblingCount = siblingList.length;
    p.siblingIndex = siblingList.indexOf(p.id);
  }

  // Active path over pairs: walk the message-level active path in pairs. A pair
  // spans (H, A_active); trailing humans with no assistant become a pending
  // pair on the path.
  const pairActivePath: string[] = [];
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
      const targetId = isPairableAssistant ? pairId(cur.id, next.id) : pairId(cur.id, null);
      const p = pairById.get(targetId);
      if (p) {
        pairActivePath.push(p.id);
        p.isOnActivePath = true;
      }
      i += isPairableAssistant ? 2 : 1;
      continue;
    }
    // Orphan assistant (no preceding human) — skip; shouldn't normally happen.
    i++;
  }

  // ---- Explode each pair into a question node + (optional) answer node ----
  const byId = new Map<string, DisplayNode>();
  for (const p of pairById.values()) {
    const qId = `${p.id}::q`;
    const aId = `${p.id}::a`;
    const hasAnswer = p.assistantId != null;
    const branchKind: BranchKind = p.shareQWithSiblings
      ? 'regenerate'
      : p.siblingCount > 1
        ? 'edit'
        : null;

    byId.set(qId, {
      id: qId,
      role: 'human',
      parentId: p.parentId ? `${p.parentId}::a` : null,
      childIds: hasAnswer ? [aId] : [],
      preview: p.humanPreview,
      fullText: p.humanFullText,
      questionText: p.humanFullText,
      leafId: p.leafId,
      isOnActivePath: p.isOnActivePath,
      siblingIndex: p.siblingIndex,
      siblingCount: p.siblingCount,
      branchKind,
      depth: 0,
      createdAt: p.createdAt,
    });

    if (hasAnswer) {
      byId.set(aId, {
        id: aId,
        role: 'assistant',
        parentId: qId,
        childIds: p.childIds.map((c) => `${c}::q`),
        preview: p.assistantPreview,
        fullText: p.assistantFullText,
        questionText: p.humanFullText,
        leafId: p.leafId,
        isOnActivePath: p.isOnActivePath,
        siblingIndex: p.siblingIndex,
        siblingCount: p.siblingCount,
        branchKind: null,
        depth: 0,
        createdAt: p.createdAt,
      });
    }
  }

  // Roots: question nodes of root pairs.
  const roots: DisplayNode[] = [];
  for (const dn of byId.values()) {
    if (dn.parentId == null) roots.push(dn);
  }
  roots.sort((a, b) => a.createdAt - b.createdAt);

  // Depths + ordered traversal over display nodes.
  const orderedNodes: DisplayNode[] = [];
  const visit = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    n.depth = depth;
    orderedNodes.push(n);
    for (const cid of n.childIds) visit(cid, depth + 1);
  };
  for (const r of roots) visit(r.id, 0);

  // Active path: explode the pair-level active path in order (Q then A).
  const activePath: string[] = [];
  for (const pid of pairActivePath) {
    const p = pairById.get(pid);
    if (!p) continue;
    activePath.push(`${pid}::q`);
    if (p.assistantId != null) activePath.push(`${pid}::a`);
  }

  return { byId, roots, activePath, orderedNodes };
}
