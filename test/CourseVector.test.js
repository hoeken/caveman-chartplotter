import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { courseVectorLatLngs } from "../ui/js/CourseVector.js";

// Base inputs for a boat at the equator making 10 m/s due north, with a 15-min
// vector starting at the origin. Individual tests override just the fields they
// exercise.
const BASE = {
  start: { lat: 0, lng: 0 },
  cogRad: 0, // north
  sogMps: 10,
  minutes: 15,
};

const near = (actual, expected, tol = 1e-4) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );

describe("courseVectorLatLngs()", () => {
  describe("returns null when nothing should be drawn", () => {
    test("the feature is off (minutes 0)", () => {
      assert.equal(courseVectorLatLngs({ ...BASE, minutes: 0 }), null);
    });

    test("COG is unavailable", () => {
      assert.equal(courseVectorLatLngs({ ...BASE, cogRad: null }), null);
    });

    test("SOG is unavailable", () => {
      assert.equal(courseVectorLatLngs({ ...BASE, sogMps: null }), null);
    });

    test("the boat is effectively stationary (below the SOG floor)", () => {
      assert.equal(courseVectorLatLngs({ ...BASE, sogMps: 0.01 }), null);
    });

    test("there is no start point", () => {
      assert.equal(courseVectorLatLngs({ ...BASE, start: null }), null);
    });
  });

  describe("geometry", () => {
    test("the line begins exactly at the given start (the drawn bow)", () => {
      const line = courseVectorLatLngs({ ...BASE, start: { lat: 10, lng: -20 } });
      assert.deepEqual(line[0], [10, -20]);
    });

    test("length is SOG * minutes, extended along COG (due north)", () => {
      // 10 m/s * 15 min * 60 s = 9000 m north ≈ 0.0809° of latitude.
      const line = courseVectorLatLngs(BASE);
      assert.deepEqual(line[0], [0, 0]);
      near(line[1][0], 0.0809); // tip latitude
      near(line[1][1], 0); // no easting on a due-north course
    });

    test("a due-east COG extends the tip eastward, not northward", () => {
      // COG = π/2 rad = 90° = east.
      const line = courseVectorLatLngs({ ...BASE, cogRad: Math.PI / 2 });
      near(line[1][0], 0); // latitude unchanged
      assert.ok(line[1][1] > 0); // tip is east of the start
    });

    test("halving the time halves the vector length", () => {
      const full = courseVectorLatLngs(BASE);
      const half = courseVectorLatLngs({ ...BASE, minutes: 7.5 });
      near(half[1][0], full[1][0] / 2);
    });
  });
});
