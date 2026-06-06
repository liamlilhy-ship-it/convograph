import type { NormalizedConversation, NormalizedMessage } from '../model';
import type { ChatGptConversation, ChatGptMessage } from './types';

/**
 * Folds ChatGPT's `mapping`/`current_node` graph into the neutral
 * `NormalizedConversation` the generic core consumes.
 *
 * ChatGPT's tree has wrapper nodes the core doesn't want: a synthetic root
 * (message === null), a hidden system prompt, and tool/reasoning nodes
 * (`is_visually_hidden_from_conversation` or empty text). We keep only visible
 * user/assistant messages and re-parent each to its nearest VISIBLE ancestor of
 * the OPPOSITE role. That single rule guarantees the strict human→assistant
 * alternation `displayTree` relies on (its turn-pairing assumes H→A→H→A), while
 * preserving every edit/regenerate branch ChatGPT recorded.
 */

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
    });
  }

  const visible = (n?: Info): n is Info =>
    !!n && !n.hidden && (n.role === 'user' || n.role === 'assistant') && n.text.trim() !== '';

  // Nearest visible ancestor of the OPPOSITE role → enforces strict alternation.
  const parentOf = (id: string, role: string): string | null => {
    let p = info.get(id)?.parent ?? null;
    while (p) {
      const pn = info.get(p);
      if (visible(pn) && pn.role !== role) return p;
      p = pn?.parent ?? null;
    }
    return null;
  };

  // Nearest visible ancestor of ANY role (for resolving current_node → a leaf the
  // core will recognise).
  const nearestVisible = (id: string | null): string | null => {
    let cur = id;
    while (cur) {
      const node = info.get(cur);
      const parent = node?.parent ?? null; // read before the guard narrows `node`
      if (visible(node)) return cur;
      cur = parent;
    }
    return null;
  };

  const chat_messages: NormalizedMessage[] = [];
  for (const n of info.values()) {
    if (!visible(n)) continue;
    chat_messages.push({
      uuid: n.id,
      parent_message_uuid: parentOf(n.id, n.role),
      sender: n.role === 'user' ? 'human' : 'assistant',
      content: [{ type: 'text', text: n.text }],
      created_at: new Date((n.create || 0) * 1000).toISOString(),
    });
  }

  const leaf = nearestVisible(raw.current_node ?? null);

  // Fold the active model up: nearest assistant model from the leaf upward.
  let model: string | undefined;
  let cur = leaf;
  while (cur) {
    const n = info.get(cur);
    if (n?.role === 'assistant' && n.model) {
      model = n.model;
      break;
    }
    cur = n?.parent ?? null;
  }

  return {
    uuid: raw.conversation_id ?? convId,
    name: raw.title,
    model: model ?? null,
    current_leaf_message_uuid: leaf,
    chat_messages,
  };
}
