import type { DisplayNode } from './displayTree';

/**
 * One navigable match. A node contributes ONE entry per occurrence of the query
 * in its body text (so the stepper can center each in turn), or — when the query
 * is only in non-body content (artifact / file / widget, which has no in-preview
 * position) — a single entry. `id` mirrors `node.id` for Set membership in the
 * graph-highlight layer; `occurrence` is the 0-based index of this hit among the
 * node's body occurrences (0 for a body-less / broad-scope match). */
export type SearchMatch = { id: string; node: DisplayNode; occurrence: number };

/**
 * All searchable text for one node, concatenated. Covers far more than the
 * collapsed snippet shown on the card:
 *   - `fullText` — the message prose AND any inline code fences (already inline here).
 *   - the rich content carried in `preview.kinds`: generated artifacts/documents,
 *     uploaded-file extracted text, widget source, image names, and link text/URLs.
 * `code`/`list`/`table` kinds add nothing — their full text is already in `fullText`
 * (those kinds only hold truncated display snippets).
 */
export function nodeSearchText(node: DisplayNode): string {
  const parts: string[] = [node.fullText];
  for (const k of node.preview.kinds) {
    switch (k.kind) {
      case 'artifact':
        for (const a of k.items) parts.push(a.name, a.content ?? '');
        break;
      case 'attachment':
        for (const f of k.files) parts.push(f.name, f.content ?? '');
        break;
      case 'widget':
        for (const w of k.widgets) parts.push(w.title ?? '', w.code);
        break;
      case 'image':
        for (const img of k.images) if (img.name) parts.push(img.name);
        break;
      case 'links':
        for (const l of k.items) parts.push(l.text, l.url);
        break;
    }
  }
  return parts.join('\n');
}

// Per-node lowercased text, memoized so repeated keystrokes don't re-process
// large bodies. Keyed on the node object, which is recreated whenever the tree is
// rebuilt — so the caches self-invalidate and old trees are garbage-collected.
// `lowerSearch` is the full searchable text (body + broad scope); `lowerBody` is
// just the message prose (what the in-preview highlighter can actually locate).
const lowerSearchCache = new WeakMap<DisplayNode, string>();
const lowerBodyCache = new WeakMap<DisplayNode, string>();

function lowerSearchText(node: DisplayNode): string {
  let v = lowerSearchCache.get(node);
  if (v === undefined) {
    v = nodeSearchText(node).toLowerCase();
    lowerSearchCache.set(node, v);
  }
  return v;
}

function lowerBodyText(node: DisplayNode): string {
  let v = lowerBodyCache.get(node);
  if (v === undefined) {
    v = node.fullText.toLowerCase();
    lowerBodyCache.set(node, v);
  }
  return v;
}

/** Count non-overlapping occurrences of `needle` (already lowercased) in `hay`. */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) count++;
  return count;
}

/**
 * Case-insensitive substring search across every node in every branch. Returns
 * matches in the input order (the graph's top-to-bottom DFS order), so stepping
 * prev/next walks the tree intuitively. An empty/whitespace query matches nothing.
 *
 * Each occurrence of the query in a node's BODY prose is its own match (so the
 * stepper can center each one in the preview). A node whose query only appears in
 * non-body content — a generated artifact, an uploaded file, or widget source,
 * none of which have a position the in-preview highlighter can scroll to —
 * contributes a SINGLE match. Question and answer nodes are not deduped.
 */
export function searchNodes(nodes: DisplayNode[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchMatch[] = [];
  for (const node of nodes) {
    const bodyCount = countOccurrences(lowerBodyText(node), q);
    if (bodyCount > 0) {
      for (let i = 0; i < bodyCount; i++) out.push({ id: node.id, node, occurrence: i });
    } else if (lowerSearchText(node).includes(q)) {
      out.push({ id: node.id, node, occurrence: 0 });
    }
  }
  return out;
}
