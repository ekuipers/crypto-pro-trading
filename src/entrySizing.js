// src/entrySizing.js
//
// ATR-based 1%-risk entry sizing, shared by evaluateSymbol.js's normal
// entry path and rotation.js's rotation-in leg -- a faithful port of
// scripts/run_evaluation.py's compute_entry_qty()/symbol_cap()/_load_caps().

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RISK_PER_TRADE_PCT, FALLBACK_SIZE_PCT, ATR_MULTIPLIER } from "./strategyConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function loadCaps() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf-8"));
    return cfg.portfolio_caps || { caps: {}, default_cap: 0.05 };
  } catch {
    return { caps: {}, default_cap: 0.05 };
  }
}

const CAPS_DATA = loadCaps();

/** Position cap fraction for `symbol` (e.g. 0.30 for BTC/USD), 0.05 default. */
export function symbolCap(symbol) {
  return CAPS_DATA.caps?.[symbol] ?? CAPS_DATA.default_cap ?? 0.05;
}

/**
 * ATR-based 1%-risk sizing capped at the per-symbol cap. `riskMult` scales
 * the risk budget for the streak throttle (and, once ported, conviction
 * sizing); the per-symbol hard cap is never scaled.
 */
export function computeEntryQty(equity, symbol, price, atrVal, riskMult = 1.0) {
  const symCapPct = symbolCap(symbol);
  const hardCap = Math.round(((equity * symCapPct) / price) * 0.99 * 1e4) / 1e4;
  if (atrVal && atrVal > 0) {
    const maxRisk = equity * RISK_PER_TRADE_PCT * riskMult;
    const stopDist = atrVal * ATR_MULTIPLIER;
    const rawQty = Math.round((maxRisk / stopDist) * 0.99 * 1e4) / 1e4;
    return Math.min(rawQty, hardCap);
  }
  return Math.min(Math.round(((equity * FALLBACK_SIZE_PCT * riskMult) / price) * 0.99 * 1e4) / 1e4, hardCap);
}
