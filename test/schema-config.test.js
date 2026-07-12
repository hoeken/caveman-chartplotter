import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pickUiConfig,
  coerceUiConfig,
  applyDefaults,
  UI_CONFIG_KEYS,
} from "../src/schema.js";
import { ValidationError } from "../src/errors.js";

// buildSchema(app) only ever calls app.getSelfPath() to mark path checks, so a
// stub that reports every path as absent is enough for coercion/defaults tests.
const APP = { getSelfPath: () => null };

describe("pickUiConfig()", () => {
  test("projects exactly the whitelisted keys", () => {
    const picked = pickUiConfig({
      defaultBasemap: "Satellite",
      somethingInternal: "secret",
    });
    assert.deepEqual(Object.keys(picked).sort(), [...UI_CONFIG_KEYS].sort());
    assert.equal(picked.defaultBasemap, "Satellite");
    assert.equal("somethingInternal" in picked, false);
  });

  test("fills undefined for keys absent from the source config", () => {
    const picked = pickUiConfig({});
    assert.equal(picked.defaultBasemap, undefined);
    assert.equal("defaultBasemap" in picked, true);
  });
});

describe("coerceUiConfig()", () => {
  test("returns only the whitelisted keys that were present", () => {
    const updates = coerceUiConfig(APP, {
      defaultBasemap: "OpenStreetMap",
      somethingInternal: "nope", // not a UI key — must be ignored
    });
    assert.deepEqual(updates, { defaultBasemap: "OpenStreetMap" });
  });

  test("coerces integers (rounding) and booleans", () => {
    const updates = coerceUiConfig(APP, {
      fleetFilterRadius: "512.7",
      enableBoatLabels: 0,
    });
    assert.equal(updates.fleetFilterRadius, 513);
    assert.equal(updates.enableBoatLabels, false);
  });

  test("throws ValidationError on an enum violation", () => {
    assert.throws(
      () => coerceUiConfig(APP, { defaultBasemap: "CARRIER_PIGEON" }),
      ValidationError,
    );
  });

  test("throws ValidationError when a string field gets a non-string", () => {
    assert.throws(
      () => coerceUiConfig(APP, { defaultBasemap: 42 }),
      ValidationError,
    );
  });

  test("accepts the <select> string form of an integer enum value", () => {
    // The settings dialog posts courseVectorMinutes as a string ("15"); it must
    // coerce to the integer 15 and pass the enum check.
    const updates = coerceUiConfig(APP, { courseVectorMinutes: "15" });
    assert.equal(updates.courseVectorMinutes, 15);
  });

  test("accepts 0 (off) for the course vector", () => {
    const updates = coerceUiConfig(APP, { courseVectorMinutes: "0" });
    assert.equal(updates.courseVectorMinutes, 0);
  });

  test("throws ValidationError on an integer-enum violation", () => {
    assert.throws(
      () => coerceUiConfig(APP, { courseVectorMinutes: 7 }),
      ValidationError,
    );
  });
});

describe("applyDefaults()", () => {
  test("fills schema defaults for unset keys", () => {
    const config = {};
    applyDefaults(APP, config);
    assert.equal(config.defaultBasemap, "Satellite");
    assert.equal(config.fleetFilterRadius, 100000);
    assert.equal(config.enableBoatLabels, true);
    assert.equal(config.enableOwnTrack, true);
    assert.equal(config.enableOtherTracks, true);
    assert.equal(config.enableRoutes, true);
    assert.equal(config.enableChartLayers, true);
    assert.equal(config.enableSeascape, false);
    assert.equal(config.courseVectorMinutes, 15);
    assert.equal(config.enableLookAhead, true);
  });

  test("never overwrites a value the user already set", () => {
    const config = { defaultBasemap: "OpenStreetMap", fleetFilterRadius: 999 };
    applyDefaults(APP, config);
    assert.equal(config.defaultBasemap, "OpenStreetMap");
    assert.equal(config.fleetFilterRadius, 999);
  });
});
