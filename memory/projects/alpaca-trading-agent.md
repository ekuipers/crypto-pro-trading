# Project: Alpaca Trading Agent

**Status:** Active — paper trading only  
**Account:** PA3EZEE1I9RS  
**Root:** `C:\Claude\Projects\alpaca-trading-agent`  
**Owner:** Erik (the.eekman@gmail.com)  
**Timezone:** GMT+2 (Europe/Amsterdam)

---

## What It Is

An autonomous paper crypto trading agent built on the Alpaca API. It evaluates 10 crypto symbols on a 24/7 schedule using a 6-point signal confluence system, multi-timeframe analysis (daily / 4H / 15-min), and ATR-based position sizing. All orders flow through `scripts/trade.py` which enforces hard risk rules in code.

---

## Architecture

```
alpaca-trading-agent/
├── CLAUDE.md                    ← Agent hard rules (DO NOT OVERWRITE)
├── memory.md                    ← Hot cache (this project's working memory)
├── memory/
│   ├── glossary.md              ← Full decoder ring
│   └── projects/
│       └── alpaca-trading-agent.md  ← This file
├── config.json                  ← Central config: strategy, risk, indicators, portfolio caps, watchlist
├── scripts/
│   ├── run_evaluation.py        ← Main eval loop; run with --execute to trade
│   ├── indicators.py            ← TA library: RSI, MACD, BB, ATR, EMA cross, vol ratio
│   ├── trade.py                 ← Order placement (enforces all hard rules)
│   └── verify.py                ← API smoke test
├── journal/
│   └── YYYY-MM-DD.md            ← Daily trading journals (append, never overwrite)
├── docs/
│   ├── portfolio-dashboard.html       ← Legacy dashboard (5 tabs: Overview, Hot Symbols, Distribution, Morning Brief, Settings)
│   ├── dashboard_professional.html       ← Primary dashboard (12 tabs — see dashboard_layout.md)
│   └── dashboard_layout.md            ← Tab structure, feature notes, changelog
└── skills/
    └── crypto-trader/
        └── SKILL.md             ← Full strategy playbook (read before any trade eval)
```

---

## Schedule

| Time (GMT+2) | Task |
|-------------|------|
| Every hour :00 | Research routine for all 10 symbols |
| Every hour :23 | `run_evaluation.py --execute` — evaluate + trade |
| 07:00 daily | Morning brief (scheduled task) — eval + journal + dashboard |
| 23:21 daily | Closing journal entry |

---

## Scheduled Tasks (Cowork)

| Name | Cron | Status | What it does |
|------|------|--------|-------------|
| `morning-brief` | `0 7 * * *` | enabled | Runs verify.py + run_evaluation.py; writes ## Morning Brief block to journal; opens dashboard; gives Erik a short summary |
| `morning-evaluation` | `0 9 * * *` | **disabled** | Daily evaluation — compute signals for all watchlist symbols and execute trades where warranted |
| `daily-journal` | `21 23 * * *` | enabled | Closing journal entry — summarise trades, P&L, and market observations |

---

## Session History

### 2026-06-07 — Fix: Market Overview symbol column overflowing to next row
In `renderMarketOverview` (dashboard_professional.html ~line 5538), the symbol cell was missing its opening `<td>`: the rank `<td>` closed, then `tvLink()` emitted a bare `<a>` + name `<span>` followed by a stray `</td>`. With no opening cell tag, the browser hoisted the symbol/name content out of the table grid, so it rendered on a separate line instead of beside the Rank column. Fix: prepended `"<td>"` before `tvLink(...)`. Other tables (Market Signals ~5751, ~5773) already wrap their symbol in a proper `<td>`. Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: removed 30-symbol hard clamp on Max Symbols
`maxSignalSymbols` was clamped to 1–30 in three places (`saveSettings`, `updateScanBtnLabel`, `loadMarketSignals`). Per request, removed the `Math.min(30 / TOP30_SYMBOLS.length, ...)` upper bound; now `Math.max(1, Math.round(value))` — the entered number is used as-is (minimum 1). Note the scan universe is still the 30 `TOP30_SYMBOLS`, so a value above 30 just scans all of them (`TOP30_SYMBOLS.slice(0, n)` caps at array length). Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Fix: Max Symbols setting reset to 30 on refresh
`maxSignalSymbols` (and any other `limits` value) reset to the `config.json` default on every reload. Cause: `loadConfigFromFile()` merged `config.json`'s `limits` *over* the user's saved `localStorage` limits (`Object.assign({}, existing.limits, cfg.limits)`), so config.json (30) always won. API keys were unaffected only because config.json's key fields are blank. Fix: flipped the limits merge to `Object.assign({}, cfg.limits, existing.limits)` so saved `localStorage` values win and `config.json` only fills gaps (seed/fallback for a fresh browser). Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Dashboard: removed config.json save-to-file
Per request, dropped the write-to-`config.json` path. Removed `saveConfigToFile()` and the `_configFileHandle` var; `saveSettings()` is no longer `async` and persists to `localStorage` only (alert back to "Settings saved locally in this browser."). `loadConfigFromFile()` is unchanged — `config.json` is still fetched on page open to seed settings (load-only). To change on-disk defaults, edit `docs/config.json` directly. Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Fix: dashboard TDZ crash + config.json settings persistence
**Two issues reported:** (1) Market Signals scan button dead and Market Overview throwing `Cannot access 'TOP30_SYMBOLS' before initialization`; (2) request to persist all Settings-tab values to a `config.json` next to the HTML and load them on open.

**Root cause of (1):** the `updateScanBtnLabel()` call I had added to the early top-level init ran *before* `const TOP30_SYMBOLS` (declared much later in the same script). `const` has a temporal dead zone, so the access threw at top level and aborted the entire script — the const never initialized, so every later consumer (scan, Market Overview) failed. (Also discovered the working-tree HTML + all four doc files had been truncated mid-file by earlier file-tool writes; restored each from `git show HEAD:` via in-place overwrite, since `git checkout` couldn't unlink on the mount.)

**Fixes (all applied through the shell, not the file editor, to avoid re-truncation):**
- Removed the early `updateScanBtnLabel()` call. Wrapped the credential-dependent bootstrap in an `(async function bootstrapDashboard(){ await loadConfigFromFile(); renderMode(); updateScanBtnLabel(); ... })()` IIFE. Because it awaits, the synchronous remainder of the script (incl. the `TOP30_SYMBOLS` const) finishes first, so the label call is safe.
- Added `loadConfigFromFile()` — `fetch('./config.json')` on load, merges into `localStorage` (empty strings don't clobber stored keys; `limits` merged), then `loadSettingsForm()`.
- Added `saveConfigToFile(obj)` — writes `config.json` via File System Access API (`showSaveFilePicker`, handle cached in `_configFileHandle`); falls back to an `<a download>`. `saveSettings()` is now `async` and awaits it, with mode-aware alerts.
- Created `docs/config.json` (mode, 4 API fields, `limits` incl. `maxSignalSymbols`).
- Validated the inline script with `node --check` after every change. Note: `fetch('./config.json')` works when the dashboard is served over HTTP (GitHub Pages / local server); on bare `file://` Chrome blocks it and the dashboard falls back to `localStorage`.

Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Dashboard: Market Signals scan-button label made dynamic
Follow-up after user reported the Market Signals tab "still scans 30 / ignores the setting." The scan logic (`loadMarketSignals` → `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, maxSignalSymbols)`) was already correct in the file, so the report was almost certainly a cached-JS / stale-browser issue (the bash workspace mount was also serving a truncated copy cut off at line 5400 — file tools showed the complete file). To make the cap unmistakable and provide a version-check tell: renamed the static "▶ Scan All 30" button to a dynamic `#msScanBtn` updated by new `updateScanBtnLabel()` → `▶ Scan Top N`; called on page init, after `saveSettings()`, and at the start of each scan. Also dropped "Top 30" from the panel title and the initial `msLastUpdated` hint. Advised user to hard-refresh (Ctrl/Cmd+Shift+R) and re-save settings. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: Max Symbols setting for Market Signals scan
Added a **🔭 Signals Analysis** section to the Settings tab with one input, **Max Symbols in Market Signals scan** (`setMaxSignalSymbols`). Persisted as `limits.maxSignalSymbols` (default 30, clamped 1–30) — added to `DEFAULT_LIMITS`, wired through `getSettings()`, `loadSettingsForm()`, and `saveSettings()`. `loadMarketSignals()` now derives `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, maxSignalSymbols)` (top-N by market cap, since `TOP30_SYMBOLS` is cap-ranked) and uses it for all bar/snapshot fetches, the scan loop, and the "N/M symbols analysed" footer. Watchlist Signals tab (fixed 10) and Market Overview (full 30) are unaffected — confirmed with the user this should apply only to the Market Signals scanner. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: tidied Settings tab layout
Reorganised the Settings tab (`#page-settings`) in `docs/dashboard_professional.html`. Previously the Live API Key/Secret shared one `form-grid` with the three risk-limit inputs, so the fields wrapped unevenly. Now there are three labelled 2-column `form-grid` blocks: **📄 Paper Trading** (Key + Secret), **🔴 Live Trading** (Key + Secret), and a new **🛡 Risk Limits** block (Assumed Stop Loss %, Max Daily Loss %, Max Open Risk %) placed below the API credentials. API key/secret pairs now line up side by side per environment; risk limits sit in their own block under the keys. No JS/IDs changed (`setPaperApiKey`, `setLiveApiKey`, `setStopLoss`, etc. untouched). Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Fix: Backtest vs Live tab — broken Win Rate & Profit Factor
The Backtest tab's "Strategy Health" comparison had two non-functional metrics. **Win Rate Proxy** compared each filled order's `filled_avg_price` against its `limit_price` (`fill <= limit` for buys, `fill >= limit` for sells) — but limit orders by definition always fill at or better than the limit, so the proxy was permanently ~100% and always green regardless of actual profitability. **Profit Factor** was hardcoded to `null` → permanently `n/a`. Meanwhile the P&L tab already computed correct realized win rate and profit factor via FIFO matching. Fix: extracted that FIFO engine into a shared `computeFifoStats(activities)` helper (long-only buy→sell matching, identical behaviour to the P&L tab's original inline code). `loadContext()` now fetches `/v2/account/activities?activity_type=FILL` and attaches `c.fifoStats`; `renderBacktest()` reads `c.fifoStats.winRate` / `.profitFactor` for both the comparison table and the KPI tiles. `loadPnl()` refactored to call the same helper (single source of truth). Removed the now-orphaned "Filled Order Sample" KPI. Verified the helper with a unit test (1 win / 1 loss → winRate 50%, PF 0.5). Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Fix: Markov matrices overlapping in dashboard
The Markov tab's transition matrices were overflowing their `grid-3` panels and overlapping. Root cause: the global `table { min-width:760px }` rule (needed for the wide data tables elsewhere) applied to the small 5-column matrix tables sitting in ≥230px grid columns. Fix: added a `.mk-matrix` class (`min-width:0; table-layout:fixed; th/td padding 6px 7px; white-space:nowrap`) and tagged the `mkMatrixTable()` `<table>` with it. Tables now constrain to their card width. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Daily closing journal (scheduled pass)
Wrote `journal/2026-06-06.md` Daily Close block. Equity $95,623.28, 100% cash, 0 open positions, flat vs prior day (last_equity unchanged), $0 realized/unrealized. No orders today (Alpaca `/v2/orders` after 2026-06-06T00:00Z returned 0). All watchlist symbols scored below the buy gate during the concurrent 14:04 evaluation pass — EMA death crosses across the board, oversold RSI on alts but no confluence ≥ 3 and regimes mixed/uptrend, so the agent stayed flat. Rule compliance clean: cash reserve 100% (≥20%), no caps breached, no missed stops. Write-only pass — no orders placed.

### 2026-06-05 — Dashboard: tab nav moved to left sidebar
Converted `docs/dashboard_professional.html`'s top horizontal tab bar into a left vertical sidebar. Wrapped `<nav>` + `<main>` in a new `.layout` flex container; `nav` is now a 210px sticky column (`flex:0 0 210px`, `top:57px`, own `overflow-y`). `.tab-btn` restyled to full-width left-aligned rows with a left blue border + tint for the active state. Mobile media query (≤700px) sets `.layout{flex-direction:column}` and reverts `nav` to a horizontal scrolling bar with a bottom-border active marker, so phone layout is unchanged. Pure layout/CSS change — no JS or scoring logic touched. Verified div balance and `node --check` on the script block.

### 2026-06-05 — Dashboard: new 🔗 Markov tab (BTC/ETH transition-matrix analysis)
Added a `Markov` tab to `docs/dashboard_professional.html`. For `MK_SYMBOLS` (BTC/USD, ETH/USD) across `MK_INTERVALS` (30/60/90/180/365-day windows) it classifies each daily close-to-close return into Up/Flat/Down via a ±`MK_THRESH` (1%) band (`mkClassify`), then `mkBuild()` computes the 3×3 transition matrix `P(next|current)`, the stationary distribution (power iteration with self-loop fallback for unseen rows), the current-state next-day forecast, and the mean daily return. `mkIntervalCard()` renders one heatmap-shaded matrix per window (< 3 transitions → "Insufficient data"); KPI tiles show each symbol's 90-day next-day-up probability. Single `fetchBars(MK_SYMBOLS, "1Day", maxDays+5)` call per run feeds all five windows. User-triggered via `loadMarkov()` (▶ Run Markov Analysis); not auto-run on tab switch. Analysis-only — places no orders, separate from the 6-point execution score. Verified: JS `node --check` passes; standalone test confirms transition rows and stationary vectors sum to 1 and the < 3-transition edge case is gated.

### 2026-06-05 — Dashboard: executable Morning Brief + Daily Journal header buttons

**Scope:** Added top-row "execute" buttons to both dashboards that generate the daily artifacts client-side from live Alpaca data, preview them in a modal, and offer a `.md` download.

- **`docs/portfolio-dashboard.html`** — new header button `🌅 Morning Brief` → `generateMorningBrief()`. Fetches `/v2/account` + `/v2/positions`, runs the existing `confluenceScore`/`fetchBars` engine over the 10-symbol `CRYPTO_WL`, and builds Markdown matching the `journal/` morning-brief format: Portfolio Health (+ per-position table with direction-aware stop/target), Alerts, Signal Confluence table, templated Market Notes. Preview modal `#briefDocBackdrop` with Copy + Download `.md` (`morning-brief-YYYY-MM-DD.md`).
- **`docs/dashboard_professional.html`** — new header button `📓 Daily Journal` → `generateDailyJournal()`. Fetches account, positions, and `/v2/account/activities?activity_type=FILL`; filters fills to the GMT+2 calendar day; FIFO-computes today's realized P&L; runs a closing 10-symbol `JOURNAL_WL` scan via `calcSignalScore`. Sections: Summary, Trades Today, Open Positions, Market Observations. Preview modal `#journalDocBackdrop` with Copy + Download `.md` (`daily-journal-YYYY-MM-DD.md`).
- Both use the `Etc/GMT-2` IANA timezone for GMT+2 timestamps and day filtering. No backend/server required — fully client-side, reusing each dashboard's existing helpers.
- **Verification:** extracted both JS blocks into standalone files and ran `node --check` + execution with mocked helpers — both parse and run clean. (Note: the bash mount lagged the file-tool writes during this session; validation was done on freshly-written standalone copies.)

### 2026-05-27 — Risk Management Chapter 2: five improvements implemented

**Scope:** Full implementation of all five Chapter 2 risk improvements identified in the `reports/trading-analysis-2026-05-27.md` performance review.

**Files changed:** `scripts/risk.py`, `scripts/trade.py`, `scripts/run_evaluation.py` (new logic), `scripts/position_state.py` (new file), `config.json` (13 new risk parameters), `CLAUDE.md`, `README.md`, this file, `memory/glossary.md`.

**2.1 — Stop-loss order deduplication (`run_evaluation.py` + `trade.py`)**
- Added `get_open_orders(symbol)`, `get_order(order_id)`, `cancel_order(order_id)` to `trade.py`.
- Before placing any SELL/COVER stop-loss order, `run_evaluation.py` now fetches open orders for the symbol. If a pending order is found within `stop_loss_escalation_cycles` (2) cycles, it skips placing a duplicate. Fixes the ADA infinite-loop bug (30+ duplicate orders).

**2.2 — Wider stop-loss limit band + time-escalation (`risk.py` + `config.json`)**
- New constants: `STOP_LOSS_LIMIT_BAND_PCT` (0.5%), `STOP_LOSS_ESCALATION_CYCLES` (2), `STOP_LOSS_ESCALATION_EXTRA_PCT` (0.3%).
- New functions: `stop_loss_limit_price(ask, cycles_open)`, `cover_limit_price(ask, cycles_open)`.
- `place_order()` gains `is_stop_loss: bool` param — when True, uses 0.5% band instead of 0.2%.
- After 2 unfilled cycles, the band widens by an extra 0.3% to force execution.

**2.3 — Trailing stops (`risk.py` + `position_state.py` + `run_evaluation.py`)**
- New file `scripts/position_state.py`: atomic JSON state manager for `data/positions_state.json`.
  - Per-symbol: `entry_price`, `high_water_mark`, `stop_order_id`, `stop_order_cycles`.
  - Portfolio: `day_open_equity`, `capital_preservation_mode`.
- New functions in `risk.py`: `trailing_stop_price()`, `should_trail_stop_out()`, `effective_stop_pct()`.
- Trailing stop activates at +2.5% gain (`trailing_stop_activation_pct`), trails 3% below HWM (`trailing_stop_trail_pct`). HWM updated each HOLD cycle in `main()`.

**2.4 — Correlation budget (`risk.py` + `run_evaluation.py`)**
- New functions: `correlation_budget_allows(symbol, open_symbols)`, `tier_count(symbol, open_symbols)`.
- Tier-1: BTC/USD, ETH/USD. Tier-2: all other alts. Max 3 total, max 2 per tier.
- New entries blocked at the `open_symbols` gate in `run_evaluation.py` before any sizing.

**2.5 — Portfolio-level daily drawdown gate (`risk.py` + `position_state.py` + `run_evaluation.py`)**
- New functions: `daily_drawdown_pct()`, `daily_drawdown_gate_triggered()`.
- `main()` calls `check_and_refresh_day_open(state, equity)` at startup to snapshot opening equity.
- If daily drop ≥ 3%, `activate_capital_preservation()` sets flag in state; all new entries blocked.
- State resets automatically at midnight UTC via `check_and_refresh_day_open`.

**Verification:** All `risk.py` self-checks pass. All `position_state.py` smoke tests pass. All four script files parse clean (667 / 379 / 324 / 206 lines). Import chain verified via `ast` inspection.

---

### 2026-05-26 — Python ↔ Dashboard consistency audit + two bug fixes

**Scope:** Full parity check between `scripts/indicators.py`, `scripts/run_evaluation.py`, `scripts/trade.py`, `scripts/risk.py` and `docs/dashboard_professional.html`.

**Bugs found and fixed:**

1. **MACD signal line always NaN (critical)** — `calcMACD()` in the dashboard built `macdLine` with NaN for its first 25 positions (ema26 only valid from index 25), then passed this NaN-prefixed array to `emaArr(macdForSignal, 9)`. The EMA seed computation (`seed += src[0..8]`, all NaN) produces NaN, making the entire signal line NaN. Therefore `histogram = macdLine − NaN = NaN` always. The MACD signal was always "0 Flat" regardless of market conditions (max achievable score was ±5 not ±6). **Fix:** strip NaN prefix before computing signal EMA, then re-pad to full length.

2. **Half-size score pill used strict equality** — Pills for "HALF" (`score === 3`) and "SHORT ½" (`score === -3`) missed scores of 3.5 and -3.5 respectively. Python fires at `score >= 3.0` (half-size). **Fix:** changed to `>= 3 && < 4` and `<= -3 && > -4` across Signals tab, Market Signals tab, KPI counters, and score distribution chart.

**Confirmed correct (no change needed):** EMA seeding, EMA ±0.05% dead zone, ATR formula, ATR multiplier (1.5×), position sizing formula, Bollinger bands (population std-dev), BB thresholds (0.25/0.75), volume ratio formula (prev-20 average), volume thresholds (1.2×/0.7×), daily regime (SMA20/SMA50), MACD 2-bar rising check, stop-loss trigger (5%), bar completeness (end=now−1 bar).

**CLAUDE.md updated:** Added `Python ↔ Dashboard consistency check` section with a 10-point checklist to run after any indicator logic change.

---

### 2026-05-26 — Bar fetch: exclude in-progress bar from all indicator calculations

**Root cause:** Neither `run_evaluation.py` nor the dashboard's `fetchBars` passed an `end` parameter to the Alpaca bars API. Alpaca returns the currently-forming bar in responses with no `end`. This partial bar has near-zero volume (only trades since bar open), causing `volume_ratio ≈ 0.00×` and unstable RSI / MACD / BB values that shift wildly depending on the exact second the page loads or the script runs.

**Fix:** Added `_bars_end(timeframe)` to `scripts/run_evaluation.py` and `barsEnd(timeframe)` to the dashboard, both computing `now − 1 bar period`. Wired `end=` into:
- `scripts/run_evaluation.py` → `get_crypto_bars()` params
- `docs/dashboard_professional.html` → `fetchBars()` URL

**Effect:** Both now always use only fully-closed bars. Results are stable within a bar period and consistent between Python and the dashboard when checked at the same time.

---

### 2026-05-26 — Dashboard: Signal Confluence scoring fixed to match indicators.py exactly

**Root cause:** Four discrepancies between `docs/dashboard_professional.html`'s `calcSignalScore()` and `scripts/indicators.py`'s `signal_score()` caused significantly different scores between the journal and the Signals/Market Signals tabs.

**Fixes applied to `docs/dashboard_professional.html`:**

1. **EMA seeding (`emaArr`):** Dashboard was seeding with the first raw value; Python seeds with the SMA of the first `period` values. Fixed to match, affecting all EMA-derived signals (1, 6).

2. **EMA dead zone (Signals 1 & 6):** Dashboard had no dead zone — EMAs equal or very close gave -1. Python uses ±0.05% band (`ema20 > ema50 * 1.0005` = golden, `< 0.9995` = death, else neutral = 0). Fixed for both the 15-min EMA cross and the 4H regime.

3. **MACD partial credits (Signal 2):** Dashboard had only +1/-1/0. Python gives +0.5 for green-but-not-rising histogram and -0.5 for red-but-improving. Also upgraded from 1-bar to 2-bar rising lookback (matching `macd_hist_rising(lookback=2)`). Added `prevHistogram2` to `calcMACD()` and `calcRSIRising()` helper.

4. **RSI direction check (Signal 3):** Dashboard gave +1 for RSI 40–65 regardless of direction. Python requires RSI to be rising (3-bar lookback). Also added -0.5 partial credit for RSI < 40 AND falling. Added `calcRSIRising()` helper function.

---

### 2026-05-25 — New Script: `scripts/rebalance.py`

Added `scripts/rebalance.py` — a portfolio rebalancer that aligns positions to their caps in `config.json › portfolio_caps.caps`.

**Logic:**
- Loops over all watchlist crypto symbols.
- **Over-cap** positions: trims the excess immediately (no signal gate needed — reducing risk).
- **Under-cap** positions: tops up only when signal gate passes (score ≥ 4 full-size, score = 3 half-size) AND daily regime is not downtrend.
- Stop-loss checks (`should_stop_out`) always fire regardless of cap status.
- ATR-based sizing applies; hard cap = remaining gap to target cap.

**Order routing:** uses `trade.place_order()` — all hard rules enforced.

**Journal:** appends a `## Rebalance HH:MM GMT+2` block to the day's journal with a per-symbol table (current%, cap%, score, action).

**Usage:**
```bash
python scripts/rebalance.py           # dry-run
python scripts/rebalance.py --execute # place orders
```

---

### 2026-05-22 — Full Short-Selling Support Added

**`config.json` — three short-side thresholds added to `strategy` block:**
- `short_score_threshold: -4.0` — full-size short entry gate
- `short_score_half_size_threshold: -3.0` — half-size short entry gate
- `cover_score_threshold: 2.0` — cover a short when TA turns bullish

**`scripts/risk.py` — two new functions:**
- `should_cover_short(entry_price, current_price)` — returns True if price has risen ≥5% above short entry (symmetric inverse of `should_stop_out`)
- `short_stop_price(entry_price)` — returns `entry_price × 1.05`

**`scripts/run_evaluation.py` — full bidirectional trading:**
- Detects open short via `qty < 0` from Alpaca positions API
- Short stop-loss: `should_cover_short()` triggers immediate COVER
- TA cover: score ≥ `COVER_SCORE_THRESHOLD` (+2) → COVER
- Short entry: regime must be `downtrend`, score ≤ `SHORT_SCORE_HALF_SIZE` (−3); full size at ≤−4, half-size at −3
- Sizing: uses `bid` as reference price for SHORT limit orders; COVER limit = `ask × (1 + limit_band × 0.5)`
- Order routing: `side="sell"` for BUY→no wait, SHORT→sell; `side="buy"` for COVER→buy
- Added constants: `SHORT_SCORE_THRESHOLD`, `SHORT_SCORE_HALF_SIZE`, `COVER_SCORE_THRESHOLD`

**`docs/dashboard_professional.html` — short-aware UI updates:**
- Hard Rules panel: adverse stop check now direction-aware (short: price rose ≥5%)
- Positions tab: `isShort = qty < 0`; stop = `entry×1.05`, target = `entry×0.90` for shorts; SHORT badge; `Buy / Cover` button
- `actionPill()`: regime-gated — SHORT/SHORT½ pills only appear in downtrend
- `const down` variable declared inside `.map()` callback before use (bug fix)
- Notifications: BUY alert gated on `!down`; SHORT alert for `score <= -4` in downtrend
- ⚡ Quick-fill: `⚡ Buy` for longs; `⚡ Short` (side=`sell`) for shorts in downtrend
- Score distribution label: "≤ −3 (SELL)" → "≤ −3 (SHORT)"
- Market Signals `msActionPill`: same regime-aware logic; "SELL" → "SHORT"/"SHORT½"
- KPI label: "SELL/Avoid" → "SHORT/Avoid"

**`docs/portfolio-dashboard.html` — short-aware UI updates:**
- `renderPositions` (Overview): `isShort = qty < 0`; direction-aware stop/target; SHORT badge; `Buy / Cover` button
- `renderBriefPos` (Morning Brief): direction-aware stop price, distToStop, stopProg, nearStop; P&L from `unrealized_plpc` (pre-computed, direction-correct)
- Alerts panel: short-specific proximity alerts mention `(SHORT)` and cover stop price
- `actionChip()`: full regime-aware logic — SHORT ≤−4/6, ½ SHORT −3/6, TA SELL ≤−2 (exit long only)
- `actionRank()`: updated to accept `(score, dailyRegime)` pair; 5-level ranking

**`CLAUDE.md` — documentation standing rule added:**
- Prominent callout at top of Trading Agent Instructions: update CLAUDE.md, README.md, memory/projects/alpaca-trading-agent.md, and memory/glossary.md after every change, no exceptions
- Hard Rules table updated for short direction (stop-loss, score gate, regime gate, cover signal)
- Signal Confluence entry/exit rules updated to include SHORT and COVER

**Persistent memory (Cowork spaces):**
- `feedback_doc_updates.md` created — feedback-type memory recording the documentation standing rule
- `MEMORY.md` updated with pointer to the feedback memory

---

### 2026-05-21 — Dashboard: Market Overview + Market Signals tabs added

### 2026-05-21 — Dashboard: Signals tab execute button

- Added `▶ Execute` direct execution buttons to `docs/dashboard_professional.html` on Signals tab rows.
- The button submits the existing ATR-based paper order quantity immediately in paper mode, while preserving the live-mode guard.


**Two new tabs added to `docs/dashboard_professional.html` (now 12 tabs total):**

- **🌍 Market Overview** — loads automatically on tab open. Fetches live price, 24h%, 7d% (from daily bars), USD volume, and trend direction for 30 crypto symbols ranked by market cap (`TOP30_SYMBOLS`). Sortable by rank, 24h% up/down, 7d%, or signal score. Includes a color-coded momentum heatmap below the table. Score column pulls from `_msPrevScores` cache set by a Market Signals scan.
- **🔭 Market Signals** — on-demand "Scan All 30" button. Runs the full `calcSignalScore` 6-point confluence engine across all 30 symbols using the existing paginated `fetchBars` function (15-min, 4H, daily timeframes). Renders the same table format as the watchlist Signals tab, plus a score distribution summary and a Top Opportunities panel. Cached scores in `_msPrevScores` feed back into the Market Overview Score column.
- New JS globals: `TOP30_SYMBOLS` (array), `TOP30_INFO` (metadata per symbol), `_moData` (cached overview rows), `_msPrevScores` (cross-tab score cache).
- New functions: `loadMarketOverview()`, `loadMarketSignals()`, `moApplySort()`, `renderMoTable()`, `renderMoHeatmap()`, `moFmtPrice()`, `moFmtVol()`, `moChgHtml()`, `moTrendIcon()`, `moTierColor()`.
- switchTab wired: `market-overview` auto-runs on open; `market-signals` is manual (same pattern as Breakout Scanner).
- Note: smaller-cap symbols (ATOM, XLM, COMP, SNX, ENS) have no data on Alpaca — show "–" gracefully. `1INCH/USD` replaced with `MATIC/USD` (see below).

---

### 2026-05-25 — Dashboards: TradingView symbol links added

- Added `tvLink(sym, label)` helper to both `dashboard_professional.html` and `portfolio-dashboard.html`.
- Converts any symbol form ("BTC/USD", "BTCUSD", "BTC") to a `https://www.tradingview.com/chart/?symbol=CRYPTO:BTCUSD` URL.
- Every `<span class="symbol">` in both dashboards now wraps its text in the link — opens in a new tab (`target="_blank"`).
- Added `.tv-link` CSS class: inherits colour, no underline at rest, underline + slight fade on hover.
- 15 call-sites in the pro dashboard, 12 in the portfolio dashboard; zero unlinked symbol spans remain.
- **IMPORTANT — file write pattern for large HTML files**: Never use Python `open(path,'w').write(html)` directly on the Windows-mounted path (`/sessions/.../mnt/`). Large writes on the FUSE/SMB mount are silently truncated. Always write to `/tmp/` first, verify `</html>` is present, then `cp` to the mounted path.

---

### 2026-05-25 — Dashboards: Mobile portrait table horizontal scroll fixed

**`dashboard_professional.html`**
- **Root cause**: `.table-wrap` used `overflow:auto` without an explicit width constraint. On mobile, block elements expand to fit content, so the wrapper grew to 760px+ alongside the table instead of staying at viewport width and scrolling.
- **Fix**: Added `max-width:100%` and `-webkit-overflow-scrolling:touch` to `.table-wrap` globally. In the `@media (max-width:700px)` block, overrode to `overflow-x:scroll` and `max-width:calc(100vw - 32px)`. Same constraint applied to `.corr-wrap`.

**`portfolio-dashboard.html`**
- **Root cause**: `.table-wrap` and `.conf-wrap` both used `overflow:hidden` — actively clipping tables with no scroll at all. No `@media` query existed. Tables had no `min-width` so they compressed instead of scrolling.
- **Fix**: Changed both wrappers to `overflow-x:auto` + `-webkit-overflow-scrolling:touch` + `max-width:100%`. Added `min-width:700px` to all tables. Added `@media (max-width:700px)` block clamping both wrappers to `calc(100vw - 24px)` with `overflow-x:scroll`.

---

### 2026-05-25 — Dashboard: Market Overview snapshot fetch fixed

- **Root cause**: `1INCH/USD` fails Alpaca's symbol regex (`^[A-Z]+x?/[A-Z]+$`) — starts with a digit. When included in the combined 30-symbol snapshot request it returned HTTP 400, wiping **all** price/24h%/volume columns for every row.
- **Fix 1**: Replaced `1INCH/USD` with `MATIC/USD` in `TOP30_SYMBOLS` and `TOP30_INFO`.
- **Fix 2**: Added `fetchSnapshotsInBatches()` (mirrors `fetchBarsInBatches` pattern) — snapshots now fetched in batches of 10 so one unsupported symbol can never blank the entire table. Used in both `loadMarketOverview()` and the Market Signals scanner.

---

### 2026-05-21 — Scheduled Task: morning-evaluation disabled

- Disabled the `morning-evaluation` scheduled task (was: daily 09:02, enabled). No code changes; documentation updated only.

---

### 2026-05-20 — Dashboard Professional: Ticker + Signals + Correlation + UX

**Bug fixed — Signals tab "Insufficient Bars" for 9/10 symbols:**
- Root cause: Alpaca multi-symbol bars API paginates by *total bars across all symbols*, not per-symbol. With 10 symbols × 100 bars, the first page only returned ~10 bars for the first symbol, leaving the rest empty.
- Fix: Rewrote `fetchBars()` in the dashboard to follow `next_page_token` pagination (up to 20 pages), accumulating all bars before returning. Pattern mirrors the `ggFetchBarsAllPages` function already in the file.

**Dashboard improvements implemented (all in `docs/dashboard_professional.html`):**

1. **Live ticker strip** — new top-of-page bar showing price + 24h% for all 10 symbols. Fetches `/v1beta3/crypto/us/snapshots`. Initially broken due to JavaScript TDZ (see below); fixed.
2. **Correlation heatmap** — new 10×10 matrix in Risk tab. Computes Pearson ρ from daily log-returns. Red = high positive correlation, blue = negative.
3. **Live hard rules panel** — Command tab now checks 6 rules in real time (cash %, daily loss, open risk, drawdown, stop-loss proximity, limit-orders-only) with green/yellow/red indicators.
4. **Positions table enhanced** — added Stop $ (`entry × 0.95`), Target $ (`entry × 1.10`), and Live R:R columns. Colspan updated 10→13.
5. **Signals tab enhanced** — trend arrows (↑/↓/→ comparing current score to previous scan), ATR-based suggested quantity per row, ⚡ quick-buy button (score ≥ 3) that pre-fills the trade modal with ATR qty.
6. **P&L tab enhanced** — added P&L attribution by symbol table and day-of-week performance table.
7. **3-mode auto-refresh** — button cycles: `Auto OFF` → `Prices 15s` (ticker-only, 15 s) → `Full 60s` (ticker + full dashboard).

**Bug fixed — live ticker TDZ (Temporal Dead Zone):**
- Root cause: `const DATA_URL` and `let _tickerTimer` were declared at line ~3227, *after* the inline startup block at line ~2970 that called `loadTickerStrip()` and assigned `_tickerTimer`. JavaScript `let`/`const` are in TDZ until their declaration is evaluated; referencing them before that throws `ReferenceError`. The `catch(e) { /* silent */ }` in `loadTickerStrip` swallowed the error.
- Fix: Moved both declarations to line 1648 (right after `autoRefreshTimer`), well before the startup block. Removed the `setTimeout` workaround. No TDZ; ticker now loads on page open and refreshes every 15 s.

**File truncation (recurring issue):**
- Large Edit operations can truncate the file, cutting off the closing `}`, `</script>`, `</body>`, `</html>`. Always verify with `tail -3` after edits. Restore from `git show HEAD:docs/dashboard_professional.html | tail -n +<line>` if needed.

---

### 2026-05-19

**`trade.yml` secrets → GitHub Environments:**
- Old model: 4 separate repository secrets (`APCA_PAPER_KEY_ID`, `APCA_PAPER_SECRET_KEY`, `APCA_LIVE_KEY_ID`, `APCA_LIVE_SECRET_KEY`)
- New model: 2 GitHub Environments (`paper`, `live`), each with `APCA_API_KEY_ID` + `APCA_SECRET_KEY`
- Added `environment:` field to both jobs; without it, environment secrets are never injected
- Error messages updated to point to Settings → Environments → {env} → Secrets

**Global skill installed:**
- `karpathy-guidelines` from `https://github.com/multica-ai/andrej-karpathy-skills`
- Invoke with `/karpathy-guidelines` — behavioral guidelines for LLM coding (simplicity, surgical changes, goal-driven execution)

**`README.md` updated** — corrected GitHub Actions secrets section to reflect Environments model

---

### 2026-05-14 — Initial Setup & Major Rewrite

**Portfolio validation:**
- All 9 open positions were 2–3× over the 5% hard cap (range: 9.7%–14.8%)
- Cash critically low: $1,111 (1.1%) — no dry powder for new trades
- DOGE and AAVE in confirmed daily downtrend → regime blocked
- SOL weakest at −2.07% (stop at −5%)
- DOGE strongest at +4.25% (approaching +10% take-profit)

**Bug fixed — Alpaca API returning 1 bar:**
- Root cause: `limit` param alone insufficient; API needs explicit `start` date
- Fix: Added `_bars_start(limit, timeframe, buffer=1.6)` function
  - Computes: `start = now − (limit × tf_minutes × 1.6)`
  - Applied to both 15-min bars and new 4H bars fetch

**`scripts/run_evaluation.py` major rewrite:**
- Added `_bars_start()` for correct historical bar fetching
- Added 4H bar fetching for primary trend filter
- Added ATR-based position sizing (1% risk rule)
- Updated buy threshold to 4.0 (from old 3.0)
- Added half-size logic at score=3.0 if R:R≥1:3
- Updated journal output format with `ema_x`, `atr`, `4h`, `signals` block
- Added daily regime detection with 90-bar lookback
- Constants: `BUY_SCORE_THRESHOLD=4.0`, `BUY_SCORE_HALF_SIZE=3.0`, `BARS_4H_TIMEFRAME="4Hour"`, `DAILY_BARS_LOOKBACK=90`

**`scripts/indicators.py` major additions:**
- Added `ema_cross_state(closes, fast=20, slow=50)` → "golden"/"death"/"neutral"
- Added `atr(highs, lows, closes, period=14)` — Wilder ATR
- Added `volume_ratio(volumes, period=20)` — current bar vs 20-bar avg
- Rewrote `signal_score()` to return `(score, breakdown_dict)` for full logging
- Fixed `%b` format bug: `"%%b=%.2f..."` (double `%%` escapes Python format codes)
- Multiple truncation bugs encountered during edits; fixed via Python reconstruction

**`CLAUDE.md` full rewrite:**
- Aligned with `skills/crypto-trader/SKILL.md` strategy playbook
- Added: Wyckoff phase section, 6-point confluence table, ATR sizing formula with worked example, 12-item decision checklist, common mistakes list
- Updated output format with `ema_x`, `atr`, `4h`, `signals` block

**`docs/portfolio-dashboard.html` — Morning Brief tab added:**
- Third tab button: `🌅 Morning Brief`
- Health strip (cash %, position count, regime status)
- Alerts box for stop-loss/take-profit proximity warnings
- Positions risk table (entry, current P&L, stop %, take-profit %)
- Confluence score table for all 10 symbols
- Full client-side TA engine in vanilla JS (no external libs)
- `confluenceScore(closes, volumes, closes4h, closesDaily)` function
- `fetchBars(symbol, timeframe, limitDays)` using explicit `start` date
- `async function loadBrief()` orchestrates everything

**`memory.md` created** — hot cache following memory-management skill pattern

**`memory/glossary.md` created** — full decoder ring

**`morning-brief` scheduled task created** — 07:00 Amsterdam daily

---

## Portfolio Dashboard (`dashboard_professional.html`)

10 tabs (key `1`–`9` + Settings):

| # | Tab | Key feature |
|---|-----|-------------|
| 1 | 🧭 Command | Trading permission status, cash reserve gate, live hard rules panel (6 real-time checks), trade modal |
| 2 | 📈 Performance | Equity curve, rolling 30D/90D Sharpe, win rate, profit factor |
| 3 | ⚠️ Risk | MDD, Sharpe, Sortino, portfolio cap usage, concentration panel, 10×10 correlation heatmap |
| 4 | 📂 Positions | P&L%, Stop $ / Target $, Live R:R column, cap usage per position |
| 5 | 🎯 Execution | Orders table, cancel-all, ATR Position Sizer |
| 6 | 📡 Signals | Live 6-point confluence scanner (paginated bars), trend arrows ↑↓→, ATR qty, ⚡ quick-buy, browser notification on score ≥ 4 |
| 7 | 💰 P&L | FIFO-matched realized P&L, calendar heatmap, P&L attribution by symbol, day-of-week performance, CSV export |
| 8 | 🧪 Backtest vs Live | Walk-forward report loader, strategy health indicator |
| 9 | 🔥 Gap & Go | Pre-session analysis: catalyst rating, supply risk, 6M range, key levels, historical gap-and-go rate, trade plan (entry/stop/T1/T2), risk rating — all 10 symbols ranked by conviction score |
| — | 🔗 Markov | First-order Markov chain analysis for BTC/USD & ETH/USD over 30/60/90/180/365-day windows: 3-state (Up/Flat/Down) transition matrix, stationary distribution, next-day forecast, mean daily return. Analysis-only |
| — | ⚙ Settings | API keys, mode toggle, notification permission |

**Top-of-page live ticker strip** — shows all 10 symbols with price + 24h change. Auto-refreshes every 15 s via `setInterval`. Uses `/v1beta3/crypto/us/snapshots` endpoint.

**3-mode auto-refresh button** — `Auto OFF` → `Prices 15s` (ticker only) → `Full 60s` (ticker + full dashboard).

Data source for Gap & Go: `https://data.alpaca.markets/v1beta3/crypto/us/bars` — 6M daily + 8D hourly bars fetched in parallel.

---

## Known Issues (as of 2026-05-14)

| Issue | Detail | Action needed |
|-------|--------|---------------|
| All 9 positions over 5% cap | Range 9.7–14.8%; hard rule violation | Trim each to ≤5% equity (~$4,966 per position) |
| Cash at 1.1% | $1,111 of ~$99,329 equity | Need to free up cash via trimming |
| DOGE daily downtrend | close < 50-SMA AND 20-SMA < 50-SMA | Regime blocked; no new buys; watch for take-profit at +10% |
| AAVE daily downtrend | Same as DOGE | Regime blocked |
| SOL near stop | −2.07% (stop at −5%) | Watch closely |

---

## ATR Sizing Example

```
Equity = $99,329
BTC ask = $103,500
ATR = $350

Max risk   = $99,329 × 1% = $993.29
Stop dist  = $350 × 1.5   = $525
ATR qty    = $993.29 / $525 = 1.892 BTC → $195,822 (way over cap)
Hard cap   = ($99,329 × 5%) / $103,500 = 0.048 BTC ✓
Final qty  = min(1.892, 0.048) × 0.99 = 0.0475 BTC
```

---

## API Notes

- **Paper URL**: `https://paper-api.alpaca.markets` (never use live URL)
- **Data URL**: `https://data.alpaca.markets/v1beta3/crypto/us/bars`
- **Auth**: `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers
- **Critical**: Always pass `start` param; `limit` alone returns partial data
- **Crypto**: No market hours — 24/7 trading

---

## Indicator Reference

| Indicator | Parameters | Signal |
|-----------|-----------|--------|
| EMA cross | 20 vs 50 on 15-min | Golden=+1, Death=−1 |
| MACD hist | 12/26/9 | Green+rising=+1, Red+falling=−1 |
| RSI | 14 Wilder | 40–65 rising=+1, <30=+1, >70=−1 |
| BB %b | 20/2σ | <0.25=+1, >0.75=−1 |
| Volume | vs 20-bar avg | ≥1.2×=+1, <0.7×=−0.5 |
| 4H regime | 20 EMA vs 50 EMA on 4H | Golden=+1, Death=−1 |
