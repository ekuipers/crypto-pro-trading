# scripts/trade.py
"""
Order placement against Alpaca paper API, with the CLAUDE.md rules enforced
in code so they can't be bypassed by a routine that forgets them.

Hard rules (see CLAUDE.md):
  - Never market orders -- limit_price is REQUIRED.
  - Limit must be within 0.2% of current ask.
  - Single position must not exceed the per-symbol cap in portfolio_caps.json
    (e.g. 30% for BTC/USD, 5% for LINK/USD).  Default fallback: 5%.
  - For US equities: never trade when /v2/clock reports the market is closed.
  - For crypto: 24/7 trading, the /v2/clock gate does NOT apply.

Crypto symbols are detected by the '/' separator (e.g. "BTC/USD"), which is
Alpaca's canonical form. Equity symbols have no slash (e.g. "AAPL").
"""

import os
import sys
import json
import urllib.parse
from pathlib import Path
import requests

import _env  # noqa: F401  -- side-effect: load .env into os.environ
from risk import (
    check_position_size,
    check_limit_band,
)

ALPACA_KEY = os.getenv("APCA_API_KEY_ID")
ALPACA_SECRET = os.getenv("APCA_API_SECRET_KEY")
BASE_URL = os.getenv("APCA_BASE_URL")
DATA_URL = "https://data.alpaca.markets"

# Load per-symbol position caps from portfolio_caps.json (project root).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CAPS_FILE    = _PROJECT_ROOT / "portfolio_caps.json"

def _load_caps() -> dict:
    try:
        with open(_CAPS_FILE) as f:
            return json.load(f)
    except Exception:
        return {"caps": {}, "default_cap": 0.05}

_CAPS_DATA = _load_caps()

def _symbol_cap(symbol: str) -> float:
    """Return the position cap fraction for *symbol* from portfolio_caps.json."""
    return _CAPS_DATA["caps"].get(symbol, _CAPS_DATA.get("default_cap", 0.05))


def _headers(json_body=False):
    h = {
        "APCA-API-KEY-ID": ALPACA_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET,
    }
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def is_crypto(symbol):
    """Crypto symbols carry a '/' (e.g. BTC/USD). Equities do not."""
    return "/" in (symbol or "")


def get_market_status():
    """Return the /v2/clock payload. Only relevant for US equities."""
    r = requests.get(BASE_URL + "/v2/clock", headers=_headers())
    r.raise_for_status()
    return r.json()


def get_account():
    r = requests.get(BASE_URL + "/v2/account", headers=_headers())
    r.raise_for_status()
    return r.json()


def get_latest_quote(symbol):
    """
    Latest quote, dispatched by asset class. Returns a dict with keys
    'ap' (ask price) and 'bp' (bid price) so callers don't need to care
    which endpoint was hit.
    """
    if is_crypto(symbol):
        # /v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD
        params = {"symbols": symbol}
        url = DATA_URL + "/v1beta3/crypto/us/latest/quotes"
        r = requests.get(url, headers=_headers(), params=params)
        r.raise_for_status()
        quotes = r.json().get("quotes", {})
        return quotes.get(symbol, {})
    # Equities: /v2/stocks/{symbol}/quotes/latest
    sym_q = urllib.parse.quote(symbol, safe="")
    url = DATA_URL + "/v2/stocks/" + sym_q + "/quotes/latest"
    r = requests.get(url, headers=_headers())
    r.raise_for_status()
    return r.json().get("quote", {})


class TradeRejected(Exception):
    """Raised when a trade violates a CLAUDE.md rule. Fail closed."""


def place_order(symbol, qty, side, limit_price):
    """
    Place a limit order. Will refuse to send anything that violates the
    CLAUDE.md rules. There is intentionally no way to place a market order
    through this function.

    For crypto symbols (slash-form, e.g. "BTC/USD"): trades 24/7, fractional
    qty allowed, time_in_force is "gtc" (Alpaca requires gtc/ioc for crypto).
    For equities: time_in_force is "day", clock gate enforced, integer qty.
    """
    if not limit_price or float(limit_price) <= 0:
        raise TradeRejected(
            "limit_price is required -- market orders are forbidden by CLAUDE.md"
        )
    if side not in ("buy", "sell"):
        raise TradeRejected("side must be 'buy' or 'sell', got " + repr(side))

    crypto = is_crypto(symbol)
    qty = float(qty) if crypto else int(qty)
    limit_price = float(limit_price)

    # Rule: never trade when equity market is closed. Crypto skips this gate.
    if not crypto:
        clock = get_market_status()
        if not clock.get("is_open"):
            raise TradeRejected(
                "equity market is closed (next_open=" + str(clock.get("next_open"))
                + ") -- no trades allowed"
            )

    # Rule: limit must be within 0.2% of ask, enforced at submission time.
    quote = get_latest_quote(symbol)
    ask = float(quote.get("ap") or 0)
    if ask <= 0:
        raise TradeRejected(symbol + ": no live ask available, cannot validate limit band")
    band_check = check_limit_band(limit_price, ask)
    if not band_check.ok:
        raise TradeRejected(symbol + ": " + band_check.reason)

    # Rule: per-symbol position cap (buys only -- closing a position never
    # creates new exposure, so we skip the size check on sells).
    if side == "buy":
        equity = float(get_account().get("equity") or 0)
        cap_pct = _symbol_cap(symbol)
        size_check = check_position_size(equity, qty, limit_price, cap_pct)
        if not size_check.ok:
            raise TradeRejected(symbol + ": " + size_check.reason)

    order_data = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": "limit",
        "time_in_force": "gtc" if crypto else "day",
        "limit_price": str(limit_price),
    }
    r = requests.post(BASE_URL + "/v2/orders",
                      headers=_headers(json_body=True),
                      json=order_data)
    return r.json()


def cancel_all_orders():
    r = requests.delete(BASE_URL + "/v2/orders", headers=_headers())
    return r.status_code


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "status"

    if action == "status":
        # Equity-clock status. For crypto, clock is not the right gate.
        print(json.dumps(get_market_status(), indent=2))
    elif action == "quote":
        if len(sys.argv) < 3:
            sys.stderr.write("usage: trade.py quote SYMBOL\n")
            sys.exit(2)
        print(json.dumps(get_latest_quote(sys.argv[2]), indent=2))
    elif action == "order":
        # Usage: trade.py order SYMBOL QTY SIDE LIMIT_PRICE
        if len(sys.argv) < 6:
            sys.stderr.write("usage: trade.py order SYMBOL QTY SIDE LIMIT_PRICE\n")
            sys.exit(2)
        symbol = sys.argv[2]
        qty = sys.argv[3]
        side = sys.argv[4]
        limit_price = sys.argv[5]
        try:
            result = place_order(symbol, qty, side, limit_price)
            print(json.dumps(result, indent=2))
        except TradeRejected as e:
            sys.stderr.write("REJECTED: " + str(e) + "\n")
            sys.exit(1)
    elif action == "cancel":
        print(cancel_all_orders())
    else:
        sys.stderr.write("unknown action: " + action + "\n")
        sys.exit(2)
