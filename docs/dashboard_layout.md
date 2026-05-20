# Dashboard Layout & Changelog

This file documents the design, tab structure, and feature history of both dashboards.
It serves as the **changelog** for all future dashboard changes.

---

## Design Philosophy

A trader dashboard should not just show how much money is being made — it should answer:
**"Am I allowed to trade, and am I trading correctly?"**

Key principles applied across both dashboards:

- **Decision cockpit first** — risk status, cash reserve, and open exposure are shown before P&L.
- **Hard rules in the UI** — CLAUDE.md rules are enforced in code (`trade.py`) and surfaced visually so they can never be forgotten.
- **Colour grammar** — green = within limits, yellow = approaching a limit, red = rule breached or action required.
- **No server needed** — both dashboards are self-contained HTML files; open locally in any browser.
- **Alpaca API** — all live data is fetched directly from the Alpaca paper/live API using credentials entered in Settings.

---

## 1. Portfolio Dashboard (legacy) — `docs/portfolio-dashboard.html`

**Status:** Legacy (still maintained, lighter-weight alternative)
**Tabs:** 5 — Overview · Hot Symbols · Distribution · Morning Brief · Settings

### Tabs

| Tab | Purpose |
|-----|---------|
| **📊 Overview** | Account equity, cash, buying power, P&L today, open positions table, equity curve (Chart.js line chart using `/v2/account/portfolio/history`) |
| **🔥 Hot Symbols** | Fetches latest quotes for all watchlist symbols; displays ask price, spread, and bid; highlights symbols with recent price movement |
| **🥧 Distribution** | Donut chart of portfolio allocation across open positions; shows invested vs cash breakdown; largest position highlight |
| **🌅 Morning Brief** | Narrative summary of current market regime, open positions, and suggested focus areas; generated from account + position data |
| **⚙ Settings** | API key / secret / base URL input fields; persisted in `localStorage`; mode toggle (paper / live) |

### Key Features

- Paper / Live mode badge with animated pulse dot; toggleable via dropdown in header.
- Auto-refresh every 60 seconds when on Overview tab.
- Equity curve rendered with Chart.js from `/v2/account/portfolio/history`.
- Positions table: symbol, qty, current price, market value, unrealized P&L ($ and %).
- Distribution donut auto-colours each symbol; shows cash as a separate slice.
- All API calls use the mode-selected base URL (paper vs live).

### Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial version created — 3 tabs: Overview, Hot Symbols, Morning Brief |
| 2026-05-10 | Added Distribution tab (donut chart) and Settings tab |
| 2026-05-11 | Equity curve added to Overview using Chart.js + portfolio history endpoint |
| 2026-05-12 | Paper/live toggle added to header badge; localStorage persistence for credentials |

---

## 2. Portfolio Dashboard (primary) — `docs/portfolio_dashboard.html`

**Status:** Primary (recommended)
**Tabs:** 10 — Command · Performance · Risk · Positions · Execution · Signals · P&L · Backtest vs Live · Gap & Go · Settings

### Tabs

| Tab | Key | Purpose |
|-----|-----|---------|
| **🧭 Command** | `command` | Trading permission cockpit: equity, cash reserve, open risk, drawdown, daily P&L, hard rules panel, trade modal |
| **📈 Performance** | `performance` | Equity curve (3M history), win rate, profit factor, expectancy, rolling 30D/90D Sharpe, period selector (1M/3M/6M/1Y) |
| **⚠️ Risk** | `risk` | Max drawdown, Sharpe, Sortino, Calmar, VaR, portfolio cap usage per symbol (from `config.json`), concentration panel, BTC-correlation note |
| **📂 Positions** | `positions` | Open positions table: symbol, qty, entry price, current price, market value, unrealised P&L ($ and %), stop distance (% from −5% hard stop), position cap usage |
| **🎯 Execution** | `execution` | Open and recent orders table; cancel-all button; order fill status; limit-band compliance indicator; ATR Position Sizer widget |
| **📡 Signals** | `signals` | Live 6-point Signal Confluence scanner for all 10 watchlist symbols; scores computed in-browser from Alpaca Data API bars; browser notification on score ≥ 4 |
| **💰 P&L** | `pnl` | Realized P&L from `/v2/account/activities`; FIFO-matched fills per symbol; win rate, profit factor, total realized P&L; P&L calendar heatmap; trade log table; CSV export |
| **🧪 Backtest vs Live** | `backtest` | Walk-forward report summary (latest `reports/*.json`); live Sharpe vs backtest Sharpe; drawdown comparison; strategy health indicator (green/yellow/red) |
| **🔥 Gap & Go** | `gapgo` | On-demand pre-session analysis for all 10 watchlist symbols ranked by conviction score. Fetches 6M daily bars + 8D hourly bars from `data.alpaca.markets`. Per-symbol sections: Catalyst (quality + news links), Market Cap & Supply Risk, Gap & Go Likelihood (signal confluence breakdown), 6-Month Range Position (visual bar), Daily Chart Key Levels (5 S/R levels), Historical Gap Behaviour (back-tested gap-and-go rate from 6M data), Trade Plan (strategy, entry, stop, T1, T2, sizing), Risk Rating (ATR%, cap tier). Symbols ranked highest-to-lowest conviction; downtrend + negative-gap tickers flagged AVOID. |
| **⚙ Settings** | `settings` | API credentials input; paper/live mode toggle; notification permission toggle; thresholds display (loaded from `config.json` values shown for reference) |

### Key Features

#### Command Tab
- **Hard Rules panel** — all CLAUDE.md hard rules listed in a styled table; permanent reminder at the top of every session.
- **Cash Reserve indicator** — checks `cash / equity ≥ 20%`. Red if breached, yellow if below 25%.
- **Trading Allowed status** — composite signal: red = stop / yellow = reduce / green = trade. Driven by cash reserve, largest position concentration, and drawdown thresholds.
- **Trade modal** — enter symbol, qty, side, limit price; submits via `trade.py` rules (limit-only enforced).

#### Performance Tab
- Rolling 30D and 90D Sharpe ratio computed from `/v2/account/portfolio/history`.
- Period selector: 1M / 3M / 6M / 1Y buttons filter the equity curve and metrics.
- Win rate and profit factor derived from closed-position activities.

#### Risk Tab
- **Portfolio Cap Usage** — table of all 10 symbols showing current position value vs cap from `config.json` › `portfolio_caps.caps`; colour-coded (green/yellow/red).
- **Concentration panel** — text summary of largest-position concentration risk.
- **Correlation note** — heuristic BTC-dominance check: high altcoin % → warns of correlated drawdown risk.
- Stop Distance column: shows each position's current P&L% relative to the −5% hard stop.

#### Execution Tab
- **ATR Position Sizer** — built-in calculator: enter equity, ATR, ask, and cap%; returns recommended qty, stop price, and R:R ratio using the 1%-risk rule (`qty = (equity × 1%) / (ATR × 1.5)`).

#### Signals Tab
- Fetches 15-min bars for all 10 watchlist symbols from `/v1beta3/crypto/us/bars`.
- `barsStart()` helper computes ISO start date to cover the required bar count (mirrors `_bars_start()` in `run_evaluation.py`).
- Scores EMA cross, MACD histogram, RSI, Bollinger %b, volume ratio, and 4H EMA regime.
- Results table: symbol, score/6, individual signal breakdown, action (BUY/HOLD/SELL).
- Browser notification fires when any symbol crosses score ≥ 4 (requires Notification API permission granted in Settings).

#### P&L Tab
- FIFO cost-basis matching from `/v2/account/activities?activity_type=FILL`.
- Shows realized P&L per symbol, total, win rate, profit factor.
- Calendar heatmap: each day coloured by net P&L (green/red intensity).
- CSV export of the full trade log.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Command |
| `2` | Performance |
| `3` | Risk |
| `4` | Positions |
| `5` | Execution |
| `6` | Signals |
| `7` | P&L |
| `8` | Backtest vs Live |
| `9` | Gap & Go |
| `R` | Refresh current tab |

### Changelog

| Date | Change |
|------|--------|
| 2026-05-12 | Initial version — 8 tabs: Command, Performance, Risk, Positions, Execution, Signals, Journal, Settings |
| 2026-05-13 | Added Backtest vs Live tab; walk-forward report JSON loader |
| 2026-05-14 | Added Portfolio Cap Usage table to Risk tab (per-symbol cap from `config.json`) |
| 2026-05-14 | Added ATR Position Sizer widget to Execution tab |
| 2026-05-14 | Added Stop Distance column to Positions tab |
| 2026-05-14 | Added Cash Reserve hard-rule indicator to Command tab (red < 20%, yellow < 25%) |
| 2026-05-15 | Added P&L tab (FIFO matching, calendar heatmap, CSV export); replaced Journal tab |
| 2026-05-15 | Added rolling 30D/90D Sharpe to Performance tab |
| 2026-05-15 | Added period selector (1M/3M/6M/1Y) to Performance and P&L tabs |
| 2026-05-15 | Added keyboard shortcuts (1–9 = tabs, R = refresh) |
| 2026-05-15 | Added browser notification support for score ≥ 4 events (Signals tab) |
| 2026-05-15 | Added concentration panel and BTC-correlation note to Risk tab |
| 2026-05-16 | Journal tab removed (journal is now written by the agent; no manual UI needed) |
| 2026-05-16 | **Signals tab fix** — corrected `fetchBars()` endpoint from non-existent `/v2/crypto/bars` to `/v1beta3/crypto/us/bars`; added `barsStart()` helper to supply mandatory `start` date parameter (Alpaca crypto bar endpoint ignores bare `limit` without `start`); added `console.error()` logging for failed fetches |
| 2026-05-17 | **Gap & Go tab added** — new 10th tab (`gapgo`, keyboard shortcut `9`). On-demand pre-session analysis engine for all 10 watchlist symbols. Fetches 6M daily + 8D hourly bars from `data.alpaca.markets` in parallel. Client-side TA engine computes: EMA (20/50 daily + simulated 4H), RSI, ATR, Bollinger Bands, MACD, volume ratio, 6M range position, swing-high/low + round-number key levels, historical gap-and-go rate (back-tested over 6M data). Conviction score from −7 to +7 drives ranking and likelihood rating. Each card has 8 sections: Catalyst, Market Cap & Supply Risk, Gap & Go Likelihood, 6-Month Range Position, Daily Chart Key Levels, Historical Gap Behaviour, Trade Plan, Risk Rating. Symbols in confirmed daily downtrend with negative gap flagged AVOID. |

---

## Original Design Reference

The sections below are the original professional-dashboard design notes that shaped the tab structure above.
Kept as reference for future feature additions.

### Executive cockpit — "Am I allowed to trade today?"

| Metric | Why it matters |
|--------|---------------|
| Account equity / NAV | Current capital base |
| Today P&L | Whether the day is within normal range |
| Open risk | Capital at risk if all stops are hit |
| Daily loss limit status | OK / Warning / Stop trading |
| Current drawdown | How far below recent equity peak |
| Max drawdown | Largest peak-to-trough loss ever |
| Trading allowed? | Trade / Reduce size / Stop |

### Performance metrics

| Metric | Explanation |
|--------|-------------|
| Net P&L | Result after costs |
| Cumulative P&L / equity curve | Account development over time |
| Win rate | % of profitable trades (read alongside payoff ratio) |
| Average win / average loss | Are winners larger than losers? |
| Profit factor | Gross profit ÷ gross loss |
| Expectancy / Average R | Expected earn/loss per trade |

### Risk metrics

| Metric | Why it matters |
|--------|---------------|
| Max drawdown | Largest peak-to-trough loss |
| Current drawdown | Currently underwater? |
| Sharpe ratio | Risk-adjusted return |
| Sortino ratio | Downside-risk-adjusted return |
| Calmar ratio | Return vs max drawdown |
| VaR / CVaR | Loss risk at chosen confidence level |

### Execution quality

| Metric | Why |
|--------|-----|
| Slippage | Execution drag |
| Commissions / fees | Cost drag on edge |
| Planned vs actual entry | Execution discipline |
| R-multiple at entry | Standardised risk/return |

### Alerts the dashboard enforces

| Alert | Meaning |
|-------|---------|
| Daily loss limit hit | Stop trading for the day |
| Drawdown exceeds threshold | Reduce size or pause |
| Risk per trade too high | Position too large |
| Exposure concentration high | Too much in one instrument |
| Strategy underperforming vs expected | Edge may be changing |
