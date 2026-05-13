# scripts/run_evaluation.py
"""
One-shot crypto evaluation driven by technical analysis (RSI / MACD /
Bollinger Bands), per the decision framework in CLAUDE.md.

Reads watchlist_crypto.json, fetches recent daily bars per symbol, computes
a composite TA signal score, and decides BUY / SELL / HOLD.

Usage:
    python scripts/run_evaluation.py            # dry-run (default, no orders)
    python scripts/run_evaluation.py --execute  # actually place orders

Decision logic
--------------
For each symbol:
  1. If we already hold it AND drawdown >= 5% from entry  -> forced SELL (stop-loss)
  2. If we already hold it AND gain >= 10% from entry     -> forced SELL (take-profit)
  3. If we already hold it AND signal score <= -2          -> SELL (bearish TA exit)
  4. If we do NOT hold it AND signal score >= +2           -> BUY
  5. Otherwise                                              -> HOLD

The signal score (see indicators.signal_score) blends:
  - RSI (oversold/overbought, +/-1)
  - MACD (bullish/bearish flip +/-1, or above/below signal +/-0.5)
  - Bollinger %b (near lower/upper band +/-1) and band-width trend

Sizing
------
  - BUY size  = 5% of equity / ask, fractional (rounded to 4dp), 99% of cap
                to leave float headroom. Limit = ask.
  - SELL size = full position quantity, limit = ask * (1 - 0.1%) so it sits
                inside the 0.2% band but biased to fill quickly.

All orders are routed through scripts/trade.py, which still does the final
rule enforcement (5% cap, 0.2% band, limit-only, crypto routing).
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

import requests

import _env  # noqa: F401  -- load .env into os.environ
import indicators as ind
from risk import (
    LIMIT_BAND_PCT,
    STOP_LOSS_PCT,
    TAKE_PROFIT_PCT,
    should_stop_out,
    should_take_profit,
)
from trade import (
    DATA_URL,
    TradeRejected,
    _headers,
    get_account,
    get_latest_quote,
    is_crypto,
    place_order,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = PROJECT_ROOT / "watchlist_crypto.json"
JOURNAL_DIR = PROJECT_ROOT / "journal"

# Strategy thresholds. Tweak here, not in the body of evaluate_symbol.
BUY_SCORE_THRESHOLD = 2.0
SELL_SCORE_THRESHOLD = -2.0
BARS_FOR_INDICATORS = 200  # 50h of 15-min data: enough for MACD warmup + BB lookback
BARS_TIMEFRAME = "15Min"   # per CLAUDE.md: "Use a 15 Minute timeframe for fetching the bars"

# Daily-bars regime filter: 60 daily closes lets us compute the 20/50-day SMAs
# from CLAUDE.md's decision framework. Used only as a buy gate (no buys when
# price is below the 50-day MA), not for sells -- exits stay on intraday signals.
DAILY_BARS_LOOKBACK = 60
DAILY_BARS_TIMEFRAME = "1Day"


# ---------- data fetch -----------------------------------------------------

def get_positions():
    base_url = os.getenv("APCA_BASE_URL")
    r = requests.get(base_url + "/v2/positions", headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


def get_crypto_bars(symbol, limit=BARS_FOR_INDICATORS, timeframe=BARS_TIMEFRAME):
    params = {"symbols": symbol, "timeframe": timeframe, "limit": limit}
    url = DATA_URL + "/v1beta3/crypto/us/bars"
    r = requests.get(url, headers=_headers(), params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("bars", {}).get(symbol, [])


def get_crypto_bars_daily(symbol, limit=DAILY_BARS_LOOKBACK):
    """Daily bars for the regime filter (20-day / 50-day SMA)."""
    return get_crypto_bars(symbol, limit=limit, timeframe=DAILY_BARS_TIMEFRAME)


# ---------- per-symbol evaluation -----------------------------------------

def evaluate_symbol(symbol, position_by_symbol):
    """Return a decision dict for one symbol."""
    decision = {
        "symbol": symbol,
        "action": "HOLD",
        "reason": "",
        "qty": None,
        "limit_price": None,
        "ask": None,
        "bid": None,
        "score": None,
        "rsi": None,
        "macd": None,
        "macd_flip": None,
        "bb": None,
        "bb_trend": None,
        "bb_squeeze": None,
        "indicator_breakdown": None,
        "daily_ma20": None,
        "daily_ma50": None,
        "daily_last": None,
        "daily_regime": None,
        "entry_price": None,
        "current_price": None,
    }

    # Live quote -- needed for sizing, stop-loss, and limit pricing.
    try:
        q = get_latest_quote(symbol)
        ask = float(q.get("ap") or 0)
        bid = float(q.get("bp") or 0)
    except Exception as e:
        decision["reason"] = "quote fetch failed: " + repr(e)
        return decision
    decision["ask"] = ask
    decision["bid"] = bid
    decision["current_price"] = bid or ask

    # Bars + indicators.
    try:
        bars = get_crypto_bars(symbol)
    except Exception as e:
        decision["reason"] = "bars fetch failed: " + repr(e)
        return decision
    closes = [float(b.get("c") or 0) for b in bars if b.get("c")]
    if len(closes) < 35:  # need MACD slow(26) + signal(9) at minimum
        decision["reason"] = "not enough history (%d bars)" % len(closes)
        return decision

    score, breakdown = ind.signal_score(closes)
    decision["score"] = score
    decision["indicator_breakdown"] = breakdown
    decision["rsi"] = ind.rsi(closes)
    decision["macd"] = ind.macd(closes)
    decision["macd_flip"] = ind.macd_flip(closes)
    decision["bb"] = ind.bollinger(closes)
    decision["bb_trend"] = ind.bollinger_trend(closes)
    decision["bb_squeeze"] = ind.bollinger_squeeze(closes)

    # Daily-bars regime filter: compute 20/50-day SMAs to gate buys.
    try:
        daily_bars = get_crypto_bars_daily(symbol)
    except Exception as e:
        # Soft-fail: regime filter unavailable, fall back to letting the
        # intraday score drive decisions. We log the failure so the journal
        # shows it.
        decision["daily_regime"] = "unknown (fetch failed: " + repr(e)[:60] + ")"
    else:
        daily_closes = [float(b.get("c") or 0) for b in daily_bars if b.get("c")]
        if len(daily_closes) >= 50:
            daily_ma20 = ind.sma(daily_closes, 20)
            daily_ma50 = ind.sma(daily_closes, 50)
            last_daily = daily_closes[-1]
            decision["daily_ma20"] = daily_ma20
            decision["daily_ma50"] = daily_ma50
            decision["daily_last"] = last_daily
            if last_daily > daily_ma50 and daily_ma20 > daily_ma50:
                decision["daily_regime"] = "uptrend"
            elif last_daily < daily_ma50 and daily_ma20 < daily_ma50:
                decision["daily_regime"] = "downtrend"
            else:
                decision["daily_regime"] = "mixed"
        else:
            decision["daily_regime"] = "insufficient daily history (%d bars)" % len(daily_closes)

    # Branch on whether we already hold this symbol.
    pos = position_by_symbol.get(symbol)
    if pos:
        entry = float(pos.get("avg_entry_price") or 0)
        cur = float(pos.get("current_price") or decision["current_price"])
        qty_held = float(pos.get("qty") or 0)
        decision["entry_price"] = entry
        decision["current_price"] = cur

        # Hard stop first -- this is the only forced action in the system.
        if should_stop_out(entry, cur):
            decision["action"] = "SELL"
            decision["qty"] = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "STOP-LOSS: entry $%.4f, current $%.4f (>= %d%% drawdown)"
                % (entry, cur, int(STOP_LOSS_PCT * 100))
            )
            return decision

        # Take-profit: close the full position once gain >= 10% from entry.
        if should_take_profit(entry, cur):
            decision["action"] = "SELL"
            decision["qty"] = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "TAKE-PROFIT: entry $%.4f, current $%.4f (>= %d%% gain)"
                % (entry, cur, int(TAKE_PROFIT_PCT * 100))
            )
            return decision

        # Discretionary exit on strong bearish TA.
        if score <= SELL_SCORE_THRESHOLD:
            decision["action"] = "SELL"
            decision["qty"] = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "TA SELL: score=%.1f <= %.1f, drawdown ok"
                % (score, SELL_SCORE_THRESHOLD)
            )
            return decision

        decision["reason"] = (
            "hold %s @ $%.4f, score=%.1f" % (str(qty_held), entry, score)
        )
        return decision

    # No position: maybe buy.
    if score < BUY_SCORE_THRESHOLD:
        decision["reason"] = (
            "no entry: score=%.1f < %.1f" % (score, BUY_SCORE_THRESHOLD)
        )
        return decision

    # Regime gate: don't buy assets in a clear daily downtrend, even if the
    # intraday TA score is bullish. CLAUDE.md framework Q4: "What do the
    # 20-day and 50-day moving averages tell you?"
    if decision["daily_regime"] == "downtrend":
        decision["reason"] = (
            "regime block: daily downtrend (last=%.4f < ma50=%.4f, ma20=%.4f < ma50=%.4f)"
            % (decision["daily_last"], decision["daily_ma50"],
               decision["daily_ma20"], decision["daily_ma50"])
        )
        return decision

    # Sizing.
    try:
        equity = float(get_account().get("equity") or 0)
    except Exception as e:
        decision["reason"] = "account fetch failed: " + repr(e)
        return decision
    if ask <= 0:
        decision["reason"] = "no live ask"
        return decision
    cap = equity * 0.05
    qty = round((cap / ask) * 0.99, 4)  # leave a hair under the cap
    if qty <= 0:
        decision["reason"] = "computed qty <= 0 (equity=%.2f)" % equity
        return decision

    decision["action"] = "BUY"
    decision["qty"] = qty
    decision["limit_price"] = round(ask, 4)
    decision["reason"] = "TA BUY: score=%.1f >= %.1f" % (score, BUY_SCORE_THRESHOLD)
    return decision


# ---------- presentation --------------------------------------------------

def fmt_macd(m):
    if m is None:
        return "n/a"
    return "line=%.4f sig=%.4f hist=%.4f" % m


def fmt_bb(b):
    if b is None:
        return "n/a"
    lower, middle, upper, bw, pb = b
    return "lower=%.2f mid=%.2f upper=%.2f bw=%.4f pb=%.2f" % (lower, middle, upper, bw, pb)


def format_decision_line(d):
    parts = [d["symbol"], d["action"]]
    if d["score"] is not None:
        parts.append("score=%+.1f" % d["score"])
    if d["qty"] is not None and d["limit_price"] is not None:
        parts.append("qty=%s limit=$%.4f" % (str(d["qty"]), d["limit_price"]))
    if d["ask"]:
        parts.append("ask=$%.4f" % d["ask"])
    if d["reason"]:
        parts.append("(" + d["reason"] + ")")
    return " ".join(parts)


def format_indicator_block(d):
    """Multi-line indicator readout for the journal."""
    out = []
    out.append("    score   : %s" % ("%+.1f" % d["score"] if d["score"] is not None else "n/a"))
    out.append("    rsi     : %s" % ("%.2f" % d["rsi"] if d["rsi"] is not None else "n/a"))
    out.append("    macd    : %s%s" % (
        fmt_macd(d["macd"]),
        " (" + d["macd_flip"].upper() + " FLIP)" if d["macd_flip"] else "",
    ))
    out.append("    bb      : %s%s%s" % (
        fmt_bb(d["bb"]),
        " trend=" + d["bb_trend"] if d["bb_trend"] else "",
        " SQUEEZE" if d["bb_squeeze"] else "",
    ))
    if d["daily_ma20"] is not None and d["daily_ma50"] is not None:
        out.append("    daily   : ma20=%.4f ma50=%.4f last=%.4f regime=%s" % (
            d["daily_ma20"], d["daily_ma50"], d["daily_last"], d["daily_regime"]
        ))
    elif d["daily_regime"]:
        out.append("    daily   : regime=" + str(d["daily_regime"]))
    return "\n".join(out)


# ---------- journal -------------------------------------------------------

def append_journal_block(timestamp, decisions, executed):
    JOURNAL_DIR.mkdir(exist_ok=True)
    today = timestamp.strftime("%Y-%m-%d")
    hhmm = timestamp.strftime("%H:%M")
    path = JOURNAL_DIR / (today + ".md")

    lines = []
    lines.append("")
    lines.append("## Evaluation " + hhmm + " GMT+2")
    lines.append("")
    if not decisions:
        lines.append("No symbols evaluated.")
    for d in decisions:
        lines.append("- " + format_decision_line(d))
        if d["score"] is not None:
            lines.append(format_indicator_block(d))

    if executed:
        lines.append("")
        lines.append("### Orders submitted")
        for r in executed:
            lines.append(
                "- %s %s -> %s" % (
                    r["symbol"], r["action"],
                    json.dumps(r["result"])[:300],
                )
            )
    else:
        lines.append("")
        lines.append("### No orders submitted")

    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


# ---------- main ----------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true",
                        help="actually place orders (default is dry-run)")
    args = parser.parse_args()

    print("Starting evaluation...")

    if not WATCHLIST.exists():
        sys.stderr.write("FAIL: " + str(WATCHLIST) + " not found\n")
        return 1
    wl = json.loads(WATCHLIST.read_text())
    symbols = [s for s in wl.get("symbols", []) if is_crypto(s)]
    if not symbols:
        sys.stderr.write("FAIL: no crypto symbols in watchlist\n")
        return 1

    try:
        positions = get_positions()
    except Exception as e:
        sys.stderr.write("FAIL: positions fetch: " + repr(e) + "\n")
        return 1
    pos_by_symbol = {p.get("symbol"): p for p in positions}

    decisions = []
    for sym in symbols:
        decisions.append(evaluate_symbol(sym, pos_by_symbol))

    print("Evaluation results:")
    for d in decisions:
        print("  " + format_decision_line(d))

    actionable = [d for d in decisions
                  if d["action"] in ("BUY", "SELL")
                  and d["qty"] and d["limit_price"]]

    executed = []
    if args.execute and actionable:
        print("\nPlacing orders:")
        for d in actionable:
            side = "buy" if d["action"] == "BUY" else "sell"
            try:
                result = place_order(d["symbol"], d["qty"], side, d["limit_price"])
                print("  OK       %s %s %s @ $%.4f"
                      % (d["symbol"], side, str(d["qty"]), d["limit_price"]))
                executed.append({"symbol": d["symbol"], "action": d["action"], "result": result})
            except TradeRejected as e:
                print("  REJECTED %s: %s" % (d["symbol"], str(e)))
                executed.append({"symbol": d["symbol"], "action": d["action"],
                                 "result": {"rejected": str(e)}})
            except Exception as e:
                print("  ERROR    %s: %r" % (d["symbol"], e))
                executed.append({"symbol": d["symbol"], "action": d["action"],
                                 "result": {"error": repr(e)}})
    elif actionable:
        print("\nDry-run: %d order(s) would be placed." % len(actionable))
        print("Re-run with --execute to actually submit them.")
    else:
        print("\nNo actionable decisions.")

    journal_path = append_journal_block(datetime.now(ZoneInfo("Europe/Amsterdam")), decisions, executed)
    print("\nWrote: " + str(journal_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
