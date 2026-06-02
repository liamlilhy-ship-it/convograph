import { useEffect, useState, useCallback, useRef } from 'react';
import { ClaudeApiError, getOrgId, getConversationTree, parseConversationIdFromUrl } from '../api/claudeClient';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree, type DisplayTree, type DisplayNode } from '../tree/displayTree';
import { GraphCanvas } from './GraphCanvas';
import { PreviewLayer, type OpenPreview, type Geometry } from './PreviewLayer';
import { watchConversation, watchUrl } from '../content/observers';
import { trackComposerAnchor, type AnchorPosition } from '../content/anchorComposer';
import { jumpToNode } from '../navigation/jumpToNode';
import type { LayoutDirection } from '../tree/layout';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; tree: DisplayTree; convId: string }
  | { kind: 'no-conversation' }
  | { kind: 'error'; message: string };

const DEFAULT_PANEL_W = 480;
const MIN_PANEL_W = 320;
const MAX_PANEL_W_FRAC = 0.7; // never take more than 70% of viewport

function usePagePushRight(open: boolean, width: number) {
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.getPropertyValue('--cg-host-push');
    const prevTransition = html.style.transition;
    html.style.transition = 'padding-right 180ms ease';
    html.style.paddingRight = `${width}px`;
    html.style.boxSizing = 'border-box';
    return () => {
      html.style.paddingRight = '';
      html.style.transition = prevTransition;
      if (prev) html.style.setProperty('--cg-host-push', prev);
    };
  }, [open, width]);
}

export function App() {
  const [open, setOpen] = useState(false);
  const [panelW, setPanelW] = useState(DEFAULT_PANEL_W);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [direction, setDirection] = useState<LayoutDirection>('TB');
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [jumping, setJumping] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openPreviews, setOpenPreviews] = useState<OpenPreview[]>([]);
  const orgIdRef = useRef<string | null>(null);
  const reqRef = useRef(0);
  const cascadeRef = useRef(0);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  usePagePushRight(open, panelW);

  // ---- Full-preview windows ----
  const openPreview = useCallback((node: DisplayNode) => {
    setOpenPreviews((prev) => {
      // Reopen → focus (move to end of the stack) instead of duplicating.
      const existing = prev.find((p) => p.key === node.id);
      if (existing) return [...prev.filter((p) => p.key !== node.id), existing];
      const W = 560;
      const H = 520;
      const step = (cascadeRef.current++ % 6) * 28; // cascade so windows never spawn exactly stacked
      const x = Math.max(0, Math.min(80 + step, window.innerWidth - W - 16));
      const y = Math.max(0, Math.min(72 + step, window.innerHeight - H - 16));
      return [...prev, { key: node.id, node, x, y, w: W, h: H }];
    });
  }, []);

  const closePreview = useCallback((key: string) => {
    setOpenPreviews((prev) => prev.filter((p) => p.key !== key));
  }, []);

  const focusPreview = useCallback((key: string) => {
    setOpenPreviews((prev) => {
      const i = prev.findIndex((p) => p.key === key);
      if (i < 0 || i === prev.length - 1) return prev; // already on top
      return [...prev.slice(0, i), ...prev.slice(i + 1), prev[i]!];
    });
  }, []);

  const setPreviewGeometry = useCallback((key: string, geo: Geometry) => {
    setOpenPreviews((prev) => prev.map((p) => (p.key === key ? { ...p, ...geo } : p)));
  }, []);

  // Tile all open windows into a grid across the area left of the side panel.
  const tidyPreviews = useCallback(() => {
    setOpenPreviews((prev) => {
      const n = prev.length;
      if (n === 0) return prev;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const gap = 12;
      const areaW = Math.max(320, window.innerWidth - panelW - 2 * gap);
      const areaH = window.innerHeight - 2 * gap;
      const cellW = (areaW - gap * (cols - 1)) / cols;
      const cellH = (areaH - gap * (rows - 1)) / rows;
      return prev.map((p, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        return {
          ...p,
          x: gap + c * (cellW + gap),
          y: gap + r * (cellH + gap),
          w: Math.max(300, Math.round(cellW)),
          h: Math.max(200, Math.round(cellH)),
        };
      });
    });
  }, [panelW]);

  // Previews belong to graph mode — clear them when the panel closes (which also
  // fires on chat switch, since that closes the panel).
  useEffect(() => {
    if (!open) setOpenPreviews([]);
  }, [open]);

  // Anchor the toggle to the composer's top-right corner. Re-tracks on resize,
  // scroll, layout shifts, and on panel open/close (because the composer moves
  // when claude.ai's content shifts left).
  useEffect(() => {
    if (!toggleRef.current) return;
    return trackComposerAnchor(toggleRef.current, setAnchor);
  }, [open, panelW]);

  const load = useCallback(async () => {
    const convId = parseConversationIdFromUrl();
    if (!convId) {
      setStatus({ kind: 'no-conversation' });
      return;
    }
    const req = ++reqRef.current;
    // Keep the cached tree on screen during a same-chat refresh (avoids
    // flicker), but force a loading state when the cached tree belongs to a
    // different conversation — otherwise we'd briefly show the previous
    // chat's nodes while the new one fetches.
    setStatus((s) => (s.kind === 'ready' && s.convId === convId ? s : { kind: 'loading' }));
    try {
      if (!orgIdRef.current) orgIdRef.current = await getOrgId();
      const conv = await getConversationTree(orgIdRef.current, convId);
      if (req !== reqRef.current) return;
      const tree = buildDisplayTree(buildTree(conv));
      setStatus({ kind: 'ready', tree, convId });
    } catch (e) {
      if (req !== reqRef.current) return;
      const msg = e instanceof ClaudeApiError
        ? e.status === 403 || e.status === 401
          ? 'Not authenticated to claude.ai. Reload the tab and sign in.'
          : `claude.ai API error: ${e.status}`
        : e instanceof Error
          ? e.message
          : 'Unknown error loading conversation';
      setStatus({ kind: 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Capture the conv we opened against — switching to a different chat closes
    // the panel (Option 1 by user request). Query-string-only changes on the
    // same conv are ignored.
    const initialConvId = parseConversationIdFromUrl();
    void load();
    const unwatchUrl = watchUrl(() => {
      const cur = parseConversationIdFromUrl();
      if (cur !== initialConvId) {
        setOpen(false);
      }
    });
    // Same-chat updates (new message, edit) still refresh the graph — cheap and
    // keeps the tree in sync while you're working in one conversation.
    const unwatchConv = watchConversation(() => void load(), 800);
    return () => {
      unwatchUrl();
      unwatchConv();
    };
  }, [open, load]);

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const handleNodeClick = useCallback(
    async (node: DisplayNode) => {
      const convId = parseConversationIdFromUrl();
      const orgId = orgIdRef.current;
      if (!convId || !orgId) return;
      if (node.isOnActivePath) {
        // Already active — just scroll the left chat to it.
        void jumpToNode(orgId, convId, node);
        return;
      }
      setJumping(node.id);
      const result = await jumpToNode(orgId, convId, node);
      setJumping(null);
      if (!result.ok) {
        setToast(result.error ?? 'Could not switch branch');
        return;
      }
      if (!result.refreshed) {
        setToast('Branch set — reload the chat to see it');
      }
      // Re-fetch so the graph's active-path highlight follows the jump.
      void load();
    },
    [load],
  );

  // Resize handle drag
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = panelW;
    const maxW = Math.floor(window.innerWidth * MAX_PANEL_W_FRAC);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_PANEL_W, Math.min(maxW, startW + (startX - ev.clientX)));
      setPanelW(next);
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelW]);

  // Style the toggle from anchor coords
  const toggleStyle: React.CSSProperties = anchor
    ? {
        ['--cg-toggle-x' as never]: `${anchor.x}px`,
        ['--cg-toggle-y' as never]: `${anchor.y}px`,
        ['--cg-toggle-vis' as never]: anchor.visible ? 'visible' : 'hidden',
      }
    : { ['--cg-toggle-vis' as never]: 'hidden' };

  return (
    <>
      <button
        ref={toggleRef}
        className="cg-toggle"
        data-on={open ? 'true' : 'false'}
        data-hidden={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        title="Open graph mode (⌘⇧G)"
        style={toggleStyle}
        aria-hidden={open}
      >
        <span className="cg-dot" />
        Graph
      </button>
      {open && (
        <aside
          className="cg-panel"
          role="complementary"
          aria-label="Conversation graph"
          style={{ ['--cg-panel-w' as never]: `${panelW}px` }}
        >
          <div
            className="cg-resize"
            data-dragging={dragging ? 'true' : 'false'}
            onMouseDown={onResizeStart}
            title="Drag to resize"
          />
          <div className="cg-toolbar">
            <h1>Conversation graph</h1>
            <div className="cg-spacer" />
            {openPreviews.length > 1 && (
              <button onClick={tidyPreviews} title="Tidy previews">⊞</button>
            )}
            <button onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))} title="Switch orientation">
              {direction === 'TB' ? '↓' : '→'}
            </button>
            <button onClick={() => void load()} title="Refresh">↻</button>
            <button onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
          </div>
          <div className="cg-toolbar" style={{ borderTop: 0, paddingTop: 0 }}>
            <span className="cg-status">
              {status.kind === 'loading' && 'Loading…'}
              {status.kind === 'ready' && `${status.tree.orderedNodes.length} messages · active path highlighted`}
              {status.kind === 'no-conversation' && 'Open a chat to see its tree'}
              {status.kind === 'error' && status.message}
            </span>
          </div>
          {status.kind === 'ready' ? (
            <GraphCanvas
              tree={status.tree}
              direction={direction}
              onNodeClick={handleNodeClick}
              onOpenPreview={openPreview}
              jumpingId={jumping}
            />
          ) : (
            <div className="cg-empty">
              {status.kind === 'loading'
                ? 'Loading conversation tree…'
                : status.kind === 'no-conversation'
                  ? 'Open any chat on claude.ai, then press ⌘⇧G.'
                  : status.kind === 'error'
                    ? status.message
                    : ''}
            </div>
          )}
          {toast && <div className="cg-toast">{toast}</div>}
        </aside>
      )}
      {open && (
        <PreviewLayer
          previews={openPreviews}
          onClose={closePreview}
          onFocus={focusPreview}
          onGeometry={setPreviewGeometry}
        />
      )}
    </>
  );
}
