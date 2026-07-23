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

import { buildSchema } from "./schema.js";
import { UiConfigStore } from "./ui-config.js";
import { register as registerHttpRoutes } from "./http-routes.js";

export default function (app) {
  const plugin = {};

  plugin.id = "caveman-chartplotter";
  plugin.name = "Caveman Chartplotter";
  plugin.description = "A simple, lightweight chart plotter that runs anywhere — even on the older embedded browsers found in Navico MFDs.";

  plugin.configuration = undefined;
  plugin.uiConfigStore = new UiConfigStore(app);

  plugin.start = function (props) {
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
    app.setPluginStatus("Stopped");
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
