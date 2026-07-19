# caveman-chartplotter

Satellite make map. Map show rocks. Rocks bad.

A simple, lightweight chart plotter for [SignalK](https://signalk.org/).

The whole point is to run *anywhere*: it's built to work on the older embedded browsers found in Navico MFDs (B&G Vulcan/Zeus, Simrad, Lowrance — Chromium 69 era), and it stays light enough for phones, tablets, and cheap boat computers. No frameworks, no build-time magic in the way — just Leaflet, a websocket, and your boat.

This is a hard fork of my anchor alarm plugin, [hoekens-anchor-alarm](https://github.com/hoeken/hoekens-anchor-alarm), with all the anchoring machinery stripped out and the chart plotting kept. If you want an anchor alarm, use that one — they run happily side by side.

## Features

### 🗺️ Charts and layers

Switch between satellite imagery, OpenStreetMap, or a blank base (for offline use or local-charts-only setups). Local raster charts served by a SignalK charts plugin appear automatically as overlays for the area you're looking at, and the optional [Seascape](https://openwaters.io/) bathymetry overlay shades water depth on capable browsers.

### 🛤️ Routes

Routes from your SignalK server's resources API are drawn on the chart — a green line with a dot at the start, arrows pointing the way along each leg, and a square at the end. Only routes near your current view are shown, each one gets its own checkbox in the layer control, and while you're actively navigating a route, it's the only one drawn. Routes refresh every minute, so edits made in Freeboard or any other app show up without a reload. Display is read-only (this is a chart plotter, not a route editor) and can be switched off with the "Show Routes" setting.

### 🧭 Course vectors

A COG/SOG predictor line extends from each vessel's bow, showing where it'll be after a set amount of travel time (5, 10, 15, 30, or 60 minutes, or off). It applies to your own boat and every AIS neighbor, and stationary vessels get no line — so a moored fleet doesn't sprout flickering vectors. The length is configurable in the settings dialog.

### 📍 Follow mode

Tap the home button and the viewport locks to your boat, staying highlighted green while it tracks; any drag of the map drops you back to free-pan. An optional "look ahead" biases the view toward the water in your direction of travel — scaled by speed and capped so the boat never leaves the screen — so you see more of where you're going instead of where you've been.

### 🛰️ Tracks & fleet

Historical tracks are color-coded (green for fresh, fading to red as they age) via the [@signalk/tracks-plugin](https://github.com/SignalK/tracks). With a v2 History API provider installed (e.g. [signalk-questdb](https://github.com/dirkwa/signalk-questdb)), your own track is rebuilt from the server's recorded position history instead, so it survives server restarts. Other AIS vessels show up too, with their own tracks and accurately-typed icons. Click a vessel for a detailed popup: name, MMSI, length, beam, distance, bearing, SOG, and COG.

### ⛵ Physically accurate boat icons

Give it your beam, LOA, and GPS antenna position and the boat icon is drawn to your boat's *true* size, rotating around the antenna location. Icons are picked by AIS ship type, or upload your own custom image from the settings dialog.

### 🌓 Day and night themes

A one-tap light/dark toggle, plus automatic handling of the `?mode=night` / `?mode=day` parameter Navico MFDs pass to embedded web apps. Dark mode dims the chrome, not your charts.

### ⚙️ In-map settings

Logged-in users can tweak the UI without leaving for the plugin config page. A gear button opens a settings dialog (basemap, layer toggles, route display, fleet radius, boat icon, course vector length, follow-mode look ahead) and every change applies live.

## Usage

Point your browser at:

```
http://[signalk-server-ip-address]:[port-number]/caveman-chartplotter/
```

> [!NOTE]
> You can view the app without logging in (read-only). The settings dialog appears once you log into your SignalK server — the login button lives at the top of the map and in the gear menu.

On a Navico MFD, install [signalk-navico-embedder](https://github.com/SignalK/signalk-navico-embedder) and the chartplotter shows up as a page on the console itself.

## Embedding

If you want to drop the chartplotter into another app or a dashboard (Grafana, a Node-RED dashboard, an MFD page, a custom SignalK webapp, an `<iframe>`), one query-string parameter trims the UI down to just the map:

```
http://[signalk-server-ip-address]:[port-number]/caveman-chartplotter/?embedded=true
```

| Parameter | Values | Default | Effect |
|---|---|---|---|
| `embedded` | `true` / `false` | `false` | When `true`, hides the settings (gear) control and the login prompt, leaving a clean map. The map, boat, and fleet still update live. |

Values are compared case-insensitively; anything other than `true` is treated as `false`.

> [!TIP]
> This pairs well with the existing `?mode=night` / `?mode=day` parameter (used by B&G/Navico MFDs), which forces the dark or light theme instead of following the device preference.

## Recommendations

This app pairs well with some other software:

- **[signalk-questdb](https://github.com/dirkwa/signalk-questdb)** (or any v2 History API provider): makes your own track survive server restarts, rebuilt from the last 24 hours of recorded position history.
- **[@signalk/tracks-plugin](https://github.com/SignalK/tracks)**: required for other vessels' historical tracks (and your own, without a history provider). I recommend a resolution of 1000ms and 86400 points, which gives you high-resolution data for the last 24 hours. If you've got the memory, you might as well use it.
- **[signalk-navico-embedder](https://github.com/SignalK/signalk-navico-embedder)**: puts the chartplotter on your Navico MFD as a native-feeling page.
- **[hoekens-anchor-alarm](https://github.com/hoeken/hoekens-anchor-alarm)**: this plugin's sibling — the full-featured anchor alarm this chartplotter was forked from.
- **[Tailscale](https://tailscale.com/)**: makes accessing SignalK remotely dead simple. Free, and a five-minute setup.

## Contributing

Issues and PRs are welcome; this is an open source project and I'm happy to have company. See [DEVELOPMENT.md](DEVELOPMENT.md) for getting set up, and [CHANGELOG.md](CHANGELOG.md) for the full history of what's changed.