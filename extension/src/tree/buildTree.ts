import type { ApiConversation, ApiMessage } from '../api/types';
import { computeNodePreview, type NodePreview } from './preview';
import type { ImageRef, FileRef, WidgetRef, ArtifactRef, MediaRefs, PreviewBlock } from './contentKinds';

export type TreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  sender: 'human' | 'assistant';
  /** Legacy short snippet — kept for compatibility. Prefer `preview.title`. */
  snippet: string;
  fullText: string;
  /** Message body split into ordered blocks (text runs + inline widgets), in the
   *  original document order — for the full preview's in-place rendering. */
  body: PreviewBlock[];
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
 * Splits a message into ordered body blocks by walking its content array in
 * document order: consecutive text blocks coalesce into one markdown run, and a
 * `visualize:show_widget` tool_use becomes a widget block exactly where it sits
 * between the text. (Images live in the file arrays with no inline anchor, and
 * `present_files`/`create_file` are end-of-message artifacts — both are rendered
 * as trailing sections by the preview, not woven into the body.)
 */
function bodyOf(msg: ApiMessage): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let run: string[] = [];
  const flush = () => {
    const t = run.join('\n').trim();
    if (t) blocks.push({ kind: 'md', text: t });
    run = [];
  };
  for (const c of msg.content ?? []) {
    if (c.type === 'text') {
      if (c.text) run.push(c.text);
    } else if (c.type === 'tool_use' && c.name === 'visualize:show_widget') {
      const code = typeof c.input?.widget_code === 'string' ? c.input.widget_code : '';
      if (!code) continue;
      flush();
      const title = typeof c.input?.title === 'string' ? c.input.title : undefined;
      blocks.push({ kind: 'widget', widget: { title, code, isSvg: code.trim().startsWith('<svg') } });
    }
  }
  flush();
  return blocks;
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
const ARTIFACT_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

function mediaOf(msg: ApiMessage): MediaRefs {
  const images: ImageRef[] = [];
  const files: FileRef[] = [];
  const widgets: WidgetRef[] = [];
  const artifacts: ArtifactRef[] = [];
  const seenArtifact = new Set<string>();
  const seen = new Set<string>();

  // Visualizations rendered inline by a tool (claude.ai's `visualize:show_widget`).
  // The markup lives in the tool_use input and is never echoed into a file array,
  // so we pull it straight from the content blocks.
  for (const c of msg.content ?? []) {
    if (c.type !== 'tool_use') continue;
    if (c.name === 'visualize:show_widget') {
      const code = typeof c.input?.widget_code === 'string' ? c.input.widget_code : '';
      if (!code) continue;
      const title = typeof c.input?.title === 'string' ? c.input.title : undefined;
      widgets.push({ title, code, isSvg: code.trim().startsWith('<svg') });
    } else if (c.name === 'present_files') {
      // Files Claude generated and surfaced as links at the end of the answer.
      // These never appear in the file arrays (no URL) — only their sandbox
      // paths are listed. Image outputs DO land in the file arrays (handled
      // below as thumbnails), so skip image extensions here to avoid dupes.
      const raw = c.input?.filepaths;
      const paths = Array.isArray(raw) ? raw : [];
      for (const p of paths) {
        if (typeof p !== 'string') continue;
        const name = p.split('/').pop() || p;
        const type = typeFromName(name);
        if (type && ARTIFACT_IMAGE_EXT.has(type)) continue;
        if (seenArtifact.has(name)) continue;
        seenArtifact.add(name);
        artifacts.push({ name, type });
      }
    } else if (c.name === 'artifacts') {
      // The Artifacts feature ("Claude Document"). Unlike present_files, the full
      // text is inline in `input.content`, so we can preview it ourselves. The
      // create/update/rewrite commands re-emit the same `id` → keep the latest.
      const input = c.input ?? {};
      const content = typeof input.content === 'string' ? input.content : '';
      if (!content) continue;
      const id = typeof input.id === 'string' ? input.id : undefined;
      const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
      const ref: ArtifactRef = {
        name: rawTitle || 'Document',
        type: artifactType(typeof input.type === 'string' ? input.type : undefined),
        id,
        content,
      };
      const at = id ? artifacts.findIndex((a) => a.id === id) : -1;
      if (at >= 0) artifacts[at] = ref; // update/rewrite supersedes the earlier version
      else artifacts.push(ref);
    }
  }

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

  return { images, files, widgets, artifacts };
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

/** Short display type for an Artifacts MIME (e.g. "text/markdown" → "markdown",
 *  "application/vnd.ant.code" → "code"). Falls back to the MIME subtype. */
function artifactType(mime?: string): string | undefined {
  if (!mime) return undefined;
  if (mime.includes('markdown')) return 'markdown';
  if (mime.includes('html')) return 'html';
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'application/vnd.ant.code') return 'code';
  return mime.split('/').pop() || undefined;
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
      body: bodyOf(msg),
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
