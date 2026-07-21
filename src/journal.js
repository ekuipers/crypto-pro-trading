// src/journal.js
//
// Decision-line/indicator-block formatting and the journal writer -- a
// faithful port of scripts/run_evaluation.py's "Presentation helpers" and
// "Journal" sections (fmt_macd, fmt_bb, format_decision_line,
// format_indicator_block, append_journal_block).
//
// The decision object shape uses camelCase keys (matching this port's
// existing convention, e.g. indicators.js's `signalScore()` breakdown) --
// only the literal journal TEXT (labels like "score", "ema_x", "rsi") has
// to match Python's output, not the JS variable names that produce it.

import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { adxLabel } from "./indicators.js";
import { amsterdamParts } from "./tz.js";
import { ATR_MULTIPLIER } from "./strategyConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
export const JOURNAL_DIR = path.join(PROJECT_ROOT, "journal");

function signedFixed(x, decimals) {
  const s = x.toFixed(decimals);
  return x >= 0 ? "+" + s : s;
}

export function fmtMacd(m) {
  if (m === null || m === undefined) return "n/a";
  const [line, sig, hist] = m;
  return `line=${line.toFixed(4)} sig=${sig.toFixed(4)} hist=${hist.toFixed(4)}`;
}

export function fmtBb(b) {
  if (b === null || b === undefined) return "n/a";
  const [lower, middle, upper, bw, pb] = b;
  return `lower=${lower.toFixed(2)} mid=${middle.toFixed(2)} upper=${upper.toFixed(2)} bw=${bw.toFixed(4)} pb=${pb.toFixed(2)}`;
}

export function formatDecisionLine(d) {
  const parts = [d.symbol, d.action];
  if (d.score !== null && d.score !== undefined) parts.push(`score=${signedFixed(d.score, 1)}`);
  if (d.qty !== null && d.qty !== undefined && d.limitPrice !== null && d.limitPrice !== undefined) {
    parts.push(`qty=${String(d.qty)} limit=$${d.limitPrice.toFixed(4)}`);
  }
  if (d.netRr !== null && d.netRr !== undefined) parts.push(`net_rr=${d.netRr.toFixed(2)}`);
  if (d.ask) parts.push(`ask=$${d.ask.toFixed(4)}`);
  if (d.reason) parts.push(`(${d.reason})`);
  return parts.join(" ");
}

/** Multi-line indicator readout for the journal. */
export function formatIndicatorBlock(d) {
  const out = [];
  const scoreStr = d.score !== null && d.score !== undefined ? signedFixed(d.score, 1) : "n/a";
  out.push(`    score   : ${scoreStr}`);
  out.push(`    ema_x   : ${d.emaCross || "n/a"}`);
  out.push(`    rsi     : ${d.rsi !== null && d.rsi !== undefined ? d.rsi.toFixed(2) : "n/a"}`);
  out.push(`    macd    : ${fmtMacd(d.macd)}${d.macdFlip ? ` (${d.macdFlip.toUpperCase()} FLIP)` : ""}`);
  out.push(
    `    bb      : ${fmtBb(d.bb)}${d.bbTrend ? ` trend=${d.bbTrend}` : ""}${d.bbSqueeze ? " SQUEEZE" : ""}`
  );
  if (d.atr !== null && d.atr !== undefined) {
    out.push(`    atr     : ${d.atr.toFixed(4)}  stop_${ATR_MULTIPLIER.toFixed(1)}x=${(d.atr * ATR_MULTIPLIER).toFixed(4)}`);
  }
  if (d.adx !== null && d.adx !== undefined) {
    out.push(`    adx     : ${d.adx.toFixed(1)} (${adxLabel(d.adx)})`);
  }
  if (d.obvTrend) out.push(`    obv     : ${d.obvTrend}`);
  out.push(`    4h      : ${d.regime4h || "n/a"}`);
  if (d.dailyMa20 !== null && d.dailyMa20 !== undefined && d.dailyMa50 !== null && d.dailyMa50 !== undefined) {
    out.push(
      `    daily   : ma20=${d.dailyMa20.toFixed(4)} ma50=${d.dailyMa50.toFixed(4)} last=${d.dailyLast.toFixed(4)} regime=${d.dailyRegime}`
    );
  } else if (d.dailyRegime) {
    out.push(`    daily   : regime=${d.dailyRegime}`);
  }
  const breakdown = d.indicatorBreakdown || {};
  if (Object.keys(breakdown).length) {
    out.push("    signals :");
    for (const [k, v] of Object.entries(breakdown)) {
      out.push(`      ${(k + ":").padEnd(12)} ${v}`);
    }
  }
  return out.join("\n");
}

/**
 * Build the `## Evaluation HH:MM GMT+2` block text (pure -- no I/O), so
 * callers that need the text without writing to the local filesystem (e.g.
 * the Postgres-backed cron routes, where a Vercel serverless function has no
 * persistent local disk) can reuse the exact same formatting as the CLI path.
 */
export function buildJournalBlockText({ decisions, executed, warnings = [], now = new Date() } = {}) {
  const { timeStr } = amsterdamParts(now);
  const lines = ["", `## Evaluation ${timeStr} GMT+2`, ""];
  for (const w of warnings) lines.push(`**WARNING: ${w}**`);
  if (warnings.length) lines.push("");
  if (!decisions.length) lines.push("No symbols evaluated.");
  for (const d of decisions) {
    lines.push("- " + formatDecisionLine(d));
    if (d.dataQualityWarning) lines.push("    DATA-QUALITY WARNING: " + d.dataQualityWarning);
    if (d.score !== null && d.score !== undefined) lines.push(formatIndicatorBlock(d));
  }

  if (executed.length) {
    lines.push("");
    lines.push("### Orders submitted");
    for (const r of executed) {
      lines.push(`- ${r.symbol} ${r.action} -> ${String(JSON.stringify(r.result)).slice(0, 300)}`);
    }
  } else {
    lines.push("");
    lines.push("### No orders submitted");
  }
  return lines.join("\n") + "\n";
}

/**
 * Append one `## Evaluation HH:MM GMT+2` block to journal/YYYY-MM-DD.md
 * (Amsterdam wall-clock date/time -- see tz.js). Writes even on a dry run
 * (empty `executed`).
 */
export function appendJournalBlock({ decisions, executed, warnings = [], now = new Date(), journalDir = JOURNAL_DIR } = {}) {
  mkdirSync(journalDir, { recursive: true });
  const { dateStr } = amsterdamParts(now);
  const filePath = path.join(journalDir, dateStr + ".md");
  appendFileSync(filePath, buildJournalBlockText({ decisions, executed, warnings, now }), "utf-8");
  return filePath;
}
