import { turnEl } from './selectors';

/**
 * Brings a message ChatGPT hasn't rendered into the chat, so click-to-jump can
 * scroll to it. ChatGPT mounts only a window of turns — a fresh load has just the
 * last 5 — and the rest aren't in the DOM at all.
 *
 * The lever is ChatGPT's own deep link, the one its sidebar search uses:
 * `/c/<id>?messageId=<msgId>` makes ChatGPT load that part of the chat and scroll
 * to the message. The MAIN-world bridge applies it in place (no reload — see
 * mainWorldBridge.ts); ChatGPT strips the query once it has acted on it. Verified
 * live 2026-10-02 on a 14-prompt chat: the target turn mounts in ~1–2s, also with
 * hidden leftover chats in the DOM, and the newer turns re-mount on scroll-down.
 */

const REVEAL_REQUEST = 'cg-chatgpt-reveal-message';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait out ChatGPT's own scroll to the revealed message, so the caller's
 *  alignment isn't fought by it: done once the turn's position holds still. */
async function settle(id: string): Promise<void> {
  let prev = NaN;
  let still = 0;
  for (let i = 0; i < 15 && still < 3; i++) {
    const top = turnEl(id)?.getBoundingClientRect().top ?? NaN;
    still = top === prev ? still + 1 : 0;
    prev = top;
    await wait(100);
  }
}

/** Reveal the turn of the USER message `id`. Resolves true once it is rendered. */
export async function revealMessage(id: string): Promise<boolean> {
  if (!id) return false;
  if (turnEl(id)) return true;
  window.dispatchEvent(new CustomEvent(REVEAL_REQUEST, { detail: id }));
  const deadline = Date.now() + 8000;
  while (!turnEl(id)) {
    if (Date.now() >= deadline) return false;
    await wait(100);
  }
  await settle(id);
  return true;
}
