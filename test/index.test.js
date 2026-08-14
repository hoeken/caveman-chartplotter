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

  test("refuses to start on a server older than the minimum", () => {
    const h = createMockApp({ config: { version: "2.30.0" } });
    const plugin = createPlugin(h.app);
    plugin.start({});

    assert.equal(plugin.started, false);
    assert.equal(h.calls.pluginError.length, 1);
    assert.match(
      h.calls.pluginError[0],
      /Requires signalk-server >=2\.31\.0-0, running 2\.30\.0/,
    );
    assert.equal(h.calls.errors.length, 1);
    // Nothing else ran: no status, no config, no migration.
    assert.equal(h.calls.status.length, 0);
    assert.equal(plugin.configuration, undefined);
  });

  test("refuses to start when the server version is unreadable", () => {
    const h = createMockApp({ config: {} });
    const plugin = createPlugin(h.app);
    plugin.start({});

    assert.equal(plugin.started, false);
    assert.equal(h.calls.pluginError.length, 1);
    assert.equal(h.calls.status.length, 0);
  });

  test("starts on a supported server, including its prereleases", () => {
    for (const version of ["2.31.0", "2.42.1", "2.31.0-beta.2", "2.32.0-beta.1"]) {
      const h = createMockApp({ config: { version } });
      const plugin = createPlugin(h.app);
      plugin.start({});

      assert.equal(plugin.started, true, version);
      assert.equal(h.calls.pluginError.length, 0, version);
      assert.equal(h.calls.status[0], "Started", version);
    }
  });
});

describe("plugin.stop()", () => {
  test("reports Stopped", () => {
    const { h, plugin } = setup();
    plugin.start({});
    plugin.stop();
    assert.equal(h.lastStatus(), "Stopped");
  });

  test("leaves a refused start's error in place", () => {
    const h = createMockApp({ config: { version: "2.30.0" } });
    const plugin = createPlugin(h.app);
    plugin.start({});
    plugin.stop();

    assert.equal(h.calls.status.length, 0);
  });

  test("is idempotent — a second stop is a no-op", () => {
    const { h, plugin } = setup();
    plugin.start({});
    plugin.stop();
    h.reset();
    plugin.stop();

    assert.equal(h.calls.status.length, 0);
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
    assert.deepEqual(registered.post.sort(), ["/ui-config", "/ui-config/charts"]);
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
