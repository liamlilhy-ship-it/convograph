import type { DisplayNode } from './displayTree';

/** A node whose searchable text contains the query. `id` mirrors `node.id` for
 *  convenient Set membership in the graph-highlight layer. */
export type SearchMatch = { id: string; node: DisplayNode };

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

// Per-node lowercased search text, memoized so repeated keystrokes don't
// re-concatenate large artifact/file bodies. Keyed on the node object, which is
// recreated whenever the tree is rebuilt — so the cache self-invalidates and old
// trees are garbage-collected.
const lowerCache = new WeakMap<DisplayNode, string>();

function lowerSearchText(node: DisplayNode): string {
  let v = lowerCache.get(node);
  if (v === undefined) {
    v = nodeSearchText(node).toLowerCase();
    lowerCache.set(node, v);
  }
  return v;
}

/**
 * Case-insensitive substring search across every node in every branch. Returns
 * matches in the input order (which is the graph's top-to-bottom DFS order), so
 * stepping prev/next walks the tree intuitively. An empty/whitespace query
 * matches nothing. Question and answer nodes are NOT deduped — each is a distinct
 * card the user may want to visit.
 */
export function searchNodes(nodes: DisplayNode[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchMatch[] = [];
  for (const node of nodes) {
    if (lowerSearchText(node).includes(q)) out.push({ id: node.id, node });
  }
  return out;
}
