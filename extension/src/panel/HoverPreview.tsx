import type { DisplayNode } from '../tree/displayTree';

export type HoverPreviewProps = {
  node: DisplayNode;
  anchor: DOMRect;
};

export function HoverPreview({ node, anchor }: HoverPreviewProps) {
  const PAD = 8;
  const left = Math.min(window.innerWidth - 420, anchor.right + PAD);
  const top = Math.min(window.innerHeight - 420, anchor.top);
  return (
    <div className="cg-preview" style={{ left, top }}>
      <div className="cg-preview-label">You</div>
      <div className="cg-preview-body">
        {node.humanFullText || <em style={{ opacity: 0.55 }}>(no text)</em>}
      </div>
      <div className="cg-preview-divider" />
      <div className="cg-preview-label">Claude</div>
      <div className="cg-preview-body">
        {node.assistantId == null ? (
          <em style={{ opacity: 0.55 }}>awaiting response…</em>
        ) : (
          node.assistantFullText || <em style={{ opacity: 0.55 }}>(no text)</em>
        )}
      </div>
    </div>
  );
}
