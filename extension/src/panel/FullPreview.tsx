import { useEffect, useMemo, useRef } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import type { ContentKind, ImageRef, ArtifactRef, FileRef } from '../tree/contentKinds';
import type { NodePreview } from '../tree/preview';
import { renderMarkdown, renderMarkdownWithCitations } from './markdown';
import { svgDataUri, widgetSrcDoc } from './widgetRender';
import { UserIcon, FileIcon, AttachmentIcon, ImageIcon } from './icons';
import { usePlatformUI } from './platformUI';
import type { FooterItem } from './NodeCard';

/** Unwrap any search-highlight marks, restoring the original text runs. */
function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll('mark.cg-search-hit').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

/** Wrap every occurrence of `q` (already lowercased) in `el` with a highlight
 *  mark, appending each to `marks` (in document order). Only called on `.cg-pv-md`
 *  blocks — which React renders via dangerouslySetInnerHTML and treats as opaque —
 *  so mutating their DOM doesn't fight React's reconciliation. */
function highlightIn(el: HTMLElement, q: string, marks: HTMLElement[]): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const tn of texts) {
    const s = tn.nodeValue ?? '';
    const lower = s.toLowerCase();
    if (!lower.includes(q)) continue;
    const frag = document.createDocumentFragment();
    let cur = 0;
    for (let idx = lower.indexOf(q); idx >= 0; idx = lower.indexOf(q, cur)) {
      if (idx > cur) frag.appendChild(document.createTextNode(s.slice(cur, idx)));
      const mark = document.createElement('mark');
      mark.className = 'cg-search-hit';
      mark.textContent = s.slice(idx, idx + q.length);
      frag.appendChild(mark);
      marks.push(mark);
      cur = idx + q.length;
    }
    if (cur < s.length) frag.appendChild(document.createTextNode(s.slice(cur)));
    tn.parentNode?.replaceChild(frag, tn);
  }
}

/** Typed lookup for the (at most one) kind of a given tag in a preview. */
function kindOf<K extends ContentKind['kind']>(
  p: NodePreview,
  kind: K,
): Extract<ContentKind, { kind: K }> | undefined {
  return p.kinds.find((k) => k.kind === kind) as Extract<ContentKind, { kind: K }> | undefined;
}

/**
 * Full, scrollable rendering of a single node's content — the complete message
 * markdown plus every image, widget (MCP rendering), and a list of generated
 * artifacts. Sourced entirely from data already on the DisplayNode, so it works
 * for any node regardless of whether it's on the active branch. All text is real,
 * selectable DOM (copy-pasteable).
 */
export function FullPreview({
  node,
  onOpenMedia,
  highlightQuery,
  currentOccurrence,
}: {
  node: DisplayNode;
  /** Open a clickable generated document (artifact with inline content) in a
   *  floating window — keeps artifacts clickable in the preview states, matching
   *  the collapsed node footer. */
  onOpenMedia?: (item: FooterItem) => void;
  /** When set, highlight occurrences of this query in the message body. */
  highlightQuery?: string;
  /** On the current search match: which highlighted occurrence to emphasize and
   *  scroll into view. Undefined on non-current cards (highlight only, no scroll). */
  currentOccurrence?: number;
}) {
  const { assistantLabel, AssistantIcon } = usePlatformUI();
  const contentRef = useRef<HTMLDivElement>(null);
  const isHuman = node.role === 'human';
  const p = node.preview;

  // Render the body in original document order: text runs as markdown, widgets in
  // place. Markdown parsing is memoized so dragging the window doesn't reparse.
  const body = useMemo(
    () =>
      node.body.map((b) =>
        b.kind === 'md'
          ? {
              kind: 'md' as const,
              html: b.citations?.length
                ? renderMarkdownWithCitations(b.text, b.citations)
                : renderMarkdown(b.text),
            }
          : b,
      ),
    [node.body],
  );

  const images: ImageRef[] = kindOf(p, 'image')?.images ?? [];
  const artifacts: ArtifactRef[] = kindOf(p, 'artifact')?.items ?? [];
  const files: FileRef[] = kindOf(p, 'attachment')?.files ?? [];

  const empty = body.length === 0 && !images.length && !artifacts.length && !files.length;

  // Highlight every occurrence of the query in the rendered markdown. On the
  // current match, emphasize the active occurrence and scroll it into view —
  // scrolling ONLY the preview container (never the underlying chat page), with a
  // correction for the canvas zoom transform.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    clearHighlights(root);
    const q = (highlightQuery ?? '').trim().toLowerCase();
    if (!q) return;
    const marks: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>('.cg-pv-md').forEach((el) => highlightIn(el, q, marks));
    if (currentOccurrence != null && marks.length) {
      const target = marks[Math.min(currentOccurrence, marks.length - 1)]!;
      target.setAttribute('data-current', 'true');
      const container = root.closest('.cg-node-pv-body') as HTMLElement | null;
      if (container) {
        const cRect = container.getBoundingClientRect();
        const mRect = target.getBoundingClientRect();
        // getBoundingClientRect is post-zoom; scrollTop is content px. Convert.
        const scale = target.offsetHeight ? mRect.height / target.offsetHeight : 1;
        const deltaClient = mRect.top - cRect.top - cRect.height / 2 + mRect.height / 2;
        container.scrollTo({ top: container.scrollTop + deltaClient / (scale || 1), behavior: 'smooth' });
      }
    }
    return () => {
      if (contentRef.current) clearHighlights(contentRef.current);
    };
  }, [highlightQuery, currentOccurrence, body]);

  return (
    <div className="cg-pv-content" ref={contentRef}>
      <div className="cg-pv-role">
        {isHuman ? <UserIcon size={12} /> : <AssistantIcon size={12} />}
        {isHuman ? 'You' : assistantLabel}
      </div>

      {/* On an answer, show its originating question for context. */}
      {!isHuman && node.questionText && (
        <div className="cg-pv-qcontext">
          <span className="cg-pv-qlabel">Question</span>
          <div className="cg-pv-qtext">{node.questionText}</div>
        </div>
      )}

      {body.map((b, i) =>
        b.kind === 'md' ? (
          <div key={i} className="cg-pv-md" dangerouslySetInnerHTML={{ __html: b.html }} />
        ) : b.widget.isSvg ? (
          <img
            key={i}
            className="cg-pv-widget-img"
            src={svgDataUri(b.widget.code)}
            alt={b.widget.title || 'visualization'}
            loading="lazy"
          />
        ) : (
          <iframe
            key={i}
            className="cg-pv-widget-frame"
            sandbox="allow-scripts"
            srcDoc={widgetSrcDoc(b.widget.code)}
            title={b.widget.title || 'visualization'}
          />
        ),
      )}

      {images.length > 0 && (
        <div className="cg-pv-images">
          {images.map((im, i) => {
            const src = im.fullUrl || im.thumbUrl;
            return (
              <a
                key={i}
                className="cg-pv-image"
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                title={onOpenMedia ? `Open ${im.name || 'image'}` : im.name || 'image'}
                // Plain click → floating image preview (matches the node footer);
                // cmd/ctrl/shift-click falls through to opening the original in a tab.
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.metaKey || e.ctrlKey || e.shiftKey || !onOpenMedia) return;
                  e.preventDefault();
                  onOpenMedia({ kind: 'image', image: im });
                }}
              >
                <img src={src} alt={im.name || ''} loading="lazy" />
              </a>
            );
          })}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="cg-pv-section">
          <div className="cg-pv-section-label">Generated files</div>
          <div className="cg-artifacts">
            {artifacts.map((af, i) => {
              const clickable = !!(af.content && onOpenMedia);
              return (
                <div
                  key={i}
                  className="cg-artifact"
                  data-clickable={clickable ? 'true' : undefined}
                  title={clickable ? `Open ${af.name}` : af.name}
                  onClick={
                    clickable
                      ? (e) => {
                          e.stopPropagation();
                          onOpenMedia!({ kind: 'artifact', artifact: af });
                        }
                      : undefined
                  }
                >
                  <FileIcon size={12} />
                  <span className="cg-artifact-name">{af.name}</span>
                  {af.type && <span className="cg-muted cg-artifact-type">{af.type.toUpperCase()}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="cg-pv-section">
          <div className="cg-pv-section-label">Attachments</div>
          <div className="cg-files">
            {files.map((f, i) => {
              const clickable = !!((f.content || f.url) && onOpenMedia);
              return (
                <div
                  key={i}
                  className="cg-file"
                  data-clickable={clickable ? 'true' : undefined}
                  title={clickable ? `Open ${f.name}` : f.name}
                  onClick={
                    clickable
                      ? (e) => {
                          e.stopPropagation();
                          onOpenMedia!({ kind: 'file', file: f });
                        }
                      : undefined
                  }
                >
                  <AttachmentIcon size={12} />
                  <span className="cg-file-name">{f.name}</span>
                  {f.type && <span className="cg-muted cg-file-meta">{f.type.toUpperCase()}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {empty && (
        <div className="cg-pv-empty">
          <ImageIcon size={20} />
          <span>No renderable content for this message.</span>
        </div>
      )}
    </div>
  );
}
