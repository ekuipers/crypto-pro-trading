// src/risk.test.js
//
// Port of the assertions in scripts/risk.py's self-test block and
// tests/test_risk.py. Uses Node's built-in test runner (node --test).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as risk from "./risk.js";

describe("position sizing", () => {
  test("maxPositionDollars uses the configured default cap", () => {
    assert.equal(risk.maxPositionDollars(100_000), 100_000 * risk.MAX_POSITION_PCT);
  });
  test("checkPositionSize accepts and rejects at the cap edge", () => {
    assert.ok(risk.checkPositionSize(100_000, 20, 250, 0.05).ok);
    assert.ok(!risk.checkPositionSize(100_000, 21, 250, 0.05).ok);
  });
  test("maxPositionDollars with a custom cap", () => {
    assert.equal(risk.maxPositionDollars(100_000, 0.3), 30_000);
  });
  test("checkPositionSize at a custom cap edge", () => {
    assert.ok(risk.checkPositionSize(100_000, 0.375, 80_000, 0.3).ok);
    assert.ok(!risk.checkPositionSize(100_000, 0.376, 80_000, 0.3).ok);
  });
  test("checkPositionSize rejects non-positive inputs", () => {
    assert.ok(!risk.checkPositionSize(0, 1, 100).ok);
    assert.ok(!risk.checkPositionSize(100_000, 0, 100).ok);
    assert.ok(!risk.checkPositionSize(100_000, 1, 0).ok);
  });
});

describe("limit band", () => {
  test("accepts prices at and within the band", () => {
    assert.ok(risk.checkLimitBand(100.0, 100.0).ok);
    assert.ok(risk.checkLimitBand(100.19, 100.0).ok);
    assert.ok(risk.checkLimitBand(99.81, 100.0).ok);
  });
  test("rejects prices outside the band or non-positive inputs", () => {
    assert.ok(!risk.checkLimitBand(100.5, 100.0).ok);
    assert.ok(!risk.checkLimitBand(0, 100.0).ok);
    assert.ok(!risk.checkLimitBand(100.0, 0).ok);
  });
  test("maker-first: a limit inside the bid-ask spread is accepted", () => {
    assert.ok(risk.checkLimitBand(99.9, 100.5, 99.8).ok);
  });
});

describe("stop-loss", () => {
  test("fixed-pct fallback (no stopPrice supplied)", () => {
    assert.ok(!risk.shouldStopOut(100, 96));
    assert.ok(risk.shouldStopOut(100, 95));
    assert.ok(risk.shouldStopOut(100, 90));
    assert.ok(!risk.shouldStopOut(0, 50));
  });
  test("stopLossPrice matches the configured pct", () => {
    assert.ok(Math.abs(risk.stopLossPrice(100) - 100 * (1 - risk.STOP_LOSS_PCT)) < 1e-9);
  });
  test("explicit stopPrice override", () => {
    assert.ok(risk.shouldStopOut(100, 96.9, 97.0));
    assert.ok(!risk.shouldStopOut(100, 97.1, 97.0));
  });
  test("swing-low stop: lowest low of window, just below it", () => {
    const lows = Array(4).fill([99, 98, 97.5, 98.2, 99.1]).flat();
    const sl = risk.swingLowStopPrice(100, lows, 20, 0.001, 0.08);
    assert.ok(sl !== null && Math.abs(sl - 97.5 * 0.999) < 1e-6);
  });
  test("swing-low stop clamps to maxStopPct below entry", () => {
    const slCap = risk.swingLowStopPrice(100, Array(20).fill(50), 20, 0.001, 0.08);
    assert.ok(Math.abs(slCap - 92.0) < 1e-6);
  });
  test("swing-low stop returns null with insufficient history", () => {
    assert.equal(risk.swingLowStopPrice(100, [99, 98], 20), null);
  });
  test("swing-low stop returns null when the low sits above entry", () => {
    assert.equal(risk.swingLowStopPrice(100, Array(20).fill(101), 20), null);
  });
  test("short cover trigger and stop price", () => {
    assert.ok(!risk.shouldCoverShort(100, 104));
    assert.ok(risk.shouldCoverShort(100, 105));
    assert.ok(risk.shouldCoverShort(100, 110));
    assert.ok(!risk.shouldCoverShort(0, 105));
    assert.ok(Math.abs(risk.shortStopPrice(100) - 100 * (1 + risk.STOP_LOSS_PCT)) < 1e-9);
  });
});

describe("trailing stop", () => {
  test("inactive below the activation threshold", () => {
    assert.ok(!risk.shouldTrailStopOut(100, 100, 98));
    assert.ok(!risk.shouldTrailStopOut(100, 102.5, 100));
  });
  test("fires once activated and price falls through the trail", () => {
    assert.ok(risk.shouldTrailStopOut(100, 110, 106));
  });
  test("guards against a non-positive entry price", () => {
    assert.ok(!risk.shouldTrailStopOut(0, 110, 106));
  });
});

describe("correlation budget", () => {
  test("allows a new entry under both caps", () => {
    const { allowed } = risk.correlationBudgetAllows("SOL/USD", ["BTC/USD", "ETH/USD"], 4, 3);
    assert.ok(allowed);
  });
  test("blocks when the total cap is reached", () => {
    const { allowed, reason } = risk.correlationBudgetAllows(
      "SOL/USD",
      ["BTC/USD", "ETH/USD", "ADA/USD", "DOGE/USD"],
      4,
      3
    );
    assert.ok(!allowed);
    assert.ok(reason.includes("4/4"));
  });
  test("blocks when the Tier-2 per-tier cap is reached", () => {
    const { allowed, reason } = risk.correlationBudgetAllows(
      "SOL/USD",
      ["ADA/USD", "DOGE/USD", "LTC/USD"],
      4,
      3
    );
    assert.ok(!allowed);
    assert.ok(reason.includes("3/3"));
  });
});

describe("daily drawdown gate", () => {
  test("not triggered just under the gate", () => {
    assert.ok(!risk.dailyDrawdownGateTriggered(100_000, 97_001));
  });
  test("triggered at and beyond the gate", () => {
    assert.ok(risk.dailyDrawdownGateTriggered(100_000, 97_000));
    assert.ok(risk.dailyDrawdownGateTriggered(100_000, 90_000));
  });
});

describe("stop-loss limit-price escalation", () => {
  test("escalated band sits further from ask than the base band", () => {
    const lim = risk.stopLossLimitPrice(100.0, 0);
    assert.ok(Math.abs(lim - 99.5) < 0.001);
    const limEsc = risk.stopLossLimitPrice(100.0, 2);
    assert.ok(limEsc < lim);
  });
});

describe("trade economics", () => {
  test("spreadPct as a fraction of mid price", () => {
    assert.ok(Math.abs(risk.spreadPct(99.9, 100.1) - 0.2 / 100.0) < 1e-6);
    assert.equal(risk.spreadPct(0, 100), 0.0);
  });
  test("roundTripCostPct combines fees and spread", () => {
    const rt = risk.roundTripCostPct(99.9, 100.1, 25);
    assert.ok(Math.abs(rt - (0.005 + 0.002)) < 1e-6);
  });
  test("netRr computes reward:risk net of cost", () => {
    const nr = risk.netRr(100, 96, 112, 0.006);
    assert.ok(nr !== null && Math.abs(nr - (12 - 0.6) / 4) < 1e-9);
  });
  test("netRr rejects invalid geometry", () => {
    assert.equal(risk.netRr(100, 104, 112), null);
    assert.equal(risk.netRr(100, 96, 99), null);
  });
});

describe("partial take-profit", () => {
  test("+1R trigger price", () => {
    assert.ok(Math.abs(risk.partialTpTriggerPrice(100, 96, 1.0) - 104) < 1e-9);
  });
  test("fires once past the trigger and not already done", () => {
    assert.ok(risk.shouldPartialTp(100, 104.1, 96, false, 1.0));
    assert.ok(!risk.shouldPartialTp(100, 103.9, 96, false, 1.0));
    assert.ok(!risk.shouldPartialTp(100, 110, 96, true, 1.0));
  });
});

describe("stale-position exit", () => {
  const now = new Date();
  const oldIso = new Date(now.getTime() - 49 * 3600 * 1000).toISOString();
  const newIso = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();

  test("exits an old, unarmed, weak position", () => {
    assert.ok(risk.isStalePosition(oldIso, false, 1.0, 2.5, 48, now));
  });
  test("keeps a recently-opened position", () => {
    assert.ok(!risk.isStalePosition(newIso, false, 1.0, 2.5, 48, now));
  });
  test("exempts an armed trailing stop", () => {
    assert.ok(!risk.isStalePosition(oldIso, true, 1.0, 2.5, 48, now));
  });
  test("exempts a position that clears the score gate", () => {
    assert.ok(!risk.isStalePosition(oldIso, false, 3.0, 2.5, 48, now));
  });
  test("null timestamp never counts as stale", () => {
    assert.ok(!risk.isStalePosition(null, false, 1.0, 2.5, 48, now));
  });
});

describe("rotation gate", () => {
  test("allows rotation when all three conditions clear", () => {
    assert.ok(risk.rotationAllows(4.0, -1.0, 4.0, 2.0));
  });
  test("blocks below the minimum candidate score", () => {
    assert.ok(!risk.rotationAllows(3.5, -1.0, 4.0, 2.0));
  });
  test("blocks when the weakest holding is still positive", () => {
    assert.ok(!risk.rotationAllows(4.0, 0.5, 4.0, 2.0));
  });
  test("blocks when the margin isn't met", () => {
    assert.ok(!risk.rotationAllows(4.0, 2.5, 4.0, 2.0));
  });
  test("blocks on a missing candidate score", () => {
    assert.ok(!risk.rotationAllows(null, -1.0));
  });
});
