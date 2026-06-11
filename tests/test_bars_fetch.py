# tests/test_bars_fetch.py
"""
Regression tests for the stale-bars bug in run_evaluation.get_crypto_bars.

Bug (fixed 2026-06-11): Alpaca returns bars oldest-first by default. With
`start` ~1.6x the needed window back and `limit=N`, the API returned the
*first* N bars of the window — daily bars were up to 54 days stale, which
inverted the daily regime gate. Fix: request `sort=desc` (newest N bars)
and reverse the response back to chronological order.

No network calls — api_get is mocked.
"""
from unittest.mock import MagicMock, patch

import run_evaluation as re_mod


def _mock_response(bars_desc):
    resp = MagicMock()
    resp.json.return_value = {"bars": {"BTC/USD": bars_desc}}
    return resp


class TestGetCryptoBars:
    def test_requests_sort_desc(self):
        """The API call must ask for the newest bars, not the oldest."""
        with patch.object(re_mod, "api_get", return_value=_mock_response([])) as m:
            re_mod.get_crypto_bars("BTC/USD", limit=10, timeframe="15Min")
        params = m.call_args.kwargs["params"]
        assert params["sort"] == "desc"
        assert params["limit"] == 10
        assert "start" in params and "end" in params

    def test_result_is_chronological(self):
        """Descending API payload must be reversed to oldest->newest."""
        desc = [
            {"t": "2026-06-11T08:00:00Z", "c": 3},
            {"t": "2026-06-11T07:45:00Z", "c": 2},
            {"t": "2026-06-11T07:30:00Z", "c": 1},
        ]
        with patch.object(re_mod, "api_get", return_value=_mock_response(desc)):
            bars = re_mod.get_crypto_bars("BTC/USD", limit=3)
        ts = [b["t"] for b in bars]
        assert ts == sorted(ts)
        assert bars[-1]["t"] == "2026-06-11T08:00:00Z"  # newest bar last

    def test_empty_response(self):
        with patch.object(re_mod, "api_get", return_value=_mock_response([])):
            assert re_mod.get_crypto_bars("BTC/USD") == []
