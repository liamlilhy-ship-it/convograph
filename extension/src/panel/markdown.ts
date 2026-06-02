import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
