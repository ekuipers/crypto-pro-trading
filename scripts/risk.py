# scripts/risk.py
"""
Pure-function risk helpers that encode the rules in CLAUDE.md.

Trading rules:
  - Never invest more than the per-symbol cap (see config.json > portfolio_caps.caps) of
    total portfolio value in a single position.  The default fallback cap is
    config.json > risk.default_position_cap_pct (default 5%).
  - Limit orders only, within config.json > risk.limit_band_pct of ask.
  - Stop loss is TA-driven: when risk.stop_loss_mode == "swing_low_4h" the stop
    sits just below the lowest low of the last swing_low_lookback_bars 4H bars
    (the "previous range low"), clamped to at most swing_low_max_stop_pct below
    entry. The fixed risk.stop_loss_pct (5%) is only a fallback when 4H history
    is unavailable.
  - Take-profit is TA signal-driven (score <= -2), NOT a fixed % target.

Constants (MAX_POSITION_PCT, LIMIT_BAND_PCT, STOP_LOSS_PCT) are loaded from
config.json at module-import time so callers that import them directly get the
configured values.  Sensible defaults apply if config.json is missing.

Keep these as pure functions so they can be unit-tested without hitting Alpaca.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# Load constants from config.json
# ---------------------------------------------------------------------------

def _load_risk_cfg() -> tuple:
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        r = cfg.get("risk", {})
        return (
            float(r.get("default_position_cap_pct",     0.05)),
            float(r.get("limit_band_pct",               0.002)),
            float(r.get("stop_loss_pct",                0.05)),
            float(r.get("stop_loss_limit_band_pct",     0.005)),
            float(r.get("trailing_stop_activation_pct", 0.025)),
            float(r.get("trailing_stop_trail_pct",      0.03)),
            int(  r.get("stop_loss_escalation_cycles",  2)),
            float(r.get("stop_loss_escalation_extra_pct", 0.003)),
            int(  r.get("max_open_positions",           4)),
            list( r.get("tier1_symbols",                ["BTC/USD", "ETH/USD"])),
            int(  r.get("max_positions_per_tier",       3)),
            float(r.get("daily_drawdown_gate_pct",      0.03)),
            float(r.get("capital_preservation_stop_pct", 0.03)),
            str(  r.get("stop_loss_mode",               "swing_low_4h")).lower(),
            int(  r.get("swing_low_lookback_bars",      20)),
            float(r.get("swing_low_buffer_pct",         0.001)),
            float(r.get("swing_low_max_stop_pct",       0.08)),
        )
    except Exception:
        return (0.05, 0.002, 0.05, 0.005, 0.025, 0.03, 2, 0.003, 4,
                ["BTC/USD", "ETH/USD"], 3, 0.03, 0.03, "swing_low_4h", 20, 0.001, 0.08)


(
    MAX_POSITION_PCT,
    LIMIT_BAND_PCT,
    STOP_LOSS_PCT,
    STOP_LOSS_LIMIT_BAND_PCT,
    TRAILING_STOP_ACTIVATION_PCT,
    TRAILING_STOP_TRAIL_PCT,
    STOP_LOSS_ESCALATION_CYCLES,
    STOP_LOSS_ESCALATION_EXTRA_PCT,
    MAX_OPEN_POSITIONS,
    TIER1_SYMBOLS,
    MAX_POSITIONS_PER_TIER,
    DAILY_DRAWDOWN_GATE_PCT,
    CAPITAL_PRESERVATION_STOP_PCT,
    STOP_LOSS_MODE,
    SWING_LOW_LOOKBACK_BARS,
    SWING_LOW_BUFFER_PCT,
    SWING_LOW_MAX_STOP_PCT,
) = _load_risk_cfg()


def _load_risk_cfg2() -> tuple:
    """Second-stage config loader for the 2026-07-09 roadmap keys.

    Kept separate from _load_risk_cfg() so the original 17-tuple (and every
    caller that unpacks it) stays untouched.
    """
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        r  = cfg.get("risk", {})
        s  = cfg.get("strategy", {})
        c  = cfg.get("costs", {})
        return (
            float(c.get("taker_fee_bps_per_side",       25.0)),
            bool( s.get("rotation_enabled",             True)),
            float(s.get("rotation_min_score",           4.0)),
            float(s.get("rotation_score_margin",        2.0)),
            float(s.get("min_rr_full",                  1.5)),
            float(s.get("min_rr_half",                  1.0)),
            bool( r.get("enforce_budget_on_open_positions", False)),
            float(r.get("max_hold_hours",               48.0)),
            bool( r.get("partial_tp_enabled",           True)),
            float(r.get("partial_tp_r_multiple",        1.0)),
            float(r.get("partial_tp_fraction",          0.5)),
        )
    except Exception:
        return (25.0, True, 4.0, 2.0, 1.5, 1.0, False, 48.0, True, 1.0, 0.5)


(
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
) = _load_risk_cfg2()


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RiskCheck:
    ok: bool
    reason: str


# ---------------------------------------------------------------------------
# Pure-function helpers
# ---------------------------------------------------------------------------

def max_position_dollars(equity: float, cap_pct: float = MAX_POSITION_PCT) -> float:
    """Maximum dollar size for a position given an equity-fraction cap."""
    return equity * cap_pct


def max_shares_for_position(
    equity: float, price: float, cap_pct: float = MAX_POSITION_PCT
) -> int:
    """Largest whole-share quantity that respects the cap at price."""
    if price <= 0:
        return 0
    return int(max_position_dollars(equity, cap_pct) // price)


def check_position_size(
    equity: float, qty: float, price: float, cap_pct: float = MAX_POSITION_PCT
) -> RiskCheck:
    """Reject orders that would exceed the per-symbol position cap."""
    if equity <= 0:
        return RiskCheck(False, "equity is zero or negative")
    if qty <= 0:
        return RiskCheck(False, "qty must be positive")
    if price <= 0:
        return RiskCheck(False, "price must be positive")
    notional = qty * price
    cap = max_position_dollars(equity, cap_pct)
    if notional > cap:
        return RiskCheck(
            False,
            "order notional exceeds {:.0%} cap (equity={})".format(cap_pct, equity),
        )
    return RiskCheck(True, "size ok")


def check_limit_band(limit_price: float, ask: float) -> RiskCheck:
    """Limit price must be within LIMIT_BAND_PCT of the current ask (above OR below)."""
    if ask <= 0:
        return RiskCheck(False, "ask must be positive")
    if limit_price <= 0:
        return RiskCheck(False, "limit_price must be positive")
    band = ask * LIMIT_BAND_PCT
    diff = abs(limit_price - ask)
    if diff > band:
        return RiskCheck(
            False,
            "limit outside {:.1%} band (ask={:.4f} limit={:.4f})".format(
                LIMIT_BAND_PCT, ask, limit_price
            ),
        )
    return RiskCheck(True, "limit within {:.1%} of ask".format(LIMIT_BAND_PCT))


def swing_low_stop_price(
    entry_price: float,
    lows_4h: list | None,
    lookback: int = SWING_LOW_LOOKBACK_BARS,
    buffer_pct: float = SWING_LOW_BUFFER_PCT,
    max_stop_pct: float = SWING_LOW_MAX_STOP_PCT,
) -> float | None:
    """
    TA-driven long stop: just below the lowest low of the last `lookback`
    completed 4-hour bars ("previous range low"). Volatility/structure-aware.

    Returns None (so the caller can fall back to the fixed % stop) when there
    is not enough 4H history or the computed level is not a valid long stop
    (i.e. not below entry). The stop is clamped to at most `max_stop_pct` below
    entry so an unusually wide range can't blow past the risk budget.
    """
    if entry_price <= 0 or not lows_4h:
        return None
    window = [lw for lw in lows_4h[-lookback:] if lw and lw > 0]
    if len(window) < min(lookback, 5):
        return None
    stop = min(window) * (1 - buffer_pct)
    # Must be a real long stop (below entry); otherwise let caller fall back.
    if stop >= entry_price:
        return None
    # Clamp so the stop never sits more than max_stop_pct below entry.
    floor_price = entry_price * (1 - max_stop_pct)
    if stop < floor_price:
        stop = floor_price
    return round(stop, 6)


def should_stop_out(
    entry_price: float,
    current_price: float,
    stop_price: float | None = None,
) -> bool:
    """
    True if a long position has hit its stop loss.

    When an explicit `stop_price` is supplied (e.g. the 4H swing-low stop from
    swing_low_stop_price), the position stops out at/below that level.
    Otherwise it falls back to the fixed STOP_LOSS_PCT drawdown so a position
    is never left without any stop.
    """
    if entry_price <= 0:
        return False
    if stop_price is not None and stop_price > 0:
        return current_price <= stop_price
    drawdown = (entry_price - current_price) / entry_price
    return drawdown >= STOP_LOSS_PCT


def should_cover_short(entry_price: float, current_price: float) -> bool:
    """True if a short position has moved >= STOP_LOSS_PCT against us (price rose)."""
    if entry_price <= 0:
        return False
    adverse_move = (current_price - entry_price) / entry_price
    return adverse_move >= STOP_LOSS_PCT


def stop_loss_price(entry_price: float) -> float:
    """The price at which a long stop-loss triggers."""
    return entry_price * (1 - STOP_LOSS_PCT)


def short_stop_price(entry_price: float) -> float:
    """The price at which a short stop-loss triggers (price rose above entry)."""
    return entry_price * (1 + STOP_LOSS_PCT)


# ---------------------------------------------------------------------------
# Trailing stop helpers
# ---------------------------------------------------------------------------

def trailing_stop_price(
    high_water_mark: float,
    trail_pct: float = TRAILING_STOP_TRAIL_PCT,
) -> float:
    """Price level at which a trailing stop triggers for a long position."""
    return high_water_mark * (1 - trail_pct)


def should_trail_stop_out(
    entry_price: float,
    high_water_mark: float,
    current_price: float,
    activation_pct: float = TRAILING_STOP_ACTIVATION_PCT,
    trail_pct: float = TRAILING_STOP_TRAIL_PCT,
) -> bool:
    """
    True when a long position should be closed via the trailing stop.

    The trailing stop becomes active once the position is at least
    activation_pct in profit. While inactive, the fixed STOP_LOSS_PCT
    hard stop remains in force.
    """
    if entry_price <= 0 or high_water_mark is None:
        return False
    activated = (high_water_mark - entry_price) / entry_price >= activation_pct
    if not activated:
        return False
    return current_price <= trailing_stop_price(high_water_mark, trail_pct)


def effective_stop_pct(
    entry_price: float,
    high_water_mark: float,
    activation_pct: float = TRAILING_STOP_ACTIVATION_PCT,
    trail_pct: float = TRAILING_STOP_TRAIL_PCT,
    capital_preservation: bool = False,
    preservation_stop_pct: float = CAPITAL_PRESERVATION_STOP_PCT,
) -> float:
    """Return the effective stop-loss percentage for a position."""
    if capital_preservation:
        return preservation_stop_pct
    if entry_price > 0 and high_water_mark is not None:
        activated = (high_water_mark - entry_price) / entry_price >= activation_pct
        if activated:
            return trail_pct
    return STOP_LOSS_PCT


# ---------------------------------------------------------------------------
# Correlation budget helpers
# ---------------------------------------------------------------------------

def open_position_count(positions: list) -> int:
    """Return the number of currently open positions."""
    return len(positions)


def tier_count(symbol: str, open_symbols: list) -> int:
    """
    Count how many open positions are in the same tier as symbol.

    Tier 1 = TIER1_SYMBOLS (BTC/USD, ETH/USD).
    Tier 2 = everything else.
    """
    in_tier1 = symbol in TIER1_SYMBOLS
    return sum(1 for s in open_symbols if (s in TIER1_SYMBOLS) == in_tier1)


def correlation_budget_allows(
    symbol: str,
    open_symbols: list,
    max_positions: int = MAX_OPEN_POSITIONS,
    max_per_tier: int = MAX_POSITIONS_PER_TIER,
) -> tuple:
    """
    Returns (allowed, reason_string).

    Blocks a new entry when:
      - Total open positions >= max_positions, OR
      - Positions in the same tier (Tier-1 or Tier-2) >= max_per_tier.
    """
    total = len(open_symbols)
    if total >= max_positions:
        return False, (
            "correlation budget: %d/%d positions open" % (total, max_positions)
        )
    same_tier = tier_count(symbol, open_symbols)
    if same_tier >= max_per_tier:
        tier_label = "Tier-1 (BTC/ETH)" if symbol in TIER1_SYMBOLS else "Tier-2 (alts)"
        return False, (
            "correlation budget: %d/%d %s positions open"
            % (same_tier, max_per_tier, tier_label)
        )
    return True, "ok"


# ---------------------------------------------------------------------------
# Daily drawdown gate helpers
# ---------------------------------------------------------------------------

def daily_drawdown_pct(day_open_equity: float, current_equity: float) -> float:
    """
    Fractional drop from the day opening equity.
    Returns a positive number for a drawdown (e.g. 0.031 = 3.1% down).
    """
    if not day_open_equity or day_open_equity <= 0:
        return 0.0
    drop = day_open_equity - current_equity
    return max(drop / day_open_equity, 0.0)


def daily_drawdown_gate_triggered(
    day_open_equity: float,
    current_equity: float,
    gate_pct: float = DAILY_DRAWDOWN_GATE_PCT,
) -> bool:
    """True if today's portfolio drawdown has exceeded gate_pct."""
    return daily_drawdown_pct(day_open_equity, current_equity) >= gate_pct


# ---------------------------------------------------------------------------
# Stop-loss limit-price helpers
# ---------------------------------------------------------------------------

def stop_loss_limit_price(
    ask: float,
    cycles_open: int = 0,
    base_band_pct: float = STOP_LOSS_LIMIT_BAND_PCT,
    escalation_cycles: int = STOP_LOSS_ESCALATION_CYCLES,
    escalation_extra_pct: float = STOP_LOSS_ESCALATION_EXTRA_PCT,
) -> float:
    """
    Compute the limit price for a stop-loss SELL order.

    Uses a wider band than normal entries so orders fill faster in volatile
    conditions. After escalation_cycles unfilled cycles the band widens further.
    """
    band = base_band_pct
    if cycles_open >= escalation_cycles:
        band += escalation_extra_pct
    return round(ask * (1 - band), 4)


def cover_limit_price(
    ask: float,
    cycles_open: int = 0,
    base_band_pct: float = STOP_LOSS_LIMIT_BAND_PCT,
    escalation_cycles: int = STOP_LOSS_ESCALATION_CYCLES,
    escalation_extra_pct: float = STOP_LOSS_ESCALATION_EXTRA_PCT,
) -> float:
    """Limit price for a stop-loss COVER (short) order."""
    band = base_band_pct
    if cycles_open >= escalation_cycles:
        band += escalation_extra_pct
    return round(ask * (1 + band), 4)


# ---------------------------------------------------------------------------
# Trade-economics helpers (roadmap 2026-07-09 item 1)
# ---------------------------------------------------------------------------

def spread_pct(bid: float, ask: float) -> float:
    """Quoted bid-ask spread as a fraction of the mid price (0.001 = 0.1%)."""
    if bid <= 0 or ask <= 0 or ask < bid:
        return 0.0
    mid = (ask + bid) / 2
    return (ask - bid) / mid


def round_trip_cost_pct(
    bid: float,
    ask: float,
    fee_bps_per_side: float = TAKER_FEE_BPS_PER_SIDE,
) -> float:
    """
    Estimated full round-trip cost as a fraction of notional:
    taker fee on entry + taker fee on exit + the quoted bid-ask spread.
    E.g. 25 bps/side + 0.1% spread -> 0.006 (0.6%).
    """
    return 2 * fee_bps_per_side / 10000.0 + spread_pct(bid, ask)


def net_rr(
    entry: float,
    stop: float,
    target: float,
    cost_pct: float = 0.0,
) -> float | None:
    """
    Net-of-cost reward:risk ratio for a long setup.

    Reward leg = (target - entry) minus the round-trip cost (fees + spread);
    risk leg = entry - stop. Returns None when the geometry is invalid
    (stop not below entry, or no upside target).
    """
    if entry <= 0 or stop is None or stop <= 0 or stop >= entry:
        return None
    if target is None or target <= entry:
        return None
    reward = (target - entry) - entry * cost_pct
    risk_leg = entry - stop
    if risk_leg <= 0:
        return None
    return reward / risk_leg


# ---------------------------------------------------------------------------
# Partial take-profit ladder (roadmap 2026-07-09 item 4)
# ---------------------------------------------------------------------------

def partial_tp_trigger_price(
    entry: float,
    stop: float,
    r_multiple: float = PARTIAL_TP_R_MULTIPLE,
) -> float | None:
    """
    Price at which the partial take-profit fires: entry + r_multiple x R,
    where R = entry - stop (the initial risk distance). None when the stop
    geometry is invalid.
    """
    if entry <= 0 or stop is None or stop <= 0 or stop >= entry:
        return None
    return entry + (entry - stop) * r_multiple


def should_partial_tp(
    entry: float,
    current: float,
    stop: float,
    already_done: bool,
    r_multiple: float = PARTIAL_TP_R_MULTIPLE,
) -> bool:
    """True when an open long has reached +r_multiple R and has not yet scaled out."""
    if already_done:
        return False
    trigger = partial_tp_trigger_price(entry, stop, r_multiple)
    return trigger is not None and current >= trigger


# ---------------------------------------------------------------------------
# Stale-position exit (roadmap 2026-07-09 item 5)
# ---------------------------------------------------------------------------

def position_age_hours(entry_time_iso: str | None, now=None) -> float | None:
    """Hours since the position was opened; None when the timestamp is missing/bad."""
    if not entry_time_iso:
        return None
    from datetime import datetime, timezone
    try:
        opened = datetime.fromisoformat(str(entry_time_iso).replace("Z", "+00:00"))
        if opened.tzinfo is None:
            opened = opened.replace(tzinfo=timezone.utc)
    except Exception:
        return None
    now = now or datetime.now(timezone.utc)
    return (now - opened).total_seconds() / 3600.0


def is_stale_position(
    entry_time_iso: str | None,
    trailing_armed: bool,
    score: float | None,
    score_gate: float,
    max_hold_hours: float = MAX_HOLD_HOURS,
    now=None,
) -> bool:
    """
    True when a position should be exited for capital efficiency:
    older than max_hold_hours, never armed its trailing stop, and its live
    score is below the half-size entry gate. Winners (armed trail) are exempt.
    """
    if max_hold_hours <= 0 or trailing_armed or score is None:
        return False
    if score >= score_gate:
        return False
    age = position_age_hours(entry_time_iso, now)
    return age is not None and age > max_hold_hours


# ---------------------------------------------------------------------------
# Position rotation at the correlation budget (roadmap 2026-07-09 item 2)
# ---------------------------------------------------------------------------

def rotation_allows(
    candidate_score: float | None,
    weakest_score: float | None,
    min_score: float = ROTATION_MIN_SCORE,
    margin: float = ROTATION_SCORE_MARGIN,
) -> bool:
    """
    True when a budget-blocked candidate justifies rotating out the weakest
    open holding: candidate >= min_score, weakest <= 0, and the candidate
    leads the weakest by at least `margin` points.
    """
    if candidate_score is None or weakest_score is None:
        return False
    return (
        candidate_score >= min_score
        and weakest_score <= 0
        and candidate_score - weakest_score >= margin
    )


# ---------------------------------------------------------------------------
# Self-checks (run as: python scripts/risk.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    assert max_position_dollars(100_000) == 100_000 * MAX_POSITION_PCT
    assert check_position_size(100_000, 20, 250, 0.05).ok
    assert not check_position_size(100_000, 21, 250, 0.05).ok
    assert max_position_dollars(100_000, 0.30) == 30_000
    assert check_position_size(100_000, 0.375, 80_000, 0.30).ok
    assert not check_position_size(100_000, 0.376, 80_000, 0.30).ok
    assert not check_position_size(0, 1, 100).ok
    assert not check_position_size(100_000, 0, 100).ok
    assert not check_position_size(100_000, 1, 0).ok
    assert check_limit_band(100.0, 100.0).ok
    assert check_limit_band(100.19, 100.0).ok
    assert check_limit_band(99.81, 100.0).ok
    assert not check_limit_band(100.5, 100.0).ok
    assert not check_limit_band(0, 100.0).ok
    assert not check_limit_band(100.0, 0).ok
    # Fixed-pct fallback (no stop_price supplied)
    assert not should_stop_out(100, 96)
    assert should_stop_out(100, 95)
    assert should_stop_out(100, 90)
    assert not should_stop_out(0, 50)
    assert abs(stop_loss_price(100) - 100 * (1 - STOP_LOSS_PCT)) < 1e-9
    # Explicit stop_price override
    assert should_stop_out(100, 96.9, stop_price=97.0)
    assert not should_stop_out(100, 97.1, stop_price=97.0)
    # Swing-low stop: lowest low of window, just below it
    lows = [99, 98, 97.5, 98.2, 99.1] * 4   # 20 bars, min 97.5
    sl = swing_low_stop_price(100, lows, lookback=20, buffer_pct=0.001, max_stop_pct=0.08)
    assert sl is not None and abs(sl - 97.5 * 0.999) < 1e-6
    # Clamp: a very deep low is capped at max_stop_pct below entry
    sl_cap = swing_low_stop_price(100, [50] * 20, lookback=20, max_stop_pct=0.08)
    assert abs(sl_cap - 92.0) < 1e-6
    # Not enough history -> None (caller falls back to fixed %)
    assert swing_low_stop_price(100, [99, 98], lookback=20) is None
    # Swing low above entry (no valid long stop) -> None
    assert swing_low_stop_price(100, [101] * 20, lookback=20) is None
    assert not should_cover_short(100, 104)
    assert should_cover_short(100, 105)
    assert should_cover_short(100, 110)
    assert not should_cover_short(0, 105)
    assert abs(short_stop_price(100) - 100 * (1 + STOP_LOSS_PCT)) < 1e-9
    assert not should_trail_stop_out(100, 100, 98)
    assert not should_trail_stop_out(100, 102.5, 100)
    assert should_trail_stop_out(100, 110, 106)
    assert not should_trail_stop_out(0, 110, 106)
    # Correlation budget (explicit caps so the check is config-independent).
    ok, _ = correlation_budget_allows("SOL/USD", ["BTC/USD", "ETH/USD"],
                                      max_positions=4, max_per_tier=3)
    assert ok
    # 4 positions open -> total cap (4) reached, blocked.
    ok, reason = correlation_budget_allows(
        "SOL/USD", ["BTC/USD", "ETH/USD", "ADA/USD", "DOGE/USD"],
        max_positions=4, max_per_tier=3)
    assert not ok
    assert "4/4" in reason
    # 3 Tier-2 positions open -> Tier-2 cap (3) reached, blocked.
    ok, reason = correlation_budget_allows(
        "SOL/USD", ["ADA/USD", "DOGE/USD", "LTC/USD"],
        max_positions=4, max_per_tier=3)
    assert not ok
    assert "3/3" in reason
    assert not daily_drawdown_gate_triggered(100_000, 97_001)
    assert daily_drawdown_gate_triggered(100_000, 97_000)
    assert daily_drawdown_gate_triggered(100_000, 90_000)
    lim = stop_loss_limit_price(100.0, cycles_open=0)
    assert abs(lim - 99.5) < 0.001
    lim_esc = stop_loss_limit_price(100.0, cycles_open=2)
    assert lim_esc < lim
    # Trade economics (roadmap item 1)
    assert abs(spread_pct(99.9, 100.1) - 0.2 / 100.0) < 1e-6
    assert spread_pct(0, 100) == 0.0
    rt = round_trip_cost_pct(99.9, 100.1, fee_bps_per_side=25)
    assert abs(rt - (0.005 + 0.002)) < 1e-6           # 2×25bps + 0.2% spread
    # Net R:R: entry 100, stop 96 (risk 4), target 112 (reward 12), cost 0.6%
    nr = net_rr(100, 96, 112, cost_pct=0.006)
    assert nr is not None and abs(nr - (12 - 0.6) / 4) < 1e-9
    assert net_rr(100, 104, 112) is None              # stop above entry
    assert net_rr(100, 96, 99) is None                # target below entry
    # Partial TP (roadmap item 4): entry 100, stop 96 -> +1R trigger at 104
    assert abs(partial_tp_trigger_price(100, 96, 1.0) - 104) < 1e-9
    assert should_partial_tp(100, 104.1, 96, already_done=False, r_multiple=1.0)
    assert not should_partial_tp(100, 103.9, 96, already_done=False, r_multiple=1.0)
    assert not should_partial_tp(100, 110, 96, already_done=True, r_multiple=1.0)
    # Stale-position exit (roadmap item 5)
    from datetime import datetime, timedelta, timezone
    _now = datetime.now(timezone.utc)
    _old = (_now - timedelta(hours=49)).isoformat()
    _new = (_now - timedelta(hours=2)).isoformat()
    assert is_stale_position(_old, False, 1.0, 2.5, max_hold_hours=48, now=_now)
    assert not is_stale_position(_new, False, 1.0, 2.5, max_hold_hours=48, now=_now)
    assert not is_stale_position(_old, True,  1.0, 2.5, max_hold_hours=48, now=_now)
    assert not is_stale_position(_old, False, 3.0, 2.5, max_hold_hours=48, now=_now)
    assert not is_stale_position(None, False, 1.0, 2.5, max_hold_hours=48, now=_now)
    # Rotation gate (roadmap item 2)
    assert rotation_allows(4.0, -1.0, min_score=4.0, margin=2.0)
    assert not rotation_allows(3.5, -1.0, min_score=4.0, margin=2.0)   # below min
    assert not rotation_allows(4.0,  0.5, min_score=4.0, margin=2.0)   # holding > 0
    assert not rotation_allows(4.0,  2.5, min_score=4.0, margin=2.0)   # margin fail
    assert not rotation_allows(None, -1.0)
    print("risk.py: all self-checks passed")
    print("  MAX_POSITION_PCT =", MAX_POSITION_PCT)
    print("  LIMIT_BAND_PCT   =", LIMIT_BAND_PCT)
    print("  STOP_LOSS_MODE   =", STOP_LOSS_MODE)
    print("  SWING_LOW_LOOKBACK_BARS =", SWING_LOW_LOOKBACK_BARS)
    print("  SWING_LOW_MAX_STOP_PCT  =", SWING_LOW_MAX_STOP_PCT)
    print("  STOP_LOSS_PCT (fallback) =", STOP_LOSS_PCT)
    print("  STOP_LOSS_LIMIT_BAND_PCT =", STOP_LOSS_LIMIT_BAND_PCT)
    print("  TRAILING_STOP_ACTIVATION_PCT =", TRAILING_STOP_ACTIVATION_PCT)
    print("  TRAILING_STOP_TRAIL_PCT =", TRAILING_STOP_TRAIL_PCT)
    print("  MAX_OPEN_POSITIONS =", MAX_OPEN_POSITIONS)
    print("  DAILY_DRAWDOWN_GATE_PCT =", DAILY_DRAWDOWN_GATE_PCT)
