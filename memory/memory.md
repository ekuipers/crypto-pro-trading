# Changelog — Running Dev Log

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

## 2026-06-15 — Footer redesign (Roadmap item: Replace footer per Workflow rule 6)

**Problem:** Footer was a single cramped line of text with no structured project information.  
**Fix:** Replaced with a two-row flex footer: row 1 = project name ("CryptoPro Dashboard") + description; row 2 = Creator (Erik Kuipers), Last modified date (2026-06-15), Version (v2026-06-15.4). CSS uses `display:flex; flex-wrap:wrap` per row with a `@media(max-width:700px)` fallback to `flex-direction:column`. Added `.footer-row`, `.footer-name`, `.footer-sep` CSS classes.  
**Verified:** Grep confirms footer HTML is present and version string updated to v2026-06-15.4.

**Files changed:**
- `docs/dashboard_professional.html` (footer HTML + CSS)
- `CLAUDE.md` (roadmap cleared)
- `docs/dashboard_layout.md` (changelog entry)
- `memory/projects/alpaca-trading-agent.md` (session history)
