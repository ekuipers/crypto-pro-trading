# Introduction
Description: Professional multi-chart cryptocurrency trading & analytics platform.

Project name: CryptoPro Dashboard
Creator: Erik Kuipers

---

# Workflow rules
0. The bugs list needs to take preference for changes and the roadmap determines which features need to be added.
1. After every change to a code file, append a dated entry to `memory.md` in the memeory folder, describing what changed and why (problem, fix, and how it was verified). Treat `memory.md` as the running changelog — no code edit is complete until `memory.md` is updated. 
2. Do not start the local node server.
3. Move completed roadmap items and bug fixes to the memory file for reference and change log purpose.
4. Automatically commit changes to git and sync with remote repo.
5. Update readme.md to reflect changes.
6. Add footer to the webpage. Add Project descirption, creator, last modified dat and version number to the Footer
7. Before analyzing any code change, read the memory for earlier changes.
8. a "rescan roadmap"request triggers implementation, not just a status report.

---

## Roadmap
*(none — all listed roadmap items implemented; see `memory/memory.md` session history)*

## Bugs
*(none — all listed bugs fixed; see `memory/memory.md` session history)*

---

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

---

# Trading Agent Instructions

> **Standing rule:** After every change to any file in this project — code, dashboard, config, or scripts — update `CLAUDE.md`, `README.md`, `memory/memory.md`, `memory/glossary.md`, and (for any dashboard change) `docs/dashboard_layout.md` before considering the task done. No exceptions.

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
| **Stop-loss limit clamping** | If a stop-loss limit (computed from an earlier quote) lands outside the 0.5% band of the fresh ask at submission, `trade.py` clamps it to the nearest band edge instead of rejecting (self-rejection left positions exposed a full cycle; fixed 2026-06-11). |
| **Stop-loss at 4H swing low (long)** | TA-driven stop (set 2026-06-19). SELL immediately when price falls to/through the previous 4H range low — the lowest low of the last `swing_low_lookback_bars` (20) completed 4H bars, minus a small buffer, clamped so the stop is never more than `swing_low_max_stop_pct` (8%) below entry. Falls back to the fixed −5% (`stop_loss_pct`) only when 4H history is unavailable. Checked at every evaluation. |
| **Stop-loss at +5% (short)** | If a short position moves 5% against us (price rises), COVER immediately — checked at every evaluation. |
| **Stop-loss deduplication** | Before placing any stop-loss SELL/COVER, check `get_open_orders(symbol)`. If a pending order exists and is within `stop_loss_escalation_cycles` (2), skip. After that, cancel and replace with a wider band (time-escalation). |
| **Trailing stop** | Once a long position is +2.5% in profit, a trailing stop activates and trails 3% below the high-water mark (HWM). HWM is persisted in `data/positions_state.json` across evaluation cycles. |
| **Correlation budget** | Max 4 open positions total (loosened from 3 on 2026-06-19). Max 3 in Tier-1 (BTC/USD, ETH/USD) and max 3 in Tier-2 (all other alts). New entries are blocked when either limit is reached. |
| **Take-profit based on technical analysis** | If a position is flagged to be closed by the research, close it — checked at every evaluation, before TA signals. |
| **Score gate (long)** | Loosened 2026-06-19: full-size long at Signal Confluence score ≥ 3.5/6; half-size at score ≥ 2.5/6 (and < 3.5). |
| **Score gate (short)** | Only open short positions with a score ≤ −4/6. Half-size at score = −3/6. **Shorts are disabled by default** (`config.json › strategy.shorts_enabled = false`): Alpaca spot crypto cannot be shorted — every attempted short was rejected. Cover logic stays active as a legacy safety net. |
| **Regime gate (long)** | Loosened 2026-06-19: in uptrend/mixed, longs allowed at score ≥ 2.5 (half) / ≥ 3.5 (full). In a confirmed daily downtrend (last close < 50-day SMA and 20-day SMA < 50-day SMA) a **half-size counter-trend long** is allowed only at high confluence (score ≥ `downtrend_long_score_threshold`, 4.0); otherwise longs stay blocked. |
| **Regime gate (short)** | Only short into a confirmed daily downtrend. No shorts in uptrend or mixed regime. |
| **Cover signal** | Close a short when score rises to ≥ +2/6 (bullish TA turning). |
| **ATR-based sizing** | Size positions using the 1% risk rule: max_risk = equity × 1%, sizing stop_dist = 1.5×ATR, qty = max_risk / stop_dist. Hard cap = per-symbol cap from `config.json` › `portfolio_caps.caps`. Note: sizing still uses 1.5×ATR for the distance, while the **exit** stop is the 4H swing low (clamped ≤8%) — so realized risk can differ from a strict 1% when the range low sits farther/closer than 1.5×ATR. |
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

**Entry rule (long):** *(loosened 2026-06-19)*
- Score ≥ 3.5/6 AND daily not downtrend → BUY at standard ATR-based size
- Score ≥ 2.5/6 (and < 3.5) AND daily not downtrend → BUY at half-size
- Score ≥ 4.0/6 AND daily downtrend → BUY at half-size (counter-trend; `downtrend_long_score_threshold`)
- Otherwise → HOLD / pass

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
    Long: ≥ 3.5 full / ≥ 2.5 half (≥ 4.0 for a half-size counter-trend long in a downtrend). Short: must be ≤ −4.
12. Where does the stop go, and what is the R:R ratio?
    Exit stop (long) = previous 4H range low (lowest low of last 20 4H bars, ≤8% below entry).
    Sizing uses entry − 1.5×ATR for the qty calc. Prefer R:R ≥ 1:2.

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
2. **Swing-low stop** (TA-driven, replaced the fixed −5% on 2026-06-19): SELL
   immediately if price falls to/through the previous 4H range low — the lowest
   low of the last `swing_low_lookback_bars` (20) completed 4H bars, less a small
   buffer, clamped to at most `swing_low_max_stop_pct` (8%) below entry. Falls
   back to the fixed −5% (`stop_loss_pct`) only when 4H history is unavailable.
   Applies while the trailing stop is not yet active.
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

## Universe Scout (`scripts/scout.py`)

Auto-promotes uptrending, high-confluence `*/USD` pairs from the full tradable
Alpaca universe into the evaluation set (the 10 watchlist majors correlate at
~0.8, so in a broad downtrend the whole static list is regime-blocked and the
bot sits in cash). Flow: fetch active tradable crypto assets → keep `*/USD`,
drop watchlist symbols → daily-regime filter (confirmed uptrend only, same
SMA20/50 rule) → full 6-point confluence on survivors → keep score ≥
`scout.min_score` (4.0) → top `scout.max_promoted` (3) written atomically to
`data/watchlist_dynamic.json`. `run_evaluation.main()` merges the promoted
symbols when `config.json › scout.enabled` is true, refreshing the file when
older than `scout.ttl_hours` (6). Promoted symbols pass through every existing
gate unchanged (score ≥ 4 entry, regime, Tier-2 correlation budget, default 5%
cap, ATR sizing, stops). Analysis-only module — it never places orders.

```bash
python scripts/scout.py            # respect TTL
python scripts/scout.py --force    # rescan now
```

---

## Market Researcher Agent (`.claude/agents/market-researcher.md`)

Independent research-desk subagent ("market-researcher"). A professional crypto
spot-market trader persona that **analyses and verifies but never trades**.

Two missions:

1. **Market research** — verify strategy assumptions, risk parameters, and
   profitability against current Alpaca spot-market conditions (regime, ATR vs.
   stop width, correlation budget, realized vs. backtest performance).
2. **Project verification** — invoke after every strategy change (rules,
   `indicators.py`, `risk.py`, `trade.py`, `run_evaluation.py`, `rebalance.py`,
   `config.json`, or dashboard scoring) to check rule consistency across
   Python/dashboard/docs, soundness vs. hard rules, supporting evidence in
   `reports/`, and that `tests/` pass.

Every run writes a timestamped Markdown report (GMT+2) to
`data/market_research/` (`YYYY-MM-DD-HHMM-market.md` or
`…-project-verification.md`) for historical analysis. Reports follow a fixed
structure: Scope, Findings, Verdict (PASS / PASS WITH WARNINGS / FAIL),
Recommendations, Data sources. The agent is read-only toward the market and
must not modify code or config.

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

Self-contained single-file HTML dashboard. Open locally in any browser — no server needed. **Navigation is a left sidebar** (`.layout` flex wrapper wrapping `<nav>` + `<main>`; `nav` is a 210px sticky vertical column, active tab marked by a left blue border + tint). The tabs are **grouped by job-to-be-done** under `.nav-section-label` headers (regrouped 2026-06-17): **🧭 Command** stands alone at the top, then **⚡ Trade** (Signals · Scalping · Market · Execution), **💼 Portfolio** (Overview · Allocation · Risk), **📊 Analysis** (🔬 Analytics · 🧠 Insights · Backtest vs Live · Markov), then **⚙ Settings** at the bottom — an Act → Hold → Analyze flow. Two parent tabs nest sub-tabs via a shared `.subnav`/`.subpage`/`.subtab-btn` system (generic `_activateSubTab(parentId, subId)`): **🌐 Market** (Overview · Scanner · Breakout) and **🔬 Analytics** (Performance · P&L · Edge). On mobile (≤700px) the `.layout` switches to a column and `nav` collapses back to a horizontal scrolling bar with a bottom-border active marker. Fully usable on mobile portrait: all tables scroll horizontally via `overflow-x:scroll` + `-webkit-overflow-scrolling:touch` on `.table-wrap`, clamped to `calc(100vw - 32px)` in the mobile media query so the wrapper can't expand past the viewport. Every symbol label is a `tvLink()` anchor that opens the TradingView chart (`CRYPTO:BTCUSD` format) in a new tab.

**Tab routing (deep links + refresh memory):** the active tab is reflected in the URL hash (`…/dashboard_professional.html#signals`). `switchTab()` writes the tab id to the hash via `history.replaceState` and to `localStorage.lastTab`. On load, `applyTabFromUrl()` (called at the end of the `bootstrapDashboard()` IIFE) resolves the target tab from the URL hash first, then `localStorage.lastTab`, and activates it — so a direct `#tab` link opens that tab and a browser refresh restores the last-opened tab instead of defaulting to Command. A `hashchange` listener re-runs `applyTabFromUrl()` so changing the anchor switches tabs live. Valid tab ids come from `validTabIds()`, which parses each nav button's `switchTab('<id>',…)` onclick, so the routing never drifts when tabs are added or removed; `tabBtnFor(id)` finds the matching button.

| Feature | Detail |
|---------|--------|
| Live ticker strip | Top-of-page, 10 symbols, price + 24h%. Auto-refreshes every 15 s via `/v1beta3/crypto/us/snapshots`. |
| Auto-refresh button | 3 modes: `Auto OFF` → `Prices 15s` → `Full 60s`. |
| Command tab | Live hard-rules panel (6 real-time checks), cash reserve gate, trade modal. The **🚦 Trading Permission Rules** panel shows a **Latest Activity** block in its top-left corner: the latest 2 FILL activities (time GMT+2, side, qty, TradingView symbol link, fill price) rendered by `renderCommand()` from `c.activities` (the FILL feed `loadContext()` already fetches, now exposed on the context object). Directly under the big **trading-status word** (`#tradingStatus`), `#tradingStatusLog` mirrors the **last 3 Autopilot log entries** (timestamp + colour-coded `[KIND]` + message) via `apRenderStatusLog()`, which `apRenderLog()` calls on every log push and on init so the two stay in sync. |
| 🤖 Autopilot (Command tab) | In-dashboard autonomous trading loop. Toggle (always **OFF on page load** — never auto-resumes; shows "was ON before reload — click to resume"), interval 15/30/60 min, red ⛔ kill switch (stops loop + cancels all open orders). Each cycle: scans the 10 watchlist symbols with the existing signal engine; entries at score ≥ 3.5 (full) / ≥ 2.5 (half), plus a half-size counter-trend long in a confirmed downtrend at score ≥ 4 (`AP_DOWNTREND_LONG`) + correlation budget (max 4 / 3 per tier) + per-symbol cap + ATR sizing + 20% cash-reserve gate (post-order) + $10 min notional; exits = **4H swing-low stop** (`swingLowStop4h()`, lowest low of last 20 4H bars, clamped ≤8%; fixed-% fallback when no 4H data), trailing stop (HWM in `localStorage.autopilotHwm`, 3% below peak after +2.5%), TA exit at score ≤ −2. No short entries. Activity log (`localStorage.autopilotLog`, 200 entries, GMT+2) with per-decision gate reasons. |
| 🔬 Analytics tab (parent) | **Merges Performance + P&L + Edge into one nav tab** (`page-analytics`) using the shared sub-tab system (`.subnav`/`.subpage`/`.subtab-btn`; generic `_activateSubTab("analytics", subId)`). Valid sub-ids `ANALYTICS_SUBS = ["performance","pnl","edge"]`. `analyticsSubTab(subId)` mirrors the sub-tab to the URL hash + `localStorage.lastTab` so the old deep links `#performance` / `#pnl` / `#edge` still resolve (via `applyTabFromUrl()`'s `SUBS` and `switchTab()`'s redirect). Performance auto-loads via `refreshCurrent()` (→`loadDashboard`→`renderPerformance`); P&L loads on select (`loadPnl`); Edge stays manual (▶ Analyze). Lives in the **📊 Analysis** nav section alongside Backtest vs Live and Markov. |
| 🔬 Edge sub-tab (Analytics) | On-demand (▶ Analyze, Markov-tab pattern) realized-edge analytics from all FILL activities (paginated, 10k cap) with FIFO round-trip matching: per-symbol expectancy table (trades, win rate, avg win/loss, PF, net P&L, holding time), realized P&L by hour-of-day and day-of-week (GMT+2), KPI tiles (round-trips, expectancy $/trade, payoff ratio, median hold), auto-generated factual takeaway line. |
| Risk tab | Portfolio cap usage, 10×10 correlation heatmap (Pearson ρ, daily log-returns). In the "Portfolio Concentration & Correlation Risk" grid, the 🔗 Live Correlation Matrix is the left column and 📊 Effective Exposure the right. The `.corr-wrap table` sets `min-width:0; width:auto` to override the global `table{min-width:760px}` so the matrix sizes to its content and stays left-aligned (no large left whitespace). |
| Positions tab | **Removed 2026-06-17** — the standalone Positions tab was dropped; its positions table lives in the **Portfolio Overview** tab. `renderPositions` is kept only so its wrapper can cache `_lastPositions`/`_lastEquity` for the Risk concentration panel + positions CSV export; its DOM writes (`positionKpis`/`positionsBody`) are now null-guarded since the page is gone. |
| Signals tab | Paginated bars fetch (follows `next_page_token`), trend arrows ↑↓→, ATR qty, ⚡ quick-buy, and ▶ execute. **Short-side action buttons removed 2026-06-11** (Alpaca spot crypto cannot short); bearish scores show an informational red **BEAR** pill and notifications say "no short — spot venue". Bar fetch always passes `end = now − 1 bar period` (via `barsEnd()`) to exclude the in-progress bar and ensure stable, complete-bar-only indicators. |
| ⚡ Scalping tab | **Added 2026-06-19.** On-demand low-timeframe confluence scanner under **⚡ Trade** (`page-scalp`, id `scalp`, no auto-run on tab switch). A timeframe selector (5 min / 15 min / 1 hour) maps the engine's (exec, trend, regime) stack down a notch via `SCALP_TF_MAP` — 5m→5m·1h·4h, 15m→15m·1h·4h, 1h→1h·4h·1D — and `loadScalp()` runs the **same `calcSignalScore` 6-point engine** on those bars for every watchlist symbol. Renders KPIs, the shared `renderScoreDist("scalpScoreDist", …)` tile, and a table (score, pill via `scalpActionPill` using the shared `SIGNAL_BUY_SCORE`/`SIGNAL_HALF_SCORE`/`SIGNAL_DOWNTREND_LONG_SCORE` gates, RSI, ATR, regime) with per-row **Buy/Sell** buttons that open the shared `openTradeModal`. **Manual tickets only — no autonomous scalp loop.** `barsStart`/`barsEnd` gained `5Min`/`1Hour` entries so the fetch window + in-progress-bar cutoff are correct on those TFs. |
| P&L sub-tab (Analytics) | FIFO P&L, calendar heatmap, attribution by symbol, day-of-week performance. Realized stats come from the shared `computeFifoStats()` helper. |
| Backtest vs Live tab | Compares live metrics to saved expected metrics (Sharpe, max DD, win rate, profit factor, avg daily return). **Win Rate and Profit Factor use realized FIFO stats from `computeFifoStats()` — identical to the P&L tab, so the two can't diverge.** `loadContext()` fetches `/v2/account/activities?activity_type=FILL` and attaches `c.fifoStats`; `renderBacktest()` reads it. Do NOT reintroduce the old fill-vs-limit "win rate proxy" (always ~100% for limit orders) or the hardcoded `n/a` profit factor. |
| 🌐 Market tab (parent) | **Market Overview + Scanner + Breakout merged into one nav tab** (`page-market`) with the shared sub-tab bar (`.subnav` → `.subtab-btn`, generic `_activateSubTab("market", subId)`). The middle sub-tab — the full-universe confluence scanner — is labelled **🔭 Scanner** (renamed from "Signals" so the word "Signals" names only the watchlist tab; sub-id stays `market-signals`, deep link `#market-signals` unchanged). Valid sub-ids `MARKET_SUBS = ["market-overview","market-signals","gapgo"]`; sub-pages `subpage-market-overview` / `subpage-market-signals` / `subpage-gapgo`. `marketSubTab(subId)` keeps the "🌐 Market" nav button active and mirrors the sub-tab to the URL hash + `localStorage.lastTab` so the old deep links `#market-overview` / `#market-signals` / `#gapgo` still resolve (via `applyTabFromUrl()`'s `SUBS` and `switchTab()`'s redirect — so keyboard shortcuts and legacy `switchTab('gapgo')` keep working). Overview auto-loads on selection; Scanner and Breakout stay manual (▶). Cross-links: Overview header "View scanner →", and Scanner + Breakout headers "← Back to market context". Selection state persists because all sub-pages keep their rendered DOM. `switchTab('market')` restores the last-used sub-tab via `_marketSub`. |
| Market Overview sub-tab | Price, 24h%, 7d%, volume, trend and cap tier per symbol, sortable, with a momentum heatmap. Score column auto-fills from last Market Signals scan. **Scan universe is the shared `getCryptoUniverse()` (full tradable Alpaca crypto list), sliced by the same **🔭 Signals Analysis › Max Symbols** setting (`maxSignalSymbols`) as Market Signals** — `MO_SYMBOLS = universe.slice(0, n)` in `loadMarketOverview`. So it is no longer hardcoded to the 30 `TOP30_SYMBOLS`; a value above 30 shows more rows. Every row gets a real rank via the shared `symbolInfo(sym)` helper: curated `TOP30_INFO` when known, otherwise `_universeRank[sym]` (1-based position in the ordered universe, built by `rebuildUniverseRank()` inside `getCryptoUniverse()`). So ranks are contiguous — 1–30 are the cap ranks, 31+ follow universe order — instead of `#?`. Symbols outside `TOP30_INFO` still show tier `?`. Snapshots fetched via `fetchSnapshotsInBatches` so one bad symbol can't kill the whole request. The symbol/name cell in `renderMarketOverview` must be wrapped in its own `<td>` — without the opening tag the symbol+name overflow out of the row, away from the Rank column. Each row has a **Trade** column (`moTradeButtons(row)`) with **Buy / Sell** buttons that open the shared paper-trade modal (`openTradeModal`) pre-filled with the symbol (`BTCUSD` order format), side, and live price; qty is left blank for the user to size. Buttons are hidden (show `–`) when the row has no live price. |
| 🔭 Scanner sub-tab (Market) | On-demand full 6-point confluence scanner (the Market tab's middle sub-tab, formerly labelled "Market Signals"). Same scoring logic as the watchlist Signals tab. **Per-symbol Watchlist column** (`msWatchlistCell(row)`): shows a **+ Watch** button when the score ≥ buy gate (4) and the symbol is not already on the watchlist; a **– Unwatch** button when the signal is a sell (score ≤ −2) and there is no open position for the symbol; otherwise "✓ watched" / "–". `loadMarketSignals()` fetches `/v2/positions` into `_msOpenPosSyms` to gate the remove button. Buttons call `msAddWatch` / `msRemoveWatch`, which update the shared watchlist (`saveWatchlistData` + `renderWatchlistTags`) and re-render only the watchlist cells via `renderMsWatchlistCells()` (cached `_msLastRows`, keyed by `mswl-<alpSym>`) — no rescan. The scan universe is the **full tradable-crypto list** from Alpaca, fetched once and cached by `getCryptoUniverse()` (`/v2/assets?asset_class=crypto&status=active`), shared with the Market Overview tab. It is **robust to symbol format** — Alpaca may return `BTC/USD` or bare `BTCUSD`; both are normalized to `BASE/USD` and non-USD quotes (USDT/USDC/BTC) are dropped (the earlier `endsWith("/USD")`-only filter silently fell back to the 30 when the format differed). **Stablecoin bases are excluded** (`STABLECOIN_BASES`: USDT, USDC, DAI, PYUSD, TUSD, …) so `USDT/USD`, `USDC/USD` etc. never appear in scans, Market Overview, or the watchlist dropdown. Ordered as the still-tradable `TOP30_SYMBOLS` first then every other USD pair alphabetically; falls back to `TOP30_SYMBOLS` only if the assets call fails or yields nothing usable. **The fallback is NOT cached** (fixed 2026-06-18): only a real, non-empty assets result is stored in `_cryptoUniverse`; on failure the 30-symbol list is returned transiently so a later call retries. Previously the fallback was cached, so when `getCryptoUniverse()` first ran on page load (via `loadSettings()` → `renderWatchlistTags()` → `populateWatchlistOptions()`) before credentials were seeded, the universe stuck at 30 for the whole session and every scan silently capped below the Max Symbols setting. Number of symbols scanned = the **🔭 Signals Analysis › Max Symbols** setting (`maxSignalSymbols`, default 30, **no upper clamp**): `SCAN_SYMBOLS = universe.slice(0, n)`, so a value above 30 now genuinely scans more than 30 symbols (capped only by how many the account can trade). The scan button (`#msScanBtn`) label is dynamic — `updateScanBtnLabel()` sets it to `▶ Scan Top N` and is called on page init, after `saveSettings()`, and at the start of each scan, so the cap is always visible. **Honest universe ceiling (2026-06-18):** Alpaca only lists ~33 tradable `*/USD` crypto pairs (its other ~56 pairs are USDT/USDC/BTC-quoted and are intentionally excluded since the bot is USD-only), so a Max Symbols above the universe size can never be satisfied. When `_cryptoUniverse` is loaded and Max Symbols exceeds it, the button clamps to `▶ Scan Top <universe> (all available)` and the scan status appends a note that Max Symbols exceeds the tradable USD-pair count. Market Overview shows the same note. This was the resolution for the "scanner only returns 33 while the setting is 60" bug — it is a real Alpaca ceiling, not a code defect. Symbols outside `TOP30_INFO` get a contiguous rank from `symbolInfo()`/`_universeRank` (universe position) rather than `?`. The **📊 Score Distribution** tile is the **shared `renderScoreDist(elId, scores)` helper** — identical bucketed horizontal-bar rendering as the Signals tab (≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR), not the old per-integer inline list. Also shows a Top Opportunities panel. Scores cached into `_msPrevScores` for cross-tab display. |
| Breakout sub-tab | On-demand pre-session breakout/gap analysis per watchlist symbol (formerly the standalone `gapgo` tab, folded into the Market tab 2026-06-17). `loadGapGo()` renders cards with two scores: **Conviction** (gap-specific, max ±7) and **Signal /6** (standard 6-point `calcSignalScore()`). Manual run (▶ Run Analysis). Sub-id `gapgo`; element `subpage-gapgo`; deep link `#gapgo` preserved. |
| Markov tab | On-demand first-order Markov chain analysis for `MK_SYMBOLS` (BTC/USD, ETH/USD) across `MK_INTERVALS` (30/60/90/180/365-day windows). Daily close-to-close returns are classified into 3 states via a ±`MK_THRESH` (1%) band: Up / Flat / Down (`mkClassify`). `mkBuild()` builds the 3×3 transition matrix `P(next\|current)`, the stationary distribution (power iteration with self-loop fallback for unseen rows), the current-state next-day forecast, and the mean daily return. `mkIntervalCard()` renders a heatmap-shaded matrix per window (< 3 transitions → "Insufficient data"); KPI tiles show each symbol's 90-day next-day-up probability. One `fetchBars(MK_SYMBOLS, "1Day", maxDays+5)` call per run covers all windows. User-triggered via `loadMarkov()` — not auto-run on tab switch. Standalone from the 6-point execution score; analysis-only, places no orders. Matrix tables (`mkMatrixTable`) carry the `.mk-matrix` class (`min-width:0; table-layout:fixed`, tightened cell padding) to override the global `table { min-width:760px }` rule — without it the matrices overflow their narrow `grid-3` panels and overlap. |
| 🧠 Insights tab | On-demand (▶ Analyze, Markov/Edge pattern) **behavioral / trading-psychology** read-outs derived from realized FIFO round-trips (`insRoundTrips()` over paginated FILL history via the shared `edgeFetchAllFills()`; round-trips carry `pnl`, entry `cost`, `pnlPct`, `entryT`, `exitT`, sorted chronologically by exit). Four plain-language insight cards (`#insightsCards`, `grid-2`) plus 3 KPI tiles (`#insightsKpis`): **🗓 Day-of-Week Edge** (win rate + net P&L per weekday, GMT+2 exit time; flags the worst losing weekday), **📉 After Losing Streaks** (win rate baseline vs after-1-loss vs after-2+-losses; flags a drop), **🔁 Cadence After Outcome** (median hours to next entry after a win vs a loss; flags overtrading-after-wins), and **⚠ Rule Discipline** (best-effort rule-break detection from trade history: −5% hard-stop breaches = realized loss% < −5; per-symbol cap breaches = entry cost > `portCapFor(sym)`% × *current* equity — labelled approximate since historical equity is unknown). Lives in the **📊 Analysis** nav section. Standalone analysis-only module; never places orders. Top-level tab id `insights` (deep link `#insights`, keyboard via `TAB_ORDER`); does not auto-run on tab switch. |
| Settings tab | Grouped into labelled sections, each a 2-column `form-grid`: **📄 Paper Trading** (API Key + Secret), **🔴 Live Trading** (API Key + Secret), **🛡 Risk Limits** (Assumed Stop Loss %, Max Daily Loss %, Max Open Risk %), then **🔭 Signals Analysis** (Max Symbols in Market Signals scan), then **📋 Active Watchlist** (up to 20 symbols) — all placed *below* the API credentials. The watchlist add-symbol control is an `<input list="watchlistSymbolOptions">` + `<datalist>` dropdown populated from the full tradable Alpaca crypto universe (`populateWatchlistOptions()` → `getCryptoUniverse()`); the user can pick from the exchange list or type to filter, and already-added symbols are excluded. `populateWatchlistOptions()` runs from `renderWatchlistTags()` (so the dropdown stays in sync after add/remove/reset) and degrades gracefully to free-text entry if the assets call fails (the existing `addWatchlistSymbol()` still normalizes whatever is typed to `BASE/USD`). API key/secret pairs line up side by side per environment; risk-limit and signals inputs form separate blocks under the keys. `maxSignalSymbols` (input `setMaxSignalSymbols`, default 30, minimum 1, **no upper clamp**) lives in `getSettings().limits` and sets how many symbols the **Market Signals** scanner analyses — top-N via `universe.slice(0, n)` (`SCAN_SYMBOLS` in `loadMarketSignals`), where `universe` is `getCryptoUniverse()` (full tradable Alpaca crypto list, TOP30 first then the rest alphabetically). A value above 30 genuinely scans more than 30 symbols (no longer capped at the 30 hardcoded `TOP30_SYMBOLS`; the only ceiling is how many USD pairs the account can trade). Does not affect the watchlist Signals tab or Market Overview (the latter still shows the static 30). Settings persist to `config.json` in the same folder as the HTML: `loadConfigFromFile()` fetches `./config.json` on page load (inside an async `bootstrapDashboard()` IIFE) and seeds settings (empty string fields do not clobber stored credentials; `limits` are merged). `config.json` is **load-only** and acts as a *seed/fallback*: on load, saved `localStorage` values win and `config.json` only fills gaps (so a `maxSignalSymbols` you set and save persists across refreshes; `config.json`'s value applies only on a fresh browser with no saved setting). There is no save-to-file; `saveSettings()` persists to `localStorage`. To change defaults for a fresh browser, edit `config.json`; to change your live setting, use the Settings tab. **Note:** `updateScanBtnLabel()` must NOT be called from the early top-level init — `TOP30_SYMBOLS` is a `const` declared later in the script, so calling it before that line throws a TDZ error (`Cannot access 'TOP30_SYMBOLS' before initialization`) that aborts the whole script. It is now called inside `bootstrapDashboard()` after the `await`, by which point the const is initialized. |
| 📓 Daily Journal button (header) | `generateDailyJournal()` builds today's closing journal from live data (`/v2/account`, `/v2/positions`, `/v2/account/activities?activity_type=FILL`) plus a 10-symbol `JOURNAL_WL` confluence scan via `calcSignalScore`. Sections: Summary, Trades Today (FILL fills filtered to the GMT+2 day), Open Positions, Market Observations. Preview modal (`#journalDocBackdrop`) with Copy + Download `.md` (`daily-journal-YYYY-MM-DD.md`). Day filtering and timestamps use the `Etc/GMT-2` timezone. |

### Portfolio dashboard (now integrated into `docs/dashboard_professional.html`)

As of 2026-06-15, the portfolio dashboard pages were merged into the Professional Dashboard as new nav tabs under a **"💼 Portfolio"** section label. The legacy `docs/portfolio-dashboard.html` file was deleted on 2026-06-17 — the Professional Dashboard is the sole entry point.

The portfolio tabs in the Professional Dashboard:

| Tab | ID | Feature |
|-----|----|---------|
| 📊 Portfolio Overview | `port-overview` | Account cards, equity curve (Chart.js, period buttons), sortable positions table. |
| 🥧 Allocation | `port-dist` | Donut allocation chart, breakdown table, cap utilisation table vs. `PORTFOLIO_CAPS`. The cap table's `utilPct` is the **true (un-clamped)** utilisation and the **⚠ Over Cap** badge fires only when `Math.round(utilPct) > 100`, so the badge always agrees with the displayed "% of cap used" — a position exactly at cap reads "100% of cap used" / Near Cap, never a false Over Cap. The progress bar width is clamped to 100%. |

**JavaScript namespace:** All portfolio functions and variables are prefixed `port*` to avoid conflicts with the professional dashboard's existing functions. `portCapFor(sym)` uses the existing `PORTFOLIO_CAPS` object (values already in %). The standalone TA engine (`portConfluenceScore`, `portEmaSeries`, etc.) is independent of `calcSignalScore` to avoid cross-tab side effects.

### Dashboard scoring parity with `indicators.py`

The dashboard's `calcSignalScore()` implements **identical** logic to Python's `indicators.signal_score()`. Keep these in sync on every change:

| Rule | Detail |
|------|--------|
| EMA seeding | `emaArr()` seeds with SMA of first `period` values (not the first raw value). |
| EMA dead zone | ±0.05% band: `ema20 > ema50 * 1.0005` = golden (+1), `< 0.9995` = death (−1), else neutral (0). Applies to both 15-min (Signal 1) and 4H (Signal 6). |
| MACD partial credits | +0.5 green-not-rising; −0.5 red-improving. Uses 2-bar lookback (`prevHistogram2`). |
| MACD signal line alignment | `calcMACD()` must strip the NaN prefix from `macdLine` before passing to `emaArr()` for the 9-bar signal EMA. If the NaN-prefixed array is passed directly, `emaArr()` seeds on NaN and the entire signal line becomes NaN (histogram always NaN, MACD always 0). Fixed: filter to `validMacd = macdLine.filter(!isNaN)`, compute compact signal, then re-pad. |
| RSI direction | +1 only if RSI 40–65 AND rising (3-bar lookback via `calcRSIRising()`). −0.5 for RSI < 40 AND falling. |
| Score pill thresholds | **Loosened 2026-06-19.** Full-size buy at `score >= SIGNAL_BUY_SCORE` (3.5); half-size at `score >= SIGNAL_HALF_SCORE` (2.5) and `< 3.5`. Dashboard reads the shared `SIGNAL_BUY_SCORE`/`SIGNAL_HALF_SCORE`/`SIGNAL_DOWNTREND_LONG_SCORE` consts (defined after `DEFAULT_LIMITS`); Python reads `config.json › strategy.buy_score_threshold` (3.5) / `buy_score_half_size_threshold` (2.5) / `downtrend_long_score_threshold` (4.0). Keep the two in sync. Half-size short still fires at `score <= -3 && score > -4`. |
| Bar completeness | Both `get_crypto_bars()` (Python) and `fetchBars()` (dashboard) pass `end = now − 1 bar period` to exclude the currently-forming bar. Without this, the partial bar has near-zero volume and skews every indicator. |
| Bar recency | Python `get_crypto_bars()` passes `sort=desc` and reverses to chronological so it gets the **newest** N bars. Without it, Alpaca returns the *oldest* N bars of the `start…end` window (default ascending sort + 1.6× lookback buffer), leaving daily bars up to ~54 days stale and inverting the regime gate. The dashboard achieves recency via `next_page_token` pagination instead. |

### Python ↔ Dashboard consistency check

**Run this check whenever any indicator logic is modified in either `indicators.py` or `dashboard_professional.html`.**

Compare the following point-by-point before committing:

1. **EMA formula** — seeding (SMA of first `period` values), multiplier `k = 2/(period+1)`, no NaN contamination.
2. **MACD alignment** — `macdLine` has a NaN prefix (first `slow-1` = 25 values). The signal EMA must be computed on the compact (NaN-stripped) MACD series, then re-padded. Any change to MACD must verify the signal line is not NaN.
3. **RSI formula** — Wilder's smoothing, `avgLoss == 0 && avgGain == 0` returns 50 in Python; dashboard must match.
4. **Score thresholds** — Buy: `>= 3.5` full, `>= 2.5 && < 3.5` half (downtrend half-long at `>= 4.0`). Short: `<= -4` full, `<= -3 && > -4` half. Sell/cover: `<= -2` / `>= +2`. Never use `=== 3` / `=== -3`.
5. **Bollinger bands** — population std-dev (divide by `period`, not `period-1`), `pb < 0.25` = +1, `pb > 0.75` = -1.
6. **Volume ratio** — `current / avg(prev 20 bars)` where prev-20 excludes the current bar (Python: `volumes[-(period+1):-1]`; JS: `volumes.slice(-21, -1)`). Threshold: `>= 1.2` = +1, `< 0.7` = -0.5.
7. **4H dead zone** — same ±0.05% band as the 15-min EMA cross.
8. **Daily regime** — `last > SMA50 && SMA20 > SMA50` = uptrend; `last < SMA50 && SMA20 < SMA50` = downtrend. Uses SMA, not EMA.
9. **ATR sizing** — `equity × 0.01 / (ATR × 1.5)`, capped at `(equity × cap_pct) / ask`.
10. **Bar completeness** — both sides pass `end = now − 1 bar period`.
11. **Bar recency** — Python passes `sort=desc` (then reverses to chronological); dashboard paginates via `next_page_token`. Both must end at the latest complete bar — verify last bar timestamp ≈ now − 1 period.

**Note on the Breakout Scanner scoring** — The Breakout Scanner tab shows two scores side-by-side in each card header: (1) **Conviction** — a gap/breakout-specific score using daily bars, gap magnitude, volume tier, and range position (max ±7); (2) **Signal /6** — the standard 6-point `calcSignalScore()` result using 15-min + 4H + daily bars, identical to the Signals and Market Signals tabs. The Conviction score is intentionally separate from the execution 6-point score and should not be kept in sync with `indicators.py`. The Signal /6 score must be kept in sync (it uses the same `calcSignalScore` function).

### Documentation update rule
**This rule applies to every change without exception — code, dashboard, config, or scripts.**

When any code in this project is changed, update **all five** of these files to reflect the change:
- `CLAUDE.md` — add/update the relevant section
- `README.md` — update the relevant feature description
- `memory/memory.md` — add a dated session history entry
- `memory/glossary.md` — add/update any new terms or API notes
- `docs/dashboard_layout.md` — for any change to either dashboard, update the relevant dashboard section and add a dated changelog entry (Professional vs Portfolio sections)
