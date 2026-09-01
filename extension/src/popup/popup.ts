/**
 * Toolbar popup: one switch — "Show pill on chats". Reads through the same
 * message client the content scripts use; the background persists the value
 * and broadcasts it to every open chat tab live.
 */
import { getSetting, setSetting, onSettingChange } from '../lib/settingsClient';

const toggle = document.getElementById('pill-toggle') as HTMLInputElement;

void getSetting('pillHidden').then((hidden) => {
  toggle.checked = !hidden;
});

toggle.addEventListener('change', () => {
  void setSetting('pillHidden', !toggle.checked);
});

// Keep the switch honest if the value changes while the popup is open.
onSettingChange('pillHidden', (hidden) => {
  toggle.checked = !hidden;
});
