# metrics.py
"""Performance metrics for backtests.

This module is intentionally Alpaca-agnostic and has no network calls.

Metrics included:
  - cumulative return
  - annualized return (optional, based on bar timeframe)
  - volatility
  - Sharpe ratio (excess return / std dev)
  - Sortino ratio (excess return / downside deviation)
  - max drawdown
  - win rate
  - profit factor (gross profit / gross loss)

Notes:
  - For crypto, markets are 24/7; annualization uses 365 days.
  - Risk-free rate defaults to 0 for simplicity; pass a value if needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np


@dataclass
class Metrics:
    cumulative_return: float
    annualized_return: Optional[float]
    annualized_volatility: Optional[float]
    sharpe: Optional[float]
    sortino: Optional[float]
    max_drawdown: float
    win_rate: Optional[float]
    profit_factor: Optional[float]
    trades: int

    def as_dict(self) -> Dict:
        return {
            "cumulative_return": self.cumulative_return,
            "annualized_return": self.annualized_return,
            "annualized_volatility": self.annualized_volatility,
            "sharpe": self.sharpe,
            "sortino": self.sortino,
            "max_drawdown": self.max_drawdown,
            "win_rate": self.win_rate,
            "profit_factor": self.profit_factor,
            "trades": self.trades,
        }


def _safe_div(a: float, b: float) -> Optional[float]:
    if b is None or b == 0 or np.isnan(b):
        return None
    return a / b


def equity_curve(returns: np.ndarray, start_equity: float = 1.0) -> np.ndarray:
    """Convert period returns into an equity curve."""
    returns = np.asarray(returns, dtype=float)
    if returns.size == 0:
        return np.array([start_equity], dtype=float)
    return start_equity * np.cumprod(1.0 + returns)


def max_drawdown(equity: np.ndarray) -> float:
    """Max drawdown as a negative fraction (e.g., -0.25)."""
    equity = np.asarray(equity, dtype=float)
    if equity.size == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / peak
    return float(np.min(dd))


def profit_factor(trade_pnls: np.ndarray) -> Optional[float]:
    trade_pnls = np.asarray(trade_pnls, dtype=float)
    if trade_pnls.size == 0:
        return None
    gp = float(np.sum(trade_pnls[trade_pnls > 0]))
    gl = float(-np.sum(trade_pnls[trade_pnls < 0]))
    if gl == 0:
        return None if gp == 0 else float('inf')
    return gp / gl


def win_rate(trade_pnls: np.ndarray) -> Optional[float]:
    trade_pnls = np.asarray(trade_pnls, dtype=float)
    if trade_pnls.size == 0:
        return None
    return float(np.mean(trade_pnls > 0))


def annualization_factor(timeframe: str) -> Optional[float]:
    """Return periods per year for a given Alpaca timeframe string."""
    tf = (timeframe or "").lower()
    if tf in {"1d", "day", "1day"}:
        return 365.0
    if tf in {"4h", "4hour"}:
        return 365.0 * 6.0
    if tf in {"1h", "1hour"}:
        return 365.0 * 24.0
    if tf in {"15min", "15m"}:
        return 365.0 * 24.0 * 4.0
    return None


def compute_metrics(
    period_returns: np.ndarray,
    timeframe: str,
    trade_pnls: np.ndarray,
    risk_free_rate: float = 0.0,
) -> Metrics:
    """Compute a standard metric bundle."""
    period_returns = np.asarray(period_returns, dtype=float)
    trade_pnls = np.asarray(trade_pnls, dtype=float)

    cum = float(np.prod(1.0 + period_returns) - 1.0) if period_returns.size else 0.0

    ann = annualization_factor(timeframe)
    ann_ret = None
    ann_vol = None
    sharpe = None
    sortino = None

    if ann and period_returns.size:
        ann_ret = float((1.0 + cum) ** (ann / period_returns.size) - 1.0)
        ann_vol = float(np.std(period_returns, ddof=1) * np.sqrt(ann)) if period_returns.size > 1 else None

        excess = period_returns - (risk_free_rate / ann)
        s = float(np.std(excess, ddof=1)) if excess.size > 1 else None
        sharpe = _safe_div(float(np.mean(excess) * np.sqrt(ann)), s)

        downside = np.minimum(0.0, excess)
        dd = float(np.sqrt(np.mean(downside ** 2)) * np.sqrt(ann)) if downside.size else None
        sortino = _safe_div(float(np.mean(excess) * np.sqrt(ann)), dd)

    eq = equity_curve(period_returns, start_equity=1.0)
    mdd = max_drawdown(eq)

    return Metrics(
        cumulative_return=cum,
        annualized_return=ann_ret,
        annualized_volatility=ann_vol,
        sharpe=sharpe,
        sortino=sortino,
        max_drawdown=mdd,
        win_rate=win_rate(trade_pnls),
        profit_factor=profit_factor(trade_pnls),
        trades=int(trade_pnls.size),
    )
