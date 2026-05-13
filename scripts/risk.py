# scripts/risk.py
"""
Pure-function risk helpers that encode the rules in CLAUDE.md.

The trading rules are:
  - Never invest more than 5% of total portfolio value in a single position
  - Never place a market order -- limit orders only, within 0.2% of ask
  - If a position drops 5% from entry, close it without waiting

Keep these as pure functions so they can be unit-tested without hitting Alpaca.
"""

from __future__ import annotations
from dataclasses import dataclass

# Hard-coded from CLAUDE.md. If these need to change, update CLAUDE.md and here.
MAX_POSITION_PCT = 0.05      # 5% of equity per position
LIMIT_BAND_PCT = 0.002       # limit must be within 0.2% of ask
STOP_LOSS_PCT = 0.05         # close if down 5% from entry
TAKE_PROFIT_PCT = 0.10       # close if up 10% from entry


@dataclass(frozen=True)
class RiskCheck:
    ok: bool
    reason: str


def max_position_dollars(equity: float) -> float:
    """Maximum dollar size for any single new position."""
    return equity * MAX_POSITION_PCT


def max_shares_for_position(equity: float, price: float) -> int:
    """Largest whole-share quantity that respects the 5% rule at price."""
    if price <= 0:
        return 0
    return int(max_position_dollars(equity) // price)


def check_position_size(equity: float, qty, price: float) -> RiskCheck:
    """Reject orders that would exceed the 5% per-position cap."""
    if equity <= 0:
        return RiskCheck(False, "equity is zero or negative")
    if qty <= 0:
        return RiskCheck(False, "qty must be positive")
    if price <= 0:
        return RiskCheck(False, "price must be positive")
    notional = qty * price
    cap = max_position_dollars(equity)
    if notional > cap:
        return RiskCheck(
            False,
            "order notional exceeds 5% cap (equity={})".format(equity),
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


def should_take_profit(entry_price: float, current_price: float) -> bool:
    """True if position is up >=10% from entry -- take profit."""
    if entry_price <= 0:
        return False
    gain = (current_price - entry_price) / entry_price
    return gain >= TAKE_PROFIT_PCT


def take_profit_price(entry_price: float) -> float:
    """The price at which the 10% take-profit triggers."""
    return entry_price * (1 + TAKE_PROFIT_PCT)


if __name__ == "__main__":
    assert max_position_dollars(100_000) == 5_000
    assert max_shares_for_position(100_000, 250) == 20

    assert check_position_size(100_000, 20, 250).ok
    assert not check_position_size(100_000, 21, 250).ok

    assert check_limit_band(100.0, 100.0).ok
    assert check_limit_band(100.19, 100.0).ok
    assert check_limit_band(99.81, 100.0).ok
    assert not check_limit_band(100.5, 100.0).ok

    assert not should_stop_out(100, 96)
    assert should_stop_out(100, 95)
    assert should_stop_out(100, 90)

    assert abs(stop_loss_price(100) - 95.0) < 1e-9

    assert not should_take_profit(100, 109)
    assert should_take_profit(100, 110)
    assert should_take_profit(100, 120)

    assert abs(take_profit_price(100) - 110.0) < 1e-9

    print("risk.py: all self-checks passed")
