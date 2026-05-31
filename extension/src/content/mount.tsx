import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../panel/App';
import tokensCss from '../styles/tokens.css?inline';
import panelCss from '../styles/panel.css?inline';
import reactFlowCss from '@xyflow/react/dist/style.css?inline';
import { watchUrl } from './observers';

const HOST_ID = 'conversation-graph-for-claude-host';

function detectTheme(): 'light' | 'dark' {
  const ds = document.documentElement.dataset.theme;
  if (ds === 'dark' || ds === 'light') return ds;
  const cls = document.documentElement.className;
  if (/\bdark\b/.test(cls)) return 'dark';
  if (/\blight\b/.test(cls)) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncTheme(host: HTMLElement) {
  const apply = () => host.dataset.theme = detectTheme();
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  const mm = window.matchMedia?.('(prefers-color-scheme: dark)');
  mm?.addEventListener?.('change', apply);
}

export function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483645;';
  document.body.appendChild(host);
  syncTheme(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = [reactFlowCss, tokensCss, panelCss].join('\n');
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'cg-root';
  // Host is pointer-events:none so clicks pass through to claude.ai by default.
  // Individual interactive children (.cg-toggle, .cg-panel) re-enable themselves via CSS.
  root.style.cssText = 'position: fixed; inset: 0; pointer-events: none;';
  shadow.appendChild(root);

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  watchUrl(() => {
    /* App handles its own re-fetch when open; reserved for future cross-conversation hooks */
  });
}
