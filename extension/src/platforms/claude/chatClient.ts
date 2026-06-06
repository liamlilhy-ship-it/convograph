import { ClaudeApiError } from './client';

const BASE = 'https://claude.ai/api';

/** SSE frame separator — a blank line. claude.ai uses CRLF (`\r\n\r\n`), so match
 *  that plus the LF (`\n\n`) and bare-CR (`\r\r`) variants. (The old `\n\n`-only
 *  split never fired on claude.ai's CRLF stream, so no deltas were ever read.) */
const FRAME_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

/**
 * claude.ai's sentinel root parent uuid. A first-turn human message (one with no
 * `parent_message_uuid` of its own) branches from this when edited, so a fresh
 * edit of the very first question creates a sibling root turn rather than 400ing
 * on a null parent.
 *
 * NOTE: confirm against a live capture (edit the first message and read the
 * `…/completion` request body) — claude.ai has used this fixed all-zero/“4000”
 * uuid, but it can change.
 */
export const ROOT_PARENT_UUID = '00000000-0000-4000-8000-000000000000';

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Parses one SSE frame's `data:` payload as JSON (null for keep-alives / [DONE]
 *  / partials). claude.ai sends `event:`-named frames each with a `data:` JSON. */
function parseFrame(frame: string): Record<string, unknown> | null {
  const payload = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('\n');
  if (!payload || payload === '[DONE]') return null;
  try {
    const obj = JSON.parse(payload);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null; // non-JSON keep-alive / partial
  }
}

/** Extracts the assistant text delta from a parsed SSE event, tolerant of both
 *  claude.ai's classic `{type:'completion', completion:'…'}` and the
 *  Anthropic-style `{type:'content_block_delta', delta:{text:'…'}}`. Returns ''
 *  for non-text events (ping, message_start/stop, etc.). */
function deltaText(obj: Record<string, unknown>): string {
  if (typeof obj.completion === 'string') return obj.completion;
  const delta = obj.delta as { text?: unknown } | undefined;
  if (delta && typeof delta.text === 'string') return delta.text;
  if ((obj.type === 'completion' || obj.type === 'text') && typeof obj.text === 'string') {
    return obj.text;
  }
  return '';
}

/**
 * Reads a claude.ai SSE completion stream. Parses each frame once (split on the
 * blank-line separator); a real `type: "error"` event throws, and every text
 * delta is forwarded to `onDelta` for live rendering. The new messages persist
 * server-side as the stream runs, so the caller still refetches the tree on
 * completion for the canonical result — `onDelta` is a progressive enhancement,
 * not the source of truth. An aborted request rejects the read with `AbortError`.
 */
/** UUIDs of the messages a completion creates, lifted from the `message_start`
 *  event: `assistantUuid` is the new answer; `parentUuid` is its parent (the NEW
 *  human message for edit/follow-up, or the EXISTING human for a regenerate). */
export type StreamStart = { assistantUuid?: string; parentUuid?: string };

async function drainStream(
  res: Response,
  label: string,
  onDelta?: (text: string) => void,
  onStart?: (info: StreamStart) => void,
): Promise<void> {
  const body = res.body;
  if (!body) return; // no stream (some environments) — server already has the message
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Process every complete frame
      // and keep the trailing partial in the buffer for the next chunk.
      let m: RegExpExecArray | null;
      while ((m = FRAME_BOUNDARY.exec(buf))) {
        const frame = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const obj = parseFrame(frame);
        if (!obj) continue;
        if (obj.type === 'error') {
          const detail = JSON.stringify(obj.error ?? obj).slice(0, 300);
          throw new ClaudeApiError(0, `${label} stream error -> ${detail}`);
        }
        if (onStart && obj.type === 'message_start') {
          const msg = obj.message as { uuid?: string; parent_uuid?: string } | undefined;
          if (msg) onStart({ assistantUuid: msg.uuid, parentUuid: msg.parent_uuid });
        }
        if (onDelta) {
          const d = deltaText(obj);
          if (d) onDelta(d);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Fields claude.ai sends on every completion/retry. Kept minimal; reconcile
 *  the exact set with a live DevTools capture. */
function commonFields() {
  return {
    timezone: timezone(),
    personalized_styles: [] as unknown[],
    locale: 'en-US',
    tools: [] as unknown[],
    attachments: [] as unknown[],
    files: [] as unknown[],
    sync_sources: [] as unknown[],
    rendering_mode: 'messages',
  };
}

export type CompletionArgs = {
  orgId: string;
  convId: string;
  parentMessageUuid: string;
  prompt: string;
  /** Aborts the request (and its stream) when the user cancels a draft. */
  signal?: AbortSignal;
  /** Called with each streamed answer text delta, for live rendering. */
  onDelta?: (text: string) => void;
  /** Called once with the created message UUIDs (from `message_start`). */
  onStart?: (info: StreamStart) => void;
};

/**
 * Sends a new human message as a child of `parentMessageUuid` and lets Claude
 * stream a reply. Covers BOTH:
 *   - Ask follow-up  (parent = the answer's assistant message uuid)
 *   - Edit question  (parent = the question's parent message uuid / root)
 * Unlike `current_leaf`, the completion endpoint accepts a parent that already
 * has children, so posting under an already-answered turn forks a new branch.
 */
export async function createCompletion({
  orgId,
  convId,
  parentMessageUuid,
  prompt,
  signal,
  onDelta,
  onStart,
}: CompletionArgs): Promise<void> {
  const path = `/organizations/${orgId}/chat_conversations/${convId}/completion`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ prompt, parent_message_uuid: parentMessageUuid, ...commonFields() }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ClaudeApiError(res.status, `POST ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  await drainStream(res, 'completion', onDelta, onStart);
}

export type RetryArgs = {
  orgId: string;
  convId: string;
  /** The HUMAN message whose answer to regenerate; the retry produces a new
   *  assistant sibling under it (a `regenerate` branch). */
  parentMessageUuid: string;
  /** Aborts the request (and its stream) when the user cancels a draft. */
  signal?: AbortSignal;
  /** Called with each streamed answer text delta, for live rendering. */
  onDelta?: (text: string) => void;
  /** Called once with the created message UUIDs (from `message_start`). */
  onStart?: (info: StreamStart) => void;
};

/** Regenerates the answer to a question: a new assistant sibling under the same
 *  human message. Mirrors claude.ai's native "Retry". */
export async function retryCompletion({
  orgId,
  convId,
  parentMessageUuid,
  signal,
  onDelta,
  onStart,
}: RetryArgs): Promise<void> {
  const path = `/organizations/${orgId}/chat_conversations/${convId}/retry_completion`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ parent_message_uuid: parentMessageUuid, ...commonFields() }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ClaudeApiError(res.status, `POST ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  await drainStream(res, 'retry_completion', onDelta, onStart);
}
