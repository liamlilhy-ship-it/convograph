import type { NormalizedConversation } from './model';
import type { DisplayNode } from '../tree/displayTree';

/**
 * The capability surface every chat platform implements. A `Platform` is a plain
 * object (a wiring shim over a provider's client + DOM + tokens), selected by
 * hostname in `registry.ts`. The generic app (`App.tsx`, `jumpToNode.ts`,
 * `mount.tsx`) talks ONLY to this interface — never to a concrete provider and
 * never with an `if (chatgpt)` branch — so editing one platform can't affect
 * another.
 */

export type ThemeName = 'light' | 'dark';

/** UUIDs of the messages a completion creates (from the stream's start event). */
export type StreamStart = { assistantUuid?: string; parentUuid?: string };

export type CompletionParams = {
  convId: string;
  parentMessageUuid: string;
  prompt: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onStart?: (info: StreamStart) => void;
};

export type RetryParams = Omit<CompletionParams, 'prompt'>;

/** What write operations a platform supports. The app hides/disables UI for any
 *  capability that's off, so a read-only platform degrades cleanly. */
export type PlatformCapabilities = {
  /** Can clicking an off-active-path node make its branch the active one (Claude:
   *  current_leaf PUT)? When false (ChatGPT — no in-place switch exists since its
   *  Sept 2026 "See versions" modal), a click on an off-path node opens the node's
   *  preview instead, and the write actions only work on the active branch. */
  serverBranchSwitch: boolean;
  /** Does the platform persist the active branch server-side (Claude: yes — a
   *  re-fetch reflects the switch)? When false (ChatGPT — branch selection is
   *  client-only), the app keeps the highlight on the clicked branch locally and
   *  the jump skips the SPA-refresh step (the DOM switch already applied). */
  serverPersistsActiveBranch: boolean;
  edit: boolean;
  followup: boolean;
  regenerate: boolean;
  /** Can the panel search across the whole conversation tree? Requires the full
   *  tree (all branches) to be in memory — true for Claude (fetched in one call).
   *  When false the search UI never mounts. */
  search: boolean;
};

/** The DOM hooks the navigation/anchoring code needs, abstracted per platform. */
export type PlatformDom = {
  /** The scrollable chat container. */
  findScroller(): HTMLElement | null;
  /** All rendered user-message bubbles (for click-to-jump text matching). */
  findQuestionBubbles(): HTMLElement[];
  /** The message composer, used to anchor the toggle pill. */
  findComposer(): HTMLElement | null;
  /** Gap left above a bubble once aligned to top (clears the sticky header). */
  scrollTopMargin: number;
  /** Whether to walk the scroll container to mount virtualized bubbles when a
   *  target isn't currently rendered. Defaults to enabled (Claude — its bubbles
   *  mount on programmatic scroll). ChatGPT sets it false: it lazy-loads history a
   *  programmatic scroll can't fetch, so searching there just janks the chat. */
  scrollSearch?: boolean;
  /** Find a rendered bubble by its node id, for platforms whose DOM tags each
   *  message with a stable id (ChatGPT's `data-message-id`). Lets click-to-jump
   *  locate a turn with no text to match — e.g. an image-only message. Optional:
   *  platforms without it fall back to matching the question text. */
  findBubbleByNodeId?(id: string): HTMLElement | null;
  /** Whether a native overlay the pill cannot be z-layered under is currently
   *  open (ChatGPT's composer "+" menu renders at z 50 inside a z-0 stacking
   *  context, so at body level no host z-index gets beneath it). While true the
   *  pill hides so the overlay reads unobstructed. Optional: platforms whose
   *  overlays all portal to body (Claude) omit it — hostZIndex covers them. */
  isObscuredByOverlay?(): boolean;
};

export interface Platform {
  /** Stable id ('claude' | 'chatgpt'); used for keys/icons, never for app logic. */
  readonly id: string;
  /** Human site name for user-facing copy ('claude.ai' / 'chatgpt.com'). */
  readonly siteName: string;
  /** Hostnames this platform claims. */
  readonly hostnames: readonly string[];
  /** Assistant display name shown on answer nodes ('Claude' / 'ChatGPT'). */
  readonly assistantLabel: string;
  readonly capabilities: PlatformCapabilities;
  /** Sentinel parent for editing the very first message (Claude's ROOT_PARENT_UUID). */
  readonly rootParentUuid: string;
  /** Inline CSS of this platform's design tokens, injected at mount. */
  readonly tokensCss: string;
  /** z-index for the extension's host element. Lets a platform slot the pill and
   *  panel above its persistent chrome but below its transient layers (menus,
   *  popovers, modals), so native overlays paint on top. Optional: defaults to
   *  the near-maximum value (above everything). */
  readonly hostZIndex?: number;
  readonly dom: PlatformDom;

  parseConversationId(href?: string): string | null;
  /** Whether the toggle pill may show on this page. Lets a platform hide the
   *  pill on same-host surfaces that have a composer but no readable
   *  conversation (claude.ai's Design and Code apps). Optional: platforms
   *  without such surfaces omit it, and the pill shows wherever the composer
   *  is found. */
  isSupportedSurface?(href: string): boolean;
  /** Fetch + normalize the conversation (each provider does its own auth). */
  fetchConversation(convId: string): Promise<NormalizedConversation>;
  /** Read the active branch's leaf from the page DOM, for platforms whose server
   *  does NOT persist branch selection (ChatGPT — the branch shown in the chat is
   *  the truth). Returns the leaf node id, or null when it can't be determined
   *  (DOM not rendered / virtualized). Optional: platforms whose fetch already
   *  reflects the active branch (Claude) omit it, and the app uses the fetched
   *  leaf. */
  detectActiveLeaf?(conv: NormalizedConversation): string | null;
  /** Switch the active branch to the node's leaf. Required when
   *  `capabilities.serverBranchSwitch` is true; omitted otherwise. */
  setActiveLeaf?(convId: string, node: DisplayNode): Promise<void>;
  /** Bring a node's message into the DOM when the platform has lazy-unloaded it
   *  (ChatGPT — via its prompt-navigation rail). Returns true if it's now
   *  rendered/visible. Optional: platforms that keep the whole thread mounted
   *  (Claude) don't implement it, and click-to-jump falls back to best-effort. */
  revealNode?(node: DisplayNode): Promise<boolean>;
  createCompletion(params: CompletionParams): Promise<void>;
  retryCompletion(params: RetryParams): Promise<void>;
  detectTheme(): ThemeName;
  /** Reserve room on the right for the half-mode side panel so the chat sits
   *  beside it instead of underneath. Returns a cleanup that restores the page.
   *  Mechanism is platform-specific (the page layouts differ). */
  applySidePanelInset(width: number): () => void;
}
