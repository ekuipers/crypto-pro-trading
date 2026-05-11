# scripts/indicators.py
"""
Pure-function technical indicators. No network, no Alpaca-specific code:
takes a list of closing prices (oldest -> newest) and returns numbers and
small dataclass-ish tuples.

Used by run_evaluation.py to score each symbol's bullish/bearish stance per
the decision framework in CLAUDE.md (RSI, MACD, Bollinger Bands).

Conventions:
  - All inputs are oldest-first lists of floats.
  - All "current" values are the most recent (closes[-1]).
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


# ---------- Composite signal score ----------------------------------------

def signal_score(closes):
    """
    Aggregate bullish/bearish stance from RSI + MACD + Bollinger.
    Returns (score, breakdown_dict).

    Score range roughly -3..+3:
      +1 each: RSI oversold (<30), MACD bullish flip, %b near lower band (<0.2)
      -1 each: RSI overbought (>70), MACD bearish flip, %b near upper band (>0.8)
      Existing-trend tie-breakers add +/-0.5 if no flip but hist clearly above/below 0.

    The breakdown dict is suitable for journal logging.
    """
    score = 0.0
    parts = {}

    r = rsi(closes)
    if r is None:
        parts["rsi"] = "n/a"
    else:
        if r < 30:
            score += 1
            parts["rsi"] = "%.1f (oversold, +1)" % r
        elif r > 70:
            score -= 1
            parts["rsi"] = "%.1f (overbought, -1)" % r
        else:
            parts["rsi"] = "%.1f (neutral)" % r

    m = macd(closes)
    flip = macd_flip(closes)
    if m is None:
        parts["macd"] = "n/a"
    else:
        macd_line, signal_line, hist = m
        if flip == "bullish":
            score += 1
            parts["macd"] = "hist=%.4f BULLISH FLIP +1" % hist
        elif flip == "bearish":
            score -= 1
            parts["macd"] = "hist=%.4f BEARISH FLIP -1" % hist
        elif hist > 0:
            score += 0.5
            parts["macd"] = "hist=%.4f (above signal, +0.5)" % hist
        elif hist < 0:
            score -= 0.5
            parts["macd"] = "hist=%.4f (below signal, -0.5)" % hist
        else:
            parts["macd"] = "hist=%.4f" % hist

    b = bollinger(closes)
    bb_trend = bollinger_trend(closes)
    if b is None:
        parts["bb"] = "n/a"
    else:
        lower, middle, upper, bw, pb = b
        if pb < 0.2:
            score += 1
            parts["bb"] = "%%b=%.2f (near lower, +1) trend=%s" % (pb, bb_trend)
        elif pb > 0.8:
            score -= 1
            parts["bb"] = "%%b=%.2f (near upper, -1) trend=%s" % (pb, bb_trend)
        else:
            parts["bb"] = "%%b=%.2f trend=%s" % (pb, bb_trend)

    return score, parts


# ---------- self-tests -----------------------------------------------------

if __name__ == "__main__":
    # Use 80 bars: enough for slow EMA(26) + signal EMA(9) + Bollinger lookback.
    import math
    closes = [100 + 10 * math.sin(i / 6.0) + i * 0.3 for i in range(80)]

    r = rsi(closes)
    assert r is not None and 0 <= r <= 100, "rsi out of range: %r" % r

    m = macd(closes)
    assert m is not None, "macd None"
    macd_line, sig, hist = m
    assert isinstance(macd_line, float)

    b = bollinger(closes)
    assert b is not None, "bb None"
    lower, middle, upper, bw, pb = b
    assert lower < middle < upper

    bbtrend = bollinger_trend(closes)
    assert bbtrend in ("widening", "tightening", "stable"), bbtrend

    sq = bollinger_squeeze(closes)
    assert sq in (True, False), sq

    score, parts = signal_score(closes)
    print("indicators.py: self-checks passed")
    print("  rsi      =", round(r, 2))
    print("  macd     = line=%.4f signal=%.4f hist=%.4f" % (macd_line, sig, hist))
    print("  bb       = lower=%.2f middle=%.2f upper=%.2f bw=%.4f pb=%.2f" %
          (lower, middle, upper, bw, pb))
    print("  bb_trend =", bbtrend, "  squeeze =", sq)
    print("  score    =", score)
    print("  breakdown=", parts)
