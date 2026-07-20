# tests/test_reconcile.py
"""
Regression tests for the 2026-07-10 bug-sweep fixes in run_evaluation:

Bug #1 (P0): a lost state file re-fired the +1R partial TP every run
(AAVE 6.54 -> 0.05 over 6 evaluations). reconcile_positions_from_fills()
must rebuild partial_tp_done / entry_time_iso / breakeven stop from
Alpaca's own fill history so the flag can never be lost again.

Bug #3 (P1): Alpaca returned a negative avg_entry_price after repeated
partial sells ("SOL/USD HOLD @ $-4.4931"). The FIFO open lots give the
true cost basis.

Bug #4 (P1): cadence self-monitoring — daily_summary FIFO helper.

Bug #6 (P0, 2026-07-18): Alpaca paper-fill SELL quantities land ~0.1-0.25%
below the matching BUY (fee/precision rounding). The old absolute 1e-6
"flat" epsilon never caught this, so every full-position close was
misread as a partial sell, permanently inflating sells_since_start for
that symbol. Every new position then reconciled as "partial TP already
done" on its first evaluation, pinning the stop to breakeven before any
real profit — the root cause of fast, mostly-losing buy->sell round
trips. Fixed by using a tolerance relative to the lot's original size.

No network calls — _fetch_all_fills is mocked.
"""
from unittest.mock import patch

import position_state as ps
import run_evaluation as re_mod


def _fill(side, sym, qty, price, when):
    return {"side": side, "symbol": sym, "qty": str(qty),
            "price": str(price), "transaction_time": when}


def _pos(sym, qty, entry):
    return {"symbol": sym, "qty": str(qty), "avg_entry_price": str(entry)}


def _run(fills, positions, state=None):
    state = state if state is not None else dict(ps._EMPTY_STATE, positions={})
    with patch.object(re_mod, "_fetch_all_fills", return_value=fills):
        warnings = re_mod.reconcile_positions_from_fills(state, positions)
    return state, warnings


class TestPartialTpIdempotency:
    def test_partial_sell_since_entry_restores_flag(self):
        # Buy 6.54, then one partial sell of 3.27 — position still open.
        fills = [  # newest first, as the activities API returns them
            _fill("sell", "AAVEUSD", 3.27, 320.0, "2026-07-09T15:29:00Z"),
            _fill("buy",  "AAVEUSD", 6.54, 300.0, "2026-07-08T10:23:00Z"),
        ]
        positions = [_pos("AAVEUSD", 3.27, 300.0)]
        state, warnings = _run(fills, positions)
        pos = ps.get_position(state, "AAVE/USD")
        assert pos["partial_tp_done"] is True
        assert pos["breakeven_stop"] == 300.0
        assert any("PARTIAL-TP RECONCILED" in w for w in warnings)

    def test_no_sell_since_entry_leaves_flag_clear(self):
        # Previous round trip fully closed, then a fresh buy — no partial yet.
        fills = [
            _fill("buy",  "BTCUSD", 0.5, 80000.0, "2026-07-10T08:23:00Z"),
            _fill("sell", "BTCUSD", 1.0, 79000.0, "2026-07-05T12:23:00Z"),
            _fill("buy",  "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z"),
        ]
        positions = [_pos("BTCUSD", 0.5, 80000.0)]
        state, _ = _run(fills, positions)
        pos = ps.get_position(state, "BTC/USD")
        assert pos["partial_tp_done"] is False

    def test_fee_mismatched_full_close_not_counted_as_partial(self):
        # Real 2026-07-17 LTC/USD incident: buy 59.693, then a "full" close
        # sell of only 59.5616754 (0.22% short — Alpaca fee/precision
        # rounding). That round trip fully closed the position; it must
        # NOT be read as a partial TP against the fresh buy that follows.
        fills = [
            _fill("buy",  "LTCUSD", 59.693,      45.9060, "2026-07-18T08:00:00Z"),
            _fill("sell", "LTCUSD", 59.5616754,  44.9684, "2026-07-17T06:30:00Z"),
            _fill("buy",  "LTCUSD", 59.693,      45.9060, "2026-07-17T03:41:00Z"),
        ]
        positions = [_pos("LTCUSD", 59.693, 45.9060)]
        state, warnings = _run(fills, positions)
        pos = ps.get_position(state, "LTC/USD")
        assert pos["partial_tp_done"] is False
        assert not any("PARTIAL-TP RECONCILED" in w for w in warnings)

    def test_final_close_with_small_trailing_lot_not_counted_as_partial(self):
        # Bug #8 (2026-07-20) real-shape repro: two buy tranches (200 + a
        # small 10-unit add), then one full-close sell whose ~0.24%
        # aggregate fee/rounding shortfall lands entirely inside the small
        # trailing lot — 0.5 units short against a lot whose OWN 0.5%
        # tolerance is only 0.05. The old per-lot dust check left that lot
        # stuck open forever, so LINK/USD's sells_since_start only ever grew
        # (16 -> 37 across 10 days) and every fresh entry was immediately
        # reconciled as "partial TP already done." A fresh buy afterward
        # must NOT be flagged.
        fills = [
            _fill("sell", "LINKUSD", 209.5, 8.40,  "2026-07-19T12:00:00Z"),
            _fill("buy",  "LINKUSD", 10.0,  8.30,  "2026-07-18T09:00:00Z"),
            _fill("buy",  "LINKUSD", 200.0, 8.20,  "2026-07-18T08:00:00Z"),
        ]
        positions = [_pos("LINKUSD", 210.0, 8.20)]
        state, warnings = _run(fills, positions)
        pos = ps.get_position(state, "LINK/USD")
        assert pos["partial_tp_done"] is False
        assert not any("PARTIAL-TP RECONCILED" in w for w in warnings)

    def test_repeated_full_episodes_never_inflate_counter(self):
        # Two genuinely separate open->close episodes (each with a
        # fee-rounding-shortfall full close) followed by a fresh, still-open
        # third buy. sells_since_start must reset to 0 after each full
        # close, never accumulate across episodes into the current holding.
        fills = [
            _fill("buy",  "LINKUSD", 100.0, 8.30, "2026-07-15T08:00:00Z"),
            _fill("sell", "LINKUSD", 149.7, 8.10, "2026-07-13T10:00:00Z"),
            _fill("buy",  "LINKUSD", 150.0, 8.20, "2026-07-13T08:00:00Z"),
            _fill("sell", "LINKUSD", 79.85, 7.90, "2026-07-11T10:00:00Z"),
            _fill("buy",  "LINKUSD", 80.0,  8.00, "2026-07-11T08:00:00Z"),
        ]
        positions = [_pos("LINKUSD", 100.0, 8.30)]
        state, warnings = _run(fills, positions)
        pos = ps.get_position(state, "LINK/USD")
        assert pos["partial_tp_done"] is False
        assert not any("PARTIAL-TP RECONCILED" in w for w in warnings)

    def test_already_done_flag_untouched(self):
        state = dict(ps._EMPTY_STATE, positions={})
        ps.get_position(state, "AAVE/USD")["partial_tp_done"] = True
        ps.get_position(state, "AAVE/USD")["entry_time_iso"] = "2026-07-08T10:23:00Z"
        ps.get_position(state, "AAVE/USD")["entry_price"] = 300.0
        positions = [_pos("AAVEUSD", 3.27, 300.0)]
        with patch.object(re_mod, "_fetch_all_fills") as m:
            re_mod.reconcile_positions_from_fills(state, positions)
        m.assert_not_called()  # nothing to rebuild — no fills fetch at all


class TestPruneStaleState:
    def test_closed_symbol_state_is_cleared(self):
        # Real 2026-07-18 finding: LTC/USD fully closed via a stop-loss exit,
        # but nothing ever called clear_position() for it (that only fires
        # from the "still held" branch or a non-stop-loss TA exit), so its
        # stale partial_tp_done/breakeven_stop survived indefinitely.
        state = dict(ps._EMPTY_STATE, positions={})
        ps.mark_partial_tp(state, "LTC/USD", 45.812)
        assert ps.get_position(state, "LTC/USD")["partial_tp_done"] is True

        warnings = re_mod.prune_stale_position_state(state, open_symbols=["BTC/USD"])

        assert "LTC/USD" not in state["positions"]
        assert any("LTC/USD" in w for w in warnings)

    def test_held_symbol_state_is_untouched(self):
        state = dict(ps._EMPTY_STATE, positions={})
        ps.mark_partial_tp(state, "BTC/USD", 80000.0)
        warnings = re_mod.prune_stale_position_state(state, open_symbols=["BTC/USD"])
        assert state["positions"]["BTC/USD"]["partial_tp_done"] is True
        assert warnings == []


class TestEntryPriceGuard:
    def test_negative_avg_entry_replaced_with_fifo(self):
        fills = [
            _fill("sell", "SOLUSD", 10.0, 160.0, "2026-07-09T15:29:00Z"),
            _fill("buy",  "SOLUSD", 39.5, 150.0, "2026-07-08T10:23:00Z"),
        ]
        positions = [_pos("SOLUSD", 29.5, -4.4931)]
        state, warnings = _run(fills, positions)
        assert float(positions[0]["avg_entry_price"]) == 150.0
        assert any("DATA GUARD" in w for w in warnings)

    def test_positive_avg_entry_untouched(self):
        fills = [_fill("buy", "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z")]
        positions = [_pos("BTCUSD", 1.0, 78123.45)]
        _run(fills, positions)
        assert float(positions[0]["avg_entry_price"]) == 78123.45


class TestEntryClockBackfill:
    def test_entry_time_from_flat_to_long_transition(self):
        fills = [
            _fill("buy",  "BTCUSD", 0.5, 80000.0, "2026-07-10T08:23:00Z"),
            _fill("sell", "BTCUSD", 1.0, 79000.0, "2026-07-05T12:23:00Z"),
            _fill("buy",  "BTCUSD", 1.0, 78000.0, "2026-07-01T09:23:00Z"),
        ]
        positions = [_pos("BTCUSD", 0.5, 80000.0)]
        state, _ = _run(fills, positions)
        pos = ps.get_position(state, "BTC/USD")
        # The clock starts at the CURRENT position's entry, not the old round trip.
        assert pos["entry_time_iso"] == "2026-07-10T08:23:00Z"

    def test_shorts_ignored(self):
        positions = [_pos("BTCUSD", -1.0, 80000.0)]
        with patch.object(re_mod, "_fetch_all_fills") as m:
            re_mod.reconcile_positions_from_fills(
                dict(ps._EMPTY_STATE, positions={}), positions)
        m.assert_not_called()


class TestDailySummaryFifo:
    def test_realized_pnl_counts_only_todays_exits(self):
        import daily_summary as ds
        fills = [  # newest first
            _fill("sell", "BTCUSD", 1.0, 81000.0, "2026-07-10T09:00:00Z"),
            _fill("sell", "ETHUSD", 1.0, 3100.0,  "2026-07-09T09:00:00Z"),
            _fill("buy",  "ETHUSD", 1.0, 3000.0,  "2026-07-08T09:00:00Z"),
            _fill("buy",  "BTCUSD", 1.0, 80000.0, "2026-07-08T08:00:00Z"),
        ]
        pnl, exits = ds.realized_pnl_today(fills, "2026-07-10")
        assert exits == 1
        assert pnl == 1000.0  # only the BTC exit lands today

    def test_unmatched_sell_excluded(self):
        import daily_summary as ds
        fills = [_fill("sell", "BTCUSD", 1.0, 81000.0, "2026-07-10T09:00:00Z")]
        pnl, exits = ds.realized_pnl_today(fills, "2026-07-10")
        assert (pnl, exits) == (0.0, 0)
