# Project Verification — 2026-06-11 10:36 GMT+2

Triggered by: stale-bars fix in `scripts/run_evaluation.py` (`sort=desc` + `bars[::-1]`),
follow-up to the 2026-06-11 10:23 FAIL reports.

## Scope

1. Correctness/completeness of the `get_crypto_bars()` fix (git diff review).
2. Live probe: 15-min / 4H / daily bar recency for BTC/USD and SOL/USD (read-only).
3. Daily regime recompute for all 10 watchlist symbols vs. the 10:08 evaluation.
4. Test suite (`pytest tests/ -q`) from a clean copy (`/tmp/verify`, pycache purged).
5. Doc consistency: CLAUDE.md, README.md, memory/glossary.md, memory/projects.

## Findings

### 1. Fix correctness — PASS
- Diff confirmed: `params["sort"] = "desc"` added; return changed to `bars[::-1]`
  (run_evaluation.py:242, :247). Docstring documents the bug accurately.
- Chronological order verified live: `all(bars[i].t < bars[i+1].t)` = True for every
  symbol/timeframe probed — indicator code (EMA/MACD/RSI/ATR, oldest→newest) is safe.
- `get_crypto_bars_4h` / `get_crypto_bars_daily` are thin wrappers — inherit the fix.
- `rebalance.py` inherits: imports `run_evaluation.get_crypto_bars` (rebalance.py:86)
  and the 4h/daily wrappers (:92, :114). PASS.
- **WARNING — `research.py` does NOT delegate.** It has its own `get_bars()`
  (research.py:49–57) with bare `{symbols, timeframe, limit}` — no `start`, no `end`,
  no `sort`. With Alpaca's default start (current day) it returns only today's bars
  (e.g. `bars BTC/USD 1Day 60` → 1 bar) and includes the in-progress partial bar.
  Manual-lookup tool only, not in the evaluation path — but the memory/projects entry
  ("rebalance.py and research.py delegate to this function") is factually wrong.

### 2. Live probe — PASS (run 2026-06-11 08:34 UTC from /tmp/verify/scripts)
| Symbol  | TF    | n   | Last bar (UTC)       | Age            |
|---------|-------|-----|----------------------|----------------|
| BTC/USD | 15Min | 200 | 2026-06-11T08:15:00Z | 20 min (1.30p) |
| BTC/USD | 4H    | 42  | 2026-06-11T04:00:00Z | 4.6 h (1.14p)  |
| BTC/USD | 1Day  | 90  | 2026-06-10T00:00:00Z | 32.6 h (1.36p) |
| SOL/USD | 15Min | 200 | 2026-06-11T08:15:00Z | 20 min (1.30p) |
| SOL/USD | 4H    | 44  | 2026-06-11T04:00:00Z | 4.6 h (1.14p)  |
| SOL/USD | 1Day  | 90  | 2026-06-10T00:00:00Z | 32.6 h (1.36p) |

Every last bar ≈ now − 1 period (1.1–1.4 periods, consistent with the `_bars_end`
in-progress-bar exclusion). Previous run: daily 54 days stale, 4H 25 days, 15-min ~30 h.

### 3. Daily regime recompute — all 10 symbols DOWNTREND
Fresh data (last < SMA50 and SMA20 < SMA50 for every symbol):

| Symbol | last | SMA20 | SMA50 | Fresh regime | 10:08 reported |
|--------|------|-------|-------|--------------|----------------|
| BTC/USD  | 61449.77 | 69396.14 | 75012.16 | downtrend | uptrend (WRONG) |
| ETH/USD  | 1620.66  | 1887.72  | 2120.85  | downtrend | uptrend (WRONG) |
| SOL/USD  | 63.16    | 75.88    | 82.90    | downtrend | mixed (WRONG)   |
| AVAX/USD | 6.38     | 8.18     | 8.94     | downtrend | mixed (WRONG)   |
| LINK/USD | 7.56     | 8.63     | 9.27     | downtrend | mixed (WRONG)   |
| DOT/USD  | 0.9157   | 1.1196   | 1.2132   | downtrend | downtrend (ok)  |
| LTC/USD  | 41.70    | 48.42    | 53.09    | downtrend | mixed (WRONG)   |
| DOGE/USD | 0.0829   | 0.0944   | 0.1017   | downtrend | mixed (WRONG)   |
| ADA/USD  | 0.1604   | 0.2093   | 0.2379   | downtrend | uptrend (WRONG) |
| AAVE/USD | 61.23    | 75.71    | 86.58    | downtrend | downtrend (ok)  |

Gate effect now: **longs blocked on all 10 symbols; shorts permitted** (subject to
score ≤ −4/6 full or −3/6 half + R:R). The 10:08 run, on stale data, had longs
permitted on 8/10 symbols (3 "uptrend" + 5 "mixed") and shorts blocked — inverted.

### 4. Tests — PASS
`python3 -m pytest tests/ -q` from /tmp/verify: **78 passed in 0.47 s** (0 failed).
`tests/test_bars_fetch.py` present, 3 regression tests (sort=desc requested,
response reversed to chronological, end/start still set), api_get mocked.

### 5. Doc consistency
- CLAUDE.md: PASS — parity table "Bar recency" row (line 363) + consistency check #11
  (line 381) both present and accurate.
- memory/glossary.md: PASS — bug + fix documented (line 151).
- memory/projects/alpaca-trading-agent.md: PASS with one inaccuracy — dated 2026-06-11
  entry present (line 69) but claims "research.py delegate[s] to this function" (false,
  see Finding 1).
- **README.md: WARNING — no bars-fix API note found.** `git diff README.md` contains
  only the new Market Researcher Agent section; grep for sort/desc/stale/chronological/
  get_crypto_bars yields nothing fix-related. The claimed "README API notes" update is
  missing.
- docs/dashboard_layout.md: not required (no dashboard change); dashboard pagination
  path unchanged and already correct.

## Verdict

**PASS WITH WARNINGS**

- Fix correct and complete for the execution path (run_evaluation, rebalance): PASS.
- Live bar recency restored on all three timeframes: PASS.
- Regime gate now reads true downtrend on all 10 symbols: PASS.
- Tests 78/78 green incl. 3 new regression tests: PASS.
- WARNING: research.py has its own unfixed `get_bars()` (no start/end/sort, includes
  partial bar) and memory/projects wrongly says it delegates.
- WARNING: README.md was not updated with the bars-fix API note (doc rule violation).

## Recommendations

1. Add the bars-fix note to README.md (API/data-fetch section): `sort=desc` + reverse,
   mirroring CLAUDE.md parity-table row "Bar recency".
2. Either make `research.py get_bars()` delegate to `run_evaluation.get_crypto_bars`
   for crypto symbols, or correct the memory/projects sentence to "rebalance.py
   delegates; research.py is a standalone manual tool with day-window-only bars".
3. Re-run the next scheduled evaluation normally — with all 10 symbols in confirmed
   downtrend, expect long entries blocked and short setups gated at score ≤ −3/−4.

## Data sources

- `git diff scripts/run_evaluation.py` (mounted repo, HEAD e758ad9).
- Live Alpaca data API `/v1beta3/crypto/us/bars` via `get_crypto_bars[_4h|_daily]`
  from /tmp/verify/scripts (read-only; no order endpoints touched).
- `journal/2026-06-11.md` (10:08 evaluation block, lines 4–156).
- `config.json` watchlist; `scripts/rebalance.py:85–126`; `scripts/research.py:49–64`.
- `python3 -m pytest tests/ -q` (78 tests); `tests/test_bars_fetch.py`.
- CLAUDE.md:363,381; README.md (full grep + diff); memory/glossary.md:151;
  memory/projects/alpaca-trading-agent.md:69–70.
