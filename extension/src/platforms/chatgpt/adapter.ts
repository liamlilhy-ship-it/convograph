import type { NormalizedConversation, NormalizedFile, NormalizedMessage } from '../model';
import type { ChatGptConversation, ChatGptImagePart, ChatGptMessage, ChatGptRefImage } from './types';

/**
 * Folds ChatGPT's `mapping`/`current_node` graph into the neutral
 * `NormalizedConversation` the generic core consumes.
 *
 * ChatGPT's tree carries far more than the visible chat: a synthetic root, hidden
 * system prompts, per-turn `thoughts`/`reasoning_recap` (empty), and — crucially —
 * multiple messages PER assistant turn (a `commentary` preamble, several `web.run`
 * tool calls, then the `final` answer). We keep only USER-FACING messages
 * (`recipient: 'all'` + a text content type, OR media) and then COLLAPSE
 * consecutive same-role messages into a single turn. Without the collapse, a
 * multi-message assistant turn would reparent each message to the same user node
 * and render as a fake N-way branch (the bug this fixes). The collapse also yields
 * the strict human→assistant alternation `displayTree` requires.
 *
 * MEDIA: user-uploaded images/files and assistant-generated (DALL·E) images are
 * extracted into `files_v2` (file id stashed in `file_uuid`, NO urls). The client
 * resolves each id to a signed download URL before the tree is built. Generated
 * images arrive as `role: 'tool'` messages; we treat such an image-bearing tool
 * message as part of the assistant turn so its image folds into that answer card.
 * Inline web-search images (the model's `image_v2` content references) carry direct
 * cdn urls, so they're emitted with urls already set (no resolution needed); the
 * citation/image TOKENS the model weaves into the text are stripped (stripRefTokens).
 */

/** Content types that carry the user-visible answer (vs tool calls / reasoning). */
const VISIBLE_CONTENT = new Set(['text', 'multimodal_text']);

/**
 * Strips ChatGPT's inline reference tokens from answer text. When the model cites
 * the web or embeds search images, it weaves a marker into the text wrapped in
 * private-use sentinels: U+E200 (start) … U+E201 (end), with U+E202 separating
 * sub-parts. The UI replaces each span with rendered images/citation chips; as
 * raw text they read as garbage (e.g. "iturn812489image3turn812489image6" for an
 * image token, "citeturn…search…" for a citation). Removing the whole sentinel
 * span — plus any stray sentinel char — yields the clean prose the DOM shows (which
 * also makes click-to-jump text matching more reliable). The images themselves are
 * surfaced separately as media (see extractMedia). PUA chars never occur in real
 * content, so this can't delete anything the user typed.
 */
function stripRefTokens(s: string): string {
  return s.replace(/[\s\S]*?/g, '').replace(/[-]/g, '');
}

function extractText(m?: ChatGptMessage | null): string {
  const c = m?.content;
  if (!c) return '';
  if (Array.isArray(c.parts)) {
    return stripRefTokens(c.parts.filter((p): p is string => typeof p === 'string').join('\n')).trim();
  }
  if (typeof c.text === 'string') return stripRefTokens(c.text).trim();
  return '';
}

/** `sediment://file_…` / `file-service://file-…` → bare file id. */
function stripScheme(assetPointer: string): string {
  return assetPointer.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

/** Normalizes one content-reference image entry to its url fields. ChatGPT ships
 *  two shapes: flat (`image_v2`: urls on the entry) and nested (`image_group`: urls
 *  under `image_result`). Unwrap the nesting so both read the same. */
function imageFields(im: ChatGptRefImage | null | undefined): ChatGptRefImage {
  return (im?.image_result ?? im) ?? {};
}

/**
 * Media attached to one raw message → `NormalizedFile[]` with the ChatGPT file id
 * in `file_uuid` and NO urls (the client fills `thumbnail_url`/`preview_url`).
 * Sources are merged + deduped by id: inline `image_asset_pointer` parts (images,
 * incl. generated) and `metadata.attachments[]` (names + mime; for an image the
 * attachment id equals the pointer's file id).
 */
function extractMedia(m?: ChatGptMessage | null): NormalizedFile[] {
  if (!m) return [];
  const byId = new Map<string, NormalizedFile>();
  const ensure = (id: string): NormalizedFile => {
    let f = byId.get(id);
    if (!f) {
      f = { file_uuid: id };
      byId.set(id, f);
    }
    return f;
  };

  const parts = m.content?.parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue;
      if ((p as ChatGptImagePart).content_type !== 'image_asset_pointer') continue;
      const ap = (p as ChatGptImagePart).asset_pointer;
      const id = ap ? stripScheme(ap) : '';
      if (!id) continue;
      const f = ensure(id);
      f.file_kind = 'image';
      const sb = (p as ChatGptImagePart).size_bytes;
      if (f.file_size_bytes == null && typeof sb === 'number') f.file_size_bytes = sb;
    }
  }

  const atts = m.metadata?.attachments;
  if (Array.isArray(atts)) {
    for (const a of atts) {
      const id = a?.id ? stripScheme(a.id) : '';
      if (!id) continue;
      const f = ensure(id);
      if (a.name != null) f.file_name = a.name;
      if (a.mime_type != null) f.file_type = a.mime_type;
      if (a.size != null && f.file_size_bytes == null) f.file_size_bytes = a.size;
      if ((a.mime_type ?? '').startsWith('image/')) f.file_kind = 'image';
    }
  }

  // Inline web-search images the model embedded in the answer text, carried in
  // `content_references`. ChatGPT has several reference types for these (`image_v2`,
  // `image_group`, …) and may add more, so rather than match type names we treat ANY
  // reference that exposes an `images[]` as an image carrier — citations
  // (`grouped_webpages`/`sources_footnote`) don't have that array, so they're skipped.
  // Each entry is either flat (`image_v2`) or wraps the fields under `image_result`
  // (`image_group`); `imageFields` normalizes both. These carry DIRECT cdn urls, so
  // we set thumbnail_url/preview_url here and the client skips files-endpoint
  // resolution. Keyed by url (no ChatGPT file id) for dedupe.
  const refs = m.metadata?.content_references;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (!ref || !Array.isArray(ref.images)) continue;
      for (const im of ref.images) {
        const src = imageFields(im);
        const full = src.content_url ?? undefined;
        const thumb = src.thumbnail_url ?? undefined;
        const key = full ?? thumb;
        if (!key) continue;
        const f = ensure(key);
        f.file_kind = 'image';
        f.thumbnail_url = thumb ?? full;
        f.preview_url = full ?? thumb;
        if (src.title && f.file_name == null) f.file_name = src.title;
      }
    }
  }

  return [...byId.values()];
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
  media: NormalizedFile[];
  /** A `role:'tool'` message whose payload is a generated image (DALL·E) — shown
   *  as part of the assistant turn it belongs to. */
  genImage: boolean;
};

export function adaptChatGptConversation(
  raw: ChatGptConversation,
  convId: string,
): NormalizedConversation {
  const mapping = raw.mapping ?? {};
  const info = new Map<string, Info>();
  for (const [id, node] of Object.entries(mapping)) {
    const m = node?.message ?? null;
    const role = m?.author?.role ?? 'unknown';
    const recipient = m?.recipient ?? 'all';
    const ctype = m?.content?.content_type ?? '';
    const media = extractMedia(m);
    const genImage =
      role === 'tool' &&
      recipient === 'all' &&
      VISIBLE_CONTENT.has(ctype) &&
      media.some((f) => f.file_kind === 'image');
    info.set(id, {
      id,
      parent: node?.parent ?? null,
      role,
      text: extractText(m),
      create: typeof m?.create_time === 'number' ? m.create_time : 0,
      model: typeof m?.metadata?.model_slug === 'string' ? m.metadata.model_slug : undefined,
      hidden: m?.metadata?.is_visually_hidden_from_conversation === true,
      ctype,
      recipient,
      media,
      genImage,
    });
  }

  // Effective role for grouping: a generated-image tool message belongs to the
  // assistant turn, so it groups (and renders) as assistant.
  const effRole = (n: Info): string => (n.genImage ? 'assistant' : n.role);

  // A user-facing message: not hidden, a user/assistant turn (generated images
  // count as assistant), addressed to the user (not a tool), with text content OR
  // media. The media clause lets image-only uploads/answers survive.
  const visible = (n?: Info): boolean =>
    !!n &&
    !n.hidden &&
    (effRole(n) === 'user' || effRole(n) === 'assistant') &&
    n.recipient === 'all' &&
    VISIBLE_CONTENT.has(n.ctype) &&
    (n.text.trim() !== '' || n.media.length > 0);

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
  // maximal same-(effective-)role run (a multi-message turn collapses to its
  // first message).
  const repCache = new Map<string, Info>();
  const turnRep = (n: Info): Info => {
    const cached = repCache.get(n.id);
    if (cached) return cached;
    const anc = nva(n.id);
    const rep = anc && effRole(anc) === effRole(n) ? turnRep(anc) : n;
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
    // Merge media from every member of the turn, deduped by file id.
    const files: NormalizedFile[] = [];
    const seen = new Set<string>();
    for (const mem of members) {
      for (const f of mem.media) {
        const key = f.file_uuid ?? f.file_name ?? '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        files.push(f);
      }
    }
    chat_messages.push({
      uuid: rep.id,
      parent_message_uuid: ancestor ? turnRep(ancestor).id : null,
      sender: effRole(rep) === 'user' ? 'human' : 'assistant',
      content: [{ type: 'text', text: members.map((m) => m.text).filter(Boolean).join('\n\n') }],
      created_at: new Date((rep.create || 0) * 1000).toISOString(),
      ...(files.length ? { files_v2: files } : {}),
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
