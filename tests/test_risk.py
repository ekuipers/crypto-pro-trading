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


# ---------------------------------------------------------------------------
# Trade economics (roadmap 2026-07-09 item 1)
# ---------------------------------------------------------------------------

class TestTradeEconomics:
    def test_spread_pct(self):
        assert risk.spread_pct(99.9, 100.1) == pytest.approx(0.002)

    def test_spread_pct_invalid_quotes(self):
        assert risk.spread_pct(0, 100) == 0.0
        assert risk.spread_pct(101, 100) == 0.0   # crossed quote

    def test_round_trip_cost(self):
        # 2 x 25 bps + 0.2% spread = 0.7%
        rt = risk.round_trip_cost_pct(99.9, 100.1, fee_bps_per_side=25)
        assert rt == pytest.approx(0.007)

    def test_net_rr(self):
        # entry 100, stop 96 (risk 4), target 112 (reward 12), cost 0.6%
        nr = risk.net_rr(100, 96, 112, cost_pct=0.006)
        assert nr == pytest.approx((12 - 0.6) / 4)

    def test_net_rr_invalid_geometry(self):
        assert risk.net_rr(100, 104, 112) is None   # stop above entry
        assert risk.net_rr(100, 96, 99) is None     # target below entry
        assert risk.net_rr(100, None, 112) is None


# ---------------------------------------------------------------------------
# Partial take-profit ladder (roadmap 2026-07-09 item 4)
# ---------------------------------------------------------------------------

class TestPartialTakeProfit:
    def test_trigger_price(self):
        assert risk.partial_tp_trigger_price(100, 96, 1.0) == pytest.approx(104)

    def test_fires_at_one_r(self):
        assert risk.should_partial_tp(100, 104.1, 96, already_done=False, r_multiple=1.0)

    def test_below_trigger_holds(self):
        assert not risk.should_partial_tp(100, 103.9, 96, already_done=False, r_multiple=1.0)

    def test_never_fires_twice(self):
        assert not risk.should_partial_tp(100, 110, 96, already_done=True, r_multiple=1.0)

    def test_invalid_stop(self):
        assert risk.partial_tp_trigger_price(100, 104, 1.0) is None
        assert not risk.should_partial_tp(100, 110, 104, already_done=False)


# ---------------------------------------------------------------------------
# Stale-position exit (roadmap 2026-07-09 item 5)
# ---------------------------------------------------------------------------

class TestStalePosition:
    def _iso(self, hours_ago):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()

    def test_old_weak_unarmed_is_stale(self):
        assert risk.is_stale_position(self._iso(49), False, 1.0, 2.5, max_hold_hours=48)

    def test_young_position_not_stale(self):
        assert not risk.is_stale_position(self._iso(2), False, 1.0, 2.5, max_hold_hours=48)

    def test_armed_trailing_exempt(self):
        assert not risk.is_stale_position(self._iso(49), True, 1.0, 2.5, max_hold_hours=48)

    def test_strong_score_exempt(self):
        assert not risk.is_stale_position(self._iso(49), False, 3.0, 2.5, max_hold_hours=48)

    def test_missing_timestamp(self):
        assert not risk.is_stale_position(None, False, 1.0, 2.5, max_hold_hours=48)

    def test_disabled_via_zero_hours(self):
        assert not risk.is_stale_position(self._iso(999), False, 1.0, 2.5, max_hold_hours=0)


# ---------------------------------------------------------------------------
# Rotation at the correlation budget (roadmap 2026-07-09 item 2)
# ---------------------------------------------------------------------------

class TestRotationAllows:
    def test_live_scenario_2026_07_08(self):
        # UNI/USD +4.0 blocked while AAVE/USD held at -1.0 -> rotate.
        assert risk.rotation_allows(4.0, -1.0, min_score=4.0, margin=2.0)

    def test_candidate_below_min_score(self):
        assert not risk.rotation_allows(3.5, -1.0, min_score=4.0, margin=2.0)

    def test_holding_still_positive(self):
        assert not risk.rotation_allows(4.0, 0.5, min_score=4.0, margin=2.0)

    def test_margin_not_met(self):
        assert not risk.rotation_allows(4.0, 2.5, min_score=4.0, margin=2.0)

    def test_none_scores(self):
        assert not risk.rotation_allows(None, -1.0)
        assert not risk.rotation_allows(4.0, None)
