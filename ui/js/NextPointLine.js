// NextPointLine draws the active leg of the current course: a straight purple
// line from our own drawn bow to navigation.course.nextPoint, ending in the
// same square the route-end waypoint uses (recoloured purple). The v2 Course
// API publishes nextPoint both while navigating a route and while heading to a
// lone waypoint with no route active, so the leg is the one constant "where am
// I steering" cue across both modes. Drawing is additionally gated on
// navigation.course.previousPoint being non-null (see nextPointLatLngs).
//
// The leg gets its own panes, sandwiched above the route panes (375/385) but
// below the default overlay pane (400: tracks, course vectors) and the vessel
// markers (markerPane, 600) — it reads as the highlighted part of the route
// stack without ever covering the boat icons. Marker pane one step above the
// line pane so the square sits on top of the line, mirroring RoutesLayer.
//
// The geometry helper is pure and L-free so it can be unit-tested without
// Leaflet (the same split as CourseVector.js); FleetLayer anchors the leg to
// the drawn bow and redraws it every update tick and on zoom.

import { ROUTE_LINE_WEIGHT, squareIcon } from "./RoutesLayer.js";

export const NEXT_POINT_PANE = "nextPointPane";
export const NEXT_POINT_PANE_Z_INDEX = 390;
export const NEXT_POINT_MARKER_PANE = "nextPointMarkerPane";
export const NEXT_POINT_MARKER_PANE_Z_INDEX = 395;

const NEXT_POINT_COLOR = "#a020f0";

// Compute the leg as a [[lat, lng], [lat, lng]] pair (bow → next point), or
// null when nothing should be drawn: no bow position yet, no usable nextPoint
// (course cleared publishes null, and a malformed position is treated the
// same rather than drawing a line to nowhere), or no previousPoint. The
// previousPoint gate exists because B&G plotters don't clear nextPoint when a
// route is stopped — but they do clear previousPoint, so it's the reliable
// "actually navigating" signal.
//
//   start          { lat, lng } of our (drawn) bow — where the line begins
//   nextPoint      the navigation.course.nextPoint value:
//                  { position: { latitude, longitude }, type, name } or null
//   previousPoint  the navigation.course.previousPoint value; only its
//                  null-ness matters
export function nextPointLatLngs(start, nextPoint, previousPoint) {
  if (!start || previousPoint == null)
    return null;
  const position = nextPoint?.position;
  if (
    !position ||
    !Number.isFinite(position.latitude) ||
    !Number.isFinite(position.longitude)
  )
    return null;
  // Wrap the destination into the bow's world copy so a leg across the
  // antimeridian draws as the short segment instead of spanning the world —
  // and stays attached when worldCopyJump has carried the bow past ±180.
  const lng =
    position.longitude - 360 * Math.round((position.longitude - start.lng) / 360);
  return [
    [start.lat, start.lng],
    [position.latitude, lng],
  ];
}

// The leg as a line + end-square layer group so draw/move/remove treat it as a
// unit. Non-interactive for the same reason as routes and course vectors: it
// must never steal hover/clicks from a vessel marker or its track.
export function buildNextPointLine(latlngs) {
  const line = L.polyline(latlngs, {
    pane: NEXT_POINT_PANE,
    color: NEXT_POINT_COLOR,
    weight: ROUTE_LINE_WEIGHT,
    interactive: false,
  });
  const marker = L.marker(latlngs[1], {
    pane: NEXT_POINT_MARKER_PANE,
    icon: squareIcon(NEXT_POINT_COLOR),
    interactive: false,
    keyboard: false,
  });
  const group = L.layerGroup([line, marker]);
  group._line = line;
  group._marker = marker;
  return group;
}
