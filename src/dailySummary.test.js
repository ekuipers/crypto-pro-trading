// src/dailySummary.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { realizedPnlToday, buildSummary, main } from "./dailySummary.js";

describe("realizedPnlToday", () => {
  test("sums only round trips whose exit lands today", () => {
    const fills = [
      // newest-first, as fetchAllFills returns
      { symbol: "BTCUSD", side: "sell", qty: "1", price: "110", transaction_time: "2026-07-21T10:00:00Z" },
      { symbol: "BTCUSD", side: "buy", qty: "1", price: "100", transaction_time: "2026-07-20T10:00:00Z" },
      { symbol: "ETHUSD", side: "sell", qty: "2", price: "50", transaction_time: "2026-07-19T10:00:00Z" },
      { symbol: "ETHUSD", side: "buy", qty: "2", price: "60", transaction_time: "2026-07-18T10:00:00Z" },
    ];
    const { pnlToday, exitsToday } = realizedPnlToday(fills, "2026-07-21");
    assert.equal(exitsToday, 1);
    assert.ok(Math.abs(pnlToday - 10) < 1e-6);
  });

  test("unmatched SELL (no prior BUY) is excluded", () => {
    const fills = [{ symbol: "BTCUSD", side: "sell", qty: "1", price: "100", transaction_time: "2026-07-21T10:00:00Z" }];
    const { pnlToday, exitsToday } = realizedPnlToday(fills, "2026-07-21");
    assert.equal(exitsToday, 0);
    assert.equal(pnlToday, 0);
  });
});

describe("buildSummary", () => {
  test("flat account, no trades today", () => {
    const block = buildSummary({
      account: { equity: "1000", last_equity: "1000", cash: "1000" },
      positions: [],
      fills: [],
      now: new Date("2026-07-21T21:21:00Z"),
    });
    assert.match(block, /## Daily Summary/);
    assert.match(block, /none \(flat\)/);
    assert.match(block, /No trades — no fills recorded today\./);
  });

  test("open position and a fill today render", () => {
    const block = buildSummary({
      account: { equity: "1010", last_equity: "1000", cash: "500" },
      positions: [{ symbol: "BTCUSD", qty: "1", avg_entry_price: "100", current_price: "110", unrealized_pl: "10" }],
      fills: [{ symbol: "BTCUSD", side: "buy", qty: "1", price: "100", transaction_time: new Date().toISOString() }],
      now: new Date(),
    });
    assert.match(block, /BTC\/USD 1\.0000 @ \$100\.0000 -> \$110\.0000/);
    assert.match(block, /Fills today: 1/);
  });
});

describe("main", () => {
  test("returns 1 when any fetch fails", async () => {
    const code = await main({ deps: { getAccount: async () => { throw new Error("down"); }, getPositions: async () => [], fetchAllFills: async () => [] } });
    assert.equal(code, 1);
  });

  test("writes the journal block on success", async () => {
    let written = null;
    const code = await main({
      deps: {
        getAccount: async () => ({ equity: "1000", last_equity: "1000", cash: "1000" }),
        getPositions: async () => [],
        fetchAllFills: async () => [],
        appendDailySummaryBlock: (block) => { written = block; return "/fake/path.md"; },
        now: () => new Date("2026-07-21T21:21:00Z"),
      },
    });
    assert.equal(code, 0);
    assert.match(written, /## Daily Summary/);
  });
});
