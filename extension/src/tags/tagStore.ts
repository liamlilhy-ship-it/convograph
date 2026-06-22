import { EMPTY_TAG_STATE, type TagState } from './tags';

/**
 * Persists per-conversation tag state in `chrome.storage.local` — local only, no
 * login. One key per conversation (`cg-tags:<convId>`) so switching chats reads
 * only that chat's tags and a chat's tags can never bleed into another.
 *
 * Both functions are defensive: a `chrome.storage` guard + try/catch means they
 * never throw — tagging simply degrades to "no tags" if storage is unavailable
 * (e.g. in unit tests, or if the `storage` permission is missing).
 */

const KEY_PREFIX = 'cg-tags:';
const keyFor = (convId: string): string => `${KEY_PREFIX}${convId}`;

function storageArea(): chrome.storage.StorageArea | null {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    return chrome.storage.local;
  } catch {
    return null;
  }
}

/** Load a conversation's tag state; EMPTY_TAG_STATE if absent or on any error. */
export async function loadTagState(convId: string): Promise<TagState> {
  const area = storageArea();
  if (!area) return EMPTY_TAG_STATE;
  try {
    const key = keyFor(convId);
    const got = await area.get(key);
    const state = got[key] as TagState | undefined;
    if (!state || typeof state !== 'object' || !state.tags || !state.assignments) {
      return EMPTY_TAG_STATE;
    }
    return state;
  } catch {
    return EMPTY_TAG_STATE;
  }
}

/** Persist a conversation's tag state (whole-object overwrite). Fire-and-forget;
 *  callers don't await it in the render path. Swallows errors. */
export async function saveTagState(convId: string, state: TagState): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    await area.set({ [keyFor(convId)]: state });
  } catch {
    /* storage unavailable / quota — tagging degrades silently */
  }
}
