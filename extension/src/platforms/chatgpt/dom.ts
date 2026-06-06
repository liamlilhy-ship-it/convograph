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
  findComposer() {
    const editable = document.querySelector<HTMLElement>(
      '#prompt-textarea, form [contenteditable="true"], form textarea',
    );
    if (!editable) return null;
    return editable.closest('form') ?? editable;
  },
  scrollTopMargin: 72,
};
