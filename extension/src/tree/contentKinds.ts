import type { ApiContentBlock } from '../platforms/model';

export type LinkItem = { text: string; url: string };

/** Model-agnostic image reference (the adapter maps each provider's shape to this). */
export type ImageRef = { thumbUrl: string; fullUrl?: string; name?: string };
/** Model-agnostic file reference. `url` may be absent (e.g. extracted-text docs);
 *  `content` is the text claude.ai extracted from an upload, when available. */
export type FileRef = { name: string; type?: string; size?: number; url?: string; content?: string };
/**
 * A rendered visualization a tool produced inline (claude.ai's
 * `visualize:show_widget`). `code` is self-contained markup; `isSvg` flags the
 * cheap-to-thumbnail SVG case versus arbitrary HTML (sandboxed-iframe only).
 */
export type WidgetRef = { title?: string; code: string; isSvg: boolean };
/**
 * A file Claude generated and presented at the end of an answer. Two sources:
 *  - `present_files`: bytes live only in the sandbox (no URL, no inline text), so
 *    we carry just name + type.
 *  - `artifacts` (the Artifacts feature / "Claude Document"): the full text is
 *    inline, so `content` is set and we render our own preview on click. `id` is
 *    the artifact id — dedupes create/update versions and keys the preview window.
 */
export type ArtifactRef = { name: string; type?: string; id?: string; content?: string };
/**
 * True for a Claude-generated HTML artifact that carries inline content. These
 * render as a LIVE page in a sandboxed iframe (hover + click preview) instead of
 * showing their HTML source as markdown. (Only Claude's `artifacts` pipeline
 * produces HTML-typed artifacts, so this is effectively Claude-only.)
 */
export function isHtmlArtifact(a: { type?: string; content?: string }): boolean {
  return !!a.content && !!a.type && a.type.toLowerCase().includes('html');
}
/** Media extracted from a message's non-text fields, passed into detectKinds. */
export type MediaRefs = {
  images: ImageRef[];
  files: FileRef[];
  widgets?: WidgetRef[];
  artifacts?: ArtifactRef[];
};

export type ContentKind =
  | { kind: 'code'; language?: string; blockCount: number; dominant: boolean; snippet: string }
  | { kind: 'list'; itemCount: number; items: string[] }
  | { kind: 'table'; rowCount: number; colCount: number; headers: string[] }
  | { kind: 'image'; count: number; images: ImageRef[] }
  | { kind: 'attachment'; count: number; files: FileRef[] }
  | { kind: 'links'; count: number; items: LinkItem[] }
  | { kind: 'widget'; count: number; widgets: WidgetRef[] }
  | { kind: 'artifact'; count: number; items: ArtifactRef[] };

/**
 * One block of a message body, in original document order — produced by walking
 * the message's content array. A `md` block is a run of markdown text; a `widget`
 * block is a tool-rendered visualization sitting exactly where it appeared inline.
 * The full preview renders these in sequence so widgets land in place rather than
 * being grouped after all the text.
 */
export type PreviewBlock =
  | { kind: 'md'; text: string }
  | { kind: 'widget'; widget: WidgetRef };

const FENCE_RE = /```([a-zA-Z0-9_+\-]*)\n([\s\S]*?)```/g;
const LIST_LINE_RE = /^\s*(?:[-*+]\s+|\d+\.\s+)/;
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL_RE = /(?:^|\s)(https?:\/\/[^\s)]+)/g;

const SNIPPET_LINES = 3;
const SNIPPET_LINE_LEN = 56;
const MAX_LIST_ITEMS = 3;
const LIST_ITEM_LEN = 64;
const MAX_LINKS = 5;

/**
 * Detects content kinds present in a message. Pure, given a text representation
 * and the raw content blocks (for non-text types like image / attachment).
 */
export function detectKinds(
  text: string,
  blocks: ApiContentBlock[] = [],
  media?: MediaRefs,
): ContentKind[] {
  const kinds: ContentKind[] = [];

  // Code fences
  const fences: Array<{ language?: string; body: string }> = [];
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    fences.push({ language: m[1] || undefined, body: m[2] ?? '' });
  }
  if (fences.length > 0) {
    const codeChars = fences.reduce((n, f) => n + f.body.length, 0);
    const dominant = text.length > 0 && codeChars / text.length > 0.5;
    const language = fences[0]?.language?.toLowerCase();
    kinds.push({
      kind: 'code',
      language,
      blockCount: fences.length,
      dominant,
      snippet: codeSnippet(fences[0]?.body ?? ''),
    });
  }

  const lines = text.split('\n');

  // Lists
  const listLines = lines.filter((l) => LIST_LINE_RE.test(l));
  if (listLines.length >= 2) {
    kinds.push({
      kind: 'list',
      itemCount: listLines.length,
      items: listLines
        .slice(0, MAX_LIST_ITEMS)
        .map((l) => truncate(l.replace(LIST_LINE_RE, '').trim(), LIST_ITEM_LEN)),
    });
  }

  // Tables: ≥ 2 consecutive `|`-bounded lines
  const table = findFirstTable(lines);
  if (table) kinds.push(table);

  // Images: prefer real media refs (with thumbnails); fall back to content-block
  // detection for providers that inline images as blocks.
  const images = media?.images ?? [];
  const hasImageBlock = blocks.some((b) => b.type === 'image' || b.type === 'image_url');
  if (images.length || hasImageBlock) {
    kinds.push({ kind: 'image', count: images.length || (hasImageBlock ? 1 : 0), images });
  }

  // Attachments / files: prefer real media refs (filename + type/size).
  const files = media?.files ?? [];
  const hasAttachBlock = blocks.some(
    (b) => b.type === 'attachment' || b.type === 'file' || b.type === 'document',
  );
  if (files.length || hasAttachBlock) {
    kinds.push({ kind: 'attachment', count: files.length || (hasAttachBlock ? 1 : 0), files });
  }

  // Tool-rendered visualizations (e.g. claude.ai's `visualize:show_widget`).
  const widgets = media?.widgets ?? [];
  if (widgets.length) {
    kinds.push({ kind: 'widget', count: widgets.length, widgets });
  }

  // Generated artifacts presented at the end of an answer (claude.ai's
  // `present_files`). Document/HTML/etc. outputs the assistant created.
  const artifacts = media?.artifacts ?? [];
  if (artifacts.length) {
    kinds.push({ kind: 'artifact', count: artifacts.length, items: artifacts });
  }

  // Link-heavy text (don't double-count those inside code fences)
  const textOutsideFences = text.replace(FENCE_RE, '');
  const links = collectLinks(textOutsideFences);
  if (links.length >= 3) {
    kinds.push({ kind: 'links', count: links.length, items: links.slice(0, MAX_LINKS) });
  }

  return kinds;
}

/** Returns the (display-friendly) language tag of the first code fence, if any. */
export function firstCodeLanguage(kinds: ContentKind[]): string | undefined {
  const code = kinds.find((k) => k.kind === 'code');
  return code && code.kind === 'code' ? code.language : undefined;
}

/** First few meaningful lines of a code body, each clamped for display. */
function codeSnippet(body: string): string {
  const out: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
    if (!line.trim()) continue;
    out.push(truncate(line, SNIPPET_LINE_LEN));
    if (out.length >= SNIPPET_LINES) break;
  }
  return out.join('\n');
}

/** Scans for the first run of ≥2 pipe-bounded lines and summarizes it. */
function findFirstTable(lines: string[]): Extract<ContentKind, { kind: 'table' }> | null {
  let run: string[] = [];
  for (const line of lines) {
    if (TABLE_LINE_RE.test(line)) {
      run.push(line);
    } else {
      if (run.length >= 2) break;
      run = [];
    }
  }
  if (run.length < 2) return null;

  const dataRows = run.filter((l) => !isSeparatorRow(l));
  const headerLine = dataRows[0] ?? run[0]!;
  const headers = splitCells(headerLine);
  // rowCount = body rows (exclude the header row itself).
  const rowCount = Math.max(0, dataRows.length - 1);
  return { kind: 'table', rowCount, colCount: headers.length, headers };
}

function isSeparatorRow(line: string): boolean {
  return line.includes('-') && /^[\s|:\-]+$/.test(line.trim());
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function collectLinks(text: string): LinkItem[] {
  const items: LinkItem[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const url = m[2]!;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ text: truncate(m[1]!.trim(), 48) || hostOf(url), url });
  }

  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    const url = m[1]!;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ text: hostOf(url), url });
  }

  return items;
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/\s]+)/i);
  return m?.[1]?.replace(/^www\./, '') ?? url;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
