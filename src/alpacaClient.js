// src/alpacaClient.js
//
// Credential-bound Alpaca API client factory. Every hard rule from
// CLAUDE.md (limit-only orders, band %, position cap) is enforced here so
// it can't be bypassed by a caller that forgets them -- moved verbatim from
// trade.js's former module-level functions/constants, which now close over
// a per-instance credential set (keyId/secret/baseUrl) instead of
// process.env, so multiple Alpaca accounts can be used in the same process
// (multi-tenant conversion, CLAUDE.md roadmap).
//
// trade.js still exports a `defaultClient` bound to the single legacy
// env-var credential set for backward compatibility -- this module has no
// opinion on where credentials come from.

import { apiGet, apiPost, apiDelete } from "./apiClient.js";
import { toSlash } from "./symbols.js";
import { STOP_LOSS_LIMIT_BAND_PCT, checkLimitBand, checkPositionSize } from "./risk.js";

/** Raised when a trade violates a CLAUDE.md rule. Fail closed. */
export class TradeRejected extends Error {
  constructor(message) {
    super(message);
    this.name = "TradeRejected";
  }
}

/** Crypto symbols carry a '/' (e.g. BTC/USD). Equities do not. */
export function isCrypto(symbol) {
  return (symbol || "").includes("/");
}

/**
 * Build an Alpaca API client bound to one credential set.
 *
 * `symbolCap(symbol) -> fraction` resolves the per-symbol position cap used
 * by `placeOrder`'s buy-side sizing check -- injected rather than read from
 * config.json directly here, since credential scope and config scope are
 * deliberately kept separate (per-user strategy config is a later, separate
 * phase of the multi-tenant conversion; this factory only ever needs a
 * resolver function, not an opinion on where it comes from).
 */
export function createAlpacaClient({
  keyId,
  secret,
  baseUrl,
  dataUrl = "https://data.alpaca.markets",
  symbolCap = () => 0.05,
} = {}) {
  /** Alpaca auth headers. */
  function headers(jsonBody = false) {
    const h = {
      "APCA-API-KEY-ID": keyId || "",
      "APCA-API-SECRET-KEY": secret || "",
    };
    if (jsonBody) h["Content-Type"] = "application/json";
    return h;
  }

  /** Return the /v2/clock payload. Only relevant for US equities. */
  async function getMarketStatus() {
    const r = await apiGet(baseUrl + "/v2/clock", { headers: headers(), timeout: 15 });
    return r.json();
  }

  async function getAccount() {
    const r = await apiGet(baseUrl + "/v2/account", { headers: headers(), timeout: 15 });
    return r.json();
  }

  /** Return all open positions from /v2/positions. */
  async function getPositions() {
    const r = await apiGet(baseUrl + "/v2/positions", { headers: headers(), timeout: 15 });
    return r.json();
  }

  /**
   * Latest quote, dispatched by asset class. Returns an object with keys
   * `ap` (ask price) and `bp` (bid price) so callers don't need to care
   * which endpoint was hit.
   */
  async function getLatestQuote(symbol) {
    if (isCrypto(symbol)) {
      const url = dataUrl + "/v1beta3/crypto/us/latest/quotes";
      const r = await apiGet(url, { headers: headers(), params: { symbols: symbol }, timeout: 15 });
      const body = await r.json();
      return body.quotes?.[symbol] || {};
    }
    const symQ = encodeURIComponent(symbol);
    const url = dataUrl + "/v2/stocks/" + symQ + "/quotes/latest";
    const r = await apiGet(url, { headers: headers(), timeout: 15 });
    const body = await r.json();
    return body.quote || {};
  }

  /**
   * Place a limit order. Will refuse to send anything that violates the
   * CLAUDE.md rules. There is intentionally no way to place a market order
   * through this function.
   *
   * For crypto symbols (slash-form, e.g. "BTC/USD"): trades 24/7, fractional
   * qty allowed, time_in_force is "gtc" (Alpaca requires gtc/ioc for crypto).
   * For equities: time_in_force is "day", clock gate enforced, integer qty.
   *
   * `isStopLoss` -- when true, the limit-band check uses the wider
   * STOP_LOSS_LIMIT_BAND_PCT (default 0.5%) instead of the normal
   * LIMIT_BAND_PCT (0.2%), and an out-of-band limit is CLAMPED to the
   * nearest band edge rather than rejected. Non-stop-loss orders keep the
   * strict reject-on-out-of-band behavior -- two deliberately different
   * code paths, not one shared one.
   */
  async function placeOrder(symbol, qty, side, limitPrice, isStopLoss = false) {
    if (!limitPrice || Number(limitPrice) <= 0) {
      throw new TradeRejected("limit_price is required -- market orders are forbidden by CLAUDE.md");
    }
    if (side !== "buy" && side !== "sell") {
      throw new TradeRejected(`side must be 'buy' or 'sell', got ${JSON.stringify(side)}`);
    }

    const crypto = isCrypto(symbol);
    qty = crypto ? Number(qty) : Math.trunc(Number(qty));
    limitPrice = Number(limitPrice);

    // Rule: never trade when the equity market is closed. Crypto skips this gate.
    if (!crypto) {
      const clock = await getMarketStatus();
      if (!clock.is_open) {
        throw new TradeRejected(
          `equity market is closed (next_open=${clock.next_open}) -- no trades allowed`
        );
      }
    }

    // Rule: limit must be within the configured band of ask.
    // Stop-loss orders use a wider band to ensure they fill in volatile markets.
    const quote = await getLatestQuote(symbol);
    const ask = Number(quote.ap || 0);
    const bid = Number(quote.bp || 0);
    if (ask <= 0) {
      throw new TradeRejected(`${symbol}: no live ask available, cannot validate limit band`);
    }

    let bandCheck;
    if (isStopLoss) {
      const band = ask * STOP_LOSS_LIMIT_BAND_PCT;
      const diff = Math.abs(limitPrice - ask);
      if (diff > band) {
        // A stop-loss exists to exit -- clamp the limit to the nearest band
        // edge of the fresh ask instead of failing. The hard rule (limit
        // within 0.5% of ask) still holds: the clamped price sits exactly
        // on the band boundary.
        const clamped = Math.min(Math.max(limitPrice, ask - band), ask + band);
        console.log(
          `${symbol}: stop-loss limit ${limitPrice.toFixed(4)} outside ${(STOP_LOSS_LIMIT_BAND_PCT * 100).toFixed(1)}% band of ask ${ask.toFixed(4)} -- clamped to ${clamped.toFixed(4)}`
        );
        limitPrice = Math.round(clamped * 1e6) / 1e6;
      }
      bandCheck = { ok: true, reason: "ok" };
    } else {
      // bid enables the maker-safe inside-the-spread acceptance.
      bandCheck = checkLimitBand(limitPrice, ask, bid);
    }
    if (!bandCheck.ok) {
      throw new TradeRejected(`${symbol}: ${bandCheck.reason}`);
    }

    // Rule: per-symbol position cap (buys only).
    if (side === "buy") {
      const account = await getAccount();
      const equity = Number(account.equity || 0);
      const capPct = symbolCap(symbol);
      const sizeCheck = checkPositionSize(equity, qty, limitPrice, capPct);
      if (!sizeCheck.ok) {
        throw new TradeRejected(`${symbol}: ${sizeCheck.reason}`);
      }
    }

    const orderData = {
      symbol,
      qty: String(qty),
      side,
      type: "limit",
      time_in_force: crypto ? "gtc" : "day",
      limit_price: String(limitPrice),
    };
    const r = await apiPost(baseUrl + "/v2/orders", {
      headers: headers(true),
      json: orderData,
      timeout: 20,
    });
    return r.json();
  }

  /**
   * Return all open (pending) orders, optionally filtered to `symbol`.
   *
   * Alpaca returns crypto symbols without a slash in the orders response
   * (e.g. "BTCUSD" instead of "BTC/USD"), so this normalises both the
   * stored and compared values to slash form (and uppercases both sides)
   * for consistent matching -- a case or normalization slip here can
   * produce a duplicate stop-loss order.
   */
  async function getOpenOrders(symbol = null) {
    const r = await apiGet(baseUrl + "/v2/orders", {
      headers: headers(),
      params: { status: "open", limit: 100 },
      timeout: 15,
    });
    const body = await r.json();
    const orders = Array.isArray(body) ? body : [];

    if (symbol === null) return orders;

    const target = toSlash(symbol).toUpperCase();
    return orders.filter((o) => toSlash(o.symbol || "").toUpperCase() === target);
  }

  /** Fetch a single order by ID. */
  async function getOrder(orderId) {
    const r = await apiGet(baseUrl + "/v2/orders/" + orderId, { headers: headers(), timeout: 15 });
    return r.json();
  }

  /**
   * Cancel a single order by ID. Returns true if the cancellation was
   * accepted (204 or 200), false otherwise. Does not throw on 404 (already
   * filled/gone) or any other error.
   */
  async function cancelOrder(orderId) {
    try {
      const r = await apiDelete(baseUrl + "/v2/orders/" + orderId, { headers: headers(), timeout: 15 });
      return r.status === 200 || r.status === 204;
    } catch {
      return false;
    }
  }

  async function cancelAllOrders() {
    const r = await apiDelete(baseUrl + "/v2/orders", { headers: headers(), timeout: 15 });
    return r.status;
  }

  return {
    baseUrl,
    dataUrl,
    headers,
    getMarketStatus,
    getAccount,
    getPositions,
    getLatestQuote,
    placeOrder,
    getOpenOrders,
    getOrder,
    cancelOrder,
    cancelAllOrders,
  };
}
