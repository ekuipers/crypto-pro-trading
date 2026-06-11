# scripts/trade.py
"""
Order placement against Alpaca paper API, with the CLAUDE.md rules enforced
in code so they can't be bypassed by a routine that forgets them.

Hard rules (see CLAUDE.md):
  - Never market orders -- limit_price is REQUIRED.
  - Limit must be within config.json > risk.limit_band_pct of current ask.
  - Single position must not exceed the per-symbol cap in
    config.json > portfolio_caps.caps (e.g. 30% for BTC/USD, 5% for LINK/USD).
    Default fallback: 5%.
  - For US equities: never trade when /v2/clock reports the market is closed.
  - For crypto: 24/7 trading, the /v2/clock gate does NOT apply.

All HTTP calls go through _api.api_get / api_post / api_delete which add
exponential-backoff retry on transient errors (config.json > api).

Crypto symbols are detected by the '/' separator (e.g. "BTC/USD"), which is
Alpaca's canonical form. Equity symbols have no slash (e.g. "AAPL").
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
from pathlib import Path

import _env  # noqa: F401  -- side-effect: load .env into os.environ
from _api import api_delete, api_get, api_post
from risk import (
    STOP_LOSS_LIMIT_BAND_PCT,
    check_limit_band,
    check_position_size,
)

ALPACA_KEY    = os.getenv("APCA_API_KEY_ID")
ALPACA_SECRET = os.getenv("APCA_API_SECRET_KEY")
BASE_URL      = os.getenv("APCA_BASE_URL")
DATA_URL      = "https://data.alpaca.markets"

# ---------------------------------------------------------------------------
# Portfolio caps
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_caps() -> dict:
    try:
        cfg = json.loads((_PROJECT_ROOT / "config.json").read_text(encoding="utf-8"))
        return cfg.get("portfolio_caps", {"caps": {}, "default_cap": 0.05})
    except Exception:
        return {"caps": {}, "default_cap": 0.05}


_CAPS_DATA = _load_caps()


def _symbol_cap(symbol: str) -> float:
    """Return the position cap fraction for *symbol* from config.json > portfolio_caps.caps."""
    return _CAPS_DATA["caps"].get(symbol, _CAPS_DATA.get("default_cap", 0.05))


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _headers(json_body: bool = False) -> dict:
    h = {
        "APCA-API-KEY-ID":     ALPACA_KEY or "",
        "APCA-API-SECRET-KEY": ALPACA_SECRET or "",
    }
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def is_crypto(symbol: str) -> bool:
    """Crypto symbols carry a '/' (e.g. BTC/USD). Equities do not."""
    return "/" in (symbol or "")


# ---------------------------------------------------------------------------
# Account / position queries
# ---------------------------------------------------------------------------

def get_market_status() -> dict:
    """Return the /v2/clock payload. Only relevant for US equities."""
    r = api_get(BASE_URL + "/v2/clock", headers=_headers(), timeout=15)
    return r.json()


def get_account() -> dict:
    r = api_get(BASE_URL + "/v2/account", headers=_headers(), timeout=15)
    return r.json()


def get_positions() -> list:
    """Return all open positions from /v2/positions."""
    r = api_get(BASE_URL + "/v2/positions", headers=_headers(), timeout=15)
    return r.json()


def get_latest_quote(symbol: str) -> dict:
    """
    Latest quote, dispatched by asset class. Returns a dict with keys
    'ap' (ask price) and 'bp' (bid price) so callers don't need to care
    which endpoint was hit.
    """
    if is_crypto(symbol):
        url = DATA_URL + "/v1beta3/crypto/us/latest/quotes"
        r = api_get(url, headers=_headers(), params={"symbols": symbol}, timeout=15)
        return r.json().get("quotes", {}).get(symbol, {})

    sym_q = urllib.parse.quote(symbol, safe="")
    url = DATA_URL + "/v2/stocks/" + sym_q + "/quotes/latest"
    r = api_get(url, headers=_headers(), timeout=15)
    return r.json().get("quote", {})


# ---------------------------------------------------------------------------
# Order placement
# ---------------------------------------------------------------------------

class TradeRejected(Exception):
    """Raised when a trade violates a CLAUDE.md rule. Fail closed."""


def place_order(
    symbol: str,
    qty,
    side: str,
    limit_price: float,
    is_stop_loss: bool = False,
) -> dict:
    """
    Place a limit order. Will refuse to send anything that violates the
    CLAUDE.md rules. There is intentionally no way to place a market order
    through this function.

    For crypto symbols (slash-form, e.g. "BTC/USD"): trades 24/7, fractional
    qty allowed, time_in_force is "gtc" (Alpaca requires gtc/ioc for crypto).
    For equities: time_in_force is "day", clock gate enforced, integer qty.

    *is_stop_loss* -- when True, the limit-band check uses the wider
    stop_loss_limit_band_pct (default 0.5%) instead of the normal
    limit_band_pct (0.2%). This allows the stop-loss price to be set far
    enough below the ask to guarantee execution in fast-moving markets.
    """
    if not limit_price or float(limit_price) <= 0:
        raise TradeRejected(
            "limit_price is required -- market orders are forbidden by CLAUDE.md"
        )
    if side not in ("buy", "sell"):
        raise TradeRejected("side must be 'buy' or 'sell', got " + repr(side))

    crypto      = is_crypto(symbol)
    qty         = float(qty) if crypto else int(qty)
    limit_price = float(limit_price)

    # Rule: never trade when equity market is closed. Crypto skips this gate.
    if not crypto:
        clock = get_market_status()
        if not clock.get("is_open"):
            raise TradeRejected(
                "equity market is closed (next_open="
                + str(clock.get("next_open"))
                + ") -- no trades allowed"
            )

    # Rule: limit must be within the configured band of ask.
    # Stop-loss orders use a wider band to ensure they fill in volatile markets.
    quote = get_latest_quote(symbol)
    ask = float(quote.get("ap") or 0)
    if ask <= 0:
        raise TradeRejected(
            symbol + ": no live ask available, cannot validate limit band"
        )
    if is_stop_loss:
        from risk import RiskCheck
        band = ask * STOP_LOSS_LIMIT_BAND_PCT
        diff = abs(limit_price - ask)
        if diff > band:
            # SELF-REJECTION FIX (2026-06-11): the limit was computed from a
            # quote fetched earlier in the evaluation cycle; if price moved
            # more than the band since then, rejecting leaves the position
            # exposed for another full cycle (journals show repeated
            # "limit outside stop-loss 0.5% band" rejections). A stop-loss
            # exists to exit -- clamp the limit to the nearest band edge of
            # the FRESH ask instead of failing. The hard rule (limit within
            # 0.5% of ask) still holds: the clamped price sits exactly on
            # the band boundary.
            clamped = min(max(limit_price, ask - band), ask + band)
            print(
                "%s: stop-loss limit %.4f outside %.1f%% band of ask %.4f "
                "-- clamped to %.4f"
                % (symbol, limit_price, STOP_LOSS_LIMIT_BAND_PCT * 100, ask, clamped)
            )
            limit_price = round(clamped, 6)
        band_check = RiskCheck(True, "ok")
    else:
        band_check = check_limit_band(limit_price, ask)
    if not band_check.ok:
        raise TradeRejected(symbol + ": " + band_check.reason)

    # Rule: per-symbol position cap (buys only).
    if side == "buy":
        equity     = float(get_account().get("equity") or 0)
        cap_pct    = _symbol_cap(symbol)
        size_check = check_position_size(equity, qty, limit_price, cap_pct)
        if not size_check.ok:
            raise TradeRejected(symbol + ": " + size_check.reason)

    order_data = {
        "symbol":        symbol,
        "qty":           str(qty),
        "side":          side,
        "type":          "limit",
        "time_in_force": "gtc" if crypto else "day",
        "limit_price":   str(limit_price),
    }
    r = api_post(
        BASE_URL + "/v2/orders",
        headers=_headers(json_body=True),
        json=order_data,
        timeout=20,
    )
    return r.json()


# ---------------------------------------------------------------------------
# Order queries
# ---------------------------------------------------------------------------

def get_open_orders(symbol=None) -> list:
    """
    Return all open (pending) orders, optionally filtered to *symbol*.

    Alpaca returns crypto symbols without a slash in the orders response
    (e.g. "BTCUSD" instead of "BTC/USD"), so this function normalises both
    the stored and compared values to slash form for consistent matching.
    """
    params = {"status": "open", "limit": 100}
    r = api_get(BASE_URL + "/v2/orders", headers=_headers(), params=params, timeout=15)
    orders = r.json() if isinstance(r.json(), list) else []

    if symbol is None:
        return orders

    def _slash(s: str) -> str:
        if "/" in s:
            return s
        if s.endswith("USD"):
            return s[:-3] + "/USD"
        return s

    target = _slash(symbol).upper()
    return [o for o in orders if _slash(o.get("symbol", "")).upper() == target]


def get_order(order_id: str) -> dict:
    """Fetch a single order by ID."""
    r = api_get(
        BASE_URL + "/v2/orders/" + order_id,
        headers=_headers(),
        timeout=15,
    )
    return r.json()


def cancel_order(order_id: str) -> bool:
    """
    Cancel a single order by ID. Returns True if the cancellation was accepted
    (204 or 200), False otherwise. Does not raise on 404 (already filled/gone).
    """
    try:
        r = api_delete(
            BASE_URL + "/v2/orders/" + order_id,
            headers=_headers(),
            timeout=15,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def cancel_all_orders() -> int:
    r = api_delete(BASE_URL + "/v2/orders", headers=_headers(), timeout=15)
    return r.status_code


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "status"

    if action == "status":
        import json as _json
        print(_json.dumps(get_market_status(), indent=2))

    elif action == "quote":
        if len(sys.argv) < 3:
            sys.stderr.write("usage: trade.py quote SYMBOL\n")
            sys.exit(2)
        import json as _json
        print(_json.dumps(get_latest_quote(sys.argv[2]), indent=2))

    elif action == "order":
        if len(sys.argv) < 6:
            sys.stderr.write("usage: trade.py order SYMBOL QTY SIDE LIMIT_PRICE\n")
            sys.exit(2)
        try:
            import json as _json
            result = place_order(sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]))
            print(_json.dumps(result, indent=2))
        except TradeRejected as e:
            sys.stderr.write("REJECTED: " + str(e) + "\n")
            sys.exit(1)

    elif action == "cancel":
        print(cancel_all_orders())

    else:
        sys.stderr.write("unknown action: " + action + "\n")
        sys.exit(2)
