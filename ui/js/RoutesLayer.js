// RoutesLayer draws the routes published through SignalK's v2 resources API
// (a resources provider plugin serving /resources/routes) as read-only map
// overlays: a solid green line along the waypoints, with a dot at the start, a
// triangle at each intermediate waypoint pointing toward the next one, and a
// square at the end — all solid green with a 1px white border.
//
// Routes are fetched on startup and then re-polled on a slow timer so a route
// created or edited in another SignalK app shows up without a reload. Only
// routes that actually touch the current viewport are on the map at any time
// (a waypoint inside the view, or a leg crossing it); the set is re-derived on
// every moveend. Each in-view route is also listed by name in the layer
// control so it can be toggled individually, mirroring how ChartPlotter's
// updateChartLayers manages the local charts. While a route is actively being
// navigated (navigation.course.activeRoute, fed in via setActiveRoute), only
// that route is shown — the others would just clutter the chart mid-passage.
// The geometry helpers are pure and L-free so they can be unit-tested without
// Leaflet.

import { bearing, point } from "@turf/turf";

// Dedicated pane so a route always draws above the local raster charts
// (CHART_PANE, 350) and the default overlay pane (400: tracks, course
// vectors), but below the vessel markers (markerPane, 600) — the boats stay
// the most prominent thing on the chart. Both the line and the waypoint
// shapes share it so a route renders as one coherent unit.
export const ROUTE_PANE = "routePane";
export const ROUTE_PANE_Z_INDEX = 450;

// Per the spec: solid green line, solid green shapes with a 1px white border.
const ROUTE_COLOR = "green";
const ROUTE_LINE_WEIGHT = 2;

// How often to re-poll the routes collection. It's a small JSON document, so a
// slow poll keeps externally-edited routes current at negligible cost.
const ROUTES_REFRESH_MS = 60 * 1000;

// Convert a /resources/routes payload ({ uuid: route, ... }) into render specs:
// [{ id, name, points }] with points as [lat, lng] pairs. Only LineString
// routes with at least two numeric coordinates are kept; anything malformed is
// skipped rather than breaking the rest of the collection. GeoJSON coordinates
// are [lng, lat] and get flipped to Leaflet's [lat, lng] here.
export function parseRoutes(payload) {
  if (!payload || typeof payload !== "object")
    return [];
  const routes = [];
  for (const id in payload) {
    const route = payload[id];
    const geometry = route?.feature?.geometry;
    if (!geometry || geometry.type !== "LineString")
      continue;
    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2)
      continue;
    const points = [];
    for (const coord of coordinates) {
      if (
        !Array.isArray(coord) ||
        !Number.isFinite(coord[0]) ||
        !Number.isFinite(coord[1])
      )
        break;
      points.push([coord[1], coord[0]]);
    }
    if (points.length !== coordinates.length)
      continue;
    routes.push({
      id,
      name: typeof route.name === "string" ? route.name : "",
      points,
    });
  }
  return routes;
}

// The waypoint shapes for one route, in route order: a dot at the start, a
// triangle at each intermediate waypoint, a square at the end (a two-point
// route is just dot + square). Each triangle carries the compass bearing
// (degrees clockwise from north, 0-360) toward the next waypoint; Web Mercator
// is conformal, so the geographic bearing is also the on-screen angle at the
// waypoint, independent of zoom.
export function routeShapes(points) {
  return points.map(([lat, lng], i) => {
    if (i === 0)
      return { type: "dot", lat, lng };
    if (i === points.length - 1)
      return { type: "square", lat, lng };
    const [nextLat, nextLng] = points[i + 1];
    const angle =
      (bearing(point([lng, lat]), point([nextLng, nextLat])) + 360) % 360;
    return { type: "triangle", lat, lng, angle };
  });
}

// Whether any part of a route's path touches the view rect ({ west, south,
// east, north } from map.getBounds(), whose longitudes can run past ±180 when
// the view straddles the antimeridian under worldCopyJump). Route longitudes
// are wrapped into the view's world copy — the first point toward the view
// center, each subsequent point toward its predecessor so a route crossing
// the antimeridian keeps short segments instead of a spurious world-spanning
// one. The per-leg segment test covers "a waypoint is inside" too, since every
// waypoint is a segment endpoint.
export function routeInView(points, rect) {
  // A view wider than a full world sees every route somewhere.
  if (rect.east - rect.west >= 360)
    return true;
  let prevLat = points[0][0];
  let prevLng = wrapNear(points[0][1], (rect.west + rect.east) / 2);
  for (let i = 1; i < points.length; i++) {
    const lat = points[i][0];
    const lng = wrapNear(points[i][1], prevLng);
    if (segmentIntersectsRect(prevLat, prevLng, lat, lng, rect))
      return true;
    prevLat = lat;
    prevLng = lng;
  }
  return false;
}

// Shift a longitude by whole world copies (±360°) to the copy nearest `ref`.
function wrapNear(lng, ref) {
  return lng - 360 * Math.round((lng - ref) / 360);
}

// The route id from an activeRoute href — "/resources/routes/<id>", or the
// fully-qualified "/signalk/v2/api/resources/routes/<id>" form — matching the
// ids that key the /resources/routes payload. Null for anything else.
export function routeIdFromHref(href) {
  if (typeof href !== "string")
    return null;
  const match = href.match(/\/routes\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

// Liang-Barsky test of one segment against the view rect: clip the segment's
// parameter range against each edge; any surviving range means some part of
// the segment (endpoints included) lies inside.
export function segmentIntersectsRect(lat1, lng1, lat2, lng2, rect) {
  const dLng = lng2 - lng1;
  const dLat = lat2 - lat1;
  const edges = [
    [-dLng, lng1 - rect.west],
    [dLng, rect.east - lng1],
    [-dLat, lat1 - rect.south],
    [dLat, rect.north - lat1],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside it means outside the rect entirely.
      if (q < 0)
        return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1)
        return false;
      if (r > t0)
        t0 = r;
    } else {
      if (r < t0)
        return false;
      if (r < t1)
        t1 = r;
    }
  }
  return true;
}

// Waypoint shapes as divIcon inline SVGs. Solid green fill with the 1px white
// border drawn as an SVG stroke, and the triangle rotated via the SVG
// `transform` attribute — both render correctly on the Chromium 69 MFDs,
// unlike CSS filters on SVG (see COURSE_VECTOR_HALO_STYLE in FleetLayer). An
// explicit className keeps Leaflet from applying its default
// .leaflet-div-icon white box.
function shapeIcon(size, body) {
  return L.divIcon({
    className: "route-waypoint",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">${body}</svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const SHAPE_STYLE = `fill="${ROUTE_COLOR}" stroke="#fff" stroke-width="1"`;

function iconFor(shape) {
  switch (shape.type) {
    case "dot":
      return shapeIcon(12, `<circle cx="6" cy="6" r="4.5" ${SHAPE_STYLE}/>`);
    case "square":
      return shapeIcon(12, `<rect x="1.5" y="1.5" width="9" height="9" ${SHAPE_STYLE}/>`);
    default:
      // Points north (up) at angle 0; rotated clockwise by the leg's bearing.
      return shapeIcon(
        14,
        `<path d="M7 1.5 L12.5 12.5 L1.5 12.5 Z" transform="rotate(${shape.angle.toFixed(1)} 7 7)" ${SHAPE_STYLE}/>`,
      );
  }
}

export class RoutesLayer {
  constructor({ map, signalK, layersControl, show }) {
    this.map = map;
    this.signalK = signalK;
    // The map's layer control, where each in-view route is listed by name as a
    // toggleable overlay. Optional so the layer still works without one.
    this.layersControl = layersControl ?? null;
    // Master on/off (the "Show Routes" setting), layered over the viewport test.
    this.show = show ?? true;
    // id -> { signature, points, label, group, listed }. Every parsed route
    // keeps its built layer group here whether or not it's currently shown;
    // applyVisibility toggles map and layer-control membership.
    this.routes = {};
    // The route currently being navigated (see setActiveRoute), or null.
    this.activeRouteId = null;
    this._warned = false;

    if (!map.getPane(ROUTE_PANE))
      map.createPane(ROUTE_PANE).style.zIndex = ROUTE_PANE_Z_INDEX;

    // Which routes touch the view changes with the viewport, not just on data
    // refreshes (moveend also fires after a zoom completes).
    this.map.on("moveend", () => this.applyVisibility());

    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), ROUTES_REFRESH_MS);
  }

  // Flip the master switch live (from the settings dialog).
  setShowRoutes(show) {
    const next = show ?? true;
    if (next === this.show)
      return;
    this.show = next;
    this.applyVisibility();
  }

  // Track the navigation.course.activeRoute value (or null when course is
  // cleared), fed in on every update tick by ChartPlotter. While set, only the
  // active route is drawn. A newly-activated route we haven't parsed yet (e.g.
  // created and activated within the poll interval) triggers an immediate
  // re-fetch so it shows up without waiting out the timer.
  setActiveRoute(value) {
    const id = routeIdFromHref(value?.href);
    if (id === this.activeRouteId)
      return;
    this.activeRouteId = id;
    if (id && !this.routes[id])
      this.refresh();
    this.applyVisibility();
  }

  // Re-fetch the routes collection and reconcile. A failure (including the 404
  // a boat with no resources provider gets) just keeps whatever we last had;
  // it's logged once rather than on every poll so a provider-less boat doesn't
  // fill the console.
  refresh() {
    this.signalK
      .fetchRoutes()
      .then((payload) => {
        this._warned = false;
        this.setRoutes(parseRoutes(payload));
      })
      .catch((error) => {
        if (!this._warned) {
          console.warn("Routes unavailable:", error);
          this._warned = true;
        }
      });
  }

  // Reconcile the cached routes against a fresh parse: unchanged routes keep
  // their existing layers (no flicker, and a manual layer-control untick
  // survives the poll), changed ones are rebuilt, and routes gone from the
  // payload are removed from the map and the layer control.
  setRoutes(parsed) {
    const seen = new Set();
    for (const { id, name, points } of parsed) {
      seen.add(id);
      const signature = JSON.stringify([name, points]);
      const existing = this.routes[id];
      if (existing && existing.signature === signature)
        continue;
      if (existing)
        this._delist(existing);
      this.routes[id] = {
        signature,
        points,
        label: name || "Unnamed Route",
        group: this._buildGroup(points),
        listed: false,
      };
    }
    for (const id in this.routes) {
      if (!seen.has(id)) {
        this._delist(this.routes[id]);
        delete this.routes[id];
      }
    }
    this.applyVisibility();
  }

  _delist(route) {
    this.map.removeLayer(route.group);
    this.layersControl?.removeLayer(route.group);
    route.listed = false;
  }

  // One route's line + waypoint shapes as a single layer group, so visibility
  // toggles treat the route as a unit. Everything is non-interactive so a
  // route can never steal hover/clicks from a vessel or its track — the same
  // reasoning as the course vectors.
  _buildGroup(points) {
    const layers = [
      L.polyline(points, {
        pane: ROUTE_PANE,
        color: ROUTE_COLOR,
        weight: ROUTE_LINE_WEIGHT,
        interactive: false,
      }),
    ];
    for (const shape of routeShapes(points)) {
      layers.push(
        L.marker([shape.lat, shape.lng], {
          pane: ROUTE_PANE,
          icon: iconFor(shape),
          interactive: false,
          keyboard: false,
        }),
      );
    }
    const group = L.layerGroup(layers);
    // Flags this overlay as a route for the layer control, which groups the
    // routes below a divider, apart from the charts (see hud/LayersControl).
    group._routeOverlay = true;
    return group;
  }

  // Reconcile each route's map and layer-control membership against the master
  // switch and the current viewport. Acting only on listed/unlisted
  // transitions (like ChartPlotter.updateChartLayers) means a route the user
  // unticked in the layer control stays off while it remains in view; leaving
  // and re-entering the view re-lists it ticked.
  applyVisibility() {
    const bounds = this.map.getBounds();
    const rect = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    // The active-route filter only engages when the active id is actually in
    // the collection, so a stale or unknown course pointer can't blank every
    // route on the chart.
    const active =
      this.activeRouteId && this.routes[this.activeRouteId]
        ? this.activeRouteId
        : null;
    for (const id in this.routes) {
      const route = this.routes[id];
      const show =
        this.show &&
        (!active || id === active) &&
        routeInView(route.points, rect);
      if (show === route.listed)
        continue;
      if (show) {
        // Add to the map before the control so the control renders the
        // route's checkbox already ticked (it reads map.hasLayer at build).
        route.group.addTo(this.map);
        this.layersControl?.addOverlay(route.group, route.label);
      } else {
        this.map.removeLayer(route.group);
        this.layersControl?.removeLayer(route.group);
      }
      route.listed = show;
    }
  }
}
