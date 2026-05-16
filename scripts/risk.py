# scripts/risk.py
"""
Pure-function risk helpers that encode the rules in CLAUDE.md.

Trading rules:
  - Never invest more than the per-symbol cap (see portfolio_caps.json) of
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

def _load_risk_cfg() -> tuple[float, float, float]:
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        r = cfg.get("risk", {})
        return (
            float(r.get("default_position_cap_pct", 0.05)),
            float(r.get("limit_band_pct", 0.002)),
            float(r.get("stop_loss_pct", 0.05)),
        )
    except Exception:
        return 0.05, 0.002, 0.05


MAX_POSITION_PCT, LIMIT_BAND_PCT, STOP_LOSS_PCT = _load_risk_cfg()


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
    """Reject orders that would exceed the per-symbol position cap.

    cap_pct defaults to MAX_POSITION_PCT but callers should pass the
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
    """True if position is down >= STOP_LOSS_PCT from entry — must be closed."""
    if entry_price <= 0:
        return False
    drawdown = (entry_price - current_price) / entry_price
    return drawdown >= STOP_LOSS_PCT


def stop_loss_price(entry_price: float) -> float:
    """The price at which the stop-loss triggers."""
    return entry_price * (1 - STOP_LOSS_PCT)


# ---------------------------------------------------------------------------
# Self-checks (run as: python scripts/risk.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Default cap (from config, typically 5%)
    assert max_position_dollars(100_000) == 100_000 * MAX_POSITION_PCT
    assert check_position_size(100_000, 20, 250, 0.05).ok
    assert not check_position_size(100_000, 21, 250, 0.05).ok

    # Per-symbol caps
    assert max_position_dollars(100_000, 0.30) == 30_000
    assert check_position_size(100_000, 0.375, 80_000, 0.30).ok    # 30k notional = ok
    assert not check_position_size(100_000, 0.376, 80_000, 0.30).ok  # > 30k
    assert check_position_size(100_000, 10, 1_000, 0.10).ok
    assert not check_position_size(100_000, 11, 1_000, 0.10).ok

    # Edge cases
    assert not check_position_size(0, 1, 100).ok      # zero equity
    assert not check_position_size(100_000, 0, 100).ok  # zero qty
    assert not check_position_size(100_000, 1, 0).ok    # zero price

    # Limit band
    assert check_limit_band(100.0, 100.0).ok
    assert check_limit_band(100.19, 100.0).ok
    assert check_limit_band(99.81, 100.0).ok
    assert not check_limit_band(100.5, 100.0).ok
    assert not check_limit_band(0, 100.0).ok
    assert not check_limit_band(100.0, 0).ok

    # Stop-loss
    assert not should_stop_out(100, 96)
    assert should_stop_out(100, 95)
    assert should_stop_out(100, 90)
    assert not should_stop_out(0, 50)    # guard against bad entry price

    expected_stop = 100 * (1 - STOP_LOSS_PCT)
    assert abs(stop_loss_price(100) - expected_stop) < 1e-9

    print("risk.py: all self-checks passed")
    print("  MAX_POSITION_PCT =", MAX_POSITION_PCT)
    print("  LIMIT_BAND_PCT   =", LIMIT_BAND_PCT)
    print("  STOP_LOSS_PCT    =", STOP_LOSS_PCT)
