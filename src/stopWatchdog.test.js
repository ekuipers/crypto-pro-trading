// src/stopWatchdog.test.js
//
// Unit tests for stopWatchdog.js — every external effect is injected via
// `deps` (same pattern as runEvaluation.test.js), so no HTTP stubbing is
// needed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkPosition, main } from "./stopWatchdog.js";
import * as ps from "./positionState.js";

function baseDeps(overrides = {}) {
  return {
    getOpenOrders: async () => [],
    getLatestQuote: async () => ({ ap: 100, bp: 99.9 }),
    getCryptoBars4h: async () => [],
    placeOrder: async () => ({ id: "order-123" }),
    ...overrides,
  };
}

describe("checkPosition", () => {
  test("skips flat/short positions (qty <= 0)", async () => {
    const state = ps.loadState("/nonexistent");
    const line = await checkPosition({ symbol: "BTCUSD", qty: 0, avg_entry_price: 100 }, state, false, baseDeps());
    assert.equal(line, null);
  });

  test("skips when a SELL order is already pending (dedup)", async () => {
    const state = ps.loadState("/nonexistent");
    const line = await checkPosition(
      { symbol: "BTCUSD", qty: 1, avg_entry_price: 100 },
      state,
      false,
      baseDeps({ getOpenOrders: async () => [{ side: "sell" }] })
    );
    assert.equal(line, null);
  });

  test("no stop hit when price is near entry", async () => {
    const state = ps.loadState("/nonexistent");
    const line = await checkPosition(
      { symbol: "BTC/USD", qty: 1, avg_entry_price: 100 },
      state,
      false,
      baseDeps({ getLatestQuote: async () => ({ ap: 100.5, bp: 100.4 }) })
    );
    assert.equal(line, null);
  });

  test("fixed -5% hard stop fires as a dry run when no 4H swing low is available", async () => {
    const state = ps.loadState("/nonexistent");
    const line = await checkPosition(
      { symbol: "BTC/USD", qty: 1, avg_entry_price: 100 },
      state,
      false,
      baseDeps({ getLatestQuote: async () => ({ ap: 94, bp: 93.9 }) })
    );
    assert.match(line, /STOP \(fixed -5%\)/);
    assert.match(line, /\(dry-run\)$/);
  });

  test("execute=true places the stop order and records it in state", async () => {
    const state = ps.loadState("/nonexistent");
    const placeOrderCalls = [];
    const line = await checkPosition(
      { symbol: "BTC/USD", qty: 1, avg_entry_price: 100 },
      state,
      true,
      baseDeps({
        getLatestQuote: async () => ({ ap: 94, bp: 93.9 }),
        placeOrder: async (...args) => {
          placeOrderCalls.push(args);
          return { id: "order-abcdef123" };
        },
      })
    );
    assert.match(line, /id=order-ab/);
    assert.equal(placeOrderCalls.length, 1);
    assert.equal(placeOrderCalls[0][0], "BTC/USD");
    assert.equal(placeOrderCalls[0][2], "sell");
    assert.equal(ps.getPosition(state, "BTC/USD").stop_order_id, "order-abcdef123");
  });

  test("trailing stop fires once armed and price falls below the trail", async () => {
    const state = ps.loadState("/nonexistent");
    ps.getPosition(state, "BTC/USD").high_water_mark = 110; // +10% profit, trail arms at +2.5%
    const line = await checkPosition(
      { symbol: "BTC/USD", qty: 1, avg_entry_price: 100 },
      state,
      false,
      baseDeps({ getLatestQuote: async () => ({ ap: 106, bp: 105.9 }) }) // below 110*(1-0.03)=106.7
    );
    assert.match(line, /TRAILING STOP/);
  });
});

describe("main", () => {
  test("returns 1 when positions fetch fails", async () => {
    const code = await main({ deps: { getPositions: async () => { throw new Error("down"); }, loadState: () => ps.loadState("/nonexistent") } });
    assert.equal(code, 1);
  });

  test("no journal write when no stops hit", async () => {
    let wrote = false;
    const code = await main({
      deps: {
        ...baseDeps(),
        getPositions: async () => [{ symbol: "BTC/USD", qty: 1, avg_entry_price: 100 }],
        getLatestQuote: async () => ({ ap: 100.5, bp: 100.4 }),
        loadState: () => ps.loadState("/nonexistent"),
        appendStopWatchdogBlock: () => { wrote = true; return "/fake/path.md"; },
      },
    });
    assert.equal(code, 0);
    assert.equal(wrote, false);
  });

  test("dry run: journal written, state not saved", async () => {
    let saved = false;
    let journalArgs = null;
    const code = await main({
      execute: false,
      deps: {
        ...baseDeps(),
        getPositions: async () => [{ symbol: "BTC/USD", qty: 1, avg_entry_price: 100 }],
        getLatestQuote: async () => ({ ap: 94, bp: 93.9 }),
        loadState: () => ps.loadState("/nonexistent"),
        saveState: () => { saved = true; },
        appendStopWatchdogBlock: (actions, now) => { journalArgs = actions; return "/fake/path.md"; },
      },
    });
    assert.equal(code, 0);
    assert.equal(saved, false, "dry-run must never persist state");
    assert.equal(journalArgs.length, 1);
  });

  test("execute=true saves state after a stop fires", async () => {
    let saved = false;
    const code = await main({
      execute: true,
      deps: {
        ...baseDeps(),
        getPositions: async () => [{ symbol: "BTC/USD", qty: 1, avg_entry_price: 100 }],
        getLatestQuote: async () => ({ ap: 94, bp: 93.9 }),
        loadState: () => ps.loadState("/nonexistent"),
        saveState: () => { saved = true; },
        appendStopWatchdogBlock: () => "/fake/path.md",
      },
    });
    assert.equal(code, 0);
    assert.equal(saved, true);
  });
});
