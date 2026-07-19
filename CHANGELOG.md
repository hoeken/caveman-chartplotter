# v1.3.0

- **Own track survives server restarts** — when a v2 History API provider (e.g. [signalk-questdb](https://github.com/dirkwa/signalk-questdb)) is installed, the UI rebuilds your own track at startup from the last 24 hours of `navigation.position` at 10-second resolution, so a server restart no longer wipes it. Once seeded from history, the shorter `/tracks` payload no longer clobbers it, and live deltas keep extending it as before. Without a history provider everything behaves exactly as it did. `signalk-questdb` is now the recommended track source, replacing `@signalk/tracks-plugin` in the recommended plugins.
- **Leaner initial load** — page load now makes one `/ui-config` request (which serves `selfId` and the plugin version) plus a single bulk `/vessels` fetch that seeds both your own boat's state and the fleet cache, instead of fetching the large own-vessel tree twice across `/vessels/self` and `/vessels`. Config loads first, so the first render already uses your configured settings. Anonymous sessions, which can't read `ui-config`, learn the vessel identity from the tiny public `/self` endpoint instead.
- **Fixes**
  - Stopped sending per-vessel unsubscribe frames when an AIS vessel ages out of the fleet — SignalK only accepts the global unsubscribe form and logged an error for each one, spamming the server log.
  - Historical tracks are now silently skipped when the tracks plugin isn't installed, instead of surfacing errors for an optional feature.

# v1.2.0

- **Smoother follow mode** — following your boat now reads as a continuous glide rather than a 2 Hz hop.
  - Each tracking tick eases the recenter with an animated `panTo` (interrupted mid-flight by the next tick) instead of teleporting the view with `setView`. Cursor-anchored zooms still snap instantly so a pan animation doesn't fight the zoom.
  - The look-ahead bearing is fed through a circular exponential moving average (blending unit vectors so it averages correctly across the 0/2π wrap) with a 10-second time constant, so wave-induced yaw no longer makes the view lurch while a real turn is still tracked within a few seconds.
- **Follow zoom fits the course vector** — `frameZoom()` picks the highest zoom at which your whole course vector (boat to its predicted position `courseVectorMinutes` ahead) still fits the viewport, so the faster you go the wider you frame. Capped at zoom 18 so a stopped boat frames a harbor, with padding reserved for the look-ahead center bias. Computed only when framing (home button + initial load), so a manual zoom survives while following. The default follow zoom is also widened from 16 to 14 for more surrounding context.
- **Restyled routes** — routes are now drawn in a dark, muted red (`#8b2222`) instead of bright green, and sunk beneath the overlay pane so your own track and course vector always draw on top. Waypoint shapes sit one pane above the route line so the dot/triangles/square stay on top of it.

# v1.1.0

- **Routes on the chart** — read-only routes from the SignalK resources provider (`/signalk/v2/api/resources/routes`) are drawn as a solid green line with a dot at the start, direction triangles along each leg, and a square at the end (rendered with SVG attribute rotation so it works on Chromium 69 MFDs).
  - Only routes touching the viewport are drawn, recomputed as you pan/zoom, with correct handling of antimeridian-crossing views and routes.
  - Routes re-poll every 60 seconds, so edits made in other apps appear live.
  - New **Show Routes** setting (default on) in the plugin schema and the in-map settings dialog.
  - In-view routes get per-route checkboxes in the layer control, grouped below a divider and sorted alphabetically.
  - While actively navigating a route (`navigation.course.activeRoute`), only that route is shown.
- Clicking the home button now closes any open vessel info popup before recentering on your boat.

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
