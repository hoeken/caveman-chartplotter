import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lookAheadOffsetPixels } from "../ui/js/LookAhead.js";

// Base inputs for a boat making 10 m/s (well past the full-offset speed) due
// north in a 1000px viewport. Individual tests override just what they exercise.
const BASE = {
  cogRad: 0, // north
  sogMps: 10,
  viewportMin: 1000,
};

const near = (actual, expected, tol = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );

describe("lookAheadOffsetPixels()", () => {
  describe("returns no offset when the view shouldn't be biased", () => {
    test("COG is unavailable", () => {
      assert.deepEqual(lookAheadOffsetPixels({ ...BASE, cogRad: null }), { x: 0, y: 0 });
    });

    test("SOG is unavailable", () => {
      assert.deepEqual(lookAheadOffsetPixels({ ...BASE, sogMps: null }), { x: 0, y: 0 });
    });

    test("the boat is effectively stationary (below the SOG floor)", () => {
      assert.deepEqual(lookAheadOffsetPixels({ ...BASE, sogMps: 0.1 }), { x: 0, y: 0 });
    });

    test("the viewport size is unknown", () => {
      assert.deepEqual(lookAheadOffsetPixels({ ...BASE, viewportMin: 0 }), { x: 0, y: 0 });
    });
  });

  describe("geometry", () => {
    test("a due-north course pushes the center up (−y), not sideways", () => {
      // At/above full-offset speed: 1000 * 0.3 * 1 = 300px, straight north.
      const offset = lookAheadOffsetPixels(BASE);
      near(offset.x, 0);
      near(offset.y, -300);
    });

    test("a due-east course pushes the center right (+x), not vertically", () => {
      const offset = lookAheadOffsetPixels({ ...BASE, cogRad: Math.PI / 2 });
      near(offset.x, 300);
      near(offset.y, 0);
    });

    test("offset scales linearly with speed below the full-offset speed", () => {
      // 2.5 m/s is half of the 5 m/s full-offset speed → half the 300px cap.
      const offset = lookAheadOffsetPixels({ ...BASE, sogMps: 2.5 });
      near(offset.y, -150);
    });

    test("offset is capped once at/above the full-offset speed", () => {
      const full = lookAheadOffsetPixels({ ...BASE, sogMps: 5 });
      const faster = lookAheadOffsetPixels({ ...BASE, sogMps: 50 });
      near(full.y, -300);
      near(faster.y, -300);
    });

    test("offset scales with the viewport's smaller dimension", () => {
      const offset = lookAheadOffsetPixels({ ...BASE, viewportMin: 500 });
      near(offset.y, -150); // 500 * 0.3 * 1
    });
  });
});
