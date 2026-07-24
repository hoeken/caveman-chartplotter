import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { register } from "../src/http-routes.js";
import { UiConfigStore } from "../src/ui-config.js";
import { createMockApp } from "./mockApp.js";

// Router stub that captures handlers by method + path so tests can invoke them.
function fakeRouter() {
  const handlers = { post: {}, get: {}, put: {}, delete: {} };
  return {
    handlers,
    post: (path, fn) => {
      handlers.post[path] = fn;
    },
    get: (path, fn) => {
      handlers.get[path] = fn;
    },
    put: (path, fn) => {
      handlers.put[path] = fn;
    },
    delete: (path, fn) => {
      handlers.delete[path] = fn;
    },
  };
}

// Minimal Express-style response recorder. `set` records headers; `send`
// captures a non-JSON body (used by GET /icon to return raw image bytes).
function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    sent: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    },
  };
}

// 1x1 PNG (magic bytes 89 50 4E 47 …) — enough for sniffIconType to accept.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

describe("http-routes register()", () => {
  let harness;
  let app;
  let router;
  let plugin;

  beforeEach(() => {
    harness = createMockApp();
    app = harness.app;
    router = fakeRouter();
    plugin = {
      configuration: {},
      saveCount: 0,
      savePluginOptions() {
        this.saveCount++;
      },
      uiConfigStore: new UiConfigStore(app),
    };
  });

  afterEach(() => {
    harness.cleanupDataDir();
  });

  function wire() {
    register(app, plugin, router);
  }

  test("exposes the OpenAPI document via plugin.getOpenApi", () => {
    wire();
    assert.equal(typeof plugin.getOpenApi, "function");
    assert.ok(plugin.getOpenApi());
  });

  describe("GET /ui-config", () => {
    // Requests carry identity the way SignalK's security middleware provides
    // it: a principal whose identifier is the username / device clientId.
    const asUser = (identifier) => ({ skPrincipal: { identifier } });

    test("an anonymous request gets the full default preference set", () => {
      wire();
      const res = fakeRes();
      router.handlers.get["/ui-config"]({}, res);
      assert.equal(res.body.defaultBasemap, "Satellite");
      assert.equal(res.body.enableRoutes, true);
      assert.equal("somethingInternal" in res.body, false);
    });

    test("resolves preferences per identity", () => {
      plugin.uiConfigStore.save("bob", { defaultBasemap: "Blank" });
      wire();

      const bob = fakeRes();
      router.handlers.get["/ui-config"](asUser("bob"), bob);
      assert.equal(bob.body.defaultBasemap, "Blank");

      const alice = fakeRes();
      router.handlers.get["/ui-config"](asUser("alice"), alice);
      assert.equal(alice.body.defaultBasemap, "Satellite");
    });

    test("tolerates a missing configuration", () => {
      plugin.configuration = undefined;
      wire();
      const res = fakeRes();
      assert.doesNotThrow(() => router.handlers.get["/ui-config"]({}, res));
      assert.equal(res.statusCode, 200);
    });
  });

  describe("POST /ui-config", () => {
    const asUser = (identifier, body) => ({
      skPrincipal: { identifier },
      body,
    });

    test("coerces, saves to the identity's store, and echoes updates", () => {
      wire();
      const res = fakeRes();
      router.handlers.post["/ui-config"](
        asUser("bob", { defaultBasemap: "OpenStreetMap", fleetFilterRadius: "250" }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.config, {
        defaultBasemap: "OpenStreetMap",
        fleetFilterRadius: 250,
      });
      assert.equal(
        plugin.uiConfigStore.resolve("bob").fleetFilterRadius,
        250,
      );
      // Preferences no longer touch the plugin config.
      assert.equal(plugin.configuration.defaultBasemap, undefined);
      assert.equal(plugin.saveCount, 0);
    });

    test("a save only affects the posting identity", () => {
      wire();
      router.handlers.post["/ui-config"](
        asUser("bob", { enableBoatLabels: false }),
        fakeRes(),
      );
      assert.equal(plugin.uiConfigStore.resolve("bob").enableBoatLabels, false);
      assert.equal(plugin.uiConfigStore.resolve("alice").enableBoatLabels, true);
    });

    test("an anonymous save (security disabled) lands in the shared bucket", () => {
      wire();
      router.handlers.post["/ui-config"](
        { body: { enableLookAhead: false } },
        fakeRes(),
      );
      assert.equal(plugin.uiConfigStore.resolve(null).enableLookAhead, false);

      const res = fakeRes();
      router.handlers.get["/ui-config"]({}, res);
      assert.equal(res.body.enableLookAhead, false);
    });

    test("rejects an invalid value with 403 and stores nothing", () => {
      wire();
      const res = fakeRes();
      router.handlers.post["/ui-config"](
        asUser("bob", { defaultBasemap: "CARRIER_PIGEON" }),
        res,
      );
      assert.equal(res.statusCode, 403);
      assert.equal(
        fs.existsSync(path.join(harness.dataDir(), "ui-config")),
        false,
      );
    });

    test("an unexpected error maps to 500 FAILED", () => {
      plugin.uiConfigStore.save = () => {
        throw new Error("boom");
      };
      wire();
      const res = fakeRes();
      router.handlers.post["/ui-config"](
        { body: { enableBoatLabels: false } },
        res,
      );
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.state, "FAILED");
    });

    test("reports hasCustomIcon=false when no icon file exists", () => {
      wire();
      const res = fakeRes();
      router.handlers.get["/ui-config"]({}, res);
      assert.equal(res.body.hasCustomIcon, false);
    });
  });

  describe("POST /ui-config/charts", () => {
    const asUser = (identifier, body) => ({
      skPrincipal: { identifier },
      body,
    });

    test("saves one chart's choice for the posting identity only", () => {
      wire();
      const res = fakeRes();
      router.handlers.post["/ui-config/charts"](
        asUser("bob", { identifier: "Fiji_Nanuku-Passage", enabled: false }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { statusCode: 200, state: "COMPLETED" });
      assert.deepEqual(plugin.uiConfigStore.resolve("bob").charts, {
        "Fiji_Nanuku-Passage": false,
      });
      assert.deepEqual(plugin.uiConfigStore.resolve("alice").charts, {});
    });

    test("a second chart merges instead of clobbering the first", () => {
      wire();
      router.handlers.post["/ui-config/charts"](
        asUser("bob", { identifier: "chart-a", enabled: false }),
        fakeRes(),
      );
      router.handlers.post["/ui-config/charts"](
        asUser("bob", { identifier: "chart-b", enabled: true }),
        fakeRes(),
      );
      assert.deepEqual(plugin.uiConfigStore.resolve("bob").charts, {
        "chart-a": false,
        "chart-b": true,
      });
    });

    test("the saved map rides along on GET /ui-config", () => {
      wire();
      router.handlers.post["/ui-config/charts"](
        asUser("bob", { identifier: "chart-a", enabled: false }),
        fakeRes(),
      );
      const res = fakeRes();
      router.handlers.get["/ui-config"](
        { skPrincipal: { identifier: "bob" } },
        res,
      );
      assert.deepEqual(res.body.charts, { "chart-a": false });
    });

    test("an anonymous save (security disabled) lands in the shared bucket", () => {
      wire();
      router.handlers.post["/ui-config/charts"](
        { body: { identifier: "chart-a", enabled: false } },
        fakeRes(),
      );
      assert.deepEqual(plugin.uiConfigStore.resolve(null).charts, {
        "chart-a": false,
      });
    });

    test("rejects a missing or empty identifier with 403 and stores nothing", () => {
      wire();
      for (const body of [{}, { identifier: "", enabled: true }, { identifier: 7, enabled: true }, undefined]) {
        const res = fakeRes();
        router.handlers.post["/ui-config/charts"]({ body }, res);
        assert.equal(res.statusCode, 403);
      }
      assert.equal(
        fs.existsSync(path.join(harness.dataDir(), "ui-config")),
        false,
      );
    });

    test("rejects a non-boolean enabled with 403", () => {
      wire();
      const res = fakeRes();
      router.handlers.post["/ui-config/charts"](
        asUser("bob", { identifier: "chart-a", enabled: "yes" }),
        res,
      );
      assert.equal(res.statusCode, 403);
      assert.deepEqual(plugin.uiConfigStore.resolve("bob").charts, {});
    });
  });

  describe("boat icon /icon", () => {
    // The PUT/GET/DELETE handlers do file I/O against harness.dataDir().
    // readBodyBytes accepts a pre-buffered Buffer as req.body, so tests pass
    // bytes directly without faking a request stream.
    function putIcon(body, headers = {}) {
      const res = fakeRes();
      // The PUT handler is async (reads the body via a promise); return the
      // promise so tests can await it.
      const ret = router.handlers.put["/icon"]({ body, headers }, res);
      return Promise.resolve(ret).then(() => res);
    }

    test("PUT stores a valid PNG and flips hasCustomIcon", async () => {
      wire();
      const putRes = await putIcon(PNG_BYTES);
      assert.equal(putRes.statusCode, 200);
      assert.equal(putRes.body.state, "COMPLETED");

      const stored = fs
        .readdirSync(harness.dataDir())
        .filter((f) => f.startsWith("boat-icon."));
      assert.deepEqual(stored, ["boat-icon.png"]);

      const cfgRes = fakeRes();
      router.handlers.get["/ui-config"]({}, cfgRes);
      assert.equal(cfgRes.body.hasCustomIcon, true);
    });

    test("GET serves the stored bytes with the right content-type", async () => {
      wire();
      await putIcon(PNG_BYTES);

      const res = fakeRes();
      router.handlers.get["/icon"]({}, res);
      assert.equal(res.headers["Content-Type"], "image/png");
      assert.ok(Buffer.isBuffer(res.sent));
      assert.ok(res.sent.equals(PNG_BYTES));
    });

    test("GET returns 404 when no icon is set", () => {
      wire();
      const res = fakeRes();
      router.handlers.get["/icon"]({}, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.state, "FAILED");
    });

    test("PUT rejects an oversized image with 413 and stores nothing", async () => {
      wire();
      const big = Buffer.concat([PNG_BYTES, Buffer.alloc(500 * 1024)]);
      const res = await putIcon(big);
      assert.equal(res.statusCode, 413);
      assert.equal(
        fs.existsSync(path.join(harness.dataDir(), "boat-icon.png")),
        false,
      );
    });

    test("PUT rejects an oversized streamed body with 413 without destroying the request", async () => {
      wire();
      // The browser streams the body (no pre-buffered req.body), so fake a
      // request stream. The handler must drain it to a clean 413 rather than
      // calling req.destroy(), which would surface as "Failed to fetch".
      const req = new EventEmitter();
      req.headers = {};
      req.destroy = () => {
        req.destroyed = true;
      };
      const res = fakeRes();
      router.handlers.put["/icon"](req, res);
      // Emit more than the cap across two chunks, then end the stream.
      req.emit("data", PNG_BYTES);
      req.emit("data", Buffer.alloc(500 * 1024));
      req.emit("end");
      // Let the handler's promise chain settle (drain → reject → 413 response).
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(res.statusCode, 413);
      assert.notEqual(req.destroyed, true);
      assert.equal(
        fs.existsSync(path.join(harness.dataDir(), "boat-icon.png")),
        false,
      );
    });

    test("PUT rejects a non-image body with 415", async () => {
      wire();
      const res = await putIcon(Buffer.from("not an image at all"));
      assert.equal(res.statusCode, 415);
    });

    test("PUT rejects an empty body with 400", async () => {
      wire();
      const res = await putIcon(Buffer.alloc(0));
      assert.equal(res.statusCode, 400);
    });

    test("PUT replaces an existing icon of a different type", async () => {
      wire();
      const gif = Buffer.from("GIF89a", "latin1");
      await putIcon(gif);
      await putIcon(PNG_BYTES);
      const stored = fs
        .readdirSync(harness.dataDir())
        .filter((f) => f.startsWith("boat-icon."));
      assert.deepEqual(stored, ["boat-icon.png"]);
    });

    test("DELETE removes the icon and is idempotent", async () => {
      wire();
      await putIcon(PNG_BYTES);

      const del1 = fakeRes();
      router.handlers.delete["/icon"]({}, del1);
      assert.equal(del1.statusCode, 200);
      assert.equal(
        fs.existsSync(path.join(harness.dataDir(), "boat-icon.png")),
        false,
      );

      // A second delete with nothing to remove still succeeds.
      const del2 = fakeRes();
      router.handlers.delete["/icon"]({}, del2);
      assert.equal(del2.statusCode, 200);

      const cfgRes = fakeRes();
      router.handlers.get["/ui-config"]({}, cfgRes);
      assert.equal(cfgRes.body.hasCustomIcon, false);
    });
  });
});
