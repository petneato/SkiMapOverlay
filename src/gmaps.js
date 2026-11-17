// Google Maps (the website) has no public map object to hook, so we draw our
// own tile layer on top of its canvas. Position comes from the URL
// (`/@lat,lng,ZOOMz` or `/@lat,lng,METERSm`, meters = visible height), which
// Google only updates once the map settles. In between we follow drags 1:1
// (fetching newly revealed tiles as we go) and fade out during zoom animations.
// On a zoom change the previous level's tiles stay up, scaled, until the new
// ones have loaded.
(() => {
  'use strict';
  if (window.__skiGmapsOverlay) return;
  window.__skiGmapsOverlay = true;

  const DEFAULTS = globalThis.SKI_OVERLAY_DEFAULTS;
  const LAYERS = globalThis.SKI_OVERLAY_LAYERS;
  const EARTH_RADIUS = 6371010; // Google's "m" form uses the mean radius
  const TILE = 256;
  const MARGIN_PX = 384;        // preload this far beyond the visible edge
  const FADE_MS = 120;
  const SETTLE_FALLBACK_MS = 1500;
  const PLACEHOLDER_MAX_MS = 4000;

  let settings = { ...DEFAULTS };
  let lastHref = '';
  let lastSize = '';
  let overlay = null;   // box over the map canvas
  let pane = null;      // translated during drags
  let button = null;
  const layers = {};    // key -> { root, front: Level, back: Level|null, backTimer }
  let current = null;   // { view, width, height } of the last render
  let drag = null;      // pointer start while the primary button is down
  let dragOffset = { x: 0, y: 0 };
  let lastPointer = { x: 0, y: 0, t: 0 };
  let velocity = 0;
  let fillQueued = false;
  let settleTimer = 0;

  // ---------------------------------------------------------------- view

  // Returns { lat, lng, zoom }, { tilted: true } for 3D views, or null.
  function parseView(href, viewportHeight) {
    if (/\/@-?[\d.]+,-?[\d.]+,[\d.]+a,/.test(href)) return { tilted: true }; // 3D camera form
    const m = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(z|m)((?:,[\d.]+[a-z])*)/.exec(href);
    if (!m) return null; // Street View, photos, etc.
    const tilt = /,([\d.]+)t/.exec(m[5]);
    const heading = /,([\d.]+)h/.exec(m[5]);
    if ((tilt && Number(tilt[1]) > 0) || (heading && Number(heading[1]) % 360 !== 0)) return { tilted: true };
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    let zoom = Number(m[3]);
    if (m[4] === 'm') {
      const metersPerPx = zoom / viewportHeight;
      zoom = Math.log2((2 * Math.PI * EARTH_RADIUS * Math.cos(lat * Math.PI / 180)) / (TILE * metersPerPx));
    }
    return Number.isFinite(zoom) ? { lat, lng, zoom } : null;
  }

  // World pixel coordinates at integer zoom z.
  function project(lat, lng, z) {
    const size = TILE * 2 ** z;
    const s = Math.min(Math.max(Math.sin(lat * Math.PI / 180), -0.9999), 0.9999);
    return {
      x: ((lng + 180) / 360) * size,
      y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size
    };
  }

  // ------------------------------------------------------------ tile levels

  // One zoom level of one layer. Tiles are positioned relative to a fixed
  // origin (ox, oy) chosen at creation, so they never move once placed and
  // CSS coordinates stay small.
  function makeLevel(z, view) {
    const c = project(view.lat, view.lng, z);
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;';
    return { el, z, ox: Math.floor(c.x / TILE) * TILE, oy: Math.floor(c.y / TILE) * TILE, tiles: new Map(), pending: 0 };
  }

  function placeLevel(level, view, width, height) {
    const scale = 2 ** (view.zoom - level.z);
    const c = project(view.lat, view.lng, level.z);
    level.el.style.transform =
      `translate(${width / 2}px,${height / 2}px) scale(${scale}) translate(${level.ox - c.x}px,${level.oy - c.y}px)`;
  }

  // Make sure every tile covering the view (shifted by an in-progress drag)
  // plus a margin exists; drop tiles well outside it.
  function fillLevel(entry, level, def, view, width, height, shift) {
    const scale = 2 ** (view.zoom - level.z);
    const c = project(view.lat, view.lng, level.z);
    const cx = c.x - shift.x / scale;
    const cy = c.y - shift.y / scale;
    const halfW = (width / 2 + MARGIN_PX) / scale;
    const halfH = (height / 2 + MARGIN_PX) / scale;
    const n = 2 ** level.z;
    const x0 = Math.floor((cx - halfW) / TILE);
    const x1 = Math.floor((cx + halfW) / TILE);
    const y0 = Math.max(0, Math.floor((cy - halfH) / TILE));
    const y1 = Math.min(n - 1, Math.floor((cy + halfH) / TILE));

    // The tile server allows ~6 parallel downloads per browser, so order
    // matters: request from the center outward, visible tiles before margin.
    const missing = [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (level.tiles.has(`${tx}/${ty}`)) continue;
        // Distance in viewport-relative units: <= 1 means on screen.
        const dx = Math.abs((tx + 0.5) * TILE - cx) / (width / 2 / scale);
        const dy = Math.abs((ty + 0.5) * TILE - cy) / (height / 2 / scale);
        missing.push({ tx, ty, d: Math.max(dx, dy) });
      }
    }
    missing.sort((a, b) => a.d - b.d);

    for (const { tx, ty } of missing) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.style.cssText =
        `position:absolute;width:${TILE}px;height:${TILE}px;max-width:none;border:0;` +
        `left:${tx * TILE - level.ox}px;top:${ty * TILE - level.oy}px;`;
      level.pending++;
      const done = (ok) => {
        if (img.__skiSettled) return; // already counted (pruned while loading)
        img.__skiSettled = true;
        if (!ok) img.style.visibility = 'hidden';
        level.pending--;
        if (entry.front === level && level.pending <= 0) dropBack(entry);
      };
      img.addEventListener('load', () => done(true), { once: true });
      img.addEventListener('error', () => done(false), { once: true });
      img.src = def.url(((tx % n) + n) % n, ty, level.z);
      level.tiles.set(`${tx}/${ty}`, img);
      level.el.appendChild(img);
    }
    // Prune with one extra tile of slack so small wiggles don't refetch.
    for (const [id, img] of level.tiles) {
      const [tx, ty] = id.split('/').map(Number);
      if (tx < x0 - 1 || tx > x1 + 1 || ty < y0 - 1 || ty > y1 + 1) {
        if (!img.__skiSettled) {
          img.__skiSettled = true;
          level.pending--;
          img.removeAttribute('src'); // cancel the download, free a connection
        }
        img.remove();
        level.tiles.delete(id);
      }
    }
  }

  function dropBack(entry) {
    clearTimeout(entry.backTimer);
    if (entry.back) {
      for (const img of entry.back.tiles.values()) if (!img.__skiSettled) img.removeAttribute('src');
      entry.back.el.remove();
    }
    entry.back = null;
  }

  function layerEntry(key, order) {
    if (!layers[key]) {
      const root = document.createElement('div');
      root.style.cssText = 'position:absolute;left:0;top:0;';
      layers[key] = { root, front: null, back: null, backTimer: 0 };
    }
    const entry = layers[key];
    if (pane.children[order] !== entry.root) pane.insertBefore(entry.root, pane.children[order] || null);
    return entry;
  }

  function renderLayer(key, order, view, width, height, opacity) {
    const def = LAYERS[key];
    const entry = layerEntry(key, order);
    entry.root.style.display = '';
    entry.root.style.opacity = String(opacity);
    const z = Math.max(0, Math.min(def.maxNativeZoom, Math.round(view.zoom)));

    if (!entry.front || entry.front.z !== z) {
      // Keep the old level underneath as a (scaled) placeholder.
      dropBack(entry);
      if (entry.front) {
        entry.back = entry.front;
        entry.backTimer = setTimeout(() => dropBack(entry), PLACEHOLDER_MAX_MS);
      }
      entry.front = makeLevel(z, view);
      entry.root.appendChild(entry.front.el);
    }
    if (entry.back) placeLevel(entry.back, view, width, height);
    placeLevel(entry.front, view, width, height);
    fillLevel(entry, entry.front, def, view, width, height, { x: 0, y: 0 });
    if (entry.front.pending <= 0) dropBack(entry);
  }

  function hideLayer(key) {
    if (layers[key]) layers[key].root.style.display = 'none';
  }

  function activeLayerKeys() {
    const keys = [];
    if (settings.terrain) keys.push('terrain');
    if (settings.pistes) keys.push('pistes');
    return keys;
  }

  // ------------------------------------------------------------- DOM

  function mapCanvas() {
    let best = null;
    let bestArea = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = c; bestArea = area; }
    }
    return bestArea > 40000 ? best : null;
  }

  function ensureOverlay(canvas) {
    const host = canvas.parentElement;
    if (overlay && overlay.parentElement === host) return;
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.id = 'ski-overlay-gmaps';
    overlay.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;' +
      `transition:opacity ${FADE_MS}ms ease;`;
    pane = document.createElement('div');
    pane.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;';
    overlay.appendChild(pane);
    for (const k of Object.keys(layers)) delete layers[k];
    // Directly above the map canvases, below Google's panels and buttons.
    const canvases = host.querySelectorAll(':scope > canvas');
    (canvases[canvases.length - 1] || canvas).insertAdjacentElement('afterend', overlay);
  }

  function render() {
    const canvas = mapCanvas();
    if (!canvas) return;
    ensureOverlay(canvas);
    const rect = canvas.getBoundingClientRect();
    lastHref = location.href;
    lastSize = `${rect.width}x${rect.height}`;
    const view = parseView(location.href, rect.height);
    const flat = !!view && !view.tilted;
    renderButton(view && view.tilted);
    const show = settings.enabled && settings.gmaps && flat;
    overlay.style.display = show ? '' : 'none';
    clearTimeout(settleTimer);
    if (!show) { current = null; return; }

    // The URL now reflects any drag so far; continue the drag from here.
    dragOffset = { x: 0, y: 0 };
    if (drag) drag = { x: lastPointer.x, y: lastPointer.y };
    pane.style.transform = '';
    current = { view, width: rect.width, height: rect.height };

    const keys = activeLayerKeys();
    keys.forEach((k, i) => renderLayer(k, i, view, rect.width, rect.height, settings[`${k}Opacity`]));
    for (const k of Object.keys(LAYERS)) if (!keys.includes(k)) hideLayer(k);
    overlay.style.opacity = '1';
  }

  // During a drag, fetch tiles for the area being dragged into view.
  function fillForDrag() {
    fillQueued = false;
    if (!current || !drag) return;
    const { view, width, height } = current;
    for (const k of activeLayerKeys()) {
      const entry = layers[k];
      if (entry?.front) fillLevel(entry, entry.front, LAYERS[k], view, width, height, dragOffset);
    }
  }

  function fadeOut() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    clearTimeout(settleTimer);
    // If the URL never changes (e.g. zoom was already at its limit), come back anyway.
    settleTimer = setTimeout(render, SETTLE_FALLBACK_MS);
  }

  // ----------------------------------------------------------- button

  function renderButton(tilted) {
    if (!settings.gmaps) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = [
        'position:fixed', 'top:72px', 'right:16px', 'z-index:10', 'padding:7px 12px',
        'border:0', 'border-radius:8px', 'cursor:pointer',
        'font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif',
        'box-shadow:0 1px 4px rgba(0,0,0,.3)'
      ].join(';');
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await saveSettings({ ...settings, enabled: !settings.enabled });
      });
    }
    if (!button.isConnected) document.body.appendChild(button);
    const on = settings.enabled;
    if (on && tilted) {
      button.textContent = '⛷ Ski map: 2D only';
      button.title = 'Ski runs can\'t be lined up with Google\'s tilted 3D view. ' +
        'Switch back to a flat (2D) view to see them. Click to turn the overlay off.';
      button.style.background = '#fef3c7';
      button.style.color = '#78350f';
      return;
    }
    button.textContent = on ? '⛷ Ski map: on' : '⛷ Ski map: off';
    button.title = 'Toggle ski map overlay (Alt+Shift+S)';
    button.style.background = on ? '#1d4ed8' : '#fff';
    button.style.color = on ? '#fff' : '#222';
  }

  // ------------------------------------------------------- interaction

  // The map is drawn on stacked canvases; events land on the top one.
  function onMap(target) {
    return target instanceof Element && target.tagName === 'CANVAS' &&
      !!overlay && target.parentElement === overlay.parentElement;
  }

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !onMap(e.target)) return;
    drag = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
    lastPointer = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    velocity = 0;
  }, true);

  window.addEventListener('pointermove', (e) => {
    const prev = lastPointer;
    lastPointer = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!drag || !pane) return;
    if (!(e.buttons & 1)) { drag = null; return; }
    const dt = e.timeStamp - (prev.t || 0);
    if (dt > 0) velocity = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) / dt;
    dragOffset = { x: e.clientX - drag.x, y: e.clientY - drag.y };
    pane.style.transform = `translate(${dragOffset.x}px,${dragOffset.y}px)`;
    if (!fillQueued) {
      fillQueued = true;
      requestAnimationFrame(fillForDrag);
    }
  }, true);

  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    if (dragOffset.x === 0 && dragOffset.y === 0) return;
    // A fling keeps the map gliding after release, so hide until it settles.
    const stillMoving = e.timeStamp - (lastPointer.t || 0) < 50;
    if (velocity > 0.5 && stillMoving) {
      fadeOut();
    } else {
      // Normally the URL updates and render() takes over. If it never does
      // (Google ignored the drag), snap back to the URL's view.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(render, SETTLE_FALLBACK_MS);
    }
  };
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', endDrag, true);

  window.addEventListener('wheel', (e) => { if (onMap(e.target)) fadeOut(); }, { capture: true, passive: true });
  window.addEventListener('dblclick', (e) => { if (onMap(e.target)) fadeOut(); }, true);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('[role="application"]') &&
        /^(Arrow|\+|-|=|PageUp|PageDown|Home|End)/.test(e.key)) fadeOut();
  }, true);
  // Zoom buttons animate the camera too.
  window.addEventListener('click', (e) => {
    const b = e.target instanceof Element && e.target.closest('button');
    if (b && b !== button && /zoom/i.test(b.getAttribute('aria-label') || '')) fadeOut();
  }, true);

  // URL / size changes. Google uses replaceState, which fires no event here.
  setInterval(() => {
    const canvas = mapCanvas();
    const r = canvas && canvas.getBoundingClientRect();
    const size = r ? `${r.width}x${r.height}` : '';
    if (location.href !== lastHref || size !== lastSize || (canvas && !overlay?.isConnected)) render();
  }, 100);

  // ---------------------------------------------------------- settings

  async function saveSettings(next) {
    settings = next;
    render();
    try {
      await chrome.storage.local.set({ settings: next });
    } catch (err) {
      console.warn('[ski-overlay] could not save settings', err);
    }
  }

  async function init() {
    try {
      const { settings: stored } = await chrome.storage.local.get('settings');
      settings = { ...DEFAULTS, ...stored };
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) {
          settings = { ...DEFAULTS, ...changes.settings.newValue };
          render();
        }
      });
    } catch (err) {
      console.warn('[ski-overlay] could not read settings', err);
    }
    render();
  }

  init();
})();
