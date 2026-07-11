// AppState is our single source of truth for the current state of the application.

import { SignalKHelper } from "./SignalKHelper.js";
import { BoatConfig } from "./BoatConfig.js";
import { radiansToDegrees } from "@turf/turf";

const DEFAULT_FRESHNESS_SEC = 300;

const DELTA_FAST_SPEED = 250;
const DELTA_SLOW_SPEED = 1000;

export class AppState {
  websocketSubscribe(client) {
    client.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          {
            path: "navigation.position",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            path: "navigation.headingTrue",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            path: "environment.wind.directionTrue",
            period: DELTA_SLOW_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
        ],
      },
    );
  }

  // Fleet discovery + live motion for every *other* vessel, keyed by each
  // message's `context`. This shared vessels.* subscription only carries the
  // dynamic nav paths that place a boat on the map; it deliberately omits the
  // static identity/geometry paths because SignalK won't deliver `name` except
  // under a `*` path, and there's no "other vessels" context to target one at.
  // FleetLayer instead subscribes to each newly-sighted vessel's own context
  // with a `*` path (FleetLayer.subscribeVessel) so its name/type/dimensions
  // stream in as the (infrequent) AIS static reports arrive.
  websocketSubscribeFleet(client) {
    client.subscribe({
      context: "vessels.*",
      subscribe: [
        { path: "navigation.position", policy: "instant" },
        { path: "navigation.headingTrue", policy: "instant" },
        { path: "navigation.courseOverGroundTrue", policy: "instant" },
        { path: "navigation.speedOverGround", policy: "instant" },
      ],
    });
  }

  getPosition() {
    if (this.currentCoordinates)
      return L.latLng(
        this.currentCoordinates.value.latitude,
        this.currentCoordinates.value.longitude,
      );
    else
      return L.latLng(0, 0);
  }

  extract(tree, path, fresh = true, maxAge = DEFAULT_FRESHNESS_SEC) {
    let data = SignalKHelper.extract(tree, path);

    if (!data)
      return null;

    // check for freshness.
    if (fresh && !SignalKHelper.isFresh(data, maxAge)) {
      const ageSec = data.timestamp
        ? Math.round((Date.now() - new Date(data.timestamp).getTime()) / 1000)
        : "unknown";
      const msg = `Stale SignalK value: ${path || "(root)"} — Age ${ageSec}s, Max ${maxAge}s`;
      SignalKHelper.errorHandler?.(msg);
      console.warn(msg);
      console.trace();
      return null;
    }

    return data;
  }

  extractAll(data) {
    this.boatConfig = BoatConfig.extract(data);

    this.currentCoordinates = this.extract(data, "navigation.position");
    this.heading = this.extract(data, "navigation.headingTrue") ?? this.heading;
    // TWA is kept solely as a heading fallback: an anchored or drifting boat
    // with no heading sensor tends to point into the wind.
    this.twa = this.extract(data, "environment.wind.directionTrue") ?? this.twa;
  }

  handleDelta(timestamp, delta) {
    const path = delta.path;

    // Mutate the existing envelope so meta/$source/pgn/values populated by
    // extractAll survive delta updates. Only create a new envelope the first
    // time we see a path.
    const apply = (current) => {
      if (current) {
        current.value = delta.value;
        current.timestamp = timestamp;
        if (delta.meta)
          current.meta = delta.meta;
        return current;
      }
      return { value: delta.value, timestamp };
    };

    if (path == "navigation.position")
      this.currentCoordinates = apply(this.currentCoordinates);
    else if (path == "navigation.headingTrue")
      this.heading = apply(this.heading);
    else if (path == "environment.wind.directionTrue")
      this.twa = apply(this.twa);
    // else if (!path.startsWith("notifications"))
    //   console.log(`[websocket] Ignoring: ${path}`);
  }

  calculate() {
    if (this.boatConfig)
      this.boatConfig.heading = this.computeOwnHeading();
  }

  // Heading priority:
  // SignalK headingTrue
  // last-known TWA
  // 0
  computeOwnHeading() {
    if (this.heading)
      return radiansToDegrees(this.heading.value);

    if (this.twa)
      return radiansToDegrees(this.twa.value);

    return 0;
  }
}
