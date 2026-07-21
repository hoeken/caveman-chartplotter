// ChartPlotter is the composition root: it owns the map, boat geometry, and the
// live-update lifecycle, and delegates rendering to FleetLayer (vessels +
// tracks) and the HUD controls (status bar, settings, theme, home button).

import { SignalKStream } from "./SignalKStream.js";
import { SignalKHelper } from "./SignalKHelper.js";
import { AppState } from "./AppState.js";
import { FleetLayer } from "./hud/FleetLayer.js";
import { StatusBar } from "./hud/StatusBar.js";
import { HomeButtonControl } from "./hud/HomeButtonControl.js";
import { StaleReloader } from "./StaleReloader.js";
import { loadSeascapeLayer } from "./SeascapeLoader.js";
import { loadChartLayers, CHART_PANE, CHART_PANE_Z_INDEX } from "./ChartLayers.js";
import { RoutesLayer } from "./RoutesLayer.js";
import { ControlToolbar } from "./hud/ControlToolbar.js";
import { LayersControl } from "./hud/LayersControl.js";
import { ConfigPanel } from "./hud/ConfigPanel.js";
import { ThemeControl } from "./hud/ThemeControl.js";
import { Modal } from "./hud/Modal.js";
import {
  lookAheadOffsetPixels,
  smoothBearingRad,
  bearingSmoothingAlpha,
} from "./LookAhead.js";
import { nativeTooltipsSuppressed, isNavicoMfd } from "./BrowserSupport.js";
import { courseVectorLatLngs } from "./CourseVector.js";

const UPDATE_INTERVAL_MS = 500;
// EMA weight for smoothing the look-ahead bearing, derived from the update
// cadence so the smoothing time constant holds regardless of UPDATE_INTERVAL_MS.
const BEARING_ALPHA = bearingSmoothingAlpha(UPDATE_INTERVAL_MS);
// Duration of the animated per-tick follow pan, in seconds. Set a touch longer
// than the update interval so each tick's pan is interrupted mid-flight by the
// next one — with linear easing that reads as a continuous glide rather than a
// 2 Hz hop, and it never decelerates to a stop between ticks.
const FOLLOW_PAN_DURATION_S = (UPDATE_INTERVAL_MS / 1000) * 1.25;
const INITIAL_LOAD_RETRY_MS = 5000;
// Framing zoom is derived per-frame to fit our course vector (see frameZoom),
// but never closer than this — so a boat at rest, with no vector to fit, frames
// a harbor/anchorage rather than zooming to the map's max. The user calls this
// the "minimum zoom"; in Leaflet's scale it's the maximum zoom level we'll pick.
const MAX_FRAME_ZOOM = 18;
// Breathing room (px) reserved around the course vector when fitting the frame,
// so the tip isn't jammed against the viewport edge.
const FRAME_MARGIN_PX = 40;

// Read a boolean-valued query parameter. Returns `fallback` when the param is
// absent; otherwise a case-insensitive "true" is true and anything else
// (including "false") is false. Drives the `embedded` param documented in the
// README.
function boolParam(params, name, fallback) {
  const raw = params.get(name);
  if (raw === null)
    return fallback;
  return raw.toLowerCase() === "true";
}

// Stacking order for the Seascape bathymetry overlay, whose GL canvas shares the
// Leaflet tile pane with the base tiles. It sits above the base tiles but stays
// below the local raster charts, which draw in their own higher pane (see
// CHART_PANE in ChartLayers) so a more detailed local chart always stays legible
// on top of the broad depth shading.
const SEASCAPE_OVERLAY_Z_INDEX = 250;

// Build a stand-in wheel event whose scroll direction is flipped, forwarding the
// fields Leaflet's ScrollWheelZoom handler reads: the delta axes (negated) plus
// the cursor position and the two methods its internal stop() calls. Legacy
// delta fields are negated too so the flip holds on the older wheel-event shapes
// getWheelDelta falls back to. Used to reverse zoom direction on Navico MFDs;
// see ChartPlotter.reverseScrollWheelZoom.
function negateWheelDelta(e) {
  return {
    deltaX: -e.deltaX,
    deltaY: -e.deltaY,
    deltaZ: e.deltaZ,
    deltaMode: e.deltaMode,
    wheelDelta: e.wheelDelta == null ? e.wheelDelta : -e.wheelDelta,
    wheelDeltaY: e.wheelDeltaY == null ? e.wheelDeltaY : -e.wheelDeltaY,
    detail: e.detail == null ? e.detail : -e.detail,
    clientX: e.clientX,
    clientY: e.clientY,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  };
}

class ChartPlotter {
  constructor() {
    this.signalK = new SignalKHelper({ pluginName: "caveman-chartplotter" });
    // A 401 on any auth-gated request (e.g. an expired session) pops the login
    // modal instead of bouncing to the SignalK admin login page.
    this.signalK.onUnauthorized = () => this.showLoginModal();
    this.state = new AppState();
    this.config = {
      fleetFilterRadius: 500,
      defaultBasemap: "Satellite",
      enableBoatLabels: true,
      enableOwnTrack: true,
      enableOtherTracks: true,
      enableRoutes: true,
      enableChartLayers: true,
      enableSeascape: false,
      courseVectorMinutes: 15,
      enableLookAhead: true,
      hasCustomIcon: false,
    };
    this.state.loggedIn = false;

    // URL control for embedding the app in another dashboard (see README).
    // `embedded=true` strips the settings gear and the login toolbar for a
    // clean, read-only map.
    const params = new URLSearchParams(window.location.search);
    this.embedded = boolParam(params, "embedded", false);

    // Follow vs. free-drag mode. In follow mode the viewport tracks the boat as
    // new positions arrive and the home button is highlighted; any user drag
    // drops back to free drag. Toggled via enterFollowMode/exitFollowMode; the
    // per-tick recenter runs from updateMap. Starts on so the boat is framed and
    // tracked on load.
    this.following = false;

    this.map = undefined;
    this.fleetLayer = undefined;
    this.homeButton = undefined;
    this.configPanel = undefined;
    this.themeControl = undefined;
    this.toolbar = undefined;
    // Startup snapshot of the local raster charts (see addChartLayers). Every
    // later add/remove works off this copy so we never re-fetch the catalog.
    this.chartLayers = [];
    this.updateTimer = null;
    this._loginModal = null;
    // Own-boat stream context, learned from the hello frame. Used to route each
    // delta to either own-boat state or the fleet layer once we subscribe to
    // both vessels.self and vessels.*.
    this.selfContext = null;
    // Bumped on every websocket (re)connect so a fleet seed still in flight
    // when its socket died can't subscribe on the next connection's behalf.
    this._connectSeq = 0;
    // Resolved once the initial-load /vessels snapshot has seeded the fleet
    // cache. The websocket opens in parallel with that fetch, so the first
    // connection gates its vessels.* subscription on this instead of the
    // socket-after-seed ordering the old serial startup guaranteed.
    this._initialSeed = new Promise((resolve) => {
      this._resolveInitialSeed = resolve;
    });
    // Smoothed course used for the look-ahead bias (radians true), advanced once
    // per update tick from the raw COG/heading. Null until the first reading; a
    // low-pass filter (see advanceLookAheadBearing) keeps the map from lurching
    // as the boat yaws in a seaway.
    this.smoothedCogRad = null;
  }

  static startup() {
    const app = new ChartPlotter();
    app.init();
  }

  setupWebsockets() {
    this.client = new SignalKStream({
      hostname: window.location.hostname,
      port:
        Number(window.location.port) ||
        (window.location.protocol === "https:" ? 443 : 80),
      useTLS: window.location.protocol === "https:",
      reconnect: true,
    });
    this.client.on("hello", (hello) => {
      this.selfContext = this.normalizeContext(hello.self);
    });
    this.client.on("delta", (delta) => this.handleDeltas(delta));
    this.client.on("connect", () => {
      this.state.websocketSubscribe(this.client);
      // The server drops every subscription when the socket closes, so replay
      // the per-vessel context subscriptions to keep static identity streaming
      // after a reconnect. Before the seed below so the fresh subscriptions it
      // sends for newly-seeded vessels aren't immediately re-sent.
      this.fleetLayer?.resubscribeVessels();
      // Gate the vessels.* subscription on a fresh fleet seed: deltas from
      // vessels the cache doesn't hold each fire a per-vessel static fetch,
      // so an unseeded cache means one redundant request per boat in sight.
      // The first connection (and any reconnect while the initial load is
      // still in flight — fleetLayer doesn't exist until it finishes) waits
      // for the initial-load snapshot to seed the cache; later reconnects
      // re-fetch /vessels because the prune timer keeps evicting while the
      // socket is down. The seed settles even on failure, so a bad snapshot
      // delays fleet updates, never blocks them; the seq guard keeps a seed
      // whose socket died mid-fetch from subscribing early on the next
      // connection's fresh seed.
      const seq = ++this._connectSeq;
      const seeded =
        seq === 1 || !this.fleetLayer
          ? this._initialSeed
          : this.fleetLayer.seedFleet();
      seeded.then(() => {
        if (seq === this._connectSeq)
          this.state.websocketSubscribeFleet(this.client);
      });
    });
    this.client.connect();
  }

  // Normalize a stream identity to the "vessels.<id>" form deltas use as their
  // context, so hello.self and delta.context compare directly.
  normalizeContext(id) {
    if (!id)
      return null;
    return id.startsWith("vessels.") ? id : `vessels.${id}`;
  }

  // Route each delta by its context: own-boat updates feed AppState; every other
  // vessel's dynamic paths feed the fleet layer's cache. A delta with no context
  // predates the hello (own-boat only at that point), so it's treated as self.
  handleDeltas(delta) {
    if (!delta.updates)
      return;
    const isSelf = !delta.context || delta.context === this.selfContext;
    for (const update of delta.updates) {
      if (!update.values)
        continue;
      const timestamp = update.timestamp;
      if (isSelf) {
        for (const value of update.values)
          this.state.handleDelta(timestamp, value);
      } else if (this.fleetLayer) {
        this.fleetLayer.ingestVesselDelta(delta.context, timestamp, update.values);
      }
    }
  }

  init() {
    new StaleReloader({ staleThresholdMs: 5 * 60 * 1000 }).start();

    this.satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        maxZoom: 23,
        maxNativeZoom: 17, // Highest zoom level Esri has real imagery for
        tileSize: 256,
        keepBuffer: 5,
      },
    );

    this.osmLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: "Map data from OpenStreetMap (OSM)",
        maxZoom: 23,
      },
    );

    // An empty base layer for boats offline or on slow links, and for crews who
    // rely solely on their own local charts (see ChartLayers): selecting it
    // fetches no tiles at all, leaving just the themed .leaflet-container
    // background (light grey / dark #1a1d21 — see style.css) with whatever chart
    // overlays are enabled drawn on top. It carries no attribution.
    this.blankLayer = L.layerGroup();

    this.baseMaps = {
      Blank: this.blankLayer,
      OpenStreetMap: this.osmLayer,
      Satellite: this.satelliteLayer,
    };

    // Map shell and status bar first so failures during initial load (missing
    // GPS, server unreachable, etc.) have somewhere to surface.
    this.map = L.map("map", {
      zoomControl: false,
      attributionControl: false, // Prevents the default bottom-right control
      worldCopyJump: true, // Wrap markers/view to nearest world copy past 180°
    }).setView([0, 0], 5);
    // Dedicated pane so local raster charts always draw above the base maps and
    // the Seascape overlay (both in the tile pane) while staying below the
    // vessel markers. See CHART_PANE in ChartLayers.
    this.map.createPane(CHART_PANE).style.zIndex = CHART_PANE_Z_INDEX;
    // The Navico MFDs' rotary/scroll input reports wheel deltas backwards, so
    // scroll-to-zoom runs inverted on those consoles. Flip it back there only.
    if (isNavicoMfd())
      this.reverseScrollWheelZoom();
    this.statusBar = new StatusBar();
    this.map.addControl(this.statusBar);

    this.toolbar = new ControlToolbar({
      parent: document.getElementById("map_container"),
      onLogin: () => this.showLoginModal(),
    });
    // In embedded mode the login prompt is suppressed for a clean, read-only
    // map — the host dashboard owns authentication.
    if (this.embedded)
      this.toolbar.hide();

    // Open the websocket now, in parallel with the REST startup chain, so
    // live self data (position, heading, COG/SOG) isn't gated behind the bulk
    // /vessels fetch. The connect handler subscribes vessels.self right away;
    // deltas accumulate in AppState until the initial load builds the map and
    // starts the render timer. The vessels.* fleet subscription still waits
    // for the /vessels seed (see setupWebsockets).
    this.setupWebsockets();

    this.loadInitialData();
  }

  // Reverse the map's scroll-wheel zoom direction, called on Navico MFDs where
  // the console's input reports wheel deltas with the opposite sign (see
  // isNavicoMfd). We wrap Leaflet's ScrollWheelZoom handler so it sees a
  // delta-negated stand-in event (negateWheelDelta), which keeps all of
  // Leaflet's own accumulation/rate-limiting intact and leaves control-panel
  // scrolling untouched. Leaflet registers its wheel listener against the
  // handler method captured by reference when its hooks are added (during map
  // construction), so a plain reassignment afterwards wouldn't take effect — we
  // disable()/enable() to re-register the listener against the wrapper. This
  // reaches into a Leaflet-internal method (_onWheelScroll); guard so a Leaflet
  // upgrade that renames it degrades to a no-op rather than throwing.
  reverseScrollWheelZoom() {
    const handler = this.map.scrollWheelZoom;
    if (
      !handler ||
      typeof handler._onWheelScroll !== "function" ||
      !handler.enabled()
    )
      return;
    const original = handler._onWheelScroll;
    handler.disable();
    handler._onWheelScroll = function (e) {
      original.call(this, negateWheelDelta(e));
    };
    handler.enable();
  }

  // Enter follow mode: frame the boat at a zoom that fits our course vector (see
  // frameZoom) and keep the viewport locked to it as new positions arrive (see
  // followTick). Used by the home button and on initial load. Clicking home while
  // already following just re-frames. The home button is highlighted (green) to
  // show follow is active.
  enterFollowMode() {
    this.following = true;
    this.homeButton?.setActive(true);
    this.recenterOnBoat(this.frameZoom(), true);
  }

  // Leave follow mode for free drag: the map stays wherever the user puts it.
  // Triggered by a user pan (dragstart) and clears the home-button highlight.
  exitFollowMode() {
    if (!this.following)
      return;
    this.following = false;
    this.homeButton?.setActive(false);
  }

  // Per-tick recenter while following, at the current zoom so a user's manual
  // zoom is preserved (zooming doesn't change modes). Called from updateMap with
  // smooth=true (an eased pan that glides the view along as the boat moves) and
  // from the zoomend handler with smooth=false (snap the boat back to center
  // right away, without a competing pan animation on top of the zoom).
  followTick(smooth = false) {
    if (!this.following || !this.map)
      return;
    const zoom = this.map.getZoom();
    const target = this.followCenter(zoom);
    // Skip when we're basically already centered, so a moored boat doesn't fire
    // a redundant moveend — or kick off a no-op pan animation — every tick.
    const current = this.map.project(this.map.getCenter(), zoom);
    if (current.distanceTo(this.map.project(target, zoom)) < 0.5)
      return;
    if (smooth)
      this.map.panTo(target, {
        animate: true,
        duration: FOLLOW_PAN_DURATION_S,
        easeLinearity: 1,
      });
    else
      this.map.setView(target, zoom, { animate: false });
  }

  // One-shot reframe on the follow target (the boat, or a point biased ahead of
  // it — see followCenter) at the given zoom: the home button and initial load.
  // Animated since it may also change zoom. The steady per-tick tracking pan
  // lives in followTick.
  recenterOnBoat(zoom, animate) {
    this.map.setView(this.followCenter(zoom), zoom, { animate });
  }

  // Zoom to frame the follow view: the highest zoom at which our whole course
  // vector — from the boat to its predicted position courseVectorMinutes ahead —
  // still fits the viewport, so the more speed we carry the wider we frame.
  // Capped at MAX_FRAME_ZOOM; a boat at rest (no vector) frames straight at the
  // cap rather than zooming to the map's max. Called only when framing (home
  // button + initial load), not per tick, so a manual zoom survives while
  // following.
  frameZoom() {
    const boat = this.state.getPosition();
    const vector = courseVectorLatLngs({
      start: boat,
      cogRad: this.state.cog?.value,
      sogMps: this.state.sog?.value,
      minutes: this.config.courseVectorMinutes,
    });
    if (!vector)
      return MAX_FRAME_ZOOM;

    // getBoundsZoom returns the max zoom at which the bounds fit the current view
    // (clamped to the map's own min/max). With look-ahead on, the center is
    // biased ahead of the boat by up to MAX_OFFSET_FRACTION of the viewport, which
    // slides the trailing end (the boat) toward the back edge — so reserve twice
    // that offset as padding to keep the boat in frame, plus a fixed margin.
    const size = this.map.getSize();
    let biasPad = 0;
    if (this.config.enableLookAhead) {
      const offset = lookAheadOffsetPixels({
        cogRad: this.state.cog?.value,
        sogMps: this.state.sog?.value,
        viewportMin: Math.min(size.x, size.y),
      });
      biasPad = 2 * Math.hypot(offset.x, offset.y);
    }
    const pad = biasPad + FRAME_MARGIN_PX;
    const fit = this.map.getBoundsZoom(L.latLngBounds(vector), false, L.point(pad, pad));
    return Math.min(MAX_FRAME_ZOOM, fit);
  }

  // The map center to follow. Normally the boat itself; with the "look ahead"
  // option on, the center is nudged along our course (scaled by speed) so more
  // of the water ahead is visible while the boat stays comfortably on screen.
  // The pixel offset is pure/testable (see LookAhead.js); here we project the
  // boat to pixels at the target zoom, shift, and unproject back to a lat/lng.
  // Fold the latest course over ground (falling back to heading) into the
  // smoothed bearing that drives the look-ahead. Called once per update tick so
  // the EMA weight (BEARING_ALPHA) matches the tick interval. The first reading
  // seeds the filter directly so the map doesn't ramp up from due north.
  advanceLookAheadBearing() {
    const raw = this.state.cog?.value ?? this.state.heading?.value ?? null;
    this.smoothedCogRad = smoothBearingRad(this.smoothedCogRad, raw, BEARING_ALPHA);
  }

  followCenter(zoom) {
    const boat = this.state.getPosition();
    if (!this.config.enableLookAhead)
      return boat;

    const size = this.map.getSize();
    const offset = lookAheadOffsetPixels({
      // Bias along the smoothed course (see advanceLookAheadBearing), in radians
      // true (Signal K base units), so wave-induced yaw doesn't jitter the view.
      cogRad: this.smoothedCogRad,
      sogMps: this.state.sog?.value ?? null,
      viewportMin: Math.min(size.x, size.y),
    });
    if (offset.x === 0 && offset.y === 0)
      return boat;

    const boatPoint = this.map.project(boat, zoom);
    return this.map.unproject(boatPoint.add(L.point(offset.x, offset.y)), zoom);
  }

  // === Initial load (one /vessels call, broken into phases) ========================

  loadInitialData() {
    // Config first: it carries selfId, which tells us which entry in the bulk
    // /vessels payload is our own. /vessels is a superset of /vessels/self, so
    // that one fetch covers both our own tree and the fleet's — fetching
    // /vessels/self separately would transfer the (potentially large) own tree
    // twice. Anonymous sessions can't read ui-config (loadConfig fell back to
    // the defaults, which carry no selfId), so they learn the identity from
    // the tiny public /self endpoint instead.
    this.loadConfig()
      .then(async () => {
        console.log("UI Config:", this.config);

        // The plugin version rides on ui-config too (for the settings
        // footer), saving a separate /plugins/<id> request.
        this.version = this.config.version;
        if (this.version)
          console.log(`Caveman Chartplotter v${this.version}`);

        const selfId = this.config.selfId ?? (await this.signalK.fetchSelfId());
        const vessels = await this.signalK.fetchAllVessels();
        this.statusBar.clear("initial-load");

        const selfKey = String(selfId ?? "").replace(/^vessels\./, "");
        this.selfContext = this.normalizeContext(selfKey);
        this.state.extractAll(vessels[selfKey] ?? {});
        this.state.calculate();
        console.log("App State:", this.state);

        if (!this.state.currentCoordinates) {
          this.statusBar.update(this.state);
          setTimeout(() => this.loadInitialData(), INITIAL_LOAD_RETRY_MS);
          return;
        }

        // Everything below runs only once /vessels has resolved: buildMap
        // constructs the FleetLayer (whose constructor starts the heavy
        // /tracks fetch) — deliberately kept off the critical path of the
        // bulk load. The websocket has been open since init(); seeding the
        // fleet cache from the snapshot we already hold and resolving
        // _initialSeed releases its vessels.* subscription (see
        // setupWebsockets). Vessel subscriptions the seed sends before the
        // socket finishes opening are replayed by the connect handler's
        // resubscribeVessels.
        this.buildMap();
        this.fleetLayer.seedFleet(vessels);
        this._resolveInitialSeed();
        this.startUpdateTimer();

        this.advanceLookAheadBearing();
        this.updateMap();
        this.enterFollowMode();
      })
      .catch((error) => {
        const detail = error.statusText || error.message || "unknown error";
        const status = error.status ? `${error.status} ` : "";
        const msg = `Failed to load initial data: ${status}${detail}`;

        this.statusBar.set("initial-load", msg, "error");
        console.error(msg, error);
        setTimeout(() => this.loadInitialData(), INITIAL_LOAD_RETRY_MS);
      });
  }

  // Config fetch is independent: a 401 (user not logged in) must not block
  // startup, so on failure we keep the defaults and start pollers anyway.
  async loadConfig() {
    try {
      this.config = await this.signalK.fetchConfig();
      this.state.loggedIn = true;
    } catch (error) {
      console.error("Failed to load config, using defaults", error);
      this.state.loggedIn = false;
    }
  }

  // Log in to SignalK from within the app (replacing the old redirect to the
  // admin login SPA, which never returned on the Navico MFD). On success the
  // auth cookie is set and we reload, so startup re-fetches config as the
  // logged-in user and builds the full control set. Used by both the toolbar
  // Login button and the 401 handler, so guard against opening twice.
  showLoginModal() {
    if (this._loginModal && this._loginModal.isOpen())
      return;

    const modal = new Modal({ title: "Login" });
    this._loginModal = modal;

    const form = document.createElement("div");
    form.className = "modalForm";

    const userLabel = document.createElement("label");
    userLabel.className = "modalMessage";
    userLabel.textContent = "Username";
    const username = document.createElement("input");
    username.type = "text";
    username.className = "modalInput";
    username.setAttribute("autocomplete", "username");

    const passLabel = document.createElement("label");
    passLabel.className = "modalMessage";
    passLabel.textContent = "Password";
    const password = document.createElement("input");
    password.type = "password";
    password.className = "modalInput";
    password.setAttribute("autocomplete", "current-password");

    const rememberRow = document.createElement("label");
    rememberRow.className = "modalCheckbox";
    const rememberMe = document.createElement("input");
    rememberMe.type = "checkbox";
    rememberMe.checked = true;
    const rememberText = document.createElement("span");
    rememberText.textContent = "Remember me?";
    rememberRow.appendChild(rememberMe);
    rememberRow.appendChild(rememberText);

    form.appendChild(userLabel);
    form.appendChild(username);
    form.appendChild(passLabel);
    form.appendChild(password);
    form.appendChild(rememberRow);
    modal.setContent(form);

    modal.setButtons([
      { label: "Cancel", variant: "secondary", value: null },
      {
        label: "Login",
        variant: "primary",
        primary: true,
        onClick: async (m) => {
          const user = username.value.trim();
          const pass = password.value;
          if (!user || !pass) {
            m.setError("Enter your username and password.");
            return;
          }
          m.setError("");
          m.setBusy(true);
          try {
            await this.signalK.login(user, pass, rememberMe.checked);
            window.location.reload();
          } catch (err) {
            m.setBusy(false);
            m.setError(
              err && err.status === 401
                ? "Invalid username or password."
                : "Login failed. Please try again.",
            );
            password.select();
          }
        },
      },
    ]);
    modal.setFocusTarget(username);
    modal.open();
  }

  // Log out of SignalK, then reload so startup re-fetches config as an
  // anonymous user and rebuilds the control set without the logged-in-only
  // controls. Reachable from the Settings footer's "Log out" link. Returns the
  // request promise so the ConfigPanel can surface a failure inline (on success
  // the reload replaces the page before anything else runs).
  logout() {
    return this.signalK.logout().then(() => window.location.reload());
  }

  // Persist UI settings edited via the ConfigPanel. We merge into the live
  // config and re-render immediately so every setting takes effect without a
  // reload: the basemap re-renders here, while the fleet radius and track
  // toggles are pushed into the objects that captured them at construction.
  // Returns the save promise so the dialog can report status.
  saveConfig(newConfig) {
    Object.assign(this.config, newConfig);
    this.setBasemap(this.config.defaultBasemap);
    this.setSeascapeEnabled(this.config.enableSeascape);
    this.fleetLayer?.setFilterRadius(this.config.fleetFilterRadius);
    this.fleetLayer?.setShowLabels(this.config.enableBoatLabels);
    this.fleetLayer?.setShowOwnTrack(this.config.enableOwnTrack);
    this.fleetLayer?.setShowOtherTracks(this.config.enableOtherTracks);
    this.fleetLayer?.setCourseVectorMinutes(this.config.courseVectorMinutes);
    this.routesLayer?.setShowRoutes(this.config.enableRoutes);
    this.updateMap();
    this.statusBar.clear("config-save");
    return this.signalK.saveConfig(newConfig).catch((error) => {
      const detail = error.statusText || error.message || "unknown error";
      const status = error.status ? `${error.status} ` : "";
      const msg = `Failed to save config: ${status}${detail}`;
      this.statusBar.set("config-save", msg, "error");
      console.error(msg, error);
      throw error;
    });
  }

  // Upload a custom own-boat icon, then live-update the marker (cache-busted so
  // the overwritten-in-place file refetches). Returns the request promise so the
  // settings dialog can report status; on failure the marker is left unchanged.
  uploadBoatIcon(file) {
    return this.signalK.uploadBoatIcon(file).then((result) => {
      this.config.hasCustomIcon = true;
      this.fleetLayer?.setOwnBoatIcon(this.signalK.boatIconUrl(Date.now()));
      return result;
    });
  }

  // Remove the custom icon and revert the marker to the AIS ship-type icon.
  deleteBoatIcon() {
    return this.signalK.deleteBoatIcon().then((result) => {
      this.config.hasCustomIcon = false;
      this.fleetLayer?.setOwnBoatIcon(null);
      return result;
    });
  }

  // Recompute/re-render on a fixed cadence. Started only after buildMap so
  // update() never runs against a half-built control set; the websocket is
  // opened separately, back in init() (see setupWebsockets).
  startUpdateTimer() {
    this.updateTimer = setInterval(
      () => this.update(),
      UPDATE_INTERVAL_MS,
    );
  }

  // Decorates the map shell built in init() with the rest of the controls.
  // Splitting it this way lets the status bar exist before any data fetch.
  buildMap() {
    this.map.setView(this.state.getPosition(), 5);

    //actual map layer
    this.setBasemap(this.config.defaultBasemap);

    //
    // Buttons - Top Left
    //

    // The settings gear is always available: logged-in users open the config
    // dialog, while anonymous users' clicks go straight to the login modal
    // (the save POST is auth-gated server-side, so the dialog is useless to
    // them — see ConfigPanel). Login and logout both reload, so getLoggedIn is
    // effectively fixed per page load. In embedded mode the gear is omitted
    // entirely so the host dashboard owns the configuration.
    if (!this.embedded) {
      this.configPanel = new ConfigPanel({
        getConfig: () => this.config,
        getVersion: () => this.version,
        getLoggedIn: () => this.state.loggedIn,
        onChange: (newConfig) => this.saveConfig(newConfig),
        onLogin: () => this.showLoginModal(),
        onLogout: () => this.logout(),
        getIconUrl: (bust) => this.signalK.boatIconUrl(bust),
        onUploadIcon: (file) => this.uploadBoatIcon(file),
        onDeleteIcon: () => this.deleteBoatIcon(),
      });
      this.map.addControl(this.configPanel);
    }

    // LayersControl (not the stock L.control.layers) so the route overlays
    // stay grouped below a divider, separate from the local charts.
    this.layersControl = new LayersControl(
      this.baseMaps,
      {},
      { position: "topleft" },
    ).addTo(this.map);
    this.addSeascapeLayer();
    this.addChartLayers();

    // Light/dark toggle. Unlike the settings gear it isn't login-gated — the
    // theme is a session-only preference anyone can flip (see hud/ThemeControl).
    this.themeControl = new ThemeControl();
    this.map.addControl(this.themeControl);

    //
    // Buttons - Top Right
    //
    this.homeButton = new HomeButtonControl({
      onHome: () => {
        this.map?.closePopup();
        this.enterFollowMode();
      },
    });
    this.map.addControl(this.homeButton);

    L.control.zoom({ position: "topright" }).addTo(this.map);

    // Map attribution lives in a full-width strip at the bottom of the page
    // (#mapAttribution) instead of Leaflet's default corner control, which is
    // disabled. Refresh it whenever the active base layer changes.
    this.updateAttribution();
    this.map.on("baselayerchange", () => this.updateAttribution());
    // Toggling a chart overlay fires overlayadd/overlayremove (not
    // baselayerchange), so refresh here too or a chart's credit wouldn't appear.
    this.map.on("overlayadd", () => this.updateAttribution());
    this.map.on("overlayremove", () => this.updateAttribution());
    // Panning or zooming re-derives which local charts belong in the layer
    // control for the new view (moveend also fires after a zoom completes).
    this.map.on("moveend", () => this.updateChartLayers());
    // A user drag is the "free drag" gesture: it drops us out of follow mode so
    // the map stays put. dragstart fires only on real user pans, never on our
    // own setView recenters or on zooming — so zooming keeps follow mode on.
    this.map.on("dragstart", () => this.exitFollowMode());
    // Zooming doesn't change modes, but a cursor-anchored zoom moves the boat
    // off-center; snap it back right away when following instead of waiting for
    // the next update tick.
    this.map.on("zoomend", () => this.followTick());
    window.addEventListener("resize", () => this.updateAttribution());

    // Read-only display of the routes served by a resources provider plugin
    // (see RoutesLayer). It owns its own fetch/poll cycle and moveend-driven
    // viewport filtering, listing each in-view route in the layer control as
    // a toggleable overlay. The update tick only feeds it the active route
    // from the delta stream (see updateMap).
    this.routesLayer = new RoutesLayer({
      map: this.map,
      signalK: this.signalK,
      layersControl: this.layersControl,
      show: this.config.enableRoutes,
    });

    this.fleetLayer = new FleetLayer({
      app: this,
      map: this.map,
      ownMmsi: this.state.boatConfig.mmsi,
      filterRadius: this.config.fleetFilterRadius,
      showLabels: this.config.enableBoatLabels,
      showOwnTrack: this.config.enableOwnTrack,
      showOtherTracks: this.config.enableOtherTracks,
      courseVectorMinutes: this.config.courseVectorMinutes,
    });
  }

  // Seascape is a WebGL bathymetry chart (see SeascapeLoader) that shades the
  // water by depth and is transparent over land, so it belongs on top of a base
  // map as an overlay rather than replacing one. It loads asynchronously (or
  // never, on the Chromium 69 MFDs) and joins the layer control as a toggleable
  // overlay once ready, switched on at startup when config.enableSeascape. If it
  // can't load — offline or an unsupported engine — the selected base map simply
  // stays visible, so there's no fallback to handle.
  addSeascapeLayer() {
    loadSeascapeLayer().then((layer) => {
      if (!layer || !this.map)
        return;
      this.seascapeLayer = layer;
      // Its GL canvas is created on first add and lives in the tile pane; pin
      // the z-index on every add so switching base maps (which re-inserts base
      // tiles later in the DOM) can't bury it. See SEASCAPE_OVERLAY_Z_INDEX.
      layer.on("add", () => {
        const container = layer.getContainer && layer.getContainer();
        if (container)
          container.style.zIndex = SEASCAPE_OVERLAY_Z_INDEX;
      });
      this.layersControl?.addOverlay(layer, "Seascape Bathymetry");
      if (this.config.enableSeascape)
        layer.addTo(this.map);
    });
  }

  // Match the Seascape overlay to config.enableSeascape once it has loaded. A
  // no-op before the async load resolves or on engines where it never does —
  // addSeascapeLayer re-reads the flag when the layer finally arrives.
  setSeascapeEnabled(enabled) {
    const layer = this.seascapeLayer;
    if (!layer || !this.map)
      return;
    if (enabled && !this.map.hasLayer(layer))
      layer.addTo(this.map);
    else if (!enabled && this.map.hasLayer(layer))
      this.map.removeLayer(layer);
  }

  // Local raster charts served by SignalK's resources API (see ChartLayers) are
  // fetched once on startup and cached in this.chartLayers, keyed with the
  // coverage bounds and native min-zoom read back off each Leaflet layer. Every
  // later chart operation works off that snapshot instead of re-fetching. A
  // missing charts plugin or a fetch error resolves to an empty list, making
  // this a no-op then. updateChartLayers() populates the layer control for the
  // current view.
  addChartLayers() {
    loadChartLayers(this.signalK).then((charts) => {
      if (!this.map || !this.layersControl)
        return;
      this.chartLayers = charts.map(({ name, layer }) => ({
        name,
        layer,
        bounds: Array.isArray(layer.options.bounds)
          ? L.latLngBounds(layer.options.bounds)
          : null,
        minZoom: layer.options.minZoom,
        listed: false,
      }));
      this.updateChartLayers();
    });
  }

  // Re-derive which cached local charts belong in the layer control for the
  // current view. A chart is listed (and, when the "Use Chart Layers" option is
  // on, enabled by default) only while the map is zoomed in far enough to render
  // its tiles — below a chart's native minzoom Leaflet draws nothing — and its
  // coverage overlaps the visible area. Charts with no bounds/zoom metadata are
  // treated as global and always shown. Panning or zooming a chart out of view
  // removes it from both the map and the control; bringing it back re-adds it.
  updateChartLayers() {
    if (!this.map || !this.layersControl || !this.chartLayers.length)
      return;
    const zoom = this.map.getZoom();
    const view = this.map.getBounds();
    let changed = false;
    for (const chart of this.chartLayers) {
      const show =
        (!Number.isFinite(chart.minZoom) || zoom >= chart.minZoom) &&
        (!chart.bounds || chart.bounds.intersects(view));
      if (show === chart.listed)
        continue;
      if (show) {
        // Add to the map before the control so the control renders the
        // overlay's checkbox already ticked (it reads map.hasLayer at build).
        // With the option off, list it in the control but leave it off the map
        // so its checkbox renders unticked, ready to enable by hand.
        if (this.config.enableChartLayers)
          chart.layer.addTo(this.map);
        this.layersControl.addOverlay(chart.layer, chart.name);
      } else {
        this.map.removeLayer(chart.layer);
        this.layersControl.removeLayer(chart.layer);
      }
      chart.listed = show;
      changed = true;
    }
    // Programmatic add/remove doesn't fire overlayadd/overlayremove, so refresh
    // the attribution strip by hand when a chart's credit came or went.
    if (changed)
      this.updateAttribution();
  }

  // Swap the active base layer to the named basemap (falling back to satellite
  // for an unknown name). No-op if it's already active; otherwise we remove any
  // other base layer first so the two never stack. The layer-control radio
  // tracks add/removeLayer on its own, but baselayerchange only fires on user
  // clicks in that control — so we refresh the attribution strip by hand.
  setBasemap(name) {
    const layer = this.baseMaps[name] || this.satelliteLayer;
    if (this.map.hasLayer(layer))
      return;
    for (const key in this.baseMaps) {
      const other = this.baseMaps[key];
      if (other !== layer && this.map.hasLayer(other))
        this.map.removeLayer(other);
    }
    layer.addTo(this.map);
    this.updateAttribution();
  }

  // Gather attribution strings from the active layers and render them, with
  // the standard Leaflet credit, into the bottom-of-page attribution strip.
  updateAttribution() {
    const el = document.getElementById("mapAttribution");
    if (!el || !this.map)
      return;
    const parts = [];
    this.map.eachLayer((layer) => {
      const attr = layer.getAttribution && layer.getAttribution();
      if (attr && parts.indexOf(attr) === -1)
        parts.push(attr);
    });
    const leafletTitle = nativeTooltipsSuppressed
      ? ""
      : ` title="A JavaScript library for interactive maps"`;
    const prefix = `<a href="https://leafletjs.com"${leafletTitle}>Leaflet</a>`;
    el.innerHTML = [prefix, ...parts].join(" | ");

    // Expose the strip's rendered height so bottom-anchored Leaflet controls
    // (see .leaflet-bottom in style.css) can sit above it. The height varies
    // with text wrapping, so measure after the content is set.
    document.documentElement.style.setProperty(
      "--attributionHeight",
      `${el.offsetHeight}px`,
    );
  }

  updateMap() {
    this.toolbar.update(this.state);
    this.statusBar.update(this.state);
    this.fleetLayer.update(this.state);
    // While a route is actively being navigated, only it is drawn (see
    // RoutesLayer.setActiveRoute — a no-op tick-to-tick until it changes).
    this.routesLayer?.setActiveRoute(this.state.activeRoute?.value ?? null);
    // Keep the viewport locked to the boat while following (no-op otherwise),
    // gliding the view along with an eased pan between ticks.
    this.followTick(true);
  }

  // === Live updates ===============================================================

  // Recompute derived state from the delta-fed AppState and re-render on a fixed
  // cadence, decoupled from the delta arrival rate so a burst of updates doesn't
  // trigger a redraw per message.
  update() {
    try {
      this.state.calculate();
      this.advanceLookAheadBearing();
      this.updateMap();
      this.statusBar.clear("update");
    } catch (error) {
      const detail = error.statusText || error.message || "unknown error";
      const status = error.status ? `${error.status} ` : "";
      const msg = `Update failed: ${status}${detail}`;
      this.statusBar.set("update", msg, "warning");
      console.error(msg, error);
    }
  }

  destroy() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}

ChartPlotter.startup();
