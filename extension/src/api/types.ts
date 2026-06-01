export type ApiContentBlock = {
  type: string;
  text?: string;
};

/**
 * A file attached to a message. claude.ai exposes two parallel arrays:
 *   - `files_v2` — newer shape (file_size_bytes, *_asset objects)
 *   - `files`    — legacy shape (file_size, file_type, image_asset)
 * Both share enough fields to use one type with everything optional.
 * Images carry `thumbnail_url`/`preview_url` (relative `/api/...` paths);
 * documents carry a `document_asset` and no preview URL.
 */
export type ApiFile = {
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
export type ApiAttachment = {
  id?: string;
  file_uuid?: string;
  file_name?: string;
  file_size?: number;
  file_type?: string;
  extracted_content?: string;
};

export type ApiMessage = {
  uuid: string;
  parent_message_uuid: string | null;
  sender: 'human' | 'assistant';
  content: ApiContentBlock[];
  created_at: string;
  index?: number;
  files_v2?: ApiFile[];
  files?: ApiFile[];
  attachments?: ApiAttachment[];
};

export type ApiConversation = {
  uuid: string;
  name?: string;
  current_leaf_message_uuid: string | null;
  chat_messages: ApiMessage[];
};

export type ApiOrganization = {
  uuid: string;
  name?: string;
};
