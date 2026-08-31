import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type Rect,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import type { DisplayTree, DisplayNode } from '../tree/displayTree';
import { layoutTree, type LayoutDirection } from '../tree/layout';
import { NodeCard, DraftQuestionCard, DraftAnswerCard, hasMedia, type DraftView, type FooterItem } from './NodeCard';
import { HoverPreview, type PreviewItem } from './HoverPreview';
import { CenterIcon, FitViewIcon, PlusIcon, MinusIcon } from './icons';

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
  /** A search query is in effect — dim non-matching cards. */
  searchActive: boolean;
  /** The active query text — highlighted within this node's expanded preview. */
  searchQuery: string;
  /** This card's text matches the current query. */
  isMatch: boolean;
  /** This is the match the stepper is currently sitting on. */
  isCurrentMatch: boolean;
  /** On the current match: which body occurrence to scroll to/emphasize. */
  matchOccurrence?: number;
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
  onOpenMedia: (item: FooterItem) => void;
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
const NODE_W = 360;
const H_TEXT = 152; // text-only (and inline code/table/list/links) nodes
const H_MEDIA = 220; // nodes with a footer (files / images / widgets)
// In-place preview card — a fixed, scrollable reader (matches the floating window).
const PREVIEW_W = 580;
const PREVIEW_H = 560;
// Question previews get a compact reader — prompts are usually much shorter than
// answers, so the full-size box is mostly empty space.
const PREVIEW_Q_W = 460;
const PREVIEW_Q_H = 320;
// Draft cards — a roomier box so the textarea / streaming answer fit comfortably.
const EDITOR_W = 360;
const EDITOR_H = 210; // editor (question while editing) + streaming answer node
const DRAFT_Q_GEN_H = 132; // read-only question while generating (answer is separate)
// One node of slack around the graph so panning stops just past the edge
// messages rather than locking exactly to them.
const EXTENT_PAD = 300;
// Zoom the "center" button lands on — slightly below natural size so the most
// recent message sits centered with breathing room, not slammed to maxZoom.
const CENTER_ZOOM = 0.9;

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
        searchActive={data.searchActive}
        searchQuery={data.searchQuery}
        isMatch={data.isMatch}
        isCurrentMatch={data.isCurrentMatch}
        matchOccurrence={data.matchOccurrence}
        locked={data.locked}
        lockReason={data.lockReason}
        style={{ width: data.width, height: data.height }}
        onPreview={data.onPreview}
        onPreviewEnd={data.onPreviewEnd}
        onClick={data.onClick}
        onOpenPreview={data.onOpenPreview}
        onOpenMedia={data.onOpenMedia}
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

/**
 * Lower-left canvas controls: zoom in / out / center / fit. Custom buttons (React
 * Flow's defaults are replaced) so all share the panel's custom hover tooltip
 * instead of the slow native `title`. "Center" frames the most recent
 * active-branch message (rect from the dagre layout) at a fixed reading zoom —
 * `fitBounds` on one small card would slam to maxZoom (too close), so we pan to
 * its center at CENTER_ZOOM instead. "Fit" zooms the whole graph into view
 * (the pre-2026-08 default open framing).
 */
function CanvasControls({ bounds, allBounds }: { bounds: Rect | null; allBounds: Rect | null }) {
  const { zoomIn, zoomOut, setCenter, fitBounds, fitView } = useReactFlow();
  const fitAll = useCallback(() => {
    if (allBounds && allBounds.width > 0 && allBounds.height > 0) {
      void fitBounds(allBounds, { padding: 0.2, duration: 400 });
    } else {
      void fitView({ padding: 0.2, duration: 400 });
    }
  }, [allBounds, fitBounds, fitView]);
  const recenter = useCallback(() => {
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      void setCenter(cx, cy, { zoom: CENTER_ZOOM, duration: 400 });
    } else {
      fitAll();
    }
  }, [bounds, setCenter, fitAll]);
  return (
    <>
      <ControlButton onClick={() => zoomIn({ duration: 200 })} data-tip="Zoom in" aria-label="Zoom in">
        <PlusIcon />
      </ControlButton>
      <ControlButton onClick={() => zoomOut({ duration: 200 })} data-tip="Zoom out" aria-label="Zoom out">
        <MinusIcon />
      </ControlButton>
      <ControlButton onClick={recenter} data-tip="Center on the most recent message" aria-label="Center on the most recent message">
        <CenterIcon />
      </ControlButton>
      <ControlButton onClick={fitAll} data-tip="Fit the whole graph" aria-label="Fit the whole graph">
        <FitViewIcon />
      </ControlButton>
    </>
  );
}

/**
 * Pans the viewport to the current search match on each explicit step. Lives
 * inside the ReactFlow provider (so it can use `useReactFlow`) and fires only
 * when `nonce` changes — i.e. on navigation, never on typing — preserving the
 * user's current zoom so the canvas glides rather than jumps.
 */
function SearchFocus({ nonce, bounds }: { nonce?: number; bounds: Rect | null }) {
  const { setCenter, getZoom } = useReactFlow();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  useEffect(() => {
    const b = boundsRef.current;
    if (nonce == null || !b) return;
    void setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: getZoom(), duration: 400 });
    // Intentionally keyed only on `nonce`: pan on a step, not when `bounds`
    // changes as the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return null;
}

export type GraphCanvasProps = {
  tree: DisplayTree;
  direction?: LayoutDirection;
  onNodeClick: (node: DisplayNode) => void;
  onOpenPreview: (node: DisplayNode) => void;
  onOpenMedia: (item: FooterItem) => void;
  previewIds: Set<string>;
  onToggleInlinePreview: (node: DisplayNode) => void;
  jumpingId?: string | null;
  /** A search query is in effect — dim non-matching cards. */
  searchActive?: boolean;
  /** The active query text — highlighted within an expanded match's preview. */
  searchQuery?: string;
  /** Ids of cards matching the current search query. */
  matchIds?: Set<string>;
  /** Id of the match the stepper is currently on (strongest emphasis). */
  currentMatchId?: string | null;
  /** Occurrence index within the current match node (multi-hit nodes). */
  currentMatchOccurrence?: number;
  /** Bumped on each explicit search step — pans the viewport to the current match
   *  (only on navigation, so typing never moves the canvas). */
  searchFocusNonce?: number;
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
  onOpenMedia,
  previewIds,
  onToggleInlinePreview,
  jumpingId,
  searchActive = false,
  searchQuery = '',
  matchIds,
  currentMatchId,
  currentMatchOccurrence,
  searchFocusNonce,
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
  const { laid, structEdges, translateExtent, graphBounds } = useMemo(() => {
    const layoutInput: Array<{ id: string; parentId: string | null; width: number; height: number }> =
      tree.orderedNodes.map((n) => {
        const pv = previewIds.has(n.id);
        const isQ = n.role === 'human';
        return {
          id: n.id,
          parentId: n.parentId,
          width: pv ? (isQ ? PREVIEW_Q_W : PREVIEW_W) : NODE_W,
          height: pv ? (isQ ? PREVIEW_Q_H : PREVIEW_H) : tierHeight(n),
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
    // Whole-graph rect from the dagre layout. Fit-to-graph must use this via
    // `fitBounds` — React Flow's own `fitView()` reads measured node dimensions,
    // and measurement is unreliable inside the shadow root (the same quirk
    // `seedHandles` works around), so it silently no-ops.
    let allBounds: Rect | null = null;
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
      allBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return { laid: laidNodes, structEdges: edges, translateExtent: extent, graphBounds: allBounds };
  }, [tree, direction, previewIds, draftPresent, draftParent, draftGenerating]);

  const isTB = direction === 'TB';
  const targetPos = isTB ? Position.Top : Position.Left;
  const sourcePos = isTB ? Position.Bottom : Position.Right;

  // Rect of the MOST RECENT message on the active branch — the last node on the
  // active path (excludes any draft). The lower-left "center" control fits to
  // this, so it frames the latest message up close rather than the whole active
  // branch (let alone the sprawling tree).
  const recentBounds = useMemo<Rect | null>(() => {
    const byId = new Map(laid.map((n) => [n.id, n] as const));
    const path = tree.activePath;
    for (let i = path.length - 1; i >= 0; i--) {
      const n = byId.get(path[i]!);
      if (n) return { x: n.x, y: n.y, width: n.width, height: n.height };
    }
    return null;
  }, [laid, tree]);

  // Rect of the current search match — what SearchFocus pans the viewport to on
  // each step. Null when there's no current match.
  const currentMatchBounds = useMemo<Rect | null>(() => {
    if (!currentMatchId) return null;
    const n = laid.find((l) => l.id === currentMatchId);
    return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
  }, [laid, currentMatchId]);

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
            searchActive,
            searchQuery,
            isMatch: matchIds?.has(dn.id) ?? false,
            isCurrentMatch: currentMatchId === dn.id,
            matchOccurrence: currentMatchId === dn.id ? currentMatchOccurrence : undefined,
            locked,
            lockReason,
            targetPos,
            sourcePos,
            onPreview: handlePreview,
            onPreviewEnd: handlePreviewEnd,
            onClick: onNodeClick,
            onOpenPreview,
            onOpenMedia,
            onTogglePreview: onToggleInlinePreview,
            onStartEdit,
            onStartFollowup,
            onRegenerate,
          } satisfies CgNodeData,
        } as Node;
      });
  }, [laid, isTB, targetPos, sourcePos, tree, previewIds, locked, lockReason, jumpingId, searchActive, searchQuery, matchIds, currentMatchId, currentMatchOccurrence, handlePreview, handlePreviewEnd, onNodeClick, onOpenPreview, onOpenMedia, onToggleInlinePreview, onStartEdit, onStartFollowup, onRegenerate]);

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

  // Default view on open: center on the most recent active-branch message at
  // reading zoom (same framing as the lower-left "center" control) instead of
  // fitting the whole graph — the full view is one click away on the "fit"
  // control. Runs via onInit so the container is measured; ref keeps the
  // callback stable across layout recomputes.
  const recentBoundsRef = useRef(recentBounds);
  recentBoundsRef.current = recentBounds;
  const graphBoundsRef = useRef(graphBounds);
  graphBoundsRef.current = graphBounds;
  const handleInit = useCallback((inst: ReactFlowInstance) => {
    const b = recentBoundsRef.current;
    const g = graphBoundsRef.current;
    if (b && b.width > 0 && b.height > 0) {
      void inst.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: CENTER_ZOOM });
    } else if (g && g.width > 0 && g.height > 0) {
      void inst.fitBounds(g, { padding: 0.2 });
    } else {
      void inst.fitView({ padding: 0.2 });
    }
  }, []);

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
          onInit={handleInit}
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
          <Controls showZoom={false} showFitView={false} showInteractive={false}>
            <CanvasControls bounds={recentBounds} allBounds={graphBounds} />
          </Controls>
          <SearchFocus nonce={searchFocusNonce} bounds={currentMatchBounds} />
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
            bgColor="transparent"
          />
        </ReactFlow>
      </ReactFlowProvider>
      {hover && <HoverPreview item={hover.item} anchor={hover.anchor} />}
    </div>
  );
}
