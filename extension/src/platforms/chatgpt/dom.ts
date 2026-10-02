import type { PlatformDom } from '../types';

/**
 * ChatGPT DOM hooks (best-effort for read-only v1 — used only for scroll-to-bubble
 * and anchoring the toggle). ChatGPT marks user turns with
 * `[data-message-author-role="user"]` and the composer is `#prompt-textarea`.
 */
export const chatgptDom: PlatformDom = {
  findScroller() {
    // The scroll container is an ANCESTOR of <main> (main itself is
    // overflow:visible — verified live). Walk up to the nearest overflow-y
    // auto/scroll element; fall back to main.
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return null;
    let el = main.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
      el = el.parentElement;
    }
    return main;
  },
  findQuestionBubbles() {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]'));
  },
  findBubbleByNodeId(id) {
    // A turn's normalized id equals its `data-message-id` in the DOM, so we can
    // locate the bubble directly — works for image-only turns that have no text.
    return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
  },
  findComposer() {
    // An in-app navigation leaves the previous chats mounted but hidden, each
    // with its own composer AHEAD of the live one in document order — so take
    // the rendered match, not the first.
    const editable = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#prompt-textarea, form [contenteditable="true"], form textarea',
      ),
    ).find((el) => el.checkVisibility());
    if (!editable) return null;
    return editable.closest('form') ?? editable;
  },
  scrollTopMargin: 72,
  // ChatGPT's popovers (the composer "+" menu, the model picker, the profile
  // menu) all mount a `.popover` element and unmount it on close. The "+" menu
  // is stuck inside a z-0 stacking context (see platform.ts hostZIndex note),
  // so the pill can't be layered under it — hide the pill while any popover is
  // open instead. Dialogs get the same treatment: the full-screen image editor
  // is a `[role="dialog"]` whose body-level portal wrapper is z 0 (its z-120 is
  // internal), so it too can't out-layer the pill — and it mounts its own
  // near-identical composer while the chat composer stays behind it, which
  // would mis-anchor the pill. Those unmount when closed, but since Oct 2026
  // every conversation page also keeps a quick-chat frame mounted — a
  // `[role="dialog"]` parked inside a display:none wrapper — so only a RENDERED
  // match counts. The anchor tracker's MutationObserver re-runs this on DOM
  // changes, so the pill returns as soon as the overlay closes.
  isObscuredByOverlay() {
    return Array.from(document.querySelectorAll('.popover, [role="dialog"]')).some((el) =>
      el.checkVisibility(),
    );
  },
  // ChatGPT lazy-loads history (only the few most recent messages are in the
  // DOM) and a programmatic scroll won't fetch older ones — so don't scroll-search.
  scrollSearch: false,
};
