# walkforward_evaluate.py
"""Walk-forward evaluator for the existing composite TA strategy.

This script evaluates robustness using walk-forward (rolling out-of-sample)
evaluation across timeframes 1H / 4H / 1D. It does NOT place orders.

Design choices to reduce backtest bias:
- Signals are computed on bar close t using data up to t.
- Executions are filled on next bar open (t+1) to avoid look-ahead.
- Optional fee + slippage in basis points.

Outputs:
- JSON + Markdown summaries into ./reports/

This is research tooling, not investment advice.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import requests

import _env  # noqa: F401
import indicators as ind
from metrics import compute_metrics


DATA_URL = "https://data.alpaca.markets"


<<<<<<< HEAD
def _headers():
    return {
        "APCA-API-KEY-ID": os.getenv("APCA_API_KEY_ID") or "",
=======
def _headers() -> dict[str, str]:
    return {
        "APCA-API-KEY-ID":     os.getenv("APCA_API_KEY_ID") or "",
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
        "APCA-API-SECRET-KEY": os.getenv("APCA_API_SECRET_KEY") or "",
    }


<<<<<<< HEAD
=======
def _load_sim_defaults() -> dict:
    """Load strategy + risk thresholds from config.json for the SimConfig defaults."""
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        return {"strategy": cfg.get("strategy", {}), "risk": cfg.get("risk", {})}
    except Exception:
        return {"strategy": {}, "risk": {}}


>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
def fetch_crypto_bars(symbol: str, timeframe: str, start: str, end: str, limit: int = 10000) -> pd.DataFrame:
    """Fetch crypto bars for a symbol/timeframe in [start, end)."""
    url = DATA_URL + "/v1beta3/crypto/us/bars"
    params = {"symbols": symbol, "timeframe": timeframe, "start": start, "end": end, "limit": limit}

    rows: List[Dict] = []
    page_token = None
    while True:
        if page_token:
            params["page_token"] = page_token
        r = requests.get(url, headers=_headers(), params=params, timeout=30)
        r.raise_for_status()
        payload = r.json()
        bars = payload.get("bars", {}).get(symbol, [])
        rows.extend(bars)
        page_token = payload.get("next_page_token")
        if not page_token or not bars:
            break

    if not rows:
        return pd.DataFrame(columns=["t", "o", "h", "l", "c", "v"])

    df = pd.DataFrame(rows)
    df["t"] = pd.to_datetime(df["t"], utc=True, errors="coerce")
    df = df.dropna(subset=["t"]).sort_values("t").reset_index(drop=True)
    for col in ["o", "h", "l", "c", "v"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["o", "c"]).reset_index(drop=True)
    return df


@dataclass
class SimConfig:
<<<<<<< HEAD
    buy_score_threshold: float = 2.0
    sell_score_threshold: float = -2.0
    max_position_pct: float = 0.05
    stop_loss_pct: float = 0.05
=======
    # Entry/exit thresholds — must match live trading (run_evaluation.py).
    # Loaded from config.json by default_sim_config(); edit config.json, not here.
    buy_score_threshold: float = 4.0   # >= 4 → full size (was incorrectly 2.0)
    buy_score_half_size: float = 3.0   # >= 3 → half size
    sell_score_threshold: float = -2.0
    max_position_pct: float = 0.05
    stop_loss_pct: float = 0.05
    # take_profit_pct: live trading uses TA exit (score <= -2), not a fixed %.
    # The backtest uses a fixed 10% as a reasonable approximation.
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
    take_profit_pct: float = 0.10
    fee_bps: float = 0.0
    slippage_bps: float = 0.0


<<<<<<< HEAD
=======
def default_sim_config() -> SimConfig:
    """Build SimConfig from config.json, falling back to dataclass defaults."""
    d = _load_sim_defaults()
    s = d["strategy"]
    r = d["risk"]
    return SimConfig(
        buy_score_threshold=float(s.get("buy_score_threshold",           4.0)),
        buy_score_half_size=float(s.get("buy_score_half_size_threshold",  3.0)),
        sell_score_threshold=float(s.get("sell_score_threshold",         -2.0)),
        stop_loss_pct=float(r.get("stop_loss_pct",                        0.05)),
    )


>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
def _apply_costs(price: float, side: str, fee_bps: float, slippage_bps: float) -> float:
    cost = (fee_bps + slippage_bps) / 10000.0
    if side == "buy":
        return price * (1.0 + cost)
    return price * (1.0 - cost)


def simulate_symbol(df: pd.DataFrame, timeframe: str, cfg: SimConfig, initial_equity: float = 10000.0):
    """Long-only simulation of the current composite TA logic."""
    if df.empty or len(df) < 40:
        return np.array([], dtype=float), np.array([], dtype=float)

    closes = df["c"].to_numpy(dtype=float)
    opens = df["o"].to_numpy(dtype=float)

    equity = initial_equity
    position_qty = 0.0
    entry_price = 0.0
    last_value = equity

    period_returns: List[float] = []
    trade_pnls: List[float] = []

    for i in range(len(df) - 1):
        mtm = closes[i]
        value = equity + position_qty * mtm
        if i > 0:
            period_returns.append((value / last_value) - 1.0)
            last_value = value

        score, _ = ind.signal_score(closes[: i + 1].tolist())

<<<<<<< HEAD
        action = "HOLD"
        if position_qty > 0 and entry_price > 0:
            dd = (entry_price - mtm) / entry_price
            g = (mtm - entry_price) / entry_price
=======
        action    = "HOLD"
        size_mult = 1.0  # 1.0 = full size, 0.5 = half size
        if position_qty > 0 and entry_price > 0:
            dd = (entry_price - mtm) / entry_price
            g  = (mtm - entry_price) / entry_price
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
            if dd >= cfg.stop_loss_pct:
                action = "SELL_STOP"
            elif g >= cfg.take_profit_pct:
                action = "SELL_TP"
            elif score <= cfg.sell_score_threshold:
                action = "SELL_TA"
        else:
            if score >= cfg.buy_score_threshold:
<<<<<<< HEAD
                action = "BUY_TA"
=======
                action    = "BUY_TA"
                size_mult = 1.0
            elif score >= cfg.buy_score_half_size:
                action    = "BUY_TA"
                size_mult = 0.5   # borderline confluence → half size
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287

        exec_px = opens[i + 1]
        if exec_px <= 0:
            continue

        if action.startswith("BUY") and position_qty == 0:
<<<<<<< HEAD
            cap = equity * cfg.max_position_pct
=======
            cap = equity * cfg.max_position_pct * size_mult
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
            qty = cap / exec_px
            if qty > 0:
                fill = _apply_costs(exec_px, "buy", cfg.fee_bps, cfg.slippage_bps)
                equity -= qty * fill
                position_qty = qty
                entry_price = fill

        elif action.startswith("SELL") and position_qty > 0:
            fill = _apply_costs(exec_px, "sell", cfg.fee_bps, cfg.slippage_bps)
            pnl = position_qty * (fill - entry_price)
            equity += position_qty * fill
            trade_pnls.append(pnl)
            position_qty = 0.0
            entry_price = 0.0

    # final mtm
    if len(df) >= 2:
        value = equity + position_qty * closes[-1]
        period_returns.append((value / last_value) - 1.0 if last_value else 0.0)

    return np.asarray(period_returns, dtype=float), np.asarray(trade_pnls, dtype=float)


def _bars_per_day(df: pd.DataFrame, timeframe: str) -> int:
    tf = timeframe.lower()
    if tf in {"1d", "1day"}:
        return 1
    if tf in {"4h", "4hour"}:
        return 6
    if tf in {"1h", "1hour"}:
        return 24
    # fallback inference
    deltas = df["t"].diff().dropna().dt.total_seconds().to_numpy()
    med = float(np.median(deltas)) if deltas.size else 3600.0
    return int(round(86400.0 / med)) if med else 24


def walk_forward(df: pd.DataFrame, timeframe: str, cfg: SimConfig, train_days: int, test_days: int, initial_equity: float) -> Dict:
    if df.empty:
        return {"windows": [], "summary": None}

    bpd = _bars_per_day(df, timeframe)
    train_bars = train_days * bpd
    test_bars = test_days * bpd

    windows = []
    start = 0
    while start + train_bars + test_bars <= len(df):
        train = df.iloc[start : start + train_bars]
        test = df.iloc[start + train_bars : start + train_bars + test_bars]

        stitched = pd.concat([train.tail(60), test], ignore_index=True)
        pr, tp = simulate_symbol(stitched, timeframe=timeframe, cfg=cfg, initial_equity=initial_equity)
        m = compute_metrics(pr, timeframe=timeframe, trade_pnls=tp)

        windows.append({
            "train_start": str(train["t"].iloc[0]),
            "train_end": str(train["t"].iloc[-1]),
            "test_start": str(test["t"].iloc[0]),
            "test_end": str(test["t"].iloc[-1]),
            "metrics": m.as_dict(),
        })

        start += test_bars

    if windows:
        sharpe_vals = [w["metrics"]["sharpe"] for w in windows if w["metrics"]["sharpe"] is not None]
        mdd_vals = [w["metrics"]["max_drawdown"] for w in windows]
        summary = {
            "windows": len(windows),
            "avg_sharpe": float(np.mean(sharpe_vals)) if sharpe_vals else None,
            "median_max_drawdown": float(np.median(mdd_vals)) if mdd_vals else None,
        }
    else:
        summary = None

    return {"windows": windows, "summary": summary}


def load_default_symbols() -> List[str]:
    here = Path(__file__).resolve()
<<<<<<< HEAD
    candidates = [here.parent / 'watchlist_crypto.json', here.parent.parent / 'watchlist_crypto.json']
    watchlist = next((c for c in candidates if c.exists()), None)
    if watchlist is None:
        return []
    data = json.loads(watchlist.read_text(encoding="utf-8"))
    return [s for s in data.get("symbols", []) if "/" in s]
=======
    candidates = [here.parent / "config.json", here.parent.parent / "config.json"]
    cfg_path = next((c for c in candidates if c.exists()), None)
    if cfg_path is None:
        return []
    data = json.loads(cfg_path.read_text(encoding="utf-8"))
    return [s for s in data.get("watchlist", {}).get("symbols", []) if "/" in s]
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287


def write_reports(out_dir: Path, payload: Dict) -> Tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    json_path = out_dir / f"walkforward_{ts}.json"
    md_path = out_dir / f"walkforward_{ts}.md"

    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [f"# Walk-forward evaluation ({ts} UTC)", ""]
    for tf, by_sym in payload.get("timeframes", {}).items():
        lines.append(f"## Timeframe: {tf}")
        for sym, res in by_sym.items():
            lines.append(f"### {sym}")
            s = res.get("summary")
            if not s:
                lines.append("- No windows (insufficient data)")
                continue
            lines.append(f"- Windows: {s.get('windows')}")
            lines.append(f"- Avg Sharpe (window mean): {s.get('avg_sharpe')}")
            lines.append(f"- Median Max Drawdown: {s.get('median_max_drawdown')}")
        lines.append("")

<<<<<<< HEAD
    md_path.write_text("
".join(lines) + "
", encoding="utf-8")
=======
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
    return json_path, md_path


def main():
<<<<<<< HEAD
    p = argparse.ArgumentParser()
    p.add_argument("--symbols", nargs="*", help="Symbols like BTC/USD. Default: watchlist_crypto.json")
=======
    print("Walkforward evaluation started")

    p = argparse.ArgumentParser()
    p.add_argument("--symbols", nargs="*", help="Symbols like BTC/USD. Default: config.json > watchlist.symbols")
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
    p.add_argument("--timeframes", nargs="*", default=["1H", "4H", "1D"], help="Timeframes to evaluate")
    p.add_argument("--start", required=True, help="ISO date/time, e.g. 2024-01-01")
    p.add_argument("--end", required=True, help="ISO date/time, e.g. 2026-01-01")
    p.add_argument("--train-days", type=int, default=90)
    p.add_argument("--test-days", type=int, default=30)
    p.add_argument("--initial-equity", type=float, default=10000.0)
    p.add_argument("--fee-bps", type=float, default=0.0)
    p.add_argument("--slippage-bps", type=float, default=0.0)
    p.add_argument("--out", default="reports")
    args = p.parse_args()

    symbols = args.symbols or load_default_symbols()
    if not symbols:
        raise SystemExit("No symbols provided and watchlist not found/empty")

<<<<<<< HEAD
    cfg = SimConfig(fee_bps=args.fee_bps, slippage_bps=args.slippage_bps)
=======
    base_cfg = default_sim_config()
    cfg = SimConfig(
        buy_score_threshold=base_cfg.buy_score_threshold,
        buy_score_half_size=base_cfg.buy_score_half_size,
        sell_score_threshold=base_cfg.sell_score_threshold,
        stop_loss_pct=base_cfg.stop_loss_pct,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
    )
    print(
        "  thresholds: buy=%.1f  half=%.1f  sell=%.1f  stop=%.0f%%"
        % (cfg.buy_score_threshold, cfg.buy_score_half_size,
           cfg.sell_score_threshold, cfg.stop_loss_pct * 100)
    )
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287

    report: Dict = {"params": vars(args), "timeframes": {}}

    for tf in args.timeframes:
        res_by_sym = {}
        for sym in symbols:
<<<<<<< HEAD
=======
            print(f"Evaluating symbol: {sym} on timeframe: {tf}")
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
            df = fetch_crypto_bars(sym, tf, args.start, args.end)
            res_by_sym[sym] = walk_forward(df, tf, cfg, args.train_days, args.test_days, args.initial_equity)
        report["timeframes"][tf] = res_by_sym

    out_dir = Path(args.out)
    jp, mp = write_reports(out_dir, report)
    print("Wrote:", jp)
    print("Wrote:", mp)
<<<<<<< HEAD
=======
    print("Walkforward evaluation completed")
>>>>>>> 96f6b1b2fdd58614dd995a49402b62db1fd7e287
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
