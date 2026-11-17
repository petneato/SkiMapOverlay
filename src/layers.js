// Tile sources, shared by the Airbnb hook (MAIN world) and the Google Maps
// overlay (isolated world). Tiles are 256px Web Mercator XYZ.
globalThis.SKI_OVERLAY_LAYERS = Object.freeze({
  terrain: Object.freeze({
    name: 'Topo',
    maxNativeZoom: 17,
    url: (x, y, z) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`
  }),
  pistes: Object.freeze({
    name: 'Ski runs',
    maxNativeZoom: 18,
    url: (x, y, z) => `https://tiles.opensnowmap.org/pistes/${z}/${x}/${y}.png`
  })
});
