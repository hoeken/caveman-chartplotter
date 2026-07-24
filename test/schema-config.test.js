import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pickUiConfig,
  coerceUiConfig,
  buildSchema,
  defaultUiConfig,
  uiSchemaProperties,
  UI_CONFIG_KEYS,
} from "../src/schema.js";
import { ValidationError } from "../src/errors.js";

// buildSchema(app) only ever calls app.getSelfPath() to mark path checks, so a
// stub that reports every path as absent is enough for schema tests.
const APP = { getSelfPath: () => null };

describe("UI preference schema split", () => {
  test("the whitelist is exactly the UI preference schema's keys", () => {
    assert.deepEqual(UI_CONFIG_KEYS, Object.keys(uiSchemaProperties));
  });

  test("the plugin schema no longer carries the UI preference keys", () => {
    const props = buildSchema(APP).properties;
    for (const key of UI_CONFIG_KEYS)
      assert.equal(key in props, false, `${key} should be out of the plugin schema`);
    // ...leaving only the read-only path checks.
    assert.deepEqual(Object.keys(props), ["pathChecks"]);
  });

  test("defaultUiConfig() yields a fresh copy of every default", () => {
    const defaults = defaultUiConfig();
    assert.equal(defaults.defaultBasemap, "Satellite");
    assert.equal(defaults.fleetFilterRadius, 100000);
    assert.equal(defaults.courseVectorMinutes, 15);
    assert.equal(defaults.enableLookAhead, true);
    assert.deepEqual(defaults.charts, {});
    assert.deepEqual(Object.keys(defaults), UI_CONFIG_KEYS);
    defaults.defaultBasemap = "mutated";
    assert.equal(defaultUiConfig().defaultBasemap, "Satellite");
    // Object defaults must be cloned — mutating a resolved config must not
    // poison the schema fragment for the next call.
    defaults.charts.someChart = false;
    assert.deepEqual(defaultUiConfig().charts, {});
  });
});

describe("pickUiConfig()", () => {
  test("projects only whitelisted keys that carry a value", () => {
    const picked = pickUiConfig({
      defaultBasemap: "Satellite",
      somethingInternal: "secret",
    });
    assert.deepEqual(picked, { defaultBasemap: "Satellite" });
  });

  test("omits keys absent from the source config", () => {
    assert.deepEqual(pickUiConfig({}), {});
    assert.deepEqual(pickUiConfig(), {});
  });
});

describe("coerceUiConfig()", () => {
  test("returns only the whitelisted keys that were present", () => {
    const updates = coerceUiConfig({
      defaultBasemap: "OpenStreetMap",
      somethingInternal: "nope", // not a UI key — must be ignored
    });
    assert.deepEqual(updates, { defaultBasemap: "OpenStreetMap" });
  });

  test("coerces integers (rounding) and booleans", () => {
    const updates = coerceUiConfig({
      fleetFilterRadius: "512.7",
      enableBoatLabels: 0,
    });
    assert.equal(updates.fleetFilterRadius, 513);
    assert.equal(updates.enableBoatLabels, false);
  });

  test("throws ValidationError on an enum violation", () => {
    assert.throws(
      () => coerceUiConfig({ defaultBasemap: "CARRIER_PIGEON" }),
      ValidationError,
    );
  });

  test("throws ValidationError when a string field gets a non-string", () => {
    assert.throws(
      () => coerceUiConfig({ defaultBasemap: 42 }),
      ValidationError,
    );
  });

  test("accepts the <select> string form of an integer enum value", () => {
    // The settings dialog posts courseVectorMinutes as a string ("15"); it must
    // coerce to the integer 15 and pass the enum check.
    const updates = coerceUiConfig({ courseVectorMinutes: "15" });
    assert.equal(updates.courseVectorMinutes, 15);
  });

  test("accepts 0 (off) for the course vector", () => {
    const updates = coerceUiConfig({ courseVectorMinutes: "0" });
    assert.equal(updates.courseVectorMinutes, 0);
  });

  test("throws ValidationError on an integer-enum violation", () => {
    assert.throws(
      () => coerceUiConfig({ courseVectorMinutes: 7 }),
      ValidationError,
    );
  });

  test("coerces the charts map's values to booleans, keeping its keys", () => {
    const updates = coerceUiConfig({
      charts: { "Fiji_Nanuku-Passage": 0, "NZ614 Marlborough Sounds": true },
    });
    assert.deepEqual(updates.charts, {
      "Fiji_Nanuku-Passage": false,
      "NZ614 Marlborough Sounds": true,
    });
  });

  test("throws ValidationError when charts is not an object", () => {
    for (const charts of ["yes", 42, null, ["chart-a"]]) {
      assert.throws(() => coerceUiConfig({ charts }), ValidationError);
    }
  });
});
