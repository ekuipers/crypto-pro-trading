// src/dailySummary.js
//
// Closing daily-journal summary — a faithful port of scripts/daily_summary.py
// (Bug #4, 2026-07-10). Writes equity/day-change, cash, open positions with
// unrealized P&L, today's fills, and realized P&L for round trips closed
// today (FIFO over the full fill history — same matching rule as the
// dashboard Edge/P&L tabs and marketData.js's fifoRoundTrips). Journal-only:
// places no orders, touches no position state.

import { pathToFileURL } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { toSlash } from "./symbols.js";
import { amsterdamParts } from "./tz.js";
import { getAccount as defaultGetAccount, getPositions as defaultGetPositions } from "./trade.js";
import { fetchAllFills as defaultFetchAllFills, fifoRoundTrips } from "./marketData.js";
import { JOURNAL_DIR } from "./journal.js";

function fillDateStr(act) {
  const when = act.transaction_time || act.date;
  if (!when) return null;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return amsterdamParts(d).dateStr;
}

/** FIFO round-trip P&L for SELL fills whose exit lands on `today` (GMT+2). */
export function realizedPnlToday(fills, today) {
  const trips = fifoRoundTrips(fills).filter((t) => amsterdamParts(new Date(t.exit_iso)).dateStr === today);
  return { pnlToday: trips.reduce((sum, t) => sum + t.pnl, 0), exitsToday: trips.length };
}

/** Build the `## Daily Summary HH:MM GMT+2` journal block text. */
export function buildSummary({ account, positions, fills, now }) {
  const equity = Number(account.equity || 0);
  const lastEquity = Number(account.last_equity || 0);
  const cash = Number(account.cash || 0);
  const dayPnl = lastEquity ? equity - lastEquity : 0.0;
  const dayPct = lastEquity ? (dayPnl / lastEquity) * 100 : 0.0;
  const { dateStr: today, timeStr } = amsterdamParts(now);

  const fillsToday = fills.filter((a) => fillDateStr(a) === today);
  const { pnlToday, exitsToday } = realizedPnlToday(fills, today);

  const lines = ["", `## Daily Summary ${timeStr} GMT+2`, ""];
  lines.push(`- Equity: $${equity.toFixed(2)} (day ${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(2)} / ${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}% vs previous close)`);
  lines.push(`- Cash: $${cash.toFixed(2)} (${(equity ? (cash / equity) * 100 : 0).toFixed(1)}% of equity)`);
  lines.push(`- Fills today: ${fillsToday.length}  |  Round trips closed today: ${exitsToday}  |  Realized P&L today: $${pnlToday >= 0 ? "+" : ""}${pnlToday.toFixed(2)}`);
  lines.push("");

  lines.push("### Open positions");
  if (positions.length) {
    for (const p of positions) {
      const sym = toSlash(p.symbol || "");
      const qty = Number(p.qty || 0);
      const entry = Number(p.avg_entry_price || 0);
      const cur = Number(p.current_price || 0);
      const upl = Number(p.unrealized_pl || 0);
      const pct = entry > 0 ? ((cur - entry) / entry) * 100 : 0.0;
      lines.push(`- ${sym} ${qty.toFixed(4)} @ $${entry.toFixed(4)} -> $${cur.toFixed(4)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%, $${upl >= 0 ? "+" : ""}${upl.toFixed(2)} unrealized)`);
    }
  } else {
    lines.push("- none (flat)");
  }
  lines.push("");

  lines.push("### Trades today");
  if (fillsToday.length) {
    const sorted = [...fillsToday].sort((a, b) => new Date(a.transaction_time || a.date || 0) - new Date(b.transaction_time || b.date || 0));
    for (const a of sorted) {
      const d = new Date(a.transaction_time || a.date || 0);
      const timePart = Number.isNaN(d.getTime()) ? "??:??" : amsterdamParts(d).timeStr;
      lines.push(`- ${timePart} ${String(a.side || "?").toUpperCase()} ${toSlash(a.symbol || "?")} ${Math.abs(Number(a.qty || 0)).toFixed(4)} @ $${Number(a.price || 0).toFixed(4)}`);
    }
  } else {
    lines.push("- No trades — no fills recorded today.");
  }
  return lines.join("\n") + "\n";
}

export function appendDailySummaryBlock(block, now = new Date(), journalDir = JOURNAL_DIR) {
  mkdirSync(journalDir, { recursive: true });
  const { dateStr } = amsterdamParts(now);
  const filePath = path.join(journalDir, dateStr + ".md");
  appendFileSync(filePath, block, "utf-8");
  return filePath;
}

/** Run one daily-summary pass. Returns a process-style exit code (0/1). */
export async function main({ deps = {} } = {}) {
  const getAccount = deps.getAccount || defaultGetAccount;
  const getPositions = deps.getPositions || defaultGetPositions;
  const fetchAllFills = deps.fetchAllFills || defaultFetchAllFills;
  const appendBlock = deps.appendDailySummaryBlock || appendDailySummaryBlock;
  const now = (deps.now || (() => new Date()))();

  let account, positions, fills;
  try {
    [account, positions, fills] = await Promise.all([getAccount(), getPositions(), fetchAllFills()]);
  } catch (e) {
    console.error("FAIL: daily summary: " + e);
    return 1;
  }

  const block = buildSummary({ account, positions, fills, now });
  const journalPath = appendBlock(block, now);
  console.log("Wrote daily summary to " + journalPath);
  return 0;
}

// CLI entrypoint, mirrors runEvaluation.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
