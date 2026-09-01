/**
 * Background service worker — owner of the settings store. The toolbar popup
 * writes through it; it persists to the extension-origin IndexedDB (no
 * manifest permission needed) and broadcasts each change to every open chat
 * tab (tabs.sendMessage — covered by the existing host permissions) and to
 * the popup. The icon's badge mirrors the pill state so a hidden pill is
 * visible at a glance.
 */
import { type SettingChangedMsg, type Settings, type SettingsRequest } from './lib/settings';
import { readSettings, writeSetting } from './lib/settingsStore';

const CHAT_HOSTS = ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*'];

async function reflectState(hidden: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: hidden ? 'off' : '' });
}

async function broadcast<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const msg: SettingChangedMsg = { type: 'cg-setting-changed', key, value };
  const tabs = await chrome.tabs.query({ url: CHAT_HOSTS });
  await Promise.allSettled(
    tabs.map((t) => (t.id != null ? chrome.tabs.sendMessage(t.id, msg) : Promise.resolve())),
  );
  // Reaches the popup when it's open; rejects harmlessly when it isn't.
  await chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as SettingsRequest | undefined;
  if (msg?.type === 'cg-get-settings') {
    void readSettings().then(sendResponse);
    return true; // async response
  }
  if (msg?.type === 'cg-set-setting') {
    void (async () => {
      await writeSetting(msg.key, msg.value);
      if (msg.key === 'pillHidden') await reflectState(msg.value);
      await broadcast(msg.key, msg.value);
      sendResponse(true);
    })();
    return true; // async response
  }
  return undefined;
});

// The MV3 worker restarts on demand — re-sync the badge on every boot.
void readSettings().then((s) => reflectState(s.pillHidden));
