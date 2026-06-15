# Changelog — Running Dev Log

---

## 2026-06-15 — Bug fixes + Roadmap: score distribution, applySort, Total P&L (v2026-06-15.8)

### Bug fix: Score distribution miscategorises 2.5 as BUY (Signals tab)
**Problem:** `else if (s <= 2)` in the distribution loop skipped score 2.5, which fell through to the `else` branch and was counted as BUY (≥4). Score 2.5 is achievable when e.g. MACD gives +0.5 partial credit.  
**Fix:** Changed to `else if (s < 3)`. Labels updated: "1–2 (HOLD)" → "0.5–2.9 (HOLD)", "−2–0 (HOLD)" → "−2.9–0 (HOLD)". Dict key renamed `1to2` → `1to3`. Version v2026-06-15.7.

### Bug fix: `applySort` and `numOrStr` not defined (Portfolio Overview)
**Problem:** `portRenderPositions()` called `applySort()` and the sort helpers in `portRenderDistTable` / `portRenderDistCap` called `numOrStr()` — neither function was defined anywhere in the file.  
**Fix:** Added both as shared sort helpers immediately before `portRenderPositions`: `numOrStr(v)` = `parseFloat` if numeric else lowercased string; `applySort(arr, key, dir)` = shallow-copy sort via `numOrStr`. Portfolio Overview positions-table column-header sort now works.

### Roadmap: Total P&L in currency — Performance tab (v2026-06-15.8)
**Fix:** `renderPerformance()` computes `totalReturnCurrency = equitySeries[last] − equitySeries[0]`. Added as (a) a **Total P&L** KPI tile (first in `grid-3`) with `+$X.XX` / `-$X.XX` colour-coded display, and (b) a "Total P&L ($)" row at the top of the Performance Summary table.

---

## 2026-06-15 — Roadmap items 1–2 + Bugs 1–2 completed (v2026-06-15.6)

### Roadmap 1: Remove "Watchlist — No Position" from Portfolio Overview
**Fix:** Deleted the HTML `<section>` containing `portNoPosBody`, removed `portRenderWatchlistNoPos()` function and its two call sites in `portRenderPositions()`, removed the watchlist snapshot fetch block from `portLoadPositions()`, and removed the `portWlSnaps` variable declaration.  
**Verified:** Grep confirms zero remaining refs to `portNoPosBody`, `portWlSnaps`, `portRenderWatchlistNoPos`.

### Roadmap 2: Order Live Signal Scores descending
**Fix:** Added `rows.sort((a, b) => (b.score !== null ? b.score : -99) - (a.score !== null ? a.score : -99));` before the `signalBody` innerHTML assignment in `loadSignals()`.  
**Verified:** Sort line present in file.

### Bug 1: Score column in Market Overview table not populated
**Problem:** Market Overview reads scores from `_msPrevScores`, which was only populated by Market Signals scans. If MO was loaded before a Market Signals scan (or if the user only scanned on the Signals tab), the Score column showed "–" for all rows.  
**Fix (a):** After `loadSignals()` saves `_prevScoreMap`, it also calls `Object.assign(_msPrevScores, newMap)` — so a Signals tab scan populates the MO score column too.  
**Fix (b):** After Market Signals scan writes `_msPrevScores`, it calls `if (_moData.length) moApplySort()` — so MO scores update live without requiring a page refresh.  
**Verified:** Both hooks present in file.

### Bug 2: Signal scores inconsistent across Breakout Scanner, Signals, Market Signals
**Problem:** Breakout Scanner showed a gap-specific "Conviction" score (max ±7), which users confused with the 6-point Signal score from the Signals and Market Signals tabs.  
**Fix:** `loadGapGo()` now fetches 15-min and 4H bars alongside the existing daily/hourly bars, computes `calcSignalScore()` for each symbol, and attaches `signalScore` to each analysis object. `ggRenderCards()` displays a **Signal /6** badge in each card header next to the Conviction score. Legend updated to explain both metrics. Breakout Scanner legend corrected from "+6 max" to "+7 max".  
**Verified:** All 4 change markers present in file; version v2026-06-15.6.

---

## 2026-06-15 — Roadmap items 2, 3, and 1 completed

### Item 2: Merge portfolio-dashboard.html into dashboard_professional.html
**Problem:** Two separate HTML dashboard files (portfolio-dashboard.html and dashboard_professional.html) required users to keep two browser tabs open.  
**Fix:** All four portfolio tabs (Overview, Hot Symbols, Allocation, Morning Brief) merged into the professional dashboard as a "💼 Portfolio" section in the sidebar nav. All element IDs and JS functions prefixed with `port` to avoid conflicts. Morning Brief button added to header. `switchTab` and `refreshCurrent` extended. CSS moved to global block.  
**Verified:** All 23 key identifiers confirmed present. File: 7971 lines after merge.

### Item 3: Remove 6% drawdown hard rule
**Problem:** The hard rule "current drawdown ≤ 6%, STOP trading" was blocking all trading even in normal market conditions. User requested removal.  
**Fix:** Removed `maxCurrentDrawdownPct` and `warningCurrentDrawdownPct` from `DEFAULT_LIMITS`, deleted the drawdown check from the hard-rules panel, removed from the permission-rules check and the alerts block. Risk tab drawdown metric display preserved.  
**Verified:** Grep confirms zero remaining references to the 6% halt rule in the dashboard. Footer: v2026-06-15.2.

### Item 1: Active Watchlist management in Settings tab
**Problem:** The 10-symbol watchlist (`JOURNAL_WL`, `AP_WATCHLIST`, `PORT_CRYPTO_WL`) was hardcoded in the JS. Users could not change which symbols the Autopilot, Daily Journal, and Portfolio tabs operated on without editing source code.  
**Fix:** Added `📋 Active Watchlist` section to the Settings tab with a tag editor (`#watchlistTagsEl`), add-symbol input (`#watchlistAddInput`), symbol count indicator (`#watchlistCountEl`), and Reset-to-defaults link. New JS: `DEFAULT_WATCHLIST`, `getWatchlist()`, `saveWatchlistData()`, `renderWatchlistTags()`, `addWatchlistSymbol()`, `removeWatchlistSymbol(idx)`, `resetWatchlist()`. Storage key: `localStorage.proDashboardWatchlist`. All three hardcoded arrays replaced with dynamic calls: `getWatchlist()`, `getApWatchlist()`, `getPortCryptoWL()`. `loadSettingsForm()` now calls `renderWatchlistTags()`. CSS added: `.wl-tag-editor`, `.wl-sym-tag`, `.wl-sym-tag-x`.  
**Verified:** Grep confirms zero stale references to `JOURNAL_WL`, `AP_WATCHLIST`, or `PORT_CRYPTO_WL`. Footer: v2026-06-15.3.

**Files changed:**
- `docs/dashboard_professional.html` (primary — all three items)
- `CLAUDE.md` (roadmap cleared)
- `README.md` (Settings tab description updated)
- `memory/projects/alpaca-trading-agent.md` (session history)
- `memory/glossary.md` (new terms: `getWatchlist`, `DEFAULT_WATCHLIST`, `WL_STORAGE_KEY`)
- `docs/dashboard_layout.md` (changelog entries for all three items; Settings tab description updated)

---

## 2026-06-15 — Bug fix: buttons/links not reacting on dashboard

**Problem:** After the drawdown-rule removal commit (c505713), a dangling `else` was left at the top level of `renderCommand()` — the code that removed `if/else if (drawdown ≥ max/warn)` left its trailing `else add("Drawdown OK",...)` behind. An orphan `else` (no matching `if`) is a JavaScript **syntax error** that prevented the entire script block from being parsed. Every function declaration was therefore never hoisted, making ALL onclick handlers (`switchTab`, `saveSettings`, etc.) undefined — the total "nothing reacts" symptom.

Additionally, the `setSortIcons()` function was present in the original `portfolio-dashboard.html` but was accidentally omitted during the portfolio merge. This caused a `ReferenceError` at the end of the script and prevented the Port init block from completing.

**Fix 1:** Removed the orphan `else add("green", "Drawdown OK", ...)` line from `renderCommand()` (dashboard_professional.html ~line 3039).  
**Fix 2:** Added `setSortIcons(headId, activeKey, dir)` function before the Port init calls; uses `port-sorted` CSS class (matching the merged dashboard's CSS rule `th.port-sorted .sort-icon`).  
**Verified:** Both changes reviewed in-context. The if/else chain for daily-loss and open-risk checks is now valid. `setSortIcons` is defined before its first call.

**Files changed:**
- `docs/dashboard_professional.html` (syntax fix + setSortIcons function)
- `CLAUDE.md` (bug cleared)
- `memory/memory.md` (this entry)

---

## 2026-06-15 — Roadmap items 1–5 completed (favicon, remove Orders/HotSymbols/MorningBrief, page title)

**Problem:** 5 open roadmap items remained: no favicon, Orders pane in Portfolio Overview, Hot Symbols tab in nav, page title still "Professional Trader Dashboard", and Morning Brief tab/button/modal.  
**Fix:** Applied all 5 changes via Python script to avoid encoding issues:
1. Added SVG candlestick chart favicon (inline data URI, 3 green/red candles on dark background).
2. Removed Orders pane from Portfolio Overview — deleted `portFilterOrders`, `portSortOrd`, `portLoadOrders` JS and the Orders `<section>` HTML.
3. Removed Hot Symbols tab — deleted `page-port-hot` HTML page, nav button, and all Hot Symbols JS (`portWlCard`, `portSortHot`, `portRenderHot`, `portLoadCryptoWatchlist`, `portLoadHot`).
4. Updated `<title>` from "Professional Trader Dashboard" to "CryptoPro Dashboard".
5. Removed Morning Brief — deleted nav button, `page-port-brief` HTML page, header button, Morning Brief modal, and all Brief JS (`portLoadBrief`, `portSortBriefPos`, `portRenderBriefPos`, `portSortConf`, `portRenderConf`, `generateMorningBrief`, `closeBriefDoc`, `downloadBriefDoc`, `copyBriefDoc`).
Also removed now-unused constants/vars: `portAllOrders`, `portOrdSort`, `portRawHotRows`, `portHotSort`, `port_briefEquity`, `portRawBriefPos`, `portRawConfRows`, `portBriefPosSort`, `portConfSort`, `PORT_STATUS_GROUPS`. Updated `switchTab`, `refreshCurrent`, and the 60s `setInterval` in Port init. Version v2026-06-15.5.  
**Verified:** Python check confirms zero remaining refs to all removed identifiers. File: 7395 lines (down from 8070).

**Files changed:**
- `docs/dashboard_professional.html`
- `CLAUDE.md` (roadmap cleared)
- `README.md` (portfolio tabs section updated)
- `docs/dashboard_layout.md` (tab list + changelog entry)
- `memory/MEMORY.md` (this entry)
- `memory/projects/alpaca-trading-agent.md` (session history)

---

## 2026-06-15 — Footer redesign (Roadmap item: Replace footer per Workflow rule 6)

**Problem:** Footer was a single cramped line of text with no structured project information.  
**Fix:** Replaced with a two-row flex footer: row 1 = project name ("CryptoPro Dashboard") + description; row 2 = Creator (Erik Kuipers), Last modified date (2026-06-15), Version (v2026-06-15.4). CSS uses `display:flex; flex-wrap:wrap` per row with a `@media(max-width:700px)` fallback to `flex-direction:column`. Added `.footer-row`, `.footer-name`, `.footer-sep` CSS classes.  
**Verified:** Grep confirms footer HTML is present and version string updated to v2026-06-15.4.

**Files changed:**
- `docs/dashboard_professional.html` (footer HTML + CSS)
- `CLAUDE.md` (roadmap cleared)
- `docs/dashboard_layout.md` (changelog entry)
- `memory/projects/alpaca-trading-agent.md` (session history)
