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

    def test_follows_next_page_token(self):
        """Bug #2 (2026-07-10): Alpaca caps one response at ~7 days of bars
        (4Hour limit=120 returned only 43). The fetch must follow
        next_page_token until `limit` bars are collected."""
        page1 = MagicMock()
        page1.json.return_value = {
            "bars": {"BTC/USD": [{"t": "2026-07-10T08:00:00Z", "c": 2}]},
            "next_page_token": "tok123",
        }
        page2 = MagicMock()
        page2.json.return_value = {
            "bars": {"BTC/USD": [{"t": "2026-07-03T08:00:00Z", "c": 1}]},
            "next_page_token": None,
        }
        with patch.object(re_mod, "api_get", side_effect=[page1, page2]) as m:
            bars = re_mod.get_crypto_bars("BTC/USD", limit=2, timeframe="4Hour")
        assert [b["c"] for b in bars] == [1, 2]  # chronological across pages
        assert m.call_count == 2
        assert m.call_args_list[1].kwargs["params"]["page_token"] == "tok123"

    def test_stops_at_limit_without_extra_page(self):
        page1 = MagicMock()
        page1.json.return_value = {
            "bars": {"BTC/USD": [{"t": "2026-07-10T08:00:00Z", "c": 2},
                                 {"t": "2026-07-10T04:00:00Z", "c": 1}]},
            "next_page_token": "tok123",
        }
        with patch.object(re_mod, "api_get", side_effect=[page1]) as m:
            bars = re_mod.get_crypto_bars("BTC/USD", limit=2, timeframe="4Hour")
        assert len(bars) == 2
        assert m.call_count == 1  # limit satisfied — no second request


class TestAggregateBarsTo4h:
    """4H data fallback (roadmap 2026-07-09 item 6): synthetic 4H from 1H bars."""

    def _hour_bars(self, start_hour, n):
        bars = []
        for i in range(n):
            h = start_hour + i
            bars.append({
                "t": "2026-07-09T%02d:00:00Z" % (h % 24),
                "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i,
                "c": 100.5 + i, "v": 10.0,
            })
        return bars

    def test_aggregates_complete_bucket(self):
        # 04:00–07:00 = one complete 4H bucket
        bars = self._hour_bars(4, 4)
        out = re_mod.aggregate_bars_to_4h(bars)
        assert len(out) == 1
        b = out[0]
        assert b["t"] == "2026-07-09T04:00:00Z"
        assert b["o"] == 100.0            # first bar's open
        assert b["c"] == 100.5 + 3        # last bar's close
        assert b["h"] == 101.0 + 3        # max high
        assert b["l"] == 99.0             # min low
        assert b["v"] == 40.0             # summed volume

    def test_drops_partial_bucket(self):
        # 04:00–06:00 = only 3 of 4 hourly bars — bucket must be dropped
        bars = self._hour_bars(4, 3)
        assert re_mod.aggregate_bars_to_4h(bars) == []

    def test_two_buckets(self):
        bars = self._hour_bars(0, 8)      # 00–03 and 04–07
        out = re_mod.aggregate_bars_to_4h(bars)
        assert [b["t"] for b in out] == [
            "2026-07-09T00:00:00Z", "2026-07-09T04:00:00Z"
        ]

    def test_skips_malformed_bars(self):
        bars = self._hour_bars(4, 4)
        bars.insert(0, {"t": None, "c": 1})
        bars.insert(0, {"t": "not-a-date", "c": 1})
        assert len(re_mod.aggregate_bars_to_4h(bars)) == 1
