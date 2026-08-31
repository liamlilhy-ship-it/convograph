import type { ApiConversation, ApiMessage, NormalizedCitation } from '../platforms/model';
import { isComposeBlock, composeMarkdownOf, composeVariantsOf, composeKindLabel } from './compose';
import { computeNodePreview, type NodePreview } from './preview';
import type {
  ImageRef,
  FileRef,
  WidgetRef,
  ArtifactRef,
  MediaRefs,
  PreviewBlock,
  CitationRef,
  BlockCitation,
} from './contentKinds';

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
    .map((c) => (c.type === 'text' ? c.text ?? '' : isComposeBlock(c) ? composeMarkdownOf(c) : ''))
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
 *
 * Web citations (claude.ai's per-`text`-block `citations[]`) ride along on the md
 * block: each becomes a `BlockCitation` whose `end` offset is rebased from the
 * source block into the coalesced (and trimmed) run text, so the preview can drop
 * an inline reference chip right after the cited phrase. Footnote numbers are
 * assigned answer-wide (first-seen url keeps its number across the whole message).
 */
function bodyOf(msg: ApiMessage): PreviewBlock[] {
  // Join a message's text blocks with a blank line so each block — e.g. the separate
  // "Let me…" narration steps an agentic answer emits between tool calls — starts on
  // its own line rather than running together as one soft-wrapped paragraph.
  const SEP = '\n\n';
  const blocks: PreviewBlock[] = [];
  const urlToNum = new Map<string, number>(); // answer-wide footnote numbering
  let run: string[] = [];
  let rawLen = 0; // length of run.join(SEP) so far
  let runCitations: BlockCitation[] = []; // ends in raw-join coordinates

  const refOf = (c: NormalizedCitation): CitationRef => {
    const url = c.url!;
    let n = urlToNum.get(url);
    if (n == null) {
      n = urlToNum.size + 1;
      urlToNum.set(url, n);
    }
    const md = c.metadata ?? {};
    const title = c.title?.trim() || md.site_name || hostOf(url);
    return { n, title, url, siteName: md.site_name, siteDomain: md.site_domain, faviconUrl: md.favicon_url };
  };

  const flush = () => {
    const raw = run.join(SEP);
    const text = raw.trim();
    if (text) {
      const leadingTrim = raw.length - raw.trimStart().length;
      const citations = runCitations
        .map((bc) => ({ end: bc.end - leadingTrim, ref: bc.ref }))
        .filter((bc) => bc.end >= 0 && bc.end <= text.length)
        .sort((a, b) => a.end - b.end);
      blocks.push(citations.length ? { kind: 'md', text, citations } : { kind: 'md', text });
    }
    run = [];
    rawLen = 0;
    runCitations = [];
  };

  for (const c of msg.content ?? []) {
    if (c.type === 'text') {
      if (!c.text) continue;
      const base = run.length === 0 ? 0 : rawLen + SEP.length; // + separator before this block
      for (const cit of c.citations ?? []) {
        if (typeof cit.url !== 'string' || typeof cit.end_index !== 'number') continue;
        runCitations.push({ end: base + cit.end_index, ref: refOf(cit) });
      }
      run.push(c.text);
      rawLen = base + c.text.length;
    } else if (c.type === 'tool_use' && c.name === 'visualize:show_widget') {
      const code = typeof c.input?.widget_code === 'string' ? c.input.widget_code : '';
      if (!code) continue;
      flush();
      const title = typeof c.input?.title === 'string' ? c.input.title : undefined;
      blocks.push({ kind: 'widget', widget: { title, code, isSvg: code.trim().startsWith('<svg') } });
    } else if (isComposeBlock(c)) {
      // Composed drafts (emails) get their own block at the document position —
      // the full preview renders them as a distinct card (header / subject /
      // body) so they stand apart from surrounding commentary. The markdown
      // weave in `textOf` still feeds search and the collapsed excerpt.
      const variants = composeVariantsOf(c);
      if (!variants.length) continue;
      flush();
      const label = composeKindLabel(typeof c.input?.kind === 'string' ? c.input.kind : undefined);
      blocks.push({ kind: 'compose', compose: { label, variants } });
    }
  }
  flush();
  return blocks;
}

/** Bare hostname of a URL (sans `www.`), for a citation's fallback label. */
function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/\s]+)/i);
  return m?.[1]?.replace(/^www\./, '') ?? url;
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

function mediaOf(msg: ApiMessage, sandboxFiles: Map<string, string>): MediaRefs {
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
        // HTML files Claude wrote are previewable: attach the reconstructed file
        // content (from create_file/str_replace) so the node can render them live
        // on hover + click. Files with no recoverable content (e.g. produced by a
        // bash script) stay link-only, as before.
        const content = type === 'html' ? sandboxFiles.get(p) : undefined;
        artifacts.push({ name, type, id: p, content });
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
        content: a.extracted_content || undefined,
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

/**
 * Reconstructs the content of files Claude wrote in its sandbox by replaying the
 * file-editing tools across the whole conversation in chronological order:
 * `create_file` sets a path's text, `str_replace` patches it. This is the only
 * in-conversation source for a generated file's bytes — `present_files` lists the
 * paths but carries no content, and claude.ai's own "View" renders straight from
 * this same tree data (no separate file fetch). Files produced another way (e.g. a
 * bash script writing output) won't appear here, so they stay link-only.
 *
 * The map is conversation-global (last write per path wins). On the rare branched
 * conversation that rewrites the same path differently per branch, a node could
 * show another branch's version of that path — acceptable for a preview.
 */
function sandboxFileMap(conv: ApiConversation): Map<string, string> {
  const files = new Map<string, string>();
  const ordered = [...conv.chat_messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const msg of ordered) {
    for (const c of msg.content ?? []) {
      if (c.type !== 'tool_use') continue;
      const input = c.input ?? {};
      if (c.name === 'create_file') {
        const path = typeof input.path === 'string' ? input.path : null;
        const text =
          typeof input.file_text === 'string'
            ? input.file_text
            : typeof input.content === 'string'
              ? input.content
              : null;
        if (path && text != null) files.set(path, text);
      } else if (c.name === 'str_replace') {
        const path = typeof input.path === 'string' ? input.path : null;
        const oldStr = typeof input.old_str === 'string' ? input.old_str : null;
        const newStr = typeof input.new_str === 'string' ? input.new_str : null;
        if (path && oldStr != null && newStr != null && files.has(path)) {
          files.set(path, files.get(path)!.replace(oldStr, newStr));
        }
      }
    }
  }
  return files;
}

export function buildTree(conv: ApiConversation): BuiltTree {
  const byId = new Map<string, TreeNode>();
  const sandboxFiles = sandboxFileMap(conv);

  for (const msg of conv.chat_messages) {
    const full = textOf(msg);
    const preview = computeNodePreview(full, msg.content ?? [], msg.sender, mediaOf(msg, sandboxFiles));
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
