// src/marketData.js
//
// Shared Alpaca market-data + fill-history helpers -- extracted from
// scripts/run_evaluation.py's module-level functions (get_crypto_bars*,
// aggregate_bars_to_4h, _fetch_all_fills, _fifo_round_trips).
//
// This module doesn't exist as a separate file in Python -- there,
// scripts/scout.py and scripts/rebalance.py reach directly into
// run_evaluation.py for these (`from run_evaluation import get_crypto_bars,
// ...`), a circularity Python tolerates via late-binding function calls
// inside main(). ESM static imports would deadlock on that circularity, so
// this port extracts the shared surface into its own module: both
// runEvaluation.js and scout.js import from here instead of each other.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiGet } from "./apiClient.js";
import { DATA_URL, BASE_URL, headers } from "./trade.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

const _cfg = loadConfig();
const _data = _cfg.data || {};

// Bar-fetch sizes (config.json > data).
export const BARS_FOR_INDICATORS = Number(_data.bars_15min ?? 200);
export const BARS_4H_LOOKBACK = Number(_data.bars_4h ?? 120);
export const DAILY_BARS_LOOKBACK = Number(_data.bars_daily ?? 90);
export const MIN_BARS = Number(_data.min_bars_for_signal ?? 60);

export const BARS_TIMEFRAME = "15Min";
export const BARS_4H_TIMEFRAME = "4Hour";
export const DAILY_BARS_TIMEFRAME = "1Day";

// Minutes per bar for each timeframe -- used to derive the `start` date.
const TF_MINUTES = {
  "15Min": 15,
  "1H": 60,
  "1Hour": 60,
  "4Hour": 240,
  "1Day": 1440,
};

function toApiTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * ISO-8601 UTC start timestamp giving enough history for `limit` bars of the
 * given timeframe, with a generous buffer. Alpaca's crypto bar endpoint
 * ignores a bare `limit` and returns only the most-recent incomplete bars
 * unless an explicit `start` date is supplied -- always pass `start`.
 */
export function barsStart(limit, timeframe, buffer = 1.6, now = new Date()) {
  const minutes = TF_MINUTES[timeframe] ?? 60;
  const lookbackMinutes = Math.trunc(limit * minutes * buffer);
  return toApiTimestamp(new Date(now.getTime() - lookbackMinutes * 60_000));
}

/**
 * ISO-8601 UTC end timestamp that excludes the current in-progress bar.
 * Alpaca returns the currently-forming bar when no end date is supplied;
 * that partial bar has near-zero volume and produces unstable indicator
 * values that change mid-bar. Subtracting one full bar-period ensures only
 * fully-closed bars are included.
 */
export function barsEnd(timeframe, now = new Date()) {
  const minutes = TF_MINUTES[timeframe] ?? 60;
  return toApiTimestamp(new Date(now.getTime() - minutes * 60_000));
}

/**
 * Fetch OHLCV bars for a crypto symbol.
 *
 * Requests `sort=desc` (newest N bars, not the oldest N of the window) and
 * reverses the response back to chronological order, which all indicator
 * code expects -- Alpaca returns bars oldest-first by default, which with a
 * `start` ~1.6x the needed window back left daily bars up to 54 days stale.
 *
 * Alpaca also caps a single response at roughly 7 days of bars regardless
 * of `limit` -- follows `next_page_token` until `limit` bars are collected
 * or pages run out (hard cap of 10 pages, one page covers ~7 days).
 */
export async function getCryptoBars(symbol, limit = BARS_FOR_INDICATORS, timeframe = BARS_TIMEFRAME) {
  const params = {
    symbols: symbol,
    timeframe,
    start: barsStart(limit, timeframe),
    end: barsEnd(timeframe), // exclude the current in-progress bar
    limit,
    sort: "desc", // newest N bars, not oldest N
  };
  const url = DATA_URL + "/v1beta3/crypto/us/bars";
  let bars = [];
  for (let i = 0; i < 10; i++) {
    // hard page cap -- one page covers ~7 days
    const r = await apiGet(url, { headers: headers(), params, timeout: 20 });
    const payload = await r.json();
    bars = bars.concat(payload.bars?.[symbol] || []);
    const pageToken = payload.next_page_token;
    if (bars.length >= limit || !pageToken) break;
    params.page_token = pageToken;
  }
  return bars.slice(0, limit).reverse(); // back to chronological order
}

/** 4-Hour bars for the higher-timeframe trend filter. */
export function getCryptoBars4h(symbol, limit = BARS_4H_LOOKBACK) {
  return getCryptoBars(symbol, limit, BARS_4H_TIMEFRAME);
}

/** Daily bars for the 20/50-day SMA regime filter. */
export function getCryptoBarsDaily(symbol, limit = DAILY_BARS_LOOKBACK) {
  return getCryptoBars(symbol, limit, DAILY_BARS_TIMEFRAME);
}

/**
 * Aggregate 1-hour bars into synthetic 4-hour bars (4H data fallback).
 * Buckets align to 4-hour UTC boundaries (00/04/08/12/16/20). Only complete
 * buckets (all 4 hourly bars present) are kept so the synthetic OHLCV
 * matches what a native 4H bar would show; crypto trades 24/7 so complete
 * buckets are the norm.
 */
export function aggregateBarsTo4h(bars1h) {
  const buckets = new Map();
  const order = [];
  for (const b of bars1h || []) {
    const t = b?.t;
    if (!t || !b.c) continue;
    const dt = new Date(t);
    if (Number.isNaN(dt.getTime())) continue;
    const bucketHour = Math.floor(dt.getUTCHours() / 4) * 4;
    const bucketDt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), bucketHour, 0, 0, 0));
    const key = bucketDt.toISOString();
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(b);
  }
  const out = [];
  for (const key of order) {
    const grp = buckets.get(key);
    if (grp.length < 4) continue; // partial bucket (window edge / in-progress) — drop
    out.push({
      t: toApiTimestamp(new Date(key)),
      o: Number(grp[0].o || 0),
      h: Math.max(...grp.map((g) => Number(g.h || 0))),
      l: Math.min(...grp.map((g) => Number(g.l || 0))),
      c: Number(grp[grp.length - 1].c || 0),
      v: grp.reduce((sum, g) => sum + Number(g.v || 0), 0),
    });
  }
  return out;
}

/** Full paginated FILL activity history (newest first), capped at 10k. */
export async function fetchAllFills() {
  const fills = [];
  let pageToken = null;
  for (let i = 0; i < 100; i++) {
    const params = { activity_type: "FILL", page_size: 100, direction: "desc" };
    if (pageToken) params.page_token = pageToken;
    const r = await apiGet(BASE_URL + "/v2/account/activities", { headers: headers(), params, timeout: 20 });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    fills.push(...batch);
    if (batch.length < 100) break;
    pageToken = batch[batch.length - 1]?.id;
  }
  return fills;
}

/**
 * Chronological FIFO round-trips from FILL history: one object per matched
 * SELL fill ({ pnl, exit_iso }). SELLs with no prior BUY are excluded --
 * same matching rule as the dashboard Edge/P&L tabs. Shared by the
 * session-edge filter and the streak throttle.
 */
export function fifoRoundTrips(fills) {
  const queues = {};
  const trips = [];
  for (const act of [...(fills || [])].reverse()) {
    // newest-first feed -> chronological
    const sym = act.symbol;
    const side = act.side;
    const qty = Math.abs(Number(act.qty || 0));
    const price = Number(act.price || 0);
    const when = act.transaction_time || act.date;
    if (!sym || !when || qty <= 0 || price <= 0) continue;
    if (!queues[sym]) queues[sym] = [];
    if (side === "buy") {
      queues[sym].push([qty, price]);
    } else if (side === "sell") {
      let remaining = qty;
      let pnl = 0.0;
      let matched = false;
      while (remaining > 1e-9 && queues[sym].length) {
        const lot = queues[sym][0];
        const m = Math.min(remaining, lot[0]);
        pnl += m * (price - lot[1]);
        lot[0] -= m;
        remaining -= m;
        matched = true;
        if (lot[0] < 1e-6) queues[sym].shift();
      }
      if (matched) trips.push({ pnl, exit_iso: String(when) });
    }
  }
  return trips;
}
