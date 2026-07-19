// src/indicators.test.js
//
// Port of tests/test_indicators.py. Uses Node's built-in test runner
// (node --test) so the scaffolding needs zero extra dependencies.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ind from "./indicators.js";

function sineCloses(n = 120) {
  return Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 6.0) + i * 0.3);
}

function sineOhlcv(n = 120) {
  const closes = sineCloses(n);
  const highs = closes.map((c, i) => c + Math.abs(Math.sin(i)) * 2);
  const lows = closes.map((c, i) => c - Math.abs(Math.cos(i)) * 2);
  const volumes = Array.from({ length: n }, (_, i) => 1000 + 500 * Math.abs(Math.sin(i / 3.0)));
  return { closes, highs, lows, volumes };
}

describe("sma", () => {
  test("basic average", () => {
    assert.equal(ind.sma([1.0, 2.0, 3.0, 4.0, 5.0], 3), 4.0);
  });
  test("full window", () => {
    assert.equal(ind.sma([10.0, 20.0, 30.0], 3), 20.0);
  });
  test("returns null when insufficient data", () => {
    assert.equal(ind.sma([1.0, 2.0], 5), null);
  });
  test("single element", () => {
    assert.equal(ind.sma([42.0], 1), 42.0);
  });
});

describe("ema", () => {
  test("returns value for sufficient data", () => {
    const result = ind.ema(sineCloses(), 20);
    assert.ok(result !== null && result > 0);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.ema([1.0, 2.0, 3.0], 10), null);
  });
  test("ema series length", () => {
    const closes = sineCloses();
    const series = ind.emaSeries(closes, 20);
    assert.equal(series.length, closes.length - 20 + 1);
  });
  test("ema series empty for insufficient data", () => {
    assert.deepEqual(ind.emaSeries([1.0, 2.0], 10), []);
  });
});

describe("emaCrossState", () => {
  test("returns a valid state on a sine uptrend", () => {
    const state = ind.emaCrossState(sineCloses(), 20, 50);
    assert.ok(["golden", "death", "neutral"].includes(state));
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.emaCrossState(Array(30).fill(1.0), 20, 50), null);
  });
  test("golden when fast above slow", () => {
    const closes = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(ind.emaCrossState(closes, 20, 50), "golden");
  });
  test("death when fast below slow", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 - i);
    assert.equal(ind.emaCrossState(closes, 20, 50), "death");
  });
});

describe("rsi", () => {
  test("value in range", () => {
    const r = ind.rsi(sineCloses());
    assert.ok(r !== null && r >= 0 && r <= 100);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.rsi([1.0, 2.0, 3.0], 14), null);
  });
  test("all gains gives high rsi", () => {
    const closes = Array.from({ length: 29 }, (_, i) => i + 1);
    const r = ind.rsi(closes, 14);
    assert.ok(r !== null && r > 90);
  });
  test("all losses gives low rsi", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 30 - i);
    const r = ind.rsi(closes, 14);
    assert.ok(r !== null && r < 10);
  });
  test("rsiRising returns boolean", () => {
    assert.equal(typeof ind.rsiRising(sineCloses()), "boolean");
  });
  test("rsiRising returns null for insufficient data", () => {
    assert.equal(ind.rsiRising([1.0, 2.0], 14), null);
  });
});

describe("macd", () => {
  test("returns array of three", () => {
    const result = ind.macd(sineCloses());
    assert.ok(result !== null && result.length === 3);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.macd(Array(20).fill(1.0)), null);
  });
  test("histogram is macd minus signal", () => {
    const [macdLine, signalLine, hist] = ind.macd(sineCloses());
    assert.ok(Math.abs(hist - (macdLine - signalLine)) < 1e-9);
  });
  test("flip returns valid value", () => {
    const flip = ind.macdFlip(sineCloses());
    assert.ok([null, "bullish", "bearish"].includes(flip));
  });
  test("histRising returns boolean", () => {
    assert.equal(typeof ind.macdHistRising(sineCloses()), "boolean");
  });
});

describe("bollinger", () => {
  test("returns array of five", () => {
    const result = ind.bollinger(sineCloses());
    assert.ok(result !== null && result.length === 5);
  });
  test("lower < middle < upper", () => {
    const [lower, middle, upper] = ind.bollinger(sineCloses());
    assert.ok(lower < middle && middle < upper);
  });
  test("bandwidth positive", () => {
    const [, , , bw] = ind.bollinger(sineCloses());
    assert.ok(bw > 0);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.bollinger(Array(10).fill(1.0), 20), null);
  });
  test("trend returns a valid label", () => {
    const trend = ind.bollingerTrend(sineCloses());
    assert.ok(["widening", "tightening", "stable", null].includes(trend));
  });
  test("squeeze returns boolean or null", () => {
    const sq = ind.bollingerSqueeze(sineCloses());
    assert.ok(sq === null || typeof sq === "boolean");
  });
});

describe("atr", () => {
  test("returns positive value", () => {
    const { closes, highs, lows } = sineOhlcv();
    const result = ind.atr(highs, lows, closes);
    assert.ok(result !== null && result > 0);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.atr(Array(5).fill(1.0), Array(5).fill(1.0), Array(5).fill(1.0), 14), null);
  });
  test("returns null when lengths mismatch", () => {
    assert.equal(ind.atr([1.0, 2.0, 3.0], [1.0, 2.0], [1.0, 2.0, 3.0]), null);
  });
});

describe("adx", () => {
  test("value in range", () => {
    const { closes, highs, lows } = sineOhlcv();
    const result = ind.adx(highs, lows, closes);
    assert.ok(result !== null && result >= 0 && result <= 100);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.adx(Array(20).fill(1.0), Array(20).fill(1.0), Array(20).fill(1.0), 14), null);
  });
  test("returns null when lengths mismatch", () => {
    assert.equal(ind.adx(Array(40).fill(1.0), Array(39).fill(1.0), Array(40).fill(1.0)), null);
  });
  test("strong trend scores high", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100.0 + i);
    const highs = closes.map((c) => c + 0.5);
    const lows = closes.map((c) => c - 0.5);
    const result = ind.adx(highs, lows, closes);
    assert.ok(result !== null && result > 25);
  });
  test("label buckets", () => {
    assert.equal(ind.adxLabel(null), "n/a");
    assert.equal(ind.adxLabel(10), "ranging/weak");
    assert.equal(ind.adxLabel(22), "emerging trend");
    assert.equal(ind.adxLabel(30), "trending");
    assert.equal(ind.adxLabel(50), "strong trend");
  });
});

describe("obv", () => {
  test("series length matches input", () => {
    const { closes, volumes } = sineOhlcv();
    assert.equal(ind.obvSeries(closes, volumes).length, closes.length);
  });
  test("series empty when lengths mismatch", () => {
    assert.deepEqual(ind.obvSeries([1.0, 2.0, 3.0], [100.0, 100.0]), []);
  });
  test("rising on up moves", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const volumes = Array(30).fill(100.0);
    assert.equal(ind.obvTrend(closes, volumes), "rising");
  });
  test("falling on down moves", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 31 - (i + 1));
    const volumes = Array(30).fill(100.0);
    assert.equal(ind.obvTrend(closes, volumes), "falling");
  });
  test("flat when unchanged", () => {
    const closes = Array(30).fill(100.0);
    const volumes = Array(30).fill(100.0);
    assert.equal(ind.obvTrend(closes, volumes), "flat");
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.obvTrend(Array(10).fill(1.0), Array(10).fill(100.0), 20), null);
  });
});

describe("volumeRatio", () => {
  test("above one when spike", () => {
    const volumes = [...Array(20).fill(100.0), 1000.0];
    const vr = ind.volumeRatio(volumes, 20);
    assert.ok(vr !== null && vr > 1.0);
  });
  test("below one when thin", () => {
    const volumes = [...Array(20).fill(1000.0), 10.0];
    const vr = ind.volumeRatio(volumes, 20);
    assert.ok(vr !== null && vr < 1.0);
  });
  test("returns null for insufficient data", () => {
    assert.equal(ind.volumeRatio(Array(5).fill(100.0), 20), null);
  });
});

describe("signalScore", () => {
  test("score within bounds", () => {
    const { closes, highs, lows, volumes } = sineOhlcv();
    const { score } = ind.signalScore(closes, { volumes, highs, lows });
    assert.ok(score >= -6.0 && score <= 6.0);
  });
  test("returns all breakdown keys", () => {
    const { closes, highs, lows, volumes } = sineOhlcv();
    const { parts } = ind.signalScore(closes, { volumes, highs, lows });
    for (const key of ["emaCross", "macd", "rsi", "bb", "volume", "regime4h"]) {
      assert.ok(key in parts, `missing breakdown key: ${key}`);
    }
  });
  test("insufficient data returns zero score", () => {
    const closes = [100.0, 101.0, 102.0, 101.5, 103.0];
    const { score } = ind.signalScore(closes);
    assert.equal(score, 0.0);
  });
  test("4H data affects score", () => {
    const closes = sineCloses();
    const { score: scoreNo4h } = ind.signalScore(closes);
    const closes4h = Array.from({ length: 59 }, (_, i) => i + 1);
    const { score: scoreWith4h } = ind.signalScore(closes, { closes4h });
    assert.ok(scoreWith4h >= scoreNo4h);
  });
  test("no volume data scores volume as n/a", () => {
    const { parts } = ind.signalScore(sineCloses(), { volumes: null });
    assert.ok(parts.volume.includes("n/a"));
  });
});
