import { useState, useCallback } from 'react';
import type { DisplayNode } from '../tree/displayTree';
import { FullPreview } from './FullPreview';
import { UserIcon, ClaudeIcon } from './icons';

/** One open floating preview window: the node plus its window geometry. Stacking
 *  is by array order (focus moves a window to the end), so no per-window z is
 *  needed — all windows share one z just above the side panel. */
export type OpenPreview = {
  key: string; // === node.id; reopening the same node focuses instead of duplicating
  node: DisplayNode;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Geometry = { x: number; y: number; w: number; h: number };

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
  const { key, node, x, y, w, h } = pv;
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

  const isHuman = node.role === 'human';
  const title = node.preview.title || (isHuman ? 'Question' : 'Answer');

  return (
    <>
      <div
        className="cg-pv-window"
        style={{ left: x, top: y, width: w, height: h, zIndex: PV_Z, ['--cg-pv-fs' as never]: `${fontPx}px` }}
        onMouseDown={() => onFocus(key)}
      >
        <div className="cg-pv-head" onMouseDown={startDrag}>
          <span className="cg-pv-role-dot">
            {isHuman ? <UserIcon size={11} /> : <ClaudeIcon size={11} />}
          </span>
          <span className="cg-pv-title">{title}</span>
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
        <div className="cg-pv-body">
          <FullPreview node={node} />
        </div>
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
