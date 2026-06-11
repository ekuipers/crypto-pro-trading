# tests/test_trade_stop_clamp.py
"""
Regression tests for the stop-loss self-rejection fix in trade.place_order.

Bug (fixed 2026-06-11): stop-loss limits were computed from a quote fetched
earlier in the evaluation cycle; if price moved more than the 0.5% band by
submission time, place_order rejected its own stop-loss and the position
stayed exposed for another full cycle. Fix: clamp the limit to the nearest
band edge of the fresh ask instead of rejecting.

No network calls — quotes and order POST are mocked.
"""
import pytest
from unittest.mock import MagicMock, patch

import trade
from risk import STOP_LOSS_LIMIT_BAND_PCT


def _post_resp():
    resp = MagicMock()
    resp.json.return_value = {"id": "test-order", "status": "accepted"}
    return resp


class TestStopLossClamp:
    def test_stale_limit_is_clamped_not_rejected(self):
        """SELL stop with limit far below fresh ask must clamp to ask - band."""
        ask = 100.0
        stale_limit = 98.0  # 2% below ask, way outside the 0.5% band
        with patch.object(trade, "get_latest_quote", return_value={"ap": ask}), \
             patch.object(trade, "api_post", return_value=_post_resp()) as post:
            result = trade.place_order("BTC/USD", 0.1, "sell", stale_limit,
                                       is_stop_loss=True)
        assert result["status"] == "accepted"
        sent = float(post.call_args.kwargs["json"]["limit_price"])
        assert sent == pytest.approx(ask * (1 - STOP_LOSS_LIMIT_BAND_PCT))

    def test_limit_inside_band_unchanged(self):
        ask = 100.0
        limit = 99.7  # 0.3% below ask, inside the 0.5% band
        with patch.object(trade, "get_latest_quote", return_value={"ap": ask}), \
             patch.object(trade, "api_post", return_value=_post_resp()) as post:
            trade.place_order("BTC/USD", 0.1, "sell", limit, is_stop_loss=True)
        assert float(post.call_args.kwargs["json"]["limit_price"]) == limit

    def test_normal_order_band_still_rejects(self):
        """Non-stop-loss orders keep the strict 0.2% band rejection."""
        with patch.object(trade, "get_latest_quote", return_value={"ap": 100.0}), \
             patch.object(trade, "api_post", return_value=_post_resp()):
            with pytest.raises(trade.TradeRejected):
                trade.place_order("BTC/USD", 0.1, "buy", 98.0)
