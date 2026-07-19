// src/trade.js
//
// Order placement against Alpaca's paper API, with the CLAUDE.md rules
// enforced in code so they can't be bypassed by a caller that forgets them
// -- a faithful port of scripts/trade.py.
//
// Hard rules (see CLAUDE.md):
//   - Never market orders -- limitPrice is REQUIRED.
//   - Limit must be within config.json > risk.limit_band_pct of current ask.
//   - Single position must not exceed the per-symbol cap in
//     config.json > portfolio_caps.caps (e.g. 30% for BTC/USD, 5% for LINK/USD).
//     Default fallback: 5%.
//   - For US equities: never trade when /v2/clock reports the market is closed.
//   - For crypto: 24/7 trading, the /v2/clock gate does NOT apply.
//
// All HTTP calls go through apiClient's apiGet/apiPost/apiDelete, which add
// exponential-backoff retry on transient errors (config.json > api).
//
// Crypto symbols are detected by the '/' separator (e.g. "BTC/USD"), which
// is Alpaca's canonical form. Equity symbols have no slash (e.g. "AAPL").

import "./env.js"; // side effect: load .env into process.env
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiGet, apiPost, apiDelete } from "./apiClient.js";
import { toSlash } from "./symbols.js";
import { STOP_LOSS_LIMIT_BAND_PCT, checkLimitBand, checkPositionSize } from "./risk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

export const ALPACA_KEY = process.env.APCA_API_KEY_ID;
export const ALPACA_SECRET = process.env.APCA_API_SECRET_KEY;
export const BASE_URL = process.env.APCA_BASE_URL;
export const DATA_URL = "https://data.alpaca.markets";

// ---------------------------------------------------------------------------
// Portfolio caps
// ---------------------------------------------------------------------------

function loadCaps() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf-8"));
    return cfg.portfolio_caps || { caps: {}, default_cap: 0.05 };
  } catch {
    return { caps: {}, default_cap: 0.05 };
  }
}

const CAPS_DATA = loadCaps();

/** Return the position cap fraction for `symbol` from config.json > portfolio_caps.caps. */
function symbolCap(symbol) {
  return CAPS_DATA.caps?.[symbol] ?? CAPS_DATA.default_cap ?? 0.05;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Alpaca auth headers. Exported for reuse by marketData.js/scout.js (mirrors Python importing trade._headers). */
export function headers(jsonBody = false) {
  const h = {
    "APCA-API-KEY-ID": ALPACA_KEY || "",
    "APCA-API-SECRET-KEY": ALPACA_SECRET || "",
  };
  if (jsonBody) h["Content-Type"] = "application/json";
  return h;
}

/** Crypto symbols carry a '/' (e.g. BTC/USD). Equities do not. */
export function isCrypto(symbol) {
  return (symbol || "").includes("/");
}

// ---------------------------------------------------------------------------
// Account / position queries
// ---------------------------------------------------------------------------

/** Return the /v2/clock payload. Only relevant for US equities. */
export async function getMarketStatus() {
  const r = await apiGet(BASE_URL + "/v2/clock", { headers: headers(), timeout: 15 });
  return r.json();
}

export async function getAccount() {
  const r = await apiGet(BASE_URL + "/v2/account", { headers: headers(), timeout: 15 });
  return r.json();
}

/** Return all open positions from /v2/positions. */
export async function getPositions() {
  const r = await apiGet(BASE_URL + "/v2/positions", { headers: headers(), timeout: 15 });
  return r.json();
}

/**
 * Latest quote, dispatched by asset class. Returns an object with keys
 * `ap` (ask price) and `bp` (bid price) so callers don't need to care which
 * endpoint was hit.
 */
export async function getLatestQuote(symbol) {
  if (isCrypto(symbol)) {
    const url = DATA_URL + "/v1beta3/crypto/us/latest/quotes";
    const r = await apiGet(url, { headers: headers(), params: { symbols: symbol }, timeout: 15 });
    const body = await r.json();
    return body.quotes?.[symbol] || {};
  }
  const symQ = encodeURIComponent(symbol);
  const url = DATA_URL + "/v2/stocks/" + symQ + "/quotes/latest";
  const r = await apiGet(url, { headers: headers(), timeout: 15 });
  const body = await r.json();
  return body.quote || {};
}

// ---------------------------------------------------------------------------
// Order placement
// ---------------------------------------------------------------------------

/** Raised when a trade violates a CLAUDE.md rule. Fail closed. */
export class TradeRejected extends Error {
  constructor(message) {
    super(message);
    this.name = "TradeRejected";
  }
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
 * LIMIT_BAND_PCT (0.2%), and an out-of-band limit is CLAMPED to the nearest
 * band edge rather than rejected (see the 2026-06-11 fix below). Non-stop-
 * loss orders keep the strict reject-on-out-of-band behavior -- these are
 * two deliberately different code paths, not one shared one.
 */
export async function placeOrder(symbol, qty, side, limitPrice, isStopLoss = false) {
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
      // SELF-REJECTION FIX (2026-06-11): the limit was computed from a quote
      // fetched earlier in the evaluation cycle; if price moved more than
      // the band since then, rejecting leaves the position exposed for
      // another full cycle (journals showed repeated "limit outside
      // stop-loss 0.5% band" rejections). A stop-loss exists to exit --
      // clamp the limit to the nearest band edge of the FRESH ask instead
      // of failing. The hard rule (limit within 0.5% of ask) still holds:
      // the clamped price sits exactly on the band boundary.
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
  const r = await apiPost(BASE_URL + "/v2/orders", {
    headers: headers(true),
    json: orderData,
    timeout: 20,
  });
  return r.json();
}

// ---------------------------------------------------------------------------
// Order queries
// ---------------------------------------------------------------------------

/**
 * Return all open (pending) orders, optionally filtered to `symbol`.
 *
 * Alpaca returns crypto symbols without a slash in the orders response
 * (e.g. "BTCUSD" instead of "BTC/USD"), so this normalises both the stored
 * and compared values to slash form (and uppercases both sides) for
 * consistent matching -- a case or normalization slip here can produce a
 * duplicate stop-loss order.
 */
export async function getOpenOrders(symbol = null) {
  const r = await apiGet(BASE_URL + "/v2/orders", {
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
export async function getOrder(orderId) {
  const r = await apiGet(BASE_URL + "/v2/orders/" + orderId, { headers: headers(), timeout: 15 });
  return r.json();
}

/**
 * Cancel a single order by ID. Returns true if the cancellation was
 * accepted (204 or 200), false otherwise. Does not throw on 404 (already
 * filled/gone) or any other error.
 */
export async function cancelOrder(orderId) {
  try {
    const r = await apiDelete(BASE_URL + "/v2/orders/" + orderId, { headers: headers(), timeout: 15 });
    return r.status === 200 || r.status === 204;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export async function cancelAllOrders() {
  const r = await apiDelete(BASE_URL + "/v2/orders", { headers: headers(), timeout: 15 });
  return r.status;
}
