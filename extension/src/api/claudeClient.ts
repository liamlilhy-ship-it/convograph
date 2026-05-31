import type { ApiConversation, ApiOrganization } from './types';

const BASE = 'https://claude.ai/api';

class ClaudeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
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

export function parseConversationIdFromUrl(href: string = window.location.href): string | null {
  const m = href.match(/\/chat\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export { ClaudeApiError };
