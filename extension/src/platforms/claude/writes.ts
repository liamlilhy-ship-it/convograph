import type { CompletionParams, RetryParams } from '../types';
import type { NormalizedConversation } from '../model';
import { detectActiveLeafFromDom } from './activeLeaf';

/**
 * The claude.ai write actions — edit a question, regenerate an answer, ask a
 * follow-up — implemented by DRIVING claude.ai's own UI.
 *
 * Since Nov 2026 the REST `…/completion` endpoints reject every chat with 409
 * `conversation_upgraded`; the page itself writes through a protobuf RPC
 * (`ConversationService/PerformAction`) that needs a page-generated session id.
 * So we click the real controls and let the page make its own request. The app's
 * generic completion flow (App.tsx `runCompletion`) awaits these, then refetches
 * the graph — so each must not resolve until generation has finished, or throw a
 * clear Error that the app surfaces as a toast.
 *
 * Native controls (verified live 2026-11-18), all located by `data-testid` /
 * `data-cds`, never by (localizable) labels:
 *   - A turn's question is `[data-cds="UserMessage"][data-turn-key="<human uuid>"]`
 *     and its answer `[data-testid="assistant-message"]` whose `data-turn-key`
 *     starts with the same uuid; each sits in its own `[role="article"]` row.
 *   - Edit:       `[data-testid="user-message-edit"]` swaps the question for a
 *                 `textarea[data-cds="TextArea"]` with a ghost Cancel button and a
 *                 primary Save button (disabled until the text changes). Save
 *                 branches a sibling question → new answer.
 *   - Regenerate: `[data-testid="action-bar-retry"]` under the answer.
 *   - Follow-up:  type into `[data-testid="chat-input"]` (a ProseMirror
 *                 contenteditable — `execCommand('insertText')` registers it) and
 *                 click `[data-testid="chat-input-send"]`.
 *   - Generating: the streaming answer carries `data-is-streaming="true"`.
 *
 * Limitations: claude.ai's controls only act on the branch shown in the chat (the
 * app disables the actions on off-branch nodes; these throw as the backstop), and
 * the DOM doesn't expose an answer's own uuid — so with several regenerated
 * answers under one question, the write applies to whichever one is on screen.
 */

/** claude.ai's sentinel parent of a first-turn message. */
export const ROOT_PARENT_UUID = '00000000-0000-4000-8000-000000000000';

const SEL_SCROLLER = '[data-autoscroll-container]';
const SEL_STREAMING = `${SEL_SCROLLER} [data-is-streaming="true"]`;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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

/**
 * Tell edit from follow-up — both reach `createCompletion` with the PRIOR message
 * as parent. If that parent already has a question under it on the shown branch
 * (root → `shownLeaf`), the action edits that question; if it has none at all, it
 * is the branch tip and the action is a follow-up. Returns null when the parent's
 * questions are all on other branches (nothing the page can act on).
 * Pure + exported for unit tests.
 */
export function classifyCreate(
  conv: NormalizedConversation,
  parentMessageUuid: string,
  shownLeaf: string | null,
): WriteAction | null {
  const questions = conv.chat_messages.filter(
    (m) => m.parent_message_uuid === parentMessageUuid && m.sender === 'human',
  );
  if (!questions.length) return { kind: 'followup', answerId: parentMessageUuid };
  const parentById = new Map(conv.chat_messages.map((m) => [m.uuid, m.parent_message_uuid]));
  const shown = new Set<string>();
  for (let cur = shownLeaf; cur && !shown.has(cur); cur = parentById.get(cur) ?? null) shown.add(cur);
  const onPath = questions.find((m) => shown.has(m.uuid));
  return onPath ? { kind: 'edit', userId: onPath.uuid } : null;
}

// ---- DOM lookups ----------------------------------------------------------

function questionEl(humanId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `${SEL_SCROLLER} [data-cds="UserMessage"][data-turn-key="${CSS.escape(humanId)}"]`,
  );
}

function answerEl(humanId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `${SEL_SCROLLER} [data-testid="assistant-message"][data-turn-key^="${CSS.escape(humanId)}"]`,
  );
}

/** The turn key (question uuid) of the last rendered turn. */
function lastTurnKey(): string | null {
  const qs = document.querySelectorAll(`${SEL_SCROLLER} [data-cds="UserMessage"][data-turn-key]`);
  return qs.length ? qs[qs.length - 1]!.getAttribute('data-turn-key') : null;
}

const OFF_BRANCH =
  "That message isn't on the branch shown in the chat — Claude can only edit, regenerate or continue the branch it shows.";

/** Ensure the turn's question is in the DOM. claude.ai mounts only a window of
 *  turns, more as the chat scrolls — so walk the scroller until it appears. */
async function ensureMounted(humanId: string): Promise<HTMLElement> {
  let el = questionEl(humanId);
  const sc = document.querySelector<HTMLElement>(SEL_SCROLLER);
  if (!el && sc) {
    const step = Math.max(200, Math.floor(sc.clientHeight * 0.7));
    for (let y = sc.scrollHeight; y >= -step && !el; y -= step) {
      sc.scrollTop = Math.max(0, y);
      await wait(120);
      el = questionEl(humanId);
    }
  }
  if (!el) throw new Error(OFF_BRANCH);
  return el;
}

/** Set a React-controlled <textarea> (the inline edit box) to `text`. */
function setTextareaValue(ta: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Resolve once claude.ai has finished generating, streaming the answer into the
 * draft node meanwhile. `answer()` returns the element the new answer streams
 * into (null until it exists). Phase 1 waits for streaming to start; phase 2
 * feeds `onDelta` the growth of the answer text until streaming ends.
 */
async function waitForGenerationComplete(
  signal: AbortSignal | undefined,
  onDelta: ((text: string) => void) | undefined,
  answer: () => HTMLElement | null,
): Promise<void> {
  const generating = () => !!document.querySelector(SEL_STREAMING);
  let prev = '';
  const pump = () => {
    if (!onDelta) return;
    const t = answer()?.querySelector('[data-cds="Prose"]')?.textContent ?? '';
    if (t.startsWith(prev)) {
      if (t.length > prev.length) {
        onDelta(t.slice(prev.length));
        prev = t;
      }
    }
  };
  // Phase 1: wait for generation to start (~15s budget).
  const startBy = Date.now() + 15_000;
  while (Date.now() < startBy && !generating()) {
    checkAbort(signal);
    await wait(150);
  }
  if (!generating()) {
    await wait(1200); // never saw it — an instant turn; let the DOM settle
    return;
  }
  // Phase 2: stream until generation ends (~10 min budget).
  const endBy = Date.now() + 600_000;
  while (Date.now() < endBy) {
    if (signal?.aborted) {
      // The send button turns into Stop while generating.
      document.querySelector<HTMLButtonElement>('[data-cds="ChatComposer"] [data-testid="chat-input-stop"]')?.click();
      throw new DOMException('Aborted', 'AbortError');
    }
    pump();
    if (!generating()) {
      await wait(400);
      pump();
      if (!generating()) return;
    }
    await wait(180);
  }
  throw new Error('Claude is still generating — try again in a moment.');
}

// ---- orchestration --------------------------------------------------------

/** After a send that creates a NEW turn: report its question uuid (so the app
 *  can match the reloaded node to the draft) and stream its answer. */
async function awaitNewTurn(
  beforeKey: string | null,
  { signal, onDelta, onStart }: Pick<CompletionParams, 'signal' | 'onDelta' | 'onStart'>,
): Promise<void> {
  const newKey = await waitFor(() => {
    const k = lastTurnKey();
    return k && k !== beforeKey ? k : null;
  }, 8000);
  if (!newKey) throw new Error("Claude didn't send the message — the page may have updated.");
  onStart?.({ parentUuid: newKey });
  await waitForGenerationComplete(signal, onDelta, () => answerEl(newKey));
}

async function doEdit(userId: string, params: CompletionParams): Promise<void> {
  const { prompt, signal } = params;
  const row = (await ensureMounted(userId)).closest<HTMLElement>('[role="article"]');
  const editBtn = row?.querySelector<HTMLElement>('[data-testid="user-message-edit"]');
  if (!row || !editBtn) throw new Error("Couldn't find Claude's edit control — the page may have updated.");
  checkAbort(signal);
  editBtn.click();
  const ta = await waitFor(() => row.querySelector<HTMLTextAreaElement>('textarea[data-cds="TextArea"]'), 3000);
  if (!ta) throw new Error("Claude's edit box didn't open.");
  const cancel = () => row.querySelector<HTMLElement>('button[data-cds="Button"][data-cds-ghost]')?.click();
  setTextareaValue(ta, prompt);
  // Save stays disabled while the text is unchanged.
  const saveBtn = await waitFor(
    () => row.querySelector<HTMLButtonElement>('button[data-cds="Button"]:not([data-cds-ghost]):not([disabled])'),
    1500,
  );
  if (!saveBtn) {
    cancel();
    throw new Error('Change the text before saving — Claude only saves an edited message.');
  }
  if (signal?.aborted) {
    cancel();
    checkAbort(signal);
  }
  const before = lastTurnKey();
  saveBtn.click();
  await awaitNewTurn(before, params);
}

async function doFollowup(conv: NormalizedConversation, answerId: string, params: CompletionParams): Promise<void> {
  const { prompt, signal } = params;
  // The composer continues the branch tip shown in the chat, so the answer's turn
  // must be that tip.
  const turnKey = conv.chat_messages.find((m) => m.uuid === answerId)?.parent_message_uuid;
  const before = lastTurnKey();
  if (!turnKey || turnKey !== before) throw new Error(OFF_BRANCH);
  const editor = document.querySelector<HTMLElement>('[data-testid="chat-input"]');
  if (!editor) throw new Error("Couldn't find Claude's message box.");
  checkAbort(signal);
  editor.focus();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  document.execCommand('insertText', false, prompt);
  const sendBtn = await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]:not([disabled])'),
    2500,
  );
  if (!sendBtn) throw new Error("Couldn't find the Send button — Claude may not have accepted the text.");
  checkAbort(signal);
  sendBtn.click();
  await awaitNewTurn(before, params);
}

// ---- Platform methods -----------------------------------------------------

export async function createCompletion(conv: NormalizedConversation, params: CompletionParams): Promise<void> {
  const action = classifyCreate(conv, params.parentMessageUuid, detectActiveLeafFromDom(conv));
  if (!action) throw new Error(OFF_BRANCH);
  if (action.kind === 'edit') await doEdit(action.userId, params);
  else await doFollowup(conv, action.answerId, params);
}

export async function retryCompletion({ parentMessageUuid, signal, onDelta }: RetryParams): Promise<void> {
  await ensureMounted(parentMessageUuid);
  const retryBtn = answerEl(parentMessageUuid)
    ?.closest('[role="article"]')
    ?.querySelector<HTMLElement>('[data-testid="action-bar-retry"]');
  if (!retryBtn) throw new Error("Couldn't find Claude's retry control — the page may have updated.");
  checkAbort(signal);
  retryBtn.click();
  // The regenerated answer replaces the old one in the same turn; no new uuid is
  // exposed in the DOM, so nothing is reported via onStart.
  await waitForGenerationComplete(signal, onDelta, () =>
    document.querySelector<HTMLElement>(
      `${SEL_SCROLLER} [data-testid="assistant-message"][data-turn-key^="${CSS.escape(parentMessageUuid)}"][data-is-streaming="true"]`,
    ),
  );
}
