import type { NormalizedConversation, NormalizedMessage } from '../model';
import type { ChatGptConversation, ChatGptMessage } from './types';

/**
 * Folds ChatGPT's `mapping`/`current_node` graph into the neutral
 * `NormalizedConversation` the generic core consumes.
 *
 * ChatGPT's tree carries far more than the visible chat: a synthetic root, hidden
 * system prompts, per-turn `thoughts`/`reasoning_recap` (empty), and — crucially —
 * multiple messages PER assistant turn (a `commentary` preamble, several `web.run`
 * tool calls, then the `final` answer). We keep only USER-FACING messages
 * (`recipient: 'all'` + a text content type) and then COLLAPSE consecutive
 * same-role messages into a single turn. Without the collapse, a multi-message
 * assistant turn would reparent each message to the same user node and render as a
 * fake N-way branch (the bug this fixes). The collapse also yields the strict
 * human→assistant alternation `displayTree` requires.
 */

/** Content types that carry the user-visible answer (vs tool calls / reasoning). */
const VISIBLE_CONTENT = new Set(['text', 'multimodal_text']);

function extractText(m?: ChatGptMessage | null): string {
  const c = m?.content;
  if (!c) return '';
  if (Array.isArray(c.parts)) {
    return c.parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
  }
  if (typeof c.text === 'string') return c.text.trim();
  return '';
}

type Info = {
  id: string;
  parent: string | null;
  role: string;
  text: string;
  create: number;
  model?: string;
  hidden: boolean;
  ctype: string;
  recipient: string;
};

export function adaptChatGptConversation(
  raw: ChatGptConversation,
  convId: string,
): NormalizedConversation {
  const mapping = raw.mapping ?? {};
  const info = new Map<string, Info>();
  for (const [id, node] of Object.entries(mapping)) {
    const m = node?.message ?? null;
    info.set(id, {
      id,
      parent: node?.parent ?? null,
      role: m?.author?.role ?? 'unknown',
      text: extractText(m),
      create: typeof m?.create_time === 'number' ? m.create_time : 0,
      model: typeof m?.metadata?.model_slug === 'string' ? m.metadata.model_slug : undefined,
      hidden: m?.metadata?.is_visually_hidden_from_conversation === true,
      ctype: m?.content?.content_type ?? '',
      recipient: m?.recipient ?? 'all',
    });
  }

  // A user-facing message: not hidden, a user/assistant turn, addressed to the
  // user (not a tool), with text content (drops tool calls / thoughts / recaps).
  const visible = (n?: Info): boolean =>
    !!n &&
    !n.hidden &&
    (n.role === 'user' || n.role === 'assistant') &&
    n.recipient === 'all' &&
    VISIBLE_CONTENT.has(n.ctype) &&
    n.text.trim() !== '';

  // Nearest visible ancestor of any role.
  const nva = (id: string): Info | null => {
    let p = info.get(id)?.parent ?? null;
    while (p) {
      const pn = info.get(p);
      if (visible(pn)) return pn!;
      p = pn?.parent ?? null;
    }
    return null;
  };

  // The "turn representative" of a visible node = the TOPMOST node of its
  // maximal same-role run (a multi-message turn collapses to its first message).
  const repCache = new Map<string, Info>();
  const turnRep = (n: Info): Info => {
    const cached = repCache.get(n.id);
    if (cached) return cached;
    const anc = nva(n.id);
    const rep = anc && anc.role === n.role ? turnRep(anc) : n;
    repCache.set(n.id, rep);
    return rep;
  };

  // Group every visible node under its turn representative.
  const turns = new Map<string, Info[]>();
  for (const n of info.values()) {
    if (!visible(n)) continue;
    const repId = turnRep(n).id;
    (turns.get(repId) ?? turns.set(repId, []).get(repId)!).push(n);
  }

  const chat_messages: NormalizedMessage[] = [];
  for (const [repId, members] of turns) {
    members.sort((a, b) => a.create - b.create);
    const rep = info.get(repId)!;
    const ancestor = nva(rep.id); // a turn start → ancestor is opposite-role or null
    chat_messages.push({
      uuid: rep.id,
      parent_message_uuid: ancestor ? turnRep(ancestor).id : null,
      sender: rep.role === 'user' ? 'human' : 'assistant',
      content: [{ type: 'text', text: members.map((m) => m.text).join('\n\n') }],
      created_at: new Date((rep.create || 0) * 1000).toISOString(),
    });
  }

  // current_node → the representative of its turn (the active leaf).
  let leafVis: Info | null = null;
  for (let cur = raw.current_node ?? null; cur; cur = info.get(cur)?.parent ?? null) {
    const n = info.get(cur);
    if (visible(n)) { leafVis = n!; break; }
  }
  const leafId = leafVis ? turnRep(leafVis).id : null;

  // Fold the active model up: nearest assistant model from current_node upward.
  let model: string | undefined;
  for (let cur = raw.current_node ?? null; cur; cur = info.get(cur)?.parent ?? null) {
    const n = info.get(cur);
    if (n?.role === 'assistant' && n.model) { model = n.model; break; }
  }

  return {
    uuid: raw.conversation_id ?? convId,
    name: raw.title,
    model: model ?? null,
    current_leaf_message_uuid: leafId,
    chat_messages,
  };
}
