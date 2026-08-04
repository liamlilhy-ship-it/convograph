import type { Platform } from '../platforms/types';

export type AnchorPosition = { x: number; y: number; visible: boolean };

export type AnchorOpts = {
  /** Horizontal offset from the right edge of the composer (px, into the composer = positive). */
  insetRight?: number;
  /** Vertical offset above the composer top (px upward = positive). */
  liftAbove?: number;
};

/**
 * Computes the on-screen position for an absolutely-positioned pill that should
 * sit just above the top-right corner of the platform's composer. Returns null
 * when the composer cannot be found.
 */
export function computeAnchor(
  platform: Platform,
  toggleEl: HTMLElement,
  opts: AnchorOpts = {},
): AnchorPosition | null {
  if (platform.isSupportedSurface && !platform.isSupportedSurface(location.href)) return null;
  const composer = platform.dom.findComposer();
  if (!composer) return null;
  const rect = composer.getBoundingClientRect();
  const togW = toggleEl.offsetWidth || 90;
  const togH = toggleEl.offsetHeight || 28;
  const { insetRight = 8, liftAbove = togH + 6 } = opts;
  const visible = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
  return {
    x: Math.max(8, Math.min(window.innerWidth - togW - 8, rect.right - togW - insetRight)),
    y: Math.max(8, rect.top - liftAbove),
    visible,
  };
}

/**
 * Tracks the composer position and calls onUpdate with new coordinates whenever
 * it moves (scroll, resize, layout shifts, claude.ai content reflow, etc).
 */
export function trackComposerAnchor(
  platform: Platform,
  toggleEl: HTMLElement,
  onUpdate: (pos: AnchorPosition | null) => void,
  opts: AnchorOpts = {},
): () => void {
  let raf = 0;
  const tick = () => {
    raf = 0;
    onUpdate(computeAnchor(platform, toggleEl, opts));
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  };
  schedule();
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    mo.disconnect();
  };
}
