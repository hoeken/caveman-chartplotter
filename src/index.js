/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import semver from "semver";
import { buildSchema } from "./schema.js";
import { UiConfigStore } from "./ui-config.js";
import { register as registerHttpRoutes } from "./http-routes.js";

// Oldest Signal K server this plugin supports. Older servers can't resolve
// explicit paths under a wildcard context (so the fleet would render as
// nameless, default-shaped hulls) and have no per-route access levels (so
// every API route would be admin-only), and they'd fail in confusing ways
// rather than obviously. The "-0" floor admits the 2.31.0 betas, which sort
// below 2.31.0 and would otherwise be turned away.
const MIN_SERVER_VERSION = ">=2.31.0-0";

export default function (app) {
  const plugin = {};

  plugin.id = "caveman-chartplotter";
  plugin.name = "Caveman Chartplotter";
  plugin.description = "A simple, lightweight chart plotter that runs anywhere — even on the older embedded browsers found in Navico MFDs.";

  plugin.configuration = undefined;
  plugin.uiConfigStore = new UiConfigStore(app);

  plugin.start = function (props) {
    // Bail out before touching anything else, so an unsupported server gets
    // one clear error instead of a UI that half-works.
    const serverVersion = app.config?.version;
    if (!semver.satisfies(serverVersion, MIN_SERVER_VERSION, { includePrerelease: true })) {
      plugin.started = false;
      const message = `Requires signalk-server ${MIN_SERVER_VERSION}, running ${serverVersion}`;
      app.error(message);
      app.setPluginError(message);
      return;
    }

    plugin.started = true;
    plugin.configuration = props || {};
    // v1.5 upgrade: UI preferences move out of the plugin config into
    // per-identity storage; any legacy keys become the boat-wide baseline.
    if (plugin.uiConfigStore.migrateFromPluginConfig(plugin.configuration)) {
      app.debug("migrated legacy UI preferences to per-identity storage");
      plugin.savePluginOptions();
    }
    app.setPluginStatus("Started");
  };

  plugin.stop = function () {
    // A start refused on the server version touched nothing, so there is
    // nothing to tear down — and overwriting its error with "Stopped" would
    // hide why the plugin isn't running. Clearing `started` also makes a
    // second stop a no-op.
    if (!plugin.started)
      return;

    app.setPluginStatus("Stopped");
    plugin.started = false;
  };

  plugin.schema = function () {
    return buildSchema(app);
  };

  plugin.registerWithRouter = function (router) {
    registerHttpRoutes(app, plugin, router);
  };

  plugin.savePluginOptions = function () {
    app.savePluginOptions(plugin.configuration, (err) => {
      if (err) {
        app.error(err);
      }
    });
  };

  return plugin;
}
