# scripts/rebalance.py
"""
Portfolio rebalance against config.json (portfolio_caps.caps).

For each watchlist symbol, computes the current allocation and compares it to
the cap target.  Uses the same signal-confluence gate as run_evaluation.py:

  score >= 4  → top-up to the full cap value (ATR-sized, hard-capped)
  score == 3  → top-up to half the remaining gap (same sizing rules)
  score <= 2  → HOLD — signals too weak; skip regardless of how far from cap
  downtrend   → regime gate blocks all buys (no exception for rebalancing)

Over-cap positions are trimmed to their cap immediately (no score gate needed
for sells; we're reducing risk).

Usage:
    python scripts/rebalance.py            # dry-run
    python scripts/rebalance.py --execute  # place orders
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import _env  # noqa: F401
import indicators as ind
from risk import LIMIT_BAND_PCT, should_stop_out
from trade import (
    TradeRejected,
    get_account,
    get_latest_quote,
    is_crypto,
    place_order,
    _headers,
)
import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR  = PROJECT_ROOT / "journal"


def _load_config() -> dict:
    try:
        return json.loads((PROJECT_ROOT / "config.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


_CFG = _load_config()

DATA_URL = "https://data.alpaca.markets"
BASE_URL = os.getenv("APCA_BASE_URL", "https://paper-api.alpaca.markets")

# ── helpers ──────────────────────────────────────────────────────────────────

def _to_slash(sym: str) -> str:
    """'BTCUSD' → 'BTC/USD'; already-slashed symbols unchanged."""
    if "/" in sym:
        return sym
    if sym.endswith("USD"):
        return sym[:-3] + "/USD"
    return sym


def _load_caps() -> dict:
    return _CFG.get("portfolio_caps", {"caps": {}, "default_cap": 0.05})


def symbol_cap(caps_data: dict, symbol: str) -> float:
    return caps_data["caps"].get(symbol, caps_data.get("default_cap", 0.05))


def get_positions() -> list[dict]:
    r = requests.get(BASE_URL + "/v2/positions", headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


def get_crypto_bars(symbol: str, limit: int = 200, timeframe: str = "15Min") -> list:
    from run_evaluation import get_crypto_bars as _gcb
    return _gcb(symbol, limit=limit, timeframe=timeframe)


def get_daily_regime(symbol: str) -> tuple[str, float, float, float]:
    """Return (regime, ma20, ma50, last_close)."""
    from run_evaluation import get_crypto_bars_daily
    try:
        daily_bars = get_crypto_bars_daily(symbol)
    except Exception:
        return "unknown", 0.0, 0.0, 0.0
    closes = [float(b["c"]) for b in daily_bars if b.get("c")]
    if len(closes) < 50:
        return "insufficient", 0.0, 0.0, 0.0
    ma20 = ind.sma(closes, 20)
    ma50 = ind.sma(closes, 50)
    last = closes[-1]
    if last > ma50 and ma20 > ma50:
        regime = "uptrend"
    elif last < ma50 and ma20 < ma50:
        regime = "downtrend"
    else:
        regime = "mixed"
    return regime, ma20, ma50, last


def compute_signal_score(symbol: str) -> tuple[float | None, dict, float | None]:
    """Return (score, breakdown, atr) from 15-min + 4H data."""
    from run_evaluation import get_crypto_bars_4h
    try:
        bars = get_crypto_bars(symbol)
    except Exception as e:
        return None, {}, None
    closes  = [float(b["c"]) for b in bars if b.get("c")]
    highs   = [float(b["h"]) for b in bars if b.get("c")]
    lows    = [float(b["l"]) for b in bars if b.get("c")]
    volumes = [float(b["v"]) for b in bars if b.get("c")]
    if len(closes) < 60:
        return None, {}, None
    try:
        bars_4h   = get_crypto_bars_4h(symbol)
        closes_4h = [float(b["c"]) for b in bars_4h if b.get("c")]
        closes_4h = closes_4h if len(closes_4h) >= 51 else None
    except Exception:
        closes_4h = None
    score, breakdown = ind.signal_score(closes, volumes=volumes,
                                        highs=highs, lows=lows,
                                        closes_4h=closes_4h)
    atr = ind.atr(highs, lows, closes)
    return score, breakdown, atr


# ── core logic ───────────────────────────────────────────────────────────────

def evaluate_rebalance(symbol: str, pos: dict | None,
                       equity: float, caps_data: dict) -> dict:
    """
    Return a rebalance decision for *symbol*.

    Fields: symbol, action, qty, limit_price, ask, current_pct, target_pct,
            score, reason, atr, daily_regime.
    """
    result = dict(symbol=symbol, action="HOLD", qty=None,
                  limit_price=None, ask=None, current_pct=0.0,
                  target_pct=0.0, score=None, reason="", atr=None,
                  daily_regime="unknown")

    cap_pct = symbol_cap(caps_data, symbol)
    result["target_pct"] = cap_pct

    # Live quote
    try:
        q    = get_latest_quote(symbol)
        ask  = float(q.get("ap") or 0)
        bid  = float(q.get("bp") or 0)
    except Exception as e:
        result["reason"] = "quote fetch failed: " + repr(e)
        return result
    result["ask"] = ask
    if ask <= 0:
        result["reason"] = "no live ask"
        return result

    # Current allocation
    if pos:
        cur_qty    = float(pos.get("qty") or 0)
        cur_price  = float(pos.get("current_price") or ask)
        cur_value  = cur_qty * cur_price
        cur_pct    = cur_value / equity if equity else 0
        result["current_pct"] = cur_pct

        entry = float(pos.get("avg_entry_price") or 0)

        # Hard stops always fire regardless of cap or score.
        if entry and should_stop_out(entry, cur_price):
            result["action"]      = "SELL"
            result["qty"]         = cur_qty
            result["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            result["reason"] = (
                "STOP-LOSS %.2f%% drawdown from entry $%.4f" % (
                    (cur_price - entry) / entry * 100, entry)
            )
            return result
        # Over-cap → trim to cap (sell the excess).
        # Note: exits are TA-driven via run_evaluation.py, not a fixed % take-profit.
        if cur_pct > cap_pct + 0.001:   # 0.1% tolerance
            target_value = equity * cap_pct
            excess_value = cur_value - target_value
            sell_qty     = round(excess_value / ask * 0.99, 4)
            if sell_qty > 0:
                result["action"]      = "SELL"
                result["qty"]         = sell_qty
                result["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
                result["reason"] = (
                    "TRIM: %.1f%% > cap %.0f%% — selling %.4f to target"
                    % (cur_pct * 100, cap_pct * 100, sell_qty)
                )
                return result
    else:
        cur_pct   = 0.0
        cur_qty   = 0.0
        cur_value = 0.0

    # Under-cap → consider buying to close the gap.
    gap_pct = cap_pct - cur_pct
    if gap_pct <= 0.001:
        result["reason"] = "at cap (%.1f%%)" % (cur_pct * 100)
        return result

    # Regime gate
    regime, ma20, ma50, last_close = get_daily_regime(symbol)
    result["daily_regime"] = regime
    if regime == "downtrend":
        result["reason"] = (
            "regime block: daily downtrend (last=%.4f < ma50=%.4f)"
            % (last_close, ma50)
        )
        return result

    # Signal gate
    score, breakdown, atr = compute_signal_score(symbol)
    result["score"] = score
    result["atr"]   = atr

    if score is None:
        result["reason"] = "signal computation failed"
        return result
    if score < 3.0:
        result["reason"] = "no entry: score=%.1f/6 (need >= 3)" % score
        return result

    # Sizing: ATR-based, hard-capped at remaining gap to cap.
    max_risk       = equity * 0.01
    gap_value      = equity * gap_pct
    hard_cap_qty   = round(gap_value / ask * 0.99, 4)   # fill entire gap

    if atr and atr > 0:
        stop_dist = atr * 1.5
        atr_qty   = round(max_risk / stop_dist * 0.99, 4)
        base_qty  = min(atr_qty, hard_cap_qty)
    else:
        base_qty = round((equity * 0.02 / ask) * 0.99, 4)
        base_qty = min(base_qty, hard_cap_qty)

    if score < 4.0:
        qty       = round(base_qty * 0.5, 4)
        size_note = "half-size (score=%.1f/6)" % score
    else:
        qty       = base_qty
        size_note = "full-size (score=%.1f/6)" % score

    if qty <= 0:
        result["reason"] = "computed qty <= 0"
        return result

    result["action"]      = "BUY"
    result["qty"]         = qty
    result["limit_price"] = round(ask, 4)
    result["reason"] = (
        "TOP-UP %s: %.1f%% → %.0f%% cap, gap=%.1f%%, atr=%.4f"
        % (size_note, cur_pct * 100, cap_pct * 100, gap_pct * 100, atr or 0)
    )
    return result


# ── journal ──────────────────────────────────────────────────────────────────

def append_rebalance_journal(timestamp: datetime, decisions: list[dict],
                              executed: list[dict]) -> Path:
    JOURNAL_DIR.mkdir(exist_ok=True)
    today = timestamp.strftime("%Y-%m-%d")
    hhmm  = timestamp.strftime("%H:%M")
    path  = JOURNAL_DIR / (today + ".md")

    lines = ["", "## Rebalance " + hhmm + " GMT+2", "",
             "Trigger: manual rebalance against config.json (portfolio_caps.caps)", ""]

    lines.append("| Symbol | Current% | Cap% | Score | Action |")
    lines.append("|--------|----------|------|-------|--------|")
    for d in decisions:
        lines.append(
            "| %s | %.1f%% | %.0f%% | %s | %s %s |" % (
                d["symbol"],
                d["current_pct"] * 100,
                d["target_pct"] * 100,
                ("%.1f" % d["score"]) if d["score"] is not None else "n/a",
                d["action"],
                ("qty=%.4f @ $%.4f" % (d["qty"], d["limit_price"])
                 if d["qty"] else d["reason"]),
            )
        )

    if executed:
        lines += ["", "### Orders submitted"]
        for r in executed:
            lines.append("- %s %s → %s" % (
                r["symbol"], r["action"], str(r["result"])[:300]))
    else:
        lines += ["", "### No orders submitted"]

    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Rebalance to portfolio caps")
    parser.add_argument("--execute", action="store_true",
                        help="place orders (default: dry-run)")
    args = parser.parse_args()

    caps_data = _load_caps()
    if not caps_data["caps"]:
        sys.stderr.write("FAIL: config.json > portfolio_caps.caps is empty or missing\n")
        return 1

    symbols = [s for s in _CFG.get("watchlist", {}).get("symbols", []) if is_crypto(s)]

    try:
        account  = get_account()
        equity   = float(account.get("equity") or 0)
        cash     = float(account.get("cash") or 0)
    except Exception as e:
        sys.stderr.write("FAIL: account fetch: %r\n" % e)
        return 1

    try:
        raw_positions = get_positions()
    except Exception as e:
        sys.stderr.write("FAIL: positions fetch: %r\n" % e)
        return 1

    pos_by_symbol: dict[str, dict] = {}
    for p in raw_positions:
        raw = p.get("symbol", "")
        pos_by_symbol[raw]            = p
        pos_by_symbol[_to_slash(raw)] = p

    print("=" * 60)
    print("REBALANCE  equity=$%.2f  cash=$%.2f" % (equity, cash))
    print("=" * 60)

    decisions: list[dict] = []
    for sym in symbols:
        pos = pos_by_symbol.get(sym)
        d   = evaluate_rebalance(sym, pos, equity, caps_data)
        decisions.append(d)
        cap_str   = "%.0f%%" % (d["target_pct"] * 100)
        cur_str   = "%.1f%%" % (d["current_pct"] * 100)
        score_str = ("%.1f" % d["score"]) if d["score"] is not None else " n/a"
        print("  %-10s  cur=%-6s cap=%-4s score=%-5s  %s  — %s" % (
            sym, cur_str, cap_str, score_str,
            d["action"],
            d["reason"],
        ))

    actionable = [d for d in decisions
                  if d["action"] in ("BUY", "SELL") and d["qty"] and d["limit_price"]]

    print()
    if not actionable:
        print("No actionable rebalance orders.")
    elif not args.execute:
        print("Dry-run: %d order(s) would be placed. Pass --execute to submit." % len(actionable))
    else:
        print("Placing %d order(s):" % len(actionable))

    executed: list[dict] = []
    if args.execute and actionable:
        for d in actionable:
            side = "buy" if d["action"] == "BUY" else "sell"
            try:
                result = place_order(d["symbol"], d["qty"], side, d["limit_price"])
                status = "OK"
                print("  OK       %s %s %.4f @ $%.4f" % (
                    d["symbol"], side, d["qty"], d["limit_price"]))
            except TradeRejected as e:
                result = {"rejected": str(e)}
                status = "REJECTED"
                print("  REJECTED %s: %s" % (d["symbol"], str(e)))
            except Exception as e:
                result = {"error": repr(e)}
                status = "ERROR"
                print("  ERROR    %s: %r" % (d["symbol"], e))
            executed.append({"symbol": d["symbol"], "action": d["action"],
                              "result": result})

    ts   = datetime.now(ZoneInfo("Europe/Amsterdam"))
    path = append_rebalance_journal(ts, decisions, executed)
    print("\nWrote journal: " + str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
