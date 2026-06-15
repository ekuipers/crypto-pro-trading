# tests/test_scout.py
"""Unit tests for scripts/scout.py (universe scout). No network calls."""
from unittest.mock import MagicMock, patch

import scout


def _assets_resp(assets):
    resp = MagicMock()
    resp.json.return_value = assets
    return resp


class TestGetUniverse:
    def test_normalizes_and_filters(self):
        assets = [
            {"symbol": "XRP/USD",  "tradable": True},
            {"symbol": "PEPEUSD",  "tradable": True},   # bare form -> PEPE/USD
            {"symbol": "BTC/USDT", "tradable": True},   # non-USD quote -> drop
            {"symbol": "BTC/USD",  "tradable": True},   # watchlist -> drop
            {"symbol": "SHIB/USD", "tradable": False},  # not tradable -> drop
        ]
        with patch.object(scout, "api_get", return_value=_assets_resp(assets)), \
             patch.object(scout, "_watchlist", return_value=["BTC/USD"]):
            uni = scout.get_universe()
        assert uni == ["PEPE/USD", "XRP/USD"]


class TestScan:
    def test_promotes_only_uptrend_high_score(self, tmp_path):
        scores = {"AAA/USD": 5.0, "BBB/USD": 4.0, "CCC/USD": 2.0}
        with patch.object(scout, "get_universe",
                          return_value=["AAA/USD", "BBB/USD", "CCC/USD", "DDD/USD"]), \
             patch.object(scout, "_daily_uptrend",
                          side_effect=lambda s: s != "DDD/USD"), \
             patch.object(scout, "_confluence", side_effect=lambda s: scores[s]), \
             patch.object(scout, "DYNAMIC_PATH", tmp_path / "watchlist_dynamic.json"):
            payload = scout.scan()
        # CCC below min_score, DDD not uptrend -> only AAA + BBB, ranked
        assert payload["symbols"] == ["AAA/USD", "BBB/USD"]
        assert (tmp_path / "watchlist_dynamic.json").exists()

    def test_max_promoted_cap(self, tmp_path):
        syms = ["S%d/USD" % i for i in range(6)]
        with patch.object(scout, "get_universe", return_value=syms), \
             patch.object(scout, "_daily_uptrend", return_value=True), \
             patch.object(scout, "_confluence", return_value=4.5), \
             patch.object(scout, "MAX_PROMOTED", 3), \
             patch.object(scout, "DYNAMIC_PATH", tmp_path / "wd.json"):
            payload = scout.scan()
        assert len(payload["symbols"]) == 3
