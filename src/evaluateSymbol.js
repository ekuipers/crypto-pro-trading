// src/evaluateSymbol.js
//
// Per-symbol evaluation -- a faithful port of scripts/run_evaluation.py's
// evaluate_symbol(). Returns a decision object; never places an order
// itself (that's runEvaluation.js's main()).
//
// Network calls (quote, bars, open-orders, account) go through an
// injectable `deps` object defaulting to the real trade.js/marketData.js
// functions, so the full held-long / held-short / flat-entry decision
// ladder can be unit-tested with plain objects and zero HTTP stubbing --
// see evaluateSymbol.test.js.
//
// Decision object keys are camelCase (this port's established convention,
// e.g. indicators.js's signalScore() breakdown) -- Python's dict keys are
// snake_case; only the journal TEXT has to match, not the JS field names.

import * as ind from "./indicators.js";
import * as ps from "./positionState.js";
import {
  getLatestQuote as defaultGetLatestQuote,
  getOpenOrders as defaultGetOpenOrders,
  cancelOrder as defaultCancelOrder,
  getAccount as defaultGetAccount,
} from "./trade.js";
import {
  getCryptoBars as defaultGetCryptoBars,
  getCryptoBars4h as defaultGetCryptoBars4h,
  getCryptoBarsDaily as defaultGetCryptoBarsDaily,
  aggregateBarsTo4h,
  BARS_4H_LOOKBACK,
  MIN_BARS,
} from "./marketData.js";
import {
  STOP_LOSS_PCT,
  STOP_LOSS_MODE,
  STOP_LOSS_ESCALATION_CYCLES,
  TRAILING_STOP_ACTIVATION_PCT,
  TRAILING_STOP_TRAIL_PCT,
  TRAIL_MODE,
  PARTIAL_TP_ENABLED,
  PARTIAL_TP_R_MULTIPLE,
  PARTIAL_TP_FRACTION,
  MAX_HOLD_HOURS,
  TAKER_FEE_BPS_PER_SIDE,
  MIN_RR_FULL,
  MIN_RR_HALF,
  LIMIT_BAND_PCT,
  STREAK_THROTTLE_RISK_FACTOR,
  shouldCoverShort,
  shouldTrailStopOut,
  swingLowStopPrice,
  shouldStopOut,
  shouldPartialTp,
  isStalePosition,
  correlationBudgetAllows,
  roundTripCostPct,
  netRr,
  stopLossLimitPrice,
  coverLimitPrice,
} from "./risk.js";
import {
  BUY_SCORE_THRESHOLD,
  BUY_SCORE_HALF_SIZE,
  SELL_SCORE_THRESHOLD,
  SHORT_SCORE_THRESHOLD,
  SHORT_SCORE_HALF_SIZE,
  COVER_SCORE_THRESHOLD,
  DOWNTREND_LONG_SCORE,
  SESSION_FILTER_ENABLED,
  SHORTS_ENABLED,
  MAKER_FIRST_ENTRIES,
  PYRAMID_ENABLED,
  PYRAMID_ADX_MIN,
  CONVICTION_SIZING_ENABLED,
  MEASURED_MOVE_ENABLED,
  assertNotShipped,
} from "./strategyConfig.js";
import { computeEntryQty } from "./entrySizing.js";
import { sessionPenaltyActive as defaultSessionPenaltyActive } from "./reconcile.js";

// Ships-OFF extras this port doesn't implement yet -- fail loudly at import
// time if config.json ever flips one on before its risk.js counterpart
// exists, rather than misbehaving deep inside a rarely-hit branch.
assertNotShipped("strategy.pyramid_enabled", PYRAMID_ENABLED, "shouldPyramid");
assertNotShipped("strategy.conviction_sizing_enabled", CONVICTION_SIZING_ENABLED, "convictionRiskMultiplier");
assertNotShipped("strategy.measured_move_enabled", MEASURED_MOVE_ENABLED, "measuredMoveTarget");
assertNotShipped("risk.trail_mode=chandelier", TRAIL_MODE === "chandelier", "chandelierTrailPct");

function emptyDecision(symbol) {
  return {
    symbol,
    action: "HOLD",
    reason: "",
    qty: null,
    limitPrice: null,
    ask: null,
    bid: null,
    score: null,
    atr: null,
    rsi: null,
    macd: null,
    macdFlip: null,
    bb: null,
    bbTrend: null,
    bbSqueeze: null,
    emaCross: null,
    adx: null,
    obvTrend: null,
    indicatorBreakdown: null,
    dailyMa20: null,
    dailyMa50: null,
    dailyLast: null,
    dailyRegime: null,
    regime4h: null,
    entryPrice: null,
    currentPrice: null,
    isStopLoss: false, // true when place_order needs the wider stop-loss limit band
    isPartialTp: false, // true for the +1R half scale-out SELL
    isPyramid: false, // true for a +1R/+2R add to a winner (ships OFF today)
    synthetic4h: false, // 4H bars rebuilt from 1H (data fallback)
    dataQualityWarning: null,
    netRr: null, // net-of-cost R:R for new entries
    lows4h: null,
    highs4h: null,
    atr4h: null,
  };
}

/**
 * Return a decision object for one symbol. `state` is the mutable
 * position-state object from positionState.loadState() -- updated in place
 * when stop orders are deduplicated or cleared. `openSymbols` is the list
 * of symbols with currently open positions, used for the correlation-
 * budget check on new entries.
 */
export async function evaluateSymbol(symbol, positionBySymbol, state, openSymbols, { throttleActive = false, deps = {} } = {}) {
  const getLatestQuote = deps.getLatestQuote || defaultGetLatestQuote;
  const getCryptoBars = deps.getCryptoBars || defaultGetCryptoBars;
  const getCryptoBars4h = deps.getCryptoBars4h || defaultGetCryptoBars4h;
  const getCryptoBarsDaily = deps.getCryptoBarsDaily || defaultGetCryptoBarsDaily;
  const getOpenOrders = deps.getOpenOrders || defaultGetOpenOrders;
  const cancelOrder = deps.cancelOrder || defaultCancelOrder;
  const getAccount = deps.getAccount || defaultGetAccount;
  const sessionPenaltyActive = deps.sessionPenaltyActive || defaultSessionPenaltyActive;
  // Indicator functions default to the real indicators.js implementations;
  // tests override individual ones (typically signalScore/bollinger) to get
  // a controlled score/target without needing a realistic bar series.
  const IND = { ...ind, ...(deps.ind || {}) };

  const decision = emptyDecision(symbol);

  // Live quote -- needed for sizing, stop-loss, and limit pricing.
  let ask, bid;
  try {
    const q = await getLatestQuote(symbol);
    ask = Number(q.ap || 0);
    bid = Number(q.bp || 0);
  } catch (e) {
    decision.reason = "quote fetch failed: " + e;
    return decision;
  }
  decision.ask = ask;
  decision.bid = bid;
  decision.currentPrice = bid || ask;

  // 15-min bars (execution timeframe).
  let bars;
  try {
    bars = await getCryptoBars(symbol);
  } catch (e) {
    decision.reason = "bars fetch failed: " + e;
    return decision;
  }

  const usable15m = bars.filter((b) => b.c);
  const closes = usable15m.map((b) => Number(b.c || 0));
  const highs = usable15m.map((b) => Number(b.h || 0));
  const lows = usable15m.map((b) => Number(b.l || 0));
  const volumes = usable15m.map((b) => Number(b.v || 0));

  if (closes.length < MIN_BARS) {
    decision.reason = `not enough 15-min history (${closes.length} bars, need ${MIN_BARS})`;
    return decision;
  }

  // 4H bars (higher-timeframe trend filter + swing-low stop source), with a
  // synthetic-from-1H fallback when native 4H history is short.
  let closes4h = null;
  try {
    let bars4h = await getCryptoBars4h(symbol);
    const nNative = bars4h.filter((b) => b.c).length;
    if (nNative < 51) {
      try {
        const bars1h = await getCryptoBars(symbol, BARS_4H_LOOKBACK * 4, "1Hour");
        const synth = aggregateBarsTo4h(bars1h);
        if (synth.length >= 51) {
          bars4h = synth;
          decision.synthetic4h = true;
        }
      } catch {
        // 1H fallback failure is tolerated -- falls through to the short-4H path below
      }
    }
    const usable4h = bars4h.filter((b) => b.c);
    closes4h = usable4h.map((b) => Number(b.c || 0));
    decision.lows4h = usable4h.map((b) => Number(b.l || 0));
    decision.highs4h = usable4h.map((b) => Number(b.h || 0));
    if (closes4h.length >= 15) {
      decision.atr4h = IND.atr(decision.highs4h, decision.lows4h, closes4h);
    }
    if (closes4h.length < 51) {
      const nBars = closes4h.length;
      closes4h = null;
      decision.regime4h = `insufficient 4H history (${nBars} bars)`;
      decision.dataQualityWarning =
        `4H history unavailable (native ${nNative} bars, 1H fallback failed) — ` +
        `Signal 6 contributes 0 and the swing-low stop falls back to the fixed -${Math.trunc(STOP_LOSS_PCT * 100)}%`;
    } else {
      const cross4h = IND.emaCrossState(closes4h);
      decision.regime4h = (cross4h || "n/a") + (decision.synthetic4h ? " (synthetic 4H from 1H)" : "");
    }
  } catch (e) {
    decision.regime4h = "4H fetch failed: " + String(e).slice(0, 60);
    decision.dataQualityWarning =
      `4H fetch failed — Signal 6 contributes 0 and the swing-low stop falls back to the fixed -${Math.trunc(STOP_LOSS_PCT * 100)}%`;
  }

  // Compute all indicators.
  const { score, parts: breakdown } = IND.signalScore(closes, { volumes, highs, lows, closes4h });
  decision.score = score;
  decision.indicatorBreakdown = breakdown;
  decision.rsi = IND.rsi(closes);
  decision.macd = IND.macd(closes);
  decision.macdFlip = IND.macdFlip(closes);
  decision.bb = IND.bollinger(closes);
  decision.bbTrend = IND.bollingerTrend(closes);
  decision.bbSqueeze = IND.bollingerSqueeze(closes);
  decision.emaCross = IND.emaCrossState(closes);
  decision.atr = IND.atr(highs, lows, closes);
  // Informational only -- not part of the 6-point score (see indicators.js).
  decision.adx = IND.adx(highs, lows, closes);
  decision.obvTrend = IND.obvTrend(closes, volumes);

  // Daily-bars regime filter (20/50-day SMA gate for new buys).
  try {
    const dailyBars = await getCryptoBarsDaily(symbol);
    const dailyCloses = dailyBars.filter((b) => b.c).map((b) => Number(b.c || 0));
    if (dailyCloses.length >= 50) {
      const dailyMa20 = IND.sma(dailyCloses, 20);
      const dailyMa50 = IND.sma(dailyCloses, 50);
      const lastDaily = dailyCloses[dailyCloses.length - 1];
      decision.dailyMa20 = dailyMa20;
      decision.dailyMa50 = dailyMa50;
      decision.dailyLast = lastDaily;
      if (lastDaily > dailyMa50 && dailyMa20 > dailyMa50) decision.dailyRegime = "uptrend";
      else if (lastDaily < dailyMa50 && dailyMa20 < dailyMa50) decision.dailyRegime = "downtrend";
      else decision.dailyRegime = "mixed";
    } else {
      decision.dailyRegime = `insufficient daily history (${dailyCloses.length} bars)`;
    }
  } catch (e) {
    decision.dailyRegime = "fetch failed: " + String(e).slice(0, 60);
  }

  // ── Branch: held position vs. potential new entry ─────────────────────
  const pos = positionBySymbol[symbol];
  if (pos) {
    const entry = Number(pos.avg_entry_price || 0);
    const cur = Number(pos.current_price || decision.currentPrice);
    const qtyHeld = Number(pos.qty || 0);
    decision.entryPrice = entry;
    decision.currentPrice = cur;

    const isShort = qtyHeld < 0;
    const psPos = ps.getPosition(state, symbol);

    if (isShort) {
      return await evaluateHeldShort({ decision, symbol, entry, cur, qtyHeld, score, ask, state, psPos, getOpenOrders, cancelOrder });
    }
    return await evaluateHeldLong({
      decision,
      symbol,
      entry,
      cur,
      qtyHeld,
      score,
      ask,
      state,
      psPos,
      throttleActive,
      getOpenOrders,
      cancelOrder,
      getAccount,
    });
  }

  return await evaluateFlatEntry({ decision, symbol, score, ask, bid, state, openSymbols, throttleActive, getAccount, sessionPenaltyActive });
}

async function evaluateHeldShort({ decision, symbol, entry, cur, qtyHeld, score, ask, state, psPos, getOpenOrders, cancelOrder }) {
  // Deduplication: check for an existing pending cover order.
  const existingCoverId = psPos.stop_order_id;
  if (existingCoverId) {
    const cycles = ps.incrementStopOrderCycles(state, symbol);
    let stillOpen;
    try {
      const openOrders = await getOpenOrders(symbol);
      stillOpen = openOrders.some((o) => o.id === existingCoverId);
    } catch {
      stillOpen = true; // assume still open on fetch error (fail safe)
    }

    if (stillOpen) {
      if (cycles < STOP_LOSS_ESCALATION_CYCLES) {
        decision.reason = `COVER pending (order …${existingCoverId.slice(-8)}, cycle ${cycles}/${STOP_LOSS_ESCALATION_CYCLES})`;
        return decision;
      }
      await cancelOrder(existingCoverId);
      ps.clearStopOrder(state, symbol);
      // fall through to fresh cover evaluation below
    } else {
      ps.clearStopOrder(state, symbol);
      ps.clearPosition(state, symbol);
      decision.reason = `cover order …${existingCoverId.slice(-8)} filled/gone — position cleared`;
      return decision;
    }
  }

  // Hard stop: cover if price rose >= stop_loss_pct above entry.
  if (shouldCoverShort(entry, cur)) {
    const cyclesOpen = psPos.stop_order_cycles || 0;
    const lim = coverLimitPrice(ask, cyclesOpen);
    decision.action = "COVER";
    decision.qty = Math.abs(qtyHeld);
    decision.limitPrice = lim;
    decision.isStopLoss = true;
    decision.reason = `COVER STOP-LOSS: entry $${entry.toFixed(4)}, current $${cur.toFixed(4)} (>= ${Math.trunc(STOP_LOSS_PCT * 100)}% adverse move)`;
    return decision;
  }

  // TA cover: score turned bullish enough to close the short.
  if (score >= COVER_SCORE_THRESHOLD) {
    decision.action = "COVER";
    decision.qty = Math.abs(qtyHeld);
    decision.limitPrice = Math.round(ask * (1 + LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
    decision.reason = `TA COVER: score=${score.toFixed(1)} >= ${COVER_SCORE_THRESHOLD.toFixed(1)}`;
    return decision;
  }

  const pctFromEntry = entry ? ((entry - cur) / entry) * 100 : 0;
  decision.reason = `HOLD SHORT ${Math.abs(qtyHeld)} @ $${entry.toFixed(4)} (${pctFromEntry.toFixed(2)}% profit), score=${score.toFixed(1)}`;
  return decision;
}

async function evaluateHeldLong({ decision, symbol, entry, cur, qtyHeld, score, ask, state, psPos, throttleActive, getOpenOrders, cancelOrder, getAccount }) {
  const hwm = psPos.high_water_mark || entry;
  const existingStopId = psPos.stop_order_id;

  // Deduplication: check for an existing pending stop order.
  if (existingStopId) {
    const cycles = ps.incrementStopOrderCycles(state, symbol);
    let stillOpen;
    try {
      const openOrders = await getOpenOrders(symbol);
      stillOpen = openOrders.some((o) => o.id === existingStopId);
    } catch {
      stillOpen = true; // fail safe: assume pending
    }

    if (stillOpen) {
      if (cycles < STOP_LOSS_ESCALATION_CYCLES) {
        decision.reason = `stop-loss pending (order …${existingStopId.slice(-8)}, cycle ${cycles}/${STOP_LOSS_ESCALATION_CYCLES})`;
        return decision;
      }
      await cancelOrder(existingStopId);
      ps.clearStopOrder(state, symbol);
      // fall through to fresh stop evaluation below
    } else {
      ps.clearStopOrder(state, symbol);
      ps.clearPosition(state, symbol);
      decision.reason = `stop order …${existingStopId.slice(-8)} filled/gone — position cleared`;
      return decision;
    }
  }

  // Trailing stop (supersedes hard stop once activated). TRAIL_MODE ==
  // "chandelier" is guarded unreachable at module load (see the top of this
  // file) -- the live config always uses the fixed trail %.
  const trailPct = TRAILING_STOP_TRAIL_PCT;
  if (shouldTrailStopOut(entry, hwm, cur, TRAILING_STOP_ACTIVATION_PCT, trailPct)) {
    const cyclesOpen = psPos.stop_order_cycles || 0;
    const lim = stopLossLimitPrice(ask, cyclesOpen);
    decision.action = "SELL";
    decision.qty = qtyHeld;
    decision.limitPrice = lim;
    decision.isStopLoss = true;
    decision.reason = `TRAILING STOP: entry $${entry.toFixed(4)} HWM $${hwm.toFixed(4)} current $${cur.toFixed(4)} trail_lim $${lim.toFixed(4)}`;
    return decision;
  }

  // TA-driven stop: just below the previous 4H range low (fixed
  // STOP_LOSS_PCT only as a fallback when 4H history is unavailable).
  let swingStop = null;
  if (STOP_LOSS_MODE === "swing_low_4h") {
    swingStop = swingLowStopPrice(entry, decision.lows4h);
  }

  // Trend/chop mode split: pyramiding (trend mode) ships OFF and is
  // guarded unreachable above, so trendMode is always false today -- kept
  // as a real (always-false) condition, not a hardcoded skip, so a future
  // pyramid port only needs to add the branch body back.
  const adxVal = decision.adx;
  const trendMode = PYRAMID_ENABLED && adxVal !== null && adxVal !== undefined && adxVal >= PYRAMID_ADX_MIN;

  // Partial take-profit ladder: at +1R (R = entry - stop distance) sell
  // PARTIAL_TP_FRACTION and raise the remaining stop to breakeven; the
  // remainder rides the existing trailing stop.
  if (PARTIAL_TP_ENABLED && !trendMode && !psPos.partial_tp_done) {
    const rStop = swingStop || entry * (1 - STOP_LOSS_PCT);
    if (shouldPartialTp(entry, cur, rStop, false, PARTIAL_TP_R_MULTIPLE)) {
      const partQty = Math.round(qtyHeld * PARTIAL_TP_FRACTION * 1e4) / 1e4;
      if (partQty > 0) {
        const triggerPrice = entry + (entry - rStop) * PARTIAL_TP_R_MULTIPLE;
        decision.action = "SELL";
        decision.qty = partQty;
        decision.limitPrice = Math.round(ask * (1 - LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
        decision.isPartialTp = true;
        decision.reason =
          `PARTIAL TP +${PARTIAL_TP_R_MULTIPLE.toFixed(1)}R: entry $${entry.toFixed(4)}, current $${cur.toFixed(4)} >= ` +
          `trigger $${triggerPrice.toFixed(4)} — selling ${Math.trunc(PARTIAL_TP_FRACTION * 100)}%, stop to breakeven`;
        return decision;
      }
    }
  }

  // Hard stop -- checked before TA, cannot be overridden. After the
  // partial TP, the breakeven stop (entry) supersedes a lower swing low so
  // the position can no longer turn into a loser.
  const breakeven = psPos.breakeven_stop;
  const stopCandidates = [swingStop, breakeven].filter((s) => s);
  const effStop = stopCandidates.length ? Math.max(...stopCandidates) : null;
  if (shouldStopOut(entry, cur, effStop)) {
    const cyclesOpen = psPos.stop_order_cycles || 0;
    const lim = stopLossLimitPrice(ask, cyclesOpen);
    decision.action = "SELL";
    decision.qty = qtyHeld;
    decision.limitPrice = lim;
    decision.isStopLoss = true;
    if (effStop && breakeven && effStop === breakeven) {
      decision.reason = `STOP-LOSS (breakeven after partial TP): entry $${entry.toFixed(4)}, current $${cur.toFixed(4)} <= stop $${effStop.toFixed(4)}`;
    } else if (effStop) {
      decision.reason = `STOP-LOSS (4H swing low): entry $${entry.toFixed(4)}, current $${cur.toFixed(4)} <= stop $${effStop.toFixed(4)} (prev 4H range low)`;
    } else {
      decision.reason = `STOP-LOSS (fallback): entry $${entry.toFixed(4)}, current $${cur.toFixed(4)} (>= ${Math.trunc(STOP_LOSS_PCT * 100)}% drawdown, no 4H data)`;
    }
    return decision;
  }

  // Discretionary exit on strongly bearish TA confluence.
  if (score <= SELL_SCORE_THRESHOLD) {
    decision.action = "SELL";
    decision.qty = qtyHeld;
    decision.limitPrice = Math.round(ask * (1 - LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
    decision.reason = `TA SELL: score=${score.toFixed(1)} <= ${SELL_SCORE_THRESHOLD.toFixed(1)}`;
    return decision;
  }

  // Stale-position exit: a position older than MAX_HOLD_HOURS that never
  // armed its trailing stop and whose live score is below the half-size
  // entry gate is dead capital -- free the correlation-budget slot.
  const trailingArmed = entry > 0 && hwm !== null && (hwm - entry) / entry >= TRAILING_STOP_ACTIVATION_PCT;
  if (isStalePosition(psPos.entry_time_iso, trailingArmed, score, BUY_SCORE_HALF_SIZE, MAX_HOLD_HOURS)) {
    decision.action = "SELL";
    decision.qty = qtyHeld;
    decision.limitPrice = Math.round(ask * (1 - LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
    decision.reason = `STALE EXIT: held > ${MAX_HOLD_HOURS.toFixed(0)}h, trailing stop never armed, score=${score.toFixed(1)} < ${BUY_SCORE_HALF_SIZE.toFixed(1)} — freeing budget slot`;
    return decision;
  }

  // Pyramid add: ships OFF (trendMode is always false today; guarded
  // unreachable at module load if the flag is ever flipped on).

  const pctFromEntry = entry ? ((cur - entry) / entry) * 100 : 0;
  decision.reason = `HOLD ${qtyHeld} @ $${entry.toFixed(4)} (${pctFromEntry.toFixed(2)}%), score=${score.toFixed(1)}`;
  return decision;
}

async function evaluateFlatEntry({ decision, symbol, score, ask, bid, state, openSymbols, throttleActive, getAccount, sessionPenaltyActive }) {
  // Gate 1: capital preservation mode (daily drawdown gate fired).
  if (ps.isCapitalPreservationMode(state)) {
    decision.reason = "BLOCKED: capital preservation mode active (daily drawdown gate)";
    return decision;
  }

  // Gate 2: correlation budget -- max open positions and per-tier limits.
  const { allowed, reason: budgetReason } = correlationBudgetAllows(symbol, openSymbols);
  if (!allowed) {
    decision.reason = "BLOCKED: " + budgetReason;
    return decision;
  }

  // Fetch account once -- needed for sizing either direction.
  let equity;
  try {
    const account = await getAccount();
    equity = Number(account.equity || 0);
  } catch (e) {
    decision.reason = "account fetch failed: " + e;
    return decision;
  }
  if (ask <= 0 || bid <= 0) {
    decision.reason = "no live quote";
    return decision;
  }

  const atrVal = decision.atr;

  // ── Long entry ──────────────────────────────────────────────────────
  // Regime gate (loosened): longs allowed in uptrend/mixed at score >=
  // BUY_SCORE_HALF_SIZE; in a confirmed downtrend a half-size counter-trend
  // long is allowed only at high confluence (score >= DOWNTREND_LONG_SCORE).
  const regime = decision.dailyRegime;
  const inDowntrend = regime === "downtrend";
  const allowLong = (!inDowntrend && score >= BUY_SCORE_HALF_SIZE) || (inDowntrend && score >= DOWNTREND_LONG_SCORE);
  if (allowLong) {
    // R:R soft entry gate: reward leg is net of the round-trip cost (2x
    // taker fee + live spread). Risk leg = distance to the 4H swing-low
    // stop; target = BB upper band. Soft: skipped when the stop/target
    // geometry is unavailable. (Measured-move target ships OFF -- guarded
    // unreachable at module load; the BB-upper target is used unconditionally.)
    let rrHalfNote = "";
    const costPct = roundTripCostPct(bid, ask, TAKER_FEE_BPS_PER_SIDE);
    const entryStop = swingLowStopPrice(ask, decision.lows4h);
    const bb = decision.bb;
    const bbTarget = bb && bb[2] && bb[2] > ask ? bb[2] : null;
    const target = bbTarget;
    const rr = netRr(ask, entryStop, target, costPct);
    decision.netRr = rr;
    if (rr !== null) {
      if (rr < MIN_RR_HALF) {
        decision.reason = `BLOCKED: net R:R ${rr.toFixed(2)} < ${MIN_RR_HALF.toFixed(1)} (stop $${entryStop.toFixed(4)}, target $${target.toFixed(4)}, round-trip cost ${(costPct * 100).toFixed(2)}%)`;
        return decision;
      }
      if (rr < MIN_RR_FULL) {
        rrHalfNote = `, half-size on net R:R ${rr.toFixed(2)} < ${MIN_RR_FULL.toFixed(1)}`;
      }
    }

    // Session-edge filter: half-size entries during hour/weekday buckets
    // whose realized expectancy is materially negative.
    let sessionNote = "";
    if (SESSION_FILTER_ENABLED && (await sessionPenaltyActive())) {
      sessionNote = ", half-size on negative session expectancy";
    }

    // Risk multiplier: conviction sizing ships OFF (guarded unreachable at
    // module load) -- the streak throttle still halves whatever the base is.
    let riskMult = 1.0;
    let conviction_note = "";
    if (throttleActive) {
      riskMult *= STREAK_THROTTLE_RISK_FACTOR;
      conviction_note += `, streak-throttle ${STREAK_THROTTLE_RISK_FACTOR.toFixed(1)}x`;
    }

    const baseQty = computeEntryQty(equity, symbol, ask, atrVal, riskMult);
    let qty, sizeNote;
    if (inDowntrend) {
      qty = Math.round(baseQty * 0.5 * 1e4) / 1e4;
      sizeNote = `half-size counter-trend (downtrend, score=${score.toFixed(1)})`;
    } else if (score < BUY_SCORE_THRESHOLD) {
      qty = Math.round(baseQty * 0.5 * 1e4) / 1e4;
      sizeNote = `half-size (score=${score.toFixed(1)})`;
    } else if (rrHalfNote || sessionNote) {
      qty = Math.round(baseQty * 0.5 * 1e4) / 1e4;
      sizeNote = `full-score (${score.toFixed(1)})${rrHalfNote}${sessionNote}`;
    } else {
      qty = baseQty;
      sizeNote = `full-size (score=${score.toFixed(1)})`;
    }
    sizeNote += conviction_note;

    if (qty > 0) {
      // Maker-first entry pricing: rest the limit at the bid instead of
      // paying taker at the ask. Entries only.
      if (MAKER_FIRST_ENTRIES && bid > 0) {
        decision.limitPrice = Math.round(bid * 1e4) / 1e4;
        sizeNote += ", maker@bid";
      } else {
        decision.limitPrice = Math.round(ask * 1e4) / 1e4;
      }
      decision.action = "BUY";
      decision.qty = qty;
      decision.reason = `TA BUY ${sizeNote}, atr=${(atrVal || 0).toFixed(4)}`;
      return decision;
    }
  }

  // ── Short entry ─────────────────────────────────────────────────────
  // VENUE GATE: Alpaca spot crypto cannot be shorted -- shorts are disabled
  // by default (strategy.shorts_enabled: false). Cover logic stays active
  // as a safety net for any legacy short position.
  if (SHORTS_ENABLED && decision.dailyRegime === "downtrend" && score <= SHORT_SCORE_HALF_SIZE) {
    const baseQty = computeEntryQty(equity, symbol, bid, atrVal);
    let qty, sizeNote;
    if (score > SHORT_SCORE_THRESHOLD) {
      qty = Math.round(baseQty * 0.5 * 1e4) / 1e4;
      sizeNote = `half-size short (score=${score.toFixed(1)})`;
    } else {
      qty = baseQty;
      sizeNote = `full-size short (score=${score.toFixed(1)})`;
    }

    if (qty > 0) {
      decision.action = "SHORT";
      decision.qty = qty;
      decision.limitPrice = Math.round(bid * 1e4) / 1e4;
      decision.reason = `TA SHORT ${sizeNote}, atr=${(atrVal || 0).toFixed(4)}`;
      return decision;
    }
  }

  // ── No actionable signal ────────────────────────────────────────────
  if (decision.dailyRegime === "downtrend") {
    if (SHORTS_ENABLED) {
      decision.reason = `no short entry: score=${score.toFixed(1)} > ${SHORT_SCORE_HALF_SIZE.toFixed(1)} (need more bearish confluence)`;
    } else {
      decision.reason = `downtrend: counter-trend long needs score >= ${DOWNTREND_LONG_SCORE.toFixed(1)} (have ${score.toFixed(1)}); shorts disabled (venue unsupported)`;
    }
  } else {
    decision.reason = `no entry: score=${score.toFixed(1)} (buy needs >= ${BUY_SCORE_HALF_SIZE.toFixed(1)}, regime=${decision.dailyRegime || "n/a"})`;
  }
  return decision;
}
