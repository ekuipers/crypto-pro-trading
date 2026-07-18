# Market Research — 2026-07-18 11:19 GMT+2

## Scope

Investigation requested by the project owner: buy orders are frequently
followed by sell orders "too fast," and most of these round trips realize a
net loss. Scope: pull live Alpaca paper-account FILL history, compute FIFO
round trips, cross-reference exit reasons against `journal/2026-07-1{0..8}.md`,
and identify the root cause(s) in `scripts/run_evaluation.py` /
`scripts/risk.py` / `scripts/position_state.py`. Read-only — no code, config,
or trades were modified.

## Findings

### 1. Aggregate realized performance (live paper account, full history)

Pulled 1,018 FILL activities via `run_evaluation._fetch_all_fills()` (paginated,
desc, 100/page — not the truncating single-page pattern flagged in
`docs/dashboard_layout.md`). FIFO-matched into 276 round trips (one record per
matched SELL fill):

- Win rate: 47.8% (132 wins / 144 losses)
- Total realized P&L: **-$6,614.67**
- Profit factor: **0.29** (gross win $2,715.24 / gross loss $9,329.90)

By holding-duration bucket:

| Bucket | n | Win rate | Avg P&L/trade | Total P&L |
|---|---|---|---|---|
| <1h | 2 | 0.0% | -$11.49 | -$22.99 |
| 1-4h | 17 | 58.8% | +$4.08 | +$69.34 |
| 4-24h | 71 | 81.7% | -$0.09 (marginal net-neg) | -$446.69 |
| >24h | 186 | 34.4% | -$33.41 | -$6,214.33 |

Note: the ">24h" bucket is dominated by legacy stale/negative-edge holds and is
a separate issue from the fast-loss pattern reported (see Recommendation 5).
The specific pattern the owner is seeing — a buy followed shortly after by a
losing sell — is concentrated in a distinct, identifiable bug (below), not
generic overtrading.

### 2. Journal cross-reference: the hourly evaluation's SELL decisions are almost entirely one mechanism

`grep -hE "^- [A-Z]+/USD SELL " journal/2026-07-1[1-8].md` → 9 unique SELL
decisions logged by the hourly evaluation over 8 days:

- **8 of 9 (89%)**: `STOP-LOSS (breakeven after partial TP)`
- 1 of 9: `STALE EXIT`
- 0 of 9: `STOP-LOSS (4H swing low)`, `STOP-LOSS (fallback)`, `TA SELL`

(Two additional genuine `TRAILING STOP` exits were found, but they came from
`stop_watchdog.py`'s 5-min journal writes, not the hourly evaluation, and both
were real winners — e.g. `journal/2026-07-18.md:1141` ETH entry $1847.30 →
exit near $1837.95 after riding up to $1869+; the trailing mechanism itself
works correctly.)

So the dominant exit path in the current period is the "breakeven after
partial TP" stop. All 8 occurrences:

| Symbol | Entry $ | Exit $ | Hold | qty sold vs. position qty |
|---|---|---|---|---|
| LTC/USD | 44.8100 | 44.5900 trigger | fast | 61.063 / (buy 61.198) = **99.8%** |
| ETH/USD | 1800.6098 | 1799.80 trigger | same-day | 5.870 / (buy 5.869...) ≈ **100%** |
| LINK/USD | 8.0927 | 8.0165 trigger | ~1 day | 281.925 / (buy 282.264) = **99.9%** |
| BTC/USD | 64961.9851 | 64816.19 trigger | same-day | 0.2110 / (buy 0.2114) = **99.8%** |
| LTC/USD | 45.1080 | 44.5660 trigger | fast | 60.646 / (buy 60.779) = **99.8%** |
| LINK/USD | 8.4200 | 8.3917 trigger | fast | 274.079 / (buy ~274.6) = **99.8%** |
| LTC/USD | 45.7520 | 45.3900 trigger | ~11h | 59.723 / (buy 59.855) = **99.8%** |
| LTC/USD | 45.8120 | 45.2700 trigger | **2h49m** | 59.562 / (buy 59.693) = **99.8%** |

**Every single one of these sold ~99.8-100% of the position — a full close,
not the 50% scale-out the "partial TP" label implies.** A genuine partial TP
sells `partial_tp_fraction` (50%) and leaves the rest running; none of these
did. Separately, `grep -h "PARTIAL TP +" journal/2026-07-*.md` (the real
`should_partial_tp()` code path, `run_evaluation.py:962-979`) returns matches
**only from 2026-07-09/07-10** — the incident already documented in the code
comments (`run_evaluation.py:382-384`, "AAVE 6.54 -> 0.05... re-fired on 6
consecutive evaluations", fixed 2026-07-10). **Since that fix, the real
partial-TP path has not fired even once**, yet the "breakeven after partial
TP" stop has fired 8 times. This is the smoking gun: the breakeven stop is
being set by something other than a real partial take-profit.

### 3. Root cause: `reconcile_positions_from_fills()` mislabels ordinary closed positions as "partial TP taken"

`scripts/run_evaluation.py:391-486`. On every evaluation, for any open long
position where `not ps_pos.get("partial_tp_done")` (true for **every fresh
entry**, since a new position always starts with the flag clear —
`position_state.py:51,137-145`), the function re-simulates a FIFO walk over
the **entire fill history for that symbol** (not scoped to the current
position) to decide whether a scale-out already happened:

```python
# run_evaluation.py:442-455
elif side == "sell":
    remaining = qty
    while remaining > 1e-9 and h["lots"]:
        ...
    if h["lots"]:
        h["sells_since_start"] += 1   # partial sell — position survives
    else:
        h["start_iso"] = None          # fully closed
        h["sells_since_start"] = 0
```

The bug: `h["lots"]` is expected to reach `[]` (fully closed → reset counter)
whenever a prior position was closed out. In the live account it **never
does**, because every full-position SELL on Alpaca returns a quantity that is
consistently ~0.14–0.25% *less* than the matching BUY quantity (confirmed
below) — a tiny fee/precision residual lingers in the simulated lot forever,
so `h["lots"]` is never empty and `sells_since_start` never resets to 0. It
instead accumulates across **every historical trading cycle ever executed for
that symbol**, confirmed by the growing counts across consecutive
`PARTIAL-TP RECONCILED` warnings in the journal:

- LTC/USD: 8 → 9 → 10 → 11 (2026-07-14 → 07-15 → 07-15 → 07-17)
- AAVE/USD: 32 → 33 → 35 (2026-07-11 → 07-13 → 07-14)
- LINK/USD: 16 → 23 → 24 → 26 (2026-07-10 → 07-14 → 07-15 → 07-17)

Universal buy/sell qty ratio measured directly from the 1,018 raw fills
(computed per symbol, full history):

| Symbol | sell/buy qty ratio | Symbol | sell/buy qty ratio |
|---|---|---|---|
| AAVE/USD | 0.99856 | ETH/USD | 0.99807 |
| ADA/USD | 0.99837 | GRT/USD | 0.99880 |
| AVAX/USD | 0.99821 | LINK/USD | 0.99858 |
| BAT/USD | 0.99780 | LTC/USD | 0.99791 |
| BONK/USD | 0.99880 | SOL/USD | 0.99811 |
| CRV/USD | 0.99808 | SUSHI/USD | 0.99750 |
| DOGE/USD | 0.99824 | UNI/USD | 0.99840 |
| DOT/USD | 0.99859 | | |

Every symbol ever fully traded shows the same ~0.12–0.25% deficit — this is
not symbol-specific noise, it is a structural mismatch between the codebase's
"FIFO lots reach exactly zero" assumption and Alpaca's actual fee/precision
behavior on crypto fills. `tests/test_reconcile.py` never catches this because
its synthetic fixtures use exactly-matching buy/sell quantities
(`test_no_sell_since_entry_leaves_flag_clear`, lines 54-64 — sell 1.0 against
buy 1.0, a clean zero), so the test suite is green (168/168 pass,
confirmed via `python -m pytest tests/ -q`) while the production code path it
is meant to guard has been silently wrong on every single trading day sampled.

**Consequence:** because `sells_since_start` is already > 0 (stale, from a
long-closed prior cycle) the moment a *brand-new* position opens, the very
first evaluation after the BUY calls `ps.mark_partial_tp(state, sym, entry)`
(`run_evaluation.py:478-485`), setting `breakeven_stop = entry` for a position
that has taken **zero** real profit. From `run_evaluation.py:985-986`:

```python
breakeven = ps_pos.get("breakeven_stop")
eff_stop = max([s for s in (swing_stop, breakeven) if s], default=None)
```

`max()` picks `breakeven` (= entry) over the intended TA-based swing-low stop
(which can legitimately sit up to `swing_low_max_stop_pct` = 8% below entry,
`config.json › risk.swing_low_max_stop_pct`). The result: nearly every new
position's real protective stop becomes **"current price ≤ raw entry price"**
from minute one — far tighter than the designed swing-low stop, and with no
profit cushion ever earned. Given entries are frequently half-size at
score 2.5–3.5 (sometimes further damped by the streak-throttle, e.g. the
cited LTC BUY: "TA BUY half-size (score=3.0), streak-throttle 0.5x",
`journal/2026-07-17.md:688`), ordinary short-term chop back to entry is common
within hours, so this artificial stop fires fast.

### 4. The reported pricing gap ($44.9684 limit vs. $45.8120 stated stop) is fully explained, and escalation is NOT the cause

`stop_loss_limit_price(ask, cycles_open)` (`scripts/risk.py:462-478`) always
prices the exit `ask × (1 − 0.5%)` [+0.3% only if `cycles_open >=
stop_loss_escalation_cycles` (2)]. For the cited LTC exit
(`journal/2026-07-17.md:878`): `45.1944 × (1 − 0.005) = 44.9684` — an **exact**
match with `cycles_open = 0` (no escalation involved). The full 1.84% gap from
the stated breakeven ($45.8120) to the realized limit ($44.9684) decomposes as:
- ~1.35% — price had already fallen from the stop trigger level to the live
  ask by the time the check ran (this cycle carried a **CADENCE WARNING: 169
  minutes** since the previous evaluation, `journal/2026-07-17.md:766` — the
  delayed evaluation caught up on a price move that had already occurred)
- 0.5% — the deliberate underprice-for-fill band (by design, per CLAUDE.md's
  0.5% stop-loss band rule)
- 0% — escalation (cycles_open was 0)

Cadence delay compounds the loss size but is not the root cause of the
fast-and-losing pattern; the false breakeven pin is what makes the stop fire
at all, often within hours of entry, on trades that had not yet earned any
right to a tight stop.

### 5. Cadence reliability (secondary, confirmed)

`grep -c "CADENCE WARNING" journal/2026-07-1*.md` → 6–9 warnings/day for the
week sampled (of 24 scheduled evaluations/day), including a 169-minute gap
(`journal/2026-07-17.md:766`) that directly widened the LTC exit above. The
5-minute `stop_watchdog.py` (`.github/workflows/watchdog.yml`) mitigates this
for *already-set* stop levels, but it reads the same `breakeven_stop` from
`data/positions_state.json` that the hourly evaluation's buggy reconciliation
writes — so the watchdog inherits the false breakeven pin too, and does not
independently protect against this bug.

## Verdict

- **FAIL** — `reconcile_positions_from_fills()` in `scripts/run_evaluation.py`
  (lines 391-486) systematically mislabels ordinary full-position stop-outs as
  "partial TP already taken" due to a ~0.15–0.25% fee/precision quantity
  residual that never lets its FIFO simulation detect "flat." This has fired
  on 8 of the last 9 hourly-evaluation SELL decisions (89%) over 8 days,
  pinning new positions' effective stop to raw entry price from the first
  evaluation after every BUY — well before any real profit was earned or the
  intended swing-low stop was tested. This is the dominant, currently active
  root cause of the "buy then fast losing sell" pattern reported.
- **PASS WITH WARNINGS** — the genuine trailing-stop and stale-exit mechanisms
  work as designed when they fire (2 real trailing-stop exits found, both
  profitable). The 0.5% stop-loss underprice band and escalation logic
  (`risk.py:462-492`) are working as designed and are not the primary driver
  of the reported pattern, though they add ~0.5%+ guaranteed slippage on top
  of any stop trigger, real or false.
- **PASS WITH WARNINGS** — cadence: 6-9 CADENCE WARNINGs/day widen realized
  losses when a stop (false or real) does trigger, but do not explain why
  stops trigger so soon after entry.
- **Tests**: `python -m pytest tests/ -q` → 168 passed. `tests/test_reconcile.py`
  does not reproduce the real fee/precision quantity mismatch (its fixtures
  use exact 1.0-for-1.0 qty matches), so the suite gives false confidence on
  exactly the code path responsible for this bug.
- **Overall profitability**: total realized P&L over 276 round trips is
  **-$6,614.67**, profit factor **0.29**, win rate 47.8%. The edge is not
  holding in the live paper account; this bug is a material, quantifiable
  contributor (8 avoidable stop-outs sampled, each realizing at least the 0.5%
  band plus any adverse cadence drift, on positions that should have kept
  their full 4H-swing-low stop distance).

## Recommendations

1. **Fix `reconcile_positions_from_fills()` to scope the "sells since entry"
   check to the position's actual current entry, not the symbol's entire fill
   history.** Concretely: use a quantity-tolerance threshold when deciding a
   simulated lot queue is "flat" (e.g. remaining qty < 0.5% of the original
   lot, or < a fixed dust threshold like 1e-4 relative rather than absolute
   1e-6) so a fee-driven residual is treated as fully closed. `run_evaluation.py:449`
   (`if lot[0] < 1e-6`) is the line to change — raise the threshold to a
   relative tolerance (e.g. `lot[0] < lot_original_qty * 0.005`).
2. **Do not set `breakeven_stop` from a *reconciled* signal alone** — only
   from a fill/order actually tagged as this position's partial-TP SELL
   (e.g. check that the matched sell quantity is close to
   `partial_tp_fraction` × the position's entry qty, not "any sell that
   doesn't zero the FIFO queue"). This directly prevents the mislabeling even
   if the dust-residual issue in (1) recurs for some other reason.
3. **Add a regression test with a realistic fee-driven quantity mismatch**
   (e.g. buy 100.0, sell 99.8, position now flat in economic terms) to
   `tests/test_reconcile.py`, asserting `sells_since_start` resets and a fresh
   subsequent BUY does **not** trigger `mark_partial_tp`. This is the gap that
   let 8/9 live exits go wrong while the suite stayed green.
4. **Audit `data/positions_state.json` for any currently-open position with a
   `breakeven_stop` set but `partial_tp_done` reconciled (not from a genuine
   `should_partial_tp()` fire)** — any such position's true stop should be
   reset to the swing-low stop (or fixed −5% fallback) until it genuinely
   earns +1R. This is a data-cleanup recommendation only; no code change is
   authorized by this agent.
5. **Separately investigate the >24h bucket** (186 trades, -$6,214.33, 34.4%
   win rate) — this is a larger dollar loss than the fast-exit bug and looks
   like a distinct issue (stale/negative-edge holds riding out large adverse
   moves before the stale-exit or swing-low stop catches them). Recommend a
   follow-up `scripts/walkforward_evaluate.py` run and a review of
   `risk.max_hold_hours` / `is_stale_position()` gating once (1)-(3) are fixed,
   since the false-breakeven bug may itself be causing some of this bucket if
   `breakeven_stop` sits above the actual swing-low across a long hold (worth
   re-running this same FIFO analysis after the fix to see how the buckets
   shift).
6. **Improve cadence** (secondary): 6-9 CADENCE WARNINGs/day and a 169-minute
   gap indicate the hourly GitHub Actions cron is not reliably landing on
   time; investigate the `trade.yml` workflow's runner queue/concurrency
   group contention with `watchdog.yml` (`concurrency: group:
   trading-bot-${{ github.ref }}`), which could be serializing runs and
   causing the hourly job to wait behind slow watchdog runs.

## Data sources

- Live Alpaca paper account: `GET /v2/account/activities?activity_type=FILL`
  via `run_evaluation._fetch_all_fills()` (paginated, 1,018 records, newest
  2026-07-18T11:03:22Z) — read-only, no orders placed.
- FIFO round-trip computation: ad-hoc read-only scripts in the session
  scratchpad (`fifo_analysis.py`, `fifo_roundtrips.py`), reusing the project's
  own `_fetch_all_fills()` — not committed to the repo.
- `journal/2026-07-09.md` through `journal/2026-07-18.md` (grep for `SELL`,
  `PARTIAL TP`, `PARTIAL-TP RECONCILED`, `CADENCE WARNING`, `TRAILING STOP`).
- `scripts/run_evaluation.py` (lines 259-277 `_fetch_all_fills`, 378-486
  `reconcile_positions_from_fills`, 790-1090 long-position management).
- `scripts/risk.py` (lines 462-492 `stop_loss_limit_price`/`cover_limit_price`,
  548-575 partial-TP helpers, 596-614 `is_stale_position`).
- `scripts/position_state.py` (lines 51, 137-180 — position schema,
  `mark_partial_tp`).
- `scripts/stop_watchdog.py` (full read) and `.github/workflows/watchdog.yml`.
- `config.json` (`risk.*`, `strategy.*`, `costs.*` keys).
- `tests/test_reconcile.py` (full read) and `python -m pytest tests/ -q`
  (168 passed).
