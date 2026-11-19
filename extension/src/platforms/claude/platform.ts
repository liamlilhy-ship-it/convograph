import type { Platform, ThemeName } from '../types';
import { getOrgId, getConversationTree, parseConversationIdFromUrl, isSupportedSurface } from './client';
import { createCompletion, retryCompletion, ROOT_PARENT_UUID } from './writes';
import { claudeDom } from './dom';
import { detectActiveLeafFromDom } from './activeLeaf';
import { resolveTheme } from '../theme';
import tokensCss from './tokens.css?inline';

/**
 * The claude.ai platform — a thin wiring shim that points the `Platform`
 * interface at the claude.ai client/writes/dom/tokens. It holds no behavioral
 * logic of its own beyond caching the org id.
 */

// Cache the org id for the page session, re-fetching only if a prior fetch
// failed (mirrors App's old `if (!orgIdRef.current) orgIdRef.current = await …`).
let orgIdPromise: Promise<string> | null = null;
function orgId(): Promise<string> {
  if (!orgIdPromise) {
    orgIdPromise = getOrgId().catch((e) => {
      orgIdPromise = null;
      throw e;
    });
  }
  return orgIdPromise;
}

// claude.ai signals dark mode only via `color-scheme` / a dark background (its
// <html> carries a named `data-theme="claude"`, not a dark/light token), so the
// shared resolver — not a class check — is what gets this right. See ../theme.ts.
function detectTheme(): ThemeName {
  return resolveTheme();
}

// Make room for the side panel by padding the document element — claude.ai's
// content reflows into the narrowed width. This is verbatim the behavior the
// panel has always had on claude.ai.
function applySidePanelInset(width: number): () => void {
  const html = document.documentElement;
  const prev = html.style.getPropertyValue('--cg-host-push');
  const prevTransition = html.style.transition;
  html.style.transition = 'padding-right 180ms ease';
  html.style.paddingRight = `${width}px`;
  html.style.boxSizing = 'border-box';
  return () => {
    html.style.paddingRight = '';
    html.style.transition = prevTransition;
    if (prev) html.style.setProperty('--cg-host-push', prev);
  };
}

export const ClaudePlatform: Platform = {
  id: 'claude',
  siteName: 'claude.ai',
  hostnames: ['claude.ai'],
  assistantLabel: 'Claude',
  // No branch switching: since Nov 2026 claude.ai has no in-place way to show an
  // older branch (its version arrows are gone, and the chat no longer follows the
  // server's current leaf — see activeLeaf.ts). So, like ChatGPT, a click on an
  // off-branch node opens its preview, the write actions only work on the branch
  // shown in the chat, and the shown branch is read from the DOM.
  capabilities: { serverBranchSwitch: false, serverPersistsActiveBranch: false, edit: true, followup: true, regenerate: true, search: true },
  rootParentUuid: ROOT_PARENT_UUID,
  tokensCss,
  // claude.ai's layer scale (measured 2026-07): header 10, sidebar 20, tooltips
  // 30 | menus 120, popovers 130, modals 140. 100 keeps the pill/panel above all
  // persistent chrome (full-screen still covers the sidebar) while claude.ai's
  // menus and modals paint on top.
  hostZIndex: 100,
  dom: claudeDom,

  parseConversationId: (href) => parseConversationIdFromUrl(href),

  isSupportedSurface,

  async fetchConversation(convId) {
    return getConversationTree(await orgId(), convId);
  },

  detectActiveLeaf: (conv) => detectActiveLeafFromDom(conv),

  // Writes drive claude.ai's own controls (see writes.ts); the tree tells an edit
  // from a follow-up.
  async createCompletion(params) {
    await createCompletion(await getConversationTree(await orgId(), params.convId), params);
  },

  retryCompletion,

  detectTheme,
  applySidePanelInset,
};
