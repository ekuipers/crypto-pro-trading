// src/evaluateSymbol.test.js
//
// Tests for evaluateSymbol.js's held-long / held-short / flat-entry
// decision ladder. All network calls are dependency-injected (no HTTP
// stubbing needed) -- see the `deps` parameter design in evaluateSymbol.js.
// Indicator functions (`deps.ind`) are similarly overridable so tests can
// force a specific score/target without needing a realistic price series.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateSymbol } from "./evaluateSymbol.js";
import * as ps from "./positionState.js";
import { STOP_LOSS_ESCALATION_CYCLES } from "./risk.js";

function bar(c, { o = c, h = c, l = c, v = 100, t = "2026-07-19T00:00:00Z" } = {}) {
  return { t, o, h, l, c, v };
}

function flatBars(n, price = 100) {
  return Array.from({ length: n }, () => bar(price));
}

function trendingDailyBars(n, { start = 100, step = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => bar(start + i * step));
}

function freshState() {
  return ps.loadState("/nonexistent");
}

/** Baseline dependency set: enough bars to clear every "insufficient history"
 * gate, flat/neutral indicators, a mixed daily regime, no open orders, ample
 * equity. Individual tests override just the pieces they care about. */
function baseDeps(overrides = {}) {
  return {
    getLatestQuote: async () => ({ ap: 100, bp: 99.9 }),
    getCryptoBars: async () => flatBars(60, 100),
    getCryptoBars4h: async () => flatBars(60, 100),
    getCryptoBarsDaily: async () => flatBars(60, 100), // flat -> "mixed" regime
    getOpenOrders: async () => [],
    cancelOrder: async () => true,
    getAccount: async () => ({ equity: "100000" }),
    sessionPenaltyActive: async () => false, // SESSION_FILTER_ENABLED is true live -- never hit the network in tests
    ind: {},
    ...overrides,
  };
}

function withScore(score, indOverrides = {}) {
  return { signalScore: () => ({ score, parts: { ema_cross: "n/a" } }), ...indOverrides };
}

describe("evaluateSymbol — data-availability gates", () => {
  test("quote fetch failure returns a HOLD with the failure reason", async () => {
    const deps = baseDeps({ getLatestQuote: async () => { throw new Error("boom"); } });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /quote fetch failed/);
  });

  test("bars fetch failure returns a HOLD with the failure reason", async () => {
    const deps = baseDeps({ getCryptoBars: async () => { throw new Error("boom"); } });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.match(d.reason, /bars fetch failed/);
  });

  test("not enough 15-min history blocks before any decision logic", async () => {
    const deps = baseDeps({ getCryptoBars: async () => flatBars(10, 100) });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.match(d.reason, /not enough 15-min history/);
  });

  test("short 4H history is flagged with a data-quality warning and regime4h note", async () => {
    const deps = baseDeps({ getCryptoBars4h: async () => flatBars(10, 100) });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.match(d.regime4h, /insufficient 4H history/);
    assert.match(d.dataQualityWarning, /4H history unavailable/);
  });
});

describe("evaluateSymbol — held short position", () => {
  test("a pending cover order within the grace window blocks a duplicate", async () => {
    const state = freshState();
    // stop_order_cycles=0 so incrementStopOrderCycles takes it to 1, still
    // < STOP_LOSS_ESCALATION_CYCLES (2) -- setStopOrder itself sets cycles
    // to 1, which would already escalate on the very next check.
    const p = ps.getPosition(state, "BTC/USD");
    p.stop_order_id = "cover-order-1";
    p.stop_order_cycles = 0;
    const deps = baseDeps({ getOpenOrders: async () => [{ id: "cover-order-1" }] });
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "101", qty: "-1" } };
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.match(d.reason, /COVER pending/);
    assert.equal(d.action, "HOLD");
  });

  test("escalation cancels the stale cover order and re-evaluates", async () => {
    const state = freshState();
    ps.setStopOrder(state, "BTC/USD", "cover-order-1", 105);
    for (let i = 1; i < STOP_LOSS_ESCALATION_CYCLES; i++) ps.incrementStopOrderCycles(state, "BTC/USD");
    let cancelled = null;
    const deps = baseDeps({
      getOpenOrders: async () => [{ id: "cover-order-1" }],
      cancelOrder: async (id) => { cancelled = id; return true; },
    });
    // price rose enough to trigger the hard cover stop after the cancel/fall-through
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "106", qty: "-1" } };
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.equal(cancelled, "cover-order-1");
    assert.equal(d.action, "COVER");
  });

  test("order gone (filled/expired) clears position state", async () => {
    const state = freshState();
    ps.setStopOrder(state, "BTC/USD", "cover-order-1", 105);
    const deps = baseDeps({ getOpenOrders: async () => [] });
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "101", qty: "-1" } };
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.match(d.reason, /filled\/gone/);
    assert.ok(!("BTC/USD" in state.positions));
  });

  test("hard stop covers when price rises >= 5% above entry", async () => {
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "106", qty: "-2" } };
    const deps = baseDeps();
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "COVER");
    assert.equal(d.qty, 2);
    assert.equal(d.isStopLoss, true);
    assert.match(d.reason, /COVER STOP-LOSS/);
  });

  test("TA cover fires when score turns bullish enough", async () => {
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "99", qty: "-1" } };
    const deps = baseDeps({ ind: withScore(2.5) }); // >= COVER_SCORE_THRESHOLD (2.0)
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "COVER");
    assert.match(d.reason, /TA COVER/);
  });

  test("otherwise holds the short with a profit/loss readout", async () => {
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "99", qty: "-1" } };
    const deps = baseDeps({ ind: withScore(0) });
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /HOLD SHORT/);
  });
});

describe("evaluateSymbol — held long position", () => {
  test("a pending stop order within the grace window blocks a duplicate", async () => {
    const state = freshState();
    const p = ps.getPosition(state, "BTC/USD");
    p.stop_order_id = "stop-order-1";
    p.stop_order_cycles = 0;
    const deps = baseDeps({ getOpenOrders: async () => [{ id: "stop-order-1" }] });
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "99", qty: "1" } };
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.match(d.reason, /stop-loss pending/);
  });

  test("order gone (filled/expired) clears position state", async () => {
    const state = freshState();
    ps.setStopOrder(state, "BTC/USD", "stop-order-1", 95);
    const deps = baseDeps({ getOpenOrders: async () => [] });
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "99", qty: "1" } };
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.match(d.reason, /filled\/gone/);
    assert.ok(!("BTC/USD" in state.positions));
  });

  test("trailing stop fires once armed and price falls through the trail", async () => {
    const state = freshState();
    // HWM well above entry (armed), current price now well below the trail.
    ps.getPosition(state, "BTC/USD").high_water_mark = 110;
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "104", qty: "1" } };
    const deps = baseDeps({ ind: withScore(0) });
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.equal(d.action, "SELL");
    assert.equal(d.isStopLoss, true);
    assert.match(d.reason, /TRAILING STOP/);
  });

  test("fixed-pct fallback stop fires with no 4H data and no trail armed", async () => {
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "94", qty: "1" } };
    // No native/synthetic 4H bars at all -> swing-low stop unavailable -> fixed -5% fallback.
    const deps = baseDeps({ getCryptoBars4h: async () => [], ind: withScore(0) });
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "SELL");
    assert.match(d.reason, /STOP-LOSS \(fallback\)/);
  });

  test("TA sell fires on strongly bearish score with no stop hit", async () => {
    // current_price = entry: above the ~99.9 swing-low stop (no hard stop)
    // and below the ~100.1 partial-TP trigger (no partial TP either).
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "100", qty: "1" } };
    const deps = baseDeps({ ind: withScore(-2.5) }); // <= SELL_SCORE_THRESHOLD (-2.0)
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "SELL");
    assert.match(d.reason, /TA SELL/);
  });

  test("stale-position exit fires for an old, unarmed, weak position", async () => {
    const state = freshState();
    const oldIso = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    ps.getPosition(state, "BTC/USD").entry_time_iso = oldIso;
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "100", qty: "1" } };
    const deps = baseDeps({ ind: withScore(1.0) }); // below BUY_SCORE_HALF_SIZE (2.5), above SELL threshold
    const d = await evaluateSymbol("BTC/USD", positions, state, ["BTC/USD"], { deps });
    assert.equal(d.action, "SELL");
    assert.match(d.reason, /STALE EXIT/);
  });

  test("otherwise holds the long with a P&L readout", async () => {
    const positions = { "BTC/USD": { avg_entry_price: "100", current_price: "100", qty: "1" } };
    const deps = baseDeps({ ind: withScore(1.0) });
    const d = await evaluateSymbol("BTC/USD", positions, freshState(), ["BTC/USD"], { deps });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /^HOLD /);
  });
});

describe("evaluateSymbol — flat entry (new position)", () => {
  test("capital preservation mode blocks all new entries", async () => {
    const state = freshState();
    ps.activateCapitalPreservation(state);
    const deps = baseDeps({ ind: withScore(5.0) });
    const d = await evaluateSymbol("BTC/USD", {}, state, [], { deps });
    assert.match(d.reason, /BLOCKED: capital preservation/);
  });

  test("correlation budget blocks entries once the total cap is reached", async () => {
    const deps = baseDeps({ ind: withScore(5.0) });
    // MAX_OPEN_POSITIONS is 7 in the live config -- 7 open symbols already.
    const open = Array.from({ length: 7 }, (_, i) => `SYM${i}/USD`);
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), open, { deps });
    assert.match(d.reason, /BLOCKED: correlation budget/);
  });

  test("account fetch failure is reported and blocks the entry", async () => {
    const deps = baseDeps({ ind: withScore(5.0), getAccount: async () => { throw new Error("boom"); } });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.match(d.reason, /account fetch failed/);
  });

  test("full-size BUY at/above the full score threshold with a mixed regime", async () => {
    const deps = baseDeps({
      ind: withScore(4.0, { bollinger: () => [95, 100, 110, 0.1, 0.6] }), // upper=110 > ask=100 -> a usable R:R target
    });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "BUY");
    assert.match(d.reason, /full-size/);
    assert.ok(d.qty > 0);
    assert.equal(d.limitPrice, 100);
  });

  test("half-size BUY between the half and full score thresholds", async () => {
    const deps = baseDeps({
      ind: withScore(3.0, { bollinger: () => [95, 100, 110, 0.1, 0.6] }), // >= half (2.5), < full (3.5? actually 3.5 per config)
    });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "BUY");
    assert.match(d.reason, /half-size/);
  });

  test("half-size counter-trend long in a confirmed downtrend at high confluence", async () => {
    const deps = baseDeps({
      getCryptoBarsDaily: async () => trendingDailyBars(60, { start: 200, step: -1 }), // clear downtrend
      ind: withScore(4.0, { bollinger: () => [95, 100, 110, 0.1, 0.6] }), // >= DOWNTREND_LONG_SCORE (4.0)
    });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "BUY");
    assert.match(d.reason, /counter-trend/);
  });

  test("net R:R gate blocks an entry whose reward doesn't clear the round-trip cost", async () => {
    const deps = baseDeps({
      // upper == ask -> no usable target -> rr stays null -> gate skipped;
      // instead force a target just barely above ask so rr computes very low.
      ind: withScore(4.0, { bollinger: () => [99, 99.95, 100.05, 0.001, 0.6] }),
    });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    // Either blocked outright or half-sized on RR -- both are valid outcomes
    // of the soft gate; assert it never grants a naive full-size BUY here.
    if (d.action === "BUY") {
      assert.match(d.reason, /half-size/);
    } else {
      assert.match(d.reason, /BLOCKED: net R:R/);
    }
  });

  test("no entry when the score is below the half-size gate in a mixed regime", async () => {
    const deps = baseDeps({ ind: withScore(1.0) });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /no entry: score=/);
  });

  test("downtrend without enough confluence for a counter-trend long reports the right reason", async () => {
    const deps = baseDeps({
      getCryptoBarsDaily: async () => trendingDailyBars(60, { start: 200, step: -1 }),
      ind: withScore(1.0),
    });
    const d = await evaluateSymbol("BTC/USD", {}, freshState(), [], { deps });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /downtrend: counter-trend long needs score/);
    assert.match(d.reason, /shorts disabled/);
  });
});
