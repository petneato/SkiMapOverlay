const DEFAULTS = globalThis.SKI_OVERLAY_DEFAULTS;
const CHECKS = ['enabled', 'airbnb', 'gmaps', 'pistes', 'terrain', 'satellite'];
const RANGES = ['pistesOpacity', 'terrainOpacity'];
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };

function render() {
  for (const k of CHECKS) $(k).checked = !!settings[k];
  for (const k of RANGES) $(k).value = settings[k];
  $('pistesOpacity').disabled = !settings.pistes;
  $('terrainOpacity').disabled = !settings.terrain;
  $('controls').classList.toggle('off', !settings.enabled);
}

async function save() {
  try {
    await chrome.storage.local.set({ settings });
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

async function init() {
  try {
    const stored = await chrome.storage.local.get('settings');
    settings = { ...DEFAULTS, ...stored.settings };
  } catch (err) {
    console.error('Could not load settings', err);
  }
  render();

  for (const k of CHECKS) {
    $(k).addEventListener('change', async (e) => {
      settings[k] = e.target.checked;
      render();
      await save();
    });
  }
  for (const k of RANGES) {
    // Live update while dragging, at most one write per animation frame.
    let pending = false;
    $(k).addEventListener('input', (e) => {
      settings[k] = Number(e.target.value);
      if (pending) return;
      pending = true;
      requestAnimationFrame(async () => {
        pending = false;
        await save();
      });
    });
  }
}

init();
