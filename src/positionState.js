// src/positionState.js
//
// Persistent position-state manager for the trading agent -- a faithful
// port of scripts/position_state.py.
//
// Stores per-symbol metadata that must survive across hourly evaluation
// cycles (high_water_mark, pending stop-order id/cycles, partial-TP /
// pyramid tracking) plus portfolio-level state (day-open equity, capital-
// preservation mode, cadence/streak-throttle bookkeeping).
//
// State file location: <project_root>/data/positions_state.json
//
// All writes are atomic (write to a temp file in the same directory, then
// rename) to avoid corruption if the process is killed mid-write.
//
// Unlike most of this port, these functions deliberately MUTATE the passed
// `state` object in place (matching the Python dict-mutation pattern) and
// return it for chaining -- `state` is threaded sequentially through a
// single evaluation cycle's decision loop, one symbol at a time, and that
// read-modify-write sequencing is load-bearing (see runEvaluation.js).

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "positions_state.json");

export const EMPTY_STATE = () => ({
  day_open_equity: null,
  day_open_date: null,
  capital_preservation_mode: false,
  capital_preservation_since: null,
  last_evaluation_iso: null, // cadence self-monitoring (Bug #4)
  streak_throttle_active: false, // losing-streak/DD throttle
  positions: {},
});

const EMPTY_POSITION = () => ({
  entry_price: null,
  entry_time_iso: null, // when the position opened (stale-exit rule)
  high_water_mark: null,
  trailing_stop_active: false,
  partial_tp_done: false, // +1R scale-out already taken (partial-TP ladder)
  breakeven_stop: null, // stop raised to entry after the partial TP / pyramid add
  pyramid_tranches: 0, // +1R/+2R adds taken
  stop_order_id: null,
  stop_order_placed_iso: null,
  stop_order_limit_price: null,
  stop_order_cycles: 0,
});

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** Load state from disk, returning a fresh empty state if the file is absent or corrupt. */
export function loadState(stateFile = STATE_FILE) {
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const data = JSON.parse(raw);
    // Ensure top-level keys exist (forward-compatibility).
    for (const [k, v] of Object.entries(EMPTY_STATE())) {
      if (!(k in data)) data[k] = v;
    }
    return data;
  } catch {
    return EMPTY_STATE();
  }
}

/**
 * Atomically write state to disk: write to a uniquely-named temp file in the
 * SAME directory as the destination (required for the rename below to be
 * atomic -- a cross-device rename is not), then rename it over the
 * destination. `fs.renameSync` replaces an existing destination file
 * wholesale on both POSIX and Windows, mirroring Python's `os.replace`.
 */
export function saveState(state, stateFile = STATE_FILE) {
  const dir = path.dirname(stateFile);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(stateFile)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpPath, stateFile);
  } catch (e) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only -- the write/rename error is what matters
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Day-open equity & capital preservation
// ---------------------------------------------------------------------------

/**
 * If today's UTC date differs from state.day_open_date, reset the daily
 * snapshot to current equity and clear capital_preservation_mode.
 */
export function checkAndRefreshDayOpen(state, equity) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.day_open_date !== today) {
    state.day_open_date = today;
    state.day_open_equity = equity;
    state.capital_preservation_mode = false;
    state.capital_preservation_since = null;
  }
  return state;
}

export function isCapitalPreservationMode(state) {
  return Boolean(state.capital_preservation_mode);
}

export function activateCapitalPreservation(state) {
  if (!state.capital_preservation_mode) {
    state.capital_preservation_mode = true;
    state.capital_preservation_since = new Date().toISOString();
  }
  return state;
}

export function deactivateCapitalPreservation(state) {
  state.capital_preservation_mode = false;
  state.capital_preservation_since = null;
  return state;
}

// ---------------------------------------------------------------------------
// Per-position helpers
// ---------------------------------------------------------------------------

/** Return the position sub-object for `symbol`, creating it if absent. */
export function getPosition(state, symbol) {
  if (!state.positions) state.positions = {};
  if (!(symbol in state.positions)) {
    state.positions[symbol] = EMPTY_POSITION();
  } else {
    // Ensure all keys present (forward-compat).
    for (const [k, v] of Object.entries(EMPTY_POSITION())) {
      if (!(k in state.positions[symbol])) state.positions[symbol][k] = v;
    }
  }
  return state.positions[symbol];
}

/** Called when a new BUY or SHORT fills. Resets all per-position tracking. */
export function initPosition(state, symbol, entryPrice) {
  const pos = getPosition(state, symbol);
  pos.entry_price = entryPrice;
  pos.entry_time_iso = new Date().toISOString();
  pos.high_water_mark = entryPrice;
  pos.trailing_stop_active = false;
  pos.partial_tp_done = false;
  pos.breakeven_stop = null;
  pos.stop_order_id = null;
  pos.stop_order_placed_iso = null;
  pos.stop_order_limit_price = null;
  pos.stop_order_cycles = 0;
  return state;
}

/** Record the +1R partial take-profit: half sold, remaining stop = breakeven. */
export function markPartialTp(state, symbol, breakevenPrice) {
  const pos = getPosition(state, symbol);
  pos.partial_tp_done = true;
  pos.breakeven_stop = breakevenPrice;
  return state;
}

/**
 * Record a pyramid tranche: count the add and raise the whole position's
 * stop to breakeven so an add can never turn the trade into a net loser.
 */
export function markPyramidAdd(state, symbol, breakevenPrice) {
  const pos = getPosition(state, symbol);
  pos.pyramid_tranches = (pos.pyramid_tranches || 0) + 1;
  pos.breakeven_stop = breakevenPrice;
  return state;
}

/** Called when a position fully closes (SELL/COVER filled). */
export function clearPosition(state, symbol) {
  if (state.positions) delete state.positions[symbol];
  return state;
}

/** Ratchet up the high-water mark if price has moved higher. Never lower it. */
export function updateHighWaterMark(state, symbol, currentPrice) {
  const pos = getPosition(state, symbol);
  const hwm = pos.high_water_mark || currentPrice;
  if (currentPrice > hwm) {
    pos.high_water_mark = currentPrice;
    pos.trailing_stop_active = true; // stays true once activated
  }
  return state;
}

export function activateTrailingStop(state, symbol) {
  getPosition(state, symbol).trailing_stop_active = true;
  return state;
}

/** Record a newly placed stop-loss order. */
export function setStopOrder(state, symbol, orderId, limitPrice) {
  const pos = getPosition(state, symbol);
  pos.stop_order_id = orderId;
  pos.stop_order_placed_iso = new Date().toISOString();
  pos.stop_order_limit_price = limitPrice;
  pos.stop_order_cycles = 1;
  return state;
}

/** Increment and return the cycle counter for the symbol's pending stop order. */
export function incrementStopOrderCycles(state, symbol) {
  const pos = getPosition(state, symbol);
  pos.stop_order_cycles = (pos.stop_order_cycles || 0) + 1;
  return pos.stop_order_cycles;
}

/** Called after a stop order is confirmed filled or explicitly cancelled. */
export function clearStopOrder(state, symbol) {
  const pos = getPosition(state, symbol);
  pos.stop_order_id = null;
  pos.stop_order_placed_iso = null;
  pos.stop_order_limit_price = null;
  pos.stop_order_cycles = 0;
  return state;
}
