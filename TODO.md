# Initial Release - 1.0

This repository is a hard fork of my existing plugin hoekens-anchor-alarm.  We will be reworking this plugin into a new one called caveman-chartplotter.  The new plugin will be focused primarily on being a simple, lightweight chart plotter that can run on Navico MFDs that run an older version of Chromium (69).

## Done

- [x] all anchor related functionality removed from both the front end and the backend:
  - [x] watch zones (shared/watch-zones/, ui zone controls + overlays)
  - [x] glitch filter (backend, AppState, FleetLayer, config option)
  - [x] scopes (shared/scopes.js, scope panel, scope config)
  - [x] api calls for anchoring (dropAnchor / setZone / raiseAnchor routes + SignalKHelper methods)
  - [x] watchdog timer
  - [x] engine state checks (src/utils.js)
  - [x] anchor control overlays (AnchorOverlay, AnchorController, toolbar drop/raise/shape controls)
  - [x] scope panel, wind panel + wind barbs, tide panel, info panel
- [x] UI config options removed: Show Tide/Wind/Scope Panel, Scope Ratios, Default Watch Zone Shape, Glitch Filter Max Speed
- [x] kept: config button + modal, layer selector (custom charts + seascape), theme selector, home button (recenters on boat), zoom controls, status bar with set/clear errors, login/logout, fleet layer + historical tracks, SignalKHelper/SignalKStream, custom boat icon
- [x] renamed plugin identity: package `caveman-chartplotter` v1.0.0, plugin id/name, webapp title/manifest, `AnchorAlarm.js` → `ChartPlotter.js`
- [x] fresh CHANGELOG, rewritten README, updated RELEASE/DEVELOPMENT docs
- [x] tests updated (66 passing), lint clean, vite build clean

## Remaining before release

- [ ] new logo artwork — `branding/logo.png` and the generated favicons/app icons still show the anchor-alarm anchor; replace the master and run `npm run generate:icons`
- [ ] new appstore screenshots (`signalk.screenshots` in package.json is currently empty)
- [ ] test on a real Navico MFD (Chromium 69) before tagging v1.0.0
- [ ] create the GitHub repo / set up npm trusted publishing (see RELEASE.md)
