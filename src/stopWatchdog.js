// src/stopWatchdog.js
//
// Stop-loss watchdog (roadmap 2026-07-10 item 7) — a faithful port of
// scripts/stop_watchdog.py. Checks ONLY the exit levels of open long
// positions and fires the existing trade.js stop path. No research, no
// scoring, no new entries — decoupled from the hourly evaluation cycle so a
// move between evaluations doesn't run unprotected.
//
// Checks per open long, in priority order (identical to run_evaluation):
//   1. Pending SELL order for the symbol -> skip (dedup; covers stops placed
//      by the hourly engine, the dashboard Autopilot, or a previous
//      watchdog run).
//   2. Trailing stop: HWM from positions_state.json.
//   3. Hard stop: max(4H swing low, breakeven) with the fixed -5% fallback.
//
// Every external effect is injectable via `deps` (same pattern as
// runEvaluation.js) so the decision logic is unit-testable without HTTP
// stubbing.

import { pathToFileURL } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as ps from "./positionState.js";
import { toSlash } from "./symbols.js";
import { amsterdamParts } from "./tz.js";
import {
  getPositions as defaultGetPositions,
  getOpenOrders as defaultGetOpenOrders,
  getLatestQuote as defaultGetLatestQuote,
  placeOrder as defaultPlaceOrder,
  TradeRejected,
} from "./trade.js";
import { getCryptoBars4h as defaultGetCryptoBars4h } from "./marketData.js";
import { STOP_LOSS_MODE, STOP_LOSS_PCT, TRAIL_MODE, shouldStopOut, shouldTrailStopOut, stopLossLimitPrice, swingLowStopPrice } from "./risk.js";
import { assertNotShipped } from "./strategyConfig.js";
import { JOURNAL_DIR } from "./journal.js";

// Chandelier trailing is not ported to risk.js (see risk.js's scope note) —
// fail loudly rather than silently falling back to the fixed trail if it's
// ever switched on before that lands.
assertNotShipped("risk.trail_mode", TRAIL_MODE === "chandelier", "chandelierTrailPct");

/** Check one open long position. Returns a journal line when it acted, else null. */
export async function checkPosition(pos, state, execute, deps = {}) {
  const getOpenOrders = deps.getOpenOrders || defaultGetOpenOrders;
  const getLatestQuote = deps.getLatestQuote || defaultGetLatestQuote;
  const getCryptoBars4h = deps.getCryptoBars4h || defaultGetCryptoBars4h;
  const placeOrder = deps.placeOrder || defaultPlaceOrder;

  const sym = toSlash(pos.symbol || "");
  const qty = Number(pos.qty || 0);
  if (qty <= 0) return null; // long-only

  try {
    const orders = await getOpenOrders(sym);
    if (orders.some((o) => o.side === "sell")) return null; // exit already in flight
  } catch {
    return null; // can't verify -> fail safe, do nothing
  }

  const psPos = ps.getPosition(state, sym);
  let entry = Number(pos.avg_entry_price || 0);
  if (entry <= 0) entry = Number(psPos.entry_price || 0);
  if (entry <= 0) return null; // no usable cost basis

  let ask, bid;
  try {
    const q = await getLatestQuote(sym);
    ask = Number(q.ap || 0);
    bid = Number(q.bp || 0);
  } catch {
    return null;
  }
  const cur = bid || ask;
  if (cur <= 0 || ask <= 0) return null;

  // 4H bars for the swing-low stop.
  let swingStop = null;
  if (STOP_LOSS_MODE === "swing_low_4h") {
    try {
      const bars4h = await getCryptoBars4h(sym);
      const lows = bars4h.filter((b) => b.c).map((b) => Number(b.l || 0));
      swingStop = swingLowStopPrice(entry, lows);
    } catch {
      // fixed -5% fallback below
    }
  }

  // Trailing stop first (supersedes the hard stop once armed).
  const hwm = psPos.high_water_mark || entry;
  const trailHit = shouldTrailStopOut(entry, hwm, cur);

  const breakeven = psPos.breakeven_stop;
  const effStop = [swingStop, breakeven].filter((s) => s).length ? Math.max(...[swingStop, breakeven].filter((s) => s)) : null;
  const hardHit = shouldStopOut(entry, cur, effStop);

  if (!trailHit && !hardHit) return null;

  const kind = trailHit
    ? "TRAILING STOP"
    : effStop && breakeven && effStop === breakeven
      ? "STOP (breakeven)"
      : effStop
        ? "STOP (4H swing low)"
        : `STOP (fixed -${Math.round(STOP_LOSS_PCT * 100)}%)`;
  const lim = stopLossLimitPrice(ask, psPos.stop_order_cycles || 0);
  const line = `${sym} ${kind}: entry $${entry.toFixed(4)} current $${cur.toFixed(4)} -> SELL ${qty.toFixed(4)} @ $${lim.toFixed(4)}`;

  if (!execute) return line + " (dry-run)";
  try {
    const result = await placeOrder(sym, qty, "sell", lim, true);
    const orderId = result.id || "";
    if (orderId) ps.setStopOrder(state, sym, orderId, lim);
    return line + " id=" + orderId.slice(0, 8);
  } catch (e) {
    if (e instanceof TradeRejected) return line + " REJECTED: " + e.message;
    return line + " ERROR: " + String(e);
  }
}

/** Build the `## Stop Watchdog HH:MM GMT+2` block text (pure -- no I/O). See journal.js's buildJournalBlockText for why this is split out. */
export function buildStopWatchdogBlockText(actions, now = new Date()) {
  const { timeStr } = amsterdamParts(now);
  const lines = ["", `## Stop Watchdog ${timeStr} GMT+2`, ""];
  for (const line of actions) lines.push("- " + line);
  return lines.join("\n") + "\n";
}

/** Append a `## Stop Watchdog HH:MM GMT+2` block (only called when something acted). */
export function appendStopWatchdogBlock(actions, now = new Date(), journalDir = JOURNAL_DIR) {
  mkdirSync(journalDir, { recursive: true });
  const { dateStr } = amsterdamParts(now);
  const filePath = path.join(journalDir, dateStr + ".md");
  appendFileSync(filePath, buildStopWatchdogBlockText(actions, now), "utf-8");
  return filePath;
}

/**
 * Run one watchdog pass. Returns a process-style exit code (0 success, 1
 * hard failure). `execute=false` (the default) is a dry run.
 */
export async function main({ execute = false, deps = {} } = {}) {
  const getPositions = deps.getPositions || defaultGetPositions;
  const loadState = deps.loadState || ps.loadState;
  const saveState = deps.saveState || ps.saveState;
  const appendBlock = deps.appendStopWatchdogBlock || appendStopWatchdogBlock;
  const now = deps.now || (() => new Date());

  const state = loadState();
  let positions;
  try {
    positions = await getPositions();
  } catch (e) {
    console.error("FAIL: positions fetch: " + e);
    return 1;
  }

  const longs = positions.filter((p) => Number(p.qty || 0) > 0);
  const actions = [];
  for (const p of longs) {
    const line = await checkPosition(p, state, execute, deps);
    if (line) {
      actions.push(line);
      console.log(line);
    }
  }

  if (!actions.length) {
    console.log(`stop watchdog: ${longs.length} long position(s) checked, no stops hit`);
    return 0;
  }

  // Journal + state only when something happened (a no-op run must not
  // generate churn).
  if (execute) saveState(state);
  const journalPath = appendBlock(actions, now());
  console.log("Wrote: " + journalPath);
  return 0;
}

// CLI entrypoint, mirrors runEvaluation.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const execute = process.argv.includes("--execute");
  main({ execute }).then((code) => process.exit(code));
}
