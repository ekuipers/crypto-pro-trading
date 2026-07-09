# scripts/scout.py
"""
Universe scout -- finds tradable, uptrending, high-confluence symbols OUTSIDE
the static config.json watchlist and promotes them for evaluation.

Why: the 10 watchlist majors correlate at ~0.8. When BTC enters mark-down the
whole list is blocked by the daily regime gate and the bot sits 100% in cash.
The wider Alpaca universe usually contains a few genuinely uptrending pairs;
promoting the best of them is the largest available profit lever that keeps
every existing hard rule intact (promoted symbols get the 5% default cap,
Tier-2 correlation budget, score >= 4 entry gate, ATR sizing, stops).

Flow (config.json > scout):
  1. Fetch active tradable crypto assets (/v2/assets), keep */USD pairs,
     drop anything already in the watchlist.
  2. Cheap filter: daily bars -> keep confirmed UPTREND only
     (last > SMA50 and SMA20 > SMA50 -- same regime rule as run_evaluation).
  3. Full 6-point confluence (15-min + 4H) on the survivors.
  4. Keep score >= min_score (default 4.0), rank by score, take max_promoted.
  5. Write data/watchlist_dynamic.json (atomic).

run_evaluation.main() merges the promoted symbols when scout.enabled is true
and refreshes this file when older than scout.ttl_hours. Analysis-only:
this module never places orders.

CLI:
    python scripts/scout.py            # respect TTL
    python scripts/scout.py --force    # rescan now
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import _env  # noqa: F401
import indicators as ind
from _api import api_get
from symbols import to_slash
from run_evaluation import (
    _CFG,
    _headers,
    get_crypto_bars,
    get_crypto_bars_4h,
    get_crypto_bars_daily,
)

BASE_URL = os.getenv("APCA_BASE_URL")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DYNAMIC_PATH  = _PROJECT_ROOT / "data" / "watchlist_dynamic.json"

_SCOUT_CFG    = _CFG.get("scout", {})
ENABLED       = bool(_SCOUT_CFG.get("enabled", False))
MAX_PROMOTED  = int(_SCOUT_CFG.get("max_promoted", 3))
MIN_SCORE     = float(_SCOUT_CFG.get("min_score", 4.0))
TTL_HOURS     = float(_SCOUT_CFG.get("ttl_hours", 6.0))
MAX_SCAN      = int(_SCOUT_CFG.get("max_scan", 60))

_QUOTE_SUFFIXES = ("/USDT", "/USDC", "/BTC", "/ETH")


def _watchlist() -> list:
    return list(_CFG.get("watchlist", {}).get("symbols", []))


def get_universe() -> list:
    """Active tradable */USD crypto pairs, excluding the static watchlist."""
    r = api_get(
        BASE_URL + "/v2/assets",
        headers=_headers(),
        params={"asset_class": "crypto", "status": "active"},
        timeout=20,
    )
    wl = set(_watchlist())
    out = []
    for a in r.json():
        if not a.get("tradable"):
            continue
        sym = to_slash(a.get("symbol") or "")    # canonical BASE/QUOTE form
        if not sym.endswith("/USD") or sym.endswith(_QUOTE_SUFFIXES):
            continue
        if sym in wl or sym in out:
            continue
        out.append(sym)
    return sorted(out)[:MAX_SCAN]


def _daily_uptrend(symbol: str) -> bool:
    bars = get_crypto_bars_daily(symbol)
    closes = [float(b.get("c") or 0) for b in bars if b.get("c")]
    if len(closes) < 50:
        return False
    ma20, ma50, last = ind.sma(closes, 20), ind.sma(closes, 50), closes[-1]
    return last > ma50 and ma20 > ma50


def _confluence(symbol: str):
    bars = get_crypto_bars(symbol)
    closes  = [float(b.get("c") or 0) for b in bars if b.get("c")]
    if len(closes) < 60:
        return None
    highs   = [float(b.get("h") or 0) for b in bars if b.get("c")]
    lows    = [float(b.get("l") or 0) for b in bars if b.get("c")]
    volumes = [float(b.get("v") or 0) for b in bars if b.get("c")]
    closes_4h = None
    try:
        c4 = [float(b.get("c") or 0) for b in get_crypto_bars_4h(symbol) if b.get("c")]
        closes_4h = c4 if len(c4) >= 51 else None
    except Exception:
        pass
    score, _ = ind.signal_score(closes, volumes=volumes, highs=highs,
                                lows=lows, closes_4h=closes_4h)
    return score


def scan() -> dict:
    """Full scan. Returns and atomically writes the dynamic-watchlist payload."""
    candidates = []
    universe = get_universe()
    for sym in universe:
        try:
            if not _daily_uptrend(sym):
                continue
            score = _confluence(sym)
        except Exception as e:
            print("scout: %s skipped (%r)" % (sym, e))
            continue
        if score is not None and score >= MIN_SCORE:
            candidates.append({"symbol": sym, "score": score})
    candidates.sort(key=lambda c: c["score"], reverse=True)
    promoted = candidates[:MAX_PROMOTED]
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scanned":   len(universe),
        "min_score": MIN_SCORE,
        "symbols":   [c["symbol"] for c in promoted],
        "details":   promoted,
    }
    DYNAMIC_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(DYNAMIC_PATH.parent), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp, str(DYNAMIC_PATH))
    return payload


def _age_hours() -> float:
    try:
        data = json.loads(DYNAMIC_PATH.read_text())
        gen = datetime.strptime(data["generated"], "%Y-%m-%dT%H:%M:%SZ")
        gen = gen.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - gen).total_seconds() / 3600.0
    except Exception:
        return float("inf")


def promoted_symbols(refresh: bool = True) -> list:
    """Promoted symbols list, rescanning first when the file exceeds TTL."""
    if refresh and _age_hours() > TTL_HOURS:
        scan()
    try:
        return list(json.loads(DYNAMIC_PATH.read_text()).get("symbols", []))
    except Exception:
        return []


if __name__ == "__main__":
    force = "--force" in sys.argv
    if force or _age_hours() > TTL_HOURS:
        result = scan()
        print(json.dumps(result, indent=2))
    else:
        print("scout: dynamic watchlist fresh (%.1f h old, TTL %.1f h)"
              % (_age_hours(), TTL_HOURS))
