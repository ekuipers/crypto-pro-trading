// src/trade.js
//
// Legacy single-tenant Alpaca client, bound to the process-wide
// APCA_API_KEY_ID/APCA_API_SECRET_KEY/APCA_BASE_URL env vars -- kept as a
// thin shim so every existing call site (tests, CLI scripts, other src
// files) that imports named functions directly from this module keeps
// working unchanged. The actual HTTP/order-placement logic (and every
// CLAUDE.md hard rule) now lives in alpacaClient.js's createAlpacaClient(),
// which closes over a per-instance credential set instead of process.env --
// new multi-tenant call sites should build their own client via that
// factory instead of importing from here.
//
// Crypto symbols are detected by the '/' separator (e.g. "BTC/USD"), which
// is Alpaca's canonical form. Equity symbols have no slash (e.g. "AAPL").

import "./env.js"; // side effect: load .env into process.env
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAlpacaClient, TradeRejected as _TradeRejected, isCrypto as _isCrypto } from "./alpacaClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

export const ALPACA_KEY = process.env.APCA_API_KEY_ID;
export const ALPACA_SECRET = process.env.APCA_API_SECRET_KEY;
export const BASE_URL = process.env.APCA_BASE_URL;
export const DATA_URL = "https://data.alpaca.markets";

// ---------------------------------------------------------------------------
// Portfolio caps (config, not credentials -- stays global/env-scoped here
// until per-user strategy config lands as its own phase of the multi-tenant
// conversion; see CLAUDE.md's Roadmap).
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
// Legacy client -- bound to the single global env-var credential set.
// ---------------------------------------------------------------------------

export const defaultClient = createAlpacaClient({
  keyId: ALPACA_KEY,
  secret: ALPACA_SECRET,
  baseUrl: BASE_URL,
  dataUrl: DATA_URL,
  symbolCap,
});

export const {
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
} = defaultClient;

export const isCrypto = _isCrypto;
export const TradeRejected = _TradeRejected;
