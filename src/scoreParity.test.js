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
// Scope: the VOLUME component, added 2026-07-29 alongside the sparse-tape
// guard. Extending this file to the full 6-point score is worth doing and is
// deliberately not attempted here — calcSignalScore takes bar objects while
// signalScore takes parallel arrays, so a faithful comparison needs a fixture
// translator, which is a bigger piece of work than the fix it would guard.

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
    MIN_TRADED_BARS: vm.runInContext("MIN_TRADED_BARS", ctx),
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
