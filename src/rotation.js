// src/rotation.js
//
// Position rotation at the correlation budget -- a faithful port of
// scripts/run_evaluation.py's apply_rotation(). When the correlation budget
// blocked a high-confluence candidate while the weakest open holding scores
// <= 0, rotate: SELL the weakest and BUY the candidate in the same cycle.
//
// Mutates the decision objects in `decisions` in place (matching Python's
// dict mutation and this pipeline's existing mutation-heavy design for the
// per-cycle decision list -- see positionState.js's header note for the
// same rationale). Returns a journal note string, or null when no rotation
// applies. Config-flagged (risk.js's ROTATION_ENABLED); at most one
// rotation per cycle.

import {
  ROTATION_ENABLED,
  ROTATION_MIN_SCORE,
  ROTATION_SCORE_MARGIN,
  MIN_RR_FULL,
  MIN_RR_HALF,
  LIMIT_BAND_PCT,
  TAKER_FEE_BPS_PER_SIDE,
  rotationAllows,
  correlationBudgetAllows,
  roundTripCostPct,
  netRr,
  swingLowStopPrice,
} from "./risk.js";
import { BUY_SCORE_THRESHOLD, DOWNTREND_LONG_SCORE } from "./strategyConfig.js";
import { computeEntryQty } from "./entrySizing.js";
import { getAccount as defaultGetAccount } from "./trade.js";

export async function applyRotation(decisions, posBySymbol, openSymbols, { getAccount = defaultGetAccount } = {}) {
  if (!ROTATION_ENABLED) return null;

  const cands = decisions.filter(
    (d) => d.action === "HOLD" && d.score !== null && d.score !== undefined && d.score >= ROTATION_MIN_SCORE && String(d.reason || "").startsWith("BLOCKED: correlation budget")
  );
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);

  const helds = decisions.filter(
    (d) => d.action === "HOLD" && d.score !== null && d.score !== undefined && d.symbol in posBySymbol && Number(posBySymbol[d.symbol].qty || 0) > 0
  );
  if (!helds.length) return null;
  const weakest = helds.reduce((min, d) => (d.score < min.score ? d : min), helds[0]);

  for (const cand of cands) {
    if (!rotationAllows(cand.score, weakest.score, ROTATION_MIN_SCORE, ROTATION_SCORE_MARGIN)) continue;
    // Same regime gate as a normal entry.
    if (cand.dailyRegime === "downtrend" && cand.score < DOWNTREND_LONG_SCORE) continue;
    // Budget must actually clear once the weakest is gone (tier check).
    const remaining = openSymbols.filter((s) => s !== weakest.symbol);
    const { allowed } = correlationBudgetAllows(cand.symbol, remaining);
    if (!allowed) continue;
    // R:R soft gate still applies to the rotation entry.
    const cAsk = cand.ask || 0;
    const cBid = cand.bid || 0;
    if (cAsk <= 0) continue;
    const costPct = roundTripCostPct(cBid, cAsk, TAKER_FEE_BPS_PER_SIDE);
    const entryStop = swingLowStopPrice(cAsk, cand.lows4h);
    const bb = cand.bb;
    const bbTarget = bb && bb[2] && bb[2] > cAsk ? bb[2] : null;
    const rr = netRr(cAsk, entryStop, bbTarget, costPct);
    if (rr !== null && rr < MIN_RR_HALF) continue;

    const wAsk = weakest.ask || 0;
    const qtyHeld = Number(posBySymbol[weakest.symbol].qty || 0);
    if (wAsk <= 0 || qtyHeld <= 0) return null;
    let equity;
    try {
      const account = await getAccount();
      equity = Number(account.equity || 0);
    } catch {
      return null;
    }
    const baseQty = computeEntryQty(equity, cand.symbol, cAsk, cand.atr);
    const half = cand.dailyRegime === "downtrend" || cand.score < BUY_SCORE_THRESHOLD || (rr !== null && rr < MIN_RR_FULL);
    const qty = Math.round(baseQty * (half ? 0.5 : 1.0) * 1e4) / 1e4;
    if (qty <= 0) return null;

    weakest.action = "SELL";
    weakest.qty = qtyHeld;
    weakest.limitPrice = Math.round(wAsk * (1 - LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
    weakest.reason = `ROTATION OUT: score=${weakest.score.toFixed(1)} <= 0; ${cand.symbol} scores ${cand.score.toFixed(1)} (>= +${ROTATION_SCORE_MARGIN.toFixed(1)} margin) at a full budget — freeing the slot`;
    cand.action = "BUY";
    cand.qty = qty;
    cand.limitPrice = Math.round(cAsk * 1e4) / 1e4;
    cand.reason = `ROTATION IN: score=${cand.score.toFixed(1)} replaces ${weakest.symbol} (score ${weakest.score.toFixed(1)})${half ? ", half-size" : ""}`;
    return `ROTATION: ${weakest.symbol} (score ${weakest.score.toFixed(1)}) -> ${cand.symbol} (score ${cand.score.toFixed(1)})`;
  }
  return null;
}
