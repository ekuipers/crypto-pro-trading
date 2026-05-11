# scripts/verify.py
"""Read-only smoke test against Alpaca paper API."""

import os
import sys
import requests
import _env  # noqa: F401

ALPACA_KEY = os.getenv("APCA_API_KEY_ID")
ALPACA_SECRET = os.getenv("APCA_API_SECRET_KEY")
BASE_URL = os.getenv("APCA_BASE_URL")


def hdr():
    return {
        "APCA-API-KEY-ID": ALPACA_KEY or "",
        "APCA-API-SECRET-KEY": ALPACA_SECRET or "",
    }


def main():
    if not (ALPACA_KEY and ALPACA_SECRET and BASE_URL):
        sys.stderr.write("FAIL: env vars not set\n")
        return 1
    if "paper" not in BASE_URL:
        sys.stderr.write("WARN: BASE_URL is not a paper URL: " + BASE_URL + "\n")

    try:
        a = requests.get(BASE_URL + "/v2/account", headers=hdr(), timeout=10)
        a.raise_for_status()
        acct = a.json()
        c = requests.get(BASE_URL + "/v2/clock", headers=hdr(), timeout=10)
        c.raise_for_status()
        clock = c.json()
        p = requests.get(BASE_URL + "/v2/positions", headers=hdr(), timeout=10)
        p.raise_for_status()
        positions = p.json()
    except Exception as e:
        sys.stderr.write("FAIL: " + repr(e) + "\n")
        return 1

    eq = float(acct.get("equity", 0))
    cash = float(acct.get("cash", 0))
    bp = float(acct.get("buying_power", 0))

    print("OK: Alpaca paper API reachable")
    print("  base_url      : " + BASE_URL)
    print("  account_status: " + str(acct.get("status")))
    print("  account_number: " + str(acct.get("account_number")))
    print("  equity        : $" + format(eq, ",.2f"))
    print("  cash          : $" + format(cash, ",.2f"))
    print("  buying_power  : $" + format(bp, ",.2f"))
    print("  market_open   : " + str(clock.get("is_open")))
    print("  next_open     : " + str(clock.get("next_open")))
    print("  open_positions: " + str(len(positions)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
