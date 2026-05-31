import type { ApiConversation, ApiMessage } from '../api/types';

export type TreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  sender: 'human' | 'assistant';
  snippet: string;
  fullText: string;
  createdAt: number;
  isOnActivePath: boolean;
  siblingIndex: number;
  siblingCount: number;
  depth: number;
};

export type BuiltTree = {
  byId: Map<string, TreeNode>;
  roots: TreeNode[];
  activePath: string[];
  orderedNodes: TreeNode[];
};

const SNIPPET_LEN = 120;

function textOf(msg: ApiMessage): string {
  const parts = (msg.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
    .filter(Boolean);
  return parts.join('\n').trim();
}

function snippetOf(full: string): string {
  const oneLine = full.replace(/\s+/g, ' ').trim();
  return oneLine.length <= SNIPPET_LEN ? oneLine : oneLine.slice(0, SNIPPET_LEN - 1) + '…';
}

export function buildTree(conv: ApiConversation): BuiltTree {
  const byId = new Map<string, TreeNode>();

  for (const msg of conv.chat_messages) {
    const full = textOf(msg);
    byId.set(msg.uuid, {
      id: msg.uuid,
      parentId: msg.parent_message_uuid,
      childIds: [],
      sender: msg.sender,
      snippet: snippetOf(full),
      fullText: full,
      createdAt: new Date(msg.created_at).getTime(),
      isOnActivePath: false,
      siblingIndex: 0,
      siblingCount: 1,
      depth: 0,
    });
  }

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.childIds.push(node.id);
    } else {
      roots.push(node);
    }
  }

  for (const node of byId.values()) {
    node.childIds.sort((a, b) => byId.get(a)!.createdAt - byId.get(b)!.createdAt);
  }
  roots.sort((a, b) => a.createdAt - b.createdAt);

  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const siblings = parent ? parent.childIds : roots.map((r) => r.id);
    node.siblingCount = siblings.length;
    node.siblingIndex = siblings.indexOf(node.id);
  }

  const orderedNodes: TreeNode[] = [];
  const visit = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    n.depth = depth;
    orderedNodes.push(n);
    for (const cid of n.childIds) visit(cid, depth + 1);
  };
  for (const r of roots) visit(r.id, 0);

  const activePath: string[] = [];
  let cursor: string | null = conv.current_leaf_message_uuid;
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    activePath.unshift(cursor);
    const n = byId.get(cursor)!;
    n.isOnActivePath = true;
    cursor = n.parentId;
  }

  return { byId, roots, activePath, orderedNodes };
}
