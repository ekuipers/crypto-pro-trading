// src/strategyConfigRoutes.test.js
//
// Covers the pure validation layer of the Phase 6 config editor's write path.
// Same shape as credentialsRoutes.test.js: the Express handlers need a live
// Postgres + session cookie, so the decision that actually matters — what is
// allowed to become a stored trading parameter — lives in a pure function that
// can be pinned down here.
//
// The property under test throughout is REJECT, not degrade. The engine's read
// path (mergeConfig) deliberately drops bad keys so one stale value can't stop
// a running engine; a save the user is watching must do the opposite, or a
// dropped key reads as "saved" while the engine trades the old number.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildConfigUpdate, editableSpec } from "./strategyConfigRoutes.js";
import { CONFIG_SPEC, EDITABLE_KEYS, DEFAULT_CFG, validateOverrides } from "./userConfig.js";

describe("buildConfigUpdate — accepts valid overrides", () => {
  test("stores a clean object for an in-bounds value", () => {
    const built = buildConfigUpdate({ config: { RISK_PER_TRADE_PCT: 0.015 } });
    assert.equal(built.ok, true);
    assert.deepEqual(built.clean, { RISK_PER_TRADE_PCT: 0.015 });
  });

  test("accepts a bare object as well as {config:{...}}", () => {
    const wrapped = buildConfigUpdate({ config: { MAX_OPEN_POSITIONS: 5 } });
    const bare = buildConfigUpdate({ MAX_OPEN_POSITIONS: 5 });
    assert.deepEqual(bare.clean, wrapped.clean);
  });

  test("an empty object clears the overrides rather than erroring", () => {
    const built = buildConfigUpdate({ config: {} });
    assert.equal(built.ok, true);
    assert.deepEqual(built.clean, {});
  });

  test("null/undefined config is treated as 'no overrides'", () => {
    for (const body of [{ config: null }, {}, null, undefined]) {
      const built = buildConfigUpdate(body);
      assert.equal(built.ok, true, `${JSON.stringify(body)} should be accepted`);
      assert.deepEqual(built.clean, {});
    }
  });
});

describe("buildConfigUpdate — rejects rather than silently degrading", () => {
  test("an out-of-bounds value is rejected, not clamped or dropped", () => {
    // The engine's own read path would drop this key and carry on; the save
    // path must refuse, so the user cannot believe a rejected number is live.
    const built = buildConfigUpdate({ config: { RISK_PER_TRADE_PCT: 0.5 } });
    assert.equal(built.ok, false);
    assert.equal(built.status, 400);
    assert.ok(built.errors.some((e) => e.includes("RISK_PER_TRADE_PCT")));
    assert.equal(built.clean, undefined, "a rejected save must not hand back anything storable");
  });

  test("one bad key rejects the whole save, including the good keys beside it", () => {
    const built = buildConfigUpdate({ config: { MAX_OPEN_POSITIONS: 5, RISK_PER_TRADE_PCT: 99 } });
    assert.equal(built.ok, false);
    // Partial application would leave the editor's JSON and the stored row
    // disagreeing with no indication which won.
    assert.equal(built.clean, undefined);
  });

  test("an unknown key is rejected (a typo must not look like it saved)", () => {
    const built = buildConfigUpdate({ config: { RISK_PER_TRADE_PTC: 0.01 } });
    assert.equal(built.ok, false);
    assert.ok(built.errors.some((e) => e.includes("unknown setting")));
  });

  test("a non-object config is rejected", () => {
    for (const bad of [[], [1, 2], "0.01", 42, true]) {
      const built = buildConfigUpdate({ config: bad });
      assert.equal(built.ok, false, `${JSON.stringify(bad)} must be rejected`);
      assert.equal(built.status, 400);
    }
  });

  test("an oversized body is bounded before it becomes an error array", () => {
    const huge = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`K${i}`, 1]));
    const built = buildConfigUpdate({ config: huge });
    assert.equal(built.ok, false);
    assert.equal(built.status, 413);
    assert.equal(built.errors.length, 1, "must not emit one error string per junk key");
  });
});

describe("buildConfigUpdate — the hard rules are not editable through this surface", () => {
  test("locked keys are rejected", () => {
    const locked = Object.keys(CONFIG_SPEC).filter((k) => CONFIG_SPEC[k].locked);
    assert.ok(locked.length > 0, "CONFIG_SPEC must still lock something");
    for (const key of locked) {
      const built = buildConfigUpdate({ config: { [key]: true } });
      assert.equal(built.ok, false, `${key} is locked and must be rejected`);
      assert.ok(built.errors.some((e) => e.includes("not user-configurable")));
    }
  });

  test("shorts stay disabled — no route into re-enabling them", () => {
    const shortKeys = Object.keys(CONFIG_SPEC).filter((k) => /SHORT|SHORTS/.test(k) && CONFIG_SPEC[k].locked);
    for (const key of shortKeys) {
      assert.equal(buildConfigUpdate({ config: { [key]: true } }).ok, false);
    }
  });

  test("CLAUDE.md's numeric hard rules hold at their stated ceilings", () => {
    // Each pair is [key, a value just past the documented limit].
    const overLimit = [
      ["LIMIT_BAND_PCT", 0.01], // hard rule: ≤0.2% from ask
      ["RISK_PER_TRADE_PCT", 0.05], // hard rule: ≤2% risk per trade
      ["MAX_OPEN_POSITIONS", 20], // hard rule: 7 total
      ["MAX_POSITIONS_PER_TIER", 20], // hard rule: 5 per tier
      ["SWING_LOW_MAX_STOP_PCT", 0.5], // hard rule: ≤8% swing-low stop
    ];
    for (const [key, value] of overLimit) {
      const built = buildConfigUpdate({ config: { [key]: value } });
      assert.equal(built.ok, false, `${key}=${value} must be refused`);
    }
  });

  test("a prototype-polluting key is rejected, not resolved off Object.prototype", () => {
    for (const key of ["__proto__", "constructor", "toString"]) {
      const built = buildConfigUpdate({ config: { [key]: 1 } });
      assert.equal(built.ok, false, `${key} must be refused`);
    }
    assert.equal({}.polluted, undefined);
  });

  test("a cross-field contradiction is rejected as a pair", () => {
    // Individually in-bounds, jointly impossible: the throttle could never release.
    const built = buildConfigUpdate({
      config: { STREAK_THROTTLE_DD_PCT: 0.05, STREAK_THROTTLE_RECOVER_DD_PCT: 0.05 },
    });
    assert.equal(built.ok, false);
  });
});

describe("editableSpec — what the editor is told it may set", () => {
  test("exposes exactly the unlocked keys", () => {
    assert.deepEqual(Object.keys(editableSpec()).sort(), [...EDITABLE_KEYS].sort());
  });

  test("leaks no locked key, so the UI can't offer one the API would refuse", () => {
    for (const key of Object.keys(editableSpec())) {
      assert.equal(CONFIG_SPEC[key].locked, undefined, `${key} is locked and must not be offered`);
    }
  });

  test("every advertised key really is settable end-to-end", () => {
    // Guards against the spec and the validator drifting apart: an editor that
    // offers a key the PUT then rejects is a dead control.
    for (const key of EDITABLE_KEYS) {
      const { ok } = validateOverrides({ [key]: DEFAULT_CFG[key] });
      assert.equal(ok, true, `${key} advertised as editable but its own default fails validation`);
    }
  });
});
