import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nextPointLatLngs,
  NEXT_POINT_PANE_Z_INDEX,
  NEXT_POINT_MARKER_PANE_Z_INDEX,
} from "../ui/js/NextPointLine.js";
import {
  ROUTE_PANE_Z_INDEX,
  ROUTE_MARKER_PANE_Z_INDEX,
} from "../ui/js/RoutesLayer.js";

// A real navigation.course.nextPoint value from the v2 Course API — published
// this same shape while following a route and while heading to a lone
// waypoint (near Fiji, like the RoutesLayer fixtures).
const NEXT_POINT = {
  position: { longitude: 177.3613857, latitude: -17.745273 },
  type: "Location",
  name: "DP",
};

const BOW = { lat: -17.7, lng: 177.4 };

// A navigation.course.previousPoint value — the leg only cares that it's
// non-null (see the B&G gate in nextPointLatLngs).
const PREVIOUS_POINT = {
  position: { longitude: 177.42, latitude: -17.69 },
  type: "VesselPosition",
};

describe("nextPointLatLngs()", () => {
  describe("returns null when nothing should be drawn", () => {
    test("there is no bow position yet", () => {
      assert.equal(nextPointLatLngs(null, NEXT_POINT, PREVIOUS_POINT), null);
    });

    test("the course is cleared (nextPoint value null)", () => {
      assert.equal(nextPointLatLngs(BOW, null, null), null);
    });

    test("nextPoint has never been received (undefined)", () => {
      assert.equal(nextPointLatLngs(BOW, undefined, undefined), null);
    });

    test("a B&G stopped route: nextPoint left set but previousPoint cleared", () => {
      assert.equal(nextPointLatLngs(BOW, NEXT_POINT, null), null);
      assert.equal(nextPointLatLngs(BOW, NEXT_POINT, undefined), null);
    });

    test("the value carries no position", () => {
      assert.equal(
        nextPointLatLngs(BOW, { type: "Location", name: "DP" }, PREVIOUS_POINT),
        null,
      );
    });

    test("the position is malformed", () => {
      assert.equal(
        nextPointLatLngs(
          BOW,
          { position: { latitude: "x", longitude: 177 } },
          PREVIOUS_POINT,
        ),
        null,
      );
      assert.equal(
        nextPointLatLngs(BOW, { position: { latitude: -17.7 } }, PREVIOUS_POINT),
        null,
      );
    });
  });

  describe("geometry", () => {
    test("the leg runs from the bow to the next point", () => {
      const leg = nextPointLatLngs(BOW, NEXT_POINT, PREVIOUS_POINT);
      assert.deepEqual(leg, [
        [-17.7, 177.4],
        [-17.745273, 177.3613857],
      ]);
    });

    test("a leg across the antimeridian stays short (dest wrapped to the bow's side)", () => {
      const leg = nextPointLatLngs(
        { lat: -17.7, lng: 179.9 },
        { position: { latitude: -17.7, longitude: -179.9 } },
        PREVIOUS_POINT,
      );
      assert.deepEqual(leg[1], [-17.7, 180.1]);
    });

    test("a bow carried into another world copy by worldCopyJump keeps the leg attached", () => {
      const leg = nextPointLatLngs(
        { lat: -17.7, lng: 177.4 + 360 },
        NEXT_POINT,
        PREVIOUS_POINT,
      );
      assert.deepEqual(leg[1], [-17.745273, 177.3613857 + 360]);
    });
  });
});

describe("pane stacking", () => {
  test("the leg sits above both route panes and below the markers (600)", () => {
    assert.ok(NEXT_POINT_PANE_Z_INDEX > ROUTE_PANE_Z_INDEX);
    assert.ok(NEXT_POINT_PANE_Z_INDEX > ROUTE_MARKER_PANE_Z_INDEX);
    assert.ok(NEXT_POINT_MARKER_PANE_Z_INDEX > NEXT_POINT_PANE_Z_INDEX);
    assert.ok(NEXT_POINT_MARKER_PANE_Z_INDEX < 600);
  });
});
