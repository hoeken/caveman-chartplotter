# Initial Release - 1.0

This repository is a hard fork of my existing plugin hoekens-anchor-alarm.  We will be reworking this plugin into a new one called caveman-chartplotter.  The new plugin will be focused primarily on being a simple, lightweight chart plotter that can run on Navico MFDs that run an older version of Chromium (69).

Things that we will be removing:

- all anchor related functionality from both the front end and the backend. including, but not limited to:
  - watch zones
  - glitch filter
  - scopes
  - api calls for anchoring
  - our watchdog timer
  - engine state checks
  - anchor control overlays
  - scope panel
  - wind panel + wind barbs
  - tide panel
  - info panel

- UI config options that will be removed:
  - Show Tide Panel
  - Show Wind Panel
  - Show Scope Panel
  - Scope Ratios
  - Default Watch Zone Shape
  - Glitch Filter Max Speed (kn)

- things we will be keeping:
  - config button + modal (although certain redundant options will be removed)
  - layer selector, including custom charts and seascape bathymetry
  - theme selector
  - home button
  - zoom controls
  - status bar and ability to set/clear errors
  - login/logout system
  - fleet layer and historical tracks
  - signalk helper and stream classes
  - custom boat icon.