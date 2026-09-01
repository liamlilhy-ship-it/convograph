/**
 * Settings access for content scripts and the popup: a thin client over
 * runtime messages to the background worker, which owns the IndexedDB copy
 * (see settings.ts for the protocol). Every API degrades to DEFAULTS when the
 * extension context is unavailable (tests, torn-down frames).
 */
import { DEFAULTS, type SettingChangedMsg, type Settings, type SettingsRequest } from './settings';

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  try {
    const req: SettingsRequest = { type: 'cg-get-settings' };
    const s = (await chrome.runtime.sendMessage(req)) as Settings | undefined;
    return (s?.[key] ?? DEFAULTS[key]) as Settings[K];
  } catch {
    return DEFAULTS[key];
  }
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  try {
    const req: SettingsRequest = { type: 'cg-set-setting', key, value };
    await chrome.runtime.sendMessage(req);
  } catch {
    // Background unreachable — nothing to surface.
  }
}

/** Subscribe to one setting's broadcasts. Returns an unsubscribe function. */
export function onSettingChange<K extends keyof Settings>(
  key: K,
  cb: (value: Settings[K]) => void,
): () => void {
  const listener = (raw: unknown) => {
    const msg = raw as SettingChangedMsg | undefined;
    if (msg?.type === 'cg-setting-changed' && msg.key === key) cb(msg.value as Settings[K]);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
