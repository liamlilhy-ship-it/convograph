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

/** One web image inside a content reference (a web-search result the model embedded
 *  inline). Unlike uploads/DALL·E, these carry DIRECT cdn urls (`images.openai.com`
 *  / search thumbnails) — no files-endpoint resolution. ChatGPT ships two shapes:
 *  flat (`image_v2` — urls on the entry) and nested (`image_group` — urls under
 *  `image_result`); `image_result` covers the latter. */
export type ChatGptRefImage = {
  url?: string; // source page
  content_url?: string; // full-size, directly viewable
  thumbnail_url?: string; // inline-size, directly viewable
  title?: string;
  image_result?: ChatGptRefImage; // nested-shape wrapper (image_group)
};

/** An inline reference token ChatGPT embeds in the answer text, wrapped in private-
 *  use sentinels (U+E200…U+E201). Image-carrying types (`image_v2`, `image_group`,
 *  …) expose an `images[]` we surface as media; citation types (`grouped_webpages`,
 *  `sources_footnote`) have no `images[]` and the adapter only strips their text. */
export type ChatGptContentReference = {
  type?: string;
  images?: ChatGptRefImage[];
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
    /** Inline reference tokens (web-search images + citations) the model wove into
     *  the answer text. The adapter strips their text tokens and surfaces the
     *  `image_v2` images as media. */
    content_references?: ChatGptContentReference[];
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
