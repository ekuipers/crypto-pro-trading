# scripts/run_evaluation.py
"""
One-shot crypto evaluation driven by the 6-point Signal Confluence Table
from the trading skill (SKILL.md), per the decision framework in CLAUDE.md.

Reads config.json (watchlist.symbols), fetches 15-min bars (execution), 4H bars
(trend filter), and daily bars (regime/MA filter) per symbol, computes
the confluence score, and decides BUY / SELL / HOLD.

Usage:
    python scripts/run_evaluation.py            # dry-run (default, no orders)
    python scripts/run_evaluation.py --execute  # actually place orders

Decision logic
--------------
For each symbol:
  Long positions (qty > 0):
  1. Existing stop order check (deduplication):
       - If a stop order is pending and within escalation_cycles: skip (no duplicate).
       - If pending past escalation_cycles: cancel and replace with wider band.
       - If the order ID is gone (filled/expired): clear position state, done.
  2. Trailing stop triggered (active after +2.5% gain, trails 3% below HWM) -> SELL
  3. Swing-low stop hit: price <= previous 4H range low (TA-driven; fixed
     stop_loss_pct only as a fallback when 4H history is unavailable)        -> SELL (stop-loss)
  4. Signal score <= sell_score_threshold                                     -> SELL (bearish TA)

  Short positions (qty < 0):
  5. Existing cover order check (deduplication) — same logic as above.
  6. Adverse move >= stop_loss_pct from entry (price rose)            -> COVER (stop-loss)
  7. Signal score >= cover_score_threshold (turned bullish)           -> COVER (TA cover)

  No position:
  8.  Capital preservation mode (daily drawdown gate fired)            -> BLOCK new entries
  9.  Correlation budget: max 4 positions, max 3 per tier (BTC/ETH vs alts) -> BLOCK if exceeded
  10. Daily regime != downtrend AND score >= buy_score_threshold       -> BUY  (full size)
  11. Daily regime != downtrend AND score >= buy_score_half_size       -> BUY  (half size)
  12. Daily regime == downtrend AND score >= downtrend_long_score      -> BUY  (half size, counter-trend)
  13. Daily regime == downtrend AND score <= short_score_threshold     -> SHORT (full size)
  14. Daily regime == downtrend AND score <= short_score_half_size     -> SHORT (half size)
  15. Otherwise                                                         -> HOLD

All thresholds are loaded from config.json at startup.

The 6-point signal score (see indicators.signal_score):
  1. EMA cross 20 vs 50 on 15-min  (+1 golden / -1 death)
  2. MACD histogram green and rising  (+1 / -1)
  3. RSI 40-65 rising or oversold <30  (+1 / -1)
  4. Bollinger %b near lower band (<0.25)  (+1 / -1)
  5. Volume above 20-bar average  (+1 / -0.5)
  6. 4H trend: 20 EMA > 50 EMA on 4H  (+1 / -1)

Sizing
------
  - BUY (score >= buy_score_threshold): ATR-based risk sizing capped at the
    per-symbol cap from config.json > portfolio_caps.caps (e.g. 30% for BTC, 5% for LINK).
    max_risk = equity × risk_per_trade_pct; stop = entry - atr_multiplier × ATR.
    qty = max_risk / (atr_multiplier × ATR), capped at (equity × cap_pct) / ask.
  - BUY (score >= buy_score_half_size): half the above size.
  - SELL: full position quantity, limit inside the configured band.

All orders are routed through scripts/trade.py, which still does the final
rule enforcement (per-symbol cap, limit band, limit-only, crypto routing).

State persistence
-----------------
Position metadata (high-water mark, stop order IDs, cycle counters) is stored
in data/positions_state.json via position_state.py.  This state survives
across evaluation cycles so trailing stops and stop-loss deduplication work
correctly over multiple hourly runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import _env  # noqa: F401  -- load .env into os.environ
import indicators as ind
import position_state as ps
from _api import api_get
from symbols import to_slash
from risk import (
    LIMIT_BAND_PCT,
    STOP_LOSS_PCT,
    STOP_LOSS_MODE,
    STOP_LOSS_ESCALATION_CYCLES,
    MAX_OPEN_POSITIONS,
    TRAILING_STOP_ACTIVATION_PCT,
    TAKER_FEE_BPS_PER_SIDE,
    ROTATION_ENABLED,
    ROTATION_MIN_SCORE,
    ROTATION_SCORE_MARGIN,
    MIN_RR_FULL,
    MIN_RR_HALF,
    ENFORCE_BUDGET_ON_OPEN_POSITIONS,
    MAX_HOLD_HOURS,
    PARTIAL_TP_ENABLED,
    PARTIAL_TP_R_MULTIPLE,
    PARTIAL_TP_FRACTION,
    should_stop_out,
    should_cover_short,
    should_trail_stop_out,
    swing_low_stop_price,
    correlation_budget_allows,
    daily_drawdown_gate_triggered,
    stop_loss_limit_price,
    cover_limit_price,
    round_trip_cost_pct,
    net_rr,
    should_partial_tp,
    is_stale_position,
    rotation_allows,
)
from trade import (
    DATA_URL,
    TradeRejected,
    _headers,
    cancel_order,
    get_account,
    get_latest_quote,
    get_open_orders,
    get_positions,
    is_crypto,
    place_order,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR  = PROJECT_ROOT / "journal"


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    cfg_path = PROJECT_ROOT / "config.json"
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


_CFG = _load_config()
_STRATEGY = _CFG.get("strategy", {})
_DATA     = _CFG.get("data", {})

# Strategy thresholds (all from config.json > strategy).
BUY_SCORE_THRESHOLD   = float(_STRATEGY.get("buy_score_threshold",            4.0))
BUY_SCORE_HALF_SIZE   = float(_STRATEGY.get("buy_score_half_size_threshold",   3.0))
SELL_SCORE_THRESHOLD  = float(_STRATEGY.get("sell_score_threshold",           -2.0))
SHORT_SCORE_THRESHOLD = float(_STRATEGY.get("short_score_threshold",          -4.0))
SHORT_SCORE_HALF_SIZE = float(_STRATEGY.get("short_score_half_size_threshold", -3.0))
COVER_SCORE_THRESHOLD = float(_STRATEGY.get("cover_score_threshold",           2.0))
DOWNTREND_LONG_SCORE  = float(_STRATEGY.get("downtrend_long_score_threshold",  4.0))
ATR_MULTIPLIER        = float(_STRATEGY.get("atr_multiplier",                  1.5))
RISK_PER_TRADE_PCT    = float(_STRATEGY.get("risk_per_trade_pct",              0.01))
FALLBACK_SIZE_PCT     = float(_STRATEGY.get("fallback_size_pct",               0.02))
SESSION_FILTER_ENABLED = bool(_STRATEGY.get("session_filter_enabled",         False))
SESSION_MIN_SAMPLE     = int(_STRATEGY.get("session_min_sample",               20))

# Bar-fetch sizes (all from config.json > data).
BARS_FOR_INDICATORS  = int(_DATA.get("bars_15min",          200))
BARS_4H_LOOKBACK     = int(_DATA.get("bars_4h",             120))
DAILY_BARS_LOOKBACK  = int(_DATA.get("bars_daily",           90))
MIN_BARS             = int(_DATA.get("min_bars_for_signal",  60))

BARS_TIMEFRAME       = "15Min"
BARS_4H_TIMEFRAME    = "4Hour"
DAILY_BARS_TIMEFRAME = "1Day"

# Minutes per bar for each timeframe — used to derive the `start` date.
_TF_MINUTES = {
    "15Min": 15,
    "1H":    60,
    "1Hour": 60,
    "4Hour": 240,
    "1Day":  1440,
}


# ---------------------------------------------------------------------------
# Portfolio caps
# ---------------------------------------------------------------------------

def _load_caps() -> dict:
    return _CFG.get("portfolio_caps", {"caps": {}, "default_cap": 0.05})


_CAPS_DATA = _load_caps()


def symbol_cap(symbol: str) -> float:
    """Return the position cap fraction for *symbol* (e.g. 0.30 for BTC/USD).

    Caps are read from config.json > portfolio_caps.caps using slash form
    (e.g. "BTC/USD") to match the watchlist.
    """
    return _CAPS_DATA["caps"].get(symbol, _CAPS_DATA.get("default_cap", 0.05))


def compute_entry_qty(equity: float, symbol: str, price: float, atr_val) -> float:
    """ATR-based 1%-risk sizing capped at the per-symbol cap (shared by the
    normal entry path and the rotation pass)."""
    sym_cap_pct = symbol_cap(symbol)
    hard_cap = round((equity * sym_cap_pct / price) * 0.99, 4)
    if atr_val and atr_val > 0:
        max_risk  = equity * RISK_PER_TRADE_PCT
        stop_dist = atr_val * ATR_MULTIPLIER
        raw_qty   = round((max_risk / stop_dist) * 0.99, 4)
        return min(raw_qty, hard_cap)
    return min(round((equity * FALLBACK_SIZE_PCT / price) * 0.99, 4), hard_cap)


# ---------------------------------------------------------------------------
# Session-edge feedback loop (roadmap 2026-07-09 item 8 — OFF by default)
# ---------------------------------------------------------------------------
# Buckets realized FIFO round-trip P&L by exit hour-of-day and day-of-week
# (GMT+2, same convention as the dashboard Edge tab). Buckets with at least
# SESSION_MIN_SAMPLE round trips and negative net P&L trigger half-sizing of
# new entries during that hour/weekday. Enabled via
# config.json > strategy.session_filter_enabled (ships false).

_SESSION_PENALTY: dict | None = None   # {"hours": set[int], "dows": set[str]}


def _fetch_all_fills() -> list:
    """Full paginated FILL activity history (newest first), capped at 10k."""
    from trade import BASE_URL
    fills: list = []
    page_token = None
    for _ in range(100):
        params = {"activity_type": "FILL", "page_size": 100, "direction": "desc"}
        if page_token:
            params["page_token"] = page_token
        r = api_get(BASE_URL + "/v2/account/activities",
                    headers=_headers(), params=params, timeout=20)
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        fills += batch
        if len(batch) < 100:
            break
        page_token = batch[-1].get("id")
    return fills


def _compute_session_penalty() -> dict:
    """Return the negative-expectancy hour/weekday buckets from fill history."""
    penalty = {"hours": set(), "dows": set()}
    try:
        fills = _fetch_all_fills()
        # FIFO round-trip matching, chronological (same as the Edge tab).
        queues: dict = {}
        hour_pnl: dict = {}
        dow_pnl: dict = {}
        for act in reversed(fills):
            sym   = act.get("symbol")
            side  = act.get("side")
            qty   = abs(float(act.get("qty") or 0))
            price = float(act.get("price") or 0)
            when  = act.get("transaction_time") or act.get("date")
            if not sym or not when or qty <= 0 or price <= 0:
                continue
            queues.setdefault(sym, [])
            if side == "buy":
                queues[sym].append([qty, price])
            elif side == "sell":
                remaining, pnl, matched = qty, 0.0, False
                while remaining > 1e-9 and queues[sym]:
                    lot = queues[sym][0]
                    m = min(remaining, lot[0])
                    pnl += m * (price - lot[1])
                    lot[0] -= m
                    remaining -= m
                    matched = True
                    if lot[0] < 1e-6:
                        queues[sym].pop(0)
                if not matched:
                    continue  # SELL with no prior BUY — excluded (FIFO rule)
                try:
                    exit_dt = datetime.fromisoformat(
                        str(when).replace("Z", "+00:00")
                    ).astimezone(ZoneInfo("Etc/GMT-2"))
                except Exception:
                    continue
                hour_pnl.setdefault(exit_dt.hour, []).append(pnl)
                dow_pnl.setdefault(exit_dt.strftime("%a"), []).append(pnl)
        for hour, pnls in hour_pnl.items():
            if len(pnls) >= SESSION_MIN_SAMPLE and sum(pnls) < 0:
                penalty["hours"].add(hour)
        for dow, pnls in dow_pnl.items():
            if len(pnls) >= SESSION_MIN_SAMPLE and sum(pnls) < 0:
                penalty["dows"].add(dow)
    except Exception as e:
        print("session-edge filter skipped: %r" % e)
    return penalty


def _session_penalty_active(now=None) -> bool:
    """True when the current GMT+2 hour or weekday is a penalized bucket."""
    global _SESSION_PENALTY
    if _SESSION_PENALTY is None:
        _SESSION_PENALTY = _compute_session_penalty()
        if _SESSION_PENALTY["hours"] or _SESSION_PENALTY["dows"]:
            print("session-edge filter: half-size hours=%s dows=%s"
                  % (sorted(_SESSION_PENALTY["hours"]),
                     sorted(_SESSION_PENALTY["dows"])))
    now = now or datetime.now(ZoneInfo("Etc/GMT-2"))
    return (now.hour in _SESSION_PENALTY["hours"]
            or now.strftime("%a") in _SESSION_PENALTY["dows"])


# ---------------------------------------------------------------------------
# Data fetch
# ---------------------------------------------------------------------------

def _bars_start(limit: int, timeframe: str, buffer: float = 1.6) -> str:
    """
    Return an ISO-8601 UTC start timestamp giving enough history for
    `limit` bars of the given timeframe, with a generous buffer.

    ROOT CAUSE FIX: Alpaca's crypto bar endpoint ignores a bare `limit`
    parameter and returns only the most-recent incomplete bars unless an
    explicit `start` date is supplied.  Always pass `start`.
    """
    minutes = _TF_MINUTES.get(timeframe, 60)
    lookback_minutes = int(limit * minutes * buffer)
    start_dt = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)
    return start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _bars_end(timeframe: str) -> str:
    """
    Return an ISO-8601 UTC end timestamp that excludes the current
    in-progress bar.

    Alpaca returns the currently-forming bar in bar requests when no end
    date is supplied.  That partial bar has near-zero volume (only trades
    since the bar opened), which causes volume_ratio to show ~0× and
    produces unstable RSI/MACD/BB values that change mid-bar.  Subtracting
    one full bar-period ensures only fully-closed bars are included.

    Example: if it is 09:23 on a 15-min timeframe, end = 09:08.
    The current bar opened at 09:15 (timestamp > 09:08) so it is excluded.
    The last returned bar opened at 09:00 and closed at 09:15 — fully complete.
    """
    minutes = _TF_MINUTES.get(timeframe, 60)
    end_dt = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_crypto_bars(
    symbol: str,
    limit: int = BARS_FOR_INDICATORS,
    timeframe: str = BARS_TIMEFRAME,
) -> list:
    """
    Fetch OHLCV bars for a crypto symbol.

    Always includes a computed `start` date so Alpaca returns the full
    historical window (a bare `limit` without `start` returns only the
    current day's partial bars).

    STALE-BARS FIX: Alpaca returns bars oldest-first by default. With
    `start` set ~1.6x the needed window back and `limit=N`, the response
    was the *first* N bars of the window — ending up to 60% of the window
    in the past (daily bars were 54 days stale). `sort=desc` makes Alpaca
    return the *most recent* N bars before `end`; we then reverse back to
    chronological (oldest->newest) order, which all indicator code expects.
    """
    params = {
        "symbols":   symbol,
        "timeframe": timeframe,
        "start":     _bars_start(limit, timeframe),
        "end":       _bars_end(timeframe),   # exclude current in-progress bar
        "limit":     limit,
        "sort":      "desc",                 # newest N bars, not oldest N
    }
    url = DATA_URL + "/v1beta3/crypto/us/bars"
    r = api_get(url, headers=_headers(), params=params, timeout=20)
    bars = r.json().get("bars", {}).get(symbol, [])
    return bars[::-1]  # back to chronological order for indicators


def get_crypto_bars_4h(symbol: str, limit: int = BARS_4H_LOOKBACK) -> list:
    """4-Hour bars for the higher-timeframe trend filter."""
    return get_crypto_bars(symbol, limit=limit, timeframe=BARS_4H_TIMEFRAME)


def get_crypto_bars_daily(symbol: str, limit: int = DAILY_BARS_LOOKBACK) -> list:
    """Daily bars for the 20/50-day SMA regime filter."""
    return get_crypto_bars(symbol, limit=limit, timeframe=DAILY_BARS_TIMEFRAME)


def aggregate_bars_to_4h(bars_1h: list) -> list:
    """
    Aggregate 1-hour bars into synthetic 4-hour bars (roadmap 2026-07-09
    item 6 — 4H data fallback). Buckets align to 4-hour UTC boundaries
    (00/04/08/12/16/20). Only complete buckets (all 4 hourly bars present)
    are kept so the synthetic OHLCV matches what a native 4H bar would show;
    crypto trades 24/7 so complete buckets are the norm.
    """
    buckets: dict = {}
    order: list = []
    for b in bars_1h:
        t = b.get("t")
        if not t or not b.get("c"):
            continue
        try:
            dt = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
        except Exception:
            continue
        key = dt.replace(minute=0, second=0, microsecond=0,
                         hour=(dt.hour // 4) * 4)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(b)
    out = []
    for key in order:
        grp = buckets[key]
        if len(grp) < 4:
            continue  # partial bucket (window edge / in-progress) — drop
        out.append({
            "t": key.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "o": float(grp[0].get("o") or 0),
            "h": max(float(g.get("h") or 0) for g in grp),
            "l": min(float(g.get("l") or 0) for g in grp),
            "c": float(grp[-1].get("c") or 0),
            "v": sum(float(g.get("v") or 0) for g in grp),
        })
    return out


# ---------------------------------------------------------------------------
# Per-symbol evaluation
# ---------------------------------------------------------------------------

def evaluate_symbol(
    symbol: str,
    position_by_symbol: dict,
    state: dict,
    open_symbols: list,
) -> dict:
    """Return a decision dict for one symbol.

    *state* is the mutable position-state dict from position_state.load_state().
    It is updated in-place when stop orders are deduplicated or cleared.

    *open_symbols* is the list of symbols with currently open positions,
    used for the correlation budget check on new entries.
    """
    decision: dict = {
        "symbol":              symbol,
        "action":              "HOLD",
        "reason":              "",
        "qty":                 None,
        "limit_price":         None,
        "ask":                 None,
        "bid":                 None,
        "score":               None,
        "atr":                 None,
        "rsi":                 None,
        "macd":                None,
        "macd_flip":           None,
        "bb":                  None,
        "bb_trend":            None,
        "bb_squeeze":          None,
        "ema_cross":           None,
        "adx":                 None,
        "obv_trend":           None,
        "indicator_breakdown": None,
        "daily_ma20":          None,
        "daily_ma50":          None,
        "daily_last":          None,
        "daily_regime":        None,
        "regime_4h":           None,
        "entry_price":         None,
        "current_price":       None,
        "is_stop_loss":        False,   # True when place_order needs wider limit band
        "is_partial_tp":       False,   # True for the +1R half scale-out SELL
        "synthetic_4h":        False,   # 4H bars rebuilt from 1H (data fallback)
        "data_quality_warning": None,   # explicit journal warning when 4H degraded
        "net_rr":              None,    # net-of-cost R:R for new entries (item 7)
    }

    # Live quote — needed for sizing, stop-loss, and limit pricing.
    try:
        q   = get_latest_quote(symbol)
        ask = float(q.get("ap") or 0)
        bid = float(q.get("bp") or 0)
    except Exception as e:
        decision["reason"] = "quote fetch failed: " + repr(e)
        return decision
    decision["ask"]           = ask
    decision["bid"]           = bid
    decision["current_price"] = bid or ask

    # ── 15-min bars (execution timeframe) ──────────────────────────────────
    try:
        bars = get_crypto_bars(symbol)
    except Exception as e:
        decision["reason"] = "bars fetch failed: " + repr(e)
        return decision

    closes  = [float(b.get("c") or 0) for b in bars if b.get("c")]
    highs   = [float(b.get("h") or 0) for b in bars if b.get("c")]
    lows    = [float(b.get("l") or 0) for b in bars if b.get("c")]
    volumes = [float(b.get("v") or 0) for b in bars if b.get("c")]

    if len(closes) < MIN_BARS:
        decision["reason"] = (
            "not enough 15-min history (%d bars, need %d)" % (len(closes), MIN_BARS)
        )
        return decision

    # ── 4H bars (higher-timeframe trend filter + swing-low stop source) ──────
    # Fallback (roadmap 2026-07-09 item 6): when the native 4H fetch is short
    # (journals showed "insufficient 4H history (0 bars)" for ADA/AAVE), build
    # synthetic 4H bars from 1H bars instead of silently zeroing Signal 6 and
    # dropping the swing-low stop to the fixed −5% fallback.
    closes_4h = None
    try:
        bars_4h  = get_crypto_bars_4h(symbol)
        n_native = len([b for b in bars_4h if b.get("c")])
        if n_native < 51:
            try:
                bars_1h = get_crypto_bars(
                    symbol, limit=BARS_4H_LOOKBACK * 4, timeframe="1Hour"
                )
                synth = aggregate_bars_to_4h(bars_1h)
                if len(synth) >= 51:
                    bars_4h = synth
                    decision["synthetic_4h"] = True
            except Exception:
                pass
        closes_4h = [float(b.get("c") or 0) for b in bars_4h if b.get("c")]
        # Capture 4H lows for the swing-low (previous range low) stop.
        decision["lows_4h"] = [float(b.get("l") or 0) for b in bars_4h if b.get("c")]
        if len(closes_4h) < 51:
            n_bars = len(closes_4h)
            closes_4h = None
            decision["regime_4h"] = "insufficient 4H history (%d bars)" % n_bars
            decision["data_quality_warning"] = (
                "4H history unavailable (native %d bars, 1H fallback failed) — "
                "Signal 6 contributes 0 and the swing-low stop falls back to "
                "the fixed -%d%%" % (n_native, int(STOP_LOSS_PCT * 100))
            )
        else:
            cross_4h = ind.ema_cross_state(closes_4h)
            decision["regime_4h"] = (cross_4h or "n/a") + (
                " (synthetic 4H from 1H)" if decision.get("synthetic_4h") else ""
            )
    except Exception as e:
        decision["regime_4h"] = "4H fetch failed: " + repr(e)[:60]
        decision["data_quality_warning"] = (
            "4H fetch failed — Signal 6 contributes 0 and the swing-low stop "
            "falls back to the fixed -%d%%" % int(STOP_LOSS_PCT * 100)
        )

    # ── Compute all indicators ───────────────────────────────────────────────
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
    # Informational only — not part of the 6-point score (see indicators.py).
    decision["adx"]                 = ind.adx(highs, lows, closes)
    decision["obv_trend"]           = ind.obv_trend(closes, volumes)

    # ── Daily-bars regime filter (20/50-day SMA gate for new buys) ──────────
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
            decision["daily_regime"] = (
                "insufficient daily history (%d bars)" % len(daily_closes)
            )

    # ── Branch: held position vs. potential new entry ────────────────────────
    pos = position_by_symbol.get(symbol)
    if pos:
        entry    = float(pos.get("avg_entry_price") or 0)
        cur      = float(pos.get("current_price") or decision["current_price"])
        qty_held = float(pos.get("qty") or 0)
        decision["entry_price"]   = entry
        decision["current_price"] = cur

        is_short = qty_held < 0
        ps_pos   = ps.get_position(state, symbol)

        if is_short:
            # ── Short position management ────────────────────────────────────

            # Deduplication: check for an existing pending cover order.
            existing_cover_id = ps_pos.get("stop_order_id")
            if existing_cover_id:
                cycles = ps.increment_stop_order_cycles(state, symbol)
                try:
                    open_orders = get_open_orders(symbol)
                    still_open  = any(o.get("id") == existing_cover_id for o in open_orders)
                except Exception:
                    still_open = True  # assume still open on fetch error (fail safe)

                if still_open:
                    if cycles < STOP_LOSS_ESCALATION_CYCLES:
                        # Order is pending within the grace window — do not duplicate.
                        decision["reason"] = (
                            "COVER pending (order …%s, cycle %d/%d)"
                            % (existing_cover_id[-8:], cycles, STOP_LOSS_ESCALATION_CYCLES)
                        )
                        return decision
                    else:
                        # Time-escalation: cancel stale order, fall through to re-place.
                        cancel_order(existing_cover_id)
                        ps.clear_stop_order(state, symbol)
                else:
                    # Order gone — filled or expired. Clear position state.
                    ps.clear_stop_order(state, symbol)
                    ps.clear_position(state, symbol)
                    decision["reason"] = (
                        "cover order …%s filled/gone — position cleared"
                        % existing_cover_id[-8:]
                    )
                    return decision

            # Hard stop: cover if price rose >= stop_loss_pct above entry.
            if should_cover_short(entry, cur):
                cycles_open = ps_pos.get("stop_order_cycles", 0)
                lim = cover_limit_price(ask, cycles_open)
                decision["action"]       = "COVER"
                decision["qty"]          = abs(qty_held)
                decision["limit_price"]  = lim
                decision["is_stop_loss"] = True
                decision["reason"] = (
                    "COVER STOP-LOSS: entry $%.4f, current $%.4f (>= %d%% adverse move)"
                    % (entry, cur, int(STOP_LOSS_PCT * 100))
                )
                return decision

            # TA cover: score turned bullish enough to close the short.
            if score >= COVER_SCORE_THRESHOLD:
                decision["action"]      = "COVER"
                decision["qty"]         = abs(qty_held)
                decision["limit_price"] = round(ask * (1 + LIMIT_BAND_PCT * 0.5), 4)
                decision["reason"] = (
                    "TA COVER: score=%.1f >= %.1f" % (score, COVER_SCORE_THRESHOLD)
                )
                return decision

            pct_from_entry = (entry - cur) / entry * 100 if entry else 0
            decision["reason"] = (
                "HOLD SHORT %.4f @ $%.4f (%.2f%% profit), score=%.1f"
                % (abs(qty_held), entry, pct_from_entry, score)
            )
            return decision

        else:
            # ── Long position management ─────────────────────────────────────
            hwm              = ps_pos.get("high_water_mark") or entry
            existing_stop_id = ps_pos.get("stop_order_id")

            # Deduplication: check for an existing pending stop order.
            if existing_stop_id:
                cycles = ps.increment_stop_order_cycles(state, symbol)
                try:
                    open_orders = get_open_orders(symbol)
                    still_open  = any(o.get("id") == existing_stop_id for o in open_orders)
                except Exception:
                    still_open = True  # fail safe: assume pending

                if still_open:
                    if cycles < STOP_LOSS_ESCALATION_CYCLES:
                        # Pending within grace window — do not duplicate.
                        decision["reason"] = (
                            "stop-loss pending (order …%s, cycle %d/%d)"
                            % (existing_stop_id[-8:], cycles, STOP_LOSS_ESCALATION_CYCLES)
                        )
                        return decision
                    else:
                        # Time-escalation: cancel and re-place with wider band.
                        cancel_order(existing_stop_id)
                        ps.clear_stop_order(state, symbol)
                        # fall through to fresh stop evaluation below
                else:
                    # Order gone — filled or expired. Clear position state.
                    ps.clear_stop_order(state, symbol)
                    ps.clear_position(state, symbol)
                    decision["reason"] = (
                        "stop order …%s filled/gone — position cleared"
                        % existing_stop_id[-8:]
                    )
                    return decision

            # Trailing stop (supersedes hard stop once activated).
            if should_trail_stop_out(entry, hwm, cur):
                cycles_open = ps_pos.get("stop_order_cycles", 0)
                lim = stop_loss_limit_price(ask, cycles_open)
                decision["action"]       = "SELL"
                decision["qty"]          = qty_held
                decision["limit_price"]  = lim
                decision["is_stop_loss"] = True
                decision["reason"] = (
                    "TRAILING STOP: entry $%.4f HWM $%.4f current $%.4f trail_lim $%.4f"
                    % (entry, hwm, cur, lim)
                )
                return decision

            # TA-driven stop: just below the previous 4H range low (fixed
            # STOP_LOSS_PCT only as a fallback when 4H history is unavailable).
            swing_stop = None
            if STOP_LOSS_MODE == "swing_low_4h":
                swing_stop = swing_low_stop_price(entry, decision.get("lows_4h"))

            # Partial take-profit ladder (roadmap 2026-07-09 item 4): at +1R
            # (R = entry − stop distance) sell PARTIAL_TP_FRACTION and raise
            # the remaining stop to breakeven; the remainder rides the
            # existing trailing stop.
            if PARTIAL_TP_ENABLED and not ps_pos.get("partial_tp_done"):
                r_stop = swing_stop if swing_stop else entry * (1 - STOP_LOSS_PCT)
                if should_partial_tp(entry, cur, r_stop, already_done=False,
                                     r_multiple=PARTIAL_TP_R_MULTIPLE):
                    part_qty = round(qty_held * PARTIAL_TP_FRACTION, 4)
                    if part_qty > 0:
                        decision["action"]        = "SELL"
                        decision["qty"]           = part_qty
                        decision["limit_price"]   = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
                        decision["is_partial_tp"] = True
                        decision["reason"] = (
                            "PARTIAL TP +%.1fR: entry $%.4f, current $%.4f >= "
                            "trigger $%.4f — selling %d%%, stop to breakeven"
                            % (PARTIAL_TP_R_MULTIPLE, entry, cur,
                               entry + (entry - r_stop) * PARTIAL_TP_R_MULTIPLE,
                               int(PARTIAL_TP_FRACTION * 100))
                        )
                        return decision

            # Hard stop — checked before TA, cannot be overridden. After the
            # partial TP, the breakeven stop (entry) supersedes a lower swing
            # low so the remainder can no longer turn into a loser.
            breakeven = ps_pos.get("breakeven_stop") if ps_pos.get("partial_tp_done") else None
            eff_stop = max([s for s in (swing_stop, breakeven) if s], default=None)
            if should_stop_out(entry, cur, stop_price=eff_stop):
                cycles_open = ps_pos.get("stop_order_cycles", 0)
                lim = stop_loss_limit_price(ask, cycles_open)
                decision["action"]       = "SELL"
                decision["qty"]          = qty_held
                decision["limit_price"]  = lim
                decision["is_stop_loss"] = True
                if eff_stop and breakeven and eff_stop == breakeven:
                    decision["reason"] = (
                        "STOP-LOSS (breakeven after partial TP): entry $%.4f, "
                        "current $%.4f <= stop $%.4f"
                        % (entry, cur, eff_stop)
                    )
                elif eff_stop:
                    decision["reason"] = (
                        "STOP-LOSS (4H swing low): entry $%.4f, current $%.4f <= "
                        "stop $%.4f (prev 4H range low)"
                        % (entry, cur, eff_stop)
                    )
                else:
                    decision["reason"] = (
                        "STOP-LOSS (fallback): entry $%.4f, current $%.4f "
                        "(>= %d%% drawdown, no 4H data)"
                        % (entry, cur, int(STOP_LOSS_PCT * 100))
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

            # Stale-position exit (roadmap 2026-07-09 item 5): a position older
            # than MAX_HOLD_HOURS that never armed its trailing stop and whose
            # live score is below the half-size entry gate is dead capital —
            # free the correlation-budget slot at the normal limit band.
            trailing_armed = (
                entry > 0 and hwm is not None
                and (hwm - entry) / entry >= TRAILING_STOP_ACTIVATION_PCT
            )
            if is_stale_position(ps_pos.get("entry_time_iso"), trailing_armed,
                                 score, BUY_SCORE_HALF_SIZE,
                                 max_hold_hours=MAX_HOLD_HOURS):
                decision["action"]      = "SELL"
                decision["qty"]         = qty_held
                decision["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
                decision["reason"] = (
                    "STALE EXIT: held > %.0fh, trailing stop never armed, "
                    "score=%.1f < %.1f — freeing budget slot"
                    % (MAX_HOLD_HOURS, score, BUY_SCORE_HALF_SIZE)
                )
                return decision

            pct_from_entry = (cur - entry) / entry * 100 if entry else 0
            decision["reason"] = (
                "HOLD %.4f @ $%.4f (%.2f%%), score=%.1f"
                % (qty_held, entry, pct_from_entry, score)
            )
            return decision

    # ── No position: evaluate new entry (long or short) ─────────────────────

    # Gate 1: capital preservation mode (daily drawdown gate fired).
    if ps.is_capital_preservation_mode(state):
        decision["reason"] = "BLOCKED: capital preservation mode active (daily drawdown gate)"
        return decision

    # Gate 2: correlation budget — max open positions and per-tier limits.
    allowed, budget_reason = correlation_budget_allows(symbol, open_symbols)
    if not allowed:
        decision["reason"] = "BLOCKED: " + budget_reason
        return decision

    # Fetch account once — needed for sizing either direction.
    try:
        equity = float(get_account().get("equity") or 0)
    except Exception as e:
        decision["reason"] = "account fetch failed: " + repr(e)
        return decision
    if ask <= 0 or bid <= 0:
        decision["reason"] = "no live quote"
        return decision

    atr_val = decision.get("atr")

    def _compute_qty(price: float) -> float:
        """ATR-based sizing capped at the per-symbol cap, using given price."""
        return compute_entry_qty(equity, symbol, price, atr_val)

    # ── Long entry ───────────────────────────────────────────────────────────
    # Regime gate (loosened): longs allowed in uptrend/mixed at score >=
    # BUY_SCORE_HALF_SIZE; in a confirmed downtrend a half-size counter-trend
    # long is allowed only at high confluence (score >= DOWNTREND_LONG_SCORE).
    regime = decision["daily_regime"]
    in_downtrend = regime == "downtrend"
    allow_long = (
        (not in_downtrend and score >= BUY_SCORE_HALF_SIZE)
        or (in_downtrend and score >= DOWNTREND_LONG_SCORE)
    )
    if allow_long:
        # R:R soft entry gate (roadmap 2026-07-09 items 1+7): reward leg is
        # net of the round-trip cost (2× taker fee + live spread). Risk leg =
        # distance to the 4H swing-low stop; target = BB upper band. Soft:
        # skipped when stop/target geometry is unavailable.
        rr_half_note = ""
        cost_pct = round_trip_cost_pct(bid, ask, TAKER_FEE_BPS_PER_SIDE)
        entry_stop = swing_low_stop_price(ask, decision.get("lows_4h"))
        bb = decision.get("bb")
        bb_target = bb[2] if bb and bb[2] and bb[2] > ask else None
        rr = net_rr(ask, entry_stop, bb_target, cost_pct=cost_pct)
        decision["net_rr"] = rr
        if rr is not None:
            if rr < MIN_RR_HALF:
                decision["reason"] = (
                    "BLOCKED: net R:R %.2f < %.1f (stop $%.4f, target $%.4f, "
                    "round-trip cost %.2f%%)"
                    % (rr, MIN_RR_HALF, entry_stop, bb_target, cost_pct * 100)
                )
                return decision
            if rr < MIN_RR_FULL:
                rr_half_note = ", half-size on net R:R %.2f < %.1f" % (rr, MIN_RR_FULL)

        # Session-edge filter (roadmap 2026-07-09 item 8, OFF by default):
        # half-size entries during hour/weekday buckets whose realized
        # expectancy is materially negative (>= SESSION_MIN_SAMPLE round trips).
        session_note = ""
        if SESSION_FILTER_ENABLED and _session_penalty_active():
            session_note = ", half-size on negative session expectancy"

        base_qty = _compute_qty(ask)
        # Counter-trend (downtrend) longs are half-size only; otherwise the
        # usual full-size at/above BUY_SCORE_THRESHOLD, half-size below it.
        if in_downtrend:
            qty       = round(base_qty * 0.5, 4)
            size_note = "half-size counter-trend (downtrend, score=%.1f)" % score
        elif score < BUY_SCORE_THRESHOLD:
            qty       = round(base_qty * 0.5, 4)
            size_note = "half-size (score=%.1f)" % score
        elif rr_half_note or session_note:
            qty       = round(base_qty * 0.5, 4)
            size_note = "full-score (%.1f)%s%s" % (score, rr_half_note, session_note)
        else:
            qty       = base_qty
            size_note = "full-size (score=%.1f)" % score

        if qty > 0:
            decision["action"]      = "BUY"
            decision["qty"]         = qty
            decision["limit_price"] = round(ask, 4)
            decision["reason"]      = "TA BUY %s, atr=%.4f" % (size_note, atr_val or 0)
            return decision

    # ── Short entry ──────────────────────────────────────────────────────────
    # Regime gate: only short into a confirmed daily downtrend.
    # Score gate: need a strongly bearish signal (≤ short_score_half_size).
    # VENUE GATE (2026-06-11): Alpaca spot crypto cannot be shorted — every
    # SHORT ever attempted was rejected and none filled. Shorts are disabled
    # by default via config.json > strategy.shorts_enabled (false). Cover
    # logic stays active as a safety net for any legacy short position.
    if (_CFG.get("strategy", {}).get("shorts_enabled", False)
            and decision["daily_regime"] == "downtrend"
            and score <= SHORT_SCORE_HALF_SIZE):
        base_qty = _compute_qty(bid)
        if score > SHORT_SCORE_THRESHOLD:
            qty       = round(base_qty * 0.5, 4)
            size_note = "half-size short (score=%.1f)" % score
        else:
            qty       = base_qty
            size_note = "full-size short (score=%.1f)" % score

        if qty > 0:
            decision["action"]      = "SHORT"
            decision["qty"]         = qty
            decision["limit_price"] = round(bid, 4)
            decision["reason"]      = "TA SHORT %s, atr=%.4f" % (size_note, atr_val or 0)
            return decision

    # ── No actionable signal ─────────────────────────────────────────────────
    if decision["daily_regime"] == "downtrend":
        if _CFG.get("strategy", {}).get("shorts_enabled", False):
            decision["reason"] = (
                "no short entry: score=%.1f > %.1f (need more bearish confluence)"
                % (score, SHORT_SCORE_HALF_SIZE)
            )
        else:
            decision["reason"] = (
                "downtrend: counter-trend long needs score >= %.1f (have %.1f); "
                "shorts disabled (venue unsupported)"
                % (DOWNTREND_LONG_SCORE, score)
            )
    else:
        decision["reason"] = (
            "no entry: score=%.1f (buy needs >= %.1f, regime=%s)"
            % (score, BUY_SCORE_HALF_SIZE, decision.get("daily_regime", "n/a"))
        )
    return decision


# ---------------------------------------------------------------------------
# Position rotation at the correlation budget (roadmap 2026-07-09 item 2)
# ---------------------------------------------------------------------------

def apply_rotation(decisions: list, pos_by_symbol: dict, open_symbols: list):
    """
    When the correlation budget blocked a high-confluence candidate while the
    weakest open holding scores <= 0, rotate: SELL the weakest and BUY the
    candidate in the same cycle (observed live 2026-07-08: UNI/USD +4.0
    blocked for cycles while AAVE/USD sat at -1.0).

    Mutates the two decision dicts in place. Returns a journal note string,
    or None when no rotation applies. Config-flagged (strategy.rotation_enabled);
    at most one rotation per cycle.
    """
    if not ROTATION_ENABLED:
        return None
    cands = [
        d for d in decisions
        if d["action"] == "HOLD" and d.get("score") is not None
        and d["score"] >= ROTATION_MIN_SCORE
        and str(d.get("reason", "")).startswith("BLOCKED: correlation budget")
    ]
    if not cands:
        return None
    cands.sort(key=lambda d: d["score"], reverse=True)

    helds = [
        d for d in decisions
        if d["action"] == "HOLD" and d.get("score") is not None
        and d["symbol"] in pos_by_symbol
        and float(pos_by_symbol[d["symbol"]].get("qty") or 0) > 0
    ]
    if not helds:
        return None
    weakest = min(helds, key=lambda d: d["score"])

    for cand in cands:
        if not rotation_allows(cand["score"], weakest["score"],
                               ROTATION_MIN_SCORE, ROTATION_SCORE_MARGIN):
            continue
        # Same regime gate as a normal entry.
        if (cand.get("daily_regime") == "downtrend"
                and cand["score"] < DOWNTREND_LONG_SCORE):
            continue
        # Budget must actually clear once the weakest is gone (tier check).
        remaining = [s for s in open_symbols if s != weakest["symbol"]]
        allowed, _ = correlation_budget_allows(cand["symbol"], remaining)
        if not allowed:
            continue
        # R:R soft gate still applies to the rotation entry (items 1+7).
        c_ask, c_bid = cand.get("ask") or 0, cand.get("bid") or 0
        if c_ask <= 0:
            continue
        cost_pct   = round_trip_cost_pct(c_bid, c_ask, TAKER_FEE_BPS_PER_SIDE)
        entry_stop = swing_low_stop_price(c_ask, cand.get("lows_4h"))
        bb = cand.get("bb")
        bb_target = bb[2] if bb and bb[2] and bb[2] > c_ask else None
        rr = net_rr(c_ask, entry_stop, bb_target, cost_pct=cost_pct)
        if rr is not None and rr < MIN_RR_HALF:
            continue

        w_ask    = weakest.get("ask") or 0
        qty_held = float(pos_by_symbol[weakest["symbol"]].get("qty") or 0)
        if w_ask <= 0 or qty_held <= 0:
            return None
        try:
            equity = float(get_account().get("equity") or 0)
        except Exception:
            return None
        base_qty = compute_entry_qty(equity, cand["symbol"], c_ask, cand.get("atr"))
        half = (cand.get("daily_regime") == "downtrend"
                or cand["score"] < BUY_SCORE_THRESHOLD
                or (rr is not None and rr < MIN_RR_FULL))
        qty = round(base_qty * (0.5 if half else 1.0), 4)
        if qty <= 0:
            return None

        weakest["action"]      = "SELL"
        weakest["qty"]         = qty_held
        weakest["limit_price"] = round(w_ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
        weakest["reason"] = (
            "ROTATION OUT: score=%.1f <= 0; %s scores %.1f (>= +%.1f margin) "
            "at a full budget — freeing the slot"
            % (weakest["score"], cand["symbol"], cand["score"],
               ROTATION_SCORE_MARGIN)
        )
        cand["action"]      = "BUY"
        cand["qty"]         = qty
        cand["limit_price"] = round(c_ask, 4)
        cand["reason"] = (
            "ROTATION IN: score=%.1f replaces %s (score %.1f)%s"
            % (cand["score"], weakest["symbol"], weakest["score"],
               ", half-size" if half else "")
        )
        return ("ROTATION: %s (score %.1f) -> %s (score %.1f)"
                % (weakest["symbol"], weakest["score"],
                   cand["symbol"], cand["score"]))
    return None


# ---------------------------------------------------------------------------
# Presentation helpers
# ---------------------------------------------------------------------------

def fmt_macd(m: tuple | None) -> str:
    if m is None:
        return "n/a"
    return "line=%.4f sig=%.4f hist=%.4f" % m


def fmt_bb(b: tuple | None) -> str:
    if b is None:
        return "n/a"
    lower, middle, upper, bw, pb = b
    return "lower=%.2f mid=%.2f upper=%.2f bw=%.4f pb=%.2f" % (
        lower, middle, upper, bw, pb
    )


def format_decision_line(d: dict) -> str:
    parts = [d["symbol"], d["action"]]
    if d["score"] is not None:
        parts.append("score=%+.1f" % d["score"])
    if d["qty"] is not None and d["limit_price"] is not None:
        parts.append("qty=%s limit=$%.4f" % (str(d["qty"]), d["limit_price"]))
    if d.get("net_rr") is not None:
        parts.append("net_rr=%.2f" % d["net_rr"])
    if d["ask"]:
        parts.append("ask=$%.4f" % d["ask"])
    if d["reason"]:
        parts.append("(" + d["reason"] + ")")
    return " ".join(parts)


def format_indicator_block(d: dict) -> str:
    """Multi-line indicator readout for the journal."""
    out = []
    score_str = ("%+.1f" % d["score"]) if d["score"] is not None else "n/a"
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
        out.append("    atr     : %.4f  stop_%.1fx=%.4f" % (
            d["atr"], ATR_MULTIPLIER, d["atr"] * ATR_MULTIPLIER
        ))
    if d.get("adx") is not None:
        out.append("    adx     : %.1f (%s)" % (d["adx"], ind.adx_label(d["adx"])))
    if d.get("obv_trend"):
        out.append("    obv     : %s" % d["obv_trend"])
    out.append("    4h      : %s" % (d.get("regime_4h") or "n/a"))
    if d.get("daily_ma20") is not None and d.get("daily_ma50") is not None:
        out.append(
            "    daily   : ma20=%.4f ma50=%.4f last=%.4f regime=%s"
            % (d["daily_ma20"], d["daily_ma50"], d["daily_last"], d["daily_regime"])
        )
    elif d.get("daily_regime"):
        out.append("    daily   : regime=" + str(d["daily_regime"]))
    breakdown = d.get("indicator_breakdown") or {}
    if breakdown:
        out.append("    signals :")
        for k, v in breakdown.items():
            out.append("      %-12s %s" % (k + ":", v))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

def append_journal_block(
    timestamp: datetime, decisions: list, executed: list, warnings: list | None = None
) -> Path:
    JOURNAL_DIR.mkdir(exist_ok=True)
    today = timestamp.strftime("%Y-%m-%d")
    hhmm  = timestamp.strftime("%H:%M")
    path  = JOURNAL_DIR / (today + ".md")

    lines = ["", "## Evaluation " + hhmm + " GMT+2", ""]
    for w in (warnings or []):
        lines.append("**WARNING: " + w + "**")
    if warnings:
        lines.append("")
    if not decisions:
        lines.append("No symbols evaluated.")
    for d in decisions:
        lines.append("- " + format_decision_line(d))
        if d.get("data_quality_warning"):
            lines.append("    DATA-QUALITY WARNING: " + d["data_quality_warning"])
        if d["score"] is not None:
            lines.append(format_indicator_block(d))

    if executed:
        lines.append("")
        lines.append("### Orders submitted")
        for r in executed:
            lines.append(
                "- %s %s -> %s" % (r["symbol"], r["action"], str(r["result"])[:300])
            )
    else:
        lines.append("")
        lines.append("### No orders submitted")

    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--execute", action="store_true",
        help="actually place orders (default is dry-run)",
    )
    args = parser.parse_args()

    print("Starting evaluation...")
    if STOP_LOSS_MODE == "swing_low_4h":
        stop_desc = "stop=4H swing low (fallback %.0f%%)" % (STOP_LOSS_PCT * 100)
    else:
        stop_desc = "stop=%.0f%%" % (STOP_LOSS_PCT * 100)
    print(
        "  thresholds: buy=%.1f  half=%.1f  downtrend_long=%.1f  sell=%.1f  "
        "short=%.1f  short_half=%.1f  cover=%.1f  %s"
        % (
            BUY_SCORE_THRESHOLD, BUY_SCORE_HALF_SIZE, DOWNTREND_LONG_SCORE,
            SELL_SCORE_THRESHOLD, SHORT_SCORE_THRESHOLD, SHORT_SCORE_HALF_SIZE,
            COVER_SCORE_THRESHOLD, stop_desc,
        )
    )

    # ── Load persistent position state ──────────────────────────────────────
    state = ps.load_state()

    symbols = [s for s in _CFG.get("watchlist", {}).get("symbols", []) if is_crypto(s)]
    # Universe scout: merge auto-promoted uptrending symbols (config > scout).
    # Promoted symbols pass through every existing gate unchanged (score gate,
    # regime, correlation budget, default 5% cap, ATR sizing, swing-low stops).
    if _CFG.get("scout", {}).get("enabled", False):
        try:
            import scout
            extra = [x for x in scout.promoted_symbols(refresh=True)
                     if is_crypto(x) and x not in symbols]
            if extra:
                print("Scout promoted: " + ", ".join(extra))
                symbols += extra
        except Exception as e:
            print("Scout skipped: %r" % e)
    if not symbols:
        sys.stderr.write("FAIL: no crypto symbols in config.json > watchlist.symbols\n")
        return 1

    try:
        positions = get_positions()
    except Exception as e:
        sys.stderr.write("FAIL: positions fetch: " + repr(e) + "\n")
        return 1

    try:
        account = get_account()
        equity  = float(account.get("equity") or 0)
    except Exception as e:
        sys.stderr.write("FAIL: account fetch: " + repr(e) + "\n")
        return 1

    # ── Daily drawdown gate ───────────────────────────────────────────────────
    state = ps.check_and_refresh_day_open(state, equity)
    day_equity = state.get("day_open_equity") or equity
    if daily_drawdown_gate_triggered(day_equity, equity):
        ps.activate_capital_preservation(state)
        print(
            "WARNING: daily drawdown gate triggered "
            "(day_open=$%.2f current=$%.2f) — capital preservation mode ON"
            % (day_equity, equity)
        )
    elif ps.is_capital_preservation_mode(state):
        print("INFO: capital preservation mode is active (set earlier today)")

    # Alpaca returns crypto symbols without a slash (e.g. "BTCUSD") in the
    # positions response.  Index both forms so holds are found regardless
    # of which the API returns on a given day (canonical form: symbols.to_slash).
    pos_by_symbol: dict = {}
    for p in positions:
        raw = p.get("symbol", "")
        pos_by_symbol[raw]          = p   # keep no-slash form too
        pos_by_symbol[to_slash(raw)] = p  # canonical slash form for lookups

    # Build the list of open symbols (slash form) for the correlation budget.
    open_symbols = [to_slash(p.get("symbol", "")) for p in positions]

    # Over-budget reconciliation (roadmap 2026-07-09 item 3): the budget only
    # gates NEW entries, so scout promotions / older entries can leave the book
    # permanently over budget with no visibility (5/4 seen live 2026-07-08).
    journal_warnings: list = []
    if len(open_symbols) > MAX_OPEN_POSITIONS:
        msg = ("BUDGET EXCEEDED %d/%d positions open — the correlation budget "
               "only gates new entries%s"
               % (len(open_symbols), MAX_OPEN_POSITIONS,
                  "; weakest overflow position will be trimmed"
                  if ENFORCE_BUDGET_ON_OPEN_POSITIONS else ""))
        print("WARNING: " + msg)
        journal_warnings.append(msg)

    # ── Evaluate all symbols ──────────────────────────────────────────────────
    decisions = []
    for sym in symbols:
        decisions.append(evaluate_symbol(sym, pos_by_symbol, state, open_symbols))

    # Position rotation at the correlation budget (roadmap item 2).
    rotation_note = apply_rotation(decisions, pos_by_symbol, open_symbols)
    if rotation_note:
        print("INFO: " + rotation_note)
        journal_warnings.append(rotation_note)

    # Optional over-budget trim (item 3, config-flagged): sell the weakest-
    # scoring overflow position so the book converges back to the budget.
    overflow = len(open_symbols) - MAX_OPEN_POSITIONS
    if ENFORCE_BUDGET_ON_OPEN_POSITIONS and overflow > 0:
        helds = [d for d in decisions
                 if d["action"] == "HOLD" and d.get("score") is not None
                 and d["symbol"] in pos_by_symbol
                 and float(pos_by_symbol[d["symbol"]].get("qty") or 0) > 0]
        helds.sort(key=lambda d: d["score"])
        for d in helds[:overflow]:
            qty_held = float(pos_by_symbol[d["symbol"]].get("qty") or 0)
            ask = d.get("ask") or 0
            if qty_held <= 0 or ask <= 0:
                continue
            d["action"]      = "SELL"
            d["qty"]         = qty_held
            d["limit_price"] = round(ask * (1 - LIMIT_BAND_PCT * 0.5), 4)
            d["reason"] = ("BUDGET TRIM: weakest overflow position "
                           "(score=%.1f), book %d/%d over budget"
                           % (d["score"], len(open_symbols), MAX_OPEN_POSITIONS))
            journal_warnings.append("BUDGET TRIM: selling %s (score %.1f)"
                                    % (d["symbol"], d["score"]))

    # ── Update high-water marks for held long positions ───────────────────────
    for d in decisions:
        if d["action"] == "HOLD":
            pos = pos_by_symbol.get(d["symbol"])
            if pos and float(pos.get("qty") or 0) > 0:
                cur = d.get("current_price") or 0
                if cur > 0:
                    ps.update_high_water_mark(state, d["symbol"], cur)

    print("\nEvaluation results:")
    for d in decisions:
        print("  " + format_decision_line(d))

    actionable = [
        d for d in decisions
        if d["action"] in ("BUY", "SELL", "SHORT", "COVER") and d["qty"] and d["limit_price"]
    ]
    # Exits before entries so a rotation SELL frees cash/budget for its BUY.
    actionable.sort(key=lambda d: 0 if d["action"] in ("SELL", "COVER") else 1)

    executed: list = []
    if args.execute and actionable:
        print("\nPlacing orders:")
        for d in actionable:
            # BUY   = open long   → side "buy"
            # SELL  = close long  → side "sell"
            # SHORT = open short  → side "sell"  (Alpaca shorts when no position held)
            # COVER = close short → side "buy"
            side         = "buy" if d["action"] in ("BUY", "COVER") else "sell"
            is_stop_loss = d.get("is_stop_loss", False)
            try:
                result = place_order(
                    d["symbol"], d["qty"], side, d["limit_price"],
                    is_stop_loss=is_stop_loss,
                )
                order_id = result.get("id", "")
                print("  OK       %s %s %s @ $%.4f  id=%s"
                      % (d["symbol"], side, str(d["qty"]), d["limit_price"], order_id[:8]))

                # Update position state based on what we just submitted.
                if d["action"] == "BUY":
                    # New long opened: initialise tracking.
                    ps.init_position(state, d["symbol"], d["limit_price"])
                elif d["action"] == "SHORT":
                    # New short opened: initialise tracking.
                    ps.init_position(state, d["symbol"], d["limit_price"])
                elif d["action"] in ("SELL", "COVER") and is_stop_loss:
                    # Stop-loss order submitted (may not have filled yet): record it.
                    if order_id:
                        ps.set_stop_order(state, d["symbol"], order_id, d["limit_price"])
                elif d["action"] == "SELL" and d.get("is_partial_tp"):
                    # +1R scale-out: keep the position tracked; raise the
                    # remaining stop to breakeven (roadmap item 4).
                    ps.mark_partial_tp(state, d["symbol"],
                                       d.get("entry_price") or d["limit_price"])
                elif d["action"] in ("SELL", "COVER") and not is_stop_loss:
                    # TA-driven exit: assume fills at market; clear state.
                    ps.clear_position(state, d["symbol"])

                executed.append({"symbol": d["symbol"], "action": d["action"], "result": result})
            except TradeRejected as e:
                print("  REJECTED %s: %s" % (d["symbol"], str(e)))
                executed.append({
                    "symbol": d["symbol"], "action": d["action"],
                    "result": {"rejected": str(e)},
                })
            except Exception as e:
                print("  ERROR    %s: %r" % (d["symbol"], e))
                executed.append({
                    "symbol": d["symbol"], "action": d["action"],
                    "result": {"error": repr(e)},
                })
    elif actionable:
        print("\nDry-run: %d order(s) would be placed." % len(actionable))
        print("Re-run with --execute to actually submit them.")
    else:
        print("\nNo actionable decisions.")

    # ── Persist state ─────────────────────────────────────────────────────────
    ps.save_state(state)

    journal_path = append_journal_block(
        datetime.now(ZoneInfo("Europe/Amsterdam")), decisions, executed,
        warnings=journal_warnings,
    )
    print("\nWrote: " + str(journal_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
