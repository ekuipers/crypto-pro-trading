# tests/test_symbols.py
"""Canonical symbol notation (scripts/symbols.py, roadmap 2026-07-09)."""
import pytest

from symbols import to_slash


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("BTCUSD", "BTC/USD"),          # bare Alpaca form -> canonical
        ("ETHUSD", "ETH/USD"),
        ("BTCUSDT", "BTC/USDT"),        # longest quote wins over USD
        ("ETHUSDC", "ETH/USDC"),
        ("USDTUSD", "USDT/USD"),        # stablecoin base against USD
        ("BTC/USD", "BTC/USD"),         # already canonical: unchanged
        ("BTC/USDT", "BTC/USDT"),
        ("SOLBTC", "SOLBTC"),           # unknown quote: unchanged
        ("USD", "USD"),                 # quote alone: no empty base
        ("", ""),                       # empty input: unchanged
    ],
)
def test_to_slash(raw, expected):
    assert to_slash(raw) == expected
