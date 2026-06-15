# tests/test_risk.py
"""
Unit tests for scripts/risk.py.

No network calls — all tests operate on pure functions.
"""
import pytest

import risk


# ---------------------------------------------------------------------------
# max_position_dollars
# ---------------------------------------------------------------------------

class TestMaxPositionDollars:
    def test_default_cap(self):
        result = risk.max_position_dollars(100_000)
        assert result == pytest.approx(100_000 * risk.MAX_POSITION_PCT)

    def test_btc_cap(self):
        assert risk.max_position_dollars(100_000, 0.30) == pytest.approx(30_000)

    def test_ada_cap(self):
        assert risk.max_position_dollars(100_000, 0.10) == pytest.approx(10_000)

    def test_zero_equity(self):
        assert risk.max_position_dollars(0) == 0.0

    def test_fractional_equity(self):
        assert risk.max_position_dollars(500.0, 0.05) == pytest.approx(25.0)


# ---------------------------------------------------------------------------
# check_position_size
# ---------------------------------------------------------------------------

class TestCheckPositionSize:
    # ── Passing cases ───────────────────────────────────────────────────────

    def test_passes_under_default_cap(self):
        # 20 shares × $250 = $5,000 = 5% of $100,000
        check = risk.check_position_size(100_000, 20, 250, 0.05)
        assert check.ok

    def test_passes_at_btc_cap(self):
        # 0.375 BTC × $80,000 = $30,000 = 30% of $100,000
        check = risk.check_position_size(100_000, 0.375, 80_000, 0.30)
        assert check.ok

    def test_passes_at_ada_cap(self):
        # 10 ADA × $1,000 = $10,000 = 10% of $100,000
        check = risk.check_position_size(100_000, 10, 1_000, 0.10)
        assert check.ok

    # ── Failing cases ───────────────────────────────────────────────────────

    def test_fails_over_default_cap(self):
        # 21 shares × $250 = $5,250 > 5% cap
        check = risk.check_position_size(100_000, 21, 250, 0.05)
        assert not check.ok
        assert "reason" in check.reason.lower() or "cap" in check.reason.lower()

    def test_fails_over_btc_cap(self):
        # 0.376 × $80,000 = $30,080 > $30,000 cap
        check = risk.check_position_size(100_000, 0.376, 80_000, 0.30)
        assert not check.ok

    def test_fails_over_ada_cap(self):
        check = risk.check_position_size(100_000, 11, 1_000, 0.10)
        assert not check.ok

    def test_fails_on_zero_equity(self):
        check = risk.check_position_size(0, 10, 100, 0.05)
        assert not check.ok
        assert "equity" in check.reason.lower()

    def test_fails_on_negative_equity(self):
        check = risk.check_position_size(-1_000, 10, 100, 0.05)
        assert not check.ok

    def test_fails_on_zero_qty(self):
        check = risk.check_position_size(100_000, 0, 100, 0.05)
        assert not check.ok
        assert "qty" in check.reason.lower()

    def test_fails_on_zero_price(self):
        check = risk.check_position_size(100_000, 10, 0, 0.05)
        assert not check.ok
        assert "price" in check.reason.lower()


# ---------------------------------------------------------------------------
# check_limit_band
# ---------------------------------------------------------------------------

class TestCheckLimitBand:
    def test_passes_exact_ask(self):
        assert risk.check_limit_band(100.0, 100.0).ok

    def test_passes_just_inside_band(self):
        # band = 100 × 0.002 = 0.20; 100.19 is within 0.20
        assert risk.check_limit_band(100.19, 100.0).ok
        assert risk.check_limit_band(99.81, 100.0).ok

    def test_fails_just_outside_band(self):
        # 100.5 is 0.50 away from 100.0 → outside 0.20 band
        assert not risk.check_limit_band(100.5, 100.0).ok

    def test_fails_on_zero_ask(self):
        assert not risk.check_limit_band(100.0, 0.0).ok

    def test_fails_on_zero_limit(self):
        assert not risk.check_limit_band(0.0, 100.0).ok

    def test_passes_below_ask(self):
        # Limit slightly below ask — still within band
        assert risk.check_limit_band(99.9, 100.0).ok

    def test_fails_far_below_ask(self):
        assert not risk.check_limit_band(95.0, 100.0).ok

    def test_band_scales_with_ask(self):
        # For BTC at ~$90,000, band is ±$180
        ask   = 90_000.0
        limit = 90_000.0 * (1 + risk.LIMIT_BAND_PCT * 0.99)  # just inside
        assert risk.check_limit_band(limit, ask).ok
        limit_out = 90_000.0 * (1 + risk.LIMIT_BAND_PCT * 1.01)  # just outside
        assert not risk.check_limit_band(limit_out, ask).ok


# ---------------------------------------------------------------------------
# should_stop_out
# ---------------------------------------------------------------------------

class TestShouldStopOut:
    def test_not_triggered_above_threshold(self):
        # 4% drawdown — below the 5% stop
        assert not risk.should_stop_out(100.0, 96.0)

    def test_triggered_at_threshold(self):
        # Exactly 5% drawdown
        assert risk.should_stop_out(100.0, 95.0)

    def test_triggered_below_threshold(self):
        assert risk.should_stop_out(100.0, 90.0)
        assert risk.should_stop_out(100.0, 50.0)

    def test_not_triggered_on_gain(self):
        # Price is above entry — never stop out on profit
        assert not risk.should_stop_out(100.0, 110.0)

    def test_zero_entry_price_is_safe(self):
        # Guard against division by zero
        assert not risk.should_stop_out(0.0, 50.0)

    def test_crypto_fractional_prices(self):
        # BTC-like prices
        assert risk.should_stop_out(90_000.0, 85_000.0)   # ~5.6% drawdown
        assert not risk.should_stop_out(90_000.0, 86_000.0)  # ~4.4% drawdown


# ---------------------------------------------------------------------------
# stop_loss_price
# ---------------------------------------------------------------------------

class TestStopLossPrice:
    def test_basic_calculation(self):
        expected = 100.0 * (1 - risk.STOP_LOSS_PCT)
        assert risk.stop_loss_price(100.0) == pytest.approx(expected)

    def test_matches_should_stop_out(self):
        entry = 50_000.0
        sl    = risk.stop_loss_price(entry)
        # Price at the stop should trigger stop-out.
        assert risk.should_stop_out(entry, sl)
        # Price one cent above should not.
        assert not risk.should_stop_out(entry, sl + 0.01)

    def test_btc_stop_price(self):
        entry = 90_000.0
        sl    = risk.stop_loss_price(entry)
        assert sl == pytest.approx(90_000.0 * (1 - risk.STOP_LOSS_PCT))


# ---------------------------------------------------------------------------
# RiskCheck dataclass
# ---------------------------------------------------------------------------

class TestRiskCheck:
    def test_ok_is_immutable(self):
        check = risk.RiskCheck(ok=True, reason="size ok")
        with pytest.raises((AttributeError, TypeError)):
            check.ok = False  # type: ignore[misc]

    def test_fields_accessible(self):
        check = risk.RiskCheck(ok=False, reason="test reason")
        assert check.ok is False
        assert check.reason == "test reason"
