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
import { NodeCard, DraftQuestionCard, DraftAnswerCard, hasMedia, type DraftView } from './NodeCard';
import { HoverPreview, type PreviewItem } from './HoverPreview';

/** Synthetic ids for the floating draft nodes (no real message collides). While
 *  editing, only the question node exists; once generating, a child answer node
 *  appears and the streamed reply renders there (not in the question). */
const DRAFT_Q_ID = '__cg_draft_q__';
const DRAFT_A_ID = '__cg_draft_a__';

/** A draft plus where it attaches in the graph (parent display-node id). */
export type DraftState = DraftView & { parentDisplayId: string | null };

type CgNodeData = {
  node: DisplayNode;
  jumping: boolean;
  width: number;
  height: number;
  isPreview: boolean;
  /** A draft is open — disable this node's quick-action buttons. */
  locked: boolean;
  /** Tooltip explaining why the actions are disabled (shown on hover when locked). */
  lockReason?: string;
  // Handle sides follow the layout direction so edges anchor (and smoothstep-route)
  // from the correct card edges: TB enters top / leaves bottom, LR enters left / leaves right.
  targetPos: Position;
  sourcePos: Position;
  onPreview: (item: PreviewItem, r: DOMRect) => void;
  onPreviewEnd: () => void;
  onClick: (n: DisplayNode) => void;
  onOpenPreview: (n: DisplayNode) => void;
  onTogglePreview: (n: DisplayNode) => void;
  onStartEdit: (n: DisplayNode) => void;
  onStartFollowup: (n: DisplayNode) => void;
  onRegenerate: (n: DisplayNode) => void;
};

type CgDraftQData = {
  draft: DraftView;
  width: number;
  height: number;
  targetPos: Position;
  sourcePos: Position;
  onCancel: () => void;
  onSubmit: (text: string) => void;
};

type CgDraftAData = {
  streamText?: string;
  /** Conversation's current model id — shown in the streaming answer's header. */
  model?: string | null;
  width: number;
  height: number;
  targetPos: Position;
  sourcePos: Position;
  onCancel: () => void;
};

// Single-role cards come in two fixed height tiers so same-content nodes match.
const NODE_W = 300;
const H_TEXT = 132; // text-only (and inline code/table/list/links) nodes
const H_MEDIA = 220; // nodes with a footer (files / images / widgets)
// In-place preview card — a fixed, scrollable reader (matches the floating window).
const PREVIEW_W = 480;
const PREVIEW_H = 560;
// Draft cards — a roomier box so the textarea / streaming answer fit comfortably.
const EDITOR_W = 360;
const EDITOR_H = 210; // editor (question while editing) + streaming answer node
const DRAFT_Q_GEN_H = 132; // read-only question while generating (answer is separate)
// One node of slack around the graph so panning stops just past the edge
// messages rather than locking exactly to them.
const EXTENT_PAD = 300;

/** Fixed height tier for a node — text-only vs. has-footer media. */
function tierHeight(n: DisplayNode): number {
  return hasMedia(n.preview) ? H_MEDIA : H_TEXT;
}

/** Seeded handle geometry (edge-center of each card). The shadow-root quirk that
 *  skips React Flow's measurement also skips its handle measurement, so we supply
 *  concrete anchors here so edges draw on first paint. */
function seedHandles(isTB: boolean, targetPos: Position, sourcePos: Position, w: number, h: number) {
  return [
    { type: 'target' as const, position: targetPos, x: isTB ? w / 2 : 0, y: isTB ? 0 : h / 2, width: 1, height: 1 },
    { type: 'source' as const, position: sourcePos, x: isTB ? w / 2 : w, y: isTB ? h : h / 2, width: 1, height: 1 },
  ];
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
        isPreview={data.isPreview}
        locked={data.locked}
        lockReason={data.lockReason}
        style={{ width: data.width, height: data.height }}
        onPreview={data.onPreview}
        onPreviewEnd={data.onPreviewEnd}
        onClick={data.onClick}
        onOpenPreview={data.onOpenPreview}
        onTogglePreview={data.onTogglePreview}
        onStartEdit={data.onStartEdit}
        onStartFollowup={data.onStartFollowup}
        onRegenerate={data.onRegenerate}
      />
      <Handle type="source" position={data.sourcePos} isConnectable={false} />
    </>
  ),
  // The floating draft QUESTION node (composer while editing, read-only while generating).
  cgDraftQ: ({ data }: { data: CgDraftQData }) => (
    <>
      <Handle type="target" position={data.targetPos} isConnectable={false} />
      <DraftQuestionCard
        draft={data.draft}
        style={{ width: data.width, height: data.height }}
        onCancel={data.onCancel}
        onSubmit={data.onSubmit}
      />
      <Handle type="source" position={data.sourcePos} isConnectable={false} />
    </>
  ),
  // The floating draft ANSWER node — the streamed reply lands here.
  cgDraftA: ({ data }: { data: CgDraftAData }) => (
    <>
      <Handle type="target" position={data.targetPos} isConnectable={false} />
      <DraftAnswerCard
        streamText={data.streamText}
        model={data.model}
        style={{ width: data.width, height: data.height }}
        onCancel={data.onCancel}
      />
      <Handle type="source" position={data.sourcePos} isConnectable={false} />
    </>
  ),
};

export type GraphCanvasProps = {
  tree: DisplayTree;
  direction?: LayoutDirection;
  onNodeClick: (node: DisplayNode) => void;
  onOpenPreview: (node: DisplayNode) => void;
  previewIds: Set<string>;
  onToggleInlinePreview: (node: DisplayNode) => void;
  jumpingId?: string | null;
  /** The floating draft node (edit / follow-up / regenerate), if open. */
  draft: DraftState | null;
  /** A draft is open anywhere — disable all real nodes' quick-action buttons. */
  locked: boolean;
  /** Tooltip explaining why the actions are disabled. */
  lockReason?: string;
  onStartEdit: (node: DisplayNode) => void;
  onStartFollowup: (node: DisplayNode) => void;
  onRegenerate: (node: DisplayNode) => void;
  onCancelDraft: () => void;
  onSubmitDraft: (text: string) => void;
};

export function GraphCanvas({
  tree,
  direction = 'TB',
  onNodeClick,
  onOpenPreview,
  previewIds,
  onToggleInlinePreview,
  jumpingId,
  draft,
  locked,
  lockReason,
  onStartEdit,
  onStartFollowup,
  onRegenerate,
  onCancelDraft,
  onSubmitDraft,
}: GraphCanvasProps) {
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

  // While panning the canvas, suppress text selection on the underlying claude.ai
  // page: React Flow's own drag-selection guard (d3-zoom `dragDisable`) doesn't
  // reach the host document across our shadow root, so a drag would otherwise
  // highlight the chat behind the panel. Restored when the pan ends.
  const prevBodyUserSelect = useRef('');
  const handleMoveStart = useCallback(() => {
    prevBodyUserSelect.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.getSelection()?.removeAllRanges();
  }, []);
  const handleMoveEnd = useCallback(() => {
    document.body.style.userSelect = prevBodyUserSelect.current;
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

  // ---- Layout (dagre): structural only ----
  // Depends on the tree shape, node sizes, and the draft's ATTACH POINT — never on
  // the draft's streamed text/status — so a live-streaming answer never re-runs
  // dagre. The draft is appended as a lightweight layout entry so neighbors reflow
  // around it and the parent→draft edge is wired automatically.
  const draftPresent = draft != null;
  const draftParent = draft ? draft.parentDisplayId : null;
  const draftGenerating = draft?.status === 'generating';
  const { laid, structEdges, translateExtent } = useMemo(() => {
    const layoutInput: Array<{ id: string; parentId: string | null; width: number; height: number }> =
      tree.orderedNodes.map((n) => {
        const pv = previewIds.has(n.id);
        return {
          id: n.id,
          parentId: n.parentId,
          width: pv ? PREVIEW_W : NODE_W,
          height: pv ? PREVIEW_H : tierHeight(n),
        };
      });
    if (draftPresent) {
      // Question draft hangs off its target parent. While generating, the child
      // answer draft holds the streamed reply and defaults to the in-line preview
      // reader size; the question goes read-only and matches that width.
      layoutInput.push({
        id: DRAFT_Q_ID,
        parentId: draftParent,
        width: draftGenerating ? PREVIEW_W : EDITOR_W,
        height: draftGenerating ? DRAFT_Q_GEN_H : EDITOR_H,
      });
      if (draftGenerating) {
        layoutInput.push({ id: DRAFT_A_ID, parentId: DRAFT_Q_ID, width: PREVIEW_W, height: PREVIEW_H });
      }
    }
    const { nodes: laidNodes, edges } = layoutTree(layoutInput, { direction });
    // Bound panning to the laid-out graph (+ one screen of slack) so scrolling
    // can't drift off into empty canvas past the first/last message.
    let extent: [[number, number], [number, number]] | undefined;
    if (laidNodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of laidNodes) {
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
    return { laid: laidNodes, structEdges: edges, translateExtent: extent };
  }, [tree, direction, previewIds, draftPresent, draftParent, draftGenerating]);

  const isTB = direction === 'TB';
  const targetPos = isTB ? Position.Top : Position.Left;
  const sourcePos = isTB ? Position.Bottom : Position.Right;

  // ---- Real message nodes ----
  // Referentially stable while a draft streams (no draft-content deps), so React
  // Flow doesn't re-render every card on each streamed token.
  const realNodes = useMemo(() => {
    const byId = new Map(tree.orderedNodes.map((n) => [n.id, n] as const));
    return laid
      .filter((n) => n.id !== DRAFT_Q_ID && n.id !== DRAFT_A_ID)
      .map((n) => {
        const dn = byId.get(n.id)!;
        return {
          id: n.id,
          type: 'cgNode',
          position: { x: n.x, y: n.y },
          initialWidth: n.width,
          initialHeight: n.height,
          handles: seedHandles(isTB, targetPos, sourcePos, n.width, n.height),
          style: { width: n.width, height: n.height },
          draggable: false,
          selectable: false,
          data: {
            node: dn,
            jumping: jumpingId === dn.id,
            width: n.width,
            height: n.height,
            isPreview: previewIds.has(dn.id),
            locked,
            lockReason,
            targetPos,
            sourcePos,
            onPreview: handlePreview,
            onPreviewEnd: handlePreviewEnd,
            onClick: onNodeClick,
            onOpenPreview,
            onTogglePreview: onToggleInlinePreview,
            onStartEdit,
            onStartFollowup,
            onRegenerate,
          } satisfies CgNodeData,
        } as Node;
      });
  }, [laid, isTB, targetPos, sourcePos, tree, previewIds, locked, lockReason, jumpingId, handlePreview, handlePreviewEnd, onNodeClick, onOpenPreview, onToggleInlinePreview, onStartEdit, onStartFollowup, onRegenerate]);

  // ---- The floating draft nodes (question + streaming answer) ----
  // Re-map on each streamed token (cheap object creation, no dagre).
  const draftNodes = useMemo<Node[]>(() => {
    if (!draft) return [];
    const out: Node[] = [];
    const q = laid.find((x) => x.id === DRAFT_Q_ID);
    if (q) {
      out.push({
        id: q.id,
        type: 'cgDraftQ',
        position: { x: q.x, y: q.y },
        initialWidth: q.width,
        initialHeight: q.height,
        handles: seedHandles(isTB, targetPos, sourcePos, q.width, q.height),
        style: { width: q.width, height: q.height },
        draggable: false,
        selectable: false,
        data: {
          draft,
          width: q.width,
          height: q.height,
          targetPos,
          sourcePos,
          onCancel: onCancelDraft,
          onSubmit: onSubmitDraft,
        } satisfies CgDraftQData,
      } as Node);
    }
    const a = laid.find((x) => x.id === DRAFT_A_ID);
    if (a) {
      out.push({
        id: a.id,
        type: 'cgDraftA',
        position: { x: a.x, y: a.y },
        initialWidth: a.width,
        initialHeight: a.height,
        handles: seedHandles(isTB, targetPos, sourcePos, a.width, a.height),
        style: { width: a.width, height: a.height },
        draggable: false,
        selectable: false,
        data: {
          streamText: draft.streamText,
          model: draft.model,
          width: a.width,
          height: a.height,
          targetPos,
          sourcePos,
          onCancel: onCancelDraft,
        } satisfies CgDraftAData,
      } as Node);
    }
    return out;
  }, [laid, isTB, targetPos, sourcePos, draft, onCancelDraft, onSubmitDraft]);

  const nodes = useMemo(
    () => (draftNodes.length ? [...realNodes, ...draftNodes] : realNodes),
    [realNodes, draftNodes],
  );

  const edges = useMemo<Edge[]>(() => {
    const activeSet = new Set(tree.activePath);
    return structEdges.map((e) => {
      if (e.target === DRAFT_Q_ID || e.target === DRAFT_A_ID) {
        // Pending draft branch — dashed accent so it reads as not-yet-real.
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          className: 'cg-edge-draft',
          style: { stroke: 'var(--cg-accent)', strokeWidth: 1.5, strokeDasharray: '5 4' },
        } as Edge;
      }
      const active = activeSet.has(e.source) && activeSet.has(e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        data: { active },
        ...(active
          ? { className: 'cg-edge-active', style: { stroke: 'var(--cg-accent)', strokeWidth: 2 } }
          : { style: { stroke: 'var(--cg-border-strong)', strokeWidth: 1.5 } }),
        type: 'smoothstep',
      } as Edge;
    });
  }, [structEdges, tree]);

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
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
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
