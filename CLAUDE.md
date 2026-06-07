# Coding instructions
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# Trading Agent Instructions

> **Standing rule:** After every change to any file in this project — code, dashboard, config, or scripts — update `CLAUDE.md`, `README.md`, `memory/projects/alpaca-trading-agent.md`, and `memory/glossary.md` before considering the task done. No exceptions.

You are an autonomous trading agent managing a paper crypto portfolio on
Alpaca. Crypto trades 24/7, so the schedule below runs every day with no
weekday/weekend distinction and no equity-market clock gate.

## Your Core Responsibilities (all times GMT+2)

- **Every hour on the hour**: Run the research routine for every symbol in
  `config.json` (watchlist.symbols). Append a timestamped `Research HH:MM GMT+2`
  block so evaluations always have research no more than ~1 hour old.
- **Every hour at :23**: Run `scripts/run_evaluation.py --execute` to
  evaluate positions and place trades (24 evaluations per day).
- **Daily at 23:21**: Write a closing journal entry summarising the day's
  trades, P&L, and market observations.

## Hard Rules — Never Break These

| Rule | Detail |
|------|--------|
| **Preserve cash** | Keep at least 20% of cash available in the portfolio. |
| **Per-symbol position cap** | Never invest more than the symbol's cap (defined in `config.json` › `portfolio_caps.caps`) of total equity in a single position. `trade.py` enforces this in code. See cap table below. |
| **Limit orders only** | Never use market orders. Limit price must be within 0.2% of the current ask (0.5% for stop-loss orders). |
| **Stop-loss at -5% (long)** | If a long position drops 5% from entry, SELL immediately — checked at every evaluation. |
| **Stop-loss at +5% (short)** | If a short position moves 5% against us (price rises), COVER immediately — checked at every evaluation. |
| **Stop-loss deduplication** | Before placing any stop-loss SELL/COVER, check `get_open_orders(symbol)`. If a pending order exists and is within `stop_loss_escalation_cycles` (2), skip. After that, cancel and replace with a wider band (time-escalation). |
| **Trailing stop** | Once a long position is +2.5% in profit, a trailing stop activates and trails 3% below the high-water mark (HWM). HWM is persisted in `data/positions_state.json` across evaluation cycles. |
| **Correlation budget** | Max 3 open positions total. Max 2 in Tier-1 (BTC/USD, ETH/USD) and max 2 in Tier-2 (all other alts). New entries are blocked when either limit is reached. |
| **Daily drawdown gate** | If portfolio equity drops ≥ 3% vs. day-open equity, capital preservation mode activates: all new entries blocked, existing stops tighten to 3%. Resets at midnight UTC. |
| **Take-profit based on technical analysis** | If a position is flagged to be closed by the research, close it — checked at every evaluation, before TA signals. |
| **Score gate (long)** | Only open long positions with a Signal Confluence score ≥ 4/6. Half-size at score = 3/6 if R:R ≥ 1:3. |
| **Score gate (short)** | Only open short positions with a score ≤ −4/6. Half-size at score = −3/6. |
| **Regime gate (long)** | Never buy into a confirmed daily downtrend (last close < 50-day SMA and 20-day SMA < 50-day SMA). |
| **Regime gate (short)** | Only short into a confirmed daily downtrend. No shorts in uptrend or mixed regime. |
| **Cover signal** | Close a short when score rises to ≥ +2/6 (bullish TA turning). |
| **ATR-based sizing** | Size positions using the 1% risk rule: max_risk = equity × 1%, stop = entry − 1.5×ATR, qty = max_risk / stop_dist. Hard cap = per-symbol cap from `config.json` › `portfolio_caps.caps`. |
| **Route all orders** | All orders must go through `scripts/trade.py`. Direct API calls are forbidden. |
| **Journal every day** | Write a journal entry even on quiet days. One line is fine: "No trades — reason: …" |

### Portfolio Cap Table (`config.json` › `portfolio_caps.caps`)

| Symbol   | Max % of Equity |
|----------|----------------|
| BTC/USD  | 30%            |
| ETH/USD  | 15%            |
| ADA/USD  | 10%            |
| SOL/USD  | 10%            |
| DOGE/USD | 8%             |
| LTC/USD  | 6%             |
| DOT/USD  | 6%             |
| LINK/USD | 5%             |
| AVAX/USD | 5%             |
| AAVE/USD | 5%             |
| *(other)* | 5% (default)  |

## Trading Strategy Skill

**Always read `skills/crypto-trader/SKILL.md` before evaluating any trade.**
It contains the full professional playbook: Wyckoff phases, volume profile,
indicator signals, multi-timeframe analysis, entry/exit checklists, on-chain
signals, and regime detection.

## Multi-Timeframe Analysis (Top-Down)

Work top-down before touching the execution timeframe:

1. **Daily chart** — Establish the macro trend. Is price above the 50-day SMA?
   Is the 20-day SMA above the 50-day SMA (uptrend) or below (downtrend)?
   What Wyckoff phase does the daily structure suggest?
2. **4H chart** — Confirm structure (higher-highs/higher-lows or lower-highs/lower-lows).
   Is the 20 EMA above or below the 50 EMA? This is the primary trend filter.
3. **15-min chart** — Execution only. Entry and exit signals. All bar fetches
   use the 15-min timeframe as per `run_evaluation.py`.

**Rule:** Only take trades in the direction of the 4H and daily trend.
A bullish 15-min signal inside a 4H downtrend is low-confidence — skip it.

## Wyckoff Phase Awareness

Before entering, identify where price sits in the Wyckoff cycle:

- **Accumulation** (buy zone): Range after a downtrend, high volume on bounces,
  light volume on dips. Look for Sign of Strength (SoS) breakout retests.
- **Mark-Up** (trend phase): Consistent HH/HL, volume expands on rallies.
  Stay long; use MA pullbacks as re-entry opportunities.
- **Distribution** (exit zone): Range after an uptrend, high volume on drops.
  Take profit on longs, do not add new positions.
- **Mark-Down** (avoid): Consistent LH/LL. Stay flat. Wait for accumulation signs.

## Signal Confluence Table (6 points — score every setup)

Run `scripts/run_evaluation.py` — it computes this automatically. For manual
review, check each condition and sum the score:

| # | Condition | Bullish | Bearish |
|---|-----------|---------|---------|
| 1 | 20 EMA vs 50 EMA (15-min) | Golden cross +1 | Death cross −1 |
| 2 | MACD histogram | Green and rising +1 | Red and falling −1 |
| 3 | RSI | 40–65 and rising +1, or <30 oversold +1 | >70 overbought −1 |
| 4 | Bollinger %b | Near lower band (<0.25) +1 | Near upper band (>0.75) −1 |
| 5 | Volume | Above 20-bar average (≥1.2×) +1 | Below average (<0.7×) −0.5 |
| 6 | 4H regime | 20 EMA > 50 EMA on 4H +1 | 20 EMA < 50 EMA on 4H −1 |

**Entry rule (long):**
- Score ≥ 4/6 AND daily not downtrend → BUY at standard ATR-based size
- Score = 3/6 AND daily not downtrend → BUY at half-size if R:R ≥ 1:3
- Score ≤ 2/6 → HOLD / pass

**Entry rule (short):**
- Score ≤ −4/6 AND daily downtrend → SHORT at standard ATR-based size
- Score = −3/6 AND daily downtrend → SHORT at half-size if R:R ≥ 1:3
- Score > −3/6 → HOLD / pass

**Cover (exit short) rule:**
- Score ≥ +2/6 → COVER (TA turning bullish)
- Price rises ≥ 5% above short entry → COVER (stop-loss)

## Decision Checklist (answer before every trade)

1. What is the current portfolio cash balance and buying power?
2. What positions are already open? What is each position's direction (long/short),
   unrealized P&L, % from stop-loss (±5%), and % from target?
3. What does the daily regime say? (Uptrend / downtrend / mixed?)
   — Uptrend or mixed: longs only. Downtrend: shorts only.
4. What is the 4H trend? Golden or death cross on the 4H EMAs?
5. What Wyckoff phase does the current price action suggest?
6. What does recent news say about this token? Any macro catalysts?
7. Are the Bollinger Bands squeezing (breakout incoming) or walking the band?
8. What is the RSI doing? Any bullish/bearish divergence?
9. What is the MACD doing? Histogram flipping or crossing zero-line?
10. What is the volume profile saying? Is volume confirming the move?
11. What is the Signal Confluence score?
    Long: must be ≥ 4. Short: must be ≤ −4.
12. What is the ATR? Where does the stop go, and what is the R:R ratio?
    Only enter if R:R ≥ 1:2 (prefer 1:3).
    Long stop: entry − 1.5×ATR. Short stop: entry + 1.5×ATR.

## Position Sizing Formula

```
Max risk per trade  = Portfolio equity × 1%
Stop distance       = ATR × 1.5  (or to last swing low, whichever is closer)
Position qty        = Max risk ÷ Stop distance
Hard cap            = min(qty, (equity × symbol_cap_pct) ÷ ask)
```

`symbol_cap_pct` comes from `config.json` › `portfolio_caps.caps` (e.g. 0.30 for BTC/USD, 0.05 for LINK/USD).

Example: $100,000 equity, BTC ask $80,000, ATR $500, BTC cap = 30%
- Max risk = $1,000
- Stop distance = $750 (1.5 × ATR)
- Raw qty = 1,000 ÷ 750 = 1.333 BTC → $106,667 (exceeds 30% cap)
- Hard cap qty = (100,000 × 30%) ÷ 80,000 = 0.375 BTC ✓

Example: $100,000 equity, LINK ask $15, ATR $0.30, LINK cap = 5%
- Max risk = $1,000
- Stop distance = $0.45 (1.5 × ATR)
- Raw qty = 1,000 ÷ 0.45 = 2,222 LINK → $33,333 (exceeds 5% cap)
- Hard cap qty = (100,000 × 5%) ÷ 15 = 333.3 LINK ✓

## Exit Strategy

**Longs:**
1. **Trailing stop** (supersedes hard stop once active): Activates when position
   is ≥ 2.5% in profit. Trails 3% below the high-water mark (HWM). HWM is
   persisted across cycles in `data/positions_state.json`.
2. **Hard stop**: SELL immediately if price drops ≥ 5% from entry (while trailing
   stop is not yet active).
3. **TA exit**: SELL if Signal Confluence score drops to ≤ −2 (strongly bearish).
4. **Stop-loss deduplication**: Before placing any SELL stop, call
   `get_open_orders(symbol)`. If an order exists and cycle count <
   `stop_loss_escalation_cycles` (2), skip. Otherwise cancel-replace with a
   wider limit (`stop_loss_limit_price()` with time-escalation).

**Shorts:**
5. **Hard stop**: COVER immediately if price rises ≥ 5% from short entry.
6. **TA cover**: COVER if Signal Confluence score rises to ≥ +2 (turning bullish).
7. **Stop-loss deduplication** applies to COVER orders the same way as SELL.

**Both directions:**
8. **Never move a stop further away from entry.** Trail it toward entry as price
   moves in your favour, never away.

## Common Mistakes to Avoid

- Chasing after a big candle — wait for the pullback/retest.
- Ignoring the 4H trend — a perfect 15-min signal in a 4H downtrend is a trap.
- Buying because RSI is "oversold" in a downtrend — oversold becomes more oversold.
- Overtrading low-conviction setups — if the checklist fails, wait.
- Adding to a losing position — only add to winning positions.
- Using maximum size every trade — save full size for ≥ 5/6 confluence setups.

## Output Format

Every evaluation must be logged to `journal/YYYY-MM-DD.md`:

```
## Evaluation HH:MM GMT+2

- SYMBOL ACTION score=+X.X/6 ask=$Y (reason)
    score   : +X.X/6
    ema_x   : golden / death / neutral
    rsi     : XX.X
    macd    : line=X sig=X hist=X (BULLISH/BEARISH FLIP)
    bb      : lower=X mid=X upper=X bw=X pb=X trend=tightening SQUEEZE
    atr     : X.XXXX  stop_1.5x=X.XXXX
    4h      : golden / death / neutral
    daily   : ma20=X ma50=X last=X regime=uptrend/downtrend/mixed
    signals :
      ema_cross:  GOLDEN (20>50, +1)
      macd:       hist=X green+rising (+1)
      ...

### Orders submitted / No orders submitted
```

Keep entries terse on quiet hours — one line per symbol is sufficient when
all decisions are HOLD.

---

## Portfolio Rebalancer (`scripts/rebalance.py`)

Aligns every watchlist symbol's position to its cap in `config.json › portfolio_caps.caps`.

- **Over-cap** → SELL the excess immediately (no signal gate).
- **Under-cap** → BUY to close the gap, subject to signal gate (score ≥ 3) and daily regime gate (no downtrend).
- Hard stop-loss (`should_stop_out`) fires before cap logic for any open position.
- All orders go through `scripts/trade.py` — hard rules always enforced.
- Appends a `## Rebalance HH:MM GMT+2` block to the daily journal.

```bash
python scripts/rebalance.py           # dry-run
python scripts/rebalance.py --execute # submit orders
```

---

## Dashboard (`docs/dashboard_professional.html`)

Self-contained single-file HTML dashboard. Open locally in any browser — no server needed. **Navigation is a left sidebar** (`.layout` flex wrapper wrapping `<nav>` + `<main>`; `nav` is a 210px sticky vertical column, active tab marked by a left blue border + tint). On mobile (≤700px) the `.layout` switches to a column and `nav` collapses back to a horizontal scrolling bar with a bottom-border active marker. Fully usable on mobile portrait: all tables scroll horizontally via `overflow-x:scroll` + `-webkit-overflow-scrolling:touch` on `.table-wrap`, clamped to `calc(100vw - 32px)` in the mobile media query so the wrapper can't expand past the viewport. Every symbol label is a `tvLink()` anchor that opens the TradingView chart (`CRYPTO:BTCUSD` format) in a new tab.

| Feature | Detail |
|---------|--------|
| Live ticker strip | Top-of-page, 10 symbols, price + 24h%. Auto-refreshes every 15 s via `/v1beta3/crypto/us/snapshots`. |
| Auto-refresh button | 3 modes: `Auto OFF` → `Prices 15s` → `Full 60s`. |
| Command tab | Live hard-rules panel (6 real-time checks), cash reserve gate, trade modal. |
| Risk tab | Portfolio cap usage, 10×10 correlation heatmap (Pearson ρ, daily log-returns). |
| Positions tab | P&L%, Stop $ (entry×0.95), Target $ (entry×1.10), Live R:R. |
| Signals tab | Paginated bars fetch (follows `next_page_token`), trend arrows ↑↓→, ATR qty, ⚡ quick-buy, and ▶ execute. Bar fetch always passes `end = now − 1 bar period` (via `barsEnd()`) to exclude the in-progress bar and ensure stable, complete-bar-only indicators. |
| P&L tab | FIFO P&L, calendar heatmap, attribution by symbol, day-of-week performance. Realized stats come from the shared `computeFifoStats()` helper. |
| Backtest vs Live tab | Compares live metrics to saved expected metrics (Sharpe, max DD, win rate, profit factor, avg daily return). **Win Rate and Profit Factor use realized FIFO stats from `computeFifoStats()` — identical to the P&L tab, so the two can't diverge.** `loadContext()` fetches `/v2/account/activities?activity_type=FILL` and attaches `c.fifoStats`; `renderBacktest()` reads it. Do NOT reintroduce the old fill-vs-limit "win rate proxy" (always ~100% for limit orders) or the hardcoded `n/a` profit factor. |
| Market Overview tab | Price, 24h%, 7d%, volume, trend and cap tier for 30 crypto symbols ranked by market cap. Sortable. Includes momentum heatmap. Score column auto-fills from last Market Signals scan. `TOP30_SYMBOLS` uses `MATIC/USD` (not `1INCH/USD` — invalid on Alpaca, starts with digit). Snapshots fetched via `fetchSnapshotsInBatches` so one bad symbol can't kill the whole request. |
| Market Signals tab | On-demand full 6-point confluence scanner for the `TOP30_SYMBOLS`. Same scoring logic as Signals tab. Number of symbols scanned is capped by the **🔭 Signals Analysis › Max Symbols** setting (`maxSignalSymbols`, default 30): `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, n)` (top-N by market cap). The scan button (`#msScanBtn`) label is dynamic — `updateScanBtnLabel()` sets it to `▶ Scan Top N` and is called on page init, after `saveSettings()`, and at the start of each scan, so the cap is always visible. Shows score distribution and Top Opportunities panel. Scores cached into `_msPrevScores` for cross-tab display. |
| Markov tab | On-demand first-order Markov chain analysis for `MK_SYMBOLS` (BTC/USD, ETH/USD) across `MK_INTERVALS` (30/60/90/180/365-day windows). Daily close-to-close returns are classified into 3 states via a ±`MK_THRESH` (1%) band: Up / Flat / Down (`mkClassify`). `mkBuild()` builds the 3×3 transition matrix `P(next\|current)`, the stationary distribution (power iteration with self-loop fallback for unseen rows), the current-state next-day forecast, and the mean daily return. `mkIntervalCard()` renders a heatmap-shaded matrix per window (< 3 transitions → "Insufficient data"); KPI tiles show each symbol's 90-day next-day-up probability. One `fetchBars(MK_SYMBOLS, "1Day", maxDays+5)` call per run covers all windows. User-triggered via `loadMarkov()` — not auto-run on tab switch. Standalone from the 6-point execution score; analysis-only, places no orders. Matrix tables (`mkMatrixTable`) carry the `.mk-matrix` class (`min-width:0; table-layout:fixed`, tightened cell padding) to override the global `table { min-width:760px }` rule — without it the matrices overflow their narrow `grid-3` panels and overlap. |
| Settings tab | Grouped into labelled sections, each a 2-column `form-grid`: **📄 Paper Trading** (API Key + Secret), **🔴 Live Trading** (API Key + Secret), **🛡 Risk Limits** (Assumed Stop Loss %, Max Daily Loss %, Max Open Risk %), then **🔭 Signals Analysis** (Max Symbols in Market Signals scan) — all placed *below* the API credentials. API key/secret pairs line up side by side per environment; risk-limit and signals inputs form separate blocks under the keys. `maxSignalSymbols` (input `setMaxSignalSymbols`, default 30, minimum 1, **no upper clamp**) lives in `getSettings().limits` and sets how many of the cap-ranked `TOP30_SYMBOLS` the **Market Signals** scanner analyses — top-N by market cap via `TOP30_SYMBOLS.slice(0, n)` (`SCAN_SYMBOLS` in `loadMarketSignals`). The scan universe is the 30 `TOP30_SYMBOLS`, so a value above 30 simply scans all available symbols (`slice` caps at the array length). Does not affect the watchlist Signals tab or Market Overview. Settings persist to `config.json` in the same folder as the HTML: `loadConfigFromFile()` fetches `./config.json` on page load (inside an async `bootstrapDashboard()` IIFE) and seeds settings (empty string fields do not clobber stored credentials; `limits` are merged). `config.json` is **load-only** and acts as a *seed/fallback*: on load, saved `localStorage` values win and `config.json` only fills gaps (so a `maxSignalSymbols` you set and save persists across refreshes; `config.json`'s value applies only on a fresh browser with no saved setting). There is no save-to-file; `saveSettings()` persists to `localStorage`. To change defaults for a fresh browser, edit `config.json`; to change your live setting, use the Settings tab. **Note:** `updateScanBtnLabel()` must NOT be called from the early top-level init — `TOP30_SYMBOLS` is a `const` declared later in the script, so calling it before that line throws a TDZ error (`Cannot access 'TOP30_SYMBOLS' before initialization`) that aborts the whole script. It is now called inside `bootstrapDashboard()` after the `await`, by which point the const is initialized. |
| 📓 Daily Journal button (header) | `generateDailyJournal()` builds today's closing journal from live data (`/v2/account`, `/v2/positions`, `/v2/account/activities?activity_type=FILL`) plus a 10-symbol `JOURNAL_WL` confluence scan via `calcSignalScore`. Sections: Summary, Trades Today (FILL fills filtered to the GMT+2 day), Open Positions, Market Observations. Preview modal (`#journalDocBackdrop`) with Copy + Download `.md` (`daily-journal-YYYY-MM-DD.md`). Day filtering and timestamps use the `Etc/GMT-2` timezone. |

### Portfolio dashboard (`docs/portfolio-dashboard.html`)

| Feature | Detail |
|---------|--------|
| 🌅 Morning Brief button (header) | `generateMorningBrief()` generates the morning brief as a downloadable Markdown doc matching the `journal/` format: Portfolio Health (+ per-position table), direction-aware Alerts, Signal Confluence table (10 watchlist symbols via the existing `confluenceScore`/`fetchBars` engine), and a templated Market Notes paragraph. Preview modal (`#briefDocBackdrop`) with Copy + Download `.md` (`morning-brief-YYYY-MM-DD.md`). Timestamps use the `Etc/GMT-2` timezone. |

### Dashboard scoring parity with `indicators.py`

The dashboard's `calcSignalScore()` implements **identical** logic to Python's `indicators.signal_score()`. Keep these in sync on every change:

| Rule | Detail |
|------|--------|
| EMA seeding | `emaArr()` seeds with SMA of first `period` values (not the first raw value). |
| EMA dead zone | ±0.05% band: `ema20 > ema50 * 1.0005` = golden (+1), `< 0.9995` = death (−1), else neutral (0). Applies to both 15-min (Signal 1) and 4H (Signal 6). |
| MACD partial credits | +0.5 green-not-rising; −0.5 red-improving. Uses 2-bar lookback (`prevHistogram2`). |
| MACD signal line alignment | `calcMACD()` must strip the NaN prefix from `macdLine` before passing to `emaArr()` for the 9-bar signal EMA. If the NaN-prefixed array is passed directly, `emaArr()` seeds on NaN and the entire signal line becomes NaN (histogram always NaN, MACD always 0). Fixed: filter to `validMacd = macdLine.filter(!isNaN)`, compute compact signal, then re-pad. |
| RSI direction | +1 only if RSI 40–65 AND rising (3-bar lookback via `calcRSIRising()`). −0.5 for RSI < 40 AND falling. |
| Score pill thresholds | Half-size buy fires at `score >= 3 && score < 4` (not `score === 3`) to catch 3.5. Half-size short fires at `score <= -3 && score > -4`. Python uses `score >= BUY_SCORE_HALF_SIZE` (3.0) so 3.5 is a valid half-size entry. |
| Bar completeness | Both `get_crypto_bars()` (Python) and `fetchBars()` (dashboard) pass `end = now − 1 bar period` to exclude the currently-forming bar. Without this, the partial bar has near-zero volume and skews every indicator. |

### Python ↔ Dashboard consistency check

**Run this check whenever any indicator logic is modified in either `indicators.py` or `dashboard_professional.html`.**

Compare the following point-by-point before committing:

1. **EMA formula** — seeding (SMA of first `period` values), multiplier `k = 2/(period+1)`, no NaN contamination.
2. **MACD alignment** — `macdLine` has a NaN prefix (first `slow-1` = 25 values). The signal EMA must be computed on the compact (NaN-stripped) MACD series, then re-padded. Any change to MACD must verify the signal line is not NaN.
3. **RSI formula** — Wilder's smoothing, `avgLoss == 0 && avgGain == 0` returns 50 in Python; dashboard must match.
4. **Score thresholds** — Buy: `>= 4` full, `>= 3 && < 4` half. Short: `<= -4` full, `<= -3 && > -4` half. Sell/cover: `<= -2` / `>= +2`. Never use `=== 3` / `=== -3`.
5. **Bollinger bands** — population std-dev (divide by `period`, not `period-1`), `pb < 0.25` = +1, `pb > 0.75` = -1.
6. **Volume ratio** — `current / avg(prev 20 bars)` where prev-20 excludes the current bar (Python: `volumes[-(period+1):-1]`; JS: `volumes.slice(-21, -1)`). Threshold: `>= 1.2` = +1, `< 0.7` = -0.5.
7. **4H dead zone** — same ±0.05% band as the 15-min EMA cross.
8. **Daily regime** — `last > SMA50 && SMA20 > SMA50` = uptrend; `last < SMA50 && SMA20 < SMA50` = downtrend. Uses SMA, not EMA.
9. **ATR sizing** — `equity × 0.01 / (ATR × 1.5)`, capped at `(equity × cap_pct) / ask`.
10. **Bar completeness** — both sides pass `end = now − 1 bar period`.

**Note on the Forward Analysis scoring** — The Forward Analysis tab uses a *different* scoring system (daily bars, gap magnitude, volume tier, range position). It is intentionally separate from the execution 6-point score and should not be kept in sync with `indicators.py`.

### Documentation update rule
**This rule applies to every change without exception — code, dashboard, config, or scripts.**

When any code in this project is changed, update **all four** of these files to reflect the change:
- `CLAUDE.md` — add/update the relevant section
- `README.md` — update the relevant feature description
- `memory/projects/alpaca-trading-agent.md` — add a dated session history entry
- `memory/glossary.md` — add/update any new terms or API notes
