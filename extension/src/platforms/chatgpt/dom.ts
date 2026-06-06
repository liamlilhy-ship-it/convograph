import type { PlatformDom } from '../types';

/**
 * ChatGPT DOM hooks (best-effort for read-only v1 — used only for scroll-to-bubble
 * and anchoring the toggle). ChatGPT marks user turns with
 * `[data-message-author-role="user"]` and the composer is `#prompt-textarea`.
 */
export const chatgptDom: PlatformDom = {
  findScroller() {
    // The message list lives in a scrollable container inside <main>. The exact
    // class is unstable, so prefer an overflow-y container, falling back to main.
    const main = document.querySelector<HTMLElement>('main');
    if (main) {
      const scroller = main.querySelector<HTMLElement>('[class*="overflow-y-auto"], [class*="react-scroll-to-bottom"]');
      if (scroller) return scroller;
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
