import fs from "fs";
import os from "os";
import path from "path";

// Every temp dir handed out by getDataDirPath(), so none survive the run.
// Tests that want the dir gone mid-run still call cleanupDataDir(); this is
// the backstop for the ones that don't (and on some platforms os.tmpdir() is
// a RAM-backed tmpfs, so leaked dirs cost memory until reboot).
const tempDataDirs = new Set();
let exitHookInstalled = false;

function removeTempDataDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  tempDataDirs.delete(dir);
}

// A fake SignalK `app` for driving the plugin in tests. Every method the
// plugin touches is a recorder; assertions read back from `calls`. getSelfPath
// reads a settable map so tests can stage a GPS fix, design data, etc.
export function createMockApp(overrides = {}) {
  // Lazily-created per-app temp data dir, mirroring app.getDataDirPath() in the
  // real server. Only tests that touch it (e.g. the icon routes) pay for it;
  // whatever isn't cleaned up explicitly is swept on process exit.
  let dataDir = null;
  const getDataDirPath = () => {
    if (!dataDir) {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-"));
      tempDataDirs.add(dataDir);
      if (!exitHookInstalled) {
        exitHookInstalled = true;
        // exit handlers must be synchronous; rmSync is. One undeletable dir
        // must not strand the rest, so each removal stands alone — and a
        // failure here should never fail an otherwise green run.
        process.on("exit", () => {
          for (const dir of [...tempDataDirs]) {
            try {
              removeTempDataDir(dir);
            } catch {
              tempDataDirs.delete(dir);
            }
          }
        });
      }
    }
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
    // A server new enough for start()'s minimum-version gate; override with
    // `createMockApp({ config: { version: "2.30.0" } })` to test the refusal.
    config: { version: "2.31.0" },
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
        removeTempDataDir(dataDir);
      dataDir = null;
    },
    // Forget everything recorded so far — handy between phases of one test.
    reset: () => {
      for (const key of Object.keys(calls))
        calls[key].length = 0;
    },
  };
}
