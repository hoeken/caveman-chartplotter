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

import { ValidationError } from "./errors.js";

export const requiredPaths = [
  {
    path: "navigation.position",
    description: "Required - you need a GPS position of some sort to plot.",
  },
  {
    path: "navigation.headingTrue",
    description: "Optional - used for map-accurate heading. Provided by plugin derived-data",
  },
  {
    path: "design.beam",
    description:
      "Optional - used to display size-accurate icon. Edit Server -> Settings",
  },
  {
    path: "design.length",
    description:
      "Optional - used to display size-accurate icon. Edit Server -> Settings",
  },
  {
    path: "design.aisShipType",
    description:
      "Optional - used to choose the correct icon. Edit Server -> Settings",
  },
  {
    path: "sensors.gps.fromBow",
    description:
      "Optional - used to display size-accurate icon. GPS Antenna position. Edit Server -> Settings",
  },
  {
    path: "sensors.gps.fromCenter",
    description:
      "Optional - used to display size-accurate icon. GPS Antenna position. Edit Server -> Settings",
  },
];

// Per-user UI preference schema — the settings the web UI reads and writes
// through /ui-config. These live in per-identity JSON files under the plugin
// data dir (see ui-config.js), NOT in the plugin's saved options, so they are
// deliberately absent from buildSchema below. This fragment is the single
// source of truth for their types, enums, and defaults.
export const uiSchemaProperties = {
  defaultBasemap: {
    type: "string",
    title: "Default Basemap",
    description:
      "Which map layer to show on load; all remain switchable at runtime via the layer control. \"Blank\" draws no tiles — useful offline, on slow links, or when relying only on local charts.",
    default: "Satellite",
    enum: ["Blank", "OpenStreetMap", "Satellite"],
  },
  fleetFilterRadius: {
    type: "integer",
    title: "Fleet Filter Radius (m)",
    description:
      "Radius around own vessel to display other vessels and historical tracks.",
    default: 100000,
  },
  enableBoatLabels: {
    type: "boolean",
    title: "Show Boat Name Labels",
    description:
      "Show other vessels' names as labels on the map (only once zoomed in enough to be legible).",
    default: true,
  },
  enableOwnTrack: {
    type: "boolean",
    title: "Show My Boat Track",
    description:
      "Draw your own vessel's historical track on the map.",
    default: true,
  },
  enableOtherTracks: {
    type: "boolean",
    title: "Show Other Boat Tracks",
    description:
      "Draw other vessels' historical tracks on the map.",
    default: true,
  },
  enableRoutes: {
    type: "boolean",
    title: "Show Routes",
    description:
      "Draw routes from the SignalK resources API on the map (read-only). Requires a resources provider plugin serving /resources/routes.",
    default: true,
  },
  enableChartLayers: {
    type: "boolean",
    title: "Use Chart Layers if Available",
    description:
      "When local raster charts are available (via a charts plugin), enable them as map overlays by default. Turn off to keep them in the layer control but off until toggled on manually.",
    default: true,
  },
  enableSeascape: {
    type: "boolean",
    title: "Use Seascape Bathymetry",
    description:
      "Overlay the Seascape bathymetry (water depth) chart on top of the base map by default. Needs an internet connection and a WebGL-capable browser; where either is missing the base map shows unchanged. Also toggleable at runtime in the layer control.",
    default: false,
  },
  enableLargeControls: {
    type: "boolean",
    title: "Use Large UI Controls",
    description:
      "Draw the map control buttons (zoom, home, settings, theme, layers) at 1.5x size for easier touch targets. Turn off for the original smaller sizing.",
    default: true,
  },
  courseVectorMinutes: {
    type: "integer",
    title: "Course Vector Time (minutes)",
    description:
      "Draw a COG/SOG course vector (predictor line) from each vessel's bow, this many minutes of travel long. Set to 0 (None) to turn it off.",
    enum: [0, 5, 10, 15, 30, 60],
    default: 15,
  },
  enableLookAhead: {
    type: "boolean",
    title: "Look Ahead in Follow Mode",
    description:
      "While following your boat (the home button), bias the view toward the water ahead based on your speed and course, instead of centering exactly on the boat.",
    default: true,
  },
};

export function buildSchema(app) {
  const schemaData = {
    title: "Caveman Chartplotter",
    type: "object",
    description:
      "Display preferences (basemap, tracks, routes, course vector, …) are per-user and set from the web app's settings dialog, not here.",
    properties: {
      pathChecks: {
        title: "Path Checks",
        type: "object",
        properties: {},
      },
    },
  };

  const pathChecks = {};
  for (const myPath of requiredPaths) {
    pathChecks[myPath.path] = {
      title: `${app.getSelfPath(myPath.path) ? "✅" : "❌"} ${myPath.path}`,
      description: app.getSelfPath(myPath.path) ? "" : myPath.description,
      type: "null",
      readOnly: true,
      default: null,
    };
  }
  schemaData.properties.pathChecks.properties = pathChecks;

  return schemaData;
}

// The keys the web UI is allowed to read and write through /ui-config —
// exactly the per-user preferences above.
export const UI_CONFIG_KEYS = Object.keys(uiSchemaProperties);

// Fresh copy of the per-user preference defaults (the base layer every
// /ui-config resolution starts from).
export function defaultUiConfig() {
  const out = {};
  for (const [key, prop] of Object.entries(uiSchemaProperties))
    out[key] = prop.default;
  return out;
}

// Project the UI-relevant subset out of a config object — only whitelisted
// keys that actually carry a value, so the result can be spread as an overlay
// without undefineds clobbering lower layers.
export function pickUiConfig(config = {}) {
  const out = {};
  for (const key of UI_CONFIG_KEYS) {
    if (config[key] !== undefined)
      out[key] = config[key];
  }
  return out;
}

// Coerce/validate one value against its JSON Schema property. Mirrors how
// SignalK's admin form treats the same schema. Throws ValidationError (→ 403)
// on anything that doesn't fit.
//
// Type coercion happens before the enum check so an integer enum accepts the
// string form a value takes coming from an HTML <select> (e.g. "15" → 15 → is
// 15 one of the allowed values?), not just the already-numeric admin form.
function coerceToSchema(key, prop, value) {
  if (!prop)
    throw new ValidationError(`unknown config field: ${key}`);

  let coerced;
  switch (prop.type) {
    case "string":
      if (typeof value !== "string")
        throw new ValidationError(`${key} must be a string`);
      coerced = value;
      break;
    case "integer":
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n))
        throw new ValidationError(`${key} must be a number`);
      coerced = prop.type === "integer" ? Math.round(n) : n;
      break;
    }
    case "boolean":
      coerced = Boolean(value);
      break;
    default:
      throw new ValidationError(`unsupported schema type for ${key}`);
  }

  if (Array.isArray(prop.enum) && !prop.enum.includes(coerced))
    throw new ValidationError(`${key} must be one of: ${prop.enum.join(", ")}`);

  return coerced;
}

// Validate an incoming /ui-config POST body against the UI preference
// schema, returning the coerced updates — only whitelisted keys that were
// present.
export function coerceUiConfig(body = {}) {
  const updates = {};
  for (const key of UI_CONFIG_KEYS) {
    if (body[key] === undefined)
      continue;
    updates[key] = coerceToSchema(key, uiSchemaProperties[key], body[key]);
  }
  return updates;
}
