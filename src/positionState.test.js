// src/positionState.test.js
//
// Net-new tests (no matching tests/test_position_state.py exists in the
// Python suite) for the positionState.js port. Every test uses a temp
// state-file path via the exported functions' optional `stateFile`
// parameter so nothing touches the real data/positions_state.json.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as ps from "./positionState.js";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-posstate-test-"));
  try {
    fn(dir, path.join(dir, "positions_state.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("load/save round trip", () => {
  test("loadState returns a fresh empty state when the file is absent", () => {
    withTempDir((dir, file) => {
      const state = ps.loadState(file);
      assert.equal(state.day_open_equity, null);
      assert.deepEqual(state.positions, {});
      assert.equal(state.streak_throttle_active, false);
    });
  });

  test("loadState returns a fresh empty state on corrupt JSON", () => {
    withTempDir((dir, file) => {
      writeFileSync(file, "{ not valid json", "utf-8");
      const state = ps.loadState(file);
      assert.deepEqual(state.positions, {});
    });
  });

  test("save then load round-trips exactly", () => {
    withTempDir((dir, file) => {
      const state = ps.loadState(file);
      ps.initPosition(state, "BTC/USD", 50000);
      ps.saveState(state, file);
      const reloaded = ps.loadState(file);
      assert.equal(reloaded.positions["BTC/USD"].entry_price, 50000);
    });
  });

  test("saveState backfills missing top-level keys on load (forward-compat)", () => {
    withTempDir((dir, file) => {
      writeFileSync(file, JSON.stringify({ positions: { "ETH/USD": {} } }), "utf-8");
      const state = ps.loadState(file);
      assert.equal(state.streak_throttle_active, false);
      assert.equal(state.capital_preservation_mode, false);
      // per-position keys also backfilled on access via getPosition
      const pos = ps.getPosition(state, "ETH/USD");
      assert.equal(pos.stop_order_cycles, 0);
      assert.equal(pos.pyramid_tranches, 0);
    });
  });

  test("saveState replaces an existing destination file wholesale, not merged", () => {
    withTempDir((dir, file) => {
      const first = ps.loadState(file);
      ps.initPosition(first, "BTC/USD", 100);
      ps.saveState(first, file);

      const second = ps.loadState(file);
      ps.clearPosition(second, "BTC/USD");
      ps.initPosition(second, "ETH/USD", 3000);
      ps.saveState(second, file);

      const final = ps.loadState(file);
      assert.ok(!("BTC/USD" in final.positions), "old destination content must be fully replaced");
      assert.equal(final.positions["ETH/USD"].entry_price, 3000);
    });
  });

  test("no leftover temp files after a successful save", () => {
    withTempDir((dir, file) => {
      const state = ps.loadState(file);
      ps.saveState(state, file);
      const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
      assert.deepEqual(leftovers, []);
    });
  });

  test("temp file is cleaned up if the write fails", () => {
    withTempDir((dir, file) => {
      // A circular reference makes JSON.stringify throw inside saveState,
      // after the temp path has been computed but before/around the write.
      const circular = {};
      circular.self = circular;
      assert.throws(() => ps.saveState(circular, file));
      const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
      assert.deepEqual(leftovers, [], "no orphaned temp file after a failed save");
      assert.ok(!existsSync(file), "destination must not exist from a failed save");
    });
  });
});

describe("day-open equity & capital preservation", () => {
  test("initializes the day-open snapshot on first call", () => {
    const state = ps.loadState("/nonexistent");
    ps.checkAndRefreshDayOpen(state, 10000);
    assert.equal(state.day_open_equity, 10000);
    assert.equal(state.day_open_date, new Date().toISOString().slice(0, 10));
  });

  test("does not reset within the same UTC day", () => {
    const state = ps.loadState("/nonexistent");
    ps.checkAndRefreshDayOpen(state, 10000);
    ps.checkAndRefreshDayOpen(state, 20000);
    assert.equal(state.day_open_equity, 10000);
  });

  test("resets and clears capital preservation on a new day", () => {
    const state = ps.loadState("/nonexistent");
    state.day_open_date = "2000-01-01";
    state.capital_preservation_mode = true;
    ps.checkAndRefreshDayOpen(state, 5000);
    assert.notEqual(state.day_open_date, "2000-01-01");
    assert.equal(state.day_open_equity, 5000);
    assert.equal(state.capital_preservation_mode, false);
  });

  test("activate/deactivate capital preservation", () => {
    const state = ps.loadState("/nonexistent");
    assert.ok(!ps.isCapitalPreservationMode(state));
    ps.activateCapitalPreservation(state);
    assert.ok(ps.isCapitalPreservationMode(state));
    assert.ok(state.capital_preservation_since);
    ps.deactivateCapitalPreservation(state);
    assert.ok(!ps.isCapitalPreservationMode(state));
    assert.equal(state.capital_preservation_since, null);
  });

  test("activating twice does not reset the since-timestamp", () => {
    const state = ps.loadState("/nonexistent");
    ps.activateCapitalPreservation(state);
    const since = state.capital_preservation_since;
    ps.activateCapitalPreservation(state);
    assert.equal(state.capital_preservation_since, since);
  });
});

describe("per-position lifecycle", () => {
  test("initPosition resets all tracking fields", () => {
    const state = ps.loadState("/nonexistent");
    const pos = ps.getPosition(state, "SOL/USD");
    pos.stop_order_cycles = 5;
    ps.initPosition(state, "SOL/USD", 200);
    const fresh = ps.getPosition(state, "SOL/USD");
    assert.equal(fresh.entry_price, 200);
    assert.equal(fresh.high_water_mark, 200);
    assert.equal(fresh.stop_order_cycles, 0);
    assert.equal(fresh.partial_tp_done, false);
    assert.ok(fresh.entry_time_iso);
  });

  test("updateHighWaterMark only ratchets up, never down", () => {
    const state = ps.loadState("/nonexistent");
    ps.initPosition(state, "BTC/USD", 100);
    ps.updateHighWaterMark(state, "BTC/USD", 110);
    assert.equal(ps.getPosition(state, "BTC/USD").high_water_mark, 110);
    ps.updateHighWaterMark(state, "BTC/USD", 105);
    assert.equal(ps.getPosition(state, "BTC/USD").high_water_mark, 110, "must not lower the HWM");
    assert.equal(ps.getPosition(state, "BTC/USD").trailing_stop_active, true, "stays armed once activated");
  });

  test("markPartialTp sets the flag and breakeven stop", () => {
    const state = ps.loadState("/nonexistent");
    ps.initPosition(state, "BTC/USD", 100);
    ps.markPartialTp(state, "BTC/USD", 100);
    const pos = ps.getPosition(state, "BTC/USD");
    assert.equal(pos.partial_tp_done, true);
    assert.equal(pos.breakeven_stop, 100);
  });

  test("markPyramidAdd increments the tranche counter and raises breakeven", () => {
    const state = ps.loadState("/nonexistent");
    ps.initPosition(state, "BTC/USD", 100);
    ps.markPyramidAdd(state, "BTC/USD", 105);
    ps.markPyramidAdd(state, "BTC/USD", 110);
    const pos = ps.getPosition(state, "BTC/USD");
    assert.equal(pos.pyramid_tranches, 2);
    assert.equal(pos.breakeven_stop, 110);
  });

  test("clearPosition removes the symbol entirely", () => {
    const state = ps.loadState("/nonexistent");
    ps.initPosition(state, "BTC/USD", 100);
    ps.clearPosition(state, "BTC/USD");
    assert.ok(!("BTC/USD" in state.positions));
  });

  test("setStopOrder / incrementStopOrderCycles / clearStopOrder lifecycle", () => {
    const state = ps.loadState("/nonexistent");
    ps.setStopOrder(state, "BTC/USD", "order-1", 95.5);
    let pos = ps.getPosition(state, "BTC/USD");
    assert.equal(pos.stop_order_id, "order-1");
    assert.equal(pos.stop_order_cycles, 1);

    const cycles = ps.incrementStopOrderCycles(state, "BTC/USD");
    assert.equal(cycles, 2);

    ps.clearStopOrder(state, "BTC/USD");
    pos = ps.getPosition(state, "BTC/USD");
    assert.equal(pos.stop_order_id, null);
    assert.equal(pos.stop_order_cycles, 0);
  });
});
