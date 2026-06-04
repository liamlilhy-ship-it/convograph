import { useState, useCallback, useMemo, type ReactNode } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import type { ImageRef, WidgetRef, FileRef } from '../tree/contentKinds';
import { FullPreview } from './FullPreview';
import { renderMarkdown } from './markdown';
import { svgDataUri, widgetSrcDoc } from './widgetRender';
import { UserIcon, ClaudeIcon, FileIcon, ImageIcon, AttachmentIcon } from './icons';

/** A generated document (Artifacts feature) opened in its own window. Carries the
 *  full inline text so it renders without touching claude's native preview. */
export type ArtifactView = { id: string; title: string; type?: string; content: string };

/** What a floating preview window shows. A node or markdown document renders text;
 *  an image / widget / uploaded file each render their own way. */
export type PreviewContent =
  | { kind: 'node'; node: DisplayNode }
  | { kind: 'artifact'; artifact: ArtifactView }
  | { kind: 'image'; image: ImageRef }
  | { kind: 'widget'; widget: WidgetRef }
  | { kind: 'file'; file: FileRef };

export type Geometry = { x: number; y: number; w: number; h: number };

/** One open floating preview window: its content plus window geometry. Stacking is
 *  by array order (focus moves a window to the end), so no per-window z is needed —
 *  all windows share one z just above the side panel. The `key` (node.id, or
 *  `<kind>:<id>`) dedupes: reopening focuses instead of duplicating. */
export type OpenPreview = { key: string } & PreviewContent & Geometry;

const MIN_W = 320;
const MIN_H = 200;
// One above the side panel (2147483645), one below the hover preview (…647).
const PV_Z = 2147483646;
// Preview markdown font size (px). Shared across all windows so adjusting it in
// one applies everywhere — including windows opened afterward.
export const DEFAULT_FS = 18;
const MIN_FS = 12;
const MAX_FS = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type PreviewLayerProps = {
  previews: OpenPreview[];
  fontPx: number;
  onFontPx: (next: number) => void;
  onClose: (key: string) => void;
  onFocus: (key: string) => void;
  onGeometry: (key: string, geo: Geometry) => void;
};

/** Renders all open preview windows over the page (children of the pointer-events:none
 *  root; each window re-enables pointer events). */
export function PreviewLayer({ previews, fontPx, onFontPx, onClose, onFocus, onGeometry }: PreviewLayerProps) {
  return (
    <>
      {previews.map((pv) => (
        <PreviewWindow
          key={pv.key}
          pv={pv}
          fontPx={fontPx}
          onFontPx={onFontPx}
          onClose={onClose}
          onFocus={onFocus}
          onGeometry={onGeometry}
        />
      ))}
    </>
  );
}

function PreviewWindow({
  pv,
  fontPx,
  onFontPx,
  onClose,
  onFocus,
  onGeometry,
}: {
  pv: OpenPreview;
  fontPx: number;
  onFontPx: (next: number) => void;
  onClose: (key: string) => void;
  onFocus: (key: string) => void;
  onGeometry: (key: string, geo: Geometry) => void;
}) {
  const { key, x, y, w, h } = pv;
  // While dragging/resizing we lay a full-viewport mask so the cursor can't fall
  // into a preview's <iframe> (which would swallow the mousemove and freeze the drag).
  const [active, setActive] = useState<null | 'move' | 'resize'>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onFocus(key);
      setActive('move');
      const startX = e.clientX;
      const startY = e.clientY;
      const ox = x;
      const oy = y;
      const onMove = (ev: MouseEvent) => {
        const nx = clamp(ox + (ev.clientX - startX), 0, window.innerWidth - 80);
        const ny = clamp(oy + (ev.clientY - startY), 0, window.innerHeight - 40);
        onGeometry(key, { x: nx, y: ny, w, h });
      };
      const onUp = () => {
        setActive(null);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [key, x, y, w, h, onFocus, onGeometry],
  );

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(key);
      setActive('resize');
      const startX = e.clientX;
      const startY = e.clientY;
      const ow = w;
      const oh = h;
      const onMove = (ev: MouseEvent) => {
        const nw = clamp(ow + (ev.clientX - startX), MIN_W, window.innerWidth);
        const nh = clamp(oh + (ev.clientY - startY), MIN_H, window.innerHeight);
        onGeometry(key, { x, y, w: nw, h: nh });
      };
      const onUp = () => {
        setActive(null);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [key, x, y, w, h, onFocus, onGeometry],
  );

  const { icon, title, body, showFontCtl } = renderParts(pv);

  return (
    <>
      <div
        className="cg-pv-window"
        style={{ left: x, top: y, width: w, height: h, zIndex: PV_Z, ['--cg-pv-fs' as never]: `${fontPx}px` }}
        onMouseDown={() => onFocus(key)}
      >
        <div className="cg-pv-head" onMouseDown={startDrag}>
          <span className="cg-pv-role-dot">{icon}</span>
          <span className="cg-pv-title">{title}</span>
          {showFontCtl && (
            <div className="cg-pv-fontctl" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="cg-pv-fbtn"
                title="Decrease font size"
                aria-label="Decrease font size"
                disabled={fontPx <= MIN_FS}
                onClick={() => onFontPx(Math.max(MIN_FS, fontPx - 1))}
              >
                A−
              </button>
              <button
                type="button"
                className="cg-pv-fbtn"
                title="Increase font size"
                aria-label="Increase font size"
                disabled={fontPx >= MAX_FS}
                onClick={() => onFontPx(Math.min(MAX_FS, fontPx + 1))}
              >
                A+
              </button>
            </div>
          )}
          <button
            type="button"
            className="cg-pv-close"
            title="Close preview"
            aria-label="Close preview"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onClose(key)}
          >
            ✕
          </button>
        </div>
        <div className="cg-pv-body">{body}</div>
        <div
          className="cg-pv-resize"
          title="Drag to resize"
          onMouseDown={startResize}
        />
      </div>
      {active && (
        <div
          className="cg-pv-dragmask"
          style={{ cursor: active === 'move' ? 'grabbing' : 'nwse-resize' }}
        />
      )}
    </>
  );
}

/** Picks the header icon + title, the body element, and whether the A−/A+ font
 *  controls apply (text-bearing content only) for a window. */
function renderParts(pv: OpenPreview): {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  showFontCtl: boolean;
} {
  switch (pv.kind) {
    case 'node': {
      const isHuman = pv.node.role === 'human';
      return {
        icon: isHuman ? <UserIcon size={11} /> : <ClaudeIcon size={11} />,
        title: pv.node.preview.title || (isHuman ? 'Question' : 'Answer'),
        body: <FullPreview node={pv.node} />,
        showFontCtl: true,
      };
    }
    case 'artifact':
      return {
        icon: <FileIcon size={11} />,
        title: pv.artifact.title,
        body: <ArtifactPreview artifact={pv.artifact} />,
        showFontCtl: true,
      };
    case 'file':
      return {
        icon: <AttachmentIcon size={11} />,
        title: pv.file.name,
        body: <FilePreview file={pv.file} />,
        showFontCtl: true,
      };
    case 'image':
      return {
        icon: <ImageIcon size={11} />,
        title: pv.image.name || 'Image',
        body: <ImagePreview image={pv.image} />,
        showFontCtl: false,
      };
    case 'widget':
      return {
        icon: <ImageIcon size={11} />,
        title: pv.widget.title || 'Visualization',
        body: <WidgetPreview widget={pv.widget} />,
        showFontCtl: false,
      };
  }
}

/** A large, scrollable image. The header keeps an "open original" link for
 *  full-resolution / right-click-save. */
function ImagePreview({ image }: { image: ImageRef }) {
  const src = image.fullUrl || image.thumbUrl;
  return (
    <div className="cg-pv-content cg-pv-media">
      <div className="cg-pv-imgview">
        <img src={src} alt={image.name || ''} />
      </div>
      <a className="cg-pv-openlink" href={src} target="_blank" rel="noreferrer noopener">
        Open original ↗
      </a>
    </div>
  );
}

/** A tool-rendered visualization: SVG as an <img> (cheap), arbitrary HTML in a
 *  sandboxed <iframe> (same treatment as the in-node hover/full preview). */
function WidgetPreview({ widget }: { widget: WidgetRef }) {
  return (
    <div className="cg-pv-content cg-pv-media">
      {widget.isSvg ? (
        <img className="cg-pv-widget-img" src={svgDataUri(widget.code)} alt={widget.title || 'visualization'} />
      ) : (
        <iframe
          className="cg-pv-widget-frame"
          sandbox="allow-scripts"
          srcDoc={widgetSrcDoc(widget.code)}
          title={widget.title || 'visualization'}
        />
      )}
    </div>
  );
}

/** An uploaded file: the text claude.ai extracted from it (selectable, pre-wrapped
 *  — shown verbatim, not re-rendered as markdown), plus an "open original" link
 *  when the file has a URL. */
function FilePreview({ file }: { file: FileRef }) {
  return (
    <div className="cg-pv-content">
      <div className="cg-pv-role">
        <AttachmentIcon size={12} />
        {file.type ? file.type.toUpperCase() : 'File'}
      </div>
      {file.content ? (
        <div className="cg-pv-text">{file.content}</div>
      ) : (
        <div className="cg-pv-empty">
          <ImageIcon size={20} />
          <span>No extracted text for this file.</span>
        </div>
      )}
      {file.url && (
        <a className="cg-pv-openlink" href={file.url} target="_blank" rel="noreferrer noopener">
          Open original ↗
        </a>
      )}
    </div>
  );
}

/** Renders a generated document's inline text as markdown — same `.cg-pv-md`
 *  treatment (and A−/A+ font scaling) as a node's full preview. */
function ArtifactPreview({ artifact }: { artifact: ArtifactView }) {
  const html = useMemo(() => renderMarkdown(artifact.content), [artifact.content]);
  return (
    <div className="cg-pv-content">
      <div className="cg-pv-role">
        <FileIcon size={12} />
        {artifact.type ? artifact.type.toUpperCase() : 'Document'}
      </div>
      <div className="cg-pv-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
