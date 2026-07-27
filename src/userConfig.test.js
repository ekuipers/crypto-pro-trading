// src/userConfig.test.js
//
// Multi-tenant Phase 3. Two things are under test here, and the second one
// matters more than the first:
//
//   1. That validation rejects what it should -- especially anything that
//      would breach a CLAUDE.md "Hard rules -- never break" bound, since a
//      stored jsonb row is attacker-influenced input on the path to a real
//      (paper) order.
//   2. That the *engine* actually honours a resolved per-user cfg, and that
//      omitting one leaves behaviour bit-identical to the pre-Phase-3 code.
//      A merged-cfg design fails silently when a call site is left
//      unthreaded, so these are the tests that would catch that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CFG,
  CONFIG_SPEC,
  EDITABLE_KEYS,
  validateOverrides,
  mergeConfig,
  cfgSymbolCap,
  resolveConfigForUser,
} from "./userConfig.js";
import { computeEntryQty, symbolCap } from "./entrySizing.js";
import { checkLimitBand, correlationBudgetAllows, shouldStopOut } from "./risk.js";
import { evaluateSymbol } from "./evaluateSymbol.js";

describe("DEFAULT_CFG", () => {
  test("mirrors the live config.json values", () => {
    assert.equal(DEFAULT_CFG.BUY_SCORE_THRESHOLD, 3.5);
    assert.equal(DEFAULT_CFG.BUY_SCORE_HALF_SIZE, 2.5);
    assert.equal(DEFAULT_CFG.MAX_OPEN_POSITIONS, 7);
    assert.equal(DEFAULT_CFG.MAX_POSITIONS_PER_TIER, 5);
    assert.equal(DEFAULT_CFG.LIMIT_BAND_PCT, 0.002);
    assert.equal(DEFAULT_CFG.RISK_PER_TRADE_PCT, 0.01);
    assert.deepEqual(DEFAULT_CFG.TIER1_SYMBOLS, ["BTC/USD", "ETH/USD"]);
    assert.equal(DEFAULT_CFG.PORTFOLIO_CAPS.caps["BTC/USD"], 0.3);
  });

  test("is frozen, so a resolved cfg can never be mutated by a consumer", () => {
    assert.throws(() => {
      "use strict";
      DEFAULT_CFG.BUY_SCORE_THRESHOLD = 0;
    });
  });

  test("every spec key exists in DEFAULT_CFG and vice versa", () => {
    assert.deepEqual(Object.keys(CONFIG_SPEC).sort(), Object.keys(DEFAULT_CFG).sort());
  });
});

describe("validateOverrides — hard rules", () => {
  test("rejects a limit band wider than the 0.2% hard rule", () => {
    const { ok, errors } = validateOverrides({ LIMIT_BAND_PCT: 0.05 });
    assert.equal(ok, false);
    assert.match(errors[0], /LIMIT_BAND_PCT.*limit orders within 0\.2% of ask/);
  });

  test("accepts a limit band tighter than the hard rule", () => {
    const { ok, clean } = validateOverrides({ LIMIT_BAND_PCT: 0.001 });
    assert.equal(ok, true);
    assert.equal(clean.LIMIT_BAND_PCT, 0.001);
  });

  test("rejects risk-per-trade above the 2% ceiling", () => {
    assert.equal(validateOverrides({ RISK_PER_TRADE_PCT: 0.5 }).ok, false);
  });

  test("rejects a correlation budget above 7 total / 5 per tier", () => {
    assert.equal(validateOverrides({ MAX_OPEN_POSITIONS: 20 }).ok, false);
    assert.equal(validateOverrides({ MAX_POSITIONS_PER_TIER: 6 }).ok, false);
  });

  test("rejects a swing-low stop deeper than 8% below entry", () => {
    assert.equal(validateOverrides({ SWING_LOW_MAX_STOP_PCT: 0.5 }).ok, false);
  });

  test("rejects a per-symbol cap above 30%", () => {
    const { ok, errors } = validateOverrides({ PORTFOLIO_CAPS: { caps: { "DOGE/USD": 0.9 } } });
    assert.equal(ok, false);
    assert.match(errors[0], /DOGE\/USD/);
  });
});

describe("validateOverrides — locked keys", () => {
  test("shorts cannot be enabled (Alpaca crypto is spot-only)", () => {
    const { ok, errors } = validateOverrides({ SHORTS_ENABLED: true });
    assert.equal(ok, false);
    assert.match(errors[0], /not user-configurable/);
  });

  test("every unported ships-OFF flag is rejected", () => {
    for (const key of [
      "PYRAMID_ENABLED",
      "CONVICTION_SIZING_ENABLED",
      "MEASURED_MOVE_ENABLED",
      "BREADTH_GATE_ENABLED",
      "MAKER_FIRST_ENTRIES",
      "TRAIL_MODE",
    ]) {
      assert.equal(validateOverrides({ [key]: true }).ok, false, `${key} should be locked`);
    }
  });

  test("the streak throttle cannot be switched off", () => {
    assert.equal(validateOverrides({ STREAK_THROTTLE_ENABLED: false }).ok, false);
  });

  test("no locked key appears in EDITABLE_KEYS", () => {
    for (const key of EDITABLE_KEYS) assert.equal(CONFIG_SPEC[key].locked, undefined);
    assert.ok(EDITABLE_KEYS.includes("BUY_SCORE_THRESHOLD"));
    assert.ok(!EDITABLE_KEYS.includes("SHORTS_ENABLED"));
  });
});

describe("validateOverrides — shape and typos", () => {
  test("an unknown key is an error, not a silent no-op", () => {
    const { ok, errors } = validateOverrides({ BUY_SCORE_TRESHOLD: 4 });
    assert.equal(ok, false);
    assert.match(errors[0], /unknown setting/);
  });

  test("a string where a number belongs is rejected", () => {
    assert.equal(validateOverrides({ BUY_SCORE_THRESHOLD: "4.0" }).ok, false);
  });

  test("a boolean is not coerced to a number", () => {
    assert.equal(validateOverrides({ BUY_SCORE_THRESHOLD: true }).ok, false);
  });

  test("NaN and Infinity are rejected", () => {
    assert.equal(validateOverrides({ MAX_HOLD_HOURS: Number.POSITIVE_INFINITY }).ok, false);
    assert.equal(validateOverrides({ MAX_HOLD_HOURS: "nope" }).ok, false);
  });

  test("a non-object config is rejected", () => {
    assert.equal(validateOverrides([1, 2]).ok, false);
    assert.equal(validateOverrides("hi").ok, false);
  });

  test("null/undefined mean 'no overrides', not an error", () => {
    assert.equal(validateOverrides(null).ok, true);
    assert.equal(validateOverrides(undefined).ok, true);
  });

  test("enum and symbol-array types are checked", () => {
    assert.equal(validateOverrides({ STOP_LOSS_MODE: "vibes" }).ok, false);
    assert.equal(validateOverrides({ STOP_LOSS_MODE: "fixed" }).ok, true);
    assert.equal(validateOverrides({ TIER1_SYMBOLS: [1, 2] }).ok, false);
    assert.deepEqual(validateOverrides({ TIER1_SYMBOLS: ["btc/usd"] }).clean.TIER1_SYMBOLS, ["BTC/USD"]);
  });
});

describe("validateOverrides — cross-field contradictions", () => {
  test("the half-size gate may not exceed the full-size gate", () => {
    const { ok, errors } = validateOverrides({ BUY_SCORE_HALF_SIZE: 5, BUY_SCORE_THRESHOLD: 3 });
    assert.equal(ok, false);
    assert.match(errors.join(" "), /BUY_SCORE_HALF_SIZE/);
  });

  test("per-tier may not exceed the total budget", () => {
    assert.equal(validateOverrides({ MAX_OPEN_POSITIONS: 2, MAX_POSITIONS_PER_TIER: 5 }).ok, false);
  });

  test("a throttle that can never release is rejected", () => {
    assert.equal(
      validateOverrides({ STREAK_THROTTLE_DD_PCT: 0.05, STREAK_THROTTLE_RECOVER_DD_PCT: 0.09 }).ok,
      false
    );
  });

  test("a trail wider than the hard stop is rejected", () => {
    assert.equal(validateOverrides({ TRAILING_STOP_TRAIL_PCT: 0.09, STOP_LOSS_PCT: 0.05 }).ok, false);
  });

  test("a rejected pair is dropped from `clean`, not just reported", () => {
    // mergeConfig applies `clean` regardless of `ok`, so a cross-field
    // failure that only pushed an error string would still reach the engine.
    const { clean } = validateOverrides({ BUY_SCORE_HALF_SIZE: 5, BUY_SCORE_THRESHOLD: 3 });
    assert.equal(clean.BUY_SCORE_HALF_SIZE, undefined);
    assert.equal(clean.BUY_SCORE_THRESHOLD, undefined);

    const { cfg } = mergeConfig({ BUY_SCORE_HALF_SIZE: 5, BUY_SCORE_THRESHOLD: 3 });
    assert.equal(cfg.BUY_SCORE_HALF_SIZE, DEFAULT_CFG.BUY_SCORE_HALF_SIZE);
    assert.equal(cfg.BUY_SCORE_THRESHOLD, DEFAULT_CFG.BUY_SCORE_THRESHOLD);
  });
});

describe("validateOverrides — prototype keys", () => {
  test("__proto__ and constructor are reported as unknown, not silently ignored", () => {
    const { ok, errors } = validateOverrides(JSON.parse('{"__proto__": 1, "constructor": 2}'));
    assert.equal(ok, false);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((e) => /unknown setting/.test(e)));
  });

  test("a prototype-named key cannot pollute the resolved cfg", () => {
    const { cfg } = mergeConfig(JSON.parse('{"__proto__": {"polluted": true}}'));
    assert.equal(cfg.polluted, undefined);
    assert.equal({}.polluted, undefined, "Object.prototype must be untouched");
  });

  test("a cap keyed __proto__ never becomes a position-cap fraction", () => {
    const { cfg } = mergeConfig(JSON.parse('{"PORTFOLIO_CAPS": {"caps": {"__proto__": 0.2}}}'));
    assert.equal(cfgSymbolCap(cfg, "__proto__"), cfg.PORTFOLIO_CAPS.default_cap);
    assert.equal(typeof cfgSymbolCap(cfg, "__proto__"), "number");
  });
});

describe("mergeConfig", () => {
  test("no overrides resolves to exactly DEFAULT_CFG", () => {
    assert.deepEqual(mergeConfig(null).cfg, DEFAULT_CFG);
    assert.deepEqual(mergeConfig({}).cfg, DEFAULT_CFG);
  });

  test("valid overrides win, untouched keys keep their default", () => {
    const { cfg } = mergeConfig({ BUY_SCORE_THRESHOLD: 4.5 });
    assert.equal(cfg.BUY_SCORE_THRESHOLD, 4.5);
    assert.equal(cfg.BUY_SCORE_HALF_SIZE, DEFAULT_CFG.BUY_SCORE_HALF_SIZE);
  });

  test("an invalid key is dropped, not applied, and is reported", () => {
    const { cfg, errors } = mergeConfig({ LIMIT_BAND_PCT: 0.5, BUY_SCORE_THRESHOLD: 4.5 });
    assert.equal(cfg.LIMIT_BAND_PCT, DEFAULT_CFG.LIMIT_BAND_PCT, "out-of-range value must not be applied");
    assert.equal(cfg.BUY_SCORE_THRESHOLD, 4.5, "the valid sibling key still applies");
    assert.equal(errors.length, 1);
  });

  test("portfolio caps merge per symbol rather than replacing the whole table", () => {
    const { cfg } = mergeConfig({ PORTFOLIO_CAPS: { caps: { "SOL/USD": 0.2 } } });
    assert.equal(cfg.PORTFOLIO_CAPS.caps["SOL/USD"], 0.2, "overridden symbol changes");
    assert.equal(cfg.PORTFOLIO_CAPS.caps["BTC/USD"], 0.3, "untouched symbol keeps its default");
  });

  test("the merged cfg is frozen", () => {
    const { cfg } = mergeConfig({ BUY_SCORE_THRESHOLD: 4.5 });
    assert.equal(Object.isFrozen(cfg), true);
  });
});

describe("resolveConfigForUser", () => {
  test("no uid resolves to the defaults without touching the database", async () => {
    const r = await resolveConfigForUser(null, {
      getStrategyConfig: () => assert.fail("must not query for an anonymous caller"),
    });
    assert.equal(r.cfg, DEFAULT_CFG);
    assert.equal(r.source, "default");
  });

  test("a user with no stored row resolves to the defaults", async () => {
    const r = await resolveConfigForUser("u1", { getStrategyConfig: async () => null });
    assert.equal(r.cfg, DEFAULT_CFG);
    assert.equal(r.source, "default");
  });

  test("a stored row is merged over the defaults", async () => {
    const r = await resolveConfigForUser("u1", {
      getStrategyConfig: async () => ({ BUY_SCORE_THRESHOLD: 4.8 }),
    });
    assert.equal(r.cfg.BUY_SCORE_THRESHOLD, 4.8);
    assert.equal(r.cfg.MAX_OPEN_POSITIONS, DEFAULT_CFG.MAX_OPEN_POSITIONS);
    assert.equal(r.source, "user");
  });

  test("a database failure degrades to defaults instead of throwing", async () => {
    const r = await resolveConfigForUser("u1", {
      getStrategyConfig: async () => {
        throw new Error("connection reset");
      },
    });
    assert.equal(r.cfg, DEFAULT_CFG);
    assert.match(r.errors[0], /connection reset/);
  });

  test("a stored row that violates a bound degrades that key to the default", async () => {
    // e.g. a row written before a bound was tightened.
    const r = await resolveConfigForUser("u1", {
      getStrategyConfig: async () => ({ LIMIT_BAND_PCT: 0.9 }),
    });
    assert.equal(r.cfg.LIMIT_BAND_PCT, DEFAULT_CFG.LIMIT_BAND_PCT);
    assert.equal(r.errors.length, 1);
  });
});

// ---------------------------------------------------------------------------
// The part that actually protects the conversion: does the engine honour cfg?
// ---------------------------------------------------------------------------

describe("engine honours a resolved cfg", () => {
  test("risk.js band/stop/budget helpers take the override", () => {
    // 1% away from ask: outside the 0.2% default band, inside a 2% band.
    assert.equal(checkLimitBand(101, 100).ok, false);
    assert.equal(checkLimitBand(101, 100, null, 0.02).ok, true);

    // 6% drawdown: not a stop at the default 5%... it is. Use 10% instead.
    assert.equal(shouldStopOut(100, 94), true);
    assert.equal(shouldStopOut(100, 94, null, 0.1), false);

    // Tier-1 membership is overridable.
    assert.equal(correlationBudgetAllows("SOL/USD", ["BTC/USD"], 7, 1).allowed, true);
    assert.equal(correlationBudgetAllows("SOL/USD", ["BTC/USD"], 7, 1, ["SOL/USD", "BTC/USD"]).allowed, false);
  });

  test("entry sizing uses the per-user cap and risk budget", () => {
    const { cfg } = mergeConfig({
      RISK_PER_TRADE_PCT: 0.005,
      PORTFOLIO_CAPS: { caps: { "BTC/USD": 0.1 } },
    });
    assert.equal(symbolCap("BTC/USD"), 0.3, "default caller is unchanged");
    assert.equal(symbolCap("BTC/USD", cfg), 0.1, "per-user cap applies");
    assert.equal(cfgSymbolCap(cfg, "NEW/USD"), 0.05, "unknown symbol falls back to default_cap");

    // Halved risk budget halves the ATR-derived qty (below the hard cap).
    const base = computeEntryQty(100_000, "BTC/USD", 80_000, 5_000);
    const halved = computeEntryQty(100_000, "BTC/USD", 80_000, 5_000, 1.0, cfg);
    assert.ok(halved < base);
    assert.equal(halved, Math.round((100_000 * 0.005) / (5_000 * 1.5) * 0.99 * 1e4) / 1e4);
  });

  test("evaluateSymbol blocks an entry that the default config would take", async () => {
    // Score 3.0 clears the default half-size gate (2.5) but not a raised one.
    const deps = makeFlatEntryDeps(3.0);
    const openSymbols = [];

    const dflt = await evaluateSymbol("SOL/USD", {}, {}, openSymbols, { deps });
    assert.equal(dflt.action, "BUY", "baseline behaviour is unchanged when no cfg is passed");

    const { cfg } = mergeConfig({ BUY_SCORE_THRESHOLD: 5, BUY_SCORE_HALF_SIZE: 4.5 });
    const strict = await evaluateSymbol("SOL/USD", {}, {}, openSymbols, { deps: { ...deps, cfg } });
    assert.equal(strict.action, "HOLD", "the per-user gate blocks the same setup");
    assert.match(strict.reason, /no entry: score=3\.0/);
  });

  test("evaluateSymbol honours a per-user correlation budget", async () => {
    const deps = makeFlatEntryDeps(4.0);
    const { cfg } = mergeConfig({ MAX_OPEN_POSITIONS: 1, MAX_POSITIONS_PER_TIER: 1 });
    const d = await evaluateSymbol("SOL/USD", {}, {}, ["LINK/USD"], { deps: { ...deps, cfg } });
    assert.equal(d.action, "HOLD");
    assert.match(d.reason, /BLOCKED: correlation budget: 1\/1/);
  });
});

/** Minimal dep set that drives evaluateSymbol down the flat-entry path. */
function makeFlatEntryDeps(score) {
  const bars = Array.from({ length: 120 }, (_, i) => ({ c: 100 + i * 0.01, h: 101, l: 99, v: 1000 }));
  return {
    getLatestQuote: async () => ({ ap: 100, bp: 99.9 }),
    getCryptoBars: async () => bars,
    getCryptoBars4h: async () => bars,
    getCryptoBarsDaily: async () => Array.from({ length: 60 }, () => ({ c: 100 })),
    getOpenOrders: async () => [],
    cancelOrder: async () => true,
    getAccount: async () => ({ equity: 100_000 }),
    sessionPenaltyActive: async () => false,
    ind: {
      signalScore: () => ({ score, parts: {} }),
      bollinger: () => [95, 100, 105],
      atr: () => 1.0,
      // Neutral daily regime ("mixed") so only the score gate decides.
      sma: (_c, p) => (p === 20 ? 100 : 100),
    },
  };
}
