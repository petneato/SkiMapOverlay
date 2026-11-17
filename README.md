# Ski Map Overlay

A Chrome extension that draws ski runs and lifts on **Airbnb** maps (search results and the
"Where you'll be" map on listings) and on **Google Maps**, so you can see how close a stay
really is to the slopes.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Reload any open Airbnb / Google Maps tabs

## Turning it on and off

- **⛷ Ski map** button on the map: bottom-left on Airbnb, top-right on Google Maps
- **Alt+Shift+S** from anywhere in Chrome (change it at `chrome://extensions/shortcuts`)
- The switch at the top of the toolbar popup
- The toolbar icon shows an **OFF** badge while it's off.
- **Show on: Airbnb / Google Maps** in the popup turns a site off completely, including its button.

## Settings (toolbar popup)

- **Ski runs & lifts**: on/off and opacity
- **Topo contours**: a contour/terrain map blended underneath, to show steepness and valley floors
- **Satellite base map** (Airbnb): switches Airbnb's map to satellite imagery, good for checking
  ski-in/ski-out claims. On Google Maps, use Google's own Layers → Satellite.

Run colors follow the European convention (green/blue/red/black). North American resorts are
tagged so that blue squares usually show as red.

## How it works

- **Airbnb** uses the Google Maps JavaScript API. `src/page-hook.js` runs before Airbnb's code,
  hooks `google.maps.Map` as it is defined, and adds tile layers to every map through
  `overlayMapTypes`, so they pan and zoom natively.
- **Google Maps** (the website) has no hookable map object. `src/gmaps.js` reads the view from the
  URL (`/@lat,lng,14z`, or `/@lat,lng,8370m` in satellite, where the meters are the visible height)
  and draws its own tile layer over the map canvas. Google only updates the URL once the map
  settles, so the overlay follows drags live (fetching newly revealed tiles as you drag), fades
  out during zoom animations and flings, and snaps back into place when the URL updates. After a
  zoom, the previous level's tiles stay up, scaled, until the sharp ones arrive. Tiles load
  center-out because the tile server only allows ~6 parallel downloads.
- **3D / tilted Google Maps isn't supported.** Google drapes its imagery over real terrain, and
  a flat overlay can't follow that (on a 1,000 m slope at 45° tilt the error is about 1 km). The
  button reads "2D only" in that mode.
- `src/layers.js` holds the tile sources, `src/bridge.js` relays settings to the Airbnb hook,
  and `background.js` handles the shortcut and badge.

## Data sources

- Runs and lifts: [OpenSnowMap](https://www.opensnowmap.org) tiles, data © OpenStreetMap contributors
- Topo: [OpenTopoMap](https://opentopomap.org) (CC-BY-SA)
- Satellite: Google, through Airbnb's own map

These are free community tile servers. The extension only fetches tiles for the map area you're looking at.
