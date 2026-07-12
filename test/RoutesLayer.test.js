import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseRoutes,
  routeShapes,
  routeInView,
  routeIdFromHref,
  segmentIntersectsRect,
} from "../ui/js/RoutesLayer.js";

// The /signalk/v2/api/resources/routes payload the TODO is modeled on: two
// routes near Fiji (right at the antimeridian) from a resources provider.
const ROUTES = {
  "2bb60d26-6822-4d05-a14d-d914d240b5b0": {
    name: "Test Route",
    description: "Figuring out routes",
    distance: 46017,
    feature: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [179.332187803201, -16.7776245391139],
          [179.329660192767, -16.7783555019601],
          [179.326500310965, -16.7764478815714],
          [179.324321070168, -16.7760633312935],
          [179.31736271092, -16.7792761832978],
          [179.313631850807, -16.7819702084919],
          [179.279648125854, -16.8084056560747],
          [179.261194888015, -16.8246116115713],
          [179.058427602724, -16.9540777188849],
          [179.006853032864, -16.9503430797003],
          [178.982177026554, -16.9383227052731],
          [178.9823730005, -16.9283268189984],
          [178.990839378828, -16.9272200885661],
        ],
      },
      properties: {},
      id: "",
    },
    timestamp: "2026-07-12T02:05:42.149Z",
    $source: "resources-provider",
  },
  "9dde1f1a-1282-4c09-a90e-d8b0340eb46d": {
    name: "Test Route 2",
    description: "Another route to display.",
    distance: 8774,
    feature: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [179.326744040363, -16.7666958629114],
          [179.302579996998, -16.7765970236604],
          [179.293110201681, -16.7668631411004],
          [179.320094598781, -16.755106035426],
          [179.327796071045, -16.7645255968947],
        ],
      },
      properties: {},
      id: "",
    },
    timestamp: "2026-07-12T02:08:46.107Z",
    $source: "resources-provider",
  },
};

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("parseRoutes", () => {
  test("maps the example payload to id/name/[lat,lng] specs", () => {
    const routes = parseRoutes(ROUTES);
    assert.equal(routes.length, 2);
    const [first, second] = routes;
    assert.equal(first.id, "2bb60d26-6822-4d05-a14d-d914d240b5b0");
    assert.equal(first.name, "Test Route");
    assert.equal(first.points.length, 13);
    // GeoJSON [lng, lat] flipped to Leaflet [lat, lng].
    assert.deepEqual(first.points[0], [-16.7776245391139, 179.332187803201]);
    assert.equal(second.name, "Test Route 2");
    assert.equal(second.points.length, 5);
  });

  test("skips a route with no feature/geometry", () => {
    assert.equal(parseRoutes({ x: { name: "bare" } }).length, 0);
  });

  test("skips non-LineString geometries", () => {
    const routes = parseRoutes({
      x: {
        feature: {
          geometry: { type: "Point", coordinates: [179, -16] },
        },
      },
    });
    assert.equal(routes.length, 0);
  });

  test("skips a route with fewer than two waypoints", () => {
    const routes = parseRoutes({
      x: {
        feature: {
          geometry: { type: "LineString", coordinates: [[179, -16]] },
        },
      },
    });
    assert.equal(routes.length, 0);
  });

  test("skips a route with a non-numeric coordinate", () => {
    const routes = parseRoutes({
      x: {
        feature: {
          geometry: {
            type: "LineString",
            coordinates: [
              [179, -16],
              ["oops", -17],
            ],
          },
        },
      },
    });
    assert.equal(routes.length, 0);
  });

  test("a malformed route doesn't take down the rest of the collection", () => {
    const routes = parseRoutes({ ...ROUTES, junk: { name: "junk" } });
    assert.equal(routes.length, 2);
  });

  test("tolerates null / non-object payloads", () => {
    assert.deepEqual(parseRoutes(null), []);
    assert.deepEqual(parseRoutes("nope"), []);
  });
});

describe("routeShapes", () => {
  test("a two-point route is just dot + square", () => {
    const shapes = routeShapes([
      [0, 0],
      [0, 1],
    ]);
    assert.deepEqual(
      shapes.map((s) => s.type),
      ["dot", "square"],
    );
  });

  test("intermediate waypoints get triangles between the dot and square", () => {
    const shapes = routeShapes(parseRoutes(ROUTES)[1].points);
    assert.deepEqual(
      shapes.map((s) => s.type),
      ["dot", "triangle", "triangle", "triangle", "square"],
    );
  });

  test("triangles point toward the next waypoint (compass degrees)", () => {
    // Along the equator so the bearings are exact: next leg heads due east.
    const east = routeShapes([
      [0, -1],
      [0, 0],
      [0, 1],
    ]);
    assertClose(east[1].angle, 90);

    const west = routeShapes([
      [0, 1],
      [0, 0],
      [0, -1],
    ]);
    assertClose(west[1].angle, 270);

    const north = routeShapes([
      [-1, 0],
      [0, 0],
      [1, 0],
    ]);
    assertClose(north[1].angle, 0);
  });

  test("shapes carry the waypoint position", () => {
    const shapes = routeShapes([
      [-16.5, 179.1],
      [-16.6, 179.2],
      [-16.7, 179.3],
    ]);
    assert.equal(shapes[1].lat, -16.6);
    assert.equal(shapes[1].lng, 179.2);
  });
});

describe("routeIdFromHref", () => {
  test("extracts the id from an activeRoute href", () => {
    assert.equal(
      routeIdFromHref("/resources/routes/2bb60d26-6822-4d05-a14d-d914d240b5b0"),
      "2bb60d26-6822-4d05-a14d-d914d240b5b0",
    );
  });

  test("accepts the fully-qualified v2 API form", () => {
    assert.equal(
      routeIdFromHref("/signalk/v2/api/resources/routes/abc-123"),
      "abc-123",
    );
  });

  test("tolerates a trailing slash", () => {
    assert.equal(routeIdFromHref("/resources/routes/abc-123/"), "abc-123");
  });

  test("returns null for non-route hrefs and non-strings", () => {
    assert.equal(routeIdFromHref("/resources/waypoints/abc-123"), null);
    assert.equal(routeIdFromHref("/resources/routes/"), null);
    assert.equal(routeIdFromHref(null), null);
    assert.equal(routeIdFromHref(undefined), null);
    assert.equal(routeIdFromHref(42), null);
  });
});

describe("segmentIntersectsRect", () => {
  const RECT = { west: 0, south: 0, east: 1, north: 1 };

  test("an endpoint inside the rect intersects", () => {
    assert.equal(segmentIntersectsRect(0.5, 0.5, 5, 5, RECT), true);
  });

  test("a segment passing through with both endpoints outside intersects", () => {
    assert.equal(segmentIntersectsRect(-1, 0.5, 2, 0.5, RECT), true);
  });

  test("a diagonal that misses the corner does not intersect", () => {
    // The line lat + lng = 3 passes northeast of the rect's (1, 1) corner.
    assert.equal(segmentIntersectsRect(3, 0, 0, 3, RECT), false);
  });

  test("a segment parallel to an edge but outside does not intersect", () => {
    assert.equal(segmentIntersectsRect(2, -1, 2, 2, RECT), false);
  });
});

describe("routeInView", () => {
  const TEST_ROUTE = parseRoutes(ROUTES)[0].points;

  test("visible when a waypoint is inside the view", () => {
    const rect = { west: 179.3, south: -16.8, east: 179.4, north: -16.7 };
    assert.equal(routeInView(TEST_ROUTE, rect), true);
  });

  test("visible when a leg crosses the view with no waypoint inside", () => {
    // Straddles the long leg from [~179.261, -16.82] to [~179.058, -16.95].
    const rect = { west: 179.12, south: -17.0, east: 179.2, north: -16.8 };
    assert.equal(routeInView(TEST_ROUTE, rect), true);
  });

  test("hidden when the route is entirely outside the view", () => {
    const rect = { west: 178.0, south: -16.0, east: 178.5, north: -15.5 };
    assert.equal(routeInView(TEST_ROUTE, rect), false);
  });

  test("visible across the antimeridian when the view runs past 180", () => {
    // worldCopyJump view bounds keep counting up past 180; a route stored at
    // -179.5 sits inside a view spanning 179.9..180.9 (i.e. -180.1..-179.1).
    const rect = { west: 179.9, south: -17, east: 180.9, north: -16 };
    const route = [
      [-16.5, -179.5],
      [-16.6, -179.4],
    ];
    assert.equal(routeInView(route, rect), true);
  });

  test("visible across the antimeridian when the view runs below -180", () => {
    const rect = { west: -180.8, south: -17, east: -179.9, north: -16 };
    const route = [
      [-16.5, 179.5],
      [-16.6, 179.6],
    ];
    assert.equal(routeInView(route, rect), true);
  });

  test("a route crossing the antimeridian keeps its legs short", () => {
    // One leg from 179.8 to -179.8 crosses 180; a view sitting right on the
    // crossing must see it, and a view far away (which a naive 359.6°-wide
    // segment would sweep through) must not.
    const route = [
      [-16.5, 179.8],
      [-16.5, -179.8],
    ];
    const onCrossing = { west: 179.9, south: -17, east: 180.1, north: -16 };
    assert.equal(routeInView(route, onCrossing), true);
    const farAway = { west: 0, south: -17, east: 1, north: -16 };
    assert.equal(routeInView(route, farAway), false);
  });

  test("a view wider than the whole world sees every route", () => {
    const rect = { west: -300, south: -80, east: 300, north: 80 };
    assert.equal(routeInView(TEST_ROUTE, rect), true);
  });
});
