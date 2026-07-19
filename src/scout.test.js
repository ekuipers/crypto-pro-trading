// src/scout.test.js
//
// Tests for scout.js, including a port of tests/test_scout.py's
// TestGetUniverse and TestScan classes. scan() takes dependency-injected
// overrides so its orchestration can be tested without any HTTP stubbing,
// mirroring Python's patch.object(scout, "_daily_uptrend", ...) approach.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { stubFetch } from "./testUtils/fetchStub.js";
import * as scout from "./scout.js";

let stub;
afterEach(() => {
  stub?.restore();
});

describe("getUniverse", () => {
  test("normalizes symbols and filters tradability/quote/watchlist", async () => {
    const assets = [
      { symbol: "XRP/USD", tradable: true },
      { symbol: "PEPEUSD", tradable: true }, // bare form -> PEPE/USD
      { symbol: "BTC/USDT", tradable: true }, // non-USD quote -> drop
      { symbol: "BTC/USD", tradable: true }, // watchlist -> drop (assume in watchlist)
      { symbol: "SHIB/USD", tradable: false }, // not tradable -> drop
    ];
    stub = stubFetch([{ status: 200, body: assets }]);
    const uni = await scout.getUniverse();
    // BTC/USD is in the real config.json watchlist, so it's dropped
    // regardless; the remaining survivors are PEPE/USD and XRP/USD, sorted.
    assert.deepEqual(uni, ["PEPE/USD", "XRP/USD"]);
  });
});

describe("scan", () => {
  test("promotes only uptrend, high-score candidates, ranked by score", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-scout-test-"));
    try {
      const dynamicPath = path.join(dir, "watchlist_dynamic.json");
      const scores = { "AAA/USD": 5.0, "BBB/USD": 4.0, "CCC/USD": 2.0 };
      const payload = await scout.scan({
        getUniverseFn: async () => ["AAA/USD", "BBB/USD", "CCC/USD", "DDD/USD"],
        dailyUptrendFn: async (s) => s !== "DDD/USD",
        confluenceFn: async (s) => scores[s],
        dynamicPath,
      });
      // CCC below min_score (4.0), DDD not uptrend -> only AAA + BBB, ranked
      assert.deepEqual(payload.symbols, ["AAA/USD", "BBB/USD"]);
      const onDisk = JSON.parse(readFileSync(dynamicPath, "utf-8"));
      assert.deepEqual(onDisk.symbols, ["AAA/USD", "BBB/USD"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("caps promotion at MAX_PROMOTED", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-scout-test-"));
    try {
      const dynamicPath = path.join(dir, "wd.json");
      const syms = Array.from({ length: 6 }, (_, i) => `S${i}/USD`);
      const payload = await scout.scan({
        getUniverseFn: async () => syms,
        dailyUptrendFn: async () => true,
        confluenceFn: async () => 4.5,
        dynamicPath,
      });
      assert.equal(payload.symbols.length, scout.MAX_PROMOTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a per-symbol exception is skipped, not fatal to the scan", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-scout-test-"));
    try {
      const dynamicPath = path.join(dir, "wd.json");
      const payload = await scout.scan({
        getUniverseFn: async () => ["OK/USD", "BAD/USD"],
        dailyUptrendFn: async (s) => {
          if (s === "BAD/USD") throw new Error("boom");
          return true;
        },
        confluenceFn: async () => 5.0,
        dynamicPath,
      });
      assert.deepEqual(payload.symbols, ["OK/USD"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ageHours / promotedSymbols", () => {
  test("ageHours is Infinity when the file is missing", () => {
    assert.equal(scout.ageHours("/definitely/not/a/real/path.json"), Infinity);
  });

  test("ageHours computes elapsed time from the generated timestamp", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-scout-test-"));
    try {
      const file = path.join(dir, "wd.json");
      const now = new Date("2026-07-19T12:00:00Z");
      const generated = new Date("2026-07-19T09:00:00Z"); // 3 hours earlier
      writeFileSync(file, JSON.stringify({ generated: generated.toISOString().replace(/\.\d{3}Z$/, "Z") }), "utf-8");
      const age = scout.ageHours(file, now);
      assert.ok(Math.abs(age - 3) < 1e-9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("promotedSymbols rescans when stale and returns the fresh list", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-scout-test-"));
    try {
      const dynamicPath = path.join(dir, "wd.json");
      await scout.scan({
        getUniverseFn: async () => ["AAA/USD"],
        dailyUptrendFn: async () => true,
        confluenceFn: async () => 5.0,
        dynamicPath,
      });
      const syms = await scout.promotedSymbols({ refresh: true, dynamicPath });
      assert.deepEqual(syms, ["AAA/USD"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("promotedSymbols returns [] when the file is unreadable and refresh is off", async () => {
    const syms = await scout.promotedSymbols({ refresh: false, dynamicPath: "/definitely/not/a/real/path.json" });
    assert.deepEqual(syms, []);
  });
});
