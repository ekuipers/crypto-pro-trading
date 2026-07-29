// src/replay.test.js
//
// The replay harness exists to make scoring/gating changes measurable before
// they ship, so its own arithmetic has to be trustworthy — a harness that
// miscounts would launder a bad change instead of catching it.
//
// No network: every fixture is synthetic bars.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bucketReason, replaySymbol, summarize, MIN_WINDOW } from "./replay.js";

/** Chronological bars, one per `stepMs`, walking price by `drift` each bar. */
function bars(n, { start = 100, drift = 0, stepMs = 15 * 60_000, from = Date.UTC(2026, 0, 1), volume = 100 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const c = start * (1 + drift * i);
    return {
      t: new Date(from + i * stepMs).toISOString(),
      o: c, h: c * 1.002, l: c * 0.998, c, v: volume,
    };
  });
}

describe("bucketReason", () => {
  test("separates the two R:R fail-closed causes", () => {
    assert.equal(
      bucketReason("BLOCKED: net R:R unavailable — no upside to the BB upper band (price is at or above it) (round-trip cost 0.58%)"),
      "blocked:rr-no-target",
    );
    assert.equal(
      bucketReason("BLOCKED: net R:R unavailable — no 4H swing-low stop, so the risk leg is unmeasurable (round-trip cost 0.58%)"),
      "blocked:rr-no-stop",
    );
  });

  test("a numeric R:R block is one bucket, not one bucket per value", () => {
    const a = bucketReason("BLOCKED: net R:R 0.42 < 1.0 (stop $1.00, target $2.00, round-trip cost 0.58%)");
    const b = bucketReason("BLOCKED: net R:R 0.91 < 1.0 (stop $9.00, target $9.50, round-trip cost 1.13%)");
    assert.equal(a, "blocked:rr-too-low");
    assert.equal(a, b, "reasons differing only in numbers must share a bucket");
  });

  test("recognises the other gates", () => {
    assert.equal(bucketReason("no entry: score=1.0 below half-size gate"), "hold:score-below-gate");
    assert.equal(bucketReason("downtrend: counter-trend long needs score >= 4.0"), "hold:downtrend-score");
    assert.equal(bucketReason("capital preservation mode: entries blocked"), "blocked:drawdown-gate");
    assert.equal(bucketReason("quote fetch failed: boom"), "skipped:data-error");
  });

  test("an unrecognised reason surfaces as 'other' rather than being mis-filed", () => {
    // If a reason string is reworded, it must become visibly uncategorised
    // instead of quietly joining a neighbouring bucket and skewing a report.
    assert.equal(bucketReason("something nobody has written yet"), "other");
    assert.equal(bucketReason(""), "none");
    assert.equal(bucketReason(null), "none");
  });
});

describe("replaySymbol", () => {
  const series = () => ({
    bars15: bars(80, { drift: 0.001 }),
    bars4h: bars(60, { stepMs: 4 * 60 * 60_000, drift: 0.004 }),
    barsDaily: bars(60, { stepMs: 24 * 60 * 60_000, drift: 0.01 }),
  });

  test("evaluates one window per bar past the minimum", async () => {
    const s = series();
    const { rows, windows } = await replaySymbol("BTC/USD", s, { spreadPct: 0.003 });
    assert.equal(windows, s.bars15.length - MIN_WINDOW + 1);
    assert.equal(rows.length, windows);
  });

  test("refuses to run without an explicit spread", async () => {
    // A defaulted spread would silently move the R:R gate — one of the exact
    // things this harness is meant to measure.
    await assert.rejects(() => replaySymbol("BTC/USD", series(), {}), TypeError);
    await assert.rejects(() => replaySymbol("BTC/USD", series(), { spreadPct: -1 }), TypeError);
  });

  test("the spread reaches the R:R calculation", async () => {
    // Regression: a harness whose spread parameter does nothing would report
    // confident numbers that are all the same run.
    const s = series();
    const cheap = await replaySymbol("BTC/USD", s, { spreadPct: 0.0001 });
    const dear = await replaySymbol("BTC/USD", s, { spreadPct: 0.02 });
    const rr = (r) => r.rows.map((x) => x.netRr).filter((x) => typeof x === "number");
    const [a, b] = [rr(cheap), rr(dear)];
    if (a.length && b.length) {
      const mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
      assert.ok(mean(a) > mean(b), "a wider spread must lower net R:R");
    }
  });

  test("higher-timeframe bars are aligned by timestamp, never by index", async () => {
    // Index alignment would leak future 4H/daily regime into early windows,
    // which is the classic way a replay flatters a strategy.
    const bars15 = bars(70, { drift: 0.001 });
    // 4H bars that all POST-DATE the 15-min series: none may ever be visible.
    const future = bars(60, {
      stepMs: 4 * 60 * 60_000,
      from: Date.UTC(2030, 0, 1),
      drift: 0.02,
    });
    const withFuture = await replaySymbol("BTC/USD", { bars15, bars4h: future, barsDaily: future }, { spreadPct: 0.003 });
    const withNone = await replaySymbol("BTC/USD", { bars15, bars4h: [], barsDaily: [] }, { spreadPct: 0.003 });
    assert.deepEqual(
      withFuture.rows.map((r) => r.score),
      withNone.rows.map((r) => r.score),
      "future-dated higher-timeframe bars must be invisible",
    );
  });

  test("every row carries what a report needs", async () => {
    const { rows } = await replaySymbol("BTC/USD", series(), { spreadPct: 0.003 });
    for (const key of ["t", "close", "score", "action", "bucket", "reason"]) {
      assert.ok(key in rows[0], `row is missing ${key}`);
    }
  });
});

describe("summarize", () => {
  const row = (over = {}) => ({ t: "", close: 1, score: 0, action: "HOLD", netRr: null, bucket: "other", reason: "", ...over });

  test("counts gate crossings at the configured thresholds", () => {
    const s = summarize([
      row({ score: 2.5 }), row({ score: 3.5 }), row({ score: 4.0 }), row({ score: 1.0 }),
    ]);
    assert.equal(s.crossHalfGate, 3, "2.5, 3.5 and 4.0 all clear the 2.5 gate");
    assert.equal(s.crossFullGate, 2, "3.5 and 4.0 clear the 3.5 gate");
  });

  test("reports the net R:R sample and how much of it is negative", () => {
    // The most consequential number in the whole report: a negative reward leg
    // cannot be rescued by any scoring change.
    const s = summarize([
      row({ netRr: -0.5 }), row({ netRr: -0.2 }), row({ netRr: 1.4 }), row({ netRr: null }),
    ]);
    assert.equal(s.rrEvaluated, 3);
    assert.equal(s.rrNegative, 2);
    assert.ok(Math.abs(s.meanNetRr - 0.2333333) < 1e-4);
  });

  test("tallies buckets and actions", () => {
    const s = summarize([row({ bucket: "entry", action: "BUY" }), row({ bucket: "entry", action: "BUY" }), row()]);
    assert.equal(s.buckets.entry, 2);
    assert.equal(s.actions.BUY, 2);
    assert.equal(s.actions.HOLD, 1);
  });

  test("empty input reports nulls, not NaN", () => {
    const s = summarize([]);
    assert.equal(s.meanScore, null);
    assert.equal(s.meanNetRr, null);
    assert.equal(s.windows, 0);
  });
});
