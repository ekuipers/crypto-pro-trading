// ============================================================
// REPLAY HARNESS — measure what the engine WOULD have decided
// ------------------------------------------------------------
// Drives the real evaluateSymbol() across a sliding window of historical bars
// and tallies what came out: score distribution, action counts, and which gate
// blocked each candidate entry.
//
// Why this exists (2026-07-29): four strategy changes shipped in one day, each
// justified by a SINGLE live scan, and one of them shipped with a wrong
// published figure as a direct result — the "4x +0.5 / 2x -1.0" effect claim,
// which a proper 1,400-point replay showed was actually +0.18 on every symbol
// and negative on none. A single scan is not a measurement. This is the
// cheapest thing that makes scoring and gating changes measurable before they
// ship, against a live record of PF 0.30 and -2.27% expectancy per trade.
//
// Deliberately NOT a backtester. It simulates no fills, models no P&L, and
// answers no question about profitability. It answers "how often does each
// gate fire, and how are scores distributed" — which is what every open
// strategy question currently needs and none of them can get. Fill simulation
// and walk-forward P&L are the separate, larger follow-up that also retires
// the Backtest tab's permanently-stale banner.
//
// Fidelity notes, so results are not over-read:
//   * Higher-timeframe bars are aligned by TIMESTAMP, not index — at 15-min
//     bar t, only 4H/daily bars that had closed by t are visible. Aligning by
//     index would leak future regime data into every window.
//   * There are no historical quotes, so bid/ask are synthesized from the
//     bar close and a caller-supplied spread. Spread feeds the round-trip cost
//     and therefore the R:R gate directly, so it is an explicit parameter and
//     never a hidden default — pass the spread you actually measured.
//   * Every window is evaluated FLAT (no open position, no open orders). This
//     measures entry selection only; exits, trailing stops and rotation are
//     out of scope.
// ============================================================
import { evaluateSymbol } from "./evaluateSymbol.js";
import { EMPTY_STATE } from "./positionState.js";
import { DEFAULT_CFG } from "./userConfig.js";

/** Windows below this can't clear evaluateSymbol's own history gates. */
export const MIN_WINDOW = 60;

/**
 * Collapses a decision reason into a stable bucket.
 *
 * Reasons embed live numbers ("net R:R 0.42 < 1.0"), so tallying them raw
 * yields one bucket per window and tells you nothing. The buckets below are
 * the gates themselves — deliberately matched on the fixed prose, so a reason
 * whose wording changes shows up as "other" rather than being silently folded
 * into a neighbouring bucket.
 */
export function bucketReason(reason) {
  const r = String(reason || "");
  if (!r) return "none";
  if (/^BUY/.test(r) || /\bBUY\b/.test(r) && !/BLOCKED/.test(r)) return "entry";
  if (/net R:R unavailable/.test(r)) {
    return /risk leg is unmeasurable/.test(r) ? "blocked:rr-no-stop" : "blocked:rr-no-target";
  }
  if (/BLOCKED: net R:R/.test(r)) return "blocked:rr-too-low";
  if (/capital preservation/i.test(r)) return "blocked:drawdown-gate";
  if (/correlation budget|BUDGET/i.test(r)) return "blocked:correlation-budget";
  if (/not enough .*history|need \d+ bars/i.test(r)) return "skipped:insufficient-history";
  if (/fetch failed/i.test(r)) return "skipped:data-error";
  if (/no entry: score=/.test(r)) return "hold:score-below-gate";
  if (/counter-trend long needs score/.test(r)) return "hold:downtrend-score";
  return "other";
}

/** Advancing-pointer slice: bars whose timestamp is at or before `asOf`. */
function visibleThrough(bars, asOf, cursor) {
  let i = cursor;
  while (i < bars.length && new Date(bars[i].t).getTime() <= asOf) i++;
  return { slice: bars.slice(0, i), cursor: i };
}

/**
 * Replays one symbol across its 15-min history.
 *
 * @param {object} series {bars15, bars4h, barsDaily} chronological, each bar
 *   carrying at least {t, o, h, l, c, v}.
 * @param {number} spreadPct e.g. 0.0058 for the 0.58% measured on LTC. Feeds
 *   the round-trip cost and therefore the R:R gate.
 * @returns {Promise<{symbol, windows, rows}>} one row per evaluated window.
 */
export async function replaySymbol(symbol, series, { spreadPct, cfg = DEFAULT_CFG, minWindow = MIN_WINDOW } = {}) {
  if (typeof spreadPct !== "number" || !(spreadPct >= 0)) {
    // Refused rather than defaulted: a wrong spread quietly moves the R:R gate,
    // which is one of the things this harness exists to measure.
    throw new TypeError("replaySymbol requires an explicit non-negative spreadPct");
  }
  const { bars15, bars4h = [], barsDaily = [] } = series;
  const rows = [];
  let c4 = 0;
  let cD = 0;

  for (let i = minWindow; i <= bars15.length; i++) {
    const window15 = bars15.slice(0, i);
    const last = window15[window15.length - 1];
    const asOf = new Date(last.t).getTime();

    const v4 = visibleThrough(bars4h, asOf, c4);
    c4 = v4.cursor;
    const vD = visibleThrough(barsDaily, asOf, cD);
    cD = vD.cursor;

    const close = Number(last.c);
    const deps = {
      cfg,
      getLatestQuote: async () => ({ ap: close, bp: close * (1 - spreadPct) }),
      getCryptoBars: async () => window15,
      getCryptoBars4h: async () => v4.slice,
      getCryptoBarsDaily: async () => vD.slice,
      getOpenOrders: async () => [],
      cancelOrder: async () => true,
      getAccount: async () => ({ equity: "100000" }),
      // Never touch the network from a replay: the live session-penalty lookup
      // reads the real fill ledger, which has nothing to do with the window
      // being replayed and would make results depend on wall-clock time.
      sessionPenaltyActive: async () => false,
    };

    const d = await evaluateSymbol(symbol, {}, EMPTY_STATE(), [], { deps });
    rows.push({
      t: last.t,
      close,
      score: d.score ?? null,
      action: d.action,
      netRr: d.netRr ?? null,
      bucket: bucketReason(d.reason),
      reason: d.reason,
    });
  }

  return { symbol, windows: rows.length, rows };
}

/** Aggregates replay rows into the numbers worth reporting. */
export function summarize(rows) {
  const scores = rows.map((r) => r.score).filter((s) => typeof s === "number");
  const buckets = {};
  const actions = {};
  for (const r of rows) {
    buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;
    actions[r.action] = (actions[r.action] || 0) + 1;
  }
  const stats = (xs) => {
    if (!xs.length) return { mean: null, median: null, p10: null, p90: null };
    const sorted = [...xs].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      mean: xs.reduce((a, b) => a + b, 0) / xs.length,
      median: at(0.5),
      p10: at(0.1),
      p90: at(0.9),
    };
  };

  const s = stats(scores);
  // netRr is only computed for windows that cleared the score gate, so this is
  // a small sample by design — it describes the candidates that actually
  // reached the R:R gate, not every window.
  const rrs = rows.map((r) => r.netRr).filter((x) => typeof x === "number");
  const rr = stats(rrs);

  return {
    windows: rows.length,
    scored: scores.length,
    meanScore: s.mean,
    medianScore: s.median,
    p10Score: s.p10,
    p90Score: s.p90,
    // The two gates that decide position size, which is what a scoring change
    // actually moves.
    crossHalfGate: scores.filter((x) => x >= DEFAULT_CFG.BUY_SCORE_HALF_SIZE).length,
    crossFullGate: scores.filter((x) => x >= DEFAULT_CFG.BUY_SCORE_THRESHOLD).length,
    // Reported because a summary without it hides the most consequential
    // number here. Measured 2026-07-29: net R:R on the score-qualifying
    // candidates is NEGATIVE even at a 0.05% spread, because the 2x25bps taker
    // fee alone (0.5% round trip) already exceeds the 15-min BB-upper target
    // distance. `rrNegative` is the count where the reward leg is negative
    // before any risk comparison — those setups cannot pay for themselves at
    // any spread, so a scoring change cannot rescue them.
    rrEvaluated: rrs.length,
    meanNetRr: rr.mean,
    medianNetRr: rr.median,
    rrNegative: rrs.filter((x) => x < 0).length,
    actions,
    buckets,
  };
}
