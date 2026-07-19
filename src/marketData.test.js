// src/marketData.test.js
//
// Tests for marketData.js, including a port of tests/test_bars_fetch.py's
// TestGetCryptoBars and TestAggregateBarsTo4h classes.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./testUtils/fetchStub.js";
import {
  getCryptoBars,
  aggregateBarsTo4h,
  fetchAllFills,
  fifoRoundTrips,
  barsStart,
  barsEnd,
} from "./marketData.js";

let stub;
afterEach(() => {
  stub?.restore();
});

function barsResponse(barsDesc, nextPageToken = null) {
  return { status: 200, body: { bars: { "BTC/USD": barsDesc }, next_page_token: nextPageToken } };
}

describe("getCryptoBars", () => {
  test("requests sort=desc with start/end/limit set", async () => {
    stub = stubFetch([barsResponse([])]);
    await getCryptoBars("BTC/USD", 10, "15Min");
    const url = new URL(stub.calls[0].url);
    assert.equal(url.searchParams.get("sort"), "desc");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.ok(url.searchParams.get("start"));
    assert.ok(url.searchParams.get("end"));
  });

  test("reverses a descending payload back to chronological order", async () => {
    const desc = [
      { t: "2026-06-11T08:00:00Z", c: 3 },
      { t: "2026-06-11T07:45:00Z", c: 2 },
      { t: "2026-06-11T07:30:00Z", c: 1 },
    ];
    stub = stubFetch([barsResponse(desc)]);
    const bars = await getCryptoBars("BTC/USD", 3);
    const ts = bars.map((b) => b.t);
    assert.deepEqual(
      ts,
      [...ts].sort(),
      "must be chronological"
    );
    assert.equal(bars[bars.length - 1].t, "2026-06-11T08:00:00Z"); // newest bar last
  });

  test("empty response yields an empty array", async () => {
    stub = stubFetch([barsResponse([])]);
    const bars = await getCryptoBars("BTC/USD");
    assert.deepEqual(bars, []);
  });

  test("follows next_page_token until limit bars are collected", async () => {
    stub = stubFetch([
      barsResponse([{ t: "2026-07-10T08:00:00Z", c: 2 }], "tok123"),
      barsResponse([{ t: "2026-07-03T08:00:00Z", c: 1 }], null),
    ]);
    const bars = await getCryptoBars("BTC/USD", 2, "4Hour");
    assert.deepEqual(bars.map((b) => b.c), [1, 2]); // chronological across pages
    assert.equal(stub.calls.length, 2);
    const secondUrl = new URL(stub.calls[1].url);
    assert.equal(secondUrl.searchParams.get("page_token"), "tok123");
  });

  test("stops once limit is satisfied without an extra page request", async () => {
    stub = stubFetch([
      barsResponse(
        [
          { t: "2026-07-10T08:00:00Z", c: 2 },
          { t: "2026-07-10T04:00:00Z", c: 1 },
        ],
        "tok123"
      ),
    ]);
    const bars = await getCryptoBars("BTC/USD", 2, "4Hour");
    assert.equal(bars.length, 2);
    assert.equal(stub.calls.length, 1); // limit satisfied — no second request
  });
});

describe("aggregateBarsTo4h", () => {
  function hourBars(startHour, n) {
    const bars = [];
    for (let i = 0; i < n; i++) {
      const h = (startHour + i) % 24;
      bars.push({
        t: `2026-07-09T${String(h).padStart(2, "0")}:00:00Z`,
        o: 100.0 + i,
        h: 101.0 + i,
        l: 99.0 + i,
        c: 100.5 + i,
        v: 10.0,
      });
    }
    return bars;
  }

  test("aggregates one complete 4H bucket", () => {
    const bars = hourBars(4, 4); // 04:00–07:00
    const out = aggregateBarsTo4h(bars);
    assert.equal(out.length, 1);
    const b = out[0];
    assert.equal(b.t, "2026-07-09T04:00:00Z");
    assert.equal(b.o, 100.0); // first bar's open
    assert.equal(b.c, 100.5 + 3); // last bar's close
    assert.equal(b.h, 101.0 + 3); // max high
    assert.equal(b.l, 99.0); // min low
    assert.equal(b.v, 40.0); // summed volume
  });

  test("drops a partial (3-of-4) bucket", () => {
    const bars = hourBars(4, 3); // 04:00–06:00
    assert.deepEqual(aggregateBarsTo4h(bars), []);
  });

  test("produces two buckets from 8 hourly bars", () => {
    const bars = hourBars(0, 8); // 00–03 and 04–07
    const out = aggregateBarsTo4h(bars);
    assert.deepEqual(
      out.map((b) => b.t),
      ["2026-07-09T00:00:00Z", "2026-07-09T04:00:00Z"]
    );
  });

  test("skips malformed bars (null/invalid timestamp)", () => {
    const bars = hourBars(4, 4);
    bars.unshift({ t: null, c: 1 });
    bars.unshift({ t: "not-a-date", c: 1 });
    assert.equal(aggregateBarsTo4h(bars).length, 1);
  });
});

describe("fetchAllFills", () => {
  test("follows page_token until a short page ends pagination", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `p1-${i}` }));
    const page2 = [{ id: "p2-0" }, { id: "p2-1" }];
    stub = stubFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);
    const fills = await fetchAllFills();
    assert.equal(fills.length, 102);
    assert.equal(stub.calls.length, 2);
    const secondUrl = new URL(stub.calls[1].url);
    assert.equal(secondUrl.searchParams.get("page_token"), "p1-99");
  });

  test("stops on an empty batch", async () => {
    stub = stubFetch([{ status: 200, body: [] }]);
    const fills = await fetchAllFills();
    assert.deepEqual(fills, []);
    assert.equal(stub.calls.length, 1);
  });
});

describe("fifoRoundTrips", () => {
  test("matches a simple buy then sell into one round trip", () => {
    const fills = [
      // newest-first, as Alpaca returns them
      { symbol: "BTC/USD", side: "sell", qty: "1", price: "110", transaction_time: "2026-07-19T01:00:00Z" },
      { symbol: "BTC/USD", side: "buy", qty: "1", price: "100", transaction_time: "2026-07-19T00:00:00Z" },
    ];
    const trips = fifoRoundTrips(fills);
    assert.equal(trips.length, 1);
    assert.ok(Math.abs(trips[0].pnl - 10) < 1e-9);
  });

  test("a sell with no prior buy is excluded", () => {
    const fills = [
      { symbol: "ETH/USD", side: "sell", qty: "1", price: "100", transaction_time: "2026-07-19T00:00:00Z" },
    ];
    assert.deepEqual(fifoRoundTrips(fills), []);
  });

  test("partial fills across multiple buys are matched FIFO", () => {
    const fills = [
      { symbol: "BTC/USD", side: "sell", qty: "1.5", price: "120", transaction_time: "2026-07-19T02:00:00Z" },
      { symbol: "BTC/USD", side: "buy", qty: "1", price: "110", transaction_time: "2026-07-19T01:00:00Z" },
      { symbol: "BTC/USD", side: "buy", qty: "1", price: "100", transaction_time: "2026-07-19T00:00:00Z" },
    ];
    const trips = fifoRoundTrips(fills);
    assert.equal(trips.length, 1);
    // 1 @ (120-100) + 0.5 @ (120-110) = 20 + 5 = 25
    assert.ok(Math.abs(trips[0].pnl - 25) < 1e-9);
  });
});

describe("barsStart / barsEnd", () => {
  test("barsEnd excludes the current in-progress bar", () => {
    const now = new Date("2026-07-19T09:23:00Z");
    // 09:23 on a 15-min timeframe -> end = 09:08 (one bar period back)
    assert.equal(barsEnd("15Min", now), "2026-07-19T09:08:00Z");
  });

  test("barsStart looks back limit*minutes*buffer minutes", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    const start = barsStart(10, "1Hour", 1.6, now);
    // 10 * 60 * 1.6 = 960 minutes = 16 hours back
    assert.equal(start, "2026-07-18T20:00:00Z");
  });
});
