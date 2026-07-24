// src/runEvaluation.js
//
// One-shot (cron-driven) evaluation cycle -- a faithful port of
// scripts/run_evaluation.py's main(). Orchestration only: fetches
// positions/account, runs the daily-drawdown gate, reconciles state from
// fill history, evaluates every watchlist symbol (evaluateSymbol.js),
// applies rotation (rotation.js), places orders when `--execute` is passed,
// and always writes the journal (journal.js) and persists position state.
//
// Every external effect (positions/account/orders fetch, evaluateSymbol,
// applyRotation, journal writing, state persistence) is injectable via the
// `deps` option, defaulting to the real implementations -- so main()'s
// orchestration/ordering can be tested end-to-end with a handful of fully-
// stubbed scenarios, while branch coverage for the decision logic itself
// lives in evaluateSymbol.test.js/rotation.test.js/reconcile.test.js.

import { pathToFileURL } from "node:url";
import * as ps from "./positionState.js";
import { toSlash } from "./symbols.js";
import {
  isCrypto,
  getPositions as defaultGetPositions,
  getAccount as defaultGetAccount,
  getOpenOrders as defaultGetOpenOrders,
  cancelOrder as defaultCancelOrder,
  placeOrder as defaultPlaceOrder,
  defaultClient,
  TradeRejected,
} from "./trade.js";
import { evaluateSymbol as defaultEvaluateSymbol } from "./evaluateSymbol.js";
import { applyRotation as defaultApplyRotation } from "./rotation.js";
import { appendJournalBlock as defaultAppendJournalBlock, formatDecisionLine } from "./journal.js";
import {
  fetchAllFills as defaultFetchAllFills,
  fifoRoundTrips,
  getCryptoBars,
  getCryptoBars4h,
  getCryptoBarsDaily,
} from "./marketData.js";
import {
  reconcilePositionsFromFills as defaultReconcilePositionsFromFills,
  pruneStaleState,
  sevenDayDrawdown as defaultSevenDayDrawdown,
  sessionPenaltyActive as defaultSessionPenaltyActive,
} from "./reconcile.js";
import { promotedSymbols as defaultPromotedSymbols } from "./scout.js";
import {
  STOP_LOSS_MODE,
  STOP_LOSS_PCT,
  MAX_OPEN_POSITIONS,
  ENFORCE_BUDGET_ON_OPEN_POSITIONS,
  LIMIT_BAND_PCT,
  STREAK_THROTTLE_ENABLED,
  STREAK_THROTTLE_RISK_FACTOR,
  updateStreakThrottle,
  dailyDrawdownGateTriggered,
} from "./risk.js";
import {
  CFG,
  BUY_SCORE_THRESHOLD,
  BUY_SCORE_HALF_SIZE,
  DOWNTREND_LONG_SCORE,
  SELL_SCORE_THRESHOLD,
  SHORT_SCORE_THRESHOLD,
  SHORT_SCORE_HALF_SIZE,
  COVER_SCORE_THRESHOLD,
  SESSION_FILTER_ENABLED,
  MAKER_FIRST_ENTRIES,
  BREADTH_GATE_ENABLED,
  assertNotShipped,
} from "./strategyConfig.js";

// Portfolio-level breadth gate ships OFF in the live config and needs
// breadthPct()/breadthPolicy(), not yet ported to risk.js -- fail loudly if
// it's ever flipped on rather than silently skipping it.
assertNotShipped("strategy.breadth_gate_enabled", BREADTH_GATE_ENABLED, "breadthPct/breadthPolicy");

// trade.yml's evaluate cron (2026-07-24: once/day, cost-throttled pending
// Vercel Pro -- see CLAUDE.md "Schedule"). CADENCE_WARNING_MIN adds ~1h of
// slack over the expected gap to absorb normal GitHub Actions scheduling jitter.
const CADENCE_EXPECTED_MIN = 24 * 60;
const CADENCE_WARNING_MIN = CADENCE_EXPECTED_MIN + 60;

/**
 * Run one evaluation cycle. Returns a process-style exit code (0 success,
 * 1 hard failure). `execute=false` (the default) is a dry run: decisions
 * and the journal are still computed/written, but no orders are placed.
 */
export async function main({ execute = false, deps = {} } = {}) {
  const getPositions = deps.getPositions || defaultGetPositions;
  const getAccount = deps.getAccount || defaultGetAccount;
  const getOpenOrders = deps.getOpenOrders || defaultGetOpenOrders;
  const cancelOrder = deps.cancelOrder || defaultCancelOrder;
  const placeOrder = deps.placeOrder || defaultPlaceOrder;
  const evaluateSymbol = deps.evaluateSymbol || defaultEvaluateSymbol;
  const applyRotation = deps.applyRotation || defaultApplyRotation;
  const appendJournalBlock = deps.appendJournalBlock || defaultAppendJournalBlock;
  const fetchAllFills = deps.fetchAllFills || defaultFetchAllFills;
  const reconcilePositionsFromFills = deps.reconcilePositionsFromFills || defaultReconcilePositionsFromFills;
  const sevenDayDrawdown = deps.sevenDayDrawdown || defaultSevenDayDrawdown;
  const sessionPenaltyActive = deps.sessionPenaltyActive || defaultSessionPenaltyActive;
  const promotedSymbols = deps.promotedSymbols || defaultPromotedSymbols;
  const loadState = deps.loadState || ps.loadState;
  const saveState = deps.saveState || ps.saveState;
  const now = deps.now || (() => new Date());
  // evaluateSymbol()/applyRotation() make their own internal HTTP calls
  // (quote/bars/open-orders/account) and, unlike every other dependency in
  // this function, previously had no override seam at all from main() --
  // they'd silently keep trading on the legacy env-var account even when a
  // caller (e.g. a future per-user cron dispatcher) swapped every other dep
  // here. Both already accept a `deps`/options override internally
  // (evaluateSymbol.js/rotation.js), so only a client-bound bridge is
  // needed here, not a signature change in either file.
  const client = deps.client || defaultClient;
  const symbolDeps = {
    getLatestQuote: (s) => client.getLatestQuote(s),
    getOpenOrders: (s) => client.getOpenOrders(s),
    cancelOrder: (id) => client.cancelOrder(id),
    getAccount: () => client.getAccount(),
    getCryptoBars: (s, l, tf) => getCryptoBars(s, l, tf, { client }),
    getCryptoBars4h: (s, l) => getCryptoBars4h(s, l, { client }),
    getCryptoBarsDaily: (s, l) => getCryptoBarsDaily(s, l, { client }),
  };

  console.log("Starting evaluation...");
  const stopDesc =
    STOP_LOSS_MODE === "swing_low_4h" ? `stop=4H swing low (fallback ${(STOP_LOSS_PCT * 100).toFixed(0)}%)` : `stop=${(STOP_LOSS_PCT * 100).toFixed(0)}%`;
  console.log(
    `  thresholds: buy=${BUY_SCORE_THRESHOLD.toFixed(1)}  half=${BUY_SCORE_HALF_SIZE.toFixed(1)}  downtrend_long=${DOWNTREND_LONG_SCORE.toFixed(1)}  ` +
      `sell=${SELL_SCORE_THRESHOLD.toFixed(1)}  short=${SHORT_SCORE_THRESHOLD.toFixed(1)}  short_half=${SHORT_SCORE_HALF_SIZE.toFixed(1)}  ` +
      `cover=${COVER_SCORE_THRESHOLD.toFixed(1)}  ${stopDesc}`
  );

  // ── Load persistent position state ────────────────────────────────────
  const state = loadState();

  let symbols = (CFG.watchlist?.symbols || []).filter(isCrypto);
  // Universe scout: merge auto-promoted uptrending symbols. Promoted
  // symbols pass through every existing gate unchanged.
  if (CFG.scout?.enabled) {
    try {
      const extra = (await promotedSymbols({ refresh: true })).filter((x) => isCrypto(x) && !symbols.includes(x));
      if (extra.length) {
        console.log("Scout promoted: " + extra.join(", "));
        symbols = symbols.concat(extra);
      }
    } catch (e) {
      console.log(`Scout skipped: ${e}`);
    }
  }
  if (!symbols.length) {
    console.error("FAIL: no crypto symbols in config.json > watchlist.symbols");
    return 1;
  }

  let positions;
  try {
    positions = await getPositions();
  } catch (e) {
    console.error("FAIL: positions fetch: " + e);
    return 1;
  }

  let equity;
  try {
    const account = await getAccount();
    equity = Number(account.equity || 0);
  } catch (e) {
    console.error("FAIL: account fetch: " + e);
    return 1;
  }

  // ── Daily drawdown gate ────────────────────────────────────────────────
  ps.checkAndRefreshDayOpen(state, equity);
  const dayEquity = state.day_open_equity || equity;
  if (dailyDrawdownGateTriggered(dayEquity, equity)) {
    ps.activateCapitalPreservation(state);
    console.log(`WARNING: daily drawdown gate triggered (day_open=$${dayEquity.toFixed(2)} current=$${equity.toFixed(2)}) — capital preservation mode ON`);
  } else if (ps.isCapitalPreservationMode(state)) {
    console.log("INFO: capital preservation mode is active (set earlier today)");
  }

  // Alpaca returns crypto symbols without a slash (e.g. "BTCUSD") in the
  // positions response. Index both forms so holds are found regardless.
  const posBySymbol = {};
  for (const p of positions) {
    const raw = p.symbol || "";
    posBySymbol[raw] = p;
    posBySymbol[toSlash(raw)] = p;
  }
  const openSymbols = positions.map((p) => toSlash(p.symbol || ""));

  const journalWarnings = [];

  for (const w of pruneStaleState(state, openSymbols)) {
    console.log("INFO: " + w);
    journalWarnings.push(w);
  }

  // Cadence self-monitoring: journal a CADENCE WARNING whenever the
  // previous evaluation is > CADENCE_WARNING_MIN old -- keep this in sync
  // with trade.yml's actual cron so it doesn't false-fire on every run.
  const nowUtc = now();
  const lastEvalIso = state.last_evaluation_iso;
  if (lastEvalIso) {
    const lastEval = new Date(lastEvalIso);
    if (!Number.isNaN(lastEval.getTime())) {
      const gapMin = (nowUtc.getTime() - lastEval.getTime()) / 60000;
      if (gapMin > CADENCE_WARNING_MIN) {
        const msg = `CADENCE WARNING: previous evaluation was ${gapMin.toFixed(0)} minutes ago (expected every ${CADENCE_EXPECTED_MIN} min) — stops were unchecked in the gap`;
        console.log("WARNING: " + msg);
        journalWarnings.push(msg);
      }
    }
  }
  state.last_evaluation_iso = nowUtc.toISOString();

  // One shared fills fetch for reconciliation, the session-edge filter, and
  // the streak throttle.
  let fills = null;
  if (STREAK_THROTTLE_ENABLED || SESSION_FILTER_ENABLED) {
    try {
      fills = await fetchAllFills();
    } catch (e) {
      console.log(`fills fetch failed (throttle/session filter skipped): ${e}`);
    }
  }

  // Rebuild lost/corrupt per-position facts from fill history.
  for (const w of await reconcilePositionsFromFills(state, positions, { fills })) {
    console.log("WARNING: " + w);
    journalWarnings.push(w);
  }

  // Losing-streak / drawdown throttle: halves risk-per-trade until 2
  // consecutive winners AND drawdown < 2.5%. State persists across runs.
  let throttleActive = false;
  const roundTrips = fills ? fifoRoundTrips(fills) : [];
  if (STREAK_THROTTLE_ENABLED) {
    const wasActive = Boolean(state.streak_throttle_active);
    const dd7d = await sevenDayDrawdown();
    throttleActive = updateStreakThrottle(
      wasActive,
      roundTrips.map((rt) => rt.pnl),
      dd7d
    );
    state.streak_throttle_active = throttleActive;
    if (throttleActive) {
      const msg = `STREAK THROTTLE ACTIVE: risk-per-trade x${STREAK_THROTTLE_RISK_FACTOR.toFixed(1)} (7-day drawdown ${(dd7d * 100).toFixed(1)}%) — releases after 2 consecutive winners with drawdown < 2.5%`;
      console.log("WARNING: " + msg);
      journalWarnings.push(msg);
    }
  }
  // Pre-compute the session penalty from the shared round trips (the
  // filter self-guards on minimum sample size).
  if (SESSION_FILTER_ENABLED && fills !== null) {
    await sessionPenaltyActive({ roundTrips });
  }

  // Maker-first repricing timeout: cancel last cycle's unfilled entry BUY
  // limits so this cycle reprices them fresh.
  if (MAKER_FIRST_ENTRIES) {
    try {
      for (const o of await getOpenOrders()) {
        if (o.side === "buy" && o.type === "limit" && !(toSlash(o.symbol || "") in posBySymbol)) {
          await cancelOrder(o.id || "");
          console.log(`maker-first: cancelled stale entry ${o.symbol} ${String(o.id || "").slice(0, 8)}`);
        }
      }
    } catch (e) {
      console.log(`maker-first stale-entry sweep skipped: ${e}`);
    }
  }

  // Over-budget reconciliation: the budget only gates NEW entries, so scout
  // promotions / older entries can leave the book permanently over budget.
  if (openSymbols.length > MAX_OPEN_POSITIONS) {
    const msg =
      `BUDGET EXCEEDED ${openSymbols.length}/${MAX_OPEN_POSITIONS} positions open — the correlation budget only gates new entries` +
      (ENFORCE_BUDGET_ON_OPEN_POSITIONS ? "; weakest overflow position will be trimmed" : "");
    console.log("WARNING: " + msg);
    journalWarnings.push(msg);
  }

  // ── Evaluate all symbols ────────────────────────────────────────────────
  const decisions = [];
  for (const sym of symbols) {
    decisions.push(await evaluateSymbol(sym, posBySymbol, state, openSymbols, { throttleActive, deps: symbolDeps }));
  }

  // Position rotation at the correlation budget.
  const rotationNote = await applyRotation(decisions, posBySymbol, openSymbols, { getAccount: () => client.getAccount() });
  if (rotationNote) {
    console.log("INFO: " + rotationNote);
    journalWarnings.push(rotationNote);
  }

  // Portfolio-level breadth/regime gate ships OFF -- guarded unreachable at
  // module load above.

  // Optional over-budget trim (config-flagged): sell the weakest-scoring
  // overflow position so the book converges back to the budget.
  const overflow = openSymbols.length - MAX_OPEN_POSITIONS;
  if (ENFORCE_BUDGET_ON_OPEN_POSITIONS && overflow > 0) {
    const helds = decisions.filter(
      (d) => d.action === "HOLD" && d.score !== null && d.score !== undefined && d.symbol in posBySymbol && Number(posBySymbol[d.symbol].qty || 0) > 0
    );
    helds.sort((a, b) => a.score - b.score);
    for (const d of helds.slice(0, overflow)) {
      const qtyHeld = Number(posBySymbol[d.symbol].qty || 0);
      const ask = d.ask || 0;
      if (qtyHeld <= 0 || ask <= 0) continue;
      d.action = "SELL";
      d.qty = qtyHeld;
      d.limitPrice = Math.round(ask * (1 - LIMIT_BAND_PCT * 0.5) * 1e4) / 1e4;
      d.reason = `BUDGET TRIM: weakest overflow position (score=${d.score.toFixed(1)}), book ${openSymbols.length}/${MAX_OPEN_POSITIONS} over budget`;
      journalWarnings.push(`BUDGET TRIM: selling ${d.symbol} (score ${d.score.toFixed(1)})`);
    }
  }

  // ── Update high-water marks for held long positions ─────────────────────
  for (const d of decisions) {
    if (d.action === "HOLD") {
      const pos = posBySymbol[d.symbol];
      if (pos && Number(pos.qty || 0) > 0) {
        const cur = d.currentPrice || 0;
        if (cur > 0) ps.updateHighWaterMark(state, d.symbol, cur);
      }
    }
  }

  console.log("\nEvaluation results:");
  for (const d of decisions) console.log("  " + formatDecisionLine(d));

  const actionable = decisions.filter((d) => ["BUY", "SELL", "SHORT", "COVER"].includes(d.action) && d.qty && d.limitPrice);
  // Exits before entries so a rotation SELL frees cash/budget for its BUY.
  // Array.prototype.sort is stable (ES2019+), matching Python's stable sort.
  actionable.sort((a, b) => (["SELL", "COVER"].includes(a.action) ? 0 : 1) - (["SELL", "COVER"].includes(b.action) ? 0 : 1));

  const executed = [];
  if (execute && actionable.length) {
    console.log("\nPlacing orders:");
    // Sequential, not Promise.all: position-state mutations below are a
    // read-modify-write against the same `state` object per iteration.
    for (const d of actionable) {
      // BUY = open long, SELL = close long, SHORT = open short (sell side
      // when flat), COVER = close short (buy side).
      const side = ["BUY", "COVER"].includes(d.action) ? "buy" : "sell";
      const isStopLoss = d.isStopLoss || false;
      try {
        const result = await placeOrder(d.symbol, d.qty, side, d.limitPrice, isStopLoss);
        const orderId = result.id || "";
        console.log(`  OK       ${d.symbol} ${side} ${d.qty} @ $${d.limitPrice.toFixed(4)}  id=${orderId.slice(0, 8)}`);

        // Update position state based on what we just submitted.
        if (d.action === "BUY" && d.isPyramid) {
          ps.markPyramidAdd(state, d.symbol, d.entryPrice || d.limitPrice);
        } else if (d.action === "BUY") {
          ps.initPosition(state, d.symbol, d.limitPrice);
        } else if (d.action === "SHORT") {
          ps.initPosition(state, d.symbol, d.limitPrice);
        } else if (["SELL", "COVER"].includes(d.action) && isStopLoss) {
          if (orderId) ps.setStopOrder(state, d.symbol, orderId, d.limitPrice);
        } else if (d.action === "SELL" && d.isPartialTp) {
          ps.markPartialTp(state, d.symbol, d.entryPrice || d.limitPrice);
        } else if (["SELL", "COVER"].includes(d.action) && !isStopLoss) {
          ps.clearPosition(state, d.symbol);
        }

        executed.push({ symbol: d.symbol, action: d.action, result });
      } catch (e) {
        if (e instanceof TradeRejected) {
          console.log(`  REJECTED ${d.symbol}: ${e.message}`);
          executed.push({ symbol: d.symbol, action: d.action, result: { rejected: e.message } });
        } else {
          console.log(`  ERROR    ${d.symbol}: ${e}`);
          executed.push({ symbol: d.symbol, action: d.action, result: { error: String(e) } });
        }
      }
    }
  } else if (actionable.length) {
    console.log(`\nDry-run: ${actionable.length} order(s) would be placed.`);
    console.log("Re-run with --execute to actually submit them.");
  } else {
    console.log("\nNo actionable decisions.");
  }

  // ── Persist state ──────────────────────────────────────────────────────
  saveState(state);

  const journalPath = appendJournalBlock({ decisions, executed, warnings: journalWarnings, now: now() });
  console.log("\nWrote: " + journalPath);
  return 0;
}

// CLI entrypoint, equivalent to Python's `if __name__ == "__main__":`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const execute = process.argv.includes("--execute");
  main({ execute }).then((code) => process.exit(code));
}
