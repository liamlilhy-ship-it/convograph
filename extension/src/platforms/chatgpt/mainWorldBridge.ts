/**
 * ChatGPT MAIN-world refresh bridge. Read-only v1 doesn't switch branches, so it
 * just acknowledges the `cg-refresh-conversation` request as a no-op (the panel
 * refetches its own graph from the API regardless). When branch-switching lands,
 * this is where ChatGPT's SPA re-render hook goes.
 */
export {}; // module scope (isolates the constants below from other bridges)

const REQUEST = 'cg-refresh-conversation';
const DONE = 'cg-refresh-conversation-done';

window.addEventListener(REQUEST, () => {
  window.dispatchEvent(new CustomEvent(DONE, { detail: { ok: false } }));
});
