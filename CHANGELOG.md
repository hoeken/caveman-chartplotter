# v1.0.1

- Include the SignalK screenshots (`docs/screenshots/*.png`) in the published npm tarball — they were referenced by `signalk.screenshots` but excluded by the `files` allowlist.

# v1.0.0

Initial release of **Caveman Chartplotter** — a simple, lightweight chart plotter for SignalK, built to run anywhere, including the older embedded browsers (Chromium 69) found in Navico MFDs.

This project is a hard fork of [hoekens-anchor-alarm](https://github.com/hoeken/hoekens-anchor-alarm) v2.8.0 with all anchoring functionality removed (watch zones, scope calculator, drag alarm, watchdog, engine override, glitch filter, and the tide/wind/scope/info panels). What remains — and what this plugin is about:

- **Base maps** — satellite imagery, OpenStreetMap, or a blank base for offline/local-charts-only use
- **Local chart layers** — raster charts from a SignalK charts plugin appear automatically as overlays for the visible area
- **Seascape bathymetry** — optional water-depth overlay on WebGL-capable browsers
- **Physically accurate boat icons** — drawn to true size from your beam/LOA/antenna offsets, typed by AIS ship type, with custom icon upload
- **Fleet & tracks** — live AIS neighbors with name labels and info popups, plus color-coded historical tracks via @signalk/tracks-plugin
- **Course vectors** — a COG/SOG predictor line from each vessel's bow showing where it will be after a configurable time (5–60 min, or off)
- **Follow mode** — the home button locks the viewport to your boat and stays highlighted green while tracking; any drag returns to free-pan. An optional "look ahead" biases the view toward the water ahead based on your speed and course
- **Day/night themes** — one-tap toggle plus native handling of the Navico `?mode=night`/`?mode=day` parameter
- **In-map settings** — login/logout and live-applying configuration from a gear button on the map
- **Embedding** — `?embedded=true` strips the chrome for use inside dashboards and MFD pages
