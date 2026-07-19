// src/journal.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fmtMacd, fmtBb, formatDecisionLine, formatIndicatorBlock, appendJournalBlock } from "./journal.js";

function baseDecision(overrides = {}) {
  return {
    symbol: "BTC/USD",
    action: "HOLD",
    reason: "",
    qty: null,
    limitPrice: null,
    ask: null,
    bid: null,
    score: null,
    atr: null,
    rsi: null,
    macd: null,
    macdFlip: null,
    bb: null,
    bbTrend: null,
    bbSqueeze: null,
    emaCross: null,
    adx: null,
    obvTrend: null,
    indicatorBreakdown: null,
    dailyMa20: null,
    dailyMa50: null,
    dailyLast: null,
    dailyRegime: null,
    regime4h: null,
    netRr: null,
    dataQualityWarning: null,
    ...overrides,
  };
}

describe("fmtMacd / fmtBb", () => {
  test("fmtMacd formats a 3-tuple, n/a for null", () => {
    assert.equal(fmtMacd(null), "n/a");
    assert.equal(fmtMacd([1.23456, 0.5, 0.73456]), "line=1.2346 sig=0.5000 hist=0.7346");
  });

  test("fmtBb formats a 5-tuple, n/a for null", () => {
    assert.equal(fmtBb(null), "n/a");
    assert.equal(fmtBb([95, 100, 105, 0.1, 0.6]), "lower=95.00 mid=100.00 upper=105.00 bw=0.1000 pb=0.60");
  });
});

describe("formatDecisionLine", () => {
  test("minimal HOLD with only symbol/action", () => {
    const line = formatDecisionLine(baseDecision());
    assert.equal(line, "BTC/USD HOLD");
  });

  test("full BUY line with score, qty, limit, net_rr, ask, reason", () => {
    const line = formatDecisionLine(
      baseDecision({
        action: "BUY",
        score: 3.5,
        qty: 0.5,
        limitPrice: 100.1234,
        netRr: 1.75,
        ask: 100.5,
        reason: "TA BUY full-size (score=3.5)",
      })
    );
    assert.equal(line, "BTC/USD BUY score=+3.5 qty=0.5 limit=$100.1234 net_rr=1.75 ask=$100.5000 (TA BUY full-size (score=3.5))");
  });

  test("negative score gets an explicit minus sign", () => {
    const line = formatDecisionLine(baseDecision({ score: -2.5 }));
    assert.match(line, /score=-2\.5/);
  });
});

describe("formatIndicatorBlock", () => {
  test("renders n/a placeholders when nothing is set", () => {
    const block = formatIndicatorBlock(baseDecision());
    assert.match(block, /score {3}: n\/a/);
    assert.match(block, /ema_x {3}: n\/a/);
    assert.match(block, /rsi {5}: n\/a/);
    assert.match(block, /macd {4}: n\/a/);
    assert.match(block, /4h {6}: n\/a/);
  });

  test("renders a fully populated indicator block", () => {
    const block = formatIndicatorBlock(
      baseDecision({
        score: 4.0,
        emaCross: "golden",
        rsi: 55.5,
        macd: [1.0, 0.5, 0.5],
        macdFlip: "bullish",
        bb: [95, 100, 105, 0.1, 0.6],
        bbTrend: "widening",
        bbSqueeze: true,
        atr: 1.2345,
        adx: 30.0,
        obvTrend: "rising",
        regime4h: "golden",
        dailyMa20: 100,
        dailyMa50: 95,
        dailyLast: 102,
        dailyRegime: "uptrend",
        indicatorBreakdown: { ema_cross: "GOLDEN (+1)", macd: "green (+1)" },
      })
    );
    assert.match(block, /score {3}: \+4\.0/);
    assert.match(block, /ema_x {3}: golden/);
    assert.match(block, /macd {4}: line=1\.0000 sig=0\.5000 hist=0\.5000 \(BULLISH FLIP\)/);
    assert.match(block, /bb {6}: lower=95\.00.*trend=widening SQUEEZE/);
    assert.match(block, /atr {5}: 1\.2345 {2}stop_1\.5x=1\.8518/);
    assert.match(block, /adx {5}: 30\.0 \(trending\)/);
    assert.match(block, /obv {5}: rising/);
    assert.match(block, /4h {6}: golden/);
    assert.match(block, /daily {3}: ma20=100\.0000 ma50=95\.0000 last=102\.0000 regime=uptrend/);
    assert.match(block, /signals :/);
    assert.match(block, /ema_cross: {3}GOLDEN \(\+1\)/);
  });
});

describe("appendJournalBlock", () => {
  function withTempJournalDir(fn) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-journal-test-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("writes a dated file with the Amsterdam HH:MM header", () => {
    withTempJournalDir((dir) => {
      const now = new Date("2026-07-19T10:23:00Z"); // 12:23 Amsterdam (CEST, +2)
      const filePath = appendJournalBlock({
        decisions: [baseDecision({ action: "HOLD", reason: "no entry" })],
        executed: [],
        journalDir: dir,
        now,
      });
      assert.equal(path.basename(filePath), "2026-07-19.md");
      const content = readFileSync(filePath, "utf-8");
      assert.match(content, /## Evaluation 12:23 GMT\+2/);
      assert.match(content, /- BTC\/USD HOLD \(no entry\)/);
      assert.match(content, /### No orders submitted/);
    });
  });

  test("appends a second block rather than overwriting the first", () => {
    withTempJournalDir((dir) => {
      const now = new Date("2026-07-19T10:23:00Z");
      appendJournalBlock({ decisions: [baseDecision()], executed: [], journalDir: dir, now });
      const later = new Date("2026-07-19T11:23:00Z");
      const filePath = appendJournalBlock({ decisions: [baseDecision()], executed: [], journalDir: dir, now: later });
      const content = readFileSync(filePath, "utf-8");
      assert.match(content, /## Evaluation 12:23 GMT\+2/);
      assert.match(content, /## Evaluation 13:23 GMT\+2/);
    });
  });

  test("renders warnings and executed orders", () => {
    withTempJournalDir((dir) => {
      const filePath = appendJournalBlock({
        decisions: [baseDecision({ action: "SELL", qty: 1, limitPrice: 99.5 })],
        executed: [{ symbol: "BTC/USD", action: "SELL", result: { id: "abc123", status: "accepted" } }],
        warnings: ["CADENCE WARNING: previous evaluation was 120 minutes ago"],
        journalDir: dir,
        now: new Date("2026-07-19T10:23:00Z"),
      });
      const content = readFileSync(filePath, "utf-8");
      assert.match(content, /\*\*WARNING: CADENCE WARNING/);
      assert.match(content, /### Orders submitted/);
      assert.match(content, /- BTC\/USD SELL -> /);
    });
  });

  test("writes 'No symbols evaluated.' when decisions is empty", () => {
    withTempJournalDir((dir) => {
      const filePath = appendJournalBlock({ decisions: [], executed: [], journalDir: dir, now: new Date() });
      const content = readFileSync(filePath, "utf-8");
      assert.match(content, /No symbols evaluated\./);
    });
  });
});
