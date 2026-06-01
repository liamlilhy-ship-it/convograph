import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge, ReactFlowProvider } from '@xyflow/react';
import type { DisplayTree, DisplayNode } from '../tree/displayTree';
import { layoutTree, type LayoutDirection } from '../tree/layout';
import { NodeCard } from './NodeCard';
import { HoverPreview } from './HoverPreview';

type CgNodeData = {
  node: DisplayNode;
  jumping: boolean;
  onHoverStart: (n: DisplayNode, r: DOMRect) => void;
  onHoverEnd: () => void;
  onClick: (n: DisplayNode) => void;
};

const NODE_TYPES = {
  cgNode: ({ data }: { data: CgNodeData }) => (
    <NodeCard
      node={data.node}
      jumping={data.jumping}
      onHoverStart={data.onHoverStart}
      onHoverEnd={data.onHoverEnd}
      onClick={data.onClick}
    />
  ),
};

export type GraphCanvasProps = {
  tree: DisplayTree;
  direction?: LayoutDirection;
  onNodeClick: (node: DisplayNode) => void;
  jumpingId?: string | null;
};

export function GraphCanvas({ tree, direction = 'TB', onNodeClick, jumpingId }: GraphCanvasProps) {
  const [hover, setHover] = useState<{ node: DisplayNode; anchor: DOMRect } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  // When the tree identity changes (chat switch, refetch), drop any stale hover.
  useEffect(() => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(null);
  }, [tree]);

  const handleHoverStart = useCallback((node: DisplayNode, anchor: DOMRect) => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    hoverTimer.current = window.setTimeout(() => setHover({ node, anchor }), 220);
  }, []);
  const handleHoverEnd = useCallback(() => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(null);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const { nodes: laid, edges } = layoutTree(tree.orderedNodes, { direction });
    const activeSet = new Set(tree.activePath);
    const rfNodes: Node[] = laid.map((n) => ({
      id: n.id,
      type: 'cgNode',
      position: { x: n.x, y: n.y },
      data: {
        node: n,
        jumping: jumpingId === n.id,
        onHoverStart: handleHoverStart,
        onHoverEnd: handleHoverEnd,
        onClick: onNodeClick,
      },
      draggable: false,
      selectable: false,
    }));
    const rfEdges: Edge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { active: activeSet.has(e.source) && activeSet.has(e.target) },
      ...(activeSet.has(e.source) && activeSet.has(e.target)
        ? { className: 'cg-edge-active', style: { stroke: 'var(--cg-accent)', strokeWidth: 2 } }
        : { style: { stroke: 'var(--cg-border-strong)', strokeWidth: 1.5 } }),
      type: 'smoothstep',
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [tree, direction, jumpingId, handleHoverStart, handleHoverEnd, onNodeClick]);

  return (
    <div className="cg-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="var(--cg-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      {hover && <HoverPreview node={hover.node} anchor={hover.anchor} />}
    </div>
  );
}
