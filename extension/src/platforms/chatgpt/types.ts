/** Loose shapes for ChatGPT's `GET /backend-api/conversation/{id}` response.
 *  Everything is optional — the adapter tolerates missing/extra fields. */

export type ChatGptMessage = {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[]; text?: string };
  metadata?: {
    model_slug?: string;
    /** Hidden system/tool/reasoning nodes set this; the adapter drops them. */
    is_visually_hidden_from_conversation?: boolean;
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
