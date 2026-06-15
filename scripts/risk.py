# scripts/risk.py
"""
Pure-function risk helpers that encode the rules in CLAUDE.md.

Trading rules:
  - Never invest more than the per-symbol cap (see config.json > portfolio_caps.caps) of
    total portfolio value in a single position.  The default fallback cap is
    config.json > risk.default_position_cap_pct (default 5%).
  - Limit orders only, within config.json > risk.limit_band_pct of ask.
  - If a position drops config.json > risk.stop_loss_pct from entry, close it.
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
            int(  r.get("max_open_positions",           3)),
            list( r.get("tier1_symbols",                ["BTC/USD", "ETH/USD"])),
            int(  r.get("max_positions_per_tier",       2)),
            float(r.get("daily_drawdown_gate_pct",      0.03)),
            float(r.get("capital_preservation_stop_pct", 0.03)),
        )
    except Exception:
        return 0.05, 0.002, 0.05, 0.005, 0.025, 0.03, 2, 0.003, 3, ["BTC/USD", "ETH/USD"], 2, 0.03, 0.03


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
) = _load_risk_cfg()


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


def should_stop_out(entry_price: float, current_price: float) -> bool:
    """True if a long position is down >= STOP_LOSS_PCT from entry."""
    if entry_price <= 0:
        return False
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
    assert not should_stop_out(100, 96)
    assert should_stop_out(100, 95)
    assert should_stop_out(100, 90)
    assert not should_stop_out(0, 50)
    assert abs(stop_loss_price(100) - 100 * (1 - STOP_LOSS_PCT)) < 1e-9
    assert not should_cover_short(100, 104)
    assert should_cover_short(100, 105)
    assert should_cover_short(100, 110)
    assert not should_cover_short(0, 105)
    assert abs(short_stop_price(100) - 100 * (1 + STOP_LOSS_PCT)) < 1e-9
    assert not should_trail_stop_out(100, 100, 98)
    assert not should_trail_stop_out(100, 102.5, 100)
    assert should_trail_stop_out(100, 110, 106)
    assert not should_trail_stop_out(0, 110, 106)
    ok, _ = correlation_budget_allows("SOL/USD", ["BTC/USD", "ETH/USD"])
    assert ok
    ok, reason = correlation_budget_allows("SOL/USD", ["BTC/USD", "ETH/USD", "ADA/USD"])
    assert not ok
    assert "3/3" in reason
    assert not daily_drawdown_gate_triggered(100_000, 97_001)
    assert daily_drawdown_gate_triggered(100_000, 97_000)
    assert daily_drawdown_gate_triggered(100_000, 90_000)
    lim = stop_loss_limit_price(100.0, cycles_open=0)
    assert abs(lim - 99.5) < 0.001
    lim_esc = stop_loss_limit_price(100.0, cycles_open=2)
    assert lim_esc < lim
    print("risk.py: all self-checks passed")
    print("  MAX_POSITION_PCT =", MAX_POSITION_PCT)
    print("  LIMIT_BAND_PCT   =", LIMIT_BAND_PCT)
    print("  STOP_LOSS_PCT    =", STOP_LOSS_PCT)
    print("  STOP_LOSS_LIMIT_BAND_PCT =", STOP_LOSS_LIMIT_BAND_PCT)
    print("  TRAILING_STOP_ACTIVATION_PCT =", TRAILING_STOP_ACTIVATION_PCT)
    print("  TRAILING_STOP_TRAIL_PCT =", TRAILING_STOP_TRAIL_PCT)
    print("  MAX_OPEN_POSITIONS =", MAX_OPEN_POSITIONS)
    print("  DAILY_DRAWDOWN_GATE_PCT =", DAILY_DRAWDOWN_GATE_PCT)
