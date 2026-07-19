// src/strategyConfig.js
//
// Strategy-level thresholds read directly from config.json > strategy/costs
// -- module-level constants in scripts/run_evaluation.py that don't live in
// risk.py (score thresholds, sizing fallbacks, and the ships-OFF
// "famous-trader package" feature flags). Loaded once at import time, same
// pattern as risk.js/apiClient.js.
//
// The five flags below (PYRAMID_ENABLED, CONVICTION_SIZING_ENABLED,
// MEASURED_MOVE_ENABLED, BREADTH_GATE_ENABLED, and TRAIL_MODE=="chandelier")
// gate Python functions that are NOT yet ported to risk.js (should_pyramid,
// conviction_risk_multiplier, measured_move_target, breadth_pct/
// breadth_policy, chandelier_trail_pct) -- see risk.js's scope note. All of
// them are `false`/"fixed" in the live config.json, so the gated code paths
// never fire in production today. Rather than write speculative untested
// branches against functions that don't exist, evaluateSymbol.js/runEvaluation.js
// fail loudly (assertNotShipped) if one of these flags is ever flipped on
// before its risk.js counterpart is ported, instead of silently
// misbehaving or throwing a confusing ReferenceError deep in a branch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

export const CFG = loadConfig();
const _strategy = CFG.strategy || {};
const _costs = CFG.costs || {};

export const BUY_SCORE_THRESHOLD = Number(_strategy.buy_score_threshold ?? 4.0);
export const BUY_SCORE_HALF_SIZE = Number(_strategy.buy_score_half_size_threshold ?? 3.0);
export const SELL_SCORE_THRESHOLD = Number(_strategy.sell_score_threshold ?? -2.0);
export const SHORT_SCORE_THRESHOLD = Number(_strategy.short_score_threshold ?? -4.0);
export const SHORT_SCORE_HALF_SIZE = Number(_strategy.short_score_half_size_threshold ?? -3.0);
export const COVER_SCORE_THRESHOLD = Number(_strategy.cover_score_threshold ?? 2.0);
export const DOWNTREND_LONG_SCORE = Number(_strategy.downtrend_long_score_threshold ?? 4.0);
export const ATR_MULTIPLIER = Number(_strategy.atr_multiplier ?? 1.5);
export const RISK_PER_TRADE_PCT = Number(_strategy.risk_per_trade_pct ?? 0.01);
export const FALLBACK_SIZE_PCT = Number(_strategy.fallback_size_pct ?? 0.02);
export const SESSION_FILTER_ENABLED = Boolean(_strategy.session_filter_enabled ?? false);
export const SESSION_MIN_SAMPLE = Number(_strategy.session_min_sample ?? 20);
export const SHORTS_ENABLED = Boolean(_strategy.shorts_enabled ?? false);

// Not-yet-ported ships-OFF extras (see header note above).
export const PYRAMID_ENABLED = Boolean(_strategy.pyramid_enabled ?? false);
export const PYRAMID_MAX_TRANCHES = Number(_strategy.pyramid_max_tranches ?? 2);
export const PYRAMID_ADX_MIN = Number(_strategy.pyramid_adx_min ?? 25.0);
export const CONVICTION_SIZING_ENABLED = Boolean(_strategy.conviction_sizing_enabled ?? false);
export const CONVICTION_HIGH_SCORE = Number(_strategy.conviction_high_score ?? 5.0);
export const MEASURED_MOVE_ENABLED = Boolean(_strategy.measured_move_enabled ?? false);
export const MEASURED_MOVE_ADX_MIN = Number(_strategy.measured_move_adx_min ?? 25.0);
export const BREADTH_GATE_ENABLED = Boolean(_strategy.breadth_gate_enabled ?? false);
export const BREADTH_LOW_PCT = Number(_strategy.breadth_low_pct ?? 0.3);

export const MAKER_FIRST_ENTRIES = Boolean(_costs.maker_first_entries ?? false);

/**
 * Throw a clear "not yet ported" error if a ships-OFF flag this Node port
 * doesn't implement has been switched on, instead of silently running a
 * dead/incomplete branch or throwing a confusing ReferenceError deep inside
 * one. Call at the point where Python would have used the gated function.
 */
export function assertNotShipped(flagName, flagValue, missingFn) {
  if (flagValue) {
    throw new Error(
      `${flagName} is enabled in config.json, but ${missingFn}() is not yet ported to the Node engine (src/risk.js) -- ` +
        `see risk.js's scope note. Port it before enabling this flag, or revert it to false.`
    );
  }
}
