// src/scoreParity.test.js
//
// CLAUDE.md's scoring invariants require that the dashboard's calcSignalScore()
// (src/js/ta-lib.js) and the engine's signalScore() (src/indicators.js) stay
// identical to each other. Until now nothing enforced that — the rule lived
// only in prose, and the two files are in different module systems, which is
// exactly the kind of split that drifts silently.
//
// ta-lib.js is a classic global script, so it is evaluated in a vm context and
// its top-level function declarations are read back out. It loads standalone:
// nothing in it touches window/document at definition time.
//
// Scope: the full 6-point score. calcSignalScore takes bar OBJECTS while
// signalScore takes PARALLEL ARRAYS, so `fixture()` below is the translator
// that feeds both from one generated series. Fixtures come from a seeded PRNG
// so any failure is reproducible from the seed printed in the assertion.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import * as ind from "./indicators.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDashboardTaLib() {
  const src = readFileSync(path.join(here, "js", "ta-lib.js"), "utf8");
  const ctx = vm.createContext({ console, Math, Number, Array, isNaN, NaN, Infinity, JSON });
  vm.runInContext(src, ctx);
  return {
    calcVolRatio: vm.runInContext("calcVolRatio", ctx),
    calcSignalScore: vm.runInContext("calcSignalScore", ctx),
    MIN_TRADED_BARS: vm.runInContext("MIN_TRADED_BARS", ctx),
    EMA_CROSS_MIN_BARS: vm.runInContext("EMA_CROSS_MIN_BARS", ctx),
  };
}

// ---- Fixture generation ----------------------------------------------------
// Seeded so a failure is reproducible: the seed is printed in every assertion.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One generated market, in BOTH shapes. This is the translator the parity
 * check needs: `bars` for the dashboard's object API, `arrays` for the
 * engine's parallel-array API, from a single underlying series.
 *
 * @param drift per-bar drift (trend), vol per-bar volatility
 * @param sparseVolume fraction of 15-min bars with no trades — the real
 *   Alpaca crypto shape, 0.02 for BTC through 0.92 for LTC.
 */
function fixture({ seed, n = 120, drift = 0, vol = 0.01, sparseVolume = 0, n4h = 120, nDaily = 90 }) {
  const rnd = mulberry32(seed);
  const walk = (count, start, d, v) => {
    const out = [];
    let price = start;
    for (let i = 0; i < count; i++) {
      price = Math.max(0.01, price * (1 + d + (rnd() - 0.5) * 2 * v));
      out.push(price);
    }
    return out;
  };

  const closes = walk(n, 100, drift, vol);
  const highs = closes.map((c) => c * (1 + rnd() * vol));
  const lows = closes.map((c) => c * (1 - rnd() * vol));
  const volumes = closes.map(() => (rnd() < sparseVolume ? 0 : 50 + rnd() * 500));
  const closes4h = walk(n4h, 100, drift * 4, vol * 2);
  const closesDaily = walk(nDaily, 100, drift * 8, vol * 3);

  return {
    arrays: { closes, highs, lows, volumes, closes4h },
    bars: {
      bars15: closes.map((c, i) => ({ c, h: highs[i], l: lows[i], v: volumes[i] })),
      bars4h: closes4h.map((c) => ({ c })),
      barsDaily: closesDaily.map((c) => ({ c })),
    },
  };
}

/** Both scores for one fixture, rounded the way the dashboard already rounds. */
function bothScores(dash, f) {
  const engine = ind.signalScore(f.arrays.closes, {
    volumes: f.arrays.volumes,
    highs: f.arrays.highs,
    lows: f.arrays.lows,
    closes4h: f.arrays.closes4h,
  });
  const dashboard = dash.calcSignalScore(f.bars.bars15, f.bars.bars4h, f.bars.barsDaily);
  return {
    engine: Math.round(engine.score * 10) / 10,
    dashboard: Math.round(dashboard.score * 10) / 10,
    engineParts: engine.parts,
    dashboardSignals: dashboard.signals,
  };
}

describe("dashboard/engine volume-scoring parity", () => {
  const dash = loadDashboardTaLib();

  // 20-bar baseline with `traded` non-empty bars, then the bar being measured.
  const series = (traded, lastVolume) => [
    ...Array.from({ length: 20 }, (_, i) => (i < traded ? 100.0 : 0.0)),
    lastVolume,
  ];

  test("the sparse-tape threshold is the same constant on both sides", () => {
    assert.equal(dash.MIN_TRADED_BARS, ind.MIN_TRADED_BARS);
  });

  test("config.json is the single source of truth for the volume constants", () => {
    // Both implementations carry their own literal — indicators.js is a
    // deliberately config-free pure module, and ta-lib.js needs a value before
    // config.json has loaded in the browser. That is fine as long as they
    // cannot silently drift from the file the dashboard actually seeds from,
    // which is what this pins. Raised by the market-researcher pass: the
    // constant was absent from config.json entirely, breaking the
    // "STRAT_CFG seeded from config.json" invariant it sits next to.
    const cfgJson = JSON.parse(readFileSync(path.join(here, "..", "config.json"), "utf8"));
    assert.equal(cfgJson.indicators.min_traded_bars, ind.MIN_TRADED_BARS,
      "config.json › indicators.min_traded_bars must match indicators.js");
    assert.equal(cfgJson.indicators.min_traded_bars, dash.MIN_TRADED_BARS,
      "config.json › indicators.min_traded_bars must match ta-lib.js's fallback");
    // volume_period sat in config.json unread for the life of the file; pin it
    // to volumeRatio's default so it is either honoured or visibly wrong.
    assert.equal(cfgJson.indicators.volume_period, 20,
      "volumeRatio()'s period default is 20 — change both or neither");
  });

  test("both agree across the full traded-bar range", () => {
    for (let traded = 0; traded <= 20; traded++) {
      for (const lastVolume of [0.0, 1.0, 100.0, 5000.0]) {
        const volumes = series(traded, lastVolume);
        const engine = ind.volumeRatio(volumes);
        const dashboard = dash.calcVolRatio(volumes);
        assert.equal(
          engine === null,
          dashboard === null,
          `null-ness differs at traded=${traded} last=${lastVolume}: engine=${engine} dashboard=${dashboard}`,
        );
        if (engine !== null) {
          assert.ok(
            Math.abs(engine - dashboard) < 1e-12,
            `ratio differs at traded=${traded} last=${lastVolume}: ${engine} vs ${dashboard}`,
          );
        }
      }
    }
  });

  test("both decline to score the real LTC/DOGE shape", () => {
    // Measured 2026-07-29: LTC 92% of 15-min bars empty, DOGE 80%.
    for (const traded of [1, 2, 4]) {
      assert.equal(ind.volumeRatio(series(traded, 0.0)), null);
      assert.equal(dash.calcVolRatio(series(traded, 0.0)), null);
      assert.equal(ind.volumeRatio(series(traded, 5000.0)), null);
      assert.equal(dash.calcVolRatio(series(traded, 5000.0)), null);
    }
  });

  test("both still score the real BTC/ETH shape", () => {
    // BTC 2% empty, ETH 9% empty — the tape is real, so the signal stands.
    for (const traded of [18, 19, 20]) {
      assert.ok(ind.volumeRatio(series(traded, 5000.0)) !== null);
      assert.ok(dash.calcVolRatio(series(traded, 5000.0)) !== null);
    }
  });

  test("both apply the same score bands to the ratio they produce", () => {
    // The bands live in each caller (>=1.2 => +1, <0.7 => -0.5), so this pins
    // the ratio either side of both edges rather than the branch itself.
    const dense = (last) => series(20, last);
    for (const [last, expectBand] of [[5000.0, "high"], [100.0, "mid"], [1.0, "low"]]) {
      const engine = ind.volumeRatio(dense(last));
      const dashboard = dash.calcVolRatio(dense(last));
      const band = (v) => (v >= 1.2 ? "high" : v < 0.7 ? "low" : "mid");
      assert.equal(band(engine), expectBand);
      assert.equal(band(engine), band(dashboard));
    }
  });
});

describe("dashboard/engine FULL 6-point score parity", () => {
  const dash = loadDashboardTaLib();

  test("scores match across 200 randomly generated markets", () => {
    const mismatches = [];
    for (let seed = 1; seed <= 200; seed++) {
      // Sweep the regimes the score is meant to discriminate between, and the
      // real range of Alpaca tape density (BTC 2% empty .. LTC 92% empty).
      const drift = ((seed % 5) - 2) * 0.004; // -0.8% .. +0.8% per bar
      const vol = 0.004 + (seed % 7) * 0.004;
      const sparseVolume = (seed % 10) / 10;
      const f = fixture({ seed, drift, vol, sparseVolume });
      const { engine, dashboard } = bothScores(dash, f);
      if (engine !== dashboard) {
        mismatches.push(`seed=${seed} drift=${drift} vol=${vol} sparse=${sparseVolume}: engine=${engine} dashboard=${dashboard}`);
      }
    }
    assert.deepEqual(mismatches, [], `score parity broken:\n${mismatches.join("\n")}`);
  });

  test("scores match at the data-sufficiency edges", () => {
    // Around 51 bars (EMA-50 cross), 21 volumes (volume ratio), 51 4H bars.
    for (const n of [20, 21, 50, 51, 52, 60]) {
      for (const n4h of [50, 51, 52]) {
        const f = fixture({ seed: 900 + n + n4h, n, n4h, drift: 0.003 });
        const { engine, dashboard } = bothScores(dash, f);
        assert.equal(engine, dashboard, `n=${n} n4h=${n4h}: engine=${engine} dashboard=${dashboard}`);
      }
    }
  });

  test("scores stay in the documented -6..+6 range on both sides", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const f = fixture({ seed, drift: ((seed % 3) - 1) * 0.01, vol: 0.02, sparseVolume: (seed % 5) / 5 });
      const { engine, dashboard } = bothScores(dash, f);
      for (const [which, s] of [["engine", engine], ["dashboard", dashboard]]) {
        assert.ok(s >= -6 && s <= 6, `${which} score ${s} out of range at seed=${seed}`);
      }
    }
  });

  test("the daily regime is computed but never folded into the score", () => {
    // calcSignalScore returns dailyRegime alongside the score; signalScore
    // doesn't take daily bars at all. If the dashboard ever started scoring it,
    // the two would silently diverge by up to a point — and CLAUDE.md's rule
    // that ADX/OBV/daily stay out of the 6-point score would be broken.
    const f = fixture({ seed: 4242, drift: 0.005 });
    const base = dash.calcSignalScore(f.bars.bars15, f.bars.bars4h, f.bars.barsDaily);
    const noDaily = dash.calcSignalScore(f.bars.bars15, f.bars.bars4h, []);
    // Same 15m/4h input, wildly different daily input => same score.
    const invertedDaily = dash.calcSignalScore(
      f.bars.bars15,
      f.bars.bars4h,
      f.bars.barsDaily.map((b, i) => ({ c: 1000 - i })),
    );
    assert.equal(base.score, noDaily.score);
    assert.equal(base.score, invertedDaily.score);
    assert.notEqual(base.dailyRegime, undefined, "dailyRegime must still be reported");
  });

  test("the sparse-tape guard moves BOTH sides identically", () => {
    // The regression this whole file was written for: a fix applied to one
    // implementation and not the other.
    for (const sparseVolume of [0, 0.3, 0.5, 0.6, 0.75, 0.92, 1]) {
      const f = fixture({ seed: 777, sparseVolume, drift: 0.002 });
      const { engine, dashboard, engineParts, dashboardSignals } = bothScores(dash, f);
      assert.equal(engine, dashboard, `sparse=${sparseVolume}: engine=${engine} dashboard=${dashboard}`);
      // And they agree on WHETHER volume scored, not just on the total.
      const engineScored = !engineParts.volume.startsWith("n/a");
      const dashboardScored = dashboardSignals.volume !== "0 –";
      assert.equal(engineScored, dashboardScored, `sparse=${sparseVolume}: volume-scored differs`);
    }
  });
});

describe("EMA-cross bar threshold — the divergence this file was extended to catch", () => {
  const dash = loadDashboardTaLib();

  test("both sides require slow + 1 bars before scoring an EMA cross", () => {
    // Found 2026-07-29: emaArr() yields a value at exactly 50 bars, but that
    // value is still just the SMA seed. The engine's emaCrossState() has always
    // required 51. The dashboard now matches, on signals 1 and 6 both.
    assert.equal(dash.EMA_CROSS_MIN_BARS, 51);
    assert.equal(ind.emaCrossState(Array.from({ length: 50 }, (_, i) => 100 + i)), null);
    assert.notEqual(ind.emaCrossState(Array.from({ length: 51 }, (_, i) => 100 + i)), null);
  });

  test("a 50-bar series scores neither the 15-min cross nor the 4H regime", () => {
    const f = fixture({ seed: 31337, n: 50, n4h: 50, drift: 0.004 });
    const { engine, dashboard, engineParts, dashboardSignals } = bothScores(dash, f);
    assert.equal(engine, dashboard);
    assert.match(engineParts.emaCross, /n\/a/);
    assert.match(engineParts.regime4h, /n\/a/);
    // Both sides must say "we couldn't look", not "we looked and it's level".
    assert.match(dashboardSignals.ema_cross, /n\/a/);
    assert.match(dashboardSignals.regime4h, /n\/a/);
  });

  test("one bar more and both score it", () => {
    const f = fixture({ seed: 31337, n: 51, n4h: 51, drift: 0.004 });
    const { engine, dashboard, engineParts } = bothScores(dash, f);
    assert.equal(engine, dashboard);
    assert.doesNotMatch(engineParts.emaCross, /n\/a/);
    assert.doesNotMatch(engineParts.regime4h, /n\/a/);
  });
});
