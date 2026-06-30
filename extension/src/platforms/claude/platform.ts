import type { Platform, ThemeName } from '../types';
import { getOrgId, getConversationTree, setCurrentLeaf, parseConversationIdFromUrl } from './client';
import { createCompletion, retryCompletion, ROOT_PARENT_UUID } from './chatClient';
import { claudeDom } from './dom';
import { resolveTheme } from '../theme';
import tokensCss from './tokens.css?inline';

/**
 * The claude.ai platform — a thin wiring shim that points the `Platform`
 * interface at the existing claude.ai client/chatClient/dom/tokens. It holds NO
 * behavioral logic of its own; every method calls a pre-existing function with
 * the same arguments it had before the platform split, so claude.ai behaves
 * exactly as it did. The only addition is caching the org id here (it used to
 * live in App's `orgIdRef`).
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
  capabilities: { serverBranchSwitch: true, serverPersistsActiveBranch: true, edit: true, followup: true, regenerate: true, search: true },
  rootParentUuid: ROOT_PARENT_UUID,
  tokensCss,
  dom: claudeDom,

  parseConversationId: (href) => parseConversationIdFromUrl(href),

  async fetchConversation(convId) {
    return getConversationTree(await orgId(), convId);
  },

  async setActiveLeaf(convId, node) {
    // The target leaf is the node's concrete childless descendant — the API
    // rejects a leaf that still has children.
    await setCurrentLeaf(await orgId(), convId, node.leafId);
  },

  async createCompletion({ convId, parentMessageUuid, prompt, signal, onDelta, onStart }) {
    await createCompletion({ orgId: await orgId(), convId, parentMessageUuid, prompt, signal, onDelta, onStart });
  },

  async retryCompletion({ convId, parentMessageUuid, signal, onDelta, onStart }) {
    await retryCompletion({ orgId: await orgId(), convId, parentMessageUuid, signal, onDelta, onStart });
  },

  detectTheme,
  applySidePanelInset,
};
