/**
 * Extension-wide user preferences — schema and message protocol.
 *
 * Persistence lives in the background service worker's own IndexedDB (the
 * extension origin needs NO manifest permission for it); everyone else talks
 * to the background over runtime messages:
 *
 *   content script / popup  --cg-get-settings-->  background (reads IndexedDB)
 *   popup                   --cg-set-setting-->   background (writes, then
 *     broadcasts cg-setting-changed to every chat tab and the popup)
 *
 * Add future preferences to `Settings`/`DEFAULTS`; the store, client, and
 * broadcast plumbing are key-generic and pick them up automatically.
 */
export type Settings = {
  /** Hide the Convograph entry pill everywhere (toggled from the toolbar popup). */
  pillHidden: boolean;
};

export const DEFAULTS: Settings = { pillHidden: false };

export type SettingsRequest =
  | { type: 'cg-get-settings' }
  | { type: 'cg-set-setting'; key: keyof Settings; value: Settings[keyof Settings] };

export type SettingChangedMsg = {
  type: 'cg-setting-changed';
  key: keyof Settings;
  value: Settings[keyof Settings];
};
