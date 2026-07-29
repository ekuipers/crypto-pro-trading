// scripts/compareTimeframes.mjs
//
// Answers "which execution timeframe, which stop, which target?" by replaying
// the real engine over the SAME wall-clock window at each setting and comparing
// net R:R — the reward-to-risk geometry each configuration produces.
//
//   node scripts/compareTimeframes.mjs
//   node scripts/compareTimeframes.mjs --days 60 --spread-pct 0.0058
//   node scripts/compareTimeframes.mjs --symbols BTC/USD,ETH/USD --days 14
//
// Read-only: fetches bars, places no orders, writes nothing.
//
// WHY THIS EXISTS: on 2026-07-29 the first attempt at this comparison used 400
// bars of each timeframe — 4 days of 15-min against 66 days of 4H. That is not
// a timeframe comparison, it is two different market regimes. This script fixes
// the wall-clock window and derives the bar counts from it, so that mistake
// cannot be repeated silently.
//
// WHAT IT DOES NOT ANSWER: net R:R is GEOMETRY, not edge. A 2:1 reward-to-risk
// at a 30% win rate still loses money. Whether the confluence score predicts
// direction at a given horizon needs the walk-forward evaluator (fills + P&L),
// which does not exist yet. Do not read a good number here as "profitable".
import { loadEnv } from "../src/env.js";
import { replaySymbol } from "../src/replay.js";
import { DEFAULT_CFG } from "../src/userConfig.js";

loadEnv();
const { getCryptoBars } = await import("../src/marketData.js");
const ind = await import("../src/indicators.js");
const risk = await import("../src/risk.js");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const symbols = (arg("symbols") || (DEFAULT_CFG.WATCHLIST || []).join(",") ||
  "BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,LINK/USD,AVAX/USD,DOT/USD,LTC/USD,AAVE/USD")
  .split(",").map((s) => s.trim()).filter(Boolean);
const days = Number(arg("days", "30"));
const spreadPct = Number(arg("spread-pct", "0.0058"));
const LOOKBACK = 200;
const { BUY_SCORE_HALF_SIZE: HALF, MIN_RR_HALF: GATE, MIN_RR_FULL: FULL } = DEFAULT_CFG;

// Bar counts derived from ONE wall-clock span — the whole point of the script.
const BARS = { "15Min": days * 96, "4Hour": days * 6, "1Day": Math.max(days, 400) };

const CELLS = [
  // label,                                exec,     htf,     stop source, target
  ["15m exec · 4H stop · BB   (PRODUCTION)", "15Min", "4Hour", "htf",  "bb"],
  ["15m exec · 15m stop · BB              ", "15Min", "4Hour", "exec", "bb"],
  ["4H  exec · 1D stop · BB               ", "4Hour", "1Day",  "htf",  "bb"],
  ["4H  exec · 4H stop · BB               ", "4Hour", "1Day",  "exec", "bb"],
  ["4H  exec · 4H stop · 3xATR            ", "4Hour", "1Day",  "exec", 3],
];

const blank = () => ({ n: 0, neg: 0, pass: 0, full: 0, sum: 0 });
const acc = Object.fromEntries(CELLS.map(([l]) => [l, blank()]));
let checked = 0, mismatched = 0;

const swing = (ask, lows) => risk.swingLowStopPrice(
  ask, lows, DEFAULT_CFG.SWING_LOW_LOOKBACK_BARS, DEFAULT_CFG.SWING_LOW_BUFFER_PCT, DEFAULT_CFG.SWING_LOW_MAX_STOP_PCT);

console.log(`timeframe comparison — ${symbols.length} symbols over the SAME ${days} days, spread ${(spreadPct * 100).toFixed(2)}%`);
console.log(`bar counts derived from the span: ${BARS["15Min"]} x 15Min = ${BARS["4Hour"]} x 4Hour\n`);

const barCache = new Map();
const fetchBars = async (sym, tf) => {
  const k = `${sym}|${tf}`;
  if (!barCache.has(k)) barCache.set(k, await getCryptoBars(sym, BARS[tf], tf));
  return barCache.get(k);
};

for (const symbol of symbols) {
  try {
    for (const [label, execTf, htfTf, stopSrc, target] of CELLS) {
      const exec = await fetchBars(symbol, execTf);
      const htf = await fetchBars(symbol, htfTf);
      const daily = await fetchBars(symbol, "1Day");

      // Engine truth for the self-check on the cell the engine actually uses.
      const engineRows = stopSrc === "htf" && target === "bb"
        ? (await replaySymbol(symbol, { bars15: exec, bars4h: htf, barsDaily: daily }, { spreadPct })).rows
        : null;

      let cH = 0;
      for (let i = 60; i <= exec.length; i++) {
        const w = exec.slice(Math.max(0, i - LOOKBACK), i);
        const last = w[w.length - 1];
        const asOf = new Date(last.t).getTime();
        while (cH < htf.length && new Date(htf[cH].t).getTime() <= asOf) cH++;
        const hv = htf.slice(0, cH);

        const closes = w.map((b) => Number(b.c));
        const highs = w.map((b) => Number(b.h));
        const lows = w.map((b) => Number(b.l));
        const vols = w.map((b) => Number(b.v || 0));
        const { score } = ind.signalScore(closes, { volumes: vols, highs, lows, closes4h: hv.map((b) => Number(b.c)) });
        if (!(score >= HALF)) continue;

        const ask = Number(last.c);
        const cost = risk.roundTripCostPct(ask * (1 - spreadPct), ask);
        const stop = stopSrc === "exec" ? swing(ask, lows) : swing(ask, hv.map((b) => Number(b.l || 0)));
        const bb = ind.bollinger(closes);
        const atr = ind.atr(highs, lows, closes);
        const tgt = target === "bb" ? (bb && bb[2] > ask ? bb[2] : null) : (atr ? ask + target * atr : null);

        const rr = risk.netRr(ask, stop, tgt, cost);
        if (rr === null) continue;
        const a = acc[label];
        a.n++; a.sum += rr;
        if (rr < 0) a.neg++;
        if (rr >= GATE) a.pass++;
        if (rr >= FULL) a.full++;

        if (engineRows) {
          const truth = engineRows.find((r) => r.t === last.t);
          if (truth && typeof truth.netRr === "number") {
            checked++;
            if (Math.abs(truth.netRr - rr) > 1e-6) mismatched++;
          }
        }
      }
    }
    process.stdout.write(`  ${symbol} done\n`);
  } catch (e) {
    console.log(`  ${symbol} FAILED: ${e?.message || e}`);
  }
}

// The self-check is the reason to believe any of the other cells: the one cell
// the live engine computes itself must reproduce decision.netRr exactly.
console.log(`\nself-check vs the engine's own decision.netRr: ${checked} compared, ${mismatched} mismatched` +
  (mismatched ? "  *** RE-DERIVATION HAS DRIFTED — DO NOT TRUST THESE NUMBERS ***" : "  ✓"));

console.log(`\nconfiguration                            |     n | negative |  >=${GATE} gate |  >=${FULL} full | mean R:R`);
console.log("-----------------------------------------|-------|----------|-----------|-----------|---------");
for (const [label] of CELLS) {
  const a = acc[label];
  const p = (x) => (a.n ? `${String(x).padStart(4)} (${((100 * x) / a.n).toFixed(0).padStart(3)}%)` : "    -    ");
  console.log(`${label} | ${String(a.n).padStart(5)} | ${p(a.neg)} | ${p(a.pass)} | ${p(a.full)} | ${a.n ? (a.sum / a.n).toFixed(2).padStart(7) : "      -"}`);
}
console.log("\nnet R:R is geometry, not edge — see this file's header before acting on it.");
