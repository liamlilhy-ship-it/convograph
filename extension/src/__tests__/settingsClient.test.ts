import { beforeEach, describe, expect, it } from 'vitest';
import { getSetting, setSetting, onSettingChange } from '../lib/settingsClient';
import { DEFAULTS, type SettingChangedMsg, type Settings, type SettingsRequest } from '../lib/settings';

/**
 * Fake extension runtime: sendMessage routes to an in-memory "background"
 * (settings object + change broadcast to onMessage listeners), mirroring the
 * real background worker's protocol handling.
 */
type Listener = (msg: unknown) => void;
let settings: Settings;
let listeners: Listener[];

beforeEach(() => {
  settings = { ...DEFAULTS };
  listeners = [];
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: (raw: unknown) => {
        const msg = raw as SettingsRequest;
        if (msg.type === 'cg-get-settings') return Promise.resolve({ ...settings });
        if (msg.type === 'cg-set-setting') {
          settings[msg.key] = msg.value;
          const change: SettingChangedMsg = { type: 'cg-setting-changed', key: msg.key, value: msg.value };
          for (const l of listeners) l(change);
          return Promise.resolve(true);
        }
        return Promise.reject(new Error('unknown message'));
      },
      onMessage: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
    },
  };
});

describe('settingsClient', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await getSetting('pillHidden')).toBe(false);
  });

  it('round-trips a set value through the background', async () => {
    await setSetting('pillHidden', true);
    expect(await getSetting('pillHidden')).toBe(true);
  });

  it('notifies subscribers on broadcast and stops after unsubscribe', async () => {
    const seen: boolean[] = [];
    const off = onSettingChange('pillHidden', (v) => seen.push(v));
    await setSetting('pillHidden', true);
    await setSetting('pillHidden', false);
    off();
    await setSetting('pillHidden', true);
    expect(seen).toEqual([true, false]);
  });

  it('ignores unrelated broadcasts', () => {
    const seen: boolean[] = [];
    onSettingChange('pillHidden', (v) => seen.push(v));
    for (const l of listeners) l({ type: 'cg-setting-changed', key: 'other', value: true });
    for (const l of listeners) l({ type: 'something-else' });
    for (const l of listeners) l(null);
    expect(seen).toEqual([]);
  });

  it('falls back to defaults when the extension context is unavailable', async () => {
    (globalThis as Record<string, unknown>).chrome = undefined;
    expect(await getSetting('pillHidden')).toBe(false);
    await expect(setSetting('pillHidden', true)).resolves.toBeUndefined();
  });
});
