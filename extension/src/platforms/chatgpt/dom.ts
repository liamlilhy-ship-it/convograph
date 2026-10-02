import type { PlatformDom } from '../types';
import { liveThread, turnEl, userBubbles } from './selectors';

/**
 * ChatGPT DOM hooks (scroll-to-bubble and anchoring the toggle). The thread
 * lookups live in selectors.ts.
 */
export const chatgptDom: PlatformDom = {
  findScroller() {
    return liveThread();
  },
  findQuestionBubbles() {
    return userBubbles();
  },
  findBubbleByNodeId(id) {
    // A question's node id is its turn's `data-turn-key`, so we can locate the
    // turn directly — works for image-only turns that have no text.
    return turnEl(id);
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
  // ChatGPT lazy-loads history (only the few most recent turns are in the DOM),
  // so don't scroll-search — an unrendered message is reached through
  // platform.revealNode (reveal.ts) instead.
  scrollSearch: false,
};
