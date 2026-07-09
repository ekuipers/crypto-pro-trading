# scripts/symbols.py
"""
Canonical symbol-notation helpers (roadmap 2026-07-09).

Design rule: the canonical symbol notation everywhere in this project --
config.json, journals, console logs, state files, and the dashboard -- is the
slash pair form ``BASE/QUOTE`` (e.g. ``BTC/USD``). Alpaca returns crypto
symbols WITHOUT the slash (``BTCUSD``) in the positions / orders / activities
responses, so conversion to canonical form happens at that API boundary and
nowhere else.

This module is the single Python source for that conversion. It mirrors the
dashboard's ``toSlash()`` helper in ``docs/dashboard_professional.html``
(same quote list, longest match first) -- keep the two in sync.
"""
from __future__ import annotations

# Longest first so BTCUSDT -> BTC/USDT, not BTCUS/DT or BTCU/SDT.
_QUOTES = ("USDT", "USDC", "USD")


def to_slash(sym: str) -> str:
    """Normalise an Alpaca crypto symbol to canonical ``BASE/QUOTE`` form.

    ``'BTCUSD' -> 'BTC/USD'``, ``'BTCUSDT' -> 'BTC/USDT'``. Already-slashed
    symbols and symbols with an unrecognised quote are returned unchanged.
    """
    if not sym or "/" in sym:
        return sym
    for quote in _QUOTES:
        if sym.endswith(quote) and len(sym) > len(quote):
            return sym[: -len(quote)] + "/" + quote
    return sym


if __name__ == "__main__":
    assert to_slash("BTCUSD") == "BTC/USD"
    assert to_slash("BTC/USD") == "BTC/USD"
    assert to_slash("BTCUSDT") == "BTC/USDT"
    assert to_slash("BTCUSDC") == "BTC/USDC"
    assert to_slash("USDTUSD") == "USDT/USD"
    assert to_slash("SOLBTC") == "SOLBTC"      # unknown quote: unchanged
    assert to_slash("USD") == "USD"            # quote alone: unchanged
    assert to_slash("") == ""
    print("symbols.py self-checks passed")
