# tests/test_risk_roadmap.py
"""
Tests for the famous-trader package (roadmap 2026-07-10 items 1-6, 10):
chandelier trail, conviction sizing, streak throttle, measured-move target,
pyramiding triggers, breadth gate, and the maker-safe limit band.

All helpers are pure functions with explicit parameters (never asserted
against config-loaded defaults — see memory.md lessons).
"""
import risk


class TestChandelierTrail:
    def test_high_vol_widens_trail(self):
        # ATR 5 on price 100 with k=2.5 -> 12.5% > fixed 3%
        assert risk.chandelier_trail_pct(100, 5, k=2.5, fixed_pct=0.03) == 0.125

    def test_low_vol_keeps_fixed_floor(self):
        # ATR 0.5 on price 100 -> 1.25% < fixed 3% -> floor wins
        assert risk.chandelier_trail_pct(100, 0.5, k=2.5, fixed_pct=0.03) == 0.03

    def test_bad_inputs_fall_back_to_fixed(self):
        assert risk.chandelier_trail_pct(0, 5, fixed_pct=0.03) == 0.03
        assert risk.chandelier_trail_pct(100, None, fixed_pct=0.03) == 0.03
        assert risk.chandelier_trail_pct(100, 0, fixed_pct=0.03) == 0.03


class TestConvictionSizing:
    def test_half_band(self):
        assert risk.conviction_risk_multiplier(3.0, 2.5, 3.5, 5.0) == 0.75

    def test_full_band(self):
        assert risk.conviction_risk_multiplier(4.0, 2.5, 3.5, 5.0) == 1.0

    def test_high_conviction_needs_alignment(self):
        assert risk.conviction_risk_multiplier(5.5, 2.5, 3.5, 5.0,
                                               htf_aligned=True) == 1.5
        assert risk.conviction_risk_multiplier(5.5, 2.5, 3.5, 5.0,
                                               htf_aligned=False) == 1.0

    def test_none_score_neutral(self):
        assert risk.conviction_risk_multiplier(None, 2.5, 3.5) == 1.0


class TestStreakThrottle:
    def test_activates_after_three_losses(self):
        assert risk.update_streak_throttle(False, [10, -1, -2, -3], 0.0,
                                           losses=3, dd_on=0.05)

    def test_two_losses_not_enough(self):
        assert not risk.update_streak_throttle(False, [10, -1, -2], 0.0,
                                               losses=3, dd_on=0.05)

    def test_activates_on_drawdown(self):
        assert risk.update_streak_throttle(False, [10, 10], 0.06,
                                           losses=3, dd_on=0.05)

    def test_releases_after_two_winners_and_recovery(self):
        assert not risk.update_streak_throttle(True, [-1, -2, -3, 5, 6], 0.01,
                                               winners=2, dd_off=0.025)

    def test_stays_active_with_one_winner(self):
        assert risk.update_streak_throttle(True, [-1, -2, -3, 5], 0.01,
                                           winners=2, dd_off=0.025)

    def test_stays_active_while_drawdown_high(self):
        assert risk.update_streak_throttle(True, [5, 6], 0.04,
                                           winners=2, dd_off=0.025)

    def test_rolling_drawdown(self):
        assert abs(risk.rolling_drawdown_pct([100, 110, 99]) - 0.1) < 1e-9
        assert risk.rolling_drawdown_pct([100, 110]) == 0.0
        assert risk.rolling_drawdown_pct([]) == 0.0


class TestMeasuredMoveTarget:
    def test_swing_high_above_entry_is_target(self):
        highs = [105, 110, 108] + [104] * 17
        assert risk.measured_move_target(100, highs, [95] * 20, lookback=20) == 110

    def test_breakout_uses_two_x_range_height(self):
        # swing high 98 below entry 100 -> entry + 2 x (98 - 90) = 116
        assert risk.measured_move_target(100, [98] * 20, [90] * 20,
                                         lookback=20) == 116

    def test_insufficient_history_none(self):
        assert risk.measured_move_target(100, [105, 106], [95], lookback=20) is None
        assert risk.measured_move_target(100, None, None) is None


class TestPyramiding:
    def test_first_tranche_at_plus_1r(self):
        # entry 100, stop 96 -> R = 4 -> tranche 1 fires at 104
        assert risk.should_pyramid(100, 104.1, 96, 0, max_tranches=2,
                                   adx=30, adx_min=25, score=4.0, full_gate=3.5)
        assert not risk.should_pyramid(100, 103.9, 96, 0, max_tranches=2,
                                       adx=30, adx_min=25, score=4.0, full_gate=3.5)

    def test_second_tranche_at_plus_2r(self):
        assert risk.should_pyramid(100, 108.1, 96, 1, max_tranches=2,
                                   adx=30, adx_min=25, score=4.0, full_gate=3.5)
        assert not risk.should_pyramid(100, 107.9, 96, 1, max_tranches=2,
                                       adx=30, adx_min=25, score=4.0, full_gate=3.5)

    def test_max_tranches_respected(self):
        assert not risk.should_pyramid(100, 120, 96, 2, max_tranches=2,
                                       adx=30, adx_min=25, score=5.0, full_gate=3.5)

    def test_needs_trend_and_score(self):
        assert not risk.should_pyramid(100, 105, 96, 0, max_tranches=2,
                                       adx=20, adx_min=25, score=4.0, full_gate=3.5)
        assert not risk.should_pyramid(100, 105, 96, 0, max_tranches=2,
                                       adx=30, adx_min=25, score=3.0, full_gate=3.5)
        assert not risk.should_pyramid(100, 105, 96, 0, max_tranches=2,
                                       adx=None, adx_min=25, score=4.0, full_gate=3.5)


class TestBreadthGate:
    def test_breadth_pct(self):
        assert risk.breadth_pct(["uptrend", "uptrend", "downtrend", "mixed"]) == 0.5
        assert risk.breadth_pct(["fetch failed", None]) is None
        # non-regime strings are ignored
        assert risk.breadth_pct(["uptrend", "insufficient daily history (3 bars)"]) == 1.0

    def test_policy_majors_only_when_low(self):
        assert risk.breadth_policy(0.2, full_pct=0.6, low_pct=0.3) == (True, 0.5)
        assert risk.breadth_policy(0.3, full_pct=0.6, low_pct=0.3) == (True, 0.5)

    def test_policy_normal_otherwise(self):
        assert risk.breadth_policy(0.5, full_pct=0.6, low_pct=0.3) == (False, 1.0)
        assert risk.breadth_policy(0.9, full_pct=0.6, low_pct=0.3) == (False, 1.0)
        assert risk.breadth_policy(None) == (False, 1.0)


class TestMakerSafeBand:
    def test_limit_inside_spread_accepted(self):
        # Wide spread: bid 99, ask 100 — resting at the bid is > 0.2% from ask
        # but strictly conservative, so it must pass with bid supplied.
        assert risk.check_limit_band(99.0, 100.0, bid=99.0).ok
        assert not risk.check_limit_band(99.0, 100.0).ok  # without bid: rejected

    def test_below_bid_still_rejected(self):
        assert not risk.check_limit_band(98.5, 100.0, bid=99.0).ok

    def test_normal_band_unchanged(self):
        assert risk.check_limit_band(100.1, 100.0).ok
        assert not risk.check_limit_band(100.5, 100.0).ok
