// Tests for AppState.getHeading(), the read-time own-vessel heading accessor.
//
// Unlike computeOwnHeading (which feeds boatConfig and only checks for the
// envelope's existence), every source here is gated on freshness so a compass
// or GPS feed that has gone silent can't freeze the boat icon at whatever it
// last reported.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AppState } from "../ui/js/AppState.js";

const now = () => new Date().toISOString();
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

// Signal K carries angles in radians; the accessor returns degrees.
const RAD_90 = Math.PI / 2;
const RAD_180 = Math.PI;

describe("AppState.getHeading()", () => {
  test("prefers a fresh headingTrue", () => {
    const state = new AppState();
    state.heading = { value: RAD_90, timestamp: now() };
    state.cog = { value: RAD_180, timestamp: now() };

    assert.equal(Math.round(state.getHeading()), 90);
  });

  test("falls back to COG when the compass has gone stale", () => {
    const state = new AppState();
    state.heading = { value: RAD_90, timestamp: ago(3600) };
    state.cog = { value: RAD_180, timestamp: now() };

    assert.equal(Math.round(state.getHeading()), 180);
  });

  test("falls back to 0 when every source is stale", () => {
    const state = new AppState();
    state.heading = { value: RAD_90, timestamp: ago(3600) };
    state.cog = { value: RAD_180, timestamp: ago(3600) };

    assert.equal(state.getHeading(), 0);
  });

  test("falls back to 0 with nothing to go on", () => {
    assert.equal(new AppState().getHeading(), 0);
  });

  test("an envelope with no timestamp is not trusted as fresh", () => {
    const state = new AppState();
    state.heading = { value: RAD_90 };
    state.cog = { value: RAD_180, timestamp: now() };

    assert.equal(Math.round(state.getHeading()), 180);
  });
});
