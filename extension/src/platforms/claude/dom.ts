import type { PlatformDom } from '../types';

/**
 * claude.ai DOM hooks. These are the exact selectors the navigation/anchoring
 * code used inline before the platform split:
 *   - scroller : `[data-autoscroll-container]` (the chat scroll container)
 *   - bubbles  : `[data-testid="user-message"]` (rendered question bubbles;
 *                claude.ai dropped the older `data-user-message-bubble` attribute
 *                in Aug 2026 — keep both while the rollout may be cohort-split)
 *   - composer : the contenteditable/textarea, climbed to its form/fieldset
 *   - margin   : 56px to clear claude.ai's sticky header on top-align
 */
export const claudeDom: PlatformDom = {
  findScroller() {
    return document.querySelector<HTMLElement>('[data-autoscroll-container]');
  },
  findQuestionBubbles() {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="user-message"], [data-user-message-bubble]',
      ),
    );
  },
  findComposer() {
    const editable = document.querySelector<HTMLElement>(
      'div[contenteditable="true"][role="textbox"], textarea[role="textbox"]',
    );
    if (!editable) return null;
    // Prefer the whole composer box. Since Nov 2026 the editor's own row also
    // carries a "composer" class, so the class match alone lands on that inner
    // row (inside the box) and the pill overlaps the input — keep it as a
    // last resort only.
    return (
      editable.closest<HTMLElement>('[data-cds="ChatComposer"], form, fieldset') ??
      editable.closest<HTMLElement>('div[class*="composer"]') ??
      editable
    );
  },
  scrollTopMargin: 56,
};
