// Pure geometry for follow-mode "look ahead": how far, in screen pixels, to push
// the map center ahead of the boat so more of the water in the direction of
// travel is visible. Kept free of Leaflet so it can be unit-tested; ChartPlotter
// projects the boat to pixels, adds this offset, and unprojects the result into
// the new map center (see ChartPlotter.followCenter).
//
// The offset points along the boat's course, scaled by speed and capped at a
// fraction of the viewport so the boat is nudged toward the "back" of the view
// without ever leaving the screen.

// Below this speed a boat isn't really going anywhere, so we don't bias the view
// — a boat swinging at anchor shouldn't send the map wandering. ~1 kn.
const MIN_SOG_MPS = 0.5;
// At or above this speed the offset is maxed out; below it the offset scales
// linearly with speed. ~10 kn, a typical cruising pace.
const FULL_OFFSET_SOG_MPS = 5;
// Cap the center offset at this fraction of the smaller viewport dimension, so
// the boat stays comfortably on screen even at full speed and high zoom.
const MAX_OFFSET_FRACTION = 0.3;

// Compute the pixel offset to add to the boat's screen position to get the new
// map center: { x, y } with +x east (right) and +y south (down). Returns
// { x: 0, y: 0 } (no bias) when the boat is stationary, course/speed are
// unavailable, or the viewport size is unknown.
//
//   cogRad      course over ground, radians true (Signal K base unit)
//   sogMps      speed over ground, m/s (Signal K base unit)
//   viewportMin the smaller of the map viewport's width/height, in pixels
export function lookAheadOffsetPixels({ cogRad, sogMps, viewportMin }) {
  if (cogRad == null || sogMps == null || !(sogMps > MIN_SOG_MPS) || !(viewportMin > 0))
    return { x: 0, y: 0 };

  const speedFactor = Math.min(1, sogMps / FULL_OFFSET_SOG_MPS);
  const distance = viewportMin * MAX_OFFSET_FRACTION * speedFactor;

  // Screen axes: +x = east (right), +y = south (down). COG is a true bearing
  // (0 = north, increasing clockwise), so north maps to -y and east to +x.
  return {
    x: distance * Math.sin(cogRad),
    y: -distance * Math.cos(cogRad),
  };
}
