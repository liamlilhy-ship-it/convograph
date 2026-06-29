import type { Platform, ThemeName } from '../types';
import {
  cachedRawConversation,
  getConversation,
  getNormalizedConversation,
  parseConversationIdFromUrl,
} from './client';
import { isReversiblySwitchable, switchToLeaf } from './branchSwitch';
import { detectActiveLeafFromDom } from './activeLeaf';
import { revealNodeViaRail } from './promptRail';
import { createCompletion, retryCompletion } from './writes';
import { chatgptDom } from './dom';
import { resolveTheme } from '../theme';
import tokensCss from './tokens.css?inline';

/**
 * The ChatGPT platform. It fetches + normalizes the conversation so the graph,
 * hover/previews, and scroll-to-bubble work, and drives ChatGPT's native UI for
 * the write actions: branch switch (the < n/m > arrows, branchSwitch.ts) and
 * edit / follow-up / regenerate (writes.ts). There's no server-side write API we
 * call — every mutation is the faithful equivalent of a user clicking the page.
 */

function detectTheme(): ThemeName {
  return resolveTheme();
}

// ChatGPT sizes its UI off the VIEWPORT, not the document flow: the shell that
// wraps <main> is `w-screen` (width: 100vw), so padding <html>/<body> can't shrink
// it (verified live — <main> stayed full width). Instead we cap that one shell at
// calc(100vw - panel); its `w-full`/`flex-1` descendants reflow beside the panel.
function findViewportShell(): HTMLElement | null {
  const main = document.querySelector('main');
  if (!main) return null;
  // The explicit full-viewport shell (Tailwind `w-screen`).
  const byClass = main.closest<HTMLElement>('.w-screen');
  if (byClass) return byClass;
  // Fallback: nearest ancestor as wide as the viewport.
  let el = main.parentElement;
  while (el && el !== document.body) {
    if (Math.abs(el.getBoundingClientRect().width - window.innerWidth) < 2) return el;
    el = el.parentElement;
  }
  return null;
}

function applySidePanelInset(width: number): () => void {
  const shell = findViewportShell();
  if (!shell) return () => {};
  const prevWidth = shell.style.width;
  const prevMaxWidth = shell.style.maxWidth;
  const prevTransition = shell.style.transition;
  const inset = `calc(100vw - ${width}px)`;
  shell.style.transition = 'width 180ms ease';
  shell.style.width = inset;
  shell.style.maxWidth = inset;
  return () => {
    shell.style.width = prevWidth;
    shell.style.maxWidth = prevMaxWidth;
    shell.style.transition = prevTransition;
  };
}

export const ChatGptPlatform: Platform = {
  id: 'chatgpt',
  siteName: 'chatgpt.com',
  hostnames: ['chatgpt.com', 'chat.openai.com'],
  assistantLabel: 'ChatGPT',
  // Branch switching and content writes (edit/followup/regenerate) are driven on
  // the native UI; branch selection is client-only (not persisted server-side, so
  // serverPersistsActiveBranch stays false), but edit/followup/regenerate end in a
  // real send that ChatGPT persists, after which the app refetches the graph.
  // search is off: ChatGPT's tree is fetched/paged differently and history is
  // lazy-loaded, so a whole-tree search isn't supported in v1.
  capabilities: { serverBranchSwitch: true, serverPersistsActiveBranch: false, edit: true, followup: true, regenerate: true, search: false },
  rootParentUuid: '',
  tokensCss,
  dom: chatgptDom,

  parseConversationId: (href) => parseConversationIdFromUrl(href),
  fetchConversation: (convId) => getConversation(convId),
  // ChatGPT's native arrows are client-only, so the active branch lives in the
  // DOM, not the fetched conversation — read it from there (see activeLeaf.ts).
  detectActiveLeaf: (conv) => detectActiveLeafFromDom(conv),
  async setActiveLeaf(convId, node) {
    const conv = await getNormalizedConversation(convId);
    // Pass the raw conversation so switchToLeaf can reveal an off-window branch
    // point's arrow control via the prompt rail before driving it.
    const ok = await switchToLeaf(conv, node.leafId, cachedRawConversation(convId) ?? undefined);
    if (!ok) throw new Error('Could not switch to that branch in ChatGPT');
  },
  // A regenerate branch whose answer is image-only has no version arrows, so it
  // can't be switched back from — report it non-switchable so the app blocks the
  // switch up front instead of stranding the user (see branchSwitch.ts).
  async canSwitchToNode(node) {
    const convId = parseConversationIdFromUrl();
    if (!convId) return true;
    const conv = await getNormalizedConversation(convId);
    return isReversiblySwitchable(conv, node.leafId);
  },
  // Reach a lazy-unloaded message via ChatGPT's prompt rail (see promptRail.ts).
  // Uses the RAW conversation (load() has cached it) so the prompt index matches
  // ChatGPT's own rail exactly — the normalized tree can drift by merged turns.
  async revealNode(node) {
    const convId = parseConversationIdFromUrl();
    if (!convId) return false;
    const raw = cachedRawConversation(convId);
    if (!raw) return false;
    return revealNodeViaRail(raw, node);
  },
  createCompletion,
  retryCompletion,
  detectTheme,
  applySidePanelInset,
};
