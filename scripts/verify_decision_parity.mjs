// scripts/verify_decision_parity.mjs
//
// Node port cutover -- Gate 1: deterministic decision parity between the
// Python and Node evaluators against IDENTICAL live inputs.
//
// Calls the real evaluateSymbol() directly (no CLI wrapper) -- strictly
// read-only: fetches quotes/bars/positions/account (the same GET calls
// production makes every hour) but never calls saveState(),
// appendJournalBlock(), or placeOrder(). Run this back-to-back with the
// Python counterpart (verify_decision_parity.py) within the same
// evaluation hour so both engines see the same closed candles.
//
// Usage:
//   node scripts/verify_decision_parity.mjs > /tmp/node_parity.json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ps from "../src/positionState.js";
import { toSlash } from "../src/symbols.js";
import { evaluateSymbol } from "../src/evaluateSymbol.js";
import { getPositions } from "../src/trade.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
const SYMBOLS = CFG.watchlist?.symbols || [];

const FIELDS = ["action", "score", "rsi", "emaCross", "adx", "obvTrend", "dailyRegime", "regime4h", "bbTrend", "bbSqueeze"];

async function main() {
  // Round-tripped through JSON so no accidental object-identity aliasing
  // between the "input" state and what evaluateSymbol mutates.
  const state = JSON.parse(JSON.stringify(ps.loadState()));

  const positions = await getPositions();
  const posBySymbol = {};
  for (const p of positions) {
    const raw = p.symbol || "";
    posBySymbol[raw] = p;
    posBySymbol[toSlash(raw)] = p;
  }
  const openSymbols = positions.map((p) => toSlash(p.symbol || ""));

  const out = {};
  for (const sym of SYMBOLS) {
    const d = await evaluateSymbol(sym, posBySymbol, state, openSymbols, {});
    out[sym] = Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? null]));
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
