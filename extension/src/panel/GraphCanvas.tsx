import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  ReactFlowProvider,
} from '@xyflow/react';
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

// Per-node slot size used for layout/bounds (matches layoutTree's defaults).
const NODE_SLOT = 300;
// One node of slack around the graph so panning stops just past the edge
// messages rather than locking exactly to them.
const EXTENT_PAD = 300;

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

  // Minimap surfaces only while the user is moving (pan/zoom), then fades out.
  const [mapVisible, setMapVisible] = useState(false);
  const mapTimer = useRef<number | null>(null);
  const handleMove = useCallback(() => {
    setMapVisible(true);
    if (mapTimer.current != null) clearTimeout(mapTimer.current);
    mapTimer.current = window.setTimeout(() => setMapVisible(false), 1400);
  }, []);
  useEffect(
    () => () => {
      if (mapTimer.current != null) clearTimeout(mapTimer.current);
    },
    [],
  );

  // Active-path nodes pop in the minimap; everything else stays a solid,
  // readable grey (faint alpha tokens vanish at minimap scale).
  const minimapNodeColor = useCallback(
    (n: Node) =>
      (n.data as CgNodeData)?.node?.isOnActivePath
        ? 'var(--cg-accent)'
        : 'var(--cg-minimap-node)',
    [],
  );

  const { nodes, edges, translateExtent } = useMemo(() => {
    const { nodes: laid, edges } = layoutTree(tree.orderedNodes, { direction });
    const activeSet = new Set(tree.activePath);
    const rfNodes: Node[] = laid.map((n) => ({
      id: n.id,
      type: 'cgNode',
      position: { x: n.x, y: n.y },
      // React Flow's auto-measurement doesn't populate `measured` inside our
      // shadow root (cards are sized by CSS instead), which left fitView and the
      // MiniMap with no dimensions — an empty map. Seed explicit fallback dims so
      // both have real bounds to work from.
      initialWidth: 300,
      initialHeight: 240,
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
    // Bound panning to the laid-out graph (+ one screen of slack) so scrolling
    // can't drift off into empty canvas past the first/last message — which is
    // what made the minimap's viewport box wander away and the tree collapse to
    // a sliver. Recomputed here on every tree change, so it grows with the chat.
    let extent: [[number, number], [number, number]] | undefined;
    if (laid.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of laid) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + NODE_SLOT);
        maxY = Math.max(maxY, n.y + NODE_SLOT);
      }
      extent = [
        [minX - EXTENT_PAD, minY - EXTENT_PAD],
        [maxX + EXTENT_PAD, maxY + EXTENT_PAD],
      ];
    }
    return { nodes: rfNodes, edges: rfEdges, translateExtent: extent };
  }, [tree, direction, jumpingId, handleHoverStart, handleHoverEnd, onNodeClick]);

  // A vertical (TB) chat tree is tall-and-narrow; a portrait minimap shows its
  // top-to-bottom structure instead of crushing it into a landscape sliver.
  // LR layouts are wide, so flip to landscape.
  const minimapStyle = direction === 'TB' ? { width: 132, height: 208 } : { width: 220, height: 140 };

  return (
    <div className="cg-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.05}
          maxZoom={1.5}
          translateExtent={translateExtent}
          proOptions={{ hideAttribution: true }}
          zoomOnScroll={false}
          zoomOnPinch
          panOnScroll
          onMove={handleMove}
        >
          <Background gap={24} size={1} color="var(--cg-border)" />
          <Controls showInteractive={false} />
          <MiniMap
            className={`cg-minimap${mapVisible ? ' is-visible' : ''}`}
            style={minimapStyle}
            position="top-right"
            pannable
            zoomable
            ariaLabel="Conversation map"
            nodeColor={minimapNodeColor}
            nodeStrokeColor="var(--cg-bg-elev)"
            nodeStrokeWidth={3}
            nodeBorderRadius={3}
            maskColor="var(--cg-minimap-mask)"
            bgColor="var(--cg-bg-elev)"
          />
        </ReactFlow>
      </ReactFlowProvider>
      {hover && <HoverPreview node={hover.node} anchor={hover.anchor} />}
    </div>
  );
}
