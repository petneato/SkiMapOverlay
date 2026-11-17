// Keyboard shortcut (Alt+Shift+S) and the "OFF" badge on the toolbar icon.
importScripts('src/defaults.js');

const DEFAULTS = globalThis.SKI_OVERLAY_DEFAULTS;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

async function updateBadge(settings) {
  try {
    const s = settings || await getSettings();
    await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    await chrome.action.setBadgeText({ text: s.enabled ? '' : 'OFF' });
    await chrome.action.setTitle({ title: `Ski Map Overlay (${s.enabled ? 'on' : 'off'})` });
  } catch (err) {
    console.error('Could not update badge', err);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  try {
    const s = await getSettings();
    await chrome.storage.local.set({ settings: { ...s, enabled: !s.enabled } });
  } catch (err) {
    console.error('Could not toggle overlay', err);
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.settings) await updateBadge({ ...DEFAULTS, ...changes.settings.newValue });
});

chrome.runtime.onInstalled.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(() => updateBadge());
