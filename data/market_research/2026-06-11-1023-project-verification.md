# Project Verification — 2026-06-11 10:23 GMT+2

## Scope

Baseline consistency and soundness review — first run of the
market-researcher agent after its addition to the project. Walked the
"Python ↔ Dashboard consistency check" list in CLAUDE.md point by point,
checked hard-rule soundness, evidence in `reports/`, and ran the test suite.

## Findings

### Tests

`python -m pytest tests/ -q` → **75 passed** in 0.16 s (0 failures).
Note: `pytest` is not in `requirements.txt`; it had to be installed ad hoc.

### Python ↔ Dashboard consistency checklist (CLAUDE.md)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | EMA seeding (SMA of first `period`) | PASS | dashboard_professional.html:3422-3442 `emaArr`; indicators.py `ema_series` |
| 2 | MACD signal on NaN-stripped series | PASS | dashboard:3494-3495 `validMacd` filter + re-pad |
| 3 | RSI formula / zero-loss edge case | **WARN** | Python `indicators.py:114-115` returns 50.0 when avg_gain==0 and avg_loss==0; dashboard `calcRSI` (line 3464) returns 100 whenever `avgLoss === 0`, including the all-flat case. CLAUDE.md item 3 mandates a match. Practically negligible (requires a perfectly flat series) but a documented-rule divergence. |
| 4 | Score thresholds (≥4 full, ≥3&&<4 half; ≤−4 / ≤−3&&>−4; ±2 exits) | PASS | dashboard:4133-4139, 5837-5840; config.json `strategy.*`; run_evaluation decision tree |
| 5 | Bollinger population std (÷period), %b 0.25/0.75 | PASS | dashboard:3520-3521; indicators.py `bollinger` (÷period) |
| 6 | Volume ratio prev-20 excl. current; 1.2 / 0.7 | PASS | dashboard:3551 `slice(-21,-1)`; indicators.py:283 `volumes[-(period+1):-1]` |
| 7 | 4H ±0.05% dead zone | PASS | dashboard:3660-3661; same 1.0005/0.9995 band as Signal 1 |
| 8 | Daily regime via SMA20/SMA50 | PASS | dashboard:3588-3598; run_evaluation.py:366-380 — identical conditions |
| 9 | ATR sizing `equity×0.01/(ATR×1.5)` capped at `(equity×cap)/ask` | PASS | dashboard:4198; run_evaluation sizing path |
| 10 | Bar completeness (`end = now − 1 bar`) | PASS (literal) / **FAIL (data parity)** | Both sides pass `end` (run_evaluation.py:197-214 `_bars_end`; dashboard:3816 `barsEnd`). BUT see critical issue below — the Python side additionally truncates the window head, so Python and dashboard compute identical formulas on **different data**. |

MACD partial credits also verified equivalent: dashboard's
`strictlyFalling = hasPrev2 && !strictlyRising` (line 3617) yields the same
branch outcomes as Python `macd_hist_rising` (indicators.py:189-199) despite
the misleading variable name (red+strictly-rising → −0.5 on both sides).

### CRITICAL — stale bar windows in `run_evaluation.py` (soundness)

`get_crypto_bars` (run_evaluation.py:217-239) passes
`start = now − limit×period×1.6` (`_bars_start`, line 182, buffer=1.6) with
`limit=N`, no `sort`, no pagination. Alpaca returns bars oldest-first, so
the call returns the FIRST N bars of the 1.6×-wide window. Verified by
probe on 2026-06-11 08:16 UTC:

- 15-min (limit 200): last bar 2026-06-10T02:15Z → ~30 h stale.
- 4H (limit 120): BTC last bar 2026-05-17 → 25 d stale; only 43 bars
  returned → `regime_4h` = "insufficient 4H history", signal 6 silently 0.
- Daily (limit 90): window 2026-01-19 → 2026-04-18 → 54 d stale.

Effect on hard rules: the daily regime gate reports "uptrend" (journal
2026-06-11 10:08: BTC `last=75743.69`, an April 18 close) while fresh data
shows every watchlist symbol in confirmed downtrend (BTC last 61,450 <
MA50 75,010). The long/short regime gates are therefore inverted in
practice, and all confluence scores are computed on 30-hour-old execution
bars. `scripts/research.py:82` (`sort=desc`) and the dashboard
(`next_page_token` pagination) fetch fresh data — three inconsistent data
paths. `rebalance.py` imports the broken fetchers from `run_evaluation`
(rebalance.py:85-94), so it inherits the same stale regime/signals.

### Other soundness checks

- Hard rules (cash reserve, caps, limit-only, stop dedup/escalation,
  trailing stop, correlation budget, drawdown gate) are present in
  `risk.py`/`trade.py` and covered by the 75 passing tests. No logic
  contradiction found between CLAUDE.md, README.md, config.json values and
  code constants (5%, 0.2%/0.5%, 2.5%/3%, 2 cycles, 3 positions, 3% gate).
- `data/positions_state.json` holds a stale BTC `stop_order_id`
  (placed 2026-05-29, `stop_order_cycles: 1`) while the account has zero
  positions and zero open orders — harmless today but should be cleaned to
  keep the dedup logic's state truthful.
- `requirements.txt` lacks `pytest` (dev dependency).

### Evidence in `reports/`

Latest walk-forward (walkforward_20260607T080037Z.md) shows negative mean
Sharpe on all timeframes (BTC 1D −1.59, 4H −0.65, 1H −0.65; ETH 1D −0.61,
4H −1.35, 1H −0.06). Live results (equity −4.57% since 2026-05-08, win rate
21%, profit factor 0.15 — see companion market report) corroborate. The
current parameter set is **not supported by evidence**; additionally the
walk-forward used BTC/USDC & ETH/USDC pairs, not the traded /USD watchlist.

## Verdict

**FAIL**

- FAIL — Stale bar windows in `run_evaluation.py` `get_crypto_bars`
  (run_evaluation.py:182,217-239): regime gate and all live scores computed
  on 30 h / 25 d / 54 d old data; breaks the regime hard rule in practice
  and breaks Python↔dashboard data parity.
- WARN — RSI zero-loss edge case mismatch (dashboard:3464 vs
  indicators.py:114-115) violates checklist item 3 (cosmetic in practice).
- WARN — Strategy parameters unsupported by evidence: negative walk-forward
  Sharpe on every timeframe and negative live results.
- WARN — Stale `stop_order_id` in `data/positions_state.json`; `pytest`
  missing from `requirements.txt`.
- PASS — Tests 75/75; checklist items 1,2,4,5,6,7,8,9 fully consistent;
  hard-rule thresholds consistent across CLAUDE.md/README/config/code.

## Recommendations

1. Fix `get_crypto_bars` to return the LAST N completed bars: add
   `sort=desc` + re-sort ascending, or paginate via `next_page_token` to
   `end` (dashboard already does the latter — mirror it). Add a regression
   test asserting the last bar timestamp is within 2 bar-periods of `end`.
2. After the fix, re-run `scripts/walkforward_evaluate.py` on the actual
   /USD watchlist symbols and re-baseline expected metrics.
3. Align dashboard `calcRSI` flat-series edge case with Python (return 50
   when both averages are 0) per CLAUDE.md item 3.
4. Reset the BTC entry in `data/positions_state.json` (no open orders
   exist); add `pytest` to `requirements.txt`.
5. Re-run this project verification after the data-fetch fix lands.

## Data sources

- `python -m pytest tests/ -q` (75 passed).
- Files: CLAUDE.md, README.md, config.json, scripts/run_evaluation.py,
  scripts/indicators.py, scripts/risk.py, scripts/trade.py,
  scripts/rebalance.py, scripts/research.py,
  docs/dashboard_professional.html (lines 3422-3700, 3816, 4133-4220),
  data/positions_state.json, journal/2026-06-11.md,
  reports/walkforward_20260607T080037Z.md, requirements.txt.
- Read-only Alpaca probes via project modules to verify bar-window
  staleness (no orders placed, no state mutated).
