import type { ApiConversation, ApiMessage } from '../api/types';
import { computeNodePreview, type NodePreview } from './preview';
import type { ImageRef, FileRef, MediaRefs } from './contentKinds';

export type TreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  sender: 'human' | 'assistant';
  /** Legacy short snippet — kept for compatibility. Prefer `preview.title`. */
  snippet: string;
  fullText: string;
  preview: NodePreview;
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

function textOf(msg: ApiMessage): string {
  const parts = (msg.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
    .filter(Boolean);
  return parts.join('\n').trim();
}

/**
 * Maps claude.ai's message media into the model-agnostic MediaRefs the preview
 * layer consumes. Media is spread across THREE arrays that overlap:
 *   - `files_v2` (newer) and `files` (legacy) — images + documents
 *   - `attachments` — uploaded documents (extracted text)
 * We merge all three and dedupe by file_uuid/file_name so every distinct file
 * shows exactly once. Other providers get their own adapter producing the same
 * shape.
 */
function mediaOf(msg: ApiMessage): MediaRefs {
  const images: ImageRef[] = [];
  const files: FileRef[] = [];
  const seen = new Set<string>();

  const take = (key: string | null): boolean => {
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  // files_v2 (newer) and files (legacy) overlap; merge + dedupe by id/name.
  for (const f of [...(msg.files_v2 ?? []), ...(msg.files ?? [])]) {
    if (!take(f.file_uuid ?? f.uuid ?? f.file_name ?? null)) continue;
    const isImage = f.file_kind === 'image' || !!f.image_asset;
    if (isImage && (f.thumbnail_url || f.preview_url)) {
      images.push({
        thumbUrl: f.thumbnail_url ?? f.preview_url!,
        fullUrl: f.preview_url ?? f.thumbnail_url,
        name: f.file_name,
      });
    } else if (f.file_name) {
      files.push({
        name: f.file_name,
        url: f.preview_url,
        type: typeFromName(f.file_name) ?? cleanType(f.file_type ?? f.file_kind),
        size: f.size_bytes ?? f.file_size ?? f.file_size_bytes,
      });
    }
  }

  for (const a of msg.attachments ?? []) {
    if (!take(a.file_uuid ?? a.id ?? a.file_name ?? null)) continue;
    if (a.file_name) {
      files.push({
        name: a.file_name,
        type: typeFromName(a.file_name) ?? cleanType(a.file_type),
        size: a.file_size,
      });
    }
  }

  return { images, files };
}

/** Derives a display type from a filename extension (e.g. "report.pdf" → "pdf"). */
function typeFromName(name?: string): string | undefined {
  const m = name?.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** Drops generic/unhelpful type labels like claude.ai's "blob". */
function cleanType(t?: string): string | undefined {
  if (!t || t === 'blob' || t === 'file') return undefined;
  return t;
}

export function buildTree(conv: ApiConversation): BuiltTree {
  const byId = new Map<string, TreeNode>();

  for (const msg of conv.chat_messages) {
    const full = textOf(msg);
    const preview = computeNodePreview(full, msg.content ?? [], msg.sender, mediaOf(msg));
    byId.set(msg.uuid, {
      id: msg.uuid,
      parentId: msg.parent_message_uuid,
      childIds: [],
      sender: msg.sender,
      snippet: preview.title,
      fullText: full,
      preview,
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
