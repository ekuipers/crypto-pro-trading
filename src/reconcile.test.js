// src/reconcile.test.js
//
// Tests for reconcile.js, including a port of tests/test_reconcile.py's
// TestPartialTpIdempotency, TestPruneStaleState, TestEntryPriceGuard, and
// TestEntryClockBackfill classes (the 2026-07-10/2026-07-18 bug-sweep
// regression tests, including Bug #6's relative-tolerance dust fix).

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./testUtils/fetchStub.js";
import * as ps from "./positionState.js";
import {
  pruneStaleState,
  reconcilePositionsFromFills,
  computeSessionPenalty,
  sessionPenaltyActive,
  resetSessionPenaltyCache,
  sevenDayDrawdown,
} from "./reconcile.js";

let stub;
afterEach(() => {
  stub?.restore();
  resetSessionPenaltyCache();
});

function fill(side, sym, qty, price, when) {
  return { side, symbol: sym, qty: String(qty), price: String(price), transaction_time: when };
}
function pos(sym, qty, entry) {
  return { symbol: sym, qty: String(qty), avg_entry_price: String(entry) };
}
function freshState() {
  return ps.loadState("/nonexistent");
}

describe("reconcilePositionsFromFills — partial-TP idempotency", () => {
  test("a partial sell since entry restores the flag (Bug #1)", async () => {
    // Buy 6.54, then one partial sell of 3.27 — position still open.
    const fills = [
      fill("sell", "AAVEUSD", 3.27, 320.0, "2026-07-09T15:29:00Z"),
      fill("buy", "AAVEUSD", 6.54, 300.0, "2026-07-08T10:23:00Z"),
    ];
    const positions = [pos("AAVEUSD", 3.27, 300.0)];
    const state = freshState();
    const warnings = await reconcilePositionsFromFills(state, positions, { fills });
    const p = ps.getPosition(state, "AAVE/USD");
    assert.equal(p.partial_tp_done, true);
    assert.equal(p.breakeven_stop, 300.0);
    assert.ok(warnings.some((w) => w.includes("PARTIAL-TP RECONCILED")));
  });

  test("no sell since entry leaves the flag clear", async () => {
    // Previous round trip fully closed, then a fresh buy — no partial yet.
    const fills = [
      fill("buy", "BTCUSD", 0.5, 80000.0, "2026-07-10T08:23:00Z"),
      fill("sell", "BTCUSD", 1.0, 79000.0, "2026-07-05T12:23:00Z"),
      fill("buy", "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z"),
    ];
    const positions = [pos("BTCUSD", 0.5, 80000.0)];
    const state = freshState();
    await reconcilePositionsFromFills(state, positions, { fills });
    assert.equal(ps.getPosition(state, "BTC/USD").partial_tp_done, false);
  });

  test("Bug #6: a fee-mismatched full close is NOT counted as a partial TP", async () => {
    // Real 2026-07-17 LTC/USD incident: buy 59.693, then a "full" close sell
    // of only 59.5616754 (0.22% short — Alpaca fee/precision rounding). That
    // round trip fully closed the position; it must NOT be read as a
    // partial TP against the fresh buy that follows.
    const fills = [
      fill("buy", "LTCUSD", 59.693, 45.906, "2026-07-18T08:00:00Z"),
      fill("sell", "LTCUSD", 59.5616754, 44.9684, "2026-07-17T06:30:00Z"),
      fill("buy", "LTCUSD", 59.693, 45.906, "2026-07-17T03:41:00Z"),
    ];
    const positions = [pos("LTCUSD", 59.693, 45.906)];
    const state = freshState();
    const warnings = await reconcilePositionsFromFills(state, positions, { fills });
    assert.equal(ps.getPosition(state, "LTC/USD").partial_tp_done, false);
    assert.ok(!warnings.some((w) => w.includes("PARTIAL-TP RECONCILED")));
  });

  test("Bug #9: a final close with a small trailing lot is NOT counted as a partial TP", async () => {
    // Two buy tranches (200 + a small 10-unit add), then one full-close sell
    // whose ~0.24% aggregate fee/rounding shortfall lands entirely inside
    // the small trailing lot -- 0.5 units short against a lot whose OWN
    // 0.5% tolerance is only 0.05. The pre-fix per-lot dust check left that
    // lot stuck open forever, so LINK/USD's sellsSinceStart only ever grew
    // and every fresh entry was immediately reconciled as "partial TP
    // already done." A fresh buy afterward must NOT be flagged.
    const fills = [
      fill("sell", "LINKUSD", 209.5, 8.4, "2026-07-19T12:00:00Z"),
      fill("buy", "LINKUSD", 10.0, 8.3, "2026-07-18T09:00:00Z"),
      fill("buy", "LINKUSD", 200.0, 8.2, "2026-07-18T08:00:00Z"),
    ];
    const positions = [pos("LINKUSD", 210.0, 8.2)];
    const state = freshState();
    const warnings = await reconcilePositionsFromFills(state, positions, { fills });
    assert.equal(ps.getPosition(state, "LINK/USD").partial_tp_done, false);
    assert.ok(!warnings.some((w) => w.includes("PARTIAL-TP RECONCILED")));
  });

  test("Bug #9: repeated full episodes never inflate the counter", async () => {
    // Two genuinely separate open->close episodes (each with a
    // fee-rounding-shortfall full close) followed by a fresh, still-open
    // third buy. sellsSinceStart must reset to 0 after each full close,
    // never accumulate across episodes into the current holding.
    const fills = [
      fill("buy", "LINKUSD", 100.0, 8.3, "2026-07-15T08:00:00Z"),
      fill("sell", "LINKUSD", 149.7, 8.1, "2026-07-13T10:00:00Z"),
      fill("buy", "LINKUSD", 150.0, 8.2, "2026-07-13T08:00:00Z"),
      fill("sell", "LINKUSD", 79.85, 7.9, "2026-07-11T10:00:00Z"),
      fill("buy", "LINKUSD", 80.0, 8.0, "2026-07-11T08:00:00Z"),
    ];
    const positions = [pos("LINKUSD", 100.0, 8.3)];
    const state = freshState();
    const warnings = await reconcilePositionsFromFills(state, positions, { fills });
    assert.equal(ps.getPosition(state, "LINK/USD").partial_tp_done, false);
    assert.ok(!warnings.some((w) => w.includes("PARTIAL-TP RECONCILED")));
  });

  test("an already-done flag is left untouched and skips the fills fetch entirely", async () => {
    const state = freshState();
    const p = ps.getPosition(state, "AAVE/USD");
    p.partial_tp_done = true;
    p.entry_time_iso = "2026-07-08T10:23:00Z";
    p.entry_price = 300.0;
    const positions = [pos("AAVEUSD", 3.27, 300.0)];
    // No `fills` injected AND no fetch stub installed -- if the code tried
    // to call fetchAllFills() this would throw (no stubbed fetch), proving
    // it correctly short-circuited before ever fetching.
    const warnings = await reconcilePositionsFromFills(state, positions);
    assert.deepEqual(warnings, []);
  });
});

describe("pruneStaleState", () => {
  test("clears state for a symbol no longer held (Bug #7)", () => {
    const state = freshState();
    ps.markPartialTp(state, "LTC/USD", 45.812);
    assert.equal(ps.getPosition(state, "LTC/USD").partial_tp_done, true);

    const warnings = pruneStaleState(state, ["BTC/USD"]);

    assert.ok(!("LTC/USD" in state.positions));
    assert.ok(warnings.some((w) => w.includes("LTC/USD")));
  });

  test("leaves a held symbol's state untouched", () => {
    const state = freshState();
    ps.markPartialTp(state, "BTC/USD", 80000.0);
    const warnings = pruneStaleState(state, ["BTC/USD"]);
    assert.equal(state.positions["BTC/USD"].partial_tp_done, true);
    assert.deepEqual(warnings, []);
  });
});

describe("reconcilePositionsFromFills — entry-price guard", () => {
  test("a negative avg_entry_price is replaced with the FIFO-derived value", async () => {
    const fills = [
      fill("sell", "SOLUSD", 10.0, 160.0, "2026-07-09T15:29:00Z"),
      fill("buy", "SOLUSD", 39.5, 150.0, "2026-07-08T10:23:00Z"),
    ];
    const positions = [pos("SOLUSD", 29.5, -4.4931)];
    const state = freshState();
    const warnings = await reconcilePositionsFromFills(state, positions, { fills });
    assert.equal(Number(positions[0].avg_entry_price), 150.0);
    assert.ok(warnings.some((w) => w.includes("DATA GUARD")));
  });

  test("a positive avg_entry_price is left untouched", async () => {
    const fills = [fill("buy", "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z")];
    const positions = [pos("BTCUSD", 1.0, 78123.45)];
    await reconcilePositionsFromFills(freshState(), positions, { fills });
    assert.equal(Number(positions[0].avg_entry_price), 78123.45);
  });
});

describe("reconcilePositionsFromFills — entry-clock backfill", () => {
  test("entry_time_iso comes from the current position's flat->long transition", async () => {
    const fills = [
      fill("buy", "BTCUSD", 0.5, 80000.0, "2026-07-10T08:23:00Z"),
      fill("sell", "BTCUSD", 1.0, 79000.0, "2026-07-05T12:23:00Z"),
      fill("buy", "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z"),
    ];
    const positions = [pos("BTCUSD", 0.5, 80000.0)];
    const state = freshState();
    await reconcilePositionsFromFills(state, positions, { fills });
    // The clock starts at the CURRENT position's entry, not the old round trip.
    assert.equal(ps.getPosition(state, "BTC/USD").entry_time_iso, "2026-07-10T08:23:00Z");
  });

  test("short positions are ignored (long-only reconciliation, no fetch)", async () => {
    const positions = [pos("BTCUSD", -1.0, 80000.0)];
    const warnings = await reconcilePositionsFromFills(freshState(), positions);
    assert.deepEqual(warnings, []);
  });
});

describe("computeSessionPenalty", () => {
  test("flags an hour/weekday bucket with enough samples and negative net P&L", () => {
    // All exits at hour 14 GMT+2 (12:00 UTC), net negative, sample size 20.
    const roundTrips = Array.from({ length: 20 }, () => ({ pnl: -1, exit_iso: "2026-07-13T12:00:00Z" })); // 2026-07-13 is a Monday
    const penalty = computeSessionPenalty(roundTrips);
    assert.ok(penalty.hours.has(14));
    assert.ok(penalty.dows.has("Mon"));
  });

  test("does not flag a bucket below the minimum sample size", () => {
    const roundTrips = Array.from({ length: 5 }, () => ({ pnl: -1, exit_iso: "2026-07-13T12:00:00Z" }));
    const penalty = computeSessionPenalty(roundTrips);
    assert.equal(penalty.hours.size, 0);
  });

  test("does not flag a bucket with non-negative net P&L", () => {
    const roundTrips = Array.from({ length: 20 }, () => ({ pnl: 1, exit_iso: "2026-07-13T12:00:00Z" }));
    const penalty = computeSessionPenalty(roundTrips);
    assert.equal(penalty.hours.size, 0);
  });
});

describe("sessionPenaltyActive", () => {
  test("caches after the first call within a process run", async () => {
    const roundTrips = Array.from({ length: 20 }, () => ({ pnl: -1, exit_iso: "2026-07-13T12:00:00Z" }));
    const activeAt1400 = await sessionPenaltyActive({
      now: new Date("2026-07-20T12:00:00Z"), // any Monday 14:00 GMT+2
      roundTrips,
    });
    assert.equal(activeAt1400, true);
    // Second call with different (empty) round trips still uses the cache.
    const stillActive = await sessionPenaltyActive({ now: new Date("2026-07-20T12:00:00Z"), roundTrips: [] });
    assert.equal(stillActive, true);
  });

  test("returns false outside any penalized bucket", async () => {
    const active = await sessionPenaltyActive({ now: new Date("2026-07-21T03:00:00Z"), roundTrips: [] });
    assert.equal(active, false);
  });
});

describe("sevenDayDrawdown", () => {
  test("computes drawdown from the last 8 daily equity points", async () => {
    stub = stubFetch([{ status: 200, body: { equity: [100, 105, 110, 99] } }]);
    const dd = await sevenDayDrawdown();
    assert.ok(Math.abs(dd - 0.1) < 1e-9); // peak 110 -> 99 = 10% drawdown
  });

  test("returns 0 and does not throw when the request fails", async () => {
    stub = stubFetch([{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }]);
    const dd = await sevenDayDrawdown({ maxAttempts: 3, backoffSeconds: 0.001 });
    assert.equal(dd, 0.0);
  });
});
