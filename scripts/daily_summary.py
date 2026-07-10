# scripts/daily_summary.py
"""
Closing daily-journal summary (Bug #4, 2026-07-10).

The 23:21 GMT+2 scheduled job used to run a second evaluation, so the
"daily summary" commits contained an evaluation block and no P&L at all.
This script writes the actual closing summary the CLAUDE.md schedule
promises: equity and day change, cash, open positions with unrealized P&L,
today's fills, and realized P&L for round trips closed today (FIFO over the
full fill history — same matching rule as the dashboard Edge/P&L tabs).

Usage:
    python scripts/daily_summary.py
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import _env  # noqa: F401  -- load .env into os.environ
from run_evaluation import _fetch_all_fills
from symbols import to_slash
from trade import get_account, get_positions

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR  = PROJECT_ROOT / "journal"
TZ           = ZoneInfo("Europe/Amsterdam")


def _fill_dt(act: dict) -> datetime | None:
    when = act.get("transaction_time") or act.get("date")
    try:
        return datetime.fromisoformat(str(when).replace("Z", "+00:00")).astimezone(TZ)
    except Exception:
        return None


def realized_pnl_today(fills: list, today: str) -> tuple[float, int]:
    """FIFO round-trip P&L for SELL fills whose exit lands on *today* (GMT+2).

    SELLs with no prior matched BUY are excluded, same as the dashboard's
    computeFifoStats()/edgeFifoTrades.
    """
    queues: dict = {}
    pnl_today, exits_today = 0.0, 0
    for act in reversed(fills):  # fills arrive newest-first; walk chronological
        sym   = to_slash(act.get("symbol") or "")
        side  = act.get("side")
        qty   = abs(float(act.get("qty") or 0))
        price = float(act.get("price") or 0)
        if not sym or qty <= 0 or price <= 0:
            continue
        queues.setdefault(sym, [])
        if side == "buy":
            queues[sym].append([qty, price])
        elif side == "sell":
            remaining, pnl, matched = qty, 0.0, False
            while remaining > 1e-9 and queues[sym]:
                lot = queues[sym][0]
                m = min(remaining, lot[0])
                pnl       += m * (price - lot[1])
                lot[0]    -= m
                remaining -= m
                matched = True
                if lot[0] < 1e-6:
                    queues[sym].pop(0)
            if not matched:
                continue
            dt = _fill_dt(act)
            if dt and dt.strftime("%Y-%m-%d") == today:
                pnl_today  += pnl
                exits_today += 1
    return pnl_today, exits_today


def build_summary(now: datetime) -> str:
    account   = get_account()
    positions = get_positions()
    fills     = _fetch_all_fills()

    equity      = float(account.get("equity") or 0)
    last_equity = float(account.get("last_equity") or 0)
    cash        = float(account.get("cash") or 0)
    day_pnl     = equity - last_equity if last_equity else 0.0
    day_pct     = (day_pnl / last_equity * 100) if last_equity else 0.0
    today       = now.strftime("%Y-%m-%d")

    fills_today = [a for a in fills
                   if (d := _fill_dt(a)) and d.strftime("%Y-%m-%d") == today]
    realized, exits = realized_pnl_today(fills, today)

    lines = ["", "## Daily Summary %s GMT+2" % now.strftime("%H:%M"), ""]
    lines.append("- Equity: $%.2f (day %+.2f / %+.2f%% vs previous close)"
                 % (equity, day_pnl, day_pct))
    lines.append("- Cash: $%.2f (%.1f%% of equity)"
                 % (cash, (cash / equity * 100) if equity else 0.0))
    lines.append("- Fills today: %d  |  Round trips closed today: %d  |  "
                 "Realized P&L today: $%+.2f" % (len(fills_today), exits, realized))
    lines.append("")

    if positions:
        lines.append("### Open positions")
        for p in positions:
            sym   = to_slash(p.get("symbol", ""))
            qty   = float(p.get("qty") or 0)
            entry = float(p.get("avg_entry_price") or 0)
            cur   = float(p.get("current_price") or 0)
            upl   = float(p.get("unrealized_pl") or 0)
            pct   = ((cur - entry) / entry * 100) if entry > 0 else 0.0
            lines.append("- %s %.4f @ $%.4f -> $%.4f (%+.2f%%, $%+.2f unrealized)"
                         % (sym, qty, entry, cur, pct, upl))
    else:
        lines.append("### Open positions")
        lines.append("- none (flat)")
    lines.append("")

    if fills_today:
        lines.append("### Trades today")
        for a in sorted(fills_today, key=lambda x: _fill_dt(x) or now):
            dt = _fill_dt(a)
            lines.append("- %s %s %s %.4f @ $%.4f"
                         % (dt.strftime("%H:%M") if dt else "??:??",
                            (a.get("side") or "?").upper(),
                            to_slash(a.get("symbol") or "?"),
                            abs(float(a.get("qty") or 0)),
                            float(a.get("price") or 0)))
    else:
        lines.append("### Trades today")
        lines.append("- No trades — no fills recorded today.")
    return "\n".join(lines) + "\n"


def main() -> int:
    now = datetime.now(TZ)
    try:
        block = build_summary(now)
    except Exception as e:
        sys.stderr.write("FAIL: daily summary: %r\n" % e)
        return 1
    JOURNAL_DIR.mkdir(exist_ok=True)
    path = JOURNAL_DIR / (now.strftime("%Y-%m-%d") + ".md")
    with path.open("a", encoding="utf-8") as f:
        f.write(block)
    print("Wrote daily summary to " + str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
