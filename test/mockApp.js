import fs from "fs";
import os from "os";
import path from "path";

// A fake SignalK `app` for driving the plugin in tests. Every method the
// plugin touches is a recorder; assertions read back from `calls`. getSelfPath
// reads a settable map so tests can stage a GPS fix, design data, etc.
export function createMockApp(overrides = {}) {
  // Lazily-created per-app temp data dir, mirroring app.getDataDirPath() in the
  // real server. Only tests that touch it (e.g. the icon routes) pay for it;
  // they should call cleanupDataDir() when done.
  let dataDir = null;
  const getDataDirPath = () => {
    if (!dataDir)
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-"));
    return dataDir;
  };
  const calls = {
    status: [],
    pluginError: [],
    debug: [],
    errors: [],
    savePluginOptions: [],
  };
  const selfPaths = new Map();

  const app = {
    setPluginStatus: (s) => calls.status.push(s),
    setPluginError: (s) => calls.pluginError.push(s),
    debug: (...a) => calls.debug.push(a),
    error: (...a) => calls.errors.push(a),
    savePluginOptions: (config, cb) => {
      calls.savePluginOptions.push(config);
      if (typeof cb === "function")
        cb(null);
    },
    getSelfPath: (path) => selfPaths.get(path),
    getDataDirPath,
    ...overrides,
  };

  return {
    app,
    calls,
    setSelfPath: (path, value) => selfPaths.set(path, value),
    lastStatus: () => calls.status[calls.status.length - 1],
    // Path of the temp data dir (creating it if needed), and a cleanup for it.
    dataDir: getDataDirPath,
    cleanupDataDir: () => {
      if (dataDir)
        fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = null;
    },
    // Forget everything recorded so far — handy between phases of one test.
    reset: () => {
      for (const key of Object.keys(calls))
        calls[key].length = 0;
    },
  };
}
