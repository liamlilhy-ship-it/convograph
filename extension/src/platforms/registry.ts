import type { Platform } from './types';

/**
 * Resolves the platform for the current host. Uses dynamic `import()` so only the
 * matched platform's code is ever fetched/parsed on a given site — the ChatGPT
 * module is never loaded on claude.ai, and vice versa. Returns null on any host we
 * don't handle (the manifest already restricts us to known hosts, so this is just
 * a safety net).
 */
export async function selectPlatform(hostname: string): Promise<Platform | null> {
  if (hostname === 'claude.ai' || hostname.endsWith('.claude.ai')) {
    return (await import('./claude/platform')).ClaudePlatform;
  }
  if (
    hostname === 'chatgpt.com' ||
    hostname.endsWith('.chatgpt.com') ||
    hostname === 'chat.openai.com'
  ) {
    return (await import('./chatgpt/platform')).ChatGptPlatform;
  }
  return null;
}
