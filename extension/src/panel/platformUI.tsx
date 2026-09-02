import { createContext, useContext, type ReactNode } from 'react';
import { ClaudeIcon, ChatGptIcon } from './icons';

/**
 * The small slice of platform identity the presentation layer needs: what to call
 * the assistant, which icon to show for it, and whether to render the write-action
 * buttons (edit / follow-up / regenerate). Provided by App from the active
 * `Platform`; defaults to Claude so any component rendered without a provider
 * looks exactly as it did before the platform split.
 */

type IconCmp = (p: { size?: number }) => ReactNode;

export type PlatformUI = {
  assistantLabel: string;
  AssistantIcon: IconCmp;
  /** Render the quick-action buttons. False for read-only platforms. */
  showActions: boolean;
  /** Some platforms have media-only turns (e.g. a generated image with no text).
   *  When true, a node with media but no text renders just its media instead of an
   *  "(empty)" placeholder. Default (Claude): keep the placeholder. */
  mediaOnlyNodes?: boolean;
  /** Fit a hovered image to the viewport (preserve aspect ratio, reposition to
   *  stay on-screen) instead of the fixed-size hover box. For platforms with large
   *  or portrait images. Default (Claude): unchanged fixed-size hover. */
  fitHoverImage?: boolean;
  /** Write actions (edit / regenerate / follow-up) only work on the active branch
   *  because the platform can't switch branches in place (ChatGPT) — the buttons
   *  on off-branch nodes render disabled with an explanatory tooltip. Default
   *  (Claude): undefined → unchanged. */
  writesRequireActivePath?: boolean;
};

const DEFAULT: PlatformUI = {
  assistantLabel: 'Claude',
  AssistantIcon: ClaudeIcon,
  showActions: true,
};

const PlatformUIContext = createContext<PlatformUI>(DEFAULT);

export const PlatformUIProvider = PlatformUIContext.Provider;
export const usePlatformUI = (): PlatformUI => useContext(PlatformUIContext);

/** The assistant icon for a platform id (visual identity stays out of the
 *  platform-neutral interface). */
export function assistantIconFor(id: string): IconCmp {
  return id === 'chatgpt' ? ChatGptIcon : ClaudeIcon;
}
