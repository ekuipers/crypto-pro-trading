# scripts/run_evaluation.py
"""
One-shot crypto evaluation driven by the 6-point Signal Confluence Table
from the trading skill (SKILL.md), per the decision framework in CLAUDE.md.

Reads watchlist_crypto.json, fetches 15-min bars (execution), 4H bars
(trend filter), and daily bars (regime/MA filter) per symbol, computes
the confluence score, and decides BUY / SELL / HOLD.

Usage:
    python scripts/run_evaluation.py            # dry-run (default, no orders)
    python scripts/run_evaluation.py --execute  # actually place orders

Decision logic
--------------
For each symbol:
  1. If we already hold it AND drawdown >= 5% from entry  -> forced SELL (stop-loss)
  2. If we already hold it AND gain >= 10% from entry     -> forced SELL (take-profit)
  3. If we already hold it AND signal score <= -2          -> SELL (bearish TA exit)
  4. If we do NOT hold it AND signal score >= 4            -> BUY  (≥4/6 confluence)
  5. If we do NOT hold it AND signal score == 3            -> BUY half-size (if logged)
  6. Otherwise                                              -> HOLD

The 6-point signal score (see indicators.signal_score):
  1. EMA cross 20 vs 50 on 15-min  (+1 golden / -1 death)
  2. MACD histogram green and rising  (+1 / -1)
  3. RSI 40-65 rising or oversold <30  (+1 / -1)
  4. Bollinger %b near lower band (<0.25)  (+1 / -1)
  5. Volume above 20-bar average  (+1 / -0.5)
  6. 4H trend: 20 EMA > 50 EMA on 4H  (+1 / -1)

Sizing
------
  - BUY size (score >= 4): ATR-based risk sizing capped at the per-symbol cap
      from portfolio_caps.json (e.g. 30% for BTC, 5% for LINK).
      Max risk = equity × 1%; stop = entry - 1.5×ATR.
      qty = max_risk / (1.5 × ATR), capped at (equity × cap_pct) / ask.
  - BUY size (score == 3): half the above size.
  - SELL size = full position quantity, limit inside 0.2% band.

All orders are routed through scripts/trade.py, which still does the final
rule enforcement (per-symbol cap from portfolio_caps.json, 0.2% band,
limit-only, crypto routing).
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
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
WATCHLIST     = PROJECT_ROOT / "watchlist_crypto.json"
CAPS_FILE     = PROJECT_ROOT / "portfolio_caps.json"
JOURNAL_DIR   = PROJECT_ROOT / "journal"

# Load per-symbol position caps from portfolio_caps.json.
# Falls back to 5% default for any symbol not in the file.
def _load_caps() -> dict:
    try:
        with open(CAPS_FILE) as f:
            data = json.load(f)
        return data
    except Exception:
        return {"caps": {}, "default_cap": 0.05}

_CAPS_DATA = _load_caps()

def symbol_cap(symbol: str) -> float:
    """Return the position cap fraction for *symbol* (e.g. 0.30 for BTC/USD)."""
    return _CAPS_DATA["caps"].get(symbol, _CAPS_DATA.get("default_cap", 0.05))

# Strategy thresholds. Tweak here, not in the body of evaluate_symbol.
# Per trading skill: score >= 4 → full size; == 3 → half size; <= 2 → pass.
BUY_SCORE_THRESHOLD      = 4.0
BUY_SCORE_HALF_SIZE      = 3.0
SELL_SCORE_THRESHOLD     = -2.0
BARS_FOR_INDICATORS      = 200   # 50h of 15-min data: enough for EMA(50)+MACD warmup
BARS_TIMEFRAME           = "15Min"
BARS_4H_LOOKBACK         = 120   # ~20 days of 4H bars for the trend filter
BARS_4H_TIMEFRAME        = "4Hour"
DAILY_BARS_LOOKBACK      = 90    # 90 days to safely compute 20/50-day SMAs
DAILY_BARS_TIMEFRAME     = "1Day"

# Minutes per bar for each timeframe -- used to derive the `start` date.
_TF_MINUTES = {
    "15Min": 15,
    "1H":    60,
    "4Hour": 240,
    "1Day":  1440,
}


# ---------- data fetch -----------------------------------------------------

def _bars_start(limit, timeframe, buffer=1.6):
    """
    Return an ISO-8601 UTC start timestamp that gives enough history for
    `limit` bars of the given timeframe, with a generous buffer.

    ROOT CAUSE FIX: Alpaca's crypto bar endpoint ignores a bare `limit`
    parameter and returns only the most-recent incomplete bars unless an
    explicit `start` date is supplied.  Always pass `start`.
    """
    minutes = _TF_MINUTES.get(timeframe, 60)
    lookback_minutes = int(limit * minutes * buffer)
    start_dt = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)
    return start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_positions():
    base_url = os.getenv("APCA_BASE_URL")
    r = requests.get(base_url + "/v2/positions", headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


def get_crypto_bars(symbol, limit=BARS_FOR_INDICATORS, timeframe=BARS_TIMEFRAME):
    """
    Fetch OHLCV bars for a crypto symbol.

    Always includes a computed `start` date so Alpaca returns the full
    historical window (a bare `limit` without `start` returns only the
    current day's partial bars).
    """
    params = {
        "symbols":   symbol,
        "timeframe": timeframe,
        "start":     _bars_start(limit, timeframe),
        "limit":     limit,
    }
    url = DATA_URL + "/v1beta3/crypto/us/bars"
    r = requests.get(url, headers=_headers(), params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("bars", {}).get(symbol, [])


def get_crypto_bars_4h(symbol, limit=BARS_4H_LOOKBACK):
    """4-Hour bars for the higher-timeframe trend filter."""
    return get_crypto_bars(symbol, limit=limit, timeframe=BARS_4H_TIMEFRAME)


def get_crypto_bars_daily(symbol, limit=DAILY_BARS_LOOKBACK):
    """Daily bars for the 20/50-day SMA regime filter."""
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
        "atr": None,
        "rsi": None,
        "macd": None,
        "macd_flip": None,
        "bb": None,
        "bb_trend": None,
        "bb_squeeze": None,
        "ema_cross": None,
        "indicator_breakdown": None,
        "daily_ma20": None,
        "daily_ma50": None,
        "daily_last": None,
        "daily_regime": None,
        "regime_4h": None,
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

    # ── 15-min bars (execution timeframe) ──────────────────────────────
    try:
        bars = get_crypto_bars(symbol)
    except Exception as e:
        decision["reason"] = "bars fetch failed: " + repr(e)
        return decision

    closes  = [float(b.get("c") or 0) for b in bars if b.get("c")]
    highs   = [float(b.get("h") or 0) for b in bars if b.get("c")]
    lows    = [float(b.get("l") or 0) for b in bars if b.get("c")]
    volumes = [float(b.get("v") or 0) for b in bars if b.get("c")]

    # Need at least EMA(50) + MACD slow(26)+signal(9) worth of history.
    MIN_BARS = 60
    if len(closes) < MIN_BARS:
        decision["reason"] = "not enough 15-min history (%d bars, need %d)" % (len(closes), MIN_BARS)
        return decision

    # ── 4H bars (higher-timeframe trend filter) ─────────────────────────
    closes_4h = None
    try:
        bars_4h   = get_crypto_bars_4h(symbol)
        closes_4h = [float(b.get("c") or 0) for b in bars_4h if b.get("c")]
        if len(closes_4h) < 51:
            closes_4h = None   # not enough for EMA(50) on 4H
            decision["regime_4h"] = "insufficient 4H history (%d bars)" % len(closes_4h or [])
        else:
            cross_4h = ind.ema_cross_state(closes_4h)
            decision["regime_4h"] = cross_4h or "n/a"
    except Exception as e:
        decision["regime_4h"] = "4H fetch failed: " + repr(e)[:60]

    # ── Compute all indicators ──────────────────────────────────────────
    score, breakdown = ind.signal_score(
        closes,
        volumes=volumes,
        highs=highs,
        lows=lows,
        closes_4h=closes_4h,
    )
    decision["score"]               = score
    decision["indicator_breakdown"] = breakdown
    decision["rsi"]                 = ind.rsi(closes)
    decision["macd"]                = ind.macd(closes)
    decision["macd_flip"]           = ind.macd_flip(closes)
    decision["bb"]                  = ind.bollinger(closes)
    decision["bb_trend"]            = ind.bollinger_trend(closes)
    decision["bb_squeeze"]          = ind.bollinger_squeeze(closes)
    decision["ema_cross"]           = ind.ema_cross_state(closes)
    decision["atr"]                 = ind.atr(highs, lows, closes)

    # ── Daily-bars regime filter (20/50-day SMA gate for new buys) ──────
    try:
        daily_bars = get_crypto_bars_daily(symbol)
    except Exception as e:
        decision["daily_regime"] = "fetch failed: " + repr(e)[:60]
    else:
        daily_closes = [float(b.get("c") or 0) for b in daily_bars if b.get("c")]
        if len(daily_closes) >= 50:
            daily_ma20 = ind.sma(daily_closes, 20)
            daily_ma50 = ind.sma(daily_closes, 50)
            last_daily = daily_closes[-1]
            decision["daily_ma20"]  = daily_ma20
            decision["daily_ma50"]  = daily_ma50
            decision["daily_last"]  = last_daily
            if last_daily > daily_ma50 and daily_ma20 > daily_ma50:
                decision["daily_regime"] = "uptrend"
            elif last_daily < daily_ma50 and daily_ma20 < daily_ma50:
                decision["daily_regime"] = "downtrend"
            else:
                decision["daily_regime"] = "mixed"
        else:
            decision["daily_regime"] = "insufficient daily history (%d bars)" % len(daily_closes)

    # ── Branch: held position vs. potential new entry ───────────────────
    pos = position_by_symbol.get(symbol)
    if pos:
        entry    = float(pos.get("avg_entry_price") or 0)
        cur      = float(pos.get("current_price") or decision["current_price"])
        qty_held = float(pos.get("qty") or 0)
        decision["entry_price"]   = entry
        decision["current_price"] = cur

        # Hard stop — checked before TA, cannot be overridden.
        if should_stop_out(entry, cur):
            decision["action"]      = "SELL"
            decision["qty"]         = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "STOP-LOSS: entry $%.4f, current $%.4f (>= %d%% drawdown)"
                % (entry, cur, int(STOP_LOSS_PCT * 100))
            )
            return decision

        # Take-profit: close the full position once gain >= 10%.
        if should_take_profit(entry, cur):
            decision["action"]      = "SELL"
            decision["qty"]         = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "TAKE-PROFIT: entry $%.4f, current $%.4f (>= %d%% gain)"
                % (entry, cur, int(TAKE_PROFIT_PCT * 100))
            )
            return decision

        # Discretionary exit on strongly bearish TA confluence.
        if score <= SELL_SCORE_THRESHOLD:
            decision["action"]      = "SELL"
            decision["qty"]         = qty_held
            decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            decision["reason"] = (
                "TA SELL: score=%.1f <= %.1f" % (score, SELL_SCORE_THRESHOLD)
            )
            return decision

        pct_from_entry = (cur - entry) / entry * 100 if entry else 0
        decision["reason"] = (
            "HOLD %.4f @ $%.4f (%.2f%%), score=%.1f"
            % (qty_held, entry, pct_from_entry, score)
        )
        return decision

    # ── No position: evaluate new entry ────────────────────────────────
    # Regime gate: block buys in a confirmed daily downtrend.
    if decision["daily_regime"] == "downtrend":
        decision["reason"] = (
            "regime block: daily downtrend (last=%.4f < ma50=%.4f)"
            % (decision.get("daily_last", 0), decision.get("daily_ma50", 0))
        )
        return decision

    # Score gate: need at least 3/6 to consider entry.
    if score < BUY_SCORE_HALF_SIZE:
        decision["reason"] = (
            "no entry: score=%.1f < %.1f" % (score, BUY_SCORE_HALF_SIZE)
        )
        return decision

    # Fetch account for sizing.
    try:
        equity = float(get_account().get("equity") or 0)
    except Exception as e:
        decision["reason"] = "account fetch failed: " + repr(e)
        return decision
    if ask <= 0:
        decision["reason"] = "no live ask"
        return decision

    # ATR-based sizing: risk 1% of equity per trade, stop = 1.5× ATR.
    # Hard cap: never more than the per-symbol cap (portfolio_caps.json) of equity.
    sym_cap_pct  = symbol_cap(symbol)
    hard_cap_qty = round((equity * sym_cap_pct / ask) * 0.99, 4)
    atr_val = decision.get("atr")
    if atr_val and atr_val > 0:
        max_risk    = equity * 0.01
        stop_dist   = atr_val * 1.5
        atr_qty     = round((max_risk / stop_dist) * 0.99, 4)
        base_qty    = min(atr_qty, hard_cap_qty)
    else:
        # Fallback: use 2% of equity when ATR unavailable.
        base_qty = round((equity * 0.02 / ask) * 0.99, 4)
        base_qty = min(base_qty, hard_cap_qty)

    # Half-size for score == 3 (borderline confluence).
    if score < BUY_SCORE_THRESHOLD:
        qty = round(base_qty * 0.5, 4)
        size_note = "half-size (score=%.1f)" % score
    else:
        qty = base_qty
        size_note = "full-size (score=%.1f)" % score

    if qty <= 0:
        decision["reason"] = "computed qty <= 0 (equity=%.2f)" % equity
        return decision

    decision["action"]      = "BUY"
    decision["qty"]         = qty
    decision["limit_price"] = round(ask, 4)
    decision["reason"]      = "TA BUY %s, atr=%.4f" % (size_note, atr_val or 0)
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
        parts.append("score=%+.1f/6" % d["score"])
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
    score_str = ("%+.1f/6" % d["score"]) if d["score"] is not None else "n/a"
    out.append("    score   : %s" % score_str)
    out.append("    ema_x   : %s" % (d.get("ema_cross") or "n/a"))
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
    if d.get("atr") is not None:
        out.append("    atr     : %.4f  stop_1.5x=%.4f" % (d["atr"], d["atr"] * 1.5))
    out.append("    4h      : %s" % (d.get("regime_4h") or "n/a"))
    if d.get("daily_ma20") is not None and d.get("daily_ma50") is not None:
        out.append("    daily   : ma20=%.4f ma50=%.4f last=%.4f regime=%s" % (
            d["daily_ma20"], d["daily_ma50"], d["daily_last"], d["daily_regime"]
        ))
    elif d.get("daily_regime"):
        out.append("    daily   : regime=" + str(d["daily_regime"]))
    breakdown = d.get("indicator_breakdown") or {}
    if breakdown:
        out.append("    signals :")
        for k, v in breakdown.items():
            out.append("      %-12s %s" % (k + ":", v))
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
                    str(r["result"])[:300],
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
