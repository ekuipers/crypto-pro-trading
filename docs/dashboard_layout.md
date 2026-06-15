# Dashboard Layout & Changelog

This file documents the design, tab structure, and feature history of both dashboards.
It serves as the **changelog** for all future dashboard changes and is one of the files
covered by the project's documentation-update rule (see `CLAUDE.md`).

There are two dashboards, each a self-contained single-file HTML page (no server needed):

1. **Professional Dashboard** — `docs/dashboard_professional.html` (primary, now 17 tabs including 4 integrated portfolio tabs, sidebar nav)
2. **Portfolio Dashboard** — `docs/portfolio-dashboard.html` (legacy, 5 tabs — contents now also available in the Professional Dashboard)

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
- **Python ↔ dashboard parity** — the in-browser scoring (`calcSignalScore`) mirrors `indicators.signal_score()` exactly (see the parity table in `CLAUDE.md`).

---

## 1. Professional Dashboard — `docs/dashboard_professional.html`

**Status:** Primary (recommended)
**Title:** "CryptoPro Dashboard"
**Tabs:** 15 — Command · Performance · Risk · Positions · Execution · Signals · P&L · Backtest vs Live · Breakout Scanner · Market Overview · Market Signals · Markov · Edge · [💼 Portfolio: Portfolio Overview · Allocation] · Settings

### Navigation & layout

- **Left sidebar navigation** — a `.layout` flex wrapper holds `<nav>` + `<main>`; `nav` is a 210px sticky vertical column, the active tab marked by a left blue border + tint.
- **Mobile (≤700px)** — `.layout` switches to a column and `nav` collapses to a horizontal scrolling bar with a bottom-border active marker. All tables scroll horizontally (`overflow-x` on `.table-wrap`, clamped to `calc(100vw - 32px)`), so the page is fully usable in portrait.
- **Tab deep-linking + refresh memory** — the active tab is reflected in the URL hash (e.g. `dashboard_professional.html#signals`). `switchTab()` writes the tab id to the hash (`history.replaceState`) and to `localStorage.lastTab`; on load `applyTabFromUrl()` (end of `bootstrapDashboard()`) restores the tab from the hash first, then `localStorage`. A `hashchange` listener switches tabs live. Valid ids are derived from the nav buttons via `validTabIds()`, so routing never drifts. So you can bookmark/share a direct link to any tab, and a browser refresh reopens the last tab instead of defaulting to Command.
- **Live ticker strip** — top-of-page, 10 symbols, price + 24h%, auto-refreshes every 15 s via `/v1beta3/crypto/us/snapshots`.
- **Auto-refresh button** — 3 modes: `Auto OFF` → `Prices 15s` → `Full 60s`.
- **📓 Daily Journal button (header)** — `generateDailyJournal()` builds today's closing journal from live data plus a 10-symbol confluence scan; preview modal with Copy + Download `.md`.

### Tabs

| Tab | Key | Purpose |
|-----|-----|---------|
| 🧭 **Command** | `command` | Trading-permission cockpit: live hard-rules panel (6 real-time checks), cash-reserve gate, equity/cash/open-risk/drawdown KPIs, trade modal (limit-only). Now also hosts the **🤖 Autopilot** panel: OFF-on-load toggle, 15/30/60-min interval, ⛔ kill switch (stop + cancel all orders), per-cycle entry/exit engine reusing the page's signal scorer with every hard-rule gate, trailing-stop HWM + activity log in `localStorage`. |
| 📈 **Performance** | `performance` | Equity curve, KPI tiles (Total P&L in dollars, Total Return %, avg return, volatility, best/worst period, filled orders), rolling metrics, period selector (1M/3M/6M/1Y). |
| ⚠️ **Risk** | `risk` | Portfolio cap usage per symbol (from `config.json`), 10×10 correlation heatmap (Pearson ρ, daily log-returns) shown in the **left** column with Effective Exposure on the right, drawdown/Sharpe/Sortino/Calmar/VaR. |
| 📂 **Positions** | `positions` | Open positions with P&L%, Stop $ (entry×0.95), Target $ (entry×1.10), live R:R, position cap usage. |
| 🎯 **Execution** | `execution` | Open/recent orders, cancel-all, limit-band compliance, ATR Position Sizer widget. |
| 📡 **Signals** | `signals` | Live 6-point Signal Confluence scanner for the 10 watchlist symbols; paginated bar fetch (`barsEnd()` excludes the in-progress bar); trend arrows, ATR qty, ⚡ quick-buy, ▶ execute. |
| 💰 **P&L** | `pnl` | FIFO realized P&L (shared `computeFifoStats()`), calendar heatmap, attribution by symbol, day-of-week performance, CSV export. |
| 🧪 **Backtest vs Live** | `backtest` | Compares live metrics to saved expected metrics (Sharpe, max DD, win rate, profit factor, avg daily return). Win Rate & Profit Factor use the same realized FIFO stats as the P&L tab. |
| 📊 **Breakout Scanner** | `gapgo` | On-demand pre-session breakout/gap analysis per watchlist symbol: catalyst, supply risk, likelihood, 6-month range position, key levels, historical gap behaviour, trade plan, risk rating. Each card header shows two scores: **Conviction** (gap-specific, max ±7) and **Signal /6** (standard 6-point `calcSignalScore()` — identical to Signals and Market Signals tabs). |
| 🌍 **Market Overview** | `market-overview` | Price, 24h%, 7d%, volume, trend and cap tier per symbol, sortable, with momentum heatmap. Scan universe = the shared `getCryptoUniverse()` (full tradable Alpaca crypto list) sliced by the **Max Symbols** setting — no longer hardcoded to 30. Score column auto-fills from the last Market Signals scan. |
| 🔭 **Market Signals** | `market-signals` | On-demand full 6-point confluence scan over `getCryptoUniverse()`, sliced by the **Max Symbols** setting (no upper clamp). Score distribution + Top Opportunities panel. Scores cached into `_msPrevScores` for cross-tab display. |
| 🔗 **Markov** | `markov` | On-demand first-order Markov chain analysis for BTC/USD & ETH/USD across 30/60/90/180/365-day windows. 3×3 transition matrix, stationary distribution, next-day forecast. Analysis-only — places no orders. |
| 🔬 **Edge** | `edge` | On-demand (▶ Analyze) realized-edge analytics: FIFO round-trips from all FILL activities — per-symbol expectancy table, P&L by hour-of-day / day-of-week (GMT+2), KPI tiles, factual takeaway line. |
| 📊 **Portfolio Overview** | `port-overview` | Account equity/cash/buying-power/P&L cards; equity curve (Chart.js, period buttons); open positions table (sortable, short-aware). |
| 🥧 **Allocation** | `port-dist` | Donut chart of allocation across positions + cash; sortable breakdown table; cap utilisation table (all watchlist symbols, Over Cap / Near Cap / OK badges). |
| ⚙ **Settings** | `settings` | Grouped sections: Paper credentials, Live credentials, Risk Limits, Signals Analysis (**Max Symbols**, default 30, minimum 1, no upper clamp), and **📋 Active Watchlist** (up to 20 symbols; tag editor with Add/Remove/Reset; persisted in `localStorage.proDashboardWatchlist`; used by Autopilot, Daily Journal, Signals tab, and Portfolio tabs). Seeds from `./config.json` (load-only fallback); saves to `localStorage`. |

### Shared crypto universe (Market Overview + Market Signals)

- `getCryptoUniverse()` fetches the full tradable-crypto list once (`/v2/assets?asset_class=crypto&status=active`), caches it in `_cryptoUniverse`, and orders it as the still-tradable `TOP30_SYMBOLS` first then every other USD pair alphabetically. Falls back to `TOP30_SYMBOLS` only if the call fails or yields nothing.
- **Robust to symbol format** — accepts both `BTC/USD` and bare `BTCUSD`, normalizes to `BASE/USD`, drops non-USD quotes (USDT/USDC/BTC).
- **Max Symbols setting** (`maxSignalSymbols`) drives how many symbols *both* pages scan (`universe.slice(0, n)`). It has **no upper limit** — the only ceiling is how many USD pairs the account can trade.
- **Contiguous ranks** — `rebuildUniverseRank()` builds `_universeRank` (sym → 1-based universe position); the shared `symbolInfo(sym)` helper returns curated `TOP30_INFO` when known, else a fallback whose `rank` is the universe position. So ranks are 1–30 (cap ranks) then 31+ (universe order) instead of `#?`. Symbols beyond the top 30 still show cap tier `?`.

### Keyboard shortcuts

`1`–`9` select the first nine tabs (Command…Settings order); `R` refreshes the current tab.

### Changelog

| Date | Change |
|------|--------|
| 2026-05-12 → 2026-05-17 | Built the 8→10-tab cockpit (Command, Performance, Risk, Positions, Execution, Signals, P&L, Backtest vs Live, Breakout Scanner) — see prior history. |
| (later) | Added **Market Overview**, **Market Signals**, and **Markov** tabs; converted the top nav to a **left sidebar**; added the live ticker strip, auto-refresh modes, and the 📓 Daily Journal generator. |
| 2026-06-06 | Removed the 30-symbol hard clamp on the **Max Symbols** setting (no upper bound; minimum 1). |
| 2026-06-06 | Fixed Max Symbols resetting to 30 on refresh — `config.json` limits now seed only as a fallback; saved `localStorage` values win. |
| 2026-06-07 | **Tab deep-linking + last-tab restore** — active tab stored in the URL hash and `localStorage.lastTab`; `applyTabFromUrl()` restores it on load and on `hashchange`. |
| 2026-06-07 | **Market Overview symbol-column fix** — added the missing opening `<td>` so the symbol/name lines up next to the Rank column instead of overflowing to the next row. |
| 2026-06-07 | **Removed the 30-symbol cap on both Market Signals and Market Overview** — both now use the shared `getCryptoUniverse()` sliced by Max Symbols. Hardened the universe parser to accept `BTC/USD` and bare `BTCUSD`; converted `loadMarketOverview()` off the hardcoded `TOP30_SYMBOLS`. |
| 2026-06-07 | **Real ranks for every symbol** — added `_universeRank` + `symbolInfo()`; symbols outside `TOP30_INFO` now get a contiguous rank from their universe position instead of `#?`. |
| 2026-06-07 | **Risk tab panel order** — swapped the "Portfolio Concentration & Correlation Risk" grid so the 🔗 Live Correlation Matrix is the left column and 📊 Effective Exposure the right. |
| 2026-06-07 | **Correlation matrix left whitespace fix** — `.corr-wrap table` now sets `min-width:0; width:auto` to override the global `table{min-width:760px}` rule; the matrix sizes to its content and aligns left instead of being shoved right by a stretched label column. |
| 2026-06-11 | **Removed dead short-trading UI** — Alpaca spot crypto cannot short (every attempt rejected, none filled). ⚡ Short / ▶ Execute-short buttons removed; SHORT pills → informational red **BEAR**; notification copy now says "no short — spot venue". Positions-tab Buy/Cover kept as legacy safety. |
| 2026-06-11 | **🤖 Autopilot panel (Command tab)** — autonomous in-dashboard trading loop with all hard-rule gates (score ≥ 4 + regime + correlation budget + caps + ATR sizing + 20% post-order cash reserve + $10 min notional), exits (hard stop −5%, trailing 3% below HWM after +2.5%, TA exit ≤ −2), OFF-on-load safety, ⛔ kill switch, GMT+2 activity log. |
| 2026-06-11 | **🔬 Edge tab** — realized round-trip expectancy analytics (FIFO over paginated FILL history): per-symbol expectancy, hour/day-of-week P&L attribution, payoff/holding-time KPIs. |
| 2026-06-15 | **💼 Portfolio tabs merged in** — all four `portfolio-dashboard.html` pages integrated as new nav tabs under a "💼 Portfolio" section label. Morning Brief button added to header. All element IDs/functions prefixed `port*` to avoid conflicts. `portCapFor()` reuses existing `PORTFOLIO_CAPS`. Inline `<style>` from page-brief moved to global CSS block. `generateMorningBrief()` + modal added. `switchTab` and `refreshCurrent` extended for all four new tabs. |
| 2026-06-15 | **6% drawdown hard rule removed** — removed `maxCurrentDrawdownPct` / `warningCurrentDrawdownPct` from `DEFAULT_LIMITS`, the hard-rules panel, and the alerts/permission-rules checks. The drawdown metric still shows on the Risk tab; the system no longer halts trading when drawdown reaches 6%. |
| 2026-06-15 | **📋 Active Watchlist in Settings tab** — tag editor lets the user manage up to 20 watchlist symbols. `getWatchlist()` returns the active list from `localStorage.proDashboardWatchlist` (falls back to the 10 defaults). All consumers updated: `JOURNAL_WL`, `AP_WATCHLIST`, and `PORT_CRYPTO_WL` are now dynamic calls to `getWatchlist()` / `getApWatchlist()` / `getPortCryptoWL()`. Footer: v2026-06-15.3. |
| 2026-06-15 | **Footer redesign** — replaced single-line footer with a two-row structured footer: project name + description on row 1; Creator, Last modified date, and Version on row 2. CSS uses `display:flex` + `flex-wrap` with mobile fallback to `flex-direction:column`. Version v2026-06-15.4. |
| 2026-06-15 | **Roadmap cleanup (all 5 items)** — (1) Added SVG candlestick favicon inline data URI; (2) Removed Orders pane from Portfolio Overview (`portFilterOrders`, `portSortOrd`, `portLoadOrders` JS removed); (3) Removed Hot Symbols tab (`page-port-hot`, all `port-hot` JS); (4) Updated `<title>` to "CryptoPro Dashboard"; (5) Removed Morning Brief tab, header button, modal, and all related JS (`portLoadBrief`, `portSortBriefPos`, `portRenderBriefPos`, `portSortConf`, `portRenderConf`, `generateMorningBrief`, helpers). Version v2026-06-15.5. |
| 2026-06-15 | **Roadmap 1** — Removed "Watchlist — No Position" section from Portfolio Overview. Deleted HTML `<section>` with `portNoPosBody`, `portRenderWatchlistNoPos()` function and its two call sites, the watchlist snapshot fetch in `portLoadPositions()`, and the `portWlSnaps` variable. |
| 2026-06-15 | **Roadmap 2** — Live Signal Scores (Signals tab) now sorted descending by score before rendering. |
| 2026-06-15 | **Bug 1** — Market Overview Score column now populates after either a Signals tab scan or a Market Signals scan. Signals tab scan now writes into `_msPrevScores` (via `Object.assign`); Market Signals scan triggers `moApplySort()` to refresh MO live. |
| 2026-06-15 | **Bug 2** — Breakout Scanner now shows two scores in each card header: **Conviction** (gap/breakout-specific, max ±7) and **Signal /6** (standard 6-point `calcSignalScore()` — same bars/logic as Signals and Market Signals tabs). `loadGapGo()` now also fetches 15-min and 4H bars via `fetchBars()`. Version v2026-06-15.6. |
| 2026-06-15 | **Bug fix — Score distribution miscategorises score 2.5 as BUY** — The Signals tab distribution used `else if (s <= 2)` for the positive-HOLD bucket, so a score of 2.5 fell through to the `else` branch and was counted as "≥ 4 (BUY)". Fixed to `else if (s < 3)`. Labels updated: "1–2 (HOLD)" → "0.5–2.9 (HOLD)", "−2–0 (HOLD)" → "−2.9–0 (HOLD)". Version v2026-06-15.7. |
| 2026-06-15 | **Bug fix — `applySort` and `numOrStr` not defined** — `portRenderPositions()` called `applySort()` and the sort helpers used by `portRenderDistTable` / `portRenderDistCap` called `numOrStr()`, but neither function was defined anywhere. Added both: `numOrStr(v)` coerces to `parseFloat` if numeric else lowercased string; `applySort(arr, key, dir)` sorts a shallow-copy of `arr` by key using `numOrStr`. Portfolio Overview positions table now sorts correctly when a column header is clicked. |
| 2026-06-15 | **Roadmap — Total P&L in currency added to Performance tab** — `renderPerformance()` now computes `totalReturnCurrency = equitySeries[last] − equitySeries[0]` and adds a **Total P&L** KPI tile (first in the `grid-3`, formatted as `+$X.XX` / `-$X.XX` with pos/neg colour) and a matching "Total P&L ($)" row in the Performance Summary table. Version v2026-06-15.8. |

---

## 2. Portfolio Dashboard — `docs/portfolio-dashboard.html`

**Status:** Legacy (maintained for reference; all tabs are now integrated into the Professional Dashboard under the "💼 Portfolio" section)
**Title:** "Portfolio Dashboard"
**Tabs:** 5 — Overview · Hot Symbols · Allocation · Morning Brief · Settings

### Tabs

| Tab | Key | Purpose |
|-----|-----|---------|
| 📊 **Overview** | `overview` | Account equity, cash, buying power, P&L today, open positions table (sortable), equity curve (Chart.js from `/v2/account/portfolio/history`). |
| 🔥 **Hot Symbols** | `hot` | Latest quotes for all watchlist symbols (sortable): ask, bid, spread; highlights recent movers. |
| 🥧 **Allocation** | `dist` | Donut chart of portfolio allocation across open positions; invested-vs-cash breakdown; largest-position highlight. |
| 🌅 **Morning Brief** | `brief` | Narrative summary of current regime, open positions, and suggested focus areas, generated from account + position data. |
| ⚙️ **Settings** | `settings` | API key / secret / base URL; paper/live mode toggle; persisted in `localStorage`. |

### Key features

- Paper/Live mode badge with animated pulse dot; toggleable from the header.
- Auto-refresh every 60 s on the Overview tab.
- Sortable Positions, Orders, and Hot Symbols tables (`sortPos` / `sortOrd` / `sortHot`).
- **🌅 Morning Brief button (header)** — `generateMorningBrief()` produces a downloadable Markdown brief matching the `journal/` format: Portfolio Health (+ per-position table), direction-aware Alerts, a 10-symbol Signal Confluence table (via the existing `confluenceScore`/`fetchBars` engine), and a templated Market Notes paragraph. Preview modal (`#briefDocBackdrop`) with Copy + Download `.md` (`morning-brief-YYYY-MM-DD.md`). Timestamps use the `Etc/GMT-2` timezone.

### Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial version — 3 tabs: Overview, Hot Symbols, Morning Brief. |
| 2026-05-10 | Added Allocation (donut) and Settings tabs. |
| 2026-05-11 | Equity curve added to Overview (Chart.js + portfolio-history endpoint). |
| 2026-05-12 | Paper/live toggle in header badge; `localStorage` credential persistence. |
| (later) | Added the 🌅 Morning Brief downloadable-document generator (`generateMorningBrief()`) matching the journal format. |

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
