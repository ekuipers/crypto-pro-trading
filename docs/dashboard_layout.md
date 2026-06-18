# Dashboard Layout & Changelog

This file documents the design, tab structure, and feature history of both dashboards.
It serves as the **changelog** for all future dashboard changes and is one of the files
covered by the project's documentation-update rule (see `CLAUDE.md`).

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
**Tabs:** 12 top-level (two with sub-tabs), grouped under sidebar section labels — 🧭 Command · ⚡ Trade [Signals · **Market** (Overview · Scanner · Breakout sub-tabs) · Execution] · 💼 Portfolio [Overview · Allocation · Risk] · 📊 Analysis [**🔬 Analytics** (Performance · P&L · Edge sub-tabs) · 🧠 Insights · Backtest vs Live · Markov] · ⚙ Settings *(Positions dropped 2026-06-17 — its table lives in Portfolio Overview)*

### Navigation & layout

- **Left sidebar navigation** — a `.layout` flex wrapper holds `<nav>` + `<main>`; `nav` is a 210px sticky vertical column, the active tab marked by a left blue border + tint. Tabs are **grouped by job-to-be-done** under `.nav-section-label` headers (⚡ Trade / 💼 Portfolio / 📊 Analysis), with Command and Settings as ungrouped anchors top and bottom — an Act → Hold → Analyze flow. Two parent tabs nest sub-tabs via a shared system (`.subnav` / `.subpage` / `.subtab-btn`; generic `_activateSubTab(parentId, subId)` scoped to `#page-<parent>`): 🌐 Market and 🔬 Analytics.
- **Mobile (≤700px)** — `.layout` switches to a column and `nav` collapses to a horizontal scrolling bar with a bottom-border active marker. All tables scroll horizontally (`overflow-x` on `.table-wrap`, clamped to `calc(100vw - 32px)`), so the page is fully usable in portrait.
- **Tab deep-linking + refresh memory** — the active tab is reflected in the URL hash (e.g. `dashboard_professional.html#signals`). `switchTab()` writes the tab id to the hash (`history.replaceState`) and to `localStorage.lastTab`; on load `applyTabFromUrl()` (end of `bootstrapDashboard()`) restores the tab from the hash first, then `localStorage`. A `hashchange` listener switches tabs live. Valid ids are derived from the nav buttons via `validTabIds()`, so routing never drifts. Both parent tabs also route their sub-tabs through the hash (`MARKET_SUBS` = `market-overview`/`market-signals`/`gapgo`; `ANALYTICS_SUBS` = `performance`/`pnl`/`edge`) via `marketSubTab()`/`analyticsSubTab()`; `applyTabFromUrl()` recognises every sub-id (`SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)`) and `switchTab()` redirects any of them to the right parent + sub-tab — so all legacy deep links (incl. `#gapgo`, `#pnl`, `#edge`) and keyboard shortcuts keep working. So you can bookmark/share a direct link to any tab or sub-tab, and a browser refresh reopens the last tab instead of defaulting to Command.
- **Live ticker strip** — top-of-page, driven by the **active watchlist** (`getWatchlist()`, up to 20 symbols — no longer a hardcoded 10), price + 24h%, auto-refreshes every 15 s via `/v1beta3/crypto/us/snapshots`. Re-renders immediately on watchlist edits because `saveWatchlistData()` calls `loadTickerStrip()` (roadmap item 1, 2026-06-17).
- **Auto-refresh button** — 3 modes: `Auto OFF` → `Prices 15s` → `Full 60s`.
- **📓 Daily Journal button (header)** — `generateDailyJournal()` builds today's closing journal from live data plus a 10-symbol confluence scan; preview modal with Copy + Download `.md`.

### Tabs

| Tab | Key | Purpose |
|-----|-----|---------|
| 🧭 **Command** | `command` | Trading-permission cockpit: live hard-rules panel (6 real-time checks), cash-reserve gate, equity/cash/open-risk/drawdown KPIs, trade modal (limit-only). The 🚦 Trading Permission Rules panel carries a **Latest Activity** block in its top-left corner showing the latest 2 FILL activities (`#recentActivities`, rendered by `renderCommand()` from `c.activities`). Now also hosts the **🤖 Autopilot** panel: OFF-on-load toggle, 15/30/60-min interval, ⛔ kill switch (stop + cancel all orders), per-cycle entry/exit engine reusing the page's signal scorer with every hard-rule gate, trailing-stop HWM + activity log in `localStorage`. |
| 🔬 **Analytics** | `analytics` | **Parent tab merging Performance + P&L + Edge** under the shared sub-tab bar (`analyticsSubTab()` → generic `_activateSubTab("analytics", …)`). Valid sub-ids: `ANALYTICS_SUBS = ["performance","pnl","edge"]`. Performance auto-loads (`refreshCurrent`→`loadDashboard`); P&L on select (`loadPnl`); Edge manual (▶). Deep links `#performance`/`#pnl`/`#edge` resolve via `applyTabFromUrl()` + `switchTab()` redirect. Lives in the **📊 Analysis** nav section with Backtest + Markov. |
| › 📈 Performance | `performance` (sub) | Equity curve, KPI tiles (Total P&L in dollars, Total Return %, avg return, volatility, best/worst period), rolling metrics, period selector (1M/3M/6M/1Y). |
| ⚠️ **Risk** | `risk` | Portfolio cap usage per symbol (from `config.json`), 10×10 correlation heatmap (Pearson ρ, daily log-returns) shown in the **left** column with Effective Exposure on the right, drawdown/Sharpe/Sortino/Calmar/VaR. |
| ~~Positions~~ | *(removed)* | **Dropped 2026-06-17** — the positions table lives in **Portfolio Overview**. `renderPositions` is kept only to cache `_lastPositions`/`_lastEquity` (Risk concentration panel + CSV export); its DOM writes are null-guarded. |
| 🎯 **Execution** | `execution` | Open/recent orders, cancel-all, limit-band compliance, ATR Position Sizer widget. |
| 📡 **Signals** | `signals` | Live 6-point Signal Confluence scanner for the 10 watchlist symbols; paginated bar fetch (`barsEnd()` excludes the in-progress bar); trend arrows, ATR qty, ⚡ quick-buy, ▶ execute. |
| › 💰 P&L | `pnl` (sub) | FIFO realized P&L (shared `computeFifoStats()`), calendar heatmap, attribution by symbol, day-of-week performance, CSV export. |
| 🧪 **Backtest vs Live** | `backtest` | Compares live metrics to saved expected metrics (Sharpe, max DD, win rate, profit factor, avg daily return). Win Rate & Profit Factor use the same realized FIFO stats as the P&L tab. |
| 🌐 **Market** | `market` | **Parent tab merging Market Overview + Scanner + Breakout** under the shared sub-tab bar (`marketSubTab()` → `_activateSubTab("market", …)`). The middle sub-tab is labelled **🔭 Scanner** (renamed from "Signals" so "Signals" names only the watchlist tab; sub-id stays `market-signals`). Valid sub-ids: `MARKET_SUBS = ["market-overview","market-signals","gapgo"]`. The sub-tab id is mirrored to the URL hash + `localStorage.lastTab`, so the legacy deep links `#market-overview` / `#market-signals` / `#gapgo` still open the right sub-tab (resolved in `applyTabFromUrl()`; `switchTab()` also redirects any sub-id to the parent so keyboard shortcuts work). Overview auto-loads (contextual); Scanner + Breakout are manual. Cross-links: "View scanner →" / "← Back to market context". `_marketSub` restores the last sub-tab on re-entry. |
| › 🌍 Market Overview | `market-overview` (sub) | Price, 24h%, 7d%, volume, trend and cap tier per symbol, sortable, with momentum heatmap. Scan universe = the shared `getCryptoUniverse()` (full tradable Alpaca crypto list) sliced by the **Max Symbols** setting — no longer hardcoded to 30. Score column auto-fills from the last Scanner scan. Each row has a **Trade** column with Buy/Sell buttons (`moTradeButtons()`) that open the shared paper-trade modal pre-filled with symbol, side, and live price. |
| › 🔭 Scanner | `market-signals` (sub) | On-demand full 6-point confluence scan over `getCryptoUniverse()` (formerly labelled "Market Signals"), sliced by the **Max Symbols** setting (no upper clamp). Stablecoin pairs excluded. **Per-symbol Watchlist column** (`msWatchlistCell()`): **+ Watch** when score ≥ 4 and not already watched; **– Unwatch** when score ≤ −2 (sell) and no open position; else ✓ watched / –. Buttons update the shared watchlist and re-render in place (`renderMsWatchlistCells()`, no rescan); open positions fetched into `_msOpenPosSyms`. Score distribution + Top Opportunities panel. Scores cached into `_msPrevScores` for cross-tab display. |
| › 📊 Breakout | `gapgo` (sub) | On-demand pre-session breakout/gap analysis per watchlist symbol (folded in from the former standalone tab 2026-06-17): catalyst, supply risk, likelihood, 6-month range position, key levels, historical gap behaviour, trade plan, risk rating. Each card header shows two scores: **Conviction** (gap-specific, max ±7) and **Signal /6** (standard 6-point `calcSignalScore()` — identical to the Signals tab and the Scanner). Manual run (▶ Run Analysis); element `subpage-gapgo`; deep link `#gapgo` preserved. |
| 🔗 **Markov** | `markov` | On-demand first-order Markov chain analysis for BTC/USD & ETH/USD across 30/60/90/180/365-day windows. 3×3 transition matrix, stationary distribution, next-day forecast. Analysis-only — places no orders. |
| 🧠 **Insights** | `insights` | On-demand (▶ Analyze) **behavioral / trading-psychology** read-outs from realized FIFO round-trips (`insRoundTrips()` over paginated FILL history). 4 plain-language cards — 🗓 Day-of-Week Edge, 📉 After Losing Streaks (win rate after 2+ consecutive losses vs baseline), 🔁 Cadence After Outcome (overtrading-after-wins), ⚠ Rule Discipline (best-effort −5% stop + per-symbol cap breaches from trade history) — plus 3 KPI tiles. Analysis-only; in the 📊 Analysis nav section. |
| › Performance KPI note | — | The Performance sub-tab's "Filled Orders" KPI tile was **removed 2026-06-17** (duplicated Execution; misplaced among performance stats). |
| › 🔬 Edge | `edge` (sub) | On-demand (▶ Analyze) realized-edge analytics: FIFO round-trips from all FILL activities — per-symbol expectancy table, P&L by hour-of-day / day-of-week (GMT+2), KPI tiles, factual takeaway line. |
| 📊 **Portfolio Overview** | `port-overview` | Account equity/cash/buying-power/P&L cards; equity curve (Chart.js, period buttons); open positions table (sortable, short-aware). |
| 🥧 **Allocation** | `port-dist` | Donut chart of allocation across positions + cash; sortable breakdown table; cap utilisation table (all watchlist symbols, Over Cap / Near Cap / OK badges). "Over Cap" fires only when rounded utilisation > 100%, matching the displayed "% of cap used"; bar clamped to 100%. |
| ⚙ **Settings** | `settings` | Grouped sections: Paper credentials, Live credentials, Risk Limits, Signals Analysis (**Max Symbols**, default 30, minimum 1, no upper clamp), and **📋 Active Watchlist** (up to 20 symbols; tag editor with Add/Remove/Reset; the add-symbol control is an `<input list>` + `<datalist>` dropdown populated from the full tradable Alpaca exchange universe via `populateWatchlistOptions()` — pick or type to filter; persisted in `localStorage.proDashboardWatchlist`; used by Autopilot, Daily Journal, Signals tab, and Portfolio tabs). Seeds from `./config.json` (load-only fallback); saves to `localStorage`. |

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
| 2026-05-09 | Initial version — 3 tabs: Overview, Hot Symbols, Morning Brief. |
| 2026-05-10 | Added Allocation (donut) and Settings tabs. |
| 2026-05-11 | Equity curve added to Overview (Chart.js + portfolio-history endpoint). |
| 2026-05-12 | Paper/live toggle in header badge; `localStorage` credential persistence. |
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
| 2026-06-15 | **Bug fix — Total P&L in Performance tab mismatched Portfolio Overview** — The tile used `equitySeries[last] − equitySeries[0]` (3-month equity-history window) instead of `acct.unrealized_pl` (same field used by Portfolio Overview). Fixed: `totalPL = parseFloat(c.acct.unrealized_pl ?? 0)`. Both tabs now show the identical value. Version v2026-06-15.9. |
| 2026-06-15 | **Bug fix — Total P&L in Performance tab still mismatched P&L tab** — v2026-06-15.9 used `acct.unrealized_pl` (open-position paper gains) which differs from the P&L tab's `fifoStats.totalPnl` (FIFO-realized P&L). Fixed: changed to `c.fifoStats.totalPnl` — the same FIFO value already computed in `loadContext()` from the same 100-fill sample the P&L tab uses. Version v2026-06-15.10. |
| 2026-06-15 | **Bug fix — Signals tab ignored Settings watchlist** — `loadSignals()` hardcoded the 10 default symbols instead of calling `getWatchlist()`. Fixed: replaced the hardcoded array with `getWatchlist()` so the Signals tab now scans whatever symbols the user configured in the Settings watchlist. Version v2026-06-15.11. |
| 2026-06-17 | **Roadmap — Market Overview Buy/Sell buttons** — added a **Trade** column to the Market Overview table (header + `colspan` 9→10). New `moTradeButtons(row)` renders Buy/Sell buttons that open the shared `openTradeModal()` pre-filled with symbol (`BTCUSD` format), side, and live price (qty blank); shows `–` when no live price. Version v2026-06-17.12. |
| 2026-06-17 | **Roadmap — Settings watchlist exchange dropdown** — replaced the free-text watchlist input with an `<input list>` + `<datalist>` populated from the full tradable Alpaca crypto universe (`populateWatchlistOptions()` → `getCryptoUniverse()`); pick from the exchange list or type to filter, already-added symbols excluded, re-synced via `renderWatchlistTags()`. Degrades to free-text if the assets call fails. Version v2026-06-17.12. |
| 2026-06-17 | **Roadmap — single-line responsive footer** — flattened the footer from two stacked `.footer-row` divs into a single `<footer>` flex row (`flex-wrap:wrap; align-items:baseline; gap:4px 14px`), so all items sit on one line on wide windows and wrap naturally as the window narrows. Removed the now-unused `.footer-row` CSS. Version v2026-06-17.13. |
| 2026-06-17 | **Deleted legacy `docs/portfolio-dashboard.html`** — its tabs were merged into the Professional Dashboard on 2026-06-15; the standalone file is now removed. Professional Dashboard is the sole entry point. |
| 2026-06-17 | **Bug — stablecoins in scans** — `getCryptoUniverse()` now drops stablecoin bases (`STABLECOIN_BASES`: USDT, USDC, DAI, PYUSD, …), so `USDT/USD`/`USDC/USD` etc. no longer appear in Market Signals, Market Overview, or the watchlist dropdown. Version v2026-06-17.14. |
| 2026-06-17 | **Bug — false "Over Cap" badge** — Allocation cap table clamped `utilPct` to 100 for display but flagged Over Cap off the raw value, so a position fractionally over cap read "100% of cap used" yet showed "Over Cap". Fixed: `utilPct` is now un-clamped, `isOver = Math.round(utilPct) > 100` (matches the displayed %), bar width clamped separately. Version v2026-06-17.14. |
| 2026-06-17 | **Roadmap — merged Market Overview + Market Signals into one 🌐 Market tab** — replaced the two sidebar nav buttons with a single `switchTab('market')` button; the former pages are now `.market-subpage` divs switched by a sub-tab bar (`marketSubTab()`). The sub-tab id is mirrored to the URL hash + `localStorage.lastTab`, so legacy deep links `#market-overview` / `#market-signals` still resolve (via a `SUBS` list in `applyTabFromUrl()`). Added cross-links ("View matching signals →" / "← Back to market context"); `_marketSub` restores the last sub-tab. CSS: `.market-subnav`, `.subtab-btn`, `.market-subpage`. Version v2026-06-17.15. |
| 2026-06-17 | **Roadmap — per-symbol Watchlist button on Market Signals** — new **Watchlist** column (colspans 13→14): `msWatchlistCell()` shows **+ Watch** when score ≥ 4 and not watched, **– Unwatch** when score ≤ −2 (sell) and no open position (`/v2/positions` → `_msOpenPosSyms`), else ✓ watched / –. `msAddWatch`/`msRemoveWatch` update the shared watchlist and re-render only the cells (`renderMsWatchlistCells()`, cached `_msLastRows`) — no rescan. Version v2026-06-17.15. |
| 2026-06-17 | **Roadmap — navigation regrouped by job-to-be-done** — sidebar tabs reordered under three `.nav-section-label` headers (⚡ Trade · 💼 Portfolio · 🔬 Analytics) with Command + Settings as ungrouped anchors; "Portfolio Overview" nav label shortened to "Overview". Menu-only change — no tab ids/onclick/routing touched; `TAB_ORDER` (keyboard 1-9) updated to the new visual order. Version v2026-06-17.16. |
| 2026-06-17 | **Roadmap — Breakout Scanner folded into the Market tab** — the standalone `gapgo` tab became the third Market sub-tab (`subpage-gapgo`, button "📊 Breakout"). New `MARKET_SUBS` const drives `marketSubTab()` validation, `applyTabFromUrl()`'s `SUBS`, and a `switchTab()` redirect guard so `#gapgo` / keyboard / legacy `switchTab('gapgo')` keep working. Removed the dead `gapgo` switchTab branch + top-level nav button; added a "← Back to market context" cross-link. Version v2026-06-17.16. |
| 2026-06-17 | **Bug — "Signals" duplicated** (top-level menu item + Market sub-tab). Renamed the Market full-universe scanner sub-tab **🔭 Signals → 🔭 Scanner** (button + Overview cross-link "View scanner →"); sub-id `market-signals` and `#market-signals` deep link unchanged. Non-destructive: both tools kept (Signals = watchlist/execute, Scanner = universe confluence + watchlist add/remove). Version v2026-06-17.17. |
| 2026-06-17 | **Roadmap — Performance + P&L + Edge merged into one 🔬 Analytics tab.** Generalised the sub-tab system: CSS `.market-subnav`/`.market-subpage` → `.subnav`/`.subpage`; new generic `_activateSubTab(parentId, subId)` (scoped to `#page-<parent>`); button ids unified to `subtab-<subId>`; `marketSubTab`/`analyticsSubTab` are thin wrappers. The three former pages were relocated into `page-analytics` as `subpage-performance/pnl/edge` (Node div-depth script). Nav: one **🔬 Analytics** button in a new **📊 Analysis** section (with Backtest + Markov). `ANALYTICS_SUBS` + `switchTab()` redirect + `applyTabFromUrl()` `SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)` preserve `#performance`/`#pnl`/`#edge` + keyboard. Version v2026-06-17.17. |
| 2026-06-17 | **Roadmap — standalone Positions tab dropped.** Removed `page-positions` + its nav button (table already in Portfolio Overview). `renderPositions` retained (wrapper caches `_lastPositions`/`_lastEquity` for Risk concentration panel + CSV export) with its `positionKpis`/`positionsBody` writes null-guarded. `exportCsv("positions")` branch now unreachable but left in place. `TAB_ORDER` updated. Version v2026-06-17.17. |
| 2026-06-17 | **Roadmap — ticker strip now follows the active watchlist.** `loadTickerStrip()` dropped its hardcoded 10-symbol `WATCH` array and now calls `getWatchlist()` (Settings list, up to 20). `saveWatchlistData()` also calls `loadTickerStrip()` so edits show in the ticker immediately rather than waiting up to 15 s for the next refresh. Version v2026-06-17.18. |
| 2026-06-17 | **Roadmap — portfolio overview tiles now horizontal.** The account/summary tiles use `<div class="cards">`, but no `.cards` CSS rule existed, so the six Portfolio Overview cards (and five Allocation summary cards) stacked vertically. Added `.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }` next to `.grid-2`/`.grid-3`. Tiles now flow horizontally and wrap responsively. Version v2026-06-17.19. |
| 2026-06-17 | **Roadmap — Scanner score-distribution tile now matches the Signals page.** Extracted the Signals tab's bucketed horizontal-bar Score Distribution into a shared `renderScoreDist(elId, scores)` helper (buckets ≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR). Both `#scoreDist` (Signals) and `#msScoreDist` (Market → Scanner) now call it, so the Scanner shows the identical tile instead of its old per-integer inline list (which also mis-bucketed fractional scores). Verified via `node --check`. Version v2026-06-17.22. |
| 2026-06-17 | **Roadmap — remove duplicate KPI + new 🧠 Behavioral Insights tab.** (Item 1) Removed the misplaced "Filled Orders" KPI tile from the Performance tab (duplicated Execution; preserved legitimate summary-vs-detail and documented-parity overlaps). (Item 2) Added a new top-level **🧠 Insights** tab (`page-insights`, id `insights`, in the 📊 Analysis section; ▶ Analyze, no auto-run). `insRoundTrips()` builds FIFO round-trips with entry cost / pnl% / timestamps from paginated FILL history (`edgeFetchAllFills()`); renders 4 plain-language cards (🗓 Day-of-Week Edge, 📉 After Losing Streaks, 🔁 Cadence After Outcome, ⚠ Rule Discipline) + 3 KPI tiles. Rule breaks are best-effort from trade history (−5% stop breaches + per-symbol cap breaches vs current equity). Verified via `node --check` + synthetic-fill unit test of the FIFO/streak/cadence/breach logic. Version v2026-06-17.21. |
| 2026-06-18 | **Bug (follow-up) — scanner returns only 33 symbols while Max Symbols = 60.** After the cache fix, `getCryptoUniverse()` correctly resolves ~33 because Alpaca only offers ~20–33 USD-quoted pairs (its other ~56 pairs are USDT/USDC/BTC-quoted, which are dropped since the bot is USD-only). Real exchange ceiling, not a code defect. Per the user's choice ("make the UI honest"): `updateScanBtnLabel()` clamps to `_cryptoUniverse.length` (`▶ Scan Top <N> (all available)` when Max Symbols exceeds the universe); the Scanner and Market Overview status lines append a note that Max Symbols exceeds the tradable USD-pair count. Verified via `node --check`. Version v2026-06-18.2. |
| 2026-06-18 | **Bug — fewer symbols scanned than the Max Symbols setting.** `getCryptoUniverse()` cached the `TOP30_SYMBOLS` fallback whenever the `/v2/assets` call failed/returned empty. Since the function first runs on page load (via `loadSettings()` → `renderWatchlistTags()` → `populateWatchlistOptions()`) — possibly before credentials are seeded — the 30-symbol fallback could be cached for the whole session, capping every Scanner/Market Overview scan at 30 regardless of Max Symbols. Fixed: only a real, non-empty result is cached; the fallback is now returned **without** caching, so a later call retries and picks up the full universe. Verified via `node --check`. Version v2026-06-18.1. |
| 2026-06-18 | **Roadmap — Latest Activity block in the Command-center permission area.** Exposed the FILL activity feed `loadContext()` already fetches as `c.activities`; added `#recentActivities` above `#permissionRules` (top-left of the 🚦 Trading Permission Rules panel). `renderCommand()` renders a "Latest Activity" label + the latest 2 fills (time GMT+2, colour-coded side, qty, `tvLink` symbol, fill price), with a "No recent activity." empty state. No extra API call. Verified via `vm.Script` syntax check. Version v2026-06-18.3. |
| 2026-06-17 | **Layout/style consistency sweep** — fixed undefined/duplicated CSS surfaced by a review: (1) `.footer-name` used `var(--fg)` (undefined) → `var(--text)`; (2) added a real `.spinner` (spinning ring + `@keyframes spin`) — the 5 portfolio loading states referenced an undefined class so the spinner was invisible; (3) the two portfolio error boxes used the undefined `.error-box` → reuse the defined `.error` red box; (4) removed dead `.score-pip.on-pos/.on-neg/.on-half` variants (renderer only uses `.on`/`.neg`); (5) introduced a theme-aware `--hover` token (dark `#222b3a`, light `#e2e7ed`) replacing hardcoded hover greys in `.btn:hover`, `th:hover`, and `th.port-sortable:hover` (the old `#222b3a`/`#21262d` didn't adapt to light theme, and the two sortable-header shades disagreed); removed the now-redundant light-theme `.btn:hover` override; (6) added `.period-btns { display:flex; gap:6px; flex-wrap:wrap }` so the Portfolio Overview period buttons space like the Performance row; (7) Breakout-card symbol is now a `tvLink()` anchor with the `.symbol` class (was an inline-styled `<span>`, off the "every symbol is a TradingView link" rule). Version v2026-06-17.20. |

---

## 2. Portfolio Dashboard — `docs/portfolio-dashboard.html` *(DELETED 2026-06-17)*

**Status:** Deleted on 2026-06-17. The file no longer exists; all its tabs were integrated into the Professional Dashboard under the "💼 Portfolio" section on 2026-06-15. The section below is kept as a historical record of what the standalone dashboard contained.
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
