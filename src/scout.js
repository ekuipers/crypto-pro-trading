// src/scout.js
//
// Universe scout -- finds tradable, uptrending, high-confluence symbols
// OUTSIDE the static config.json watchlist and promotes them for
// evaluation. A faithful port of scripts/scout.py.
//
// Why: the watchlist majors correlate at ~0.8. When BTC enters mark-down
// the whole list is blocked by the daily regime gate and the bot sits 100%
// in cash. The wider Alpaca universe usually contains a few genuinely
// uptrending pairs; promoting the best of them is a profit lever that keeps
// every existing hard rule intact (promoted symbols get the 5% default cap,
// Tier-2 correlation budget, score >= 4 entry gate, ATR sizing, stops).
//
// Flow (config.json > scout):
//   1. Fetch active tradable crypto assets (/v2/assets), keep */USD pairs,
//      drop anything already in the watchlist.
//   2. Cheap filter: daily bars -> keep confirmed UPTREND only (same regime
//      rule as run_evaluation).
//   3. Full 6-point confluence (15-min + 4H) on the survivors.
//   4. Keep score >= min_score, rank by score, take max_promoted.
//   5. Write data/watchlist_dynamic.json (atomic).
//
// runEvaluation's main() merges the promoted symbols when scout.enabled is
// true (it is, in the live config.json) and refreshes this file when older
// than scout.ttl_hours. Analysis-only: this module never places orders.
//
// scan()/promotedSymbols() take dependency-injectable overrides (matching
// this port's DI-for-testability convention) so orchestration can be unit-
// tested without any HTTP stubbing -- mirrors how tests/test_scout.py
// patches scout._daily_uptrend/_confluence as whole units in Python.

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { apiGet } from "./apiClient.js";
import { headers } from "./trade.js";
import { toSlash } from "./symbols.js";
import { sma, signalScore } from "./indicators.js";
import { getCryptoBars, getCryptoBars4h, getCryptoBarsDaily } from "./marketData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

export const BASE_URL = process.env.APCA_BASE_URL;

export const DYNAMIC_PATH = path.join(PROJECT_ROOT, "data", "watchlist_dynamic.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(path.join(PROJECT_ROOT, "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

const _cfg = loadConfig();
const _scoutCfg = _cfg.scout || {};

export const ENABLED = Boolean(_scoutCfg.enabled ?? false);
export const MAX_PROMOTED = Number(_scoutCfg.max_promoted ?? 3);
export const MIN_SCORE = Number(_scoutCfg.min_score ?? 4.0);
export const TTL_HOURS = Number(_scoutCfg.ttl_hours ?? 6.0);
export const MAX_SCAN = Number(_scoutCfg.max_scan ?? 60);

const QUOTE_SUFFIXES = ["/USDT", "/USDC", "/BTC", "/ETH"];

function watchlist() {
  return [...(_cfg.watchlist?.symbols || [])];
}

function toApiTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Active tradable USD-quoted crypto pairs, excluding the static watchlist. */
export async function getUniverse() {
  const r = await apiGet(BASE_URL + "/v2/assets", {
    headers: headers(),
    params: { asset_class: "crypto", status: "active" },
    timeout: 20,
  });
  const assets = await r.json();
  const wl = new Set(watchlist());
  const out = [];
  for (const a of assets) {
    if (!a.tradable) continue;
    const sym = toSlash(a.symbol || ""); // canonical BASE/QUOTE form
    if (!sym.endsWith("/USD") || QUOTE_SUFFIXES.some((q) => sym.endsWith(q))) continue;
    if (wl.has(sym) || out.includes(sym)) continue;
    out.push(sym);
  }
  return out.sort().slice(0, MAX_SCAN);
}

export async function dailyUptrend(symbol) {
  const bars = await getCryptoBarsDaily(symbol);
  const closes = bars.filter((b) => b.c).map((b) => Number(b.c || 0));
  if (closes.length < 50) return false;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const last = closes[closes.length - 1];
  return last > ma50 && ma20 > ma50;
}

export async function confluence(symbol) {
  const bars = await getCryptoBars(symbol);
  const usable = bars.filter((b) => b.c);
  const closes = usable.map((b) => Number(b.c || 0));
  if (closes.length < 60) return null;
  const highs = usable.map((b) => Number(b.h || 0));
  const lows = usable.map((b) => Number(b.l || 0));
  const volumes = usable.map((b) => Number(b.v || 0));
  let closes4h = null;
  try {
    const bars4h = await getCryptoBars4h(symbol);
    const c4 = bars4h.filter((b) => b.c).map((b) => Number(b.c || 0));
    closes4h = c4.length >= 51 ? c4 : null;
  } catch {
    // 4H fetch failure is tolerated -- confluence still scores on 15m alone
  }
  const { score } = signalScore(closes, { volumes, highs, lows, closes4h });
  return score;
}

function writeAtomicJson(filePath, payload) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (e) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only
    }
    throw e;
  }
}

/** Full scan. Returns and atomically writes the dynamic-watchlist payload. */
export async function scan({
  getUniverseFn = getUniverse,
  dailyUptrendFn = dailyUptrend,
  confluenceFn = confluence,
  dynamicPath = DYNAMIC_PATH,
  now = new Date(),
} = {}) {
  const candidates = [];
  const universe = await getUniverseFn();
  for (const sym of universe) {
    let score;
    try {
      if (!(await dailyUptrendFn(sym))) continue;
      score = await confluenceFn(sym);
    } catch (e) {
      console.log(`scout: ${sym} skipped (${e})`);
      continue;
    }
    if (score !== null && score !== undefined && score >= MIN_SCORE) {
      candidates.push({ symbol: sym, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const promoted = candidates.slice(0, MAX_PROMOTED);
  const payload = {
    generated: toApiTimestamp(now),
    scanned: universe.length,
    min_score: MIN_SCORE,
    symbols: promoted.map((c) => c.symbol),
    details: promoted,
  };
  writeAtomicJson(dynamicPath, payload);
  return payload;
}

export function ageHours(dynamicPath = DYNAMIC_PATH, now = new Date()) {
  try {
    const data = JSON.parse(readFileSync(dynamicPath, "utf-8"));
    const gen = new Date(data.generated);
    if (Number.isNaN(gen.getTime())) return Infinity;
    return (now.getTime() - gen.getTime()) / 3_600_000;
  } catch {
    return Infinity;
  }
}

/** Promoted symbols list, rescanning first when the file exceeds TTL. */
export async function promotedSymbols({ refresh = true, dynamicPath = DYNAMIC_PATH } = {}) {
  if (refresh && ageHours(dynamicPath) > TTL_HOURS) {
    await scan({ dynamicPath });
  }
  try {
    const data = JSON.parse(readFileSync(dynamicPath, "utf-8"));
    return data.symbols || [];
  } catch {
    return [];
  }
}
