/**
 * ChatGPT MAIN-world bridge.
 *
 * Refresh: ChatGPT has no branch switch to re-render after, so the
 * `cg-refresh-conversation` request is acknowledged as a no-op (the panel
 * refetches its own graph from the API regardless).
 *
 * Reveal: `cg-chatgpt-reveal-message` (detail = a message id) opens the chat at
 * that message through ChatGPT's own deep link — see reveal.ts. It runs here, in
 * the page's world, because ChatGPT's router is what must react to it.
 */
export {}; // module scope (isolates the constants below from other bridges)

const REQUEST = 'cg-refresh-conversation';
const DONE = 'cg-refresh-conversation-done';
const REVEAL_REQUEST = 'cg-chatgpt-reveal-message';

window.addEventListener(REQUEST, () => {
  window.dispatchEvent(new CustomEvent(DONE, { detail: { ok: false } }));
});

window.addEventListener(REVEAL_REQUEST, (e) => {
  const id = (e as CustomEvent).detail;
  if (typeof id !== 'string' || !id) return;
  // Keep the current pathname (project chats live under /g/g-p-…/c/<id>), and
  // replace rather than push so a jump doesn't add a Back-button entry.
  history.replaceState(history.state, '', `${location.pathname}?messageId=${encodeURIComponent(id)}`);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
});
