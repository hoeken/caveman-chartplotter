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
  test("reports Started", () => {
    const { h, plugin } = setup();
    plugin.start({});
    assert.equal(h.lastStatus(), "Started");
  });

  test("migrates legacy UI keys out of the plugin config and persists the upgrade", () => {
    const { h, plugin } = setup();
    plugin.start({ defaultBasemap: "OpenStreetMap" });
    // The legacy key becomes the boat-wide baseline in the preference store…
    assert.equal(
      plugin.uiConfigStore.resolve(null).defaultBasemap,
      "OpenStreetMap",
    );
    // …and is stripped from the saved plugin config.
    assert.equal(plugin.configuration.defaultBasemap, undefined);
    assert.equal(h.calls.savePluginOptions.length, 1);
    h.cleanupDataDir();
  });

  test("does not persist when there is nothing to migrate", () => {
    const { h, plugin } = setup();
    plugin.start({});
    assert.equal(h.calls.savePluginOptions.length, 0);
  });

  test("tolerates being started with no props at all", () => {
    const { plugin } = setup();
    assert.doesNotThrow(() => plugin.start(undefined));
    assert.deepEqual(plugin.configuration, {});
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
  test("no longer exposes the per-user UI preference keys", () => {
    const { plugin } = setup();
    const schema = plugin.schema();
    assert.equal(schema.title, "Caveman Chartplotter");
    for (const key of UI_CONFIG_KEYS)
      assert.equal(key in schema.properties, false, `${key} should be out of the plugin schema`);
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
    plugin.start({});
    plugin.savePluginOptions();
    assert.equal(h.calls.savePluginOptions.length, 1);
    assert.deepEqual(h.calls.savePluginOptions[0], {});
  });

  test("routes a save failure to app.error", () => {
    const { h, plugin } = setup();
    h.app.savePluginOptions = (config, cb) => cb(new Error("disk full"));
    plugin.start({});
    plugin.savePluginOptions();
    assert.equal(h.calls.errors.length, 1);
  });
});
