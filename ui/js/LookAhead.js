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

// Time constant for smoothing the look-ahead bearing, in milliseconds. In a
// seaway the boat yaws with each wave, so raw heading/COG jitters and the
// look-ahead point jumps around; blending toward each new reading over roughly
// this long steadies it, trading a little more lag on real turns for a much
// calmer view. See smoothBearingRad / bearingSmoothingAlpha.
export const BEARING_SMOOTHING_TAU_MS = 10000;

// Convert a smoothing time constant and a fixed sampling interval into the EMA
// weight (alpha, in (0,1]) applied to the newest sample. Standard first-order
// low-pass discretization: alpha = dt / (dt + tau). A larger interval or smaller
// tau means each sample counts for more (less smoothing).
export function bearingSmoothingAlpha(intervalMs, tauMs = BEARING_SMOOTHING_TAU_MS) {
  if (!(intervalMs > 0) || !(tauMs > 0))
    return 1;
  return intervalMs / (intervalMs + tauMs);
}

// Exponential moving average for a bearing in radians. Angles wrap at 0/2π, so
// they can't be averaged arithmetically (359° and 1° must average to 0°, not
// 180°); we blend the two directions as unit vectors and take the angle of the
// result. `alpha` in (0,1] weights the new sample — smaller is smoother and
// laggier. Returns `sample` on the first reading (no prior value) and holds
// `prev` when the sample is missing. The result is in (−π, π]; that's fine for
// look-ahead since only its sin/cos are used downstream.
export function smoothBearingRad(prev, sample, alpha) {
  if (sample == null)
    return prev ?? null;
  if (prev == null)
    return sample;
  const x = alpha * Math.sin(sample) + (1 - alpha) * Math.sin(prev);
  const y = alpha * Math.cos(sample) + (1 - alpha) * Math.cos(prev);
  // Diametrically opposite bearings cancel to the origin, which has no
  // direction; keep the prior rather than snapping to an arbitrary angle.
  if (x === 0 && y === 0)
    return prev;
  return Math.atan2(x, y);
}
