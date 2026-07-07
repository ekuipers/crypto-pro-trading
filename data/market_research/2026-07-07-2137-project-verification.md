# Project Verification — 2026-07-07 21:37 GMT+2

## Scope
Commit `939ded7` ("feat: add ADX + OBV as informational indicators (roadmap)"), diffed against parent `0f25f2f`. Change adds `adx()`/`adx_label()` and `obv_series()`/`obv_trend()` to `scripts/indicators.py`, wires them into `scripts/run_evaluation.py` as journal-only lines, and adds 11 tests. Claim under test: informational-only, no scoring/trading impact, dashboard parity exemption.

## Findings

### 1. Rule consistency — PASS
- `git diff 0f25f2f..939ded7 -- scripts/indicators.py`: 112 insertions, 0 deletions. Hunks at lines ~92–201 (new ADX/OBV section between `atr()` and RSI) and ~556–580 (`__main__` self-test). `signal_score()` (scripts/indicators.py:395) has no hunk — scoring behavior byte-for-byte unchanged. Grep confirms `adx`/`obv` never referenced inside `signal_score()`.
- `git diff 0f25f2f..939ded7 -- docs/dashboard_professional.html` = 0 lines. `calcSignalScore()` untouched, as documented.
- `config.json` not in diff — all thresholds/gates unchanged.
- Docs consistent: CLAUDE.md adds the "Note on informational indicators (ADX, OBV)" parity exemption + `adx`/`obv` lines in the journal output template; README.md updates indicators.py description and test counts (41 → 52); memory/memory.md session entry, memory/glossary.md terms, docs/dashboard_layout.md changelog ("no dashboard change") all match the code.

### 2. Soundness — PASS
- **ADX (indicators.py:97–142)**: correct Wilder implementation. +DM/−DM selection rules (`up > down and up > 0`), true range max-of-3, Wilder smoothing `s = s − s/period + x`, DI = 100·sDM/sTR, DX = 100·|+DI−−DI|/(+DI+−DI), ADX seeded with SMA of first `period` DX values then Wilder recursion. Min-bars gate `n ≥ 2·period+1` is exact (n−1−period DX values ≥ period). Degenerate guards (`tr_s==0`, `di_sum==0`) skip the DX append but preserve smoothing state — acceptable for an informational metric.
- **OBV (indicators.py:160–197)**: textbook cumulative signed volume; `obv_trend` compares OBV now vs 20 bars ago against a 5%-of-window-volume dead zone → rising/falling/flat, exactly as documented. Length guards correct (`len(s) ≥ lookback+1`).
- **Wiring (run_evaluation.py)**: `decision["adx"]`/`decision["obv_trend"]` written only at lines 378–379 (plus None init at 300–301) and read only at lines 744–747 inside `format_indicator_block()`. No BUY/SELL/COVER/stop/sizing branch reads them — the change cannot alter any trade decision.
- Self-test run: `python scripts/indicators.py` → "self-checks passed", ADX 38.6 (trending), OBV rising on the rising-sine fixture — sane values.

### 3. Evidence — PASS (n/a)
No trading-decision logic changed, so no walk-forward validation is required. CLAUDE.md correctly forbids folding ADX/OBV into the score without re-tuning gates on both sides; if that is ever proposed, a `scripts/walkforward_evaluate.py` run is mandatory first.

### 4. Tests — PASS
`python -m pytest tests/ -q` from repo root: **95 passed in 0.63s** (0 failures). `tests/test_indicators.py` alone: 52 passed (41 pre-existing + 11 new TestAdx/TestObv), matching README's stated count.

### 5. Hard rules (CLAUDE.md) — PASS
No order path, limit-band, cap, cash-reserve, stop-loss, trailing-stop, dedup, regime-gate, or score-gate code touched. Working tree clean at HEAD `939ded7`.

## Verdict
**PASS**
- Rule consistency: PASS — signal_score and dashboard untouched; docs aligned.
- Soundness: PASS — ADX/OBV mathematically correct; informational wiring cannot reach decision branches.
- Tests: PASS — 95/95.
- Hard rules: PASS — none affected.
- LOW (pre-existing, not from 939ded7): README.md project-structure `tests/` listing shows only conftest/test_indicators/test_risk; `tests/` also contains test_bars_fetch.py, test_scout.py, test_trade_stop_clamp.py.

## Recommendations
1. (LOW) Update README.md's `tests/` tree to include test_bars_fetch.py, test_scout.py, test_trade_stop_clamp.py — pre-existing doc drift, unrelated to this commit.
2. Keep the parity exemption discipline: any future proposal to score ADX/OBV must re-tune buy/sell/scout gate thresholds and mirror `calcSignalScore()` in the dashboard, backed by a walk-forward run.
3. Optionally, hourly research blocks could reference the new `adx`/`obv` journal lines when judging whipsaw risk on golden crosses (ADX < 20) — advisory use only, as designed.

## Data sources
- `git log` / `git diff --stat` / `git diff 0f25f2f..939ded7` on scripts/indicators.py, scripts/run_evaluation.py, CLAUDE.md, README.md, memory/*, docs/*
- Grep of `adx|obv` in scripts/run_evaluation.py and scripts/indicators.py
- `python -m pytest tests/ -q` (95 passed), `python -m pytest tests/test_indicators.py -q` (52 passed), `python -m pytest tests/ --collect-only -q`
- `python scripts/indicators.py` self-test
- Files read: C:\Claude\Projects\alpaca-trading-agent\config.json, CLAUDE.md
