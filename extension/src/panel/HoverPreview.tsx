import type { WidgetRef } from '../tree/contentKinds';
import { svgDataUri, widgetSrcDoc } from './widgetRender';

/** What a hover preview can show: a tool widget, or a full-size image. */
export type PreviewItem =
  | { kind: 'widget'; widget: WidgetRef }
  | { kind: 'image'; src: string; title?: string };

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
  const PAD = 8;
  const W = 460;
  const left = Math.min(window.innerWidth - W - PAD, anchor.right + PAD);
  const top = Math.min(window.innerHeight - 380, anchor.top);

  let body: JSX.Element;
  let title: string | undefined;
  if (item.kind === 'image') {
    title = item.title;
    body = <img className="cg-wpreview-img" src={item.src} alt={item.title || 'image'} />;
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
