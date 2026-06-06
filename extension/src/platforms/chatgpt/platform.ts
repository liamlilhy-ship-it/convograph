import type { Platform, ThemeName } from '../types';
import { getConversation, getNormalizedConversation, parseConversationIdFromUrl } from './client';
import { switchToLeaf } from './branchSwitch';
import { chatgptDom } from './dom';
import tokensCss from './tokens.css?inline';

/**
 * The ChatGPT platform — READ-ONLY for v1. It fetches + normalizes the
 * conversation so the graph, hover/previews, and scroll-to-bubble work, but all
 * write capabilities (branch switch, edit, follow-up, regenerate) are off, so the
 * app hides those actions. The write methods throw as a guard; the capability
 * flags ensure they're never called.
 */

function detectTheme(): ThemeName {
  const cls = document.documentElement.className;
  if (/\bdark\b/.test(cls)) return 'dark';
  if (/\blight\b/.test(cls)) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const unsupported = async (): Promise<never> => {
  throw new Error('This action is not supported on ChatGPT yet');
};

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
  // Branch switching IS supported (via native arrows), but it's client-only —
  // not persisted server-side. Content writes (edit/followup/regenerate) are not
  // supported yet, so those action buttons stay hidden.
  capabilities: { serverBranchSwitch: true, serverPersistsActiveBranch: false, edit: false, followup: false, regenerate: false },
  rootParentUuid: '',
  tokensCss,
  dom: chatgptDom,

  parseConversationId: (href) => parseConversationIdFromUrl(href),
  fetchConversation: (convId) => getConversation(convId),
  async setActiveLeaf(convId, node) {
    const conv = await getNormalizedConversation(convId);
    const ok = await switchToLeaf(conv, node.leafId);
    if (!ok) throw new Error('Could not switch to that branch in ChatGPT');
  },
  createCompletion: unsupported,
  retryCompletion: unsupported,
  detectTheme,
  applySidePanelInset,
};
