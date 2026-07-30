// AppState is our single source of truth for the current state of the application.

import { SignalKHelper } from "./SignalKHelper.js";
import { BoatConfig } from "./BoatConfig.js";
import { radiansToDegrees } from "@turf/turf";

const DEFAULT_FRESHNESS_SEC = 300;

const DELTA_FAST_SPEED = 250;

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
            path: "navigation.courseOverGroundTrue",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            path: "navigation.speedOverGround",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            // v2 Course API: the route currently being navigated (or null when
            // course is cleared). Gates which routes RoutesLayer draws.
            path: "navigation.course.activeRoute",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            // v2 Course API: the point currently being steered to — set both
            // while following a route and while navigating to a lone waypoint.
            // Drives the bow → next-point leg (FleetLayer.updateNextPointLine).
            path: "navigation.course.nextPoint",
            period: DELTA_FAST_SPEED,
            format: "full",
            policy: "fixed",
            sendMeta: "all",
          },
          {
            // Loaded only to gate the next-point leg: B&G plotters don't clear
            // nextPoint when a route is stopped, but they do clear
            // previousPoint — so the leg is drawn only while this is non-null.
            path: "navigation.course.previousPoint",
            period: DELTA_FAST_SPEED,
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

  // Pull one path's envelope out of a snapshot tree, merged against the
  // envelope we already hold. The websocket opens before the /vessels
  // snapshot resolves, so deltas may already carry a fresher value than the
  // snapshot — the newer envelope wins (see _newest), and a missing or stale
  // snapshot value keeps the current one.
  extract(tree, path, current, fresh = true, maxAge = DEFAULT_FRESHNESS_SEC) {
    let data = SignalKHelper.extract(tree, path);

    if (!data)
      return current ?? null;

    // check for freshness.
    if (fresh && !SignalKHelper.isFresh(data, maxAge)) {
      const ageSec = data.timestamp
        ? Math.round((Date.now() - new Date(data.timestamp).getTime()) / 1000)
        : "unknown";
      const msg = `Stale SignalK value: ${path || "(root)"} — Age ${ageSec}s, Max ${maxAge}s`;
      SignalKHelper.errorHandler?.(msg);
      console.warn(msg);
      console.trace();
      return current ?? null;
    }

    return this._newest(data, current);
  }

  // Keep whichever envelope is newer so the snapshot can't roll a live value
  // backwards. When the delta envelope wins but arrived without meta, graft
  // the snapshot's meta on so displayUnits still land.
  _newest(extracted, current) {
    if (!current?.timestamp || !extracted.timestamp)
      return extracted;
    if (Date.parse(extracted.timestamp) >= Date.parse(current.timestamp))
      return extracted;
    if (extracted.meta && !current.meta)
      current.meta = extracted.meta;
    return current;
  }

  extractAll(data) {
    this.boatConfig = BoatConfig.extract(data);

    this.currentCoordinates =
      this.extract(data, "navigation.position", this.currentCoordinates);
    this.heading = this.extract(data, "navigation.headingTrue", this.heading);
    // COG is kept as a heading fallback for boats with no heading sensor, and,
    // with SOG below, drives our own course vector (see FleetLayer).
    this.cog = this.extract(data, "navigation.courseOverGroundTrue", this.cog);
    this.sog = this.extract(data, "navigation.speedOverGround", this.sog);
    // Neither course path is freshness-checked: a course set hours ago is
    // still the course — its validity isn't time-based like a sensor
    // reading's.
    this.activeRoute = this.extract(
      data,
      "navigation.course.activeRoute",
      this.activeRoute,
      false,
    );
    this.nextPoint = this.extract(
      data,
      "navigation.course.nextPoint",
      this.nextPoint,
      false,
    );
    this.previousPoint = this.extract(
      data,
      "navigation.course.previousPoint",
      this.previousPoint,
      false,
    );
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
    else if (path == "navigation.courseOverGroundTrue")
      this.cog = apply(this.cog);
    else if (path == "navigation.speedOverGround")
      this.sog = apply(this.sog);
    else if (path == "navigation.course.activeRoute")
      this.activeRoute = apply(this.activeRoute);
    else if (path == "navigation.course.nextPoint")
      this.nextPoint = apply(this.nextPoint);
    else if (path == "navigation.course.previousPoint")
      this.previousPoint = apply(this.previousPoint);
    // else if (!path.startsWith("notifications"))
    //   console.log(`[websocket] Ignoring: ${path}`);
  }

  calculate() {
    if (this.boatConfig)
      this.boatConfig.heading = this.computeOwnHeading();
  }

  // Heading priority:
  // SignalK headingTrue
  // COG
  // 0
  computeOwnHeading() {
    if (this.heading)
      return radiansToDegrees(this.heading.value);

    if (this.cog)
      return radiansToDegrees(this.cog.value);

    return 0;
  }
}
