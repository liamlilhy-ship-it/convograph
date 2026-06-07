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
  /** Can clicking a node switch the active branch (Claude: current_leaf PUT;
   *  ChatGPT: drives the native < / > arrows)? When false, a click only scrolls. */
  serverBranchSwitch: boolean;
  /** Does the platform persist the active branch server-side (Claude: yes — a
   *  re-fetch reflects the switch)? When false (ChatGPT — branch selection is
   *  client-only), the app keeps the highlight on the clicked branch locally and
   *  the jump skips the SPA-refresh step (the DOM switch already applied). */
  serverPersistsActiveBranch: boolean;
  edit: boolean;
  followup: boolean;
  regenerate: boolean;
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
  readonly dom: PlatformDom;

  parseConversationId(href?: string): string | null;
  /** Fetch + normalize the conversation (each provider does its own auth). */
  fetchConversation(convId: string): Promise<NormalizedConversation>;
  /** Switch the active branch to the node's leaf. Only called when
   *  `capabilities.serverBranchSwitch` is true. */
  setActiveLeaf(convId: string, node: DisplayNode): Promise<void>;
  createCompletion(params: CompletionParams): Promise<void>;
  retryCompletion(params: RetryParams): Promise<void>;
  detectTheme(): ThemeName;
  /** Reserve room on the right for the half-mode side panel so the chat sits
   *  beside it instead of underneath. Returns a cleanup that restores the page.
   *  Mechanism is platform-specific (the page layouts differ). */
  applySidePanelInset(width: number): () => void;
}
