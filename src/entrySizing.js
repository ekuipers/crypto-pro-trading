// src/entrySizing.js
//
// ATR-based 1%-risk entry sizing, shared by evaluateSymbol.js's normal
// entry path and rotation.js's rotation-in leg -- a faithful port of
// scripts/run_evaluation.py's compute_entry_qty()/symbol_cap()/_load_caps().

// Multi-tenant Phase 3: both functions take a trailing resolved-config
// object. It defaults to DEFAULT_CFG (the compiled config.json values), so
// every existing caller and the CLI path behave exactly as before.

import { DEFAULT_CFG, cfgSymbolCap } from "./userConfig.js";

/** Position cap fraction for `symbol` (e.g. 0.30 for BTC/USD), 0.05 default. */
export function symbolCap(symbol, cfg = DEFAULT_CFG) {
  return cfgSymbolCap(cfg, symbol);
}

/**
 * ATR-based 1%-risk sizing capped at the per-symbol cap. `riskMult` scales
 * the risk budget for the streak throttle (and, once ported, conviction
 * sizing); the per-symbol hard cap is never scaled.
 */
export function computeEntryQty(equity, symbol, price, atrVal, riskMult = 1.0, cfg = DEFAULT_CFG) {
  const symCapPct = symbolCap(symbol, cfg);
  const hardCap = Math.round(((equity * symCapPct) / price) * 0.99 * 1e4) / 1e4;
  if (atrVal && atrVal > 0) {
    const maxRisk = equity * cfg.RISK_PER_TRADE_PCT * riskMult;
    const stopDist = atrVal * cfg.ATR_MULTIPLIER;
    const rawQty = Math.round((maxRisk / stopDist) * 0.99 * 1e4) / 1e4;
    return Math.min(rawQty, hardCap);
  }
  return Math.min(Math.round(((equity * cfg.FALLBACK_SIZE_PCT * riskMult) / price) * 0.99 * 1e4) / 1e4, hardCap);
}
