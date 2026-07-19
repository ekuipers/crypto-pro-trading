// src/runEvaluation.test.js
//
// End-to-end orchestration tests for runEvaluation.js's main(). Per the
// port plan, this file does NOT try to re-cover the decision-ladder branch
// logic (that lives in evaluateSymbol.test.js/rotation.test.js) -- only
// main()'s own sequencing/error-isolation/state-persistence behavior, with
// every external effect replaced via the `deps` injection point (no HTTP
// stubbing needed at all).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { main } from "./runEvaluation.js";
import * as ps from "./positionState.js";
import { TradeRejected } from "./trade.js";

function baseDeps(overrides = {}) {
  const state = ps.loadState("/nonexistent");
  return {
    getPositions: async () => [],
    getAccount: async () => ({ equity: "100000" }),
    getOpenOrders: async () => [],
    cancelOrder: async () => true,
    placeOrder: async (symbol, qty, side, limitPrice) => ({ id: "order-123", status: "accepted", symbol, qty, side, limit_price: limitPrice }),
    evaluateSymbol: async (symbol) => ({ symbol, action: "HOLD", reason: "no entry", score: 1.0, qty: null, limitPrice: null, ask: 100, netRr: null }),
    applyRotation: async () => null,
    appendJournalBlock: (args) => {
      overrides.__journalCalls?.push(args);
      return "/fake/journal/2026-07-19.md";
    },
    fetchAllFills: async () => [],
    reconcilePositionsFromFills: async () => [],
    sevenDayDrawdown: async () => 0,
    sessionPenaltyActive: async () => false,
    promotedSymbols: async () => [],
    loadState: () => state,
    saveState: () => {},
    now: () => new Date("2026-07-19T10:23:00Z"),
    ...overrides,
  };
}

describe("main — hard-failure paths", () => {
  test("returns 1 when positions fetch fails", async () => {
    const code = await main({ deps: baseDeps({ getPositions: async () => { throw new Error("down"); } }) });
    assert.equal(code, 1);
  });

  test("returns 1 when account fetch fails", async () => {
    const code = await main({ deps: baseDeps({ getAccount: async () => { throw new Error("down"); } }) });
    assert.equal(code, 1);
  });
});

describe("main — dry-run happy path", () => {
  test("evaluates every watchlist symbol, writes the journal, places no orders", async () => {
    const journalCalls = [];
    const placeOrderCalls = [];
    const deps = baseDeps({
      __journalCalls: journalCalls,
      placeOrder: async (...args) => {
        placeOrderCalls.push(args);
        return { id: "x" };
      },
    });
    deps.appendJournalBlock = (args) => {
      journalCalls.push(args);
      return "/fake/journal/2026-07-19.md";
    };
    const code = await main({ execute: false, deps });
    assert.equal(code, 0);
    assert.equal(placeOrderCalls.length, 0, "dry-run must never place an order");
    assert.equal(journalCalls.length, 1);
    assert.ok(journalCalls[0].decisions.length > 0, "every watchlist symbol should have produced a decision");
    assert.deepEqual(journalCalls[0].executed, []);
  });

  test("actionable BUY decisions are reported as a dry-run count, not executed", async () => {
    const deps = baseDeps({
      evaluateSymbol: async (symbol) => ({ symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 }),
    });
    let placed = 0;
    deps.placeOrder = async () => { placed++; return { id: "x" }; };
    const code = await main({ execute: false, deps });
    assert.equal(code, 0);
    assert.equal(placed, 0);
  });
});

describe("main — --execute path", () => {
  test("places actionable orders and updates position state on a BUY", async () => {
    const state = ps.loadState("/nonexistent");
    const deps = baseDeps({
      loadState: () => state,
      evaluateSymbol: async (symbol) =>
        symbol === "BTC/USD"
          ? { symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 }
          : { symbol, action: "HOLD", reason: "no entry", score: 0, qty: null, limitPrice: null, ask: 100 },
    });
    let placedCount = 0;
    deps.placeOrder = async (symbol, qty, side, limitPrice) => {
      placedCount++;
      assert.equal(symbol, "BTC/USD");
      assert.equal(side, "buy");
      return { id: "order-abc", status: "accepted" };
    };
    const code = await main({ execute: true, deps });
    assert.equal(code, 0);
    assert.equal(placedCount, 1);
    assert.equal(state.positions["BTC/USD"].entry_price, 100);
  });

  test("SELL/COVER decisions execute before BUY/SHORT decisions in the same cycle", async () => {
    const order = [];
    const deps = baseDeps({
      evaluateSymbol: async (symbol) => {
        if (symbol === "BTC/USD") return { symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 };
        if (symbol === "ETH/USD") return { symbol, action: "SELL", reason: "TA SELL", score: -3.0, qty: 1, limitPrice: 99, ask: 100 };
        return { symbol, action: "HOLD", reason: "no entry", score: 0, qty: null, limitPrice: null, ask: 100 };
      },
    });
    deps.placeOrder = async (symbol, qty, side) => {
      order.push(symbol);
      return { id: "x" };
    };
    // Position for ETH so the SELL is a plain TA exit (clearPosition path).
    deps.getPositions = async () => [{ symbol: "ETHUSD", qty: "1", avg_entry_price: "100", current_price: "99" }];
    await main({ execute: true, deps });
    assert.deepEqual(order, ["ETH/USD", "BTC/USD"], "SELL must be placed before BUY");
  });

  test("a TradeRejected is recorded as rejected, not thrown, and other orders still proceed", async () => {
    const journalCalls = [];
    const deps = baseDeps({
      __journalCalls: journalCalls,
      evaluateSymbol: async (symbol) =>
        symbol === "BTC/USD"
          ? { symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 }
          : symbol === "ETH/USD"
            ? { symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 }
            : { symbol, action: "HOLD", reason: "no entry", score: 0, qty: null, limitPrice: null, ask: 100 },
    });
    deps.appendJournalBlock = (args) => {
      journalCalls.push(args);
      return "/fake.md";
    };
    deps.placeOrder = async (symbol) => {
      if (symbol === "BTC/USD") throw new TradeRejected("BTC/USD: limit outside band");
      return { id: "eth-order" };
    };
    const code = await main({ execute: true, deps });
    assert.equal(code, 0, "a single rejected order must not fail the whole run");
    const executed = journalCalls[0].executed;
    const btcResult = executed.find((e) => e.symbol === "BTC/USD");
    const ethResult = executed.find((e) => e.symbol === "ETH/USD");
    assert.ok(btcResult.result.rejected);
    assert.equal(ethResult.result.id, "eth-order");
  });

  test("a generic order-placement error is recorded, not thrown", async () => {
    const journalCalls = [];
    const deps = baseDeps({
      __journalCalls: journalCalls,
      evaluateSymbol: async (symbol) =>
        symbol === "BTC/USD"
          ? { symbol, action: "BUY", reason: "TA BUY", score: 4.0, qty: 1, limitPrice: 100, ask: 100 }
          : { symbol, action: "HOLD", reason: "no entry", score: 0, qty: null, limitPrice: null, ask: 100 },
    });
    deps.appendJournalBlock = (args) => {
      journalCalls.push(args);
      return "/fake.md";
    };
    deps.placeOrder = async () => { throw new Error("network blip"); };
    const code = await main({ execute: true, deps });
    assert.equal(code, 0);
    const btcResult = journalCalls[0].executed.find((e) => e.symbol === "BTC/USD");
    assert.ok(btcResult.result.error);
  });
});

describe("main — cadence and drawdown warnings", () => {
  test("journals a CADENCE WARNING when the previous evaluation is >90 minutes old", async () => {
    const state = ps.loadState("/nonexistent");
    state.last_evaluation_iso = new Date("2026-07-19T08:00:00Z").toISOString(); // 143 min before `now`
    const journalCalls = [];
    const deps = baseDeps({ loadState: () => state, __journalCalls: journalCalls });
    deps.appendJournalBlock = (args) => {
      journalCalls.push(args);
      return "/fake.md";
    };
    await main({ deps });
    assert.ok(journalCalls[0].warnings.some((w) => w.includes("CADENCE WARNING")));
  });

  test("activates capital preservation when the daily drawdown gate triggers", async () => {
    const state = ps.loadState("/nonexistent");
    state.day_open_date = new Date().toISOString().slice(0, 10);
    state.day_open_equity = 100000;
    const deps = baseDeps({
      loadState: () => state,
      getAccount: async () => ({ equity: "96000" }), // 4% down, gate is 3%
    });
    await main({ deps });
    assert.equal(state.capital_preservation_mode, true);
  });
});
