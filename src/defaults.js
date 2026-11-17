// Shared by the content scripts, popup and service worker.
globalThis.SKI_OVERLAY_DEFAULTS = Object.freeze({
  enabled: true,        // master on/off (popup switch, on-map buttons, Alt+Shift+S)
  airbnb: true,         // run on Airbnb maps
  gmaps: true,          // run on Google Maps
  pistes: true,         // OpenSnowMap runs + lifts (transparent)
  pistesOpacity: 1,
  terrain: false,       // OpenTopoMap contours/shading (opaque, so blended)
  terrainOpacity: 0.55,
  satellite: false      // Airbnb only: switch its base map to satellite + labels
});
