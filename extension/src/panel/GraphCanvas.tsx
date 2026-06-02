import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  ReactFlowProvider,
} from '@xyflow/react';
import type { DisplayTree, DisplayNode } from '../tree/displayTree';
import { layoutTree, type LayoutDirection } from '../tree/layout';
import { NodeCard, hasMedia } from './NodeCard';
import { HoverPreview, type PreviewItem } from './HoverPreview';

type CgNodeData = {
  node: DisplayNode;
  jumping: boolean;
  height: number;
  // Handle sides follow the layout direction so edges anchor (and smoothstep-route)
  // from the correct card edges: TB enters top / leaves bottom, LR enters left / leaves right.
  targetPos: Position;
  sourcePos: Position;
  onPreview: (item: PreviewItem, r: DOMRect) => void;
  onPreviewEnd: () => void;
  onClick: (n: DisplayNode) => void;
};

// Single-role cards come in two fixed height tiers so same-content nodes match.
const NODE_W = 300;
const H_TEXT = 132; // text-only (and inline code/table/list/links) nodes
const H_MEDIA = 220; // nodes with a footer (files / images / widgets)
// One node of slack around the graph so panning stops just past the edge
// messages rather than locking exactly to them.
const EXTENT_PAD = 300;

/** Fixed height tier for a node — text-only vs. has-footer media. */
function tierHeight(n: DisplayNode): number {
  return hasMedia(n.preview) ? H_MEDIA : H_TEXT;
}

const NODE_TYPES = {
  // Hidden handles (styled away in panel.css) give React Flow the anchor points it
  // needs to actually draw the parent→child edges to/from our custom card.
  cgNode: ({ data }: { data: CgNodeData }) => (
    <>
      <Handle type="target" position={data.targetPos} isConnectable={false} />
      <NodeCard
        node={data.node}
        jumping={data.jumping}
        style={{ height: data.height }}
        onPreview={data.onPreview}
        onPreviewEnd={data.onPreviewEnd}
        onClick={data.onClick}
      />
      <Handle type="source" position={data.sourcePos} isConnectable={false} />
    </>
  ),
};

export type GraphCanvasProps = {
  tree: DisplayTree;
  direction?: LayoutDirection;
  onNodeClick: (node: DisplayNode) => void;
  jumpingId?: string | null;
};

export function GraphCanvas({ tree, direction = 'TB', onNodeClick, jumpingId }: GraphCanvasProps) {
  const [hover, setHover] = useState<{ item: PreviewItem; anchor: DOMRect } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  // When the tree identity changes (chat switch, refetch), drop any stale hover.
  useEffect(() => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(null);
  }, [tree]);

  const handlePreview = useCallback((item: PreviewItem, anchor: DOMRect) => {
    if (hoverTimer.current != null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    hoverTimer.current = window.setTimeout(() => setHover({ item, anchor }), 220);
  }, []);
  const handlePreviewEnd = useCallback(() => {
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
    // Tag each node with its fixed tier size so dagre spaces tiers without
    // overlap/gaps, and the rendered card matches the laid-out box exactly.
    const sized = tree.orderedNodes.map((n) => ({ ...n, width: NODE_W, height: tierHeight(n) }));
    const { nodes: laid, edges } = layoutTree(sized, { direction });
    const activeSet = new Set(tree.activePath);
    const isTB = direction === 'TB';
    const targetPos = isTB ? Position.Top : Position.Left;
    const sourcePos = isTB ? Position.Bottom : Position.Right;
    const rfNodes: Node[] = laid.map((n) => ({
      id: n.id,
      type: 'cgNode',
      position: { x: n.x, y: n.y },
      // React Flow's auto-measurement doesn't populate `measured` inside our
      // shadow root (cards are sized by CSS instead), which left fitView and the
      // MiniMap with no dimensions — an empty map. Seed explicit dims (the tier
      // size) so both have real bounds to work from.
      initialWidth: n.width,
      initialHeight: n.height,
      // Seed static handle geometry too: the same shadow-root quirk that skips
      // dimension measurement also skips React Flow's DOM handle measurement, so
      // `internals.handleBounds` stays empty. Providing `handles` gives the edge
      // router concrete anchor points (edge-center of each card) and lets edges
      // draw on first paint without depending on measurement.
      handles: [
        { type: 'target' as const, position: targetPos, x: isTB ? n.width / 2 : 0, y: isTB ? 0 : n.height / 2, width: 1, height: 1 },
        { type: 'source' as const, position: sourcePos, x: isTB ? n.width / 2 : n.width, y: isTB ? n.height : n.height / 2, width: 1, height: 1 },
      ],
      data: {
        node: n,
        jumping: jumpingId === n.id,
        height: n.height,
        targetPos,
        sourcePos,
        onPreview: handlePreview,
        onPreviewEnd: handlePreviewEnd,
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
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
      extent = [
        [minX - EXTENT_PAD, minY - EXTENT_PAD],
        [maxX + EXTENT_PAD, maxY + EXTENT_PAD],
      ];
    }
    return { nodes: rfNodes, edges: rfEdges, translateExtent: extent };
  }, [tree, direction, jumpingId, handlePreview, handlePreviewEnd, onNodeClick]);

  // A vertical (TB) chat tree is tall-and-narrow; a portrait minimap shows its
  // top-to-bottom structure instead of crushing it into a landscape sliver.
  // LR layouts are wide, so flip to landscape.
  const minimapStyle = direction === 'TB' ? { width: 100, height: 156 } : { width: 165, height: 105 };

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
      {hover && <HoverPreview item={hover.item} anchor={hover.anchor} />}
    </div>
  );
}
