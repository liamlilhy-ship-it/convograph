export type ApiContentBlock = {
  type: string;
  text?: string;
};

export type ApiMessage = {
  uuid: string;
  parent_message_uuid: string | null;
  sender: 'human' | 'assistant';
  content: ApiContentBlock[];
  created_at: string;
  index?: number;
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
