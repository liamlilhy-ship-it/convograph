import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { BlockCitation } from '../tree/contentKinds';

/**
 * Renders a message's markdown (the full answer/question text) to sanitized HTML
 * for the full preview. marked handles GFM (tables, fenced code, lists); DOMPurify
 * strips any scripts/handlers so the result is safe to inject as real, selectable,
 * copy-pasteable DOM. Links are forced to open in a new tab.
 */

marked.setOptions({ gfm: true });

// Links in answer text should open in a new tab rather than navigate the claude.ai
// tab out from under the user. Version-independent (no renderer-API coupling).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ((node as Element).tagName === 'A') {
    (node as Element).setAttribute('target', '_blank');
    (node as Element).setAttribute('rel', 'noreferrer noopener');
  }
});

export function renderMarkdown(md: string): string {
  const html = marked.parse(md) as string;
  return DOMPurify.sanitize(html);
}

// Private-use sentinels bracket a citation's footnote index in the source text.
// They carry no markdown meaning, so they pass through marked/DOMPurify untouched
// and never collide with real content; the close delimiter keeps `1` from matching
// inside `11`.
const CITE_OPEN = String.fromCharCode(0xe000);
const CITE_CLOSE = String.fromCharCode(0xe001);

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Bare hostname of a URL (sans `www.`), the last-resort chip label. */
function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/\s]+)/i);
  return m?.[1]?.replace(/^www\./, '') ?? url;
}

/**
 * Like {@link renderMarkdown}, but splices an inline reference chip right after
 * each cited phrase — mirroring claude.ai's answer format, where the chip shows the
 * source's site name (e.g. "Ctrip"). Sentinels are inserted at the citation `end`
 * offsets (descending, so earlier offsets stay valid), the text is rendered, then
 * each sentinel is swapped for its chip. The chip HTML is built here (post-sanitize)
 * with escaped attributes/text and explicit target/rel.
 */
export function renderMarkdownWithCitations(md: string, citations: BlockCitation[]): string {
  const ordered = [...citations].sort((a, b) => b.end - a.end);
  let text = md;
  for (let i = 0; i < ordered.length; i++) {
    const pos = Math.max(0, Math.min(ordered[i]!.end, text.length));
    text = text.slice(0, pos) + CITE_OPEN + i + CITE_CLOSE + text.slice(pos);
  }
  let html = renderMarkdown(text);
  for (let i = 0; i < ordered.length; i++) {
    const ref = ordered[i]!.ref;
    const label = ref.siteName || ref.siteDomain || hostOf(ref.url);
    const tip = ref.title && ref.title !== label ? `${label} — ${ref.title}` : label;
    const chip =
      `<span class="cg-cite"><a href="${escapeAttr(ref.url)}" target="_blank"` +
      ` rel="noreferrer noopener" title="${escapeAttr(tip)}">${escapeAttr(label)}</a></span>`;
    html = html.split(CITE_OPEN + i + CITE_CLOSE).join(chip);
  }
  return html;
}
