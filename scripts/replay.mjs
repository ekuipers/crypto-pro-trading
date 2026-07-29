// scripts/replay.mjs
//
// CLI for the replay harness (src/replay.js). Fetches historical bars from
// Alpaca and reports what the engine WOULD have decided at every 15-min bar:
// score distribution, gate crossings, and which gate blocked each candidate.
//
//   node scripts/replay.mjs
//   node scripts/replay.mjs --symbols BTC/USD,LTC/USD --bars 1000
//   node scripts/replay.mjs --spread-pct 0.0058 --json out.json
//
//   # 4H execution (higher-timeframe filter shifts up to daily):
//   node scripts/replay.mjs --timeframe 4Hour --htf 1Day --bars 180 --spread-pct 0.0058
//
// --timeframe is the EXECUTION timeframe (the bars decisions are made on) and
// --htf is the higher-timeframe regime filter feeding signal 6. They shift
// together: 15Min/4Hour is production, 4Hour/1Day is the 4H proposal. Comparing
// two timeframes means holding the WALL-CLOCK window equal, not the bar count —
// 400 15-min bars is 4 days and 400 4H bars is 66 days, which compares two
// market regimes rather than two timeframes. scripts/compareTimeframes.mjs does
// that arithmetic for you.
//
// Read-only: fetches bars, places no orders, writes nothing but the optional
// --json report. Safe to run against live credentials (bar fetches are reads).
//
// NOT a backtester — no fills, no P&L. See src/replay.js's header for what
// this deliberately does and does not answer.
import { loadEnv } from "../src/env.js";
import { replaySymbol, summarize } from "../src/replay.js";
import { DEFAULT_CFG } from "../src/userConfig.js";

loadEnv();

const { getCryptoBars } = await import("../src/marketData.js");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")
    ? process.argv[idx + 1]
    : fallback;
}

const symbols = (arg("symbols") || (DEFAULT_CFG.WATCHLIST || []).join(",") ||
  "BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,LINK/USD,AVAX/USD,DOT/USD,LTC/USD,AAVE/USD")
  .split(",").map((s) => s.trim()).filter(Boolean);
const barCount = Number(arg("bars", "500"));
const TIMEFRAMES = ["15Min", "1Hour", "4Hour", "1Day"];
const timeframe = arg("timeframe", "15Min");
const htf = arg("htf", timeframe === "15Min" ? "4Hour" : "1Day");
for (const [flag, tf] of [["--timeframe", timeframe], ["--htf", htf]]) {
  if (!TIMEFRAMES.includes(tf)) {
    console.error(`${flag}: "${tf}" is not one of ${TIMEFRAMES.join(", ")}`);
    process.exit(1);
  }
}
// No default that pretends to be a measurement: 0.30% is a plausible mid-range
// crypto spread, but the real ones ranged 0.57-1.13% on 2026-07-29, and the
// spread feeds the R:R gate directly. Always state what you used.
const spreadPct = Number(arg("spread-pct", "0.003"));
const jsonOut = arg("json");

const TF_MIN = { "15Min": 15, "1Hour": 60, "4Hour": 240, "1Day": 1440 };
const spanDays = ((barCount * TF_MIN[timeframe]) / (60 * 24)).toFixed(1);
console.log(`replay: ${symbols.length} symbols x ${barCount} ${timeframe} bars (~${spanDays} days), HTF filter ${htf}`);
console.log(`assumed spread ${(spreadPct * 100).toFixed(3)}% — reads only, no orders, no fills simulated, no P&L\n`);

const report = { generatedAt: new Date().toISOString(), timeframe, htf, barCount, spanDays, spreadPct, symbols: {} };
const totals = { buckets: {}, actions: {}, windows: 0, crossHalfGate: 0, crossFullGate: 0, rrEvaluated: 0, rrNegative: 0 };

for (const symbol of symbols) {
  try {
    const [bars15, bars4h, barsDaily] = await Promise.all([
      getCryptoBars(symbol, barCount, timeframe),
      // Deep enough that the HTF slot is populated across the whole execution
      // window rather than only its recent end — signal 6 needs 51 HTF bars,
      // and a short HTF fetch silently scores n/a for the early windows.
      getCryptoBars(symbol, 400, htf),
      getCryptoBars(symbol, 400, "1Day"),
    ]);
    const { rows } = await replaySymbol(symbol, { bars15, bars4h, barsDaily }, { spreadPct });
    const s = summarize(rows);
    report.symbols[symbol] = s;

    totals.windows += s.windows;
    totals.crossHalfGate += s.crossHalfGate;
    totals.crossFullGate += s.crossFullGate;
    totals.rrEvaluated += s.rrEvaluated;
    totals.rrNegative += s.rrNegative;
    for (const [k, v] of Object.entries(s.buckets)) totals.buckets[k] = (totals.buckets[k] || 0) + v;
    for (const [k, v] of Object.entries(s.actions)) totals.actions[k] = (totals.actions[k] || 0) + v;

    const f = (n) => (n === null ? "  n/a" : n.toFixed(2).padStart(5));
    console.log(
      `${symbol.padEnd(10)} ${String(s.windows).padStart(4)} windows | ` +
      `score mean ${f(s.meanScore)} med ${f(s.medianScore)} p10 ${f(s.p10Score)} p90 ${f(s.p90Score)} | ` +
      `>=${DEFAULT_CFG.BUY_SCORE_HALF_SIZE}: ${String(s.crossHalfGate).padStart(3)}  >=${DEFAULT_CFG.BUY_SCORE_THRESHOLD}: ${String(s.crossFullGate).padStart(3)} | ` +
      `netR:R n=${String(s.rrEvaluated).padStart(3)} mean ${f(s.meanNetRr)} neg ${String(s.rrNegative).padStart(3)}`
    );
  } catch (e) {
    console.log(`${symbol.padEnd(10)} FAILED: ${e?.message || e}`);
  }
}

console.log(`\n--- totals over ${totals.windows} windows ---`);
console.log(`gate crossings: >=${DEFAULT_CFG.BUY_SCORE_HALF_SIZE} ${totals.crossHalfGate}  >=${DEFAULT_CFG.BUY_SCORE_THRESHOLD} ${totals.crossFullGate}`);
console.log("actions:", JSON.stringify(totals.actions));
console.log("outcome buckets (what decided each window):");
for (const [k, v] of Object.entries(totals.buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${String(v).padStart(5)}  ${((100 * v) / totals.windows).toFixed(1)}%`);
}

if (jsonOut) {
  const { writeFileSync } = await import("node:fs");
  report.totals = totals;
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
