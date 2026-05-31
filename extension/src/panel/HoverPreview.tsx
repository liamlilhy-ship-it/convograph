import type { TreeNode } from '../tree/buildTree';

export type HoverPreviewProps = {
  node: TreeNode;
  anchor: DOMRect;
};

export function HoverPreview({ node, anchor }: HoverPreviewProps) {
  const PAD = 8;
  const left = Math.min(window.innerWidth - 400, anchor.right + PAD);
  const top = Math.min(window.innerHeight - 360, anchor.top);
  return (
    <div className="cg-preview" style={{ left, top }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55, marginBottom: 6 }}>
        {node.sender === 'human' ? 'You' : 'Claude'}
      </div>
      {node.fullText || <em style={{ opacity: 0.55 }}>(no text content)</em>}
    </div>
  );
}
