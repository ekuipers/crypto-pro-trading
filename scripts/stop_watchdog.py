# scripts/stop_watchdog.py
"""
5-minute stop-loss watchdog (roadmap 2026-07-10 item 7).

Cut losses fast: the hourly evaluation is the only place stops were checked,
so a move between evaluations could run unprotected for up to an hour (and
historically much longer — see Bug #4). This script checks ONLY the exit
levels of open long positions and fires the existing trade.py stop path.
No research, no scoring, no new entries.

Checks per open long, in priority order (same rules as run_evaluation):
  1. Pending SELL order for the symbol -> skip (deduplication; covers stops
     placed by the hourly engine, the dashboard Autopilot, or a previous
     watchdog run).
  2. Trailing stop: HWM from data/positions_state.json; trail width fixed or
     Chandelier (risk.trail_mode) — identical to the hourly engine.
  3. Hard stop: max(4H swing low, breakeven stop) with the fixed -5% fallback.

All orders go through trade.py (limit-only, clamped stop band). State writes
are limited to recording the placed stop order (set_stop_order) so the hourly
engine's dedup/escalation sees it.

Usage:
    python scripts/stop_watchdog.py            # dry-run
    python scripts/stop_watchdog.py --execute  # place stop orders
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import _env  # noqa: F401  -- load .env into os.environ
import indicators as ind
import position_state as ps
from symbols import to_slash
from risk import (
    STOP_LOSS_MODE,
    STOP_LOSS_PCT,
    TRAIL_MODE,
    chandelier_trail_pct,
    should_stop_out,
    should_trail_stop_out,
    stop_loss_limit_price,
    swing_low_stop_price,
)
from trade import (
    TradeRejected,
    get_latest_quote,
    get_open_orders,
    get_positions,
    place_order,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR  = PROJECT_ROOT / "journal"


def check_position(pos: dict, state: dict, execute: bool) -> str | None:
    """Check one open long position; returns a journal line when it acted."""
    sym  = to_slash(pos.get("symbol", ""))
    qty  = float(pos.get("qty") or 0)
    if qty <= 0:
        return None  # long-only

    # Dedup: any pending SELL for this symbol means an exit is in flight.
    try:
        if any(o.get("side") == "sell" for o in get_open_orders(sym)):
            return None
    except Exception:
        return None  # can't verify -> fail safe, do nothing

    ps_pos = ps.get_position(state, sym)
    entry  = float(pos.get("avg_entry_price") or 0)
    if entry <= 0:
        entry = float(ps_pos.get("entry_price") or 0)
    if entry <= 0:
        return None  # no usable cost basis — leave it to the hourly engine

    try:
        q   = get_latest_quote(sym)
        ask = float(q.get("ap") or 0)
        bid = float(q.get("bp") or 0)
    except Exception:
        return None
    cur = bid or ask
    if cur <= 0 or ask <= 0:
        return None

    # 4H bars for the swing-low stop (and ATR for the chandelier trail).
    swing_stop = None
    atr_4h     = None
    if STOP_LOSS_MODE == "swing_low_4h":
        try:
            from run_evaluation import get_crypto_bars_4h
            bars_4h = get_crypto_bars_4h(sym)
            lows    = [float(b.get("l") or 0) for b in bars_4h if b.get("c")]
            highs   = [float(b.get("h") or 0) for b in bars_4h if b.get("c")]
            closes  = [float(b.get("c") or 0) for b in bars_4h if b.get("c")]
            swing_stop = swing_low_stop_price(entry, lows)
            if len(closes) >= 15:
                atr_4h = ind.atr(highs, lows, closes)
        except Exception:
            pass  # fixed -5% fallback below

    # Trailing stop first (supersedes the hard stop once armed).
    hwm = ps_pos.get("high_water_mark") or entry
    trail_pct = None
    if TRAIL_MODE == "chandelier":
        trail_pct = chandelier_trail_pct(cur, atr_4h)
    trail_hit = (should_trail_stop_out(entry, hwm, cur, trail_pct=trail_pct)
                 if trail_pct is not None
                 else should_trail_stop_out(entry, hwm, cur))

    breakeven = ps_pos.get("breakeven_stop")
    eff_stop  = max([s for s in (swing_stop, breakeven) if s], default=None)
    hard_hit  = should_stop_out(entry, cur, stop_price=eff_stop)

    if not (trail_hit or hard_hit):
        return None

    kind = "TRAILING STOP" if trail_hit else (
        "STOP (breakeven)" if eff_stop and breakeven and eff_stop == breakeven
        else "STOP (4H swing low)" if eff_stop
        else "STOP (fixed -%d%%)" % int(STOP_LOSS_PCT * 100))
    lim = stop_loss_limit_price(ask, ps_pos.get("stop_order_cycles", 0))
    line = ("%s %s: entry $%.4f current $%.4f -> SELL %.4f @ $%.4f"
            % (sym, kind, entry, cur, qty, lim))

    if not execute:
        return line + " (dry-run)"
    try:
        result = place_order(sym, qty, "sell", lim, is_stop_loss=True)
        order_id = result.get("id", "")
        if order_id:
            ps.set_stop_order(state, sym, order_id, lim)
        return line + " id=" + order_id[:8]
    except TradeRejected as e:
        return line + " REJECTED: " + str(e)
    except Exception as e:
        return line + " ERROR: " + repr(e)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true",
                        help="place stop orders (default is dry-run)")
    args = parser.parse_args()

    state = ps.load_state()
    try:
        positions = get_positions()
    except Exception as e:
        sys.stderr.write("FAIL: positions fetch: %r\n" % e)
        return 1

    longs = [p for p in positions if float(p.get("qty") or 0) > 0]
    actions = []
    for p in longs:
        line = check_position(p, state, args.execute)
        if line:
            actions.append(line)
            print(line)

    if not actions:
        print("stop watchdog: %d long position(s) checked, no stops hit"
              % len(longs))
        return 0

    # Journal + state only when something happened (a no-op every 5 minutes
    # must not generate commits).
    if args.execute:
        ps.save_state(state)
    now = datetime.now(ZoneInfo("Europe/Amsterdam"))
    JOURNAL_DIR.mkdir(exist_ok=True)
    path = JOURNAL_DIR / (now.strftime("%Y-%m-%d") + ".md")
    with path.open("a", encoding="utf-8") as f:
        f.write("\n## Stop Watchdog %s GMT+2\n\n" % now.strftime("%H:%M"))
        for line in actions:
            f.write("- " + line + "\n")
    print("Wrote: " + str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
