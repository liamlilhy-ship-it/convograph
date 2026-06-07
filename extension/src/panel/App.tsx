import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { buildTree } from '../tree/buildTree';
import { buildDisplayTree, type DisplayTree, type DisplayNode } from '../tree/displayTree';
import { GraphCanvas } from './GraphCanvas';
import { PreviewLayer, DEFAULT_FS, type OpenPreview, type PreviewContent, type Geometry } from './PreviewLayer';
import { watchConversation, watchUrl } from '../content/observers';
import { trackComposerAnchor, type AnchorPosition } from '../content/anchorComposer';
import { jumpToNode, requestRefresh, scrollChatToNode } from '../navigation/jumpToNode';
import type { Platform } from '../platforms/types';
import { PlatformApiError } from '../platforms/errors';
import { PlatformUIProvider, assistantIconFor, type PlatformUI } from './platformUI';
import type { DraftKind, FooterItem } from './NodeCard';
import type { LayoutDirection } from '../tree/layout';
import { FullscreenIcon, ExitFullscreenIcon } from './icons';

/**
 * A pending quick-action draft. Drives the floating draft node on the canvas and
 * carries everything needed to fire the completion when submitted.
 *   - edit       → editable question node, parent = the question's parent (sibling branch)
 *   - followup   → editable empty question node, parent = the answer message (child branch)
 *   - regenerate → read-only copy of the question, retry on the human message
 */
type Draft = {
  kind: DraftKind;
  /** Display-node id the draft attaches to in the graph (for layout/edge). */
  parentDisplayId: string | null;
  /** completion `parent_message_uuid` (edit/followup) or retry target (regenerate). */
  parentMessageUuid: string;
  isRetry: boolean;
  title: string;
  editable: boolean;
  status: 'editing' | 'generating';
  /** The conversation's current model id (e.g. "claude-opus-4-8") — what this
   *  completion will use. Surfaced on the input + streaming answer cards. */
  model?: string | null;
  /** Answer text accumulated from the live stream while generating. */
  streamText?: string;
  /** Reconciliation: the UUIDs of the messages this completion creates, captured
   *  from the stream's `message_start` (the new assistant, and for edit/follow-up
   *  the new human). Once any of them appears in a (re)loaded tree, the draft has
   *  been realized and is dropped — so the placeholder never coexists with the
   *  real node, on any refresh. Identity-based, so no parent/text matching. */
  createdUuids?: string[];
};

/** Whether the real message(s) a draft created now exist in `tree` — matched by
 *  the UUIDs captured from `message_start`. */
function draftRealized(tree: DisplayTree, d: Draft): boolean {
  if (!d.createdUuids?.length) return false;
  const present = new Set<string>();
  for (const n of tree.orderedNodes) {
    present.add(n.humanId);
    if (n.assistantId) present.add(n.assistantId);
  }
  return d.createdUuids.some((u) => present.has(u));
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; tree: DisplayTree; convId: string }
  | { kind: 'no-conversation' }
  | { kind: 'error'; message: string };

const DEFAULT_PANEL_W = 480;
const MIN_PANEL_W = 320;
const MAX_PANEL_W_FRAC = 0.7; // never take more than 70% of viewport

function usePagePushRight(platform: Platform, open: boolean, width: number) {
  useEffect(() => {
    if (!open) return;
    // How to reserve room for the side panel is platform-specific (page layouts
    // differ); Claude's implementation is the original document-padding behavior.
    return platform.applySidePanelInset(width);
  }, [platform, open, width]);
}

// Shown when a click can't scroll to a message because the platform hasn't
// loaded it (ChatGPT). Kept as a const so the auto-dismiss can give it a shorter
// timeout than ordinary toasts without matching on free text.
const UNREACHABLE_TOAST = "This message isn't loaded in the chat. Scroll to it in the chat, then click again.";

export function App({ platform }: { platform: Platform }) {
  const [open, setOpen] = useState(false);
  // Full-screen: the panel fills the viewport instead of the right side. Same
  // capabilities, EXCEPT click-to-jump is disabled (the native chat it would
  // scroll is hidden behind the graph). Reset whenever the panel closes.
  const [fullscreen, setFullscreen] = useState(false);
  const [panelW, setPanelW] = useState(DEFAULT_PANEL_W);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [direction, setDirection] = useState<LayoutDirection>('TB');
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [jumping, setJumping] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openPreviews, setOpenPreviews] = useState<OpenPreview[]>([]);
  // Nodes currently expanded into an in-place ("inline") preview. Multiple may be
  // open at once; the graph layout reflows around them. Distinct from the floating
  // windows in `openPreviews`.
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set());
  // Shared preview font size — adjusting it in any window applies to all open
  // windows and any opened afterward.
  const [previewFontPx, setPreviewFontPx] = useState(DEFAULT_FS);
  // The conversation's current model (e.g. "claude-opus-4-8"), captured on load.
  // claude.ai has no per-message model, so this single value is what new
  // completions use — shown on the draft input + streaming answer cards.
  const [convModel, setConvModel] = useState<string | null>(null);
  // The single pending quick-action draft (one at a time). A non-null draft locks
  // all node action buttons so a second completion can't fire concurrently.
  const [draft, setDraft] = useState<Draft | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Mirror of `draft` for the DOM observer to read synchronously without
  // re-subscribing — it pauses auto-refresh while a draft is open (see below).
  const draftRef = useRef<Draft | null>(null);
  // The leaf the user last jumped to. On platforms that don't persist branch
  // selection server-side (ChatGPT), this overrides the re-fetched active path so
  // the highlight follows the jump. Null = use the server's leaf (the default).
  const selectedLeafRef = useRef<string | null>(null);
  const reqRef = useRef(0);
  const cascadeRef = useRef(0);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  // Read full-screen synchronously inside callbacks without re-creating them.
  const fullscreenRef = useRef(fullscreen);
  // A node jumped to WHILE in full-screen. The chat scrolls under the full-screen
  // cover, where it doesn't stick, so we replay the scroll on exit (when the chat
  // is visible) to land it top-aligned like a side-panel jump.
  const fsJumpTargetRef = useRef<DisplayNode | null>(null);

  // Don't push the page in full-screen — the graph covers the whole viewport, so
  // there's no side panel to make room for (and the native chat is hidden).
  usePagePushRight(platform, open && !fullscreen, panelW);

  // ---- Floating preview windows ----
  // Shared placement: reopening the same key focuses it (move to end of the stack);
  // otherwise a new window cascades in so stacked windows never perfectly overlap.
  const addPreview = useCallback((key: string, content: PreviewContent) => {
    setOpenPreviews((prev) => {
      const existing = prev.find((p) => p.key === key);
      if (existing) return [...prev.filter((p) => p.key !== key), existing];
      const W = 620;
      const H = 520;
      const step = (cascadeRef.current++ % 6) * 28;
      const x = Math.max(0, Math.min(80 + step, window.innerWidth - W - 16));
      const y = Math.max(0, Math.min(72 + step, window.innerHeight - H - 16));
      return [...prev, { key, ...content, x, y, w: W, h: H }];
    });
  }, []);

  const openPreview = useCallback(
    (node: DisplayNode) => addPreview(node.id, { kind: 'node', node }),
    [addPreview],
  );

  // Open a footer attachment — generated document, image, widget, or uploaded file
  // — in its own floating window. Items with nothing previewable are ignored.
  const openMedia = useCallback(
    (item: FooterItem) => {
      switch (item.kind) {
        case 'artifact': {
          const a = item.artifact;
          if (!a.content) return;
          addPreview(`artifact:${a.id ?? a.name}`, {
            kind: 'artifact',
            artifact: { id: a.id ?? a.name, title: a.name, type: a.type, content: a.content },
          });
          break;
        }
        case 'image': {
          const img = item.image;
          addPreview(`image:${img.fullUrl ?? img.thumbUrl}`, { kind: 'image', image: img });
          break;
        }
        case 'widget': {
          const w = item.widget;
          addPreview(`widget:${w.title ?? 'viz'}:${w.code.length}`, { kind: 'widget', widget: w });
          break;
        }
        case 'file': {
          const f = item.file;
          if (!f.content && !f.url) return;
          addPreview(`file:${f.name}:${f.size ?? f.content?.length ?? 0}`, { kind: 'file', file: f });
          break;
        }
      }
    },
    [addPreview],
  );

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

  // Toggle a node's in-place preview. The layout reflows automatically (GraphCanvas
  // keys its layout memo off these ids).
  const toggleInlinePreview = useCallback((node: DisplayNode) => {
    setPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }, []);

  // Tile all open windows into a grid across the area left of the side panel.
  const tidyPreviews = useCallback(() => {
    setOpenPreviews((prev) => {
      const n = prev.length;
      if (n === 0) return prev;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const gap = 12;
      // In full-screen the graph fills the viewport, so tile across the whole
      // width; otherwise tile into the area left of the side panel.
      const areaW = fullscreen
        ? window.innerWidth - 2 * gap
        : Math.max(320, window.innerWidth - panelW - 2 * gap);
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
  }, [panelW, fullscreen]);

  // Previews belong to graph mode — clear them when the panel closes (which also
  // fires on chat switch, since that closes the panel). Also drop full-screen so
  // reopening always starts in the side-panel mode.
  useEffect(() => {
    if (!open) {
      setOpenPreviews([]);
      setPreviewIds(new Set());
      abortRef.current?.abort();
      abortRef.current = null;
      setDraft(null);
      setFullscreen(false);
      selectedLeafRef.current = null;
    }
  }, [open]);

  // Keep the observer's view of the draft current (it reads this ref to pause
  // auto-refresh while a draft is open).
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // On EXITING full-screen, replay the scroll for the node jumped to while in
  // full-screen: that jump's scroll happened while the chat was hidden behind the
  // graph and didn't stick, so re-run it now that the chat is visible — landing it
  // top-aligned, exactly like a side-panel jump.
  useEffect(() => {
    const exitedFullscreen = fullscreenRef.current && !fullscreen;
    fullscreenRef.current = fullscreen;
    if (!exitedFullscreen) return;
    const node = fsJumpTargetRef.current;
    fsJumpTargetRef.current = null;
    if (!node) return;
    // Wait for the side panel to settle before re-aligning.
    const id = window.setTimeout(() => void scrollChatToNode(platform, node), 280);
    return () => clearTimeout(id);
  }, [fullscreen, platform]);

  // Anchor the toggle to the composer's top-right corner. Re-tracks on resize,
  // scroll, layout shifts, and on panel open/close (because the composer moves
  // when claude.ai's content shifts left).
  useEffect(() => {
    if (!toggleRef.current) return;
    return trackComposerAnchor(platform, toggleRef.current, setAnchor);
  }, [open, panelW, platform]);

  const load = useCallback(async () => {
    const convId = platform.parseConversationId();
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
      const conv = await platform.fetchConversation(convId);
      if (req !== reqRef.current) return;
      // Keep the active path on the branch the user last jumped to when the
      // platform doesn't persist branch selection (ChatGPT) — a re-fetch would
      // otherwise revert the highlight to the server's (unchanged) leaf.
      if (!platform.capabilities.serverPersistsActiveBranch && selectedLeafRef.current) {
        conv.current_leaf_message_uuid = selectedLeafRef.current;
      }
      const tree = buildDisplayTree(buildTree(conv));
      setConvModel(conv.model ?? null);
      setStatus({ kind: 'ready', tree, convId });
      // If an open draft's real message has now landed in the tree, drop the
      // placeholder so the two never show side by side (the "duplicate on
      // refresh"). Batched with setStatus → single render, no overlap frame.
      const d = draftRef.current;
      if (d && draftRealized(tree, d)) {
        // The draft answer was in the in-line preview reader; keep the real answer
        // node expanded in that same state (now with the final text) instead of
        // collapsing it to a snippet.
        const answer = tree.orderedNodes.find(
          (n) => n.role === 'assistant' && n.assistantId != null && !!d.createdUuids?.includes(n.assistantId),
        );
        if (answer) setPreviewIds((prev) => (prev.has(answer.id) ? prev : new Set(prev).add(answer.id)));
        setDraft(null);
      }
    } catch (e) {
      if (req !== reqRef.current) return;
      const msg = e instanceof PlatformApiError
        ? e.status === 403 || e.status === 401
          ? `Not authenticated to ${platform.siteName}. Reload the tab and sign in.`
          : `${platform.siteName} API error: ${e.status}`
        : e instanceof Error
          ? e.message
          : 'Unknown error loading conversation';
      setStatus({ kind: 'error', message: msg });
    }
  }, [platform]);

  useEffect(() => {
    if (!open) return;
    // Capture the conv we opened against — switching to a different chat closes
    // the panel (Option 1 by user request). Query-string-only changes on the
    // same conv are ignored.
    const initialConvId = platform.parseConversationId();
    void load();
    const unwatchUrl = watchUrl(() => {
      const cur = platform.parseConversationId();
      if (cur !== initialConvId) {
        setOpen(false);
      }
    });
    // Same-chat updates (new message, edit) still refresh the graph — cheap and
    // keeps the tree in sync while you're working in one conversation. But PAUSE
    // while a draft is open: a completion lands the new message in the native chat
    // mid-stream, which would otherwise refetch and surface the real node next to
    // our still-showing draft placeholder (a visible duplicate). We refetch once
    // ourselves when the draft completes.
    const unwatchConv = watchConversation(() => {
      if (draftRef.current) return;
      void load();
    }, 800);
    return () => {
      unwatchUrl();
      unwatchConv();
    };
  }, [open, load]);

  // A platform may resolve media URLs asynchronously after the first load
  // (ChatGPT fetches image URLs lazily to avoid rate-limiting). When it signals
  // that new ones are ready, re-render so the thumbnails appear — a same-conv
  // reload keeps the current tree, so this is flicker-free. Platforms that resolve
  // media synchronously never emit the event, so this is inert for them.
  useEffect(() => {
    if (!open) return;
    let t = 0;
    const onResolved = () => {
      clearTimeout(t);
      t = window.setTimeout(() => void load(), 150);
    };
    window.addEventListener('cg-media-resolved', onResolved);
    return () => {
      window.removeEventListener('cg-media-resolved', onResolved);
      clearTimeout(t);
    };
  }, [open, load]);

  // A platform may pace its own requests to respect a strict rate limit (ChatGPT's
  // conversation endpoint). When it has to wait, it signals so we can show a brief
  // note instead of a silent long load. Inert for platforms that never emit it.
  useEffect(() => {
    if (!open) return;
    const onRateLimited = () => setToast('ChatGPT is rate-limiting — the graph will refresh in a moment.');
    window.addEventListener('cg-rate-limited', onRateLimited);
    return () => window.removeEventListener('cg-rate-limited', onRateLimited);
  }, [open]);

  // Auto-dismiss the toast. The "not loaded" hint is transient guidance, so it
  // clears fast (2s); other toasts (errors, branch-switch notices) stay 3.5s.
  useEffect(() => {
    if (!toast) return;
    const ms = toast === UNREACHABLE_TOAST ? 2000 : 3500;
    const id = window.setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc steps out one level: full-screen → side panel → closed.
      if (e.key === 'Escape' && open) {
        if (fullscreen) setFullscreen(false);
        else setOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, fullscreen]);

  const handleNodeClick = useCallback(
    async (node: DisplayNode) => {
      // Click-to-jump works in full-screen too: it switches the active branch
      // (updating the graph's active-path highlight) and leaves the native chat
      // — hidden behind the graph — scrolled to that branch for when you exit.
      const convId = platform.parseConversationId();
      if (!convId) return;
      // In full-screen the chat is hidden, so its scroll won't stick — remember
      // this node so we replay the scroll when the user exits full-screen.
      if (fullscreenRef.current) fsJumpTargetRef.current = node;

      // When a jump can't reach the target message, tell the user why instead of
      // silently doing nothing. This only applies to platforms whose history is
      // lazy-loaded and can't be scroll-searched (ChatGPT — dom.scrollSearch ===
      // false): the message just isn't in the page yet. Claude mounts virtualized
      // bubbles via scroll-search, so `centered` is reliable there and this never
      // fires — its behavior is unchanged. Suppressed in full-screen, where the
      // chat is hidden and the scroll is replayed on exit.
      const warnIfUnreachable = (centered?: boolean) => {
        if (centered || fullscreenRef.current) return;
        if (platform.dom.scrollSearch === false) {
          setToast(UNREACHABLE_TOAST);
        }
      };

      if (node.isOnActivePath || !platform.capabilities.serverBranchSwitch) {
        // Already active, or read-only platform — just scroll the chat to it. The
        // reveal step (ChatGPT's prompt rail) can take a few seconds, so show the
        // spinner while it runs. Claude has no revealNode → no spinner (unchanged).
        const spin = !!platform.revealNode;
        if (spin) setJumping(node.id);
        const result = await jumpToNode(platform, convId, node);
        if (spin) setJumping(null);
        warnIfUnreachable(result.centered);
        return;
      }
      setJumping(node.id);
      const result = await jumpToNode(platform, convId, node);
      setJumping(null);
      if (!result.ok) {
        setToast(result.error ?? 'Could not switch branch');
        return;
      }
      if (!result.refreshed) {
        setToast('Branch set — reload the chat to see it');
      }
      // Remember the jumped-to branch so the highlight follows it on platforms
      // that don't persist the selection server-side (ChatGPT).
      if (!platform.capabilities.serverPersistsActiveBranch) {
        selectedLeafRef.current = node.leafId;
      }
      // The branch switched; if we still couldn't scroll to the message it isn't
      // loaded in the page — say so rather than leave the user wondering.
      warnIfUnreachable(result.centered);
      // Re-fetch so the graph's active-path highlight follows the jump.
      void load();
    },
    [load, platform],
  );

  // ---- Quick actions via a floating draft node ----
  // Runs the completion for a draft that has flipped to `generating`. Keeps the
  // placeholder visible, fires the request (abortable), then re-renders the native
  // chat and refetches our graph. claude.ai sets current_leaf server-side, so the
  // new branch becomes the active path automatically. Cleared AFTER load() so the
  // real branch is present before the placeholder disappears.
  const runCompletion = useCallback(
    async (d: Draft, prompt: string) => {
      const convId = platform.parseConversationId();
      if (!convId) {
        setToast('No active conversation');
        setDraft(null);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      // Stream the answer into the draft node, coalescing deltas to ~12 paints/sec.
      // The answer renders as markdown (re-parsed each flush), so a throttle well
      // above frame rate keeps a fast stream from thrashing parse + React state.
      let acc = '';
      let streamTimer: number | null = null;
      const onDelta = (delta: string) => {
        acc += delta;
        if (streamTimer != null) return;
        streamTimer = window.setTimeout(() => {
          streamTimer = null;
          setDraft((cur) => (cur && cur.status === 'generating' ? { ...cur, streamText: acc } : cur));
        }, 80);
      };
      // Record the created message UUIDs so a subsequent load drops the draft once
      // the real node lands (no placeholder/real duplicate). The new assistant is
      // always new; for edit/follow-up the parent is the NEW human (also match it),
      // but for regenerate the parent is the EXISTING human, so skip it there.
      const onStart = ({ assistantUuid, parentUuid }: { assistantUuid?: string; parentUuid?: string }) => {
        const ids = [assistantUuid];
        if (d.kind !== 'regenerate') ids.push(parentUuid);
        const created = ids.filter((u): u is string => !!u);
        if (created.length) {
          setDraft((cur) => (cur && cur.status === 'generating' ? { ...cur, createdUuids: created } : cur));
        }
      };
      try {
        if (d.isRetry) {
          await platform.retryCompletion({ convId, parentMessageUuid: d.parentMessageUuid, signal: controller.signal, onDelta, onStart });
        } else {
          await platform.createCompletion({ convId, parentMessageUuid: d.parentMessageUuid, prompt, signal: controller.signal, onDelta, onStart });
        }
        // A completed write ends in a real send, which the platform persists as the
        // new active branch (ChatGPT advances current_node). Drop any manual
        // branch-jump override so the refetch highlights the freshly created branch
        // instead of snapping back to the pre-write leaf. Inert on platforms that
        // persist branch selection server-side (Claude never sets this ref), so
        // their active-path behavior is unchanged.
        if (!platform.capabilities.serverPersistsActiveBranch) {
          selectedLeafRef.current = null;
        }
        await requestRefresh();
        await load();
      } catch (e) {
        const aborted =
          controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
        if (!aborted) setToast(e instanceof Error ? e.message : 'Generation failed');
      } finally {
        if (streamTimer != null) clearTimeout(streamTimer);
        if (abortRef.current === controller) abortRef.current = null;
        setDraft(null);
      }
    },
    [load, platform],
  );

  // Open an editable draft (no-op if one is already open — the buttons are locked,
  // but guard anyway).
  const startEdit = useCallback((node: DisplayNode) => {
    setDraft((cur) =>
      cur ?? {
        kind: 'edit',
        parentDisplayId: node.parentId,
        parentMessageUuid: node.questionParentId ?? platform.rootParentUuid,
        isRetry: false,
        title: node.fullText,
        editable: true,
        status: 'editing',
        model: convModel,
      },
    );
  }, [convModel, platform]);
  const startFollowup = useCallback((node: DisplayNode) => {
    if (!node.assistantId) return;
    const parentMessageUuid = node.assistantId;
    setDraft((cur) =>
      cur ?? {
        kind: 'followup',
        parentDisplayId: node.id,
        parentMessageUuid,
        isRetry: false,
        title: '',
        editable: true,
        status: 'editing',
        model: convModel,
      },
    );
  }, [convModel]);

  // Regenerate has no text input: spawn a read-only generating copy and fire now.
  const regenerate = useCallback(
    (node: DisplayNode) => {
      if (draft) return;
      const d: Draft = {
        kind: 'regenerate',
        parentDisplayId: node.parentId,
        parentMessageUuid: node.humanId,
        isRetry: true,
        title: node.fullText,
        editable: false,
        status: 'generating',
        model: convModel,
      };
      setDraft(d);
      void runCompletion(d, '');
    },
    [draft, runCompletion, convModel],
  );

  // Submit an editable draft: flip it to generating (showing the typed text) and run.
  const submitDraft = useCallback(
    (text: string) => {
      if (!draft || !draft.editable) return;
      const next: Draft = { ...draft, status: 'generating', title: text };
      setDraft(next);
      void runCompletion(next, text);
    },
    [draft, runCompletion],
  );

  const cancelDraft = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDraft(null);
  }, []);

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

  // Presentation slice for the active platform (assistant label/icon + whether to
  // show write-action buttons). Consumed via context by the node/preview cards.
  const platformUI: PlatformUI = useMemo(() => {
    // ChatGPT turns can be media-only (generated/uploaded images with no text) and
    // its images are large/portrait — both drive richer media presentation. Off
    // for Claude, so its node/hover rendering is unchanged.
    const mediaRich = platform.id === 'chatgpt';
    return {
      assistantLabel: platform.assistantLabel,
      AssistantIcon: assistantIconFor(platform.id),
      showActions:
        platform.capabilities.edit ||
        platform.capabilities.followup ||
        platform.capabilities.regenerate,
      mediaOnlyNodes: mediaRich,
      fitHoverImage: mediaRich,
    };
  }, [platform]);

  // Style the toggle from anchor coords
  const toggleStyle: React.CSSProperties = anchor
    ? {
        ['--cg-toggle-x' as never]: `${anchor.x}px`,
        ['--cg-toggle-y' as never]: `${anchor.y}px`,
        ['--cg-toggle-vis' as never]: anchor.visible ? 'visible' : 'hidden',
      }
    : { ['--cg-toggle-vis' as never]: 'hidden' };

  return (
    <PlatformUIProvider value={platformUI}>
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
          data-fullscreen={fullscreen ? 'true' : 'false'}
          style={{ ['--cg-panel-w' as never]: `${panelW}px` }}
        >
          <div
            className="cg-resize"
            data-dragging={dragging ? 'true' : 'false'}
            onMouseDown={onResizeStart}
            title="Drag to resize"
          />
          <div className="cg-toolbar cg-toolbar-main">
            <h1>Conversation graph</h1>
            <div className="cg-spacer" />
            {openPreviews.length > 1 && (
              <button onClick={tidyPreviews} data-tip="Tidy previews">⊞</button>
            )}
            <button onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))} data-tip="Switch orientation">
              {direction === 'TB' ? '↓' : '→'}
            </button>
            <button onClick={() => void load()} data-tip="Refresh">↻</button>
            <button
              className="cg-iconbtn"
              onClick={() => setFullscreen((v) => !v)}
              data-tip={fullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'}
              aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
              aria-pressed={fullscreen}
            >
              {fullscreen ? <ExitFullscreenIcon size={14} /> : <FullscreenIcon size={14} />}
            </button>
            <button onClick={() => setOpen(false)} data-tip="Close (Esc)">✕</button>
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
              onOpenMedia={openMedia}
              previewIds={previewIds}
              onToggleInlinePreview={toggleInlinePreview}
              jumpingId={jumping}
              draft={draft}
              locked={draft != null}
              lockReason={
                draft
                  ? draft.status === 'generating'
                    ? 'Generating… wait for it to finish before starting another action'
                    : 'Finish or cancel the open draft first'
                  : undefined
              }
              onStartEdit={startEdit}
              onStartFollowup={startFollowup}
              onRegenerate={regenerate}
              onCancelDraft={cancelDraft}
              onSubmitDraft={submitDraft}
            />
          ) : (
            <div className="cg-empty">
              {status.kind === 'loading'
                ? 'Loading conversation tree…'
                : status.kind === 'no-conversation'
                  ? `Open any chat on ${platform.siteName}, then press ⌘⇧G.`
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
          fontPx={previewFontPx}
          onFontPx={setPreviewFontPx}
          onClose={closePreview}
          onFocus={focusPreview}
          onGeometry={setPreviewGeometry}
        />
      )}
    </PlatformUIProvider>
  );
}
