// src/strategyConfig.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as strategyConfig from "./strategyConfig.js";
import { assertNotShipped } from "./strategyConfig.js";

describe("live config matches the documented default-config assumptions", () => {
  test("the ships-OFF extras are actually off in the live config.json", () => {
    assert.equal(strategyConfig.PYRAMID_ENABLED, false);
    assert.equal(strategyConfig.CONVICTION_SIZING_ENABLED, false);
    assert.equal(strategyConfig.MEASURED_MOVE_ENABLED, false);
    assert.equal(strategyConfig.BREADTH_GATE_ENABLED, false);
  });

  test("shorts are disabled (Alpaca spot crypto cannot short)", () => {
    assert.equal(strategyConfig.SHORTS_ENABLED, false);
  });
});

describe("assertNotShipped", () => {
  test("is a silent no-op when the flag is false", () => {
    assert.doesNotThrow(() => assertNotShipped("strategy.pyramid_enabled", false, "shouldPyramid"));
  });

  test("throws a clear error naming the flag and the missing function when true", () => {
    assert.throws(
      () => assertNotShipped("strategy.pyramid_enabled", true, "shouldPyramid"),
      /strategy\.pyramid_enabled.*shouldPyramid/s
    );
  });
});
