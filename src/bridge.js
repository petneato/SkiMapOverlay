// Isolated-world content script: relays settings between chrome.storage and
// the MAIN-world page hook (which can't use chrome.* APIs).
(() => {
  const EVT_SETTINGS = 'ski-overlay:settings';
  const EVT_READY = 'ski-overlay:ready';
  const EVT_TOGGLE = 'ski-overlay:toggle';
  const DEFAULTS = globalThis.SKI_OVERLAY_DEFAULTS;

  async function load() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      return { ...DEFAULTS, ...settings };
    } catch (err) {
      console.warn('[ski-overlay] could not read settings', err);
      return { ...DEFAULTS };
    }
  }

  function send(settings) {
    document.dispatchEvent(new CustomEvent(EVT_SETTINGS, { detail: JSON.stringify(settings) }));
  }

  document.addEventListener(EVT_READY, async () => send(await load()));

  document.addEventListener(EVT_TOGGLE, async () => {
    const settings = await load();
    settings.enabled = !settings.enabled;
    try {
      await chrome.storage.local.set({ settings });
    } catch (err) {
      console.warn('[ski-overlay] could not save settings', err);
      send(settings);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) send({ ...DEFAULTS, ...changes.settings.newValue });
  });

  (async () => send(await load()))();
})();
