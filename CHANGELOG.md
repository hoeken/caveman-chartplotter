# v1.5.0

Per-user settings and a round of touch/mobile polish (mostly ported from hoekens-anchor-alarm):

- **UI settings are now saved per user** — preferences live in small per-identity files under the plugin's data directory (keyed by username for user logins, client ID for device tokens, with a shared bucket for anonymous sessions) instead of in the plugin config, so different logins keep their own settings and saving from the map no longer rewrites the server's plugin configuration. Each read layers schema defaults → boat-wide defaults → your own saved keys, and a one-shot migration at startup lifts preferences from pre-1.5 installs into the boat-wide defaults so existing choices survive the upgrade.
- **Chart show/hide choices are remembered** — ticking a chart checkbox in the layer control now persists per user through the same store, and re-listing a chart after panning or zooming honors the saved choice — which also fixes an unchecked chart silently re-enabling itself when it scrolled back into view. Only SignalK-provided charts are tracked (base maps and the Seascape overlay are untouched), and logged-out sessions keep the toggle session-local.
- **Your own boat gets a name label** — a new "Show Own Boat Name Label" setting (default on, independent of the other-vessel "Show Boat Name Labels" switch) draws your boat's name like the AIS fleet's. The own label always wins the label collision pass against AIS labels, all name labels now render uppercase for consistency, and the label halo is stronger for readability over busy charts.
- **Large controls are now optional** — a new "Use Large UI Controls" setting toggles the 1.5× touch-friendly map-control sizing (default on, so nothing changes out of the box; off restores stock Leaflet sizing), applied live from the settings dialog. The home/gear/zoom glyphs also no longer draw over-thick strokes in large mode.
- **Feedback while force-reloading** — when the page returns from a long background suspension or the back/forward cache and has to refresh, a full-page spinner overlay is shown instead of a frozen frame of stale data (built entirely inline and Chromium 69-safe for Navico MFDs).
- **Fixes**
  - Rotating an iPhone/iPad no longer letterboxes the page with white bars and offset touch targets — the web view now owns the entire window (`viewport-fit=cover` plus a translucent status bar), the map container is pinned to the viewport, and the attribution strip and map re-measure once the rotated layout actually settles so the bottom controls and the home button's recentering stay correct.
  - Long-pressing a boat or toolbar icon on iOS no longer opens the save-image sheet and strands the touch gesture, with an equivalent context-menu guard for Android and MFD browsers that leaves real links alone.

# v1.4.0

A round of startup work aimed at lightweight hardware — a Raspberry Pi running the single-threaded Signal K server — where the webapp's request fan-out at load contended with itself and bogged everything down (ported from hoekens-anchor-alarm v2.10.2):

- **The UI ships as a single inlined file** — the app's JS and CSS plus the vendored Leaflet scripts and stylesheet are now minified and inlined into one `index.html` at build time, collapsing the asset fan-out into a single request. The app source map stays external so live debugging still works, but it's only fetched when devtools is open.
- **Live data no longer waits on the REST startup chain** — the websocket now opens in parallel with the ui-config → self → vessels sequence instead of after it, so position, heading, and COG/SOG deltas start flowing immediately (previously they stalled for seconds on a crowded anchorage, or indefinitely if the `/vessels` fetch timed out and the load looped). Since the snapshot can now arrive after deltas are flowing, it merges per path and a stale snapshot value can never overwrite fresher stream data.
- **Heavy reads only happen when their feature is on** — the chart catalog fetch, the bulk fleet-tracks fetch, the History API own-track rebuild, and the ~1 MB MapLibre stack for the Seascape overlay are each skipped unless the corresponding setting is enabled, and load lazily on first enable from the settings dialog. Own-track rehydration is now tracks-plugin-first, querying the History API only as a fallback when the tracks plugin can't supply your track (not installed, errored, or no own track in its buffer). Side effect: the "Use Seascape Bathymetry" checkbox is now always visible since it gates the download, though enabling it remains a no-op on unsupported engines.
- **The heavy reads that do run take turns** — the chart catalog, routes, fleet tracks, and position history fetches now go through a queue one at a time instead of hammering the server simultaneously; each request's timeout only starts once it actually runs, so queue time never counts against its deadline.
- **Common icons are preloaded** — the ship and layer-control icons the map needs first are requested ahead of the rest of the page.

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
