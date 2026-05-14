# scripts/indicators.py
"""
Pure-function technical indicators. No network, no Alpaca-specific code:
takes lists of OHLCV data (oldest -> newest) and returns numbers and
small tuples.

Used by run_evaluation.py to score each symbol's bullish/bearish stance per
the trading skill's 6-point Signal Confluence Table.

Conventions:
  - All inputs are oldest-first lists of floats.
  - All "current" values are the most recent (values[-1]).
  - Functions return None when there is not enough history rather than raising.
"""

from __future__ import annotations
from typing import List, Optional, Tuple


# ---------- moving averages ------------------------------------------------

def sma(values, window):
    """Simple moving average over the last `window` values."""
    if len(values) < window:
        return None
    return sum(values[-window:]) / float(window)


def ema_series(values, period):
    """
    Full EMA series, seeded with the SMA of the first `period` values.
    Returned series is len(values) - period + 1 long.
    """
    if len(values) < period:
        return []
    k = 2.0 / (period + 1)
    seed = sum(values[:period]) / float(period)
    out = [seed]
    for v in values[period:]:
        out.append(out[-1] * (1 - k) + v * k)
    return out


def ema(values, period):
    s = ema_series(values, period)
    return s[-1] if s else None


def ema_cross_state(closes, fast=20, slow=50):
    """
    Returns 'golden' if fast EMA > slow EMA (bullish uptrend),
    'death' if fast EMA < slow EMA (bearish downtrend), or 'neutral'.
    Used as the 20 EMA > 50 EMA confluence point from the trading skill.
    """
    if len(closes) < slow + 1:
        return None
    f = ema(closes, fast)
    s = ema(closes, slow)
    if f is None or s is None:
        return None
    if f > s * 1.0005:
        return "golden"
    if f < s * 0.9995:
        return "death"
    return "neutral"


# ---------- ATR (Average True Range) --------------------------------------

def atr(highs, lows, closes, period=14):
    """
    Wilder's Average True Range. Measures volatility — used for ATR-based
    stop sizing (entry ± 1.5–2× ATR per the trading skill).
    Returns the current ATR value or None if insufficient data.
    """
    if len(closes) < period + 1 or len(highs) != len(closes) or len(lows) != len(closes):
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    # Wilder's smoothing
    avg = sum(trs[:period]) / period
    for tr in trs[period:]:
        avg = (avg * (period - 1) + tr) / period
    return avg


# ---------- RSI ------------------------------------------------------------

def rsi(values, period=14):
    """
    Wilder's RSI. Returns the most recent RSI value (0..100) or None.
    """
    if len(values) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(values)):
        d = values[i] - values[i - 1]
        gains.append(d if d > 0 else 0.0)
        losses.append(-d if d < 0 else 0.0)
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def rsi_rising(values, period=14, lookback=3):
    """
    True if the RSI has been rising over the last `lookback` bars.
    Checks whether RSI(now) > RSI(lookback bars ago).
    """
    if len(values) < period + 1 + lookback:
        return None
    r_now = rsi(values, period)
    r_prev = rsi(values[:-lookback], period)
    if r_now is None or r_prev is None:
        return None
    return r_now > r_prev


# ---------- MACD -----------------------------------------------------------

def _macd_components(values, fast=12, slow=26, signal=9):
    """
    Internal: build (macd_series, signal_series, hist_series) all aligned to
    the same length. Returns None if there isn't enough history.
    """
    if len(values) < slow + signal:
        return None
    fast_series = ema_series(values, fast)
    slow_series = ema_series(values, slow)
    if not fast_series or not slow_series:
        return None
    # fast_series starts at index fast-1, slow_series at index slow-1.
    # Align by trimming the leading (slow-fast) entries off fast_series.
    offset = slow - fast
    macd_series = [f - s for f, s in zip(fast_series[offset:], slow_series)]
    signal_series = ema_series(macd_series, signal)
    if not signal_series:
        return None
    # Align macd to signal length.
    macd_aligned = macd_series[-len(signal_series):]
    hist_series = [m - s for m, s in zip(macd_aligned, signal_series)]
    return (macd_aligned, signal_series, hist_series)


def macd(values, fast=12, slow=26, signal=9):
    """Most recent (macd_line, signal_line, histogram) or None."""
    c = _macd_components(values, fast, slow, signal)
    if c is None:
        return None
    macd_s, sig_s, hist_s = c
    return (macd_s[-1], sig_s[-1], hist_s[-1])


def macd_flip(values, fast=12, slow=26, signal=9):
    """
    Detect a histogram sign change between the previous bar and the current
    bar. Returns 'bullish' if hist crossed up through 0, 'bearish' if down,
    None otherwise (or insufficient data).
    """
    c = _macd_components(values, fast, slow, signal)
    if c is None:
        return None
    _, _, hist_s = c
    if len(hist_s) < 2:
        return None
    prev, curr = hist_s[-2], hist_s[-1]
    if prev <= 0 < curr:
        return "bullish"
    if prev >= 0 > curr:
        return "bearish"
    return None


def macd_hist_rising(values, fast=12, slow=26, signal=9, lookback=2):
    """True if the MACD histogram has been rising for `lookback` bars."""
    c = _macd_components(values, fast, slow, signal)
    if c is None:
        return None
    _, _, hist_s = c
    if len(hist_s) < lookback + 1:
        return None
    return all(hist_s[-(lookback - i)] > hist_s[-(lookback - i + 1)]
               for i in range(lookback))


# ---------- Bollinger Bands ------------------------------------------------

def bollinger(values, period=20, num_std=2.0):
    """
    Most recent (lower, middle, upper, bandwidth, percent_b) or None.
      bandwidth = (upper - lower) / middle  -- relative band width
      percent_b = (last - lower) / (upper - lower)  -- 0=at lower, 1=at upper
    """
    if len(values) < period:
        return None
    window = values[-period:]
    middle = sum(window) / period
    var = sum((x - middle) ** 2 for x in window) / period
    sd = var ** 0.5
    upper = middle + num_std * sd
    lower = middle - num_std * sd
    bandwidth = (upper - lower) / middle if middle else 0.0
    last = values[-1]
    if upper == lower:
        pb = 0.5
    else:
        pb = (last - lower) / (upper - lower)
    return (lower, middle, upper, bandwidth, pb)


def _bandwidth_at(values, end_idx, period=20):
    if end_idx < period:
        return None
    w = values[end_idx - period:end_idx]
    m = sum(w) / period
    sd = (sum((x - m) ** 2 for x in w) / period) ** 0.5
    return (2 * sd) / m if m else 0.0


def bollinger_trend(values, period=20, lookback=10):
    """
    Compare current bandwidth to bandwidth `lookback` bars ago.
    Returns 'widening', 'tightening', or None.
    """
    if len(values) < period + lookback:
        return None
    cur = _bandwidth_at(values, len(values), period)
    prev = _bandwidth_at(values, len(values) - lookback, period)
    if cur is None or prev is None:
        return None
    if cur > prev * 1.05:
        return "widening"
    if cur < prev * 0.95:
        return "tightening"
    return "stable"


def bollinger_squeeze(values, period=20, lookback=60, percentile=20):
    """
    True if current bandwidth sits in the bottom `percentile` of the last
    `lookback` bars -- i.e. the bands are tight by historical standards.
    """
    if len(values) < period + lookback:
        return None
    bws = []
    for end in range(len(values) - lookback, len(values) + 1):
        bw = _bandwidth_at(values, end, period)
        if bw is not None:
            bws.append(bw)
    if len(bws) < 5:
        return None
    cur = bws[-1]
    sorted_bws = sorted(bws)
    threshold = sorted_bws[max(0, int(len(sorted_bws) * percentile / 100.0) - 1)]
    return cur <= threshold


# ---------- Volume ---------------------------------------------------------

def volume_ratio(volumes, period=20):
    """
    Returns current volume / average of the previous `period` bars.
    > 1.0 means above-average volume on the current bar (a positive signal).
    Returns None if insufficient data.
    """
    if len(volumes) < period + 1:
        return None
    avg = sum(volumes[-(period + 1):-1]) / float(period)
    if avg == 0:
        return None
    return volumes[-1] / avg


# ---------- 6-Point Confluence Score (per trading skill) ------------------

def signal_score(closes, volumes=None, highs=None, lows=None, closes_4h=None):
    """
    6-point Signal Confluence Table from the trading skill's Quick Reference.

    Each of the 6 conditions is worth 1 point (bullish) or -1 point (bearish).
    Net score range: -6 to +6.

    Confluence table:
      1. EMA cross: 20 EMA vs 50 EMA  (+1 golden / -1 death)
      2. MACD: histogram green & rising  (+1 / -1)
      3. RSI: 40-65 rising for longs, <30 oversold  (+1 / -1)
      4. Bollinger Bands: %b near lower band (mean-reversion long)  (+1 / -1)
      5. Volume: current bar above 20-period average  (+1 / -1)
      6. Higher-timeframe trend: 4H EMA cross alignment  (+1 / -1 / 0 if no data)

    Trading skill thresholds:
      score >= 4 → BUY with standard size
      score == 3 → BUY with half size (if R:R >= 1:3)
      score <= 2 → PASS / HOLD

    Returns (score, breakdown_dict).
    The breakdown dict keys are: ema_cross, macd, rsi, bb, volume, regime_4h.
    """
    score = 0.0
    parts = {}

    # ── 1. EMA Cross (20 vs 50 on execution timeframe) ──────────────────
    cross = ema_cross_state(closes, fast=20, slow=50)
    if cross is None:
        parts["ema_cross"] = "n/a (need %d bars)" % 51
    elif cross == "golden":
        score += 1
        parts["ema_cross"] = "GOLDEN (20>50, +1)"
    elif cross == "death":
        score -= 1
        parts["ema_cross"] = "DEATH (20<50, -1)"
    else:
        parts["ema_cross"] = "neutral (0)"

    # ── 2. MACD histogram green and rising ──────────────────────────────
    m = macd(closes)
    flip = macd_flip(closes)
    rising = macd_hist_rising(closes)
    if m is None:
        parts["macd"] = "n/a"
    else:
        macd_line, signal_line, hist = m
        if hist > 0 and rising:
            score += 1
            label = "BULLISH FLIP " if flip == "bullish" else ""
            parts["macd"] = "hist=%.4f %sgreen+rising (+1)" % (hist, label)
        elif hist < 0 and rising is False:
            score -= 1
            label = "BEARISH FLIP " if flip == "bearish" else ""
            parts["macd"] = "hist=%.4f %sred+falling (-1)" % (hist, label)
        elif hist > 0:
            score += 0.5
            parts["macd"] = "hist=%.4f green but not rising (+0.5)" % hist
        elif hist < 0:
            score -= 0.5
            parts["macd"] = "hist=%.4f red but not falling (-0.5)" % hist
        else:
            parts["macd"] = "hist=%.4f (flat)" % hist

    # ── 3. RSI ──────────────────────────────────────────────────────────
    r = rsi(closes)
    r_rise = rsi_rising(closes)
    if r is None:
        parts["rsi"] = "n/a"
    else:
        if r < 30:
            score += 1
            parts["rsi"] = "%.1f oversold (<30, +1)" % r
        elif r > 70:
            score -= 1
            parts["rsi"] = "%.1f overbought (>70, -1)" % r
        elif 40 <= r <= 65 and r_rise:
            score += 1
            parts["rsi"] = "%.1f in 40-65 and rising (+1)" % r
        elif r < 40 and r_rise is False:
            score -= 0.5
            parts["rsi"] = "%.1f weak and falling (-0.5)" % r
        else:
            parts["rsi"] = "%.1f neutral (0)" % r

    # ── 4. Bollinger Bands (%b position) ────────────────────────────────
    b = bollinger(closes)
    bb_trend = bollinger_trend(closes)
    bb_sq = bollinger_squeeze(closes)
    if b is None:
        parts["bb"] = "n/a"
    else:
        lower, middle, upper, bw, pb = b
        sq_tag = " SQUEEZE" if bb_sq else ""
        if pb < 0.25:
            score += 1
            parts["bb"] = ("%%b=%.2f near lower band (+1) trend=%s%s") % (pb, bb_trend, sq_tag)
        elif pb > 0.75:
            score -= 1
            parts["bb"] = ("%%b=%.2f near upper band (-1) trend=%s%s") % (pb, bb_trend, sq_tag)
        else:
            parts["bb"] = ("%%b=%.2f mid-band (0) trend=%s%s") % (pb, bb_trend, sq_tag)

    # ── 5. Volume ────────────────────────────────────────────────────────
    if volumes is not None and len(volumes) >= 21:
        vr = volume_ratio(volumes)
        if vr is None:
            parts["volume"] = "n/a"
        elif vr >= 1.2:
            score += 1
            parts["volume"] = "%.2fx avg (above avg, +1)" % vr
        elif vr < 0.7:
            score -= 0.5
            parts["volume"] = "%.2fx avg (thin, -0.5)" % vr
        else:
            parts["volume"] = "%.2fx avg (0)" % vr
    else:
        parts["volume"] = "n/a (no volume data)"

    # ── 6. 4H Higher-Timeframe Regime ────────────────────────────────────
    if closes_4h is not None and len(closes_4h) >= 51:
        cross_4h = ema_cross_state(closes_4h, fast=20, slow=50)
        if cross_4h == "golden":
            score += 1
            parts["regime_4h"] = "4H golden cross (uptrend, +1)"
        elif cross_4h == "death":
            score -= 1
            parts["regime_4h"] = "4H death cross (downtrend, -1)"
        else:
            parts["regime_4h"] = "4H neutral (0)"
    else:
        parts["regime_4h"] = "n/a (no 4H data)"

    return score, parts


# ---------- self-tests -----------------------------------------------------

if __name__ == "__main__":
    import math
    n = 120
    closes = [100 + 10 * math.sin(i / 6.0) + i * 0.3 for i in range(n)]
    highs  = [c + abs(math.sin(i)) * 2 for i, c in enumerate(closes)]
    lows   = [c - abs(math.cos(i)) * 2 for i, c in enumerate(closes)]
    volumes = [1000 + 500 * abs(math.sin(i / 3.0)) for i in range(n)]

    r = rsi(closes)
    assert r is not None and 0 <= r <= 100, "rsi out of range: %r" % r

    m = macd(closes)
    assert m is not None, "macd None"
    macd_line, sig, hist = m

    b = bollinger(closes)
    assert b is not None, "bb None"
    lower, middle, upper, bw, pb = b
    assert lower < middle < upper

    a = atr(highs, lows, closes)
    assert a is not None and a > 0, "atr failed: %r" % a

    vr = volume_ratio(volumes)
    assert vr is not None, "volume_ratio failed"

    cross = ema_cross_state(closes)
    assert cross in ("golden", "death", "neutral"), "ema_cross_state: %r" % cross

    score, parts = signal_score(closes, volumes=volumes, highs=highs, lows=lows)
    print("indicators.py: self-checks passed")
    print("  rsi         =", round(r, 2))
    print("  macd        = line=%.4f signal=%.4f hist=%.4f" % (macd_line, sig, hist))
    print("  bb          = lower=%.2f middle=%.2f upper=%.2f pb=%.2f" % (lower, middle, upper, pb))
    print("  atr         =", round(a, 4))
    print("  volume_ratio=", round(vr, 2))
    print("  ema_cross   =", cross)
    print("  score       =", score)
    for k, v in parts.items():
        print("    %-12s: %s" % (k + ":", v))
