import { test, describe } from "node:test";
import assert from "node:assert/strict";
import createPlugin from "../src/index.js";
import { UI_CONFIG_KEYS } from "../src/schema.js";
import { createMockApp } from "./mockApp.js";

function setup() {
  const h = createMockApp();
  const plugin = createPlugin(h.app);
  return { h, plugin };
}

describe("plugin identity", () => {
  test("exposes the caveman-chartplotter id and name", () => {
    const { plugin } = setup();
    assert.equal(plugin.id, "caveman-chartplotter");
    assert.equal(plugin.name, "Caveman Chartplotter");
    assert.ok(plugin.description.length > 0);
  });
});

describe("plugin.start()", () => {
  test("stores the supplied configuration and reports Started", () => {
    const { h, plugin } = setup();
    plugin.start({ defaultBasemap: "OpenStreetMap" });
    assert.equal(plugin.configuration.defaultBasemap, "OpenStreetMap");
    assert.equal(h.lastStatus(), "Started");
  });

  test("fills schema defaults for unset keys", () => {
    const { plugin } = setup();
    plugin.start({});
    assert.equal(plugin.configuration.defaultBasemap, "Satellite");
    assert.equal(plugin.configuration.fleetFilterRadius, 100000);
    assert.equal(plugin.configuration.enableBoatLabels, true);
    assert.equal(plugin.configuration.enableSeascape, false);
  });

  test("tolerates being started with no props at all", () => {
    const { plugin } = setup();
    assert.doesNotThrow(() => plugin.start(undefined));
    assert.equal(plugin.configuration.defaultBasemap, "Satellite");
  });

  test("never overwrites a value the user already set", () => {
    const { plugin } = setup();
    plugin.start({ fleetFilterRadius: 999, enableBoatLabels: false });
    assert.equal(plugin.configuration.fleetFilterRadius, 999);
    assert.equal(plugin.configuration.enableBoatLabels, false);
  });
});

describe("plugin.stop()", () => {
  test("reports Stopped", () => {
    const { h, plugin } = setup();
    plugin.start({});
    plugin.stop();
    assert.equal(h.lastStatus(), "Stopped");
  });
});

describe("plugin.schema()", () => {
  test("builds a schema exposing every UI config key", () => {
    const { plugin } = setup();
    const schema = plugin.schema();
    assert.equal(schema.title, "Caveman Chartplotter");
    for (const key of UI_CONFIG_KEYS)
      assert.ok(schema.properties[key], `schema is missing ${key}`);
  });

  test("marks path checks present/absent from getSelfPath", () => {
    const { h, plugin } = setup();
    h.setSelfPath("navigation.position", { latitude: 1, longitude: 2 });
    const checks = plugin.schema().properties.pathChecks.properties;
    assert.ok(checks["navigation.position"].title.startsWith("✅"));
    assert.ok(checks["navigation.headingTrue"].title.startsWith("❌"));
  });
});

describe("plugin.registerWithRouter()", () => {
  test("registers the config and icon routes", () => {
    const { plugin } = setup();
    const registered = { get: [], post: [], put: [], delete: [] };
    const router = {
      get: (path) => registered.get.push(path),
      post: (path) => registered.post.push(path),
      put: (path) => registered.put.push(path),
      delete: (path) => registered.delete.push(path),
    };
    plugin.registerWithRouter(router);
    assert.deepEqual(registered.get.sort(), ["/icon", "/ui-config"]);
    assert.deepEqual(registered.post, ["/ui-config"]);
    assert.deepEqual(registered.put, ["/icon"]);
    assert.deepEqual(registered.delete, ["/icon"]);
  });
});

describe("plugin.savePluginOptions()", () => {
  test("saves the live configuration through the app", () => {
    const { h, plugin } = setup();
    plugin.start({ defaultBasemap: "Blank" });
    plugin.savePluginOptions();
    assert.equal(h.calls.savePluginOptions.length, 1);
    assert.equal(h.calls.savePluginOptions[0].defaultBasemap, "Blank");
  });

  test("routes a save failure to app.error", () => {
    const { h, plugin } = setup();
    h.app.savePluginOptions = (config, cb) => cb(new Error("disk full"));
    plugin.start({});
    plugin.savePluginOptions();
    assert.equal(h.calls.errors.length, 1);
  });
});
