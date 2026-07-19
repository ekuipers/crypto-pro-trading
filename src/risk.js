// src/risk.js
//
// Pure-function risk helpers that encode the rules in CLAUDE.md — a faithful
// port of scripts/risk.py. Trading rules:
//   - Never invest more than the per-symbol cap (config.json > portfolio_caps.caps)
//     of total portfolio value in a single position. Fallback cap is
//     config.json > risk.default_position_cap_pct (default 5%).
//   - Limit orders only, within config.json > risk.limit_band_pct of ask.
//   - Stop loss is TA-driven: when risk.stop_loss_mode == "swing_low_4h" the
//     stop sits just below the lowest low of the last swing_low_lookback_bars
//     4H bars, clamped to at most swing_low_max_stop_pct below entry. The
//     fixed risk.stop_loss_pct (5%) is only a fallback when 4H history is
//     unavailable.
//   - Take-profit is TA signal-driven (score <= -2), NOT a fixed % target.
//
// Config constants are loaded from config.json at module-import time so
// callers that import them directly get the configured values. Sensible
// defaults apply if config.json is missing. Kept in exact numeric parity
// with the Python module — see the "Python <-> Node parity" note in
// CLAUDE.md before changing any formula here without changing
// scripts/risk.py too.
//
// Scope note (updated 2026-07-19, Node port Phase 2 Step 0): this port
// covers every function exercised by the *live* config.json, which includes
// the losing-streak/drawdown throttle (risk.streak_throttle_enabled: true —
// it is NOT one of the ships-OFF extras despite an earlier version of this
// comment claiming otherwise). The "famous-trader package" extras that
// genuinely ship OFF in the live config (chandelier trail, conviction
// sizing, measured-move target, pyramid adds, breadth gate) are still not
// ported — add them here if/when those flags are turned on in config.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

const _cfg = loadConfig();
const _risk = _cfg.risk || {};
const _strategy = _cfg.strategy || {};
const _costs = _cfg.costs || {};

export const MAX_POSITION_PCT = Number(_risk.default_position_cap_pct ?? 0.05);
export const LIMIT_BAND_PCT = Number(_risk.limit_band_pct ?? 0.002);
export const STOP_LOSS_PCT = Number(_risk.stop_loss_pct ?? 0.05);
export const STOP_LOSS_LIMIT_BAND_PCT = Number(_risk.stop_loss_limit_band_pct ?? 0.005);
export const TRAILING_STOP_ACTIVATION_PCT = Number(_risk.trailing_stop_activation_pct ?? 0.025);
export const TRAILING_STOP_TRAIL_PCT = Number(_risk.trailing_stop_trail_pct ?? 0.03);
export const STOP_LOSS_ESCALATION_CYCLES = Number(_risk.stop_loss_escalation_cycles ?? 2);
export const STOP_LOSS_ESCALATION_EXTRA_PCT = Number(_risk.stop_loss_escalation_extra_pct ?? 0.003);
export const MAX_OPEN_POSITIONS = Number(_risk.max_open_positions ?? 4);
export const TIER1_SYMBOLS = _risk.tier1_symbols ?? ["BTC/USD", "ETH/USD"];
export const MAX_POSITIONS_PER_TIER = Number(_risk.max_positions_per_tier ?? 3);
export const DAILY_DRAWDOWN_GATE_PCT = Number(_risk.daily_drawdown_gate_pct ?? 0.03);
export const CAPITAL_PRESERVATION_STOP_PCT = Number(_risk.capital_preservation_stop_pct ?? 0.03);
export const STOP_LOSS_MODE = String(_risk.stop_loss_mode ?? "swing_low_4h").toLowerCase();
export const SWING_LOW_LOOKBACK_BARS = Number(_risk.swing_low_lookback_bars ?? 20);
export const SWING_LOW_BUFFER_PCT = Number(_risk.swing_low_buffer_pct ?? 0.001);
export const SWING_LOW_MAX_STOP_PCT = Number(_risk.swing_low_max_stop_pct ?? 0.08);

export const TAKER_FEE_BPS_PER_SIDE = Number(_costs.taker_fee_bps_per_side ?? 25.0);
export const ROTATION_ENABLED = Boolean(_strategy.rotation_enabled ?? true);
export const ROTATION_MIN_SCORE = Number(_strategy.rotation_min_score ?? 4.0);
export const ROTATION_SCORE_MARGIN = Number(_strategy.rotation_score_margin ?? 2.0);
export const MIN_RR_FULL = Number(_strategy.min_rr_full ?? 1.5);
export const MIN_RR_HALF = Number(_strategy.min_rr_half ?? 1.0);
export const ENFORCE_BUDGET_ON_OPEN_POSITIONS = Boolean(_risk.enforce_budget_on_open_positions ?? false);
export const MAX_HOLD_HOURS = Number(_risk.max_hold_hours ?? 48.0);
export const PARTIAL_TP_ENABLED = Boolean(_risk.partial_tp_enabled ?? true);
export const PARTIAL_TP_R_MULTIPLE = Number(_risk.partial_tp_r_multiple ?? 1.0);
export const PARTIAL_TP_FRACTION = Number(_risk.partial_tp_fraction ?? 0.5);

export const TRAIL_MODE = String(_risk.trail_mode ?? "fixed").toLowerCase();
export const CHANDELIER_ATR_MULT = Number(_risk.chandelier_atr_mult ?? 2.5);
export const STREAK_THROTTLE_ENABLED = Boolean(_risk.streak_throttle_enabled ?? true);
export const STREAK_THROTTLE_LOSSES = Number(_risk.streak_throttle_losses ?? 3);
export const STREAK_THROTTLE_DD_PCT = Number(_risk.streak_throttle_dd_pct ?? 0.05);
export const STREAK_THROTTLE_RECOVER_DD_PCT = Number(_risk.streak_throttle_recover_dd_pct ?? 0.025);
export const STREAK_THROTTLE_WINNERS = Number(_risk.streak_throttle_winners ?? 2);
export const STREAK_THROTTLE_RISK_FACTOR = Number(_risk.streak_throttle_risk_factor ?? 0.5);

// ---------------------------------------------------------------------------
// Position sizing / limit-band checks
// ---------------------------------------------------------------------------

/** Maximum dollar size for a position given an equity-fraction cap. */
export function maxPositionDollars(equity, capPct = MAX_POSITION_PCT) {
  return equity * capPct;
}

/** Largest whole-share quantity that respects the cap at price. */
export function maxSharesForPosition(equity, price, capPct = MAX_POSITION_PCT) {
  if (price <= 0) return 0;
  return Math.floor(maxPositionDollars(equity, capPct) / price);
}

/** Reject orders that would exceed the per-symbol position cap. */
export function checkPositionSize(equity, qty, price, capPct = MAX_POSITION_PCT) {
  if (equity <= 0) return { ok: false, reason: "equity is zero or negative" };
  if (qty <= 0) return { ok: false, reason: "qty must be positive" };
  if (price <= 0) return { ok: false, reason: "price must be positive" };
  const notional = qty * price;
  const cap = maxPositionDollars(equity, capPct);
  if (notional > cap) {
    return { ok: false, reason: `order notional exceeds ${(capPct * 100).toFixed(0)}% cap (equity=${equity})` };
  }
  return { ok: true, reason: "size ok" };
}

/**
 * Limit price must be within LIMIT_BAND_PCT of the current ask (above or
 * below). Maker-first extension: when a live bid is supplied, any limit
 * sitting inside the spread (bid <= limit <= ask) is also accepted.
 */
export function checkLimitBand(limitPrice, ask, bid = null) {
  if (ask <= 0) return { ok: false, reason: "ask must be positive" };
  if (limitPrice <= 0) return { ok: false, reason: "limit_price must be positive" };
  if (bid && bid > 0 && bid <= limitPrice && limitPrice <= ask) {
    return { ok: true, reason: "limit inside the bid-ask spread (maker-safe)" };
  }
  const band = ask * LIMIT_BAND_PCT;
  const diff = Math.abs(limitPrice - ask);
  if (diff > band) {
    return {
      ok: false,
      reason: `limit outside ${(LIMIT_BAND_PCT * 100).toFixed(1)}% band (ask=${ask.toFixed(4)} limit=${limitPrice.toFixed(4)})`,
    };
  }
  return { ok: true, reason: `limit within ${(LIMIT_BAND_PCT * 100).toFixed(1)}% of ask` };
}

// ---------------------------------------------------------------------------
// Stop-loss
// ---------------------------------------------------------------------------

/**
 * TA-driven long stop: just below the lowest low of the last `lookback`
 * completed 4-hour bars ("previous range low"). Returns null (so the caller
 * can fall back to the fixed % stop) when there is not enough 4H history or
 * the computed level is not a valid long stop. Clamped to at most
 * `maxStopPct` below entry.
 */
export function swingLowStopPrice(
  entryPrice,
  lows4h,
  lookback = SWING_LOW_LOOKBACK_BARS,
  bufferPct = SWING_LOW_BUFFER_PCT,
  maxStopPct = SWING_LOW_MAX_STOP_PCT
) {
  if (entryPrice <= 0 || !lows4h || !lows4h.length) return null;
  const window = lows4h.slice(-lookback).filter((lw) => lw && lw > 0);
  if (window.length < Math.min(lookback, 5)) return null;
  let stop = Math.min(...window) * (1 - bufferPct);
  if (stop >= entryPrice) return null;
  const floorPrice = entryPrice * (1 - maxStopPct);
  if (stop < floorPrice) stop = floorPrice;
  return Math.round(stop * 1e6) / 1e6;
}

/**
 * True if a long position has hit its stop loss. When an explicit `stopPrice`
 * is supplied (e.g. the 4H swing-low stop), the position stops out at/below
 * that level. Otherwise falls back to the fixed STOP_LOSS_PCT drawdown.
 */
export function shouldStopOut(entryPrice, currentPrice, stopPrice = null) {
  if (entryPrice <= 0) return false;
  if (stopPrice !== null && stopPrice > 0) return currentPrice <= stopPrice;
  const drawdown = (entryPrice - currentPrice) / entryPrice;
  return drawdown >= STOP_LOSS_PCT;
}

/** True if a short position has moved >= STOP_LOSS_PCT against us (price rose). */
export function shouldCoverShort(entryPrice, currentPrice) {
  if (entryPrice <= 0) return false;
  const adverseMove = (currentPrice - entryPrice) / entryPrice;
  return adverseMove >= STOP_LOSS_PCT;
}

/** The price at which a long stop-loss triggers. */
export function stopLossPrice(entryPrice) {
  return entryPrice * (1 - STOP_LOSS_PCT);
}

/** The price at which a short stop-loss triggers (price rose above entry). */
export function shortStopPrice(entryPrice) {
  return entryPrice * (1 + STOP_LOSS_PCT);
}

// ---------------------------------------------------------------------------
// Trailing stop
// ---------------------------------------------------------------------------

/** Price level at which a trailing stop triggers for a long position. */
export function trailingStopPrice(highWaterMark, trailPct = TRAILING_STOP_TRAIL_PCT) {
  return highWaterMark * (1 - trailPct);
}

/**
 * True when a long position should be closed via the trailing stop. The
 * trailing stop becomes active once the position is at least activationPct
 * in profit. While inactive, the fixed STOP_LOSS_PCT hard stop remains in
 * force.
 */
export function shouldTrailStopOut(
  entryPrice,
  highWaterMark,
  currentPrice,
  activationPct = TRAILING_STOP_ACTIVATION_PCT,
  trailPct = TRAILING_STOP_TRAIL_PCT
) {
  if (entryPrice <= 0 || highWaterMark === null || highWaterMark === undefined) return false;
  const activated = (highWaterMark - entryPrice) / entryPrice >= activationPct;
  if (!activated) return false;
  return currentPrice <= trailingStopPrice(highWaterMark, trailPct);
}

/**
 * The effective stop-loss percentage for a position: the capital-
 * preservation stop when that mode is active, the (tighter) trail % once the
 * trailing stop has activated, else the fixed hard-stop %.
 */
export function effectiveStopPct(
  entryPrice,
  highWaterMark,
  activationPct = TRAILING_STOP_ACTIVATION_PCT,
  trailPct = TRAILING_STOP_TRAIL_PCT,
  capitalPreservation = false,
  preservationStopPct = CAPITAL_PRESERVATION_STOP_PCT
) {
  if (capitalPreservation) return preservationStopPct;
  if (entryPrice > 0 && highWaterMark !== null && highWaterMark !== undefined) {
    const activated = (highWaterMark - entryPrice) / entryPrice >= activationPct;
    if (activated) return trailPct;
  }
  return STOP_LOSS_PCT;
}

// ---------------------------------------------------------------------------
// Losing-streak / drawdown throttle
// ---------------------------------------------------------------------------

/** Length of the losing streak at the end of a chronological P&L list. */
export function consecutiveLossesTail(pnls) {
  let n = 0;
  for (let i = (pnls || []).length - 1; i >= 0; i--) {
    if (pnls[i] < 0) n++;
    else break;
  }
  return n;
}

/** Length of the winning streak at the end of a chronological P&L list. */
export function consecutiveWinsTail(pnls) {
  let n = 0;
  for (let i = (pnls || []).length - 1; i >= 0; i--) {
    if (pnls[i] > 0) n++;
    else break;
  }
  return n;
}

/**
 * Losing-streak / drawdown throttle state machine (PTJ "trade smallest when
 * trading worst"). Activates after `losses` consecutive losing round-trips
 * OR a rolling 7-day drawdown >= ddOn. Releases only once `winners`
 * consecutive winners have printed AND the drawdown has recovered below
 * ddOff (slightly stricter than either alone — conservative hysteresis).
 * Anti-martingale: while active the caller halves risk.
 */
export function updateStreakThrottle(
  wasActive,
  roundTripPnls,
  dd7d,
  losses = STREAK_THROTTLE_LOSSES,
  ddOn = STREAK_THROTTLE_DD_PCT,
  ddOff = STREAK_THROTTLE_RECOVER_DD_PCT,
  winners = STREAK_THROTTLE_WINNERS
) {
  const winsTail = consecutiveWinsTail(roundTripPnls);
  if (wasActive) {
    return !(winsTail >= winners && dd7d < ddOff);
  }
  return consecutiveLossesTail(roundTripPnls) >= losses || dd7d >= ddOn;
}

/** Drawdown of the last value from the peak of the series (0.05 = 5%). */
export function rollingDrawdownPct(equities) {
  const vals = (equities || []).filter((e) => e && e > 0);
  if (vals.length < 2) return 0.0;
  const peak = Math.max(...vals);
  return Math.max((peak - vals[vals.length - 1]) / peak, 0.0);
}

// ---------------------------------------------------------------------------
// Correlation budget
// ---------------------------------------------------------------------------

/** Return the number of currently open positions. */
export function openPositionCount(positions) {
  return positions.length;
}

/**
 * Count how many open positions are in the same tier as symbol. Tier 1 =
 * TIER1_SYMBOLS (BTC/USD, ETH/USD). Tier 2 = everything else.
 */
export function tierCount(symbol, openSymbols) {
  const inTier1 = TIER1_SYMBOLS.includes(symbol);
  return openSymbols.filter((s) => TIER1_SYMBOLS.includes(s) === inTier1).length;
}

/**
 * Returns { allowed, reason }. Blocks a new entry when total open positions
 * >= maxPositions, or positions in the same tier >= maxPerTier.
 */
export function correlationBudgetAllows(
  symbol,
  openSymbols,
  maxPositions = MAX_OPEN_POSITIONS,
  maxPerTier = MAX_POSITIONS_PER_TIER
) {
  const total = openSymbols.length;
  if (total >= maxPositions) {
    return { allowed: false, reason: `correlation budget: ${total}/${maxPositions} positions open` };
  }
  const sameTier = tierCount(symbol, openSymbols);
  if (sameTier >= maxPerTier) {
    const tierLabel = TIER1_SYMBOLS.includes(symbol) ? "Tier-1 (BTC/ETH)" : "Tier-2 (alts)";
    return {
      allowed: false,
      reason: `correlation budget: ${sameTier}/${maxPerTier} ${tierLabel} positions open`,
    };
  }
  return { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Daily drawdown gate
// ---------------------------------------------------------------------------

/** Fractional drop from the day opening equity (0.031 = 3.1% down). */
export function dailyDrawdownPct(dayOpenEquity, currentEquity) {
  if (!dayOpenEquity || dayOpenEquity <= 0) return 0.0;
  const drop = dayOpenEquity - currentEquity;
  return Math.max(drop / dayOpenEquity, 0.0);
}

/** True if today's portfolio drawdown has exceeded gatePct. */
export function dailyDrawdownGateTriggered(dayOpenEquity, currentEquity, gatePct = DAILY_DRAWDOWN_GATE_PCT) {
  return dailyDrawdownPct(dayOpenEquity, currentEquity) >= gatePct;
}

// ---------------------------------------------------------------------------
// Stop-loss limit-price helpers
// ---------------------------------------------------------------------------

/**
 * Compute the limit price for a stop-loss SELL order. Uses a wider band than
 * normal entries so orders fill faster in volatile conditions. After
 * escalationCycles unfilled cycles the band widens further.
 */
export function stopLossLimitPrice(
  ask,
  cyclesOpen = 0,
  baseBandPct = STOP_LOSS_LIMIT_BAND_PCT,
  escalationCycles = STOP_LOSS_ESCALATION_CYCLES,
  escalationExtraPct = STOP_LOSS_ESCALATION_EXTRA_PCT
) {
  let band = baseBandPct;
  if (cyclesOpen >= escalationCycles) band += escalationExtraPct;
  return Math.round(ask * (1 - band) * 1e4) / 1e4;
}

/** Limit price for a stop-loss COVER (short) order. */
export function coverLimitPrice(
  ask,
  cyclesOpen = 0,
  baseBandPct = STOP_LOSS_LIMIT_BAND_PCT,
  escalationCycles = STOP_LOSS_ESCALATION_CYCLES,
  escalationExtraPct = STOP_LOSS_ESCALATION_EXTRA_PCT
) {
  let band = baseBandPct;
  if (cyclesOpen >= escalationCycles) band += escalationExtraPct;
  return Math.round(ask * (1 + band) * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Trade-economics helpers
// ---------------------------------------------------------------------------

/** Quoted bid-ask spread as a fraction of the mid price (0.001 = 0.1%). */
export function spreadPct(bid, ask) {
  if (bid <= 0 || ask <= 0 || ask < bid) return 0.0;
  const mid = (ask + bid) / 2;
  return (ask - bid) / mid;
}

/**
 * Estimated full round-trip cost as a fraction of notional: taker fee on
 * entry + taker fee on exit + the quoted bid-ask spread.
 */
export function roundTripCostPct(bid, ask, feeBpsPerSide = TAKER_FEE_BPS_PER_SIDE) {
  return (2 * feeBpsPerSide) / 10000.0 + spreadPct(bid, ask);
}

/**
 * Net-of-cost reward:risk ratio for a long setup. Returns null when the
 * geometry is invalid (stop not below entry, or no upside target).
 */
export function netRr(entry, stop, target, costPct = 0.0) {
  if (entry <= 0 || stop === null || stop <= 0 || stop >= entry) return null;
  if (target === null || target <= entry) return null;
  const reward = target - entry - entry * costPct;
  const riskLeg = entry - stop;
  if (riskLeg <= 0) return null;
  return reward / riskLeg;
}

// ---------------------------------------------------------------------------
// Partial take-profit ladder
// ---------------------------------------------------------------------------

/**
 * Price at which the partial take-profit fires: entry + rMultiple x R, where
 * R = entry - stop. Null when the stop geometry is invalid.
 */
export function partialTpTriggerPrice(entry, stop, rMultiple = PARTIAL_TP_R_MULTIPLE) {
  if (entry <= 0 || stop === null || stop <= 0 || stop >= entry) return null;
  return entry + (entry - stop) * rMultiple;
}

/** True when an open long has reached +rMultiple R and hasn't yet scaled out. */
export function shouldPartialTp(entry, current, stop, alreadyDone, rMultiple = PARTIAL_TP_R_MULTIPLE) {
  if (alreadyDone) return false;
  const trigger = partialTpTriggerPrice(entry, stop, rMultiple);
  return trigger !== null && current >= trigger;
}

// ---------------------------------------------------------------------------
// Stale-position exit
// ---------------------------------------------------------------------------

/** Hours since the position was opened; null when the timestamp is missing/bad. */
export function positionAgeHours(entryTimeIso, now = null) {
  if (!entryTimeIso) return null;
  const opened = new Date(entryTimeIso);
  if (Number.isNaN(opened.getTime())) return null;
  const nowDate = now || new Date();
  return (nowDate.getTime() - opened.getTime()) / (1000 * 60 * 60);
}

/**
 * True when a position should be exited for capital efficiency: older than
 * maxHoldHours, never armed its trailing stop, and its live score is below
 * the half-size entry gate. Winners (armed trail) are exempt.
 */
export function isStalePosition(
  entryTimeIso,
  trailingArmed,
  score,
  scoreGate,
  maxHoldHours = MAX_HOLD_HOURS,
  now = null
) {
  if (maxHoldHours <= 0 || trailingArmed || score === null || score === undefined) return false;
  if (score >= scoreGate) return false;
  const age = positionAgeHours(entryTimeIso, now);
  return age !== null && age > maxHoldHours;
}

// ---------------------------------------------------------------------------
// Position rotation at the correlation budget
// ---------------------------------------------------------------------------

/**
 * True when a budget-blocked candidate justifies rotating out the weakest
 * open holding: candidate >= minScore, weakest <= 0, and the candidate leads
 * the weakest by at least `margin` points.
 */
export function rotationAllows(
  candidateScore,
  weakestScore,
  minScore = ROTATION_MIN_SCORE,
  margin = ROTATION_SCORE_MARGIN
) {
  if (candidateScore === null || candidateScore === undefined) return false;
  if (weakestScore === null || weakestScore === undefined) return false;
  return candidateScore >= minScore && weakestScore <= 0 && candidateScore - weakestScore >= margin;
}
