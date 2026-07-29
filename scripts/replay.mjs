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
// Read-only: fetches bars, places no orders, writes nothing but the optional
// --json report. Safe to run against live credentials (bar fetches are reads).
//
// NOT a backtester — no fills, no P&L. See src/replay.js's header for what
// this deliberately does and does not answer.
import { loadEnv } from "../src/env.js";
import { replaySymbol, summarize } from "../src/replay.js";
import { DEFAULT_CFG } from "../src/userConfig.js";

loadEnv();

const { getCryptoBars, getCryptoBars4h, getCryptoBarsDaily } = await import("../src/marketData.js");

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
// No default that pretends to be a measurement: 0.30% is a plausible mid-range
// crypto spread, but the real ones ranged 0.57-1.13% on 2026-07-29, and the
// spread feeds the R:R gate directly. Always state what you used.
const spreadPct = Number(arg("spread-pct", "0.003"));
const jsonOut = arg("json");

console.log(`replay: ${symbols.length} symbols x ${barCount} 15-min bars, assumed spread ${(spreadPct * 100).toFixed(3)}%`);
console.log(`(reads only — no orders, no fills simulated, no P&L)\n`);

const report = { generatedAt: new Date().toISOString(), barCount, spreadPct, symbols: {} };
const totals = { buckets: {}, actions: {}, windows: 0, crossHalfGate: 0, crossFullGate: 0, rrEvaluated: 0, rrNegative: 0 };

for (const symbol of symbols) {
  try {
    const [bars15, bars4h, barsDaily] = await Promise.all([
      getCryptoBars(symbol, barCount),
      getCryptoBars4h(symbol),
      getCryptoBarsDaily(symbol),
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
