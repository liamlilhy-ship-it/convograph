type Listener = () => void;

export function watchUrl(onChange: Listener): () => void {
  let last = location.href;
  const tick = () => {
    if (location.href !== last) {
      last = location.href;
      onChange();
    }
  };
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    origPush.apply(this, args as Parameters<typeof history.pushState>);
    tick();
  };
  history.replaceState = function (...args) {
    origReplace.apply(this, args as Parameters<typeof history.replaceState>);
    tick();
  };
  window.addEventListener('popstate', tick);
  // Polling fallback — Next.js/claude.ai may navigate through code paths the
  // pushState patch misses (e.g., framework-internal wrappers). 500ms is cheap.
  const pollId = window.setInterval(tick, 500);
  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', tick);
    clearInterval(pollId);
  };
}

export function findComposer(): HTMLElement | null {
  const editable = document.querySelector<HTMLElement>(
    'div[contenteditable="true"][role="textbox"], textarea[role="textbox"]',
  );
  if (!editable) return null;
  return editable.closest('form, fieldset, div[class*="composer"]') ?? editable;
}

export function watchComposer(onFound: (el: HTMLElement) => void): () => void {
  let current: HTMLElement | null = null;
  const check = () => {
    const found = findComposer();
    if (found && found !== current) {
      current = found;
      onFound(found);
    } else if (!found && current) {
      current = null;
    }
  };
  check();
  const mo = new MutationObserver(check);
  mo.observe(document.body, { childList: true, subtree: true });
  return () => mo.disconnect();
}

export function watchConversation(onChange: Listener, debounceMs = 600): () => void {
  let timer: number | null = null;
  const tick = () => {
    if (timer != null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
        tick();
        return;
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    if (timer != null) clearTimeout(timer);
  };
}
