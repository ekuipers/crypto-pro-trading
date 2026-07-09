# scripts/position_state.py
"""
Persistent position-state manager for the trading agent.

Stores per-symbol metadata that must survive across hourly evaluation cycles:
  - high_water_mark  : highest close price seen since entry (for trailing stop)
  - stop_order_id    : ID of any pending stop-loss/cover limit order
  - stop_order_placed_iso : ISO timestamp when that order was placed
  - stop_order_limit_price: limit price used when the order was placed
  - stop_order_cycles: how many evaluation cycles the stop order has been open

Also tracks portfolio-level state:
  - day_open_equity  : equity snapshot at the first evaluation of the trading day
  - day_open_date    : date string (YYYY-MM-DD) for that snapshot
  - capital_preservation_mode : bool — set when daily drawdown gate fires
  - capital_preservation_since: ISO timestamp when preservation mode began

State file location: <project_root>/data/positions_state.json

All writes are atomic (write to temp then rename) to avoid corruption if the
process is killed mid-write.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_STATE_FILE   = _PROJECT_ROOT / "data" / "positions_state.json"

_EMPTY_STATE: dict = {
    "day_open_equity":           None,
    "day_open_date":             None,
    "capital_preservation_mode": False,
    "capital_preservation_since": None,
    "positions": {},
}

_EMPTY_POSITION: dict = {
    "entry_price":            None,
    "entry_time_iso":         None,   # when the position opened (stale-exit rule)
    "high_water_mark":        None,
    "trailing_stop_active":   False,
    "partial_tp_done":        False,  # +1R scale-out already taken (partial-TP ladder)
    "breakeven_stop":         None,   # stop raised to entry after the partial TP
    "stop_order_id":          None,
    "stop_order_placed_iso":  None,
    "stop_order_limit_price": None,
    "stop_order_cycles":      0,
}


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def load_state() -> dict:
    """Load state from disk, returning _EMPTY_STATE if file is absent or corrupt."""
    try:
        raw = _STATE_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        # Ensure top-level keys exist (forward-compatibility).
        for k, v in _EMPTY_STATE.items():
            data.setdefault(k, v)
        return data
    except Exception:
        return dict(_EMPTY_STATE)


def save_state(state: dict) -> None:
    """Atomically write state to disk."""
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=str(_STATE_FILE.parent), suffix=".tmp"
    )
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp_path, str(_STATE_FILE))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Day-open equity & capital preservation
# ---------------------------------------------------------------------------

def check_and_refresh_day_open(state: dict, equity: float) -> dict:
    """
    If today's date differs from state["day_open_date"], reset the daily
    snapshot to current equity and clear capital_preservation_mode.
    Returns the (possibly mutated) state dict.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get("day_open_date") != today:
        state["day_open_date"]             = today
        state["day_open_equity"]           = equity
        state["capital_preservation_mode"] = False
        state["capital_preservation_since"] = None
    return state


def is_capital_preservation_mode(state: dict) -> bool:
    return bool(state.get("capital_preservation_mode", False))


def activate_capital_preservation(state: dict) -> dict:
    if not state.get("capital_preservation_mode"):
        state["capital_preservation_mode"]  = True
        state["capital_preservation_since"] = (
            datetime.now(timezone.utc).isoformat()
        )
    return state


def deactivate_capital_preservation(state: dict) -> dict:
    state["capital_preservation_mode"]  = False
    state["capital_preservation_since"] = None
    return state


# ---------------------------------------------------------------------------
# Per-position helpers
# ---------------------------------------------------------------------------

def get_position(state: dict, symbol: str) -> dict:
    """Return the position sub-dict for *symbol*, creating it if absent."""
    positions = state.setdefault("positions", {})
    if symbol not in positions:
        positions[symbol] = dict(_EMPTY_POSITION)
    else:
        # Ensure all keys present (forward-compat).
        for k, v in _EMPTY_POSITION.items():
            positions[symbol].setdefault(k, v)
    return positions[symbol]


def init_position(state: dict, symbol: str, entry_price: float) -> dict:
    """Called when a new BUY or SHORT fills. Resets all per-position tracking."""
    pos = get_position(state, symbol)
    pos["entry_price"]            = entry_price
    pos["entry_time_iso"]         = datetime.now(timezone.utc).isoformat()
    pos["high_water_mark"]        = entry_price
    pos["trailing_stop_active"]   = False
    pos["partial_tp_done"]        = False
    pos["breakeven_stop"]         = None
    pos["stop_order_id"]          = None
    pos["stop_order_placed_iso"]  = None
    pos["stop_order_limit_price"] = None
    pos["stop_order_cycles"]      = 0
    return state


def mark_partial_tp(state: dict, symbol: str, breakeven_price: float) -> dict:
    """Record the +1R partial take-profit: half sold, remaining stop = breakeven."""
    pos = get_position(state, symbol)
    pos["partial_tp_done"] = True
    pos["breakeven_stop"]  = breakeven_price
    return state


def clear_position(state: dict, symbol: str) -> dict:
    """Called when a position fully closes (SELL/COVER filled)."""
    state.setdefault("positions", {}).pop(symbol, None)
    return state


def update_high_water_mark(state: dict, symbol: str, current_price: float) -> dict:
    """Ratchet up the HWM if price has moved higher. Never lower it."""
    pos = get_position(state, symbol)
    hwm = pos.get("high_water_mark") or current_price
    if current_price > hwm:
        pos["high_water_mark"]      = current_price
        pos["trailing_stop_active"] = True   # stays True once activated below
    return state


def activate_trailing_stop(state: dict, symbol: str) -> dict:
    get_position(state, symbol)["trailing_stop_active"] = True
    return state


def set_stop_order(
    state: dict,
    symbol: str,
    order_id: str,
    limit_price: float,
) -> dict:
    """Record a newly placed stop-loss order."""
    pos = get_position(state, symbol)
    pos["stop_order_id"]          = order_id
    pos["stop_order_placed_iso"]  = datetime.now(timezone.utc).isoformat()
    pos["stop_order_limit_price"] = limit_price
    pos["stop_order_cycles"]      = 1
    return state


def increment_stop_order_cycles(state: dict, symbol: str) -> int:
    """Increment and return the cycle counter for the symbol's pending stop order."""
    pos = get_position(state, symbol)
    pos["stop_order_cycles"] = (pos.get("stop_order_cycles") or 0) + 1
    return pos["stop_order_cycles"]


def clear_stop_order(state: dict, symbol: str) -> dict:
    """Called after a stop order is confirmed filled or explicitly cancelled."""
    pos = get_position(state, symbol)
    pos["stop_order_id"]          = None
    pos["stop_order_placed_iso"]  = None
    pos["stop_order_limit_price"] = None
    pos["stop_order_cycles"]      = 0
    return state
