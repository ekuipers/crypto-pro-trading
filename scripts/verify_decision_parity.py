"""
Node port cutover — Gate 1: deterministic decision parity between the Python
and Node evaluators against IDENTICAL live inputs.

Calls the real evaluate_symbol() directly (no CLI wrapper) so this is
strictly read-only: it fetches quotes/bars/positions/account (the same GET
calls production makes every hour) but never calls save_state(),
append_journal_block(), or place_order(). Run this back-to-back with the
Node counterpart (verify_decision_parity.mjs) within the same evaluation
hour so both engines see the same closed candles.

Usage:
    python scripts/verify_decision_parity.py > /tmp/py_parity.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import position_state as ps  # noqa: E402
from symbols import to_slash  # noqa: E402
from run_evaluation import evaluate_symbol  # noqa: E402
from trade import get_account, get_positions  # noqa: E402

with open(Path(__file__).resolve().parent.parent / "config.json", encoding="utf-8") as f:
    CFG = json.load(f)

SYMBOLS = [s for s in CFG.get("watchlist", {}).get("symbols", [])]

# Round-tripped to a plain dict via json so no accidental object identity
# aliasing between the "input" state and what evaluate_symbol mutates.
STATE = json.loads(json.dumps(ps.load_state()))

FIELDS = [
    "action", "score", "rsi", "ema_cross", "adx", "obv_trend",
    "daily_regime", "regime_4h", "bb_trend", "bb_squeeze",
]


def main() -> int:
    positions = get_positions()
    pos_by_symbol: dict = {}
    for p in positions:
        raw = p.get("symbol", "")
        pos_by_symbol[raw] = p
        pos_by_symbol[to_slash(raw)] = p
    open_symbols = [to_slash(p.get("symbol", "")) for p in positions]

    out = {}
    for sym in SYMBOLS:
        d = evaluate_symbol(sym, pos_by_symbol, STATE, open_symbols)
        out[sym] = {k: d.get(k) for k in FIELDS}

    print(json.dumps(out, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
