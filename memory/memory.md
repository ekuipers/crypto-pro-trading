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
