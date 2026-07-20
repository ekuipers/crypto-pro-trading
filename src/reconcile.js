// src/reconcile.js
//
// Position-state reconciliation from Alpaca fill history, plus the
// session-edge filter and 7-day-drawdown helpers -- a faithful port of the
// corresponding sections of scripts/run_evaluation.py (prune_stale_position_state,
// reconcile_positions_from_fills, _compute_session_penalty,
// _session_penalty_active, _seven_day_drawdown).

import { toSlash } from "./symbols.js";
import { headers } from "./trade.js";
import { apiGet } from "./apiClient.js";
import { BASE_URL } from "./trade.js";
import { fetchAllFills, fifoRoundTrips } from "./marketData.js";
import { getPosition, markPartialTp, clearPosition } from "./positionState.js";
import { PARTIAL_TP_ENABLED, rollingDrawdownPct } from "./risk.js";
import { SESSION_MIN_SAMPLE } from "./strategyConfig.js";

// Bug #6 (2026-07-18): Alpaca paper-fill SELL quantities come back
// ~0.1-0.25% smaller than the matching BUY (fee/precision rounding), so a
// lot's leftover qty after a full-position close never dropped below the
// old 1e-6 absolute epsilon. Every full close was misread as "partial sell —
// position survives," permanently inflating sells_since_start for that
// symbol, so every brand-new position reconciled as "partial TP already
// done" on its first evaluation, pinning the stop to breakeven before any
// real profit. Fixed by comparing the leftover against a tolerance relative
// to the lot's original size instead of an absolute constant.
//
// Bug #9 (2026-07-20): the #6 fix compared each SELL's leftover against
// that SAME lot's own (possibly already tiny, e.g. post-partial-TP) size,
// so a position that went through several tranches could leave a small
// trailing lot whose own tolerance never absorbed the real shortfall,
// permanently stuck "open." Fixed by tracking flatness with a running
// net-quantity scalar compared against the episode's PEAK size instead.
const RECONCILE_DUST_REL_TOL = 0.005; // 5x the largest observed fee residual (~0.25%)

/**
 * Clear per-symbol state for any symbol no longer actually held. A full
 * close via any stop-loss-type exit drops the symbol out of openSymbols on
 * the very next cycle, so its stale partial_tp_done/breakeven_stop/
 * stop_order_id must be pruned reactively here rather than relying on the
 * "still held" branch to have cleared them (Bug #7).
 */
export function pruneStaleState(state, openSymbols) {
  const warnings = [];
  const held = new Set(openSymbols);
  for (const sym of Object.keys(state.positions || {})) {
    if (!held.has(sym)) {
      clearPosition(state, sym);
      warnings.push(
        `STALE STATE PRUNED: ${sym} no longer held — cleared stale position tracking (partial-TP/breakeven/stop-order state)`
      );
    }
  }
  return warnings;
}

/**
 * Rebuild per-position facts from FILL history for open long positions:
 * partial_tp_done + breakeven stop (idempotency -- a lost state flag can
 * never re-fire the partial TP), entry_time_iso (backfilled from the
 * flat->long transition), and avg_entry_price (replaced with the FIFO-
 * derived weighted average when the API value is <= 0).
 *
 * Mutates `state`, the position-state sub-objects, and (when the API
 * avg_entry_price is bad) the `avg_entry_price` field of the matching
 * object inside `positions` directly, matching Python's in-place dict
 * mutation and tests/test_reconcile.py's assertions against that mutation.
 * Returns journal warnings.
 */
export async function reconcilePositionsFromFills(state, positions, { fills = null } = {}) {
  const warnings = [];
  const needs = [];
  for (const p of positions) {
    if (Number(p.qty || 0) <= 0) continue; // long-only reconciliation
    const sym = toSlash(p.symbol || "");
    const psPos = getPosition(state, sym);
    if (
      Number(p.avg_entry_price || 0) <= 0 ||
      !psPos.entry_time_iso ||
      (PARTIAL_TP_ENABLED && !psPos.partial_tp_done)
    ) {
      needs.push(p);
    }
  }
  if (!needs.length) return warnings;

  if (fills === null) {
    try {
      fills = await fetchAllFills();
    } catch (e) {
      console.log(`position reconciliation skipped (fills fetch failed): ${e}`);
      return warnings;
    }
  }

  // FIFO walk, chronological, per symbol.
  const hist = {};
  for (const act of [...fills].reverse()) {
    const sym = toSlash(act.symbol || "");
    const side = act.side;
    const qty = Math.abs(Number(act.qty || 0));
    const price = Number(act.price || 0);
    const when = act.transaction_time || act.date;
    if (!sym || qty <= 0 || price <= 0) continue;
    if (!hist[sym]) hist[sym] = { lots: [], startIso: null, sellsSinceStart: 0, netQty: 0, peakQty: 0 };
    const h = hist[sym];
    const isFlat = h.netQty <= h.peakQty * RECONCILE_DUST_REL_TOL;
    if (side === "buy") {
      if (isFlat) {
        // flat -> long transition
        h.startIso = when;
        h.sellsSinceStart = 0;
        h.lots = [];
        h.netQty = 0;
        h.peakQty = 0;
      }
      h.lots.push([qty, price, qty]); // [remaining, price, originalQty]
      h.netQty += qty;
      h.peakQty = Math.max(h.peakQty, h.netQty);
    } else if (side === "sell") {
      let remaining = qty;
      while (remaining > 1e-9 && h.lots.length) {
        const lot = h.lots[0];
        const m = Math.min(remaining, lot[0]);
        lot[0] -= m;
        remaining -= m;
        const dust = Math.max(1e-9, lot[2] * RECONCILE_DUST_REL_TOL);
        if (lot[0] < dust) h.lots.shift();
      }
      h.netQty = Math.max(0, h.netQty - qty);
      if (h.netQty > h.peakQty * RECONCILE_DUST_REL_TOL) {
        h.sellsSinceStart += 1; // partial sell — position survives
      } else {
        h.startIso = null; // fully closed
        h.sellsSinceStart = 0;
        h.lots = [];
        h.netQty = 0;
        h.peakQty = 0;
      }
    }
  }

  for (const p of needs) {
    const sym = toSlash(p.symbol || "");
    const h = hist[sym];
    if (!h || !h.lots.length) continue;
    const openQty = h.lots.reduce((sum, lot) => sum + lot[0], 0);
    const fifoAvg = h.lots.reduce((sum, lot) => sum + lot[0] * lot[1], 0) / openQty;
    const psPos = getPosition(state, sym);

    const apiEntry = Number(p.avg_entry_price || 0);
    if (apiEntry <= 0) {
      p.avg_entry_price = fifoAvg;
      warnings.push(`DATA GUARD: ${sym} avg_entry_price from API was $${apiEntry.toFixed(4)} — using FIFO-derived $${fifoAvg.toFixed(4)}`);
    }
    const entry = Number(p.avg_entry_price || fifoAvg);
    if (!psPos.entry_price) psPos.entry_price = entry;
    if (!psPos.entry_time_iso && h.startIso) psPos.entry_time_iso = h.startIso;
    if (PARTIAL_TP_ENABLED && !psPos.partial_tp_done && h.sellsSinceStart > 0) {
      markPartialTp(state, sym, entry);
      warnings.push(
        `PARTIAL-TP RECONCILED: ${sym} has ${h.sellsSinceStart} partial SELL(s) since entry in fill history — flag restored, stop at breakeven $${entry.toFixed(4)}`
      );
    }
  }
  return warnings;
}

/** Rolling 7-day equity drawdown from /v2/account/portfolio/history. */
export async function sevenDayDrawdown({ maxAttempts, backoffSeconds } = {}) {
  try {
    const r = await apiGet(BASE_URL + "/v2/account/portfolio/history", {
      headers: headers(),
      params: { period: "1M", timeframe: "1D" },
      timeout: 20,
      ...(maxAttempts !== undefined && { maxAttempts }),
      ...(backoffSeconds !== undefined && { backoffSeconds }),
    });
    const body = await r.json();
    const equities = (body.equity || []).filter((e) => e);
    return rollingDrawdownPct(equities.slice(-8));
  } catch (e) {
    console.log(`7-day drawdown check skipped: ${e}`);
    return 0.0;
  }
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** GMT+2 (fixed offset, no DST) hour and weekday label for a UTC instant. */
function gmt2Parts(date) {
  const shifted = new Date(date.getTime() + 2 * 3_600_000);
  return { hour: shifted.getUTCHours(), dow: DOW_LABELS[shifted.getUTCDay()] };
}

/** Return the negative-expectancy hour/weekday buckets from round trips (GMT+2). */
export function computeSessionPenalty(roundTrips) {
  const penalty = { hours: new Set(), dows: new Set() };
  const hourPnl = {};
  const dowPnl = {};
  for (const rt of roundTrips) {
    const exitDt = new Date(rt.exit_iso);
    if (Number.isNaN(exitDt.getTime())) continue;
    const { hour, dow } = gmt2Parts(exitDt);
    (hourPnl[hour] ??= []).push(rt.pnl);
    (dowPnl[dow] ??= []).push(rt.pnl);
  }
  for (const [hour, pnls] of Object.entries(hourPnl)) {
    if (pnls.length >= SESSION_MIN_SAMPLE && pnls.reduce((a, b) => a + b, 0) < 0) {
      penalty.hours.add(Number(hour));
    }
  }
  for (const [dow, pnls] of Object.entries(dowPnl)) {
    if (pnls.length >= SESSION_MIN_SAMPLE && pnls.reduce((a, b) => a + b, 0) < 0) {
      penalty.dows.add(dow);
    }
  }
  return penalty;
}

// Module-level cache, mirroring Python's global _SESSION_PENALTY -- computed
// once per process run (this port's one-shot-CLI-per-cycle model matches
// Python's, so a module-level cache is correct here, not a smell).
let _sessionPenaltyCache = null;

/** Reset the session-penalty cache. Test-only (production is one process per cycle). */
export function resetSessionPenaltyCache() {
  _sessionPenaltyCache = null;
}

/** True when the current GMT+2 hour or weekday is a penalized bucket. */
export async function sessionPenaltyActive({ now = new Date(), roundTrips = null } = {}) {
  if (_sessionPenaltyCache === null) {
    try {
      const trips = roundTrips !== null ? roundTrips : fifoRoundTrips(await fetchAllFills());
      _sessionPenaltyCache = computeSessionPenalty(trips);
    } catch (e) {
      console.log(`session-edge filter skipped: ${e}`);
      _sessionPenaltyCache = { hours: new Set(), dows: new Set() };
    }
    if (_sessionPenaltyCache.hours.size || _sessionPenaltyCache.dows.size) {
      console.log(
        `session-edge filter: half-size hours=${[...(_sessionPenaltyCache?.hours ?? [])].sort((a, b) => a - b)} dows=${[...(_sessionPenaltyCache?.dows ?? [])].sort()}`
      );
    }
  }
  const { hour, dow } = gmt2Parts(now);
  return _sessionPenaltyCache.hours.has(hour) || _sessionPenaltyCache.dows.has(dow);
}
