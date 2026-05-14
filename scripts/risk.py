# scripts/risk.py
"""
Pure-function risk helpers that encode the rules in CLAUDE.md.

The trading rules are:
  - Never invest more than the per-symbol cap (see portfolio_caps.json) of
    total portfolio value in a single position.  The default fallback cap is
    5% for any symbol not listed in portfolio_caps.json.
  - Never place a market order -- limit orders only, within 0.2% of ask
  - If a position drops 5% from entry, close it without waiting
  - Take-profit is TA signal-driven (score <= -2), NOT a fixed % target.

Keep these as pure functions so they can be unit-tested without hitting Alpaca.
"""

from __future__ import annotations
from dataclasses import dataclass

# Default cap used when no per-symbol cap is available.
# Per-symbol caps are defined in portfolio_caps.json and passed in by callers.
MAX_POSITION_PCT = 0.05      # default 5% of equity per position
LIMIT_BAND_PCT = 0.002       # limit must be within 0.2% of ask
STOP_LOSS_PCT = 0.05         # close if down 5% from entry


@dataclass(frozen=True)
class RiskCheck:
    ok: bool
    reason: str


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
    equity: float, qty, price: float, cap_pct: float = MAX_POSITION_PCT
) -> RiskCheck:
    """Reject orders that would exceed the per-symbol position cap.

    cap_pct defaults to MAX_POSITION_PCT (5%) but callers should pass the
    symbol-specific value loaded from portfolio_caps.json.
    """
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
    """Limit price must be within 0.2% of the current ask (above OR below)."""
    if ask <= 0:
        return RiskCheck(False, "ask must be positive")
    if limit_price <= 0:
        return RiskCheck(False, "limit_price must be positive")
    band = ask * LIMIT_BAND_PCT
    diff = abs(limit_price - ask)
    if diff > band:
        return RiskCheck(False, "limit outside 0.2% band")
    return RiskCheck(True, "limit within 0.2% of ask")


def should_stop_out(entry_price: float, current_price: float) -> bool:
    """True if position is down >=5% from entry -- must be closed."""
    if entry_price <= 0:
        return False
    drawdown = (entry_price - current_price) / entry_price
    return drawdown >= STOP_LOSS_PCT


def stop_loss_price(entry_price: float) -> float:
    """The price at which the 5% stop triggers."""
    return entry_price * (1 - STOP_LOSS_PCT)


if __name__ == "__main__":
    # Default 5% cap
    assert max_position_dollars(100_000) == 5_000
    assert max_shares_for_position(100_000, 250) == 20
    assert check_position_size(100_000, 20, 250).ok
    assert not check_position_size(100_000, 21, 250).ok

    # Per-symbol caps (e.g. BTC at 30%, ADA at 10%)
    assert max_position_dollars(100_000, 0.30) == 30_000
    assert check_position_size(100_000, 0.375, 80_000, 0.30).ok   # 30k notional = ok
    assert not check_position_size(100_000, 0.376, 80_000, 0.30).ok  # 30.08k > 30k
    assert max_position_dollars(100_000, 0.10) == 10_000
    assert check_position_size(100_000, 10, 1_000, 0.10).ok
    assert not check_position_size(100_000, 11, 1_000, 0.10).ok

    assert check_limit_band(100.0, 100.0).ok
    assert check_limit_band(100.19, 100.0).ok
    assert check_limit_band(99.81, 100.0).ok
    assert not check_limit_band(100.5, 100.0).ok

    assert not should_stop_out(100, 96)
    assert should_stop_out(100, 95)
    assert should_stop_out(100, 90)

    assert abs(stop_loss_price(100) - 95.0) < 1e-9

    print("risk.py: all self-checks passed")
