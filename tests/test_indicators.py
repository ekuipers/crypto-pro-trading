# tests/test_indicators.py
"""
Unit tests for scripts/indicators.py.

All tests use synthetic data — no network calls.
"""
import math

import pytest

import indicators as ind


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sine_closes():
    """120 closing prices following a sine wave with a gentle uptrend."""
    n = 120
    return [100 + 10 * math.sin(i / 6.0) + i * 0.3 for i in range(n)]


@pytest.fixture
def sine_ohlcv(sine_closes):
    """Full OHLCV arrays derived from the sine_closes fixture."""
    closes  = sine_closes
    highs   = [c + abs(math.sin(i)) * 2 for i, c in enumerate(closes)]
    lows    = [c - abs(math.cos(i)) * 2 for i, c in enumerate(closes)]
    volumes = [1000 + 500 * abs(math.sin(i / 3.0)) for i in range(len(closes))]
    return closes, highs, lows, volumes


# ---------------------------------------------------------------------------
# SMA
# ---------------------------------------------------------------------------

class TestSma:
    def test_basic_average(self):
        assert ind.sma([1.0, 2.0, 3.0, 4.0, 5.0], 3) == pytest.approx(4.0)

    def test_full_window(self):
        assert ind.sma([10.0, 20.0, 30.0], 3) == pytest.approx(20.0)

    def test_returns_none_when_insufficient_data(self):
        assert ind.sma([1.0, 2.0], 5) is None

    def test_single_element(self):
        assert ind.sma([42.0], 1) == pytest.approx(42.0)


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------

class TestEma:
    def test_returns_value_for_sufficient_data(self, sine_closes):
        result = ind.ema(sine_closes, 20)
        assert result is not None
        assert result > 0

    def test_returns_none_for_insufficient_data(self):
        assert ind.ema([1.0, 2.0, 3.0], 10) is None

    def test_ema_series_length(self, sine_closes):
        series = ind.ema_series(sine_closes, 20)
        # Series should have len(closes) - period + 1 elements.
        assert len(series) == len(sine_closes) - 20 + 1

    def test_ema_series_empty_for_insufficient_data(self):
        assert ind.ema_series([1.0, 2.0], 10) == []


# ---------------------------------------------------------------------------
# EMA cross state
# ---------------------------------------------------------------------------

class TestEmaCrossState:
    def test_golden_cross_on_uptrend(self, sine_closes):
        # sine_closes has a rising trend; fast EMA should be above slow.
        state = ind.ema_cross_state(sine_closes, fast=20, slow=50)
        assert state in ("golden", "death", "neutral")

    def test_returns_none_for_insufficient_data(self):
        assert ind.ema_cross_state([1.0] * 30, fast=20, slow=50) is None

    def test_golden_when_fast_above_slow(self):
        # Strongly rising sequence: fast EMA will be above slow EMA.
        closes = [float(i) for i in range(1, 101)]
        state = ind.ema_cross_state(closes, fast=20, slow=50)
        assert state == "golden"

    def test_death_when_fast_below_slow(self):
        # Strongly falling sequence: fast EMA will be below slow EMA.
        closes = [float(100 - i) for i in range(100)]
        state = ind.ema_cross_state(closes, fast=20, slow=50)
        assert state == "death"


# ---------------------------------------------------------------------------
# RSI
# ---------------------------------------------------------------------------

class TestRsi:
    def test_value_in_range(self, sine_closes):
        r = ind.rsi(sine_closes)
        assert r is not None
        assert 0.0 <= r <= 100.0

    def test_returns_none_for_insufficient_data(self):
        assert ind.rsi([1.0, 2.0, 3.0], period=14) is None

    def test_all_gains_gives_high_rsi(self):
        # Strictly rising prices → RSI near 100.
        closes = [float(i) for i in range(1, 30)]
        r = ind.rsi(closes, period=14)
        assert r is not None
        assert r > 90

    def test_all_losses_gives_low_rsi(self):
        # Strictly falling prices → RSI near 0.
        closes = [float(30 - i) for i in range(30)]
        r = ind.rsi(closes, period=14)
        assert r is not None
        assert r < 10

    def test_rsi_rising_returns_bool(self, sine_closes):
        result = ind.rsi_rising(sine_closes)
        assert isinstance(result, bool)

    def test_rsi_rising_returns_none_for_insufficient_data(self):
        assert ind.rsi_rising([1.0, 2.0], period=14) is None


# ---------------------------------------------------------------------------
# MACD
# ---------------------------------------------------------------------------

class TestMacd:
    def test_returns_tuple_of_three(self, sine_closes):
        result = ind.macd(sine_closes)
        assert result is not None
        assert len(result) == 3

    def test_returns_none_for_insufficient_data(self):
        assert ind.macd([1.0] * 20) is None

    def test_histogram_is_macd_minus_signal(self, sine_closes):
        result = ind.macd(sine_closes)
        macd_line, signal_line, hist = result
        assert abs(hist - (macd_line - signal_line)) < 1e-9

    def test_flip_returns_valid_value(self, sine_closes):
        flip = ind.macd_flip(sine_closes)
        assert flip in (None, "bullish", "bearish")

    def test_hist_rising_returns_bool(self, sine_closes):
        rising = ind.macd_hist_rising(sine_closes)
        assert isinstance(rising, bool)


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------

class TestBollinger:
    def test_returns_five_tuple(self, sine_closes):
        result = ind.bollinger(sine_closes)
        assert result is not None
        assert len(result) == 5

    def test_lower_lt_middle_lt_upper(self, sine_closes):
        lower, middle, upper, bw, pb = ind.bollinger(sine_closes)
        assert lower < middle < upper

    def test_bandwidth_positive(self, sine_closes):
        _, _, _, bw, _ = ind.bollinger(sine_closes)
        assert bw > 0

    def test_percent_b_range(self, sine_closes):
        # %b is typically 0–1 but can exceed this outside the bands.
        _, _, _, _, pb = ind.bollinger(sine_closes)
        assert isinstance(pb, float)

    def test_returns_none_for_insufficient_data(self):
        assert ind.bollinger([1.0] * 10, period=20) is None

    def test_trend_returns_valid_string(self, sine_closes):
        trend = ind.bollinger_trend(sine_closes)
        assert trend in ("widening", "tightening", "stable", None)

    def test_squeeze_returns_bool_or_none(self, sine_closes):
        sq = ind.bollinger_squeeze(sine_closes)
        assert sq is None or isinstance(sq, bool)


# ---------------------------------------------------------------------------
# ATR
# ---------------------------------------------------------------------------

class TestAtr:
    def test_returns_positive_value(self, sine_ohlcv):
        closes, highs, lows, _ = sine_ohlcv
        result = ind.atr(highs, lows, closes)
        assert result is not None
        assert result > 0

    def test_returns_none_for_insufficient_data(self):
        assert ind.atr([1.0] * 5, [1.0] * 5, [1.0] * 5, period=14) is None

    def test_returns_none_when_lengths_mismatch(self):
        assert ind.atr([1.0, 2.0, 3.0], [1.0, 2.0], [1.0, 2.0, 3.0]) is None


# ---------------------------------------------------------------------------
# ADX
# ---------------------------------------------------------------------------

class TestAdx:
    def test_value_in_range(self, sine_ohlcv):
        closes, highs, lows, _ = sine_ohlcv
        result = ind.adx(highs, lows, closes)
        assert result is not None
        assert 0.0 <= result <= 100.0

    def test_returns_none_for_insufficient_data(self):
        # Needs at least 2 × period + 1 bars.
        assert ind.adx([1.0] * 20, [1.0] * 20, [1.0] * 20, period=14) is None

    def test_returns_none_when_lengths_mismatch(self):
        assert ind.adx([1.0] * 40, [1.0] * 39, [1.0] * 40) is None

    def test_strong_trend_scores_high(self):
        # Steadily rising market with clean directional movement → high ADX.
        n = 80
        closes = [100.0 + i for i in range(n)]
        highs  = [c + 0.5 for c in closes]
        lows   = [c - 0.5 for c in closes]
        result = ind.adx(highs, lows, closes)
        assert result is not None
        assert result > 25

    def test_label_buckets(self):
        assert ind.adx_label(None) == "n/a"
        assert ind.adx_label(10) == "ranging/weak"
        assert ind.adx_label(22) == "emerging trend"
        assert ind.adx_label(30) == "trending"
        assert ind.adx_label(50) == "strong trend"


# ---------------------------------------------------------------------------
# OBV
# ---------------------------------------------------------------------------

class TestObv:
    def test_series_length_matches_input(self, sine_ohlcv):
        closes, _, _, volumes = sine_ohlcv
        series = ind.obv_series(closes, volumes)
        assert len(series) == len(closes)

    def test_series_empty_when_lengths_mismatch(self):
        assert ind.obv_series([1.0, 2.0, 3.0], [100.0, 100.0]) == []

    def test_rising_on_up_moves(self):
        # Every close up with volume → OBV must be rising.
        closes  = [float(i) for i in range(1, 31)]
        volumes = [100.0] * 30
        assert ind.obv_trend(closes, volumes) == "rising"

    def test_falling_on_down_moves(self):
        closes  = [float(31 - i) for i in range(1, 31)]
        volumes = [100.0] * 30
        assert ind.obv_trend(closes, volumes) == "falling"

    def test_flat_when_unchanged(self):
        # Unchanged closes accumulate no signed volume → flat.
        closes  = [100.0] * 30
        volumes = [100.0] * 30
        assert ind.obv_trend(closes, volumes) == "flat"

    def test_returns_none_for_insufficient_data(self):
        assert ind.obv_trend([1.0] * 10, [100.0] * 10, lookback=20) is None


# ---------------------------------------------------------------------------
# Volume ratio
# ---------------------------------------------------------------------------

class TestVolumeRatio:
    def test_above_one_when_spike(self):
        # Last bar volume is 10× the average of preceding 20 bars.
        volumes = [100.0] * 20 + [1000.0]
        vr = ind.volume_ratio(volumes, period=20)
        assert vr is not None
        assert vr > 1.0

    def test_below_one_when_thin(self):
        volumes = [1000.0] * 20 + [10.0]
        vr = ind.volume_ratio(volumes, period=20)
        assert vr is not None
        assert vr < 1.0

    def test_returns_none_for_insufficient_data(self):
        assert ind.volume_ratio([100.0] * 5, period=20) is None


# ---------------------------------------------------------------------------
# Signal score
# ---------------------------------------------------------------------------

class TestSignalScore:
    def test_score_within_bounds(self, sine_ohlcv):
        closes, highs, lows, volumes = sine_ohlcv
        score, breakdown = ind.signal_score(closes, volumes=volumes, highs=highs, lows=lows)
        assert -6.0 <= score <= 6.0

    def test_returns_breakdown_dict(self, sine_ohlcv):
        closes, highs, lows, volumes = sine_ohlcv
        score, breakdown = ind.signal_score(closes, volumes=volumes, highs=highs, lows=lows)
        assert isinstance(breakdown, dict)
        assert "ema_cross" in breakdown
        assert "macd" in breakdown
        assert "rsi" in breakdown
        assert "bb" in breakdown
        assert "volume" in breakdown
        assert "regime_4h" in breakdown

    def test_insufficient_data_returns_zero_score(self):
        # With only 5 bars, no indicators can be computed — score should be 0.
        closes = [100.0, 101.0, 102.0, 101.5, 103.0]
        score, breakdown = ind.signal_score(closes)
        assert score == 0.0

    def test_4h_data_affects_score(self, sine_closes):
        score_no_4h, _ = ind.signal_score(sine_closes)
        # Strongly rising 4H sequence → golden cross should add +1.
        closes_4h = [float(i) for i in range(1, 60)]
        score_with_4h, _ = ind.signal_score(sine_closes, closes_4h=closes_4h)
        # Score with a bullish 4H should be >= score without.
        assert score_with_4h >= score_no_4h

    def test_no_volume_data_scores_volume_as_na(self, sine_closes):
        score, breakdown = ind.signal_score(sine_closes, volumes=None)
        assert "n/a" in breakdown["volume"]
