// src/entrySizing.test.js
//
// Ports the two worked examples from CLAUDE.md's "Position Sizing Formula"
// section, plus the no-ATR fallback path.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeEntryQty, symbolCap } from "./entrySizing.js";

describe("symbolCap", () => {
  test("known symbols use their configured cap", () => {
    assert.equal(symbolCap("BTC/USD"), 0.3);
    assert.equal(symbolCap("LINK/USD"), 0.05);
  });
  test("unknown symbols fall back to the default cap", () => {
    assert.equal(symbolCap("SOMENEWCOIN/USD"), 0.05);
  });
});

describe("computeEntryQty", () => {
  test("BTC example: raw ATR qty exceeds the 30% cap, hard-capped (CLAUDE.md worked example)", () => {
    // $100k equity, BTC ask $80k, ATR $500, cap 30% -> raw 1.333, hard cap
    // 0.375 before compute_entry_qty's -1% safety margin -> 0.3713.
    const qty = computeEntryQty(100_000, "BTC/USD", 80_000, 500);
    const expectedHardCap = Math.round(((100_000 * 0.3) / 80_000) * 0.99 * 1e4) / 1e4;
    assert.equal(qty, expectedHardCap);
  });

  test("LINK example: raw ATR qty exceeds the 5% cap, hard-capped (CLAUDE.md worked example)", () => {
    // $100k equity, LINK ask $15, ATR $0.30, cap 5% -> raw 2222, hard cap
    // 333.3 before compute_entry_qty's -1% safety margin -> 330.0.
    const qty = computeEntryQty(100_000, "LINK/USD", 15, 0.3);
    const expectedHardCap = Math.round(((100_000 * 0.05) / 15) * 0.99 * 1e4) / 1e4;
    assert.equal(qty, expectedHardCap);
  });

  test("a well-inside-cap ATR qty is not clamped", () => {
    // $100k equity, BTC ask $80k, ATR $2000 -> stop_dist=3000, raw=0.33, well under 30% cap
    const qty = computeEntryQty(100_000, "BTC/USD", 80_000, 2000);
    const expectedRaw = Math.round((1000 / 3000) * 0.99 * 1e4) / 1e4;
    assert.equal(qty, expectedRaw);
  });

  test("falls back to fallback_size_pct sizing when ATR is missing", () => {
    const qty = computeEntryQty(100_000, "LINK/USD", 15, null);
    // fallback_size_pct default 0.02 -> 100000*0.02/15 * 0.99, hard cap way above it
    const expected = Math.round(((100_000 * 0.02) / 15) * 0.99 * 1e4) / 1e4;
    assert.equal(qty, expected);
  });

  test("riskMult scales the risk budget but never the hard cap", () => {
    const full = computeEntryQty(100_000, "BTC/USD", 80_000, 2000, 1.0);
    const half = computeEntryQty(100_000, "BTC/USD", 80_000, 2000, 0.5);
    assert.ok(Math.abs(half - full / 2) < 1e-6);
  });
});
