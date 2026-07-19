// src/trade.test.js
//
// Tests for trade.js (port of scripts/trade.py), including a port of
// tests/test_trade_stop_clamp.py's stop-loss self-rejection-fix regression
// tests. No real network calls -- globalThis.fetch is stubbed throughout.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./testUtils/fetchStub.js";
import * as trade from "./trade.js";
import { STOP_LOSS_LIMIT_BAND_PCT } from "./risk.js";

let stub;
afterEach(() => {
  stub?.restore();
});

function quoteResponse(ask, bid = ask) {
  return { status: 200, body: { quotes: { "BTC/USD": { ap: ask, bp: bid } } } };
}
function accountResponse(equity) {
  return { status: 200, body: { equity: String(equity) } };
}
function orderAcceptedResponse(overrides = {}) {
  return { status: 200, body: { id: "test-order", status: "accepted", ...overrides } };
}

describe("placeOrder — basic rule enforcement", () => {
  test("rejects a missing limit price (no market orders)", async () => {
    await assert.rejects(
      () => trade.placeOrder("BTC/USD", 0.1, "buy", 0),
      (e) => e instanceof trade.TradeRejected
    );
  });

  test("rejects an invalid side", async () => {
    await assert.rejects(
      () => trade.placeOrder("BTC/USD", 0.1, "hold", 100),
      (e) => e instanceof trade.TradeRejected
    );
  });

  test("rejects when the equity market is closed", async () => {
    stub = stubFetch([{ status: 200, body: { is_open: false, next_open: "2026-07-20T13:30:00Z" } }]);
    await assert.rejects(
      () => trade.placeOrder("AAPL", 1, "buy", 100),
      (e) => e instanceof trade.TradeRejected && /market is closed/.test(e.message)
    );
  });

  test("crypto orders skip the market-hours gate entirely", async () => {
    stub = stubFetch([quoteResponse(100), accountResponse(1_000_000), orderAcceptedResponse()]);
    const result = await trade.placeOrder("BTC/USD", 1, "buy", 100.1);
    assert.equal(result.status, "accepted");
    // Only 3 calls: quote, account, POST order -- no /v2/clock call.
    assert.equal(stub.calls.length, 3);
    assert.ok(!stub.calls.some((c) => c.url.includes("/v2/clock")));
  });

  test("never sends a market order — type is always 'limit'", async () => {
    stub = stubFetch([quoteResponse(100), accountResponse(1_000_000), orderAcceptedResponse()]);
    await trade.placeOrder("BTC/USD", 1, "buy", 100.1);
    const postCall = stub.calls.find((c) => c.init.method === "POST");
    const body = JSON.parse(postCall.init.body);
    assert.equal(body.type, "limit");
  });

  test("crypto orders use time_in_force gtc", async () => {
    stub = stubFetch([quoteResponse(100), orderAcceptedResponse()]);
    await trade.placeOrder("BTC/USD", 1, "sell", 99.9);
    const postCall = stub.calls.find((c) => c.init.method === "POST");
    const body = JSON.parse(postCall.init.body);
    assert.equal(body.time_in_force, "gtc");
  });

  test("rejects a buy that exceeds the per-symbol cap", async () => {
    // BTC/USD cap is 30% per config.json; equity too small for this notional.
    stub = stubFetch([quoteResponse(100), accountResponse(100)]);
    await assert.rejects(
      () => trade.placeOrder("BTC/USD", 10, "buy", 100.1),
      (e) => e instanceof trade.TradeRejected
    );
  });

  test("normal (non-stop-loss) order keeps the strict band rejection", async () => {
    stub = stubFetch([quoteResponse(100)]);
    await assert.rejects(
      () => trade.placeOrder("BTC/USD", 0.1, "buy", 98.0),
      (e) => e instanceof trade.TradeRejected
    );
  });
});

// Port of tests/test_trade_stop_clamp.py's TestStopLossClamp class.
describe("placeOrder — stop-loss self-rejection clamp (2026-06-11 fix)", () => {
  test("a stale limit far below the fresh ask is clamped, not rejected", async () => {
    const ask = 100.0;
    const staleLimit = 98.0; // 2% below ask, way outside the 0.5% band
    stub = stubFetch([quoteResponse(ask), orderAcceptedResponse()]);
    const result = await trade.placeOrder("BTC/USD", 0.1, "sell", staleLimit, true);
    assert.equal(result.status, "accepted");
    const postCall = stub.calls.find((c) => c.init.method === "POST");
    const sent = Number(JSON.parse(postCall.init.body).limit_price);
    assert.ok(Math.abs(sent - ask * (1 - STOP_LOSS_LIMIT_BAND_PCT)) < 1e-9);
  });

  test("a limit already inside the band is sent unchanged", async () => {
    const ask = 100.0;
    const limit = 99.7; // 0.3% below ask, inside the 0.5% stop-loss band
    stub = stubFetch([quoteResponse(ask), orderAcceptedResponse()]);
    await trade.placeOrder("BTC/USD", 0.1, "sell", limit, true);
    const postCall = stub.calls.find((c) => c.init.method === "POST");
    const sent = Number(JSON.parse(postCall.init.body).limit_price);
    assert.equal(sent, limit);
  });

  test("normal orders (isStopLoss=false) still hard-reject the same distance", async () => {
    stub = stubFetch([quoteResponse(100.0)]);
    await assert.rejects(
      () => trade.placeOrder("BTC/USD", 0.1, "buy", 98.0, false),
      (e) => e instanceof trade.TradeRejected
    );
  });
});

describe("getOpenOrders", () => {
  test("matches Alpaca's bare (slash-less) uppercase symbol form", async () => {
    // toSlash's quote-suffix match is case-sensitive (mirrors symbols.py
    // exactly) -- Alpaca always returns crypto order symbols uppercase
    // (e.g. "BTCUSD"), which is the case that actually needs to match.
    stub = stubFetch([
      {
        status: 200,
        body: [
          { id: "1", symbol: "BTCUSD", side: "sell" },
          { id: "2", symbol: "ETHUSD", side: "sell" },
          { id: "3", symbol: "BTCUSD", side: "buy" },
        ],
      },
    ]);
    const orders = await trade.getOpenOrders("BTC/USD");
    assert.equal(orders.length, 2);
    assert.deepEqual(orders.map((o) => o.id).sort(), ["1", "3"]);
  });

  test("final uppercasing still matches an already-slashed symbol in a different case", async () => {
    // A symbol that already contains '/' is returned unchanged by toSlash,
    // so the case-insensitivity comes entirely from the trailing
    // .toUpperCase() applied on both sides of the comparison.
    stub = stubFetch([{ status: 200, body: [{ id: "1", symbol: "btc/usd" }] }]);
    const orders = await trade.getOpenOrders("BTC/USD");
    assert.equal(orders.length, 1);
  });

  test("returns everything when no symbol filter is given", async () => {
    stub = stubFetch([{ status: 200, body: [{ id: "1", symbol: "BTCUSD" }] }]);
    const orders = await trade.getOpenOrders();
    assert.equal(orders.length, 1);
  });

  test("tolerates a non-array response body", async () => {
    stub = stubFetch([{ status: 200, body: { error: "unexpected shape" } }]);
    const orders = await trade.getOpenOrders();
    assert.deepEqual(orders, []);
  });
});

describe("cancelOrder", () => {
  test("returns true on 200", async () => {
    stub = stubFetch([{ status: 200, body: {} }]);
    assert.equal(await trade.cancelOrder("order-1"), true);
  });

  test("returns true on 204", async () => {
    stub = stubFetch([{ status: 204, body: {} }]);
    assert.equal(await trade.cancelOrder("order-1"), true);
  });

  test("returns false (never throws) on 404 — already filled/gone", async () => {
    stub = stubFetch([{ status: 404, body: { message: "order not found" } }]);
    const result = await trade.cancelOrder("order-1");
    assert.equal(result, false);
  });
});
