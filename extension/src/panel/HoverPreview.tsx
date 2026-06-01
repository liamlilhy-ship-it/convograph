import type { WidgetRef } from '../tree/contentKinds';

/** What a hover preview can show: a tool widget, or a full-size image. */
export type PreviewItem =
  | { kind: 'widget'; widget: WidgetRef }
  | { kind: 'image'; src: string; title?: string };

export type HoverPreviewProps = {
  item: PreviewItem;
  anchor: DOMRect;
};

/**
 * claude.ai's diagram SVGs color themselves with bare class names (.c-blue,
 * .th, .arr, …) defined by the widget host's stylesheet, which a standalone
 * <img>-loaded SVG can't reach — so every shape falls back to default black
 * fill. We inject a <style> mapping those classes to Claude's light palette so
 * the diagram is legible on its own. Palette hexes are taken from this app's
 * own widgets (pale fill + dark accent pairs).
 */
const SVG_CLASS_CSS =
  'text{fill:#1a1915;font-family:"Anthropic Sans",ui-sans-serif,system-ui,sans-serif}' +
  '.ts{fill:#6b6862}.th{fill:#1a1915;font-weight:600}.tl{fill:#8a877f}' +
  '.arr{stroke:#8a877f;fill:none}line{stroke:#8a877f}path{stroke:#8a877f}' +
  'rect{fill:#f5f4ee;stroke:#d4d1c7}' +
  '.c-gray{fill:#efece4;stroke:#b8b4a8}.c-blue{fill:#e6f1fb;stroke:#0c447c}.c-coral{fill:#faece7;stroke:#993c1d}' +
  '.c-amber{fill:#faeeda;stroke:#854f0b}.c-teal{fill:#d9f0e8;stroke:#04342c}.c-purple{fill:#f0eafb;stroke:#5b3a8c}' +
  '.c-green{fill:#e4f2dd;stroke:#2f5a1e}.c-red{fill:#fbe4e4;stroke:#841414}.c-orange{fill:#fcead9;stroke:#8a4b0b}';

/** Inline SVG markup as an <img>-safe data URI (scripts never run in this context). */
export function svgDataUri(svg: string): string {
  const styled = svg.replace(/<svg([^>]*)>/, `<svg$1><style>${SVG_CLASS_CSS}</style>`);
  return `data:image/svg+xml;utf8,${encodeURIComponent(styled)}`;
}

/**
 * HTML widgets style themselves with claude.ai's design tokens (--color-*,
 * --font-*, --border-radius-*), which a bare sandboxed iframe doesn't inherit —
 * so undefined `var()`s collapse to black text on transparent. We re-declare
 * those tokens with light-theme values and force a white surface so the widget
 * is legible regardless of the user's claude.ai theme.
 */
const WIDGET_TOKENS_CSS = `
:root{
  --font-sans:"Anthropic Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --font-mono:"Anthropic Mono",ui-monospace,monospace;
  --color-text-primary:#1a1915;--color-text-secondary:#6b6862;--color-text-tertiary:#8a877f;
  --color-background-primary:#ffffff;--color-background-secondary:#f5f4ee;--color-background-tertiary:#ecebe3;
  --color-border-primary:#d4d1c7;--color-border-secondary:#e5e2d9;--color-border-tertiary:#efece4;
  --border-radius-sm:6px;--border-radius-md:8px;--border-radius-lg:12px;
}
html,body{margin:0;background:#fff;color:var(--color-text-primary);font-family:var(--font-sans);}
body{padding:8px;}
`;

function widgetSrcDoc(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_TOKENS_CSS}</style></head><body>${code}</body></html>`;
}

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
