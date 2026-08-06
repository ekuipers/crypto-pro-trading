// src/rrAndStopParity.test.js
//
// ROADMAP item 4 ("Parity coverage stops at the score"): scoreParity.test.js
// pins the 6-point score, but two other pieces of the engine are separately
// re-implemented in the dashboard and were, until now, untested — the net R:R
// entry gate (risk.js's netRr()/roundTripCostPct(), dashboard's
// src/js/strategy-config.js netRrPct()/roundTripCostPct(), consumed by
// autopilot.js and tabs-signals.js) and the escalated stop-loss limit band
// (risk.js's stopLossLimitPrice(), dashboard's escalatedStopBandPct(),
// consumed by autopilot.js). Both shipped bugs already lived in this
// uncovered area (the stop-escalation clamp that made stops unfillable, and
// the R:R gate that failed open on exactly the setups it exists to catch) —
// this file extends the same vm-loading technique scoreParity.test.js uses so
// the actual dashboard code is diffed against the actual engine code, not a
// hand-typed copy of either.
//
// strategy-config.js is a classic global script (like ta-lib.js) with no
// window/document references at definition time, so it loads standalone in a
// vm context and its top-level declarations are read back out.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import * as risk from "./risk.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDashboardStrategyConfig() {
  const src = readFileSync(path.join(here, "js", "strategy-config.js"), "utf8");
  const ctx = vm.createContext({ console, Math, Number, Array, isNaN, NaN, Infinity, JSON });
  vm.runInContext(src, ctx);
  return {
    netRrPct: vm.runInContext("netRrPct", ctx),
    roundTripCostPct: vm.runInContext("roundTripCostPct", ctx),
    escalatedStopBandPct: vm.runInContext("escalatedStopBandPct", ctx),
    STRAT_CFG: vm.runInContext("STRAT_CFG", ctx),
  };
}

// ---- Seeded PRNG, same generator scoreParity.test.js uses -----------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("dashboard/engine net R:R gate parity", () => {
  const dash = loadDashboardStrategyConfig();

  test("both sides share the same fee-per-side constant", () => {
    // Feeds roundTripCostPct on both sides -- a drift here would silently
    // shift the round-trip cost model without failing anything else.
    assert.equal(dash.STRAT_CFG.feeBpsPerSide, risk.TAKER_FEE_BPS_PER_SIDE);
  });

  test("both sides share the same soft-gate thresholds", () => {
    assert.equal(dash.STRAT_CFG.minRrFull, risk.MIN_RR_FULL);
    assert.equal(dash.STRAT_CFG.minRrHalf, risk.MIN_RR_HALF);
  });

  test("net R:R matches across randomly generated setups", () => {
    const rnd = mulberry32(1234);
    const mismatches = [];
    for (let i = 0; i < 500; i++) {
      const entry = 10 + rnd() * 990; // $10 - $1000
      const stop = entry * (1 - rnd() * 0.08); // up to 8% below entry, matches SWING_LOW_MAX_STOP_PCT
      // 90% of the time a real upside target above entry; 10% of the time an
      // invalid one (at/below entry) -- exercises the null-geometry path too.
      const target = rnd() > 0.1
        ? entry * (1 + rnd() * 0.05)
        : entry * (1 - rnd() * 0.02);
      const bid = entry * (1 - rnd() * 0.002);
      const ask = entry * (1 + rnd() * 0.002);

      const engineCost = risk.roundTripCostPct(bid, ask, risk.TAKER_FEE_BPS_PER_SIDE);
      // Mirrors autopilot.js's liveSpread computation exactly: (ap-bp)/mid*100.
      const dashSpreadPct = risk.spreadPct(bid, ask) * 100;
      const dashCost = dash.roundTripCostPct(dashSpreadPct);

      const engine = risk.netRr(entry, stop, target, engineCost);
      const dashboard = dash.netRrPct(entry, stop, target, dashCost);

      const engineNull = engine === null;
      const dashboardNull = dashboard === null;
      if (engineNull !== dashboardNull) {
        mismatches.push(
          `i=${i} null-ness differs: engine=${engine} dashboard=${dashboard} (entry=${entry.toFixed(2)} stop=${stop.toFixed(2)} target=${target.toFixed(2)})`,
        );
        continue;
      }
      if (!engineNull && Math.abs(engine - dashboard) > 1e-9) {
        mismatches.push(`i=${i} value differs: engine=${engine} dashboard=${dashboard}`);
      }
    }
    assert.deepEqual(mismatches, [], `net R:R parity broken:\n${mismatches.slice(0, 10).join("\n")}`);
  });

  test("both sides fail closed (null) when the stop is missing, not skip the gate", () => {
    // The exact bug ROADMAP item 4 references: a null geometry must block
    // entry, not silently pass it. entryStop is null precisely when the 4H
    // swing-low can't be computed.
    assert.equal(risk.netRr(100, null, 105, 0.005), null);
    assert.equal(dash.netRrPct(100, null, 105, 0.5), null);
  });

  test("both sides fail closed (null) when there is no upside target", () => {
    // target is null/at-or-below entry precisely when the ask is at or above
    // the BB upper band -- the most extended setups, exactly what the gate
    // exists to catch.
    assert.equal(risk.netRr(100, 95, 100, 0.005), null); // target === entry
    assert.equal(dash.netRrPct(100, 95, 100, 0.5), null);
    assert.equal(risk.netRr(100, 95, 98, 0.005), null); // target < entry
    assert.equal(dash.netRrPct(100, 95, 98, 0.5), null);
  });
});

describe("dashboard/engine escalated stop-loss band parity", () => {
  const dash = loadDashboardStrategyConfig();

  test("both sides share the same escalation cycle/extra constants", () => {
    assert.equal(dash.STRAT_CFG.escalationCycles, risk.STOP_LOSS_ESCALATION_CYCLES);
    assert.ok(
      Math.abs(dash.STRAT_CFG.escalationExtraPct / 100 - risk.STOP_LOSS_ESCALATION_EXTRA_PCT) < 1e-9,
      `escalation extra differs: dashboard=${dash.STRAT_CFG.escalationExtraPct}% engine=${risk.STOP_LOSS_ESCALATION_EXTRA_PCT}`,
    );
  });

  test("the escalated band matches the engine's at the compiled defaults", () => {
    // Regression target: before 2026-07-29, alpacaClient.js clamped every
    // stop back to the BASE band, silently erasing this escalation in the
    // engine while the dashboard's own (unclamped) copy kept working --
    // exactly the kind of one-sided divergence this file exists to catch.
    const engineBand = risk.STOP_LOSS_LIMIT_BAND_PCT + risk.STOP_LOSS_ESCALATION_EXTRA_PCT;
    const dashboardBand = dash.escalatedStopBandPct();
    assert.ok(
      Math.abs(engineBand - dashboardBand) < 1e-9,
      `escalated band differs: engine=${engineBand} dashboard=${dashboardBand}`,
    );
  });

  test("both sides add the escalation extra identically across a sweep of values", () => {
    // Validates the formula's SHAPE (base + extra), not just today's default
    // values -- a change to STOP_LOSS_ESCALATION_EXTRA_PCT alone must still
    // move both sides by the same amount.
    const rnd = mulberry32(99);
    const savedExtra = dash.STRAT_CFG.escalationExtraPct;
    try {
      for (let i = 0; i < 50; i++) {
        const extraFraction = rnd() * 0.01; // 0% - 1%, within CONFIG_SPEC's bound
        dash.STRAT_CFG.escalationExtraPct = extraFraction * 100;
        const dashboardBand = dash.escalatedStopBandPct();
        const engineBand = risk.STOP_LOSS_LIMIT_BAND_PCT + extraFraction;
        assert.ok(
          Math.abs(engineBand - dashboardBand) < 1e-9,
          `i=${i} extra=${extraFraction}: engine=${engineBand} dashboard=${dashboardBand}`,
        );
      }
    } finally {
      dash.STRAT_CFG.escalationExtraPct = savedExtra;
    }
  });
});
