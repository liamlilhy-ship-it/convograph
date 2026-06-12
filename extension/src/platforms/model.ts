/**
 * The platform-neutral conversation model that the generic core (buildTree,
 * displayTree, contentKinds, preview) consumes. Every platform's adapter produces
 * this shape, so nothing downstream of a provider ever branches on platform.
 *
 * It is, by design, structurally identical to claude.ai's tree response — a flat
 * `chat_messages[]` array where each message carries its own `parent_message_uuid`
 * plus a top-level `current_leaf_message_uuid`. Claude's tree already IS this
 * shape (its adapter is an identity map); ChatGPT's adapter folds its `mapping`/
 * `current_node` graph into the same flat form.
 *
 * The `Api*` aliases at the bottom let existing core files keep their type names
 * and change only an import path. New platform code should use the `Normalized*`
 * names.
 */

/**
 * A web citation claude.ai attaches to a `text` block — the source behind an
 * inline reference link. `start_index`/`end_index` are character offsets into the
 * SAME block's raw text marking the cited span. (Claude-only: ChatGPT carries its
 * citations elsewhere, so its adapter never sets this.)
 */
export type NormalizedCitation = {
  title?: string;
  url?: string;
  start_index?: number;
  end_index?: number;
  metadata?: { site_name?: string; site_domain?: string; favicon_url?: string };
};

export type NormalizedContentBlock = {
  type: string;
  text?: string;
  /** Citations on a `text` block, each anchored to a span via start/end offsets. */
  citations?: NormalizedCitation[];
  /** tool_use blocks carry the invoked tool's name and input (e.g. claude.ai's
   *  `visualize:show_widget`, whose input.widget_code is renderable markup). */
  name?: string;
  input?: Record<string, unknown>;
};

/**
 * A file attached to a message. claude.ai exposes two parallel arrays:
 *   - `files_v2` — newer shape (file_size_bytes, *_asset objects)
 *   - `files`    — legacy shape (file_size, file_type, image_asset)
 * Both share enough fields to use one type with everything optional.
 * Images carry `thumbnail_url`/`preview_url` (relative `/api/...` paths);
 * documents carry a `document_asset` and no preview URL.
 */
export type NormalizedFile = {
  file_kind?: string;        // "image" | "blob" | …
  file_uuid?: string;
  uuid?: string;             // legacy files key the id as `uuid`
  file_name?: string;
  file_type?: string;
  file_size?: number;
  size_bytes?: number;       // legacy files use this
  file_size_bytes?: number;
  created_at?: string;
  thumbnail_url?: string;
  preview_url?: string;
  image_asset?: unknown;
  document_asset?: unknown;
};

/** Uploaded documents surfaced via the `attachments` array (extracted text). */
export type NormalizedAttachment = {
  id?: string;
  file_uuid?: string;
  file_name?: string;
  file_size?: number;
  file_type?: string;
  extracted_content?: string;
};

export type NormalizedMessage = {
  uuid: string;
  parent_message_uuid: string | null;
  sender: 'human' | 'assistant';
  content: NormalizedContentBlock[];
  created_at: string;
  index?: number;
  files_v2?: NormalizedFile[];
  files?: NormalizedFile[];
  attachments?: NormalizedAttachment[];
};

export type NormalizedConversation = {
  uuid: string;
  name?: string;
  /** The conversation's current model (e.g. "claude-opus-4-8"). claude.ai stores
   *  the model per CONVERSATION, not per message; ChatGPT carries it per message
   *  and the adapter folds the active model up to here. */
  model?: string | null;
  current_leaf_message_uuid: string | null;
  chat_messages: NormalizedMessage[];
};

// Back-compat aliases — the generic core keeps its `Api*` type names and only
// swaps its import path from '../api/types' to '../platforms/model'.
export type ApiContentBlock = NormalizedContentBlock;
export type ApiFile = NormalizedFile;
export type ApiAttachment = NormalizedAttachment;
export type ApiMessage = NormalizedMessage;
export type ApiConversation = NormalizedConversation;
