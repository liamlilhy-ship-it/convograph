import type { CompletionParams, RetryParams } from '../types';
import type { NormalizedConversation } from '../model';
import type { ChatGptConversation } from './types';
import {
  cachedRawConversation,
  getConversation,
  getNormalizedConversation,
  invalidateConversation,
} from './client';
import { switchToLeaf } from './branchSwitch';
import { revealUserMessage } from './promptRail';

/**
 * The ChatGPT write actions — edit a question, regenerate an answer, ask a
 * follow-up — implemented by DRIVING ChatGPT's own UI, the same philosophy as
 * branchSwitch.ts (which drives the native < n/m > arrows). ChatGPT's write API
 * is gated by an anti-bot proof-of-work, so we never call it; instead we click the
 * real controls and let ChatGPT do its own thing. The app's generic completion
 * flow (App.tsx `runCompletion`) awaits these, then refetches the graph — so each
 * method must NOT resolve until generation has finished and a fresh fetch will see
 * the new branch (we `invalidateConversation` before returning), or throw a clear
 * Error that the app surfaces as a toast.
 *
 * Native controls (verified live):
 *   - Edit:      a user bubble's `button[aria-label="Edit message"]` opens an inline
 *                <textarea> with text "Cancel" / "Send" buttons. Send branches a
 *                sibling user message → new answer.
 *   - Regenerate: an answer's `button[aria-label="Switch model"]` opens a Radix
 *                popover (needs a pointer-event sequence, not a plain click) whose
 *                "Try again • <model>" item regenerates a new assistant sibling.
 *   - Follow-up: type into the composer (`#prompt-textarea`, a ProseMirror
 *                contenteditable — `execCommand('insertText')` registers it) and
 *                click `button[data-testid="send-button"]`.
 *
 * Both edit and follow-up arrive via `createCompletion` with an assistant-ish
 * parent; `classifyCreate` (pure, unit-tested) tells them apart from the tree.
 *
 * Known limitations (best-effort, like click-to-jump):
 *   - A target must be MOUNTED. Active-path turns ChatGPT virtualized are revealed
 *     via the prompt rail; a message on a non-visible branch can't be reached —
 *     click the node first (which switches the branch), then act. Otherwise: a
 *     clear "couldn't reach" Error.
 *   - Follow-up appends to the VISIBLE branch tail; if the answer isn't already the
 *     tail we switch the branch to it SILENTLY first (the answer is always a leaf
 *     here — a mid-conversation answer is routed to edit, which branches a new
 *     question from it).
 *   - The answer streams live into the node: waitForGenerationComplete mirrors
 *     ChatGPT's streaming bubble text into `onDelta`. When generation finishes we
 *     read the new answer's id from the DOM and report it via `onStart`, so the app
 *     recognizes which reloaded node the answer became and keeps it expanded in its
 *     in-line preview (rather than collapsing the just-read answer to a snippet).
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SEL_TURN = '[data-testid^="conversation-turn"]';
// During generation ChatGPT swaps the composer Send button for a Stop button; its
// presence is our "is generating" signal.
const SEL_STOP = 'button[data-testid="stop-button"], button[aria-label*="Stop" i]';
const SEL_SEND = 'button[data-testid="send-button"]';

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function msgEl(id: string): HTMLElement | null {
  return id ? document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) : null;
}

function turnOf(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>(SEL_TURN) ?? null;
}

/** Poll `fn` until it returns a truthy value or the budget elapses. */
async function waitFor<T>(fn: () => T | null | undefined, ms: number): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await wait(120);
  }
}

// ---- pure classification --------------------------------------------------

export type WriteAction = { kind: 'edit'; userId: string } | { kind: 'followup'; answerId: string };

/** The active branch root→leaf (from `current_leaf_message_uuid`). */
function activePath(conv: NormalizedConversation): string[] {
  const byId = new Map(conv.chat_messages.map((m) => [m.uuid, m]));
  const out: string[] = [];
  const guard = new Set<string>();
  let cur: string | null = conv.current_leaf_message_uuid;
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const m = byId.get(cur);
    if (!m) break;
    out.unshift(m.uuid);
    cur = m.parent_message_uuid;
  }
  return out;
}

/**
 * Tell edit from follow-up — both reach `createCompletion` with an assistant-ish
 * `parentMessageUuid`. Operates on the NORMALIZED tree (clean human↔assistant
 * alternation; turn-rep ids == `data-message-id`):
 *   - '' (the rootParentUuid sentinel) → editing the first user message: the root
 *     human on the active branch.
 *   - the parent answer already has a human child → editing that existing question
 *     (App's edit passes the PRIOR answer as parent); ChatGPT's edit branches a
 *     sibling. Pick the child on the active path if several.
 *   - no human child → the answer is a leaf → follow-up.
 * Pure + exported for unit tests.
 */
export function classifyCreate(conv: NormalizedConversation, parentMessageUuid: string): WriteAction {
  if (parentMessageUuid === '') {
    const firstHuman = activePath(conv)
      .map((id) => conv.chat_messages.find((m) => m.uuid === id))
      .find((m) => m?.sender === 'human');
    return { kind: 'edit', userId: firstHuman?.uuid ?? '' };
  }
  const humanChildren = conv.chat_messages.filter(
    (m) => m.parent_message_uuid === parentMessageUuid && m.sender === 'human',
  );
  if (humanChildren.length) {
    const active = new Set(activePath(conv));
    const onPath = humanChildren.find((m) => active.has(m.uuid));
    return { kind: 'edit', userId: (onPath ?? humanChildren[0]!).uuid };
  }
  return { kind: 'followup', answerId: parentMessageUuid };
}

// ---- DOM driving ----------------------------------------------------------

/** Ensure the message `id` is in the DOM, revealing an active-path virtualized
 *  turn via the prompt rail. Throws if it can't be reached. */
async function ensureMounted(raw: ChatGptConversation, id: string): Promise<HTMLElement> {
  let el = msgEl(id);
  if (el) return el;
  await revealUserMessage(raw, id);
  el = msgEl(id);
  if (!el) {
    throw new Error("Couldn't reach that message in the chat — open its branch, then try again.");
  }
  return el;
}

/** A button within `root` whose aria-label exactly matches. Dispatches a hover
 *  first since ChatGPT renders some turn-toolbar buttons only on pointer-over. */
function turnButton(root: HTMLElement, ariaLabel: string): HTMLButtonElement | null {
  root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  root.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.getAttribute('aria-label') || '') === ariaLabel,
    ) ?? null
  );
}

/** Set a React-controlled <textarea> (the inline edit box) to `text`. */
function setTextareaValue(ta: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Type `text` into the ProseMirror composer. A plain `.value`/innerText won't
 *  register with the editor; `execCommand('insertText')` does (verified live —
 *  it's what makes the Send button enable). Replaces any existing content. */
function insertComposerText(el: HTMLElement, text: string): void {
  el.focus();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  document.execCommand('insertText', false, text);
}

function findComposerEditable(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#prompt-textarea, form [contenteditable="true"]');
}

/** Open a Radix dropdown (e.g. "Switch model"): its trigger opens on a pointer
 *  sequence, not a synthetic `.click()`. */
function openRadixMenu(btn: HTMLElement): void {
  const r = btn.getBoundingClientRect();
  const o = {
    bubbles: true,
    cancelable: true,
    clientX: r.x + r.width / 2,
    clientY: r.y + r.height / 2,
    pointerId: 1,
    pointerType: 'mouse' as const,
    isPrimary: true,
    button: 0,
  };
  btn.dispatchEvent(new PointerEvent('pointerdown', o));
  btn.dispatchEvent(new MouseEvent('mousedown', o));
  btn.dispatchEvent(new PointerEvent('pointerup', o));
  btn.dispatchEvent(new MouseEvent('mouseup', o));
  btn.dispatchEvent(new MouseEvent('click', o));
}

/** The menu/section turn that holds the assistant answer following `qEl`. */
function answerSectionAfter(qEl: HTMLElement): HTMLElement | null {
  const qTurn = turnOf(qEl);
  if (!qTurn) return null;
  const sections = Array.from(document.querySelectorAll<HTMLElement>(SEL_TURN));
  const idx = sections.indexOf(qTurn);
  if (idx < 0) return null;
  for (let i = idx + 1; i < sections.length; i++) {
    if (sections[i]!.querySelector('[data-message-author-role="assistant"]')) return sections[i]!;
  }
  return null;
}

/** The "Try again …" item inside the open Switch-model popover (regenerates with
 *  the current model). */
function findTryAgainItem(): HTMLElement | null {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"],[role="option"],button,a'),
  );
  return items.find((e) => /^try again\b/i.test((e.textContent || '').trim())) ?? null;
}

function clickItem(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + 2, clientY: r.y + 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('click', o));
}

/** The last rendered assistant message element (a new turn streams into it). */
function lastAssistantEl(): HTMLElement | null {
  const a = document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]');
  return a.length ? a[a.length - 1]! : null;
}

/**
 * The id of the assistant turn that just finished generating, as the normalized
 * tree will key it. The adapter collapses a multi-message turn to its TOPMOST
 * visible message (`turnRep`), so we report the FIRST assistant message id in the
 * new turn (== the last one for a plain text answer). Returns null if no new
 * assistant element appeared (so nothing is reported and the draft just clears).
 * App matches this against the reloaded tree's `assistantId` to keep that node
 * expanded in its in-line preview.
 */
function finishedAnswerId(beforeEl: HTMLElement | null): string | null {
  const last = lastAssistantEl();
  if (!last || last === beforeEl) return null;
  const first =
    turnOf(last)?.querySelector<HTMLElement>('[data-message-author-role="assistant"][data-message-id]') ?? last;
  return first.getAttribute('data-message-id') || null;
}

/** The rendered answer text of an assistant bubble — ONLY the `.markdown` answer
 *  body. Deliberately does NOT fall back to the element's textContent: that would
 *  capture a thinking model's "Thinking…" indicator, the "ChatGPT said:" a11y
 *  prefix, and the hover toolbar. When the answer body isn't present yet (thinking,
 *  or a canvas/tool answer) this returns '' and streaming simply shows nothing until
 *  the body appears — the post-completion reload is authoritative regardless. */
function answerText(el: HTMLElement): string {
  const md = el.querySelector<HTMLElement>('.markdown');
  return md ? md.textContent ?? '' : '';
}

/**
 * Resolve once ChatGPT has finished generating, streaming the answer into the node
 * meanwhile. The composer's Stop button is the done/not-done signal: it appears
 * when generation starts and vanishes when it ends. Phase 1 waits (briefly) for it
 * to appear — a too-fast/cached turn that never shows it just settles and returns.
 * Phase 2 polls until it's gone, feeding `onDelta` the growth of the NEW answer
 * bubble (the element that isn't `beforeEl` — a fresh node on follow-up/edit, or
 * regenerate's replacement, whose message id changes). Aborts honor the signal
 * (and click Stop so ChatGPT actually halts).
 */
async function waitForGenerationComplete(
  signal: AbortSignal | undefined,
  onDelta: ((text: string) => void) | undefined,
  beforeEl: HTMLElement | null,
): Promise<void> {
  const generating = () => !!document.querySelector(SEL_STOP);
  let streamEl: HTMLElement | null = null;
  let prev = '';
  const pump = () => {
    if (!onDelta) return;
    const last = lastAssistantEl();
    if (!last || last === beforeEl) return; // the new answer hasn't replaced the old yet
    if (last !== streamEl) {
      streamEl = last;
      prev = ''; // fresh element → stream from the start
    }
    const t = answerText(last);
    if (t.startsWith(prev)) {
      if (t.length > prev.length) {
        onDelta(t.slice(prev.length));
        prev = t;
      }
    } else {
      prev = ''; // diverged (a re-render) → resync; the next tick emits from 0
    }
  };
  // Phase 1: wait for generation to start (~12s budget).
  const startBy = Date.now() + 12_000;
  while (Date.now() < startBy && !generating()) {
    checkAbort(signal);
    await wait(150);
  }
  if (!generating()) {
    await wait(1200); // never saw it — assume an instant turn, let the DOM settle
    pump();
    return;
  }
  // Phase 2: stream until generation ends (~180s budget), debounced.
  const endBy = Date.now() + 180_000;
  while (Date.now() < endBy) {
    if (signal?.aborted) {
      document.querySelector<HTMLButtonElement>(SEL_STOP)?.click();
      throw new DOMException('Aborted', 'AbortError');
    }
    pump();
    if (!generating()) {
      await wait(300);
      pump();
      if (!generating()) return;
    }
    await wait(180);
  }
  throw new Error('ChatGPT is still generating — try again in a moment.');
}

// ---- orchestration --------------------------------------------------------

async function doEdit(
  raw: ChatGptConversation,
  userId: string,
  prompt: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string | null> {
  if (!userId) throw new Error('Could not identify which message to edit.');
  const userEl = await ensureMounted(raw, userId);
  const turn = turnOf(userEl);
  if (!turn) throw new Error("Couldn't find that message's controls.");
  const editBtn = turnButton(turn, 'Edit message');
  if (!editBtn) throw new Error("Couldn't find ChatGPT's edit control — the page may have updated.");
  checkAbort(signal);
  editBtn.click();
  const ta = await waitFor(
    () => document.querySelector<HTMLTextAreaElement>(`${SEL_TURN} textarea`),
    3000,
  );
  if (!ta) throw new Error("ChatGPT's edit box didn't open.");
  setTextareaValue(ta, prompt);
  const editor = turnOf(ta) ?? turn;
  const sendBtn = await waitFor(
    () =>
      Array.from(editor.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => /^send$/i.test((b.textContent || '').trim()) && !b.disabled,
      ),
    2000,
  );
  if (!sendBtn) throw new Error("Couldn't find the edit Send button.");
  checkAbort(signal);
  const before = lastAssistantEl();
  sendBtn.click();
  await waitForGenerationComplete(signal, onDelta, before);
  return finishedAnswerId(before);
}

async function doRegenerate(
  raw: ChatGptConversation,
  questionId: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string | null> {
  const qEl = await ensureMounted(raw, questionId);
  const answerTurn = answerSectionAfter(qEl);
  if (!answerTurn) throw new Error("Couldn't find the answer to regenerate.");
  const switchBtn = turnButton(answerTurn, 'Switch model');
  if (!switchBtn) throw new Error("Couldn't find ChatGPT's regenerate control — the page may have updated.");
  checkAbort(signal);
  openRadixMenu(switchBtn);
  const tryAgain = await waitFor(findTryAgainItem, 3000);
  if (!tryAgain) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    throw new Error("Couldn't find the Try again option.");
  }
  checkAbort(signal);
  const before = lastAssistantEl();
  clickItem(tryAgain);
  await waitForGenerationComplete(signal, onDelta, before);
  return finishedAnswerId(before);
}

/** Is the answer the tip of the VISIBLE branch (so the composer will append right
 *  after it)? Robust to multi-message turns: checks the answer's turn is the last
 *  message-bearing turn rather than matching a raw id. */
function isVisibleTip(answerId: string): boolean {
  const turn = turnOf(msgEl(answerId));
  if (!turn) return false;
  const turns = Array.from(document.querySelectorAll<HTMLElement>(SEL_TURN)).filter((t) =>
    t.querySelector('[data-message-id]'),
  );
  return turns.length > 0 && turns[turns.length - 1] === turn;
}

async function doFollowup(
  conv: NormalizedConversation,
  raw: ChatGptConversation,
  answerId: string,
  prompt: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string | null> {
  // The composer continues the VISIBLE branch tip. The answer is always a leaf here
  // (classifyCreate routes an answer that already has a follow-up to edit), so if it
  // isn't already the tip we silently switch the chat to its branch — no prompt.
  if (!isVisibleTip(answerId)) {
    await switchToLeaf(conv, answerId, raw);
    await wait(450);
  }
  if (!isVisibleTip(answerId)) {
    throw new Error("Couldn't open that answer's branch — scroll to it in the chat, then try again.");
  }
  const composer = findComposerEditable();
  if (!composer) throw new Error("Couldn't find ChatGPT's message box.");
  checkAbort(signal);
  insertComposerText(composer, prompt);
  const sendBtn = await waitFor(
    () => document.querySelector<HTMLButtonElement>(`${SEL_SEND}:not([disabled])`),
    2500,
  );
  if (!sendBtn) throw new Error("Couldn't find the Send button — ChatGPT may not have accepted the text.");
  checkAbort(signal);
  const before = lastAssistantEl();
  sendBtn.click();
  await waitForGenerationComplete(signal, onDelta, before);
  return finishedAnswerId(before);
}

/** Load the raw conversation (warming the cache if needed) for reveal/switch. */
async function loadRaw(convId: string): Promise<ChatGptConversation> {
  let raw = cachedRawConversation(convId);
  if (!raw) {
    await getConversation(convId);
    raw = cachedRawConversation(convId);
  }
  if (!raw) throw new Error('Could not load the conversation.');
  return raw;
}

// ---- Platform methods -----------------------------------------------------

export async function createCompletion(params: CompletionParams): Promise<void> {
  const { convId, parentMessageUuid, prompt, signal, onDelta, onStart } = params;
  const conv = await getNormalizedConversation(convId);
  const raw = await loadRaw(convId);
  const action = classifyCreate(conv, parentMessageUuid);
  const answerId =
    action.kind === 'edit'
      ? await doEdit(raw, action.userId, prompt, signal, onDelta)
      : await doFollowup(conv, raw, action.answerId, prompt, signal, onDelta);
  if (answerId) onStart?.({ assistantUuid: answerId });
  invalidateConversation(convId);
}

export async function retryCompletion(params: RetryParams): Promise<void> {
  const { convId, parentMessageUuid, signal, onDelta, onStart } = params;
  const raw = await loadRaw(convId);
  const answerId = await doRegenerate(raw, parentMessageUuid, signal, onDelta);
  if (answerId) onStart?.({ assistantUuid: answerId });
  invalidateConversation(convId);
}
