import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../panel/App';
import panelCss from '../styles/panel.css?inline';
import reactFlowCss from '@xyflow/react/dist/style.css?inline';
import { watchUrl } from './observers';
import type { Platform } from '../platforms/types';

const HOST_ID = 'conversation-graph-for-claude-host';

function syncTheme(host: HTMLElement, platform: Platform) {
  const apply = () => host.dataset.theme = platform.detectTheme();
  apply();
  // Re-detect on any signal a site might flip when switching theme: the class /
  // data-theme token, or an inline style that changes `color-scheme` (claude.ai),
  // on either <html> or <body>. Plus the OS preference for "system" themes.
  const mo = new MutationObserver(apply);
  const opts = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
  mo.observe(document.documentElement, opts);
  if (document.body) mo.observe(document.body, opts);
  const mm = window.matchMedia?.('(prefers-color-scheme: dark)');
  mm?.addEventListener?.('change', apply);
}

// Keep our host attached when the page's framework removes it. Watches <html> (for a
// whole-<body> swap) and <body> (for our host being removed) — shallow childList only,
// so the callback is a cheap connectivity check. React only prunes foreign nodes during
// hydration, so in practice this re-attaches once and then stays quiet.
function keepHostMounted(host: HTMLElement) {
  const mo = new MutationObserver(() => {
    if (!host.isConnected && document.body) {
      document.body.appendChild(host);
      mo.observe(document.body, { childList: true }); // re-observe if <body> was replaced
    }
  });
  mo.observe(document.documentElement, { childList: true });
  mo.observe(document.body, { childList: true });
}

export function mount(platform: Platform): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483645;';
  document.body.appendChild(host);
  // ChatGPT's client render reconciles <body> during hydration/route transitions and
  // discards nodes it didn't create — including our host — so the pill paints once and
  // then vanishes. The detached host keeps its shadow root + React tree in memory, so
  // re-appending the same node restores it with no re-mount. Only ChatGPT does this;
  // claude.ai leaves the host alone, so the guard is wired up for ChatGPT only.
  if (platform.id === 'chatgpt') keepHostMounted(host);
  syncTheme(host, platform);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  // The platform supplies its own design tokens; the panel + React Flow CSS are
  // shared and consume only the --cg-* variables those tokens define.
  style.textContent = [reactFlowCss, platform.tokensCss, panelCss].join('\n');
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'cg-root';
  // Host is pointer-events:none so clicks pass through to the page by default.
  // Individual interactive children (.cg-toggle, .cg-panel) re-enable themselves via CSS.
  root.style.cssText = 'position: fixed; inset: 0; pointer-events: none;';
  shadow.appendChild(root);

  createRoot(root).render(
    <StrictMode>
      <App platform={platform} />
    </StrictMode>,
  );

  watchUrl(() => {
    /* App handles its own re-fetch when open; reserved for future cross-conversation hooks */
  });
}
