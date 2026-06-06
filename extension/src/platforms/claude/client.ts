import type { ApiConversation } from '../model';
import { PlatformApiError } from '../errors';

const BASE = 'https://claude.ai/api';

/** claude.ai's `/organizations` entries. Only the id is used. */
type ApiOrganization = { uuid: string; name?: string };

class ClaudeApiError extends PlatformApiError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'ClaudeApiError';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ClaudeApiError(res.status, `GET ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getOrgId(): Promise<string> {
  const raw = await getJson<unknown>('/organizations');
  const list = Array.isArray(raw)
    ? (raw as ApiOrganization[])
    : ((raw as { organizations?: ApiOrganization[] }).organizations ?? []);
  const first = list[0]?.uuid;
  if (!first) throw new Error('No organizations found on claude.ai account');
  return first;
}

export async function getConversationTree(
  orgId: string,
  convId: string,
): Promise<ApiConversation> {
  const path = `/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages&render_all_tools=true`;
  return getJson<ApiConversation>(path);
}

/**
 * Sets the active branch of a conversation by pointing its current leaf at
 * `leafUuid`. This is the exact call claude.ai's native `<`/`>` version
 * arrows make. Updates the server only — the SPA must be told to re-render
 * separately (see navigation/jumpToNode.ts).
 */
export async function setCurrentLeaf(
  orgId: string,
  convId: string,
  leafUuid: string,
): Promise<void> {
  const path = `/organizations/${orgId}/chat_conversations/${convId}/current_leaf_message_uuid`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ current_leaf_message_uuid: leafUuid }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ClaudeApiError(res.status, `PUT ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
}

export function parseConversationIdFromUrl(href: string = window.location.href): string | null {
  const m = href.match(/\/chat\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export { ClaudeApiError };
