import { useLayoutEffect, useRef, useState } from 'react';
import type { WidgetRef } from '../tree/contentKinds';
import { usePlatformUI } from './platformUI';
import { svgDataUri, widgetSrcDoc } from './widgetRender';

/** What a hover preview can show: a tool widget, a full-size image, or a live
 *  Claude HTML artifact (rendered in a sandboxed iframe, scripts disabled). */
export type PreviewItem =
  | { kind: 'widget'; widget: WidgetRef }
  | { kind: 'image'; src: string; title?: string }
  | { kind: 'html'; html: string; title?: string };

export type HoverPreviewProps = {
  item: PreviewItem;
  anchor: DOMRect;
};

/**
 * Enlarged preview shown while hovering a node's thumbnail. Images render as an
 * <img>; SVG widgets render as an <img> (cheap, isolated); arbitrary HTML
 * widgets render in a sandboxed iframe with scripts disabled.
 */
export function HoverPreview({ item, anchor }: HoverPreviewProps) {
  const { fitHoverImage } = usePlatformUI();
  // Platforms with large/portrait images fit the image to the viewport instead of
  // cropping it in the fixed-size box. Only images; widgets keep the box below.
  if (fitHoverImage && item.kind === 'image') {
    return <FitImageHover src={item.src} title={item.title} anchor={anchor} />;
  }

  const PAD = 8;
  const W = 460;
  const left = Math.min(window.innerWidth - W - PAD, anchor.right + PAD);
  const top = Math.min(window.innerHeight - 380, anchor.top);

  let body: JSX.Element;
  let title: string | undefined;
  if (item.kind === 'image') {
    title = item.title;
    body = <img className="cg-wpreview-img" src={item.src} alt={item.title || 'image'} />;
  } else if (item.kind === 'html') {
    // Live HTML artifact, scripts disabled — a quick static peek; the click
    // preview enables scripts for the full interactive page.
    title = item.title;
    body = <iframe className="cg-wpreview-frame" sandbox="" srcDoc={item.html} title={item.title || 'HTML preview'} />;
  } else if (item.widget.isSvg) {
    title = item.widget.title;
    body = <img className="cg-wpreview-img" src={svgDataUri(item.widget.code)} alt={item.widget.title || 'visualization'} />;
  } else {
    title = item.widget.title;
    body = (
      <iframe className="cg-wpreview-frame" sandbox="" srcDoc={widgetSrcDoc(item.widget.code)} title={item.widget.title || 'visualization'} />
    );
  }

  return (
    <div className="cg-wpreview" style={{ left, top, width: W }}>
      {title && <div className="cg-wpreview-title">{title}</div>}
      {body}
    </div>
  );
}

/**
 * Image hover positioned by quadrant: it opens AWAY from the thumbnail toward the
 * larger free space, so a thumbnail in the bottom-right corner shows its preview
 * up-and-to-the-left instead of running off the screen. The box is measured after
 * render — and again once the image loads (its size then changes) — and clamped to
 * the viewport so no edge is cut. The image is only capped to the viewport (via
 * CSS) so a very large one still fits whole; otherwise it shows at natural size.
 */
function FitImageHover({ src, title, anchor }: { src: string; title?: string; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const PAD = 12;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { width: w, height: h } = el.getBoundingClientRect();
      // Open toward the side/half with more room (away from the nearest edges).
      const openLeft = anchor.left + anchor.width / 2 > vw / 2;
      const openUp = anchor.top + anchor.height / 2 > vh / 2;
      let left = openLeft ? anchor.left - PAD - w : anchor.right + PAD;
      let top = openUp ? anchor.bottom - h : anchor.top;
      left = Math.max(PAD, Math.min(left, vw - w - PAD));
      top = Math.max(PAD, Math.min(top, vh - h - PAD));
      setPos({ left, top });
    };
    place();
    const img = el.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load', place, { once: true });
      return () => img.removeEventListener('load', place);
    }
    return;
  }, [anchor, src]);

  // Render off-screen until measured, so it never flashes at the wrong spot.
  return (
    <div
      ref={ref}
      className="cg-wpreview cg-wpreview-fit"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {title && <div className="cg-wpreview-title">{title}</div>}
      <img className="cg-wpreview-img" src={src} alt={title || 'image'} />
    </div>
  );
}
