# scripts/research.py
"""
Ad-hoc data inspector for the crypto paper portfolio. Used for one-off
manual lookups; the scheduled routines call scripts/run_evaluation.py
instead, which produces structured journal output.

Usage:
    python scripts/research.py account
    python scripts/research.py positions
    python scripts/research.py bars   BTC/USD              # default 15Min, last 100
    python scripts/research.py bars   BTC/USD 1Day  60
    python scripts/research.py news   BTC/USD              # last 5 headlines
    python scripts/research.py quote  BTC/USD              # latest NBBO
"""

import os
import sys
import json
import urllib.parse
import requests

import _env  # noqa: F401

ALPACA_KEY = os.getenv("APCA_API_KEY_ID")
ALPACA_SECRET = os.getenv("APCA_API_SECRET_KEY")
BASE_URL = os.getenv("APCA_BASE_URL")
DATA_URL = "https://data.alpaca.markets"


def _hdr():
    return {
        "APCA-API-KEY-ID": ALPACA_KEY or "",
        "APCA-API-SECRET-KEY": ALPACA_SECRET or "",
    }


def get_account():
    r = requests.get(BASE_URL + "/v2/account", headers=_hdr(), timeout=15)
    r.raise_for_status()
    return r.json()


def get_positions():
    r = requests.get(BASE_URL + "/v2/positions", headers=_hdr(), timeout=15)
    r.raise_for_status()
    return r.json()


def get_bars(symbol, timeframe="15Min", limit=100):
    """Crypto bars by default. Auto-detects asset class from the symbol."""
    if "/" in symbol:
        # crypto
        params = {"symbols": symbol, "timeframe": timeframe, "limit": limit}
        url = DATA_URL + "/v1beta3/crypto/us/bars"
        r = requests.get(url, headers=_hdr(), params=params, timeout=20)
        r.raise_for_status()
        return r.json().get("bars", {}).get(symbol, [])
    # equities path -- still works if you want to inspect a stock
    sym_q = urllib.parse.quote(symbol, safe="")
    params = {"timeframe": timeframe, "limit": limit, "adjustment": "raw"}
    url = DATA_URL + "/v2/stocks/" + sym_q + "/bars"
    r = requests.get(url, headers=_hdr(), params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("bars", [])


def get_quote(symbol):
    if "/" in symbol:
        params = {"symbols": symbol}
        url = DATA_URL + "/v1beta3/crypto/us/latest/quotes"
        r = requests.get(url, headers=_hdr(), params=params, timeout=15)
        r.raise_for_status()
        return r.json().get("quotes", {}).get(symbol, {})
    sym_q = urllib.parse.quote(symbol, safe="")
    url = DATA_URL + "/v2/stocks/" + sym_q + "/quotes/latest"
    r = requests.get(url, headers=_hdr(), timeout=15)
    r.raise_for_status()
    return r.json().get("quote", {})


def get_news(symbol, limit=5):
    params = {"symbols": symbol, "limit": limit, "sort": "desc"}
    url = DATA_URL + "/v1beta1/news"
    r = requests.get(url, headers=_hdr(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    action = sys.argv[1]

    if action == "account":
        print(json.dumps(get_account(), indent=2))
    elif action == "positions":
        print(json.dumps(get_positions(), indent=2))
    elif action == "bars":
        if len(sys.argv) < 3:
            print("usage: research.py bars SYMBOL [TIMEFRAME] [LIMIT]", file=sys.stderr)
            sys.exit(2)
        symbol = sys.argv[2]
        timeframe = sys.argv[3] if len(sys.argv) > 3 else "15Min"
        limit = int(sys.argv[4]) if len(sys.argv) > 4 else 100
        print(json.dumps(get_bars(symbol, timeframe, limit), indent=2))
    elif action == "quote":
        if len(sys.argv) < 3:
            print("usage: research.py quote SYMBOL", file=sys.stderr)
            sys.exit(2)
        print(json.dumps(get_quote(sys.argv[2]), indent=2))
    elif action == "news":
        if len(sys.argv) < 3:
            print("usage: research.py news SYMBOL", file=sys.stderr)
            sys.exit(2)
        print(json.dumps(get_news(sys.argv[2]), indent=2))
    else:
        print("unknown action: " + action, file=sys.stderr)
        sys.exit(2)
