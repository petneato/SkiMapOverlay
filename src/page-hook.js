// MAIN-world script (runs before Airbnb's code). Captures every google.maps.Map
// Airbnb creates and adds ski tile overlays to it.
(() => {
  'use strict';
  if (window.__skiOverlayHooked) return;
  window.__skiOverlayHooked = true;

  const EVT_SETTINGS = 'ski-overlay:settings';
  const EVT_READY = 'ski-overlay:ready';
  const EVT_TOGGLE = 'ski-overlay:toggle';
  const TAG = '[ski-overlay]';

  const LAYERS = globalThis.SKI_OVERLAY_LAYERS; // src/layers.js

  let settings = null;          // null until the bridge sends them
  let MapClass = null;          // the original google.maps.Map
  const maps = new Set();
  const state = new WeakMap();  // map -> { pistes, terrain, control, satOn, prevType }

  // ---------------------------------------------------------------- settings

  document.addEventListener(EVT_SETTINGS, (e) => {
    try {
      settings = JSON.parse(e.detail);
    } catch {
      return;
    }
    applyAll();
  });

  // ------------------------------------------------------------- tile layers

  // A custom MapType instead of ImageMapType so we can over-zoom: past the
  // tile server's max zoom we scale up the parent tile rather than show nothing.
  function makeLayer(def, opacity) {
    const tiles = new Set();
    return {
      tileSize: new google.maps.Size(256, 256),
      minZoom: 0,
      maxZoom: 22,
      name: def.name,
      alt: def.name,
      opacity,
      getTile(coord, zoom, doc) {
        const div = doc.createElement('div');
        div.style.cssText = 'width:256px;height:256px;overflow:hidden;position:relative;pointer-events:none;';
        div.style.opacity = String(this.opacity);
        const n = 2 ** zoom;
        if (coord.y < 0 || coord.y >= n) return div;
        const x = ((coord.x % n) + n) % n;
        const dz = Math.max(0, zoom - def.maxNativeZoom);
        const s = 2 ** dz;
        const img = doc.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        img.style.cssText =
          `position:absolute;border:0;padding:0;margin:0;max-width:none;max-height:none;` +
          `width:${256 * s}px;height:${256 * s}px;left:${-(x % s) * 256}px;top:${-(coord.y % s) * 256}px;`;
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
        img.src = def.url(Math.floor(x / s), Math.floor(coord.y / s), zoom - dz);
        div.appendChild(img);
        tiles.add(div);
        return div;
      },
      releaseTile(div) {
        tiles.delete(div);
      },
      setOpacity(o) {
        this.opacity = o;
        for (const t of tiles) t.style.opacity = String(o);
      }
    };
  }

  function indexOfLayer(arr, layer) {
    for (let i = 0; i < arr.getLength(); i++) if (arr.getAt(i) === layer) return i;
    return -1;
  }

  function syncLayer(map, st, key, want, opacity) {
    const overlays = map.overlayMapTypes;
    if (want && !st[key]) st[key] = makeLayer(LAYERS[key], opacity);
    if (!st[key]) return;
    if (st[key].opacity !== opacity) st[key].setOpacity(opacity);
    const idx = indexOfLayer(overlays, st[key]);
    if (want && idx < 0) {
      // Topo always sits underneath the ski runs.
      if (key === 'terrain') overlays.insertAt(0, st[key]);
      else overlays.push(st[key]);
    } else if (!want && idx >= 0) {
      overlays.removeAt(idx);
    }
  }

  function syncSatellite(map, st, want) {
    if (want && !st.satOn) {
      st.prevType = map.getMapTypeId() || 'roadmap';
      st.satOn = true;
      map.setMapTypeId('hybrid');
    } else if (!want && st.satOn) {
      st.satOn = false;
      map.setMapTypeId(st.prevType || 'roadmap');
    }
  }

  // --------------------------------------------------------- on-map control

  function makeControl() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Toggle ski map overlay (Alt+Shift+S)';
    btn.style.cssText = [
      'margin:10px', 'padding:6px 10px', 'border:0', 'border-radius:8px',
      'font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif',
      'box-shadow:0 1px 4px rgba(0,0,0,.3)', 'cursor:pointer',
      'display:flex', 'align-items:center', 'gap:6px'
    ].join(';');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent(EVT_TOGGLE));
    });
    return btn;
  }

  function renderControl(btn, on) {
    btn.textContent = on ? '⛷ Ski map: on' : '⛷ Ski map: off';
    btn.style.background = on ? '#1d4ed8' : '#fff';
    btn.style.color = on ? '#fff' : '#222';
  }

  // ------------------------------------------------------------------ apply

  function apply(map) {
    if (!settings) return;
    let st = state.get(map);
    try {
      if (!st) {
        st = { control: makeControl() };
        state.set(map, st);
        map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(st.control);
      }
      const siteOn = settings.airbnb !== false;
      const on = siteOn && !!settings.enabled;
      syncSatellite(map, st, on && settings.satellite);
      syncLayer(map, st, 'terrain', on && settings.terrain, settings.terrainOpacity);
      syncLayer(map, st, 'pistes', on && settings.pistes, settings.pistesOpacity);
      st.control.style.display = siteOn ? '' : 'none';
      renderControl(st.control, on);
    } catch (err) {
      console.warn(TAG, 'failed to apply overlay', err);
    }
  }

  function applyAll() {
    for (const map of maps) {
      const div = safe(() => map.getDiv());
      if (div && !div.isConnected && maps.size > 1) {
        maps.delete(map); // map from a previous SPA page
        continue;
      }
      apply(map);
    }
  }

  function track(map) {
    if (!map || maps.has(map)) return;
    maps.add(map);
    // Let the constructor / Airbnb's own setup finish first.
    setTimeout(() => apply(map), 0);
  }

  function safe(fn) {
    try { return fn(); } catch { return undefined; }
  }

  // ------------------------------------------------------- capture the map

  function wrapMethod(obj, name) {
    const orig = obj && Object.prototype.hasOwnProperty.call(obj, name) && obj[name];
    if (typeof orig !== 'function' || orig.__skiWrapped) return;
    const wrapped = function (...args) {
      if (MapClass && this instanceof MapClass) track(this);
      return orig.apply(this, args);
    };
    wrapped.__skiWrapped = true;
    obj[name] = wrapped;
  }

  function hookMaps(gm, Orig) {
    if (typeof Orig !== 'function' || Orig.__skiHooked || MapClass) return Orig;
    MapClass = Orig;
    Orig.__skiHooked = true;

    // 1. New maps: subclass the constructor.
    class SkiMap extends Orig {
      constructor(...args) {
        super(...args);
        track(this);
      }
    }
    SkiMap.__skiHooked = true;

    // 2. Maps created before we hooked (or via another reference to the class):
    //    catch them the first time any common method runs on them.
    const proto = Orig.prototype;
    for (const n of ['getBounds', 'getCenter', 'getZoom', 'setCenter', 'setZoom', 'fitBounds',
      'panTo', 'panBy', 'panToBounds', 'moveCamera', 'getDiv']) wrapMethod(proto, n);
    // MVCObject / event may be defined after Map, so also retry next tick.
    const hookShared = () => {
      if (gm.MVCObject) {
        for (const n of ['get', 'set', 'notify', 'setValues', 'setOptions', 'addListener']) {
          wrapMethod(gm.MVCObject.prototype, n);
        }
      }
      const add = gm.event && gm.event.addListener;
      if (typeof add === 'function' && !add.__skiWrapped) {
        gm.event.addListener = function (instance, ...rest) {
          if (instance instanceof Orig) track(instance);
          return add.call(this, instance, ...rest);
        };
        gm.event.addListener.__skiWrapped = true;
      }
    };
    safe(hookShared);
    setTimeout(() => safe(hookShared), 0);

    document.dispatchEvent(new CustomEvent(EVT_READY));
    return SkiMap;
  }

  // Intercept `google.maps.Map = ...` as the Maps API defines it, so we're in
  // place before Airbnb's load callback constructs its map.
  function trapProperty(obj, prop, onSet) {
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (desc && !desc.configurable) return false;
    if (desc && 'value' in desc && desc.value !== undefined) {
      const replaced = onSet(desc.value);
      if (replaced !== desc.value) obj[prop] = replaced;
      return true;
    }
    let value;
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => {
        const replaced = onSet(v);
        // Turn back into a plain data property once we've seen a real value.
        Object.defineProperty(obj, prop, { configurable: true, enumerable: true, writable: true, value: replaced });
        value = replaced;
      }
    });
    return true;
  }

  function onMapsNamespace(gm) {
    if (gm && typeof gm === 'object') safe(() => trapProperty(gm, 'Map', (Map) => hookMaps(gm, Map) || Map));
    return gm;
  }

  function onGoogleNamespace(g) {
    if (g && typeof g === 'object') safe(() => trapProperty(g, 'maps', onMapsNamespace));
    return g;
  }

  safe(() => trapProperty(window, 'google', onGoogleNamespace));

  // Fallback in case the API defines things in a way the traps don't see.
  let polls = 0;
  const poll = setInterval(() => {
    const gm = window.google && window.google.maps;
    if (gm && typeof gm.Map === 'function' && !MapClass) {
      const Hooked = hookMaps(gm, gm.Map);
      if (Hooked && gm.Map !== Hooked) safe(() => { gm.Map = Hooked; });
    }
    if (MapClass || ++polls > 600) clearInterval(poll);
  }, 100);

  document.dispatchEvent(new CustomEvent(EVT_READY));
})();
