import type { CSSProperties } from 'react';
import type { TreeNode } from '../tree/buildTree';

export type NodeCardProps = {
  node: TreeNode;
  onHoverStart: (node: TreeNode, rect: DOMRect) => void;
  onHoverEnd: () => void;
  onClick: (node: TreeNode) => void;
  style?: CSSProperties;
};

export function NodeCard({ node, onHoverStart, onHoverEnd, onClick, style }: NodeCardProps) {
  return (
    <div
      className="cg-node"
      data-sender={node.sender}
      data-active={node.isOnActivePath ? 'true' : 'false'}
      style={style}
      onMouseEnter={(e) => onHoverStart(node, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      onMouseLeave={onHoverEnd}
      onClick={() => onClick(node)}
    >
      <div className="cg-row">
        <span className="cg-tag">{node.sender === 'human' ? 'You' : 'Claude'}</span>
        {node.siblingCount > 1 && (
          <span className="cg-pip" title="Sibling branches">
            {node.siblingIndex + 1}/{node.siblingCount}
          </span>
        )}
      </div>
      <div className="cg-snippet">{node.snippet || <em style={{ opacity: 0.55 }}>(empty)</em>}</div>
    </div>
  );
}
