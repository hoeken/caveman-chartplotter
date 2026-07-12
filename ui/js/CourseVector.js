// Pure geometry for a vessel's course vector (a.k.a. COG/SOG predictor line):
// the straight line showing where a boat will be after a set time if it holds
// its current course and speed. Kept free of Leaflet so it can be unit-tested;
// FleetLayer turns the returned [lat, lng] pair into an L.polyline.
//
// The line starts at `start` — the vessel's drawn bow, which the caller resolves
// from the marker's on-screen geometry (BoatMarker.getBoatBow) so it stays at
// the icon's tip even when the icon is drawn larger than scale at low zoom — and
// extends `minutes` of travel along COG at the current SOG.

import { destination, radiansToDegrees } from "@turf/turf";

// Below this speed a boat is treated as stationary and gets no vector. ~0.5 kn,
// well under GPS position noise, so a moored boat's jitter can't sprout a
// flickering predictor.
const MIN_SOG_MPS = 0.25;

// Compute the course vector as a [[lat, lng], [lat, lng]] pair (bow → tip), or
// null when nothing should be drawn: the feature is off (minutes ≤ 0), the boat
// is stationary, or COG/SOG are unavailable.
//
//   start   { lat, lng } of the vessel's (drawn) bow — where the line begins
//   cogRad  course over ground, radians true (Signal K base unit)
//   sogMps  speed over ground, m/s (Signal K base unit)
//   minutes length of the vector, in minutes of travel
export function courseVectorLatLngs({ start, cogRad, sogMps, minutes }) {
  if (!(minutes > 0) || !start)
    return null;
  if (cogRad == null || sogMps == null || !(sogMps > MIN_SOG_MPS))
    return null;

  const lengthM = sogMps * minutes * 60;
  if (!(lengthM > 0))
    return null;

  // turf works in [lng, lat]; Leaflet wants [lat, lng], so convert on the way out.
  const tip = destination([start.lng, start.lat], lengthM, radiansToDegrees(cogRad), {
    units: "meters",
  }).geometry.coordinates;

  return [
    [start.lat, start.lng],
    [tip[1], tip[0]],
  ];
}
