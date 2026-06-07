/** Loose shapes for ChatGPT's `GET /backend-api/conversation/{id}` response.
 *  Everything is optional — the adapter tolerates missing/extra fields. */

/** A non-text content part: an inline image (`image_asset_pointer`). Both user
 *  uploads and assistant-generated (DALL·E) images use this shape; the
 *  `asset_pointer` is `sediment://file_…` (or legacy `file-service://file-…`),
 *  whose file id resolves to a download URL via the files endpoint. */
export type ChatGptImagePart = {
  content_type?: string; // 'image_asset_pointer'
  asset_pointer?: string;
  width?: number;
  height?: number;
  size_bytes?: number;
};

/** An uploaded file recorded on the user message that referenced it. For images
 *  `id` equals the file id inside the message's `image_asset_pointer` part. */
export type ChatGptAttachment = {
  id?: string;
  name?: string;
  mime_type?: string;
  size?: number;
  width?: number;
  height?: number;
};

export type ChatGptMessage = {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: {
    content_type?: string;
    /** Interleaved text + media. Text parts are strings; media parts are objects
     *  (e.g. `image_asset_pointer`). The adapter joins strings and extracts the
     *  objects it understands. */
    parts?: Array<string | ChatGptImagePart | { content_type?: string }>;
    text?: string;
  };
  /** Who the message is addressed to: 'all' = user-facing; a tool name
   *  (e.g. 'web.run', 'python') = a tool call, which the adapter drops. */
  recipient?: string;
  metadata?: {
    model_slug?: string;
    /** Hidden system/tool/reasoning nodes set this; the adapter drops them. */
    is_visually_hidden_from_conversation?: boolean;
    /** Files uploaded on this message (images + documents). */
    attachments?: ChatGptAttachment[];
  };
};

export type ChatGptMappingNode = {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: ChatGptMessage | null;
};

export type ChatGptConversation = {
  conversation_id?: string;
  title?: string;
  /** The active leaf node id (ChatGPT's equivalent of current_leaf). */
  current_node?: string | null;
  mapping?: Record<string, ChatGptMappingNode>;
};
