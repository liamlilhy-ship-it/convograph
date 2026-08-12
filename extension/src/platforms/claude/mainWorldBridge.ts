/**
 * MAIN-world content script.
 *
 * Our panel runs in Chrome's isolated world and cannot touch claude.ai's React
 * fiber tree or `window.__TSR_ROUTER__`. This tiny script runs in the page's
 * own JS context and exposes ONE capability over a DOM CustomEvent: re-render
 * the conversation after we've changed the active branch via the API.
 *
 * Protocol:
 *   isolated world  →  dispatch `cg-refresh-conversation` on window
 *   main world      →  invalidate the TanStack Query cache for the chat tree
 *                      →  dispatch `cg-refresh-conversation-done` { ok }
 */

export {}; // module scope (isolates the constants below from other bridges)

const REQUEST = 'cg-refresh-conversation';
const DONE = 'cg-refresh-conversation-done';

type QueryClientish = {
  invalidateQueries: (filters?: { queryKey?: unknown[] }) => Promise<unknown> | unknown;
  getQueryCache: () => unknown;
};

function looksLikeQueryClient(v: unknown): v is QueryClientish {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as QueryClientish).invalidateQueries === 'function' &&
    typeof (v as QueryClientish).getQueryCache === 'function'
  );
}

/**
 * Walks up the React fiber tree from a chat DOM node looking for the QueryClient
 * stashed in a context provider's memoizedProps.value. Returns null if not found.
 */
function findQueryClient(): QueryClientish | null {
  const start =
    document.querySelector('[data-testid="user-message"], [data-user-message-bubble]') ??
    document.querySelector('main') ??
    document.body;
  if (!start) return null;
  const fiberKey = Object.keys(start).find((k) => k.startsWith('__reactFiber$'));
  if (!fiberKey) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (start as any)[fiberKey];
  let hops = 0;
  while (fiber && hops < 600) {
    hops++;
    const props = fiber.memoizedProps;
    if (props && typeof props === 'object') {
      for (const key of Object.keys(props)) {
        if (looksLikeQueryClient(props[key])) return props[key];
      }
    }
    fiber = fiber.return;
  }
  return null;
}

async function refreshConversation(): Promise<boolean> {
  const qc = findQueryClient();
  if (qc) {
    try {
      await qc.invalidateQueries({ queryKey: ['chat_conversation_tree'] });
      return true;
    } catch {
      /* fall through to router */
    }
  }
  // Fallback: TanStack Router invalidate (re-runs route loaders).
  const router = (window as unknown as { __TSR_ROUTER__?: { invalidate?: () => Promise<unknown> } })
    .__TSR_ROUTER__;
  if (router?.invalidate) {
    try {
      await router.invalidate();
      return true;
    } catch {
      /* nothing else to try */
    }
  }
  return false;
}

window.addEventListener(REQUEST, () => {
  void refreshConversation().then((ok) => {
    window.dispatchEvent(new CustomEvent(DONE, { detail: { ok } }));
  });
});
