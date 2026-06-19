# Project: Alpaca Trading Agent

**Status:** Active — paper trading only  
**Account:** PA3EZEE1I9RS  
**Root:** `C:\Users\ERKUIPER\OneDrive - Capgemini\015. Repos\alpaca-trading-bot\alpaca-trading-agent`  
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
├── memory/
│   ├── memory.md                ← Single project memory + running changelog (this file)
│   └── glossary.md              ← Full decoder ring
├── config.json                  ← Central config: strategy, risk, indicators, portfolio caps, watchlist
├── scripts/
│   ├── run_evaluation.py        ← Main eval loop; run with --execute to trade
│   ├── indicators.py            ← TA library: RSI, MACD, BB, ATR, EMA cross, vol ratio
│   ├── trade.py                 ← Order placement (enforces all hard rules)
│   └── verify.py                ← API smoke test
├── journal/
│   └── YYYY-MM-DD.md            ← Daily trading journals (append, never overwrite)
├── docs/
│   ├── dashboard_professional.html       ← Sole dashboard (portfolio-dashboard.html deleted 2026-06-17; see dashboard_layout.md)
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
| 23:21 daily | Closing journal entry |

---

## Scheduled Tasks (Cowork)

| Name | Cron | Status | What it does |
|------|------|--------|-------------|
| `morning-brief` | `0 7 * * *` | enabled | Runs verify.py + run_evaluation.py; writes evaluation block to journal |
| `morning-evaluation` | `0 9 * * *` | **disabled** | Daily evaluation — compute signals for all watchlist symbols and execute trades where warranted |
| `daily-journal` | `21 23 * * *` | enabled | Closing journal entry — summarise trades, P&L, and market observations |

---

## Session History

### 2026-06-19 — Roadmap: loosen gates + 4H swing-low stop, and a Scalping page (v2026-06-19.1)

Rescan roadmap. Two items: (1) "loosen the very strict trade gates and change the 5% hard stop loss to a stop loss based on previous range lows e.g. on the 4H timeframe"; (2) "add a scalping page that trades on low timeframes (5m/15m/1h) using the same indicators." Decisions taken via question prompt: scalp page = **scanner + manual Buy/Sell** (no new auto-loop); stop = **lowest low of last 20×4H bars ×0.999, clamped ≤8%**, fixed-% fallback; gates = **Moderate + regime**.

> Note: an earlier pass this session implemented the *previous* roadmap wording (ATR-based stop) but the working tree was reverted to pristine before this pass; the roadmap was then rewritten to the range-low spec above. This entry reflects the final swing-low implementation.

**Item 1 — gates + swing-low stop.**
- `config.json`: `strategy.buy_score_threshold` 4.0→3.5, `buy_score_half_size_threshold` 3.0→2.5, new `downtrend_long_score_threshold` 4.0; `risk.max_open_positions` 3→4, `max_positions_per_tier` 2→3; new `risk.stop_loss_mode="swing_low_4h"`, `swing_low_lookback_bars=20`, `swing_low_buffer_pct=0.001`, `swing_low_max_stop_pct=0.08` (kept `stop_loss_pct=0.05` as fallback).
- `risk.py`: added `swing_low_stop_price(entry, lows_4h, …)` (lowest low of window ×(1−buffer), clamped to ≤max_stop_pct below entry; returns None when <5 bars or stop ≥ entry so caller falls back). `should_stop_out(entry, current, stop_price=None)` now takes an explicit stop price (falls back to fixed % when None). New consts `STOP_LOSS_MODE`, `SWING_LOW_*`. Updated docstring, self-checks (swing-low + clamp + correlation 4/4 & 3/3), prints. `rebalance.py` calls `should_stop_out(entry, cur)` with no stop_price → uses fixed-% fallback (no 4H bars there) — left unchanged, backward-compatible.
- `run_evaluation.py`: captures `decision["lows_4h"]` from the 4H fetch; hard-stop computes `swing_low_stop_price` and passes it to `should_stop_out`; new `DOWNTREND_LONG_SCORE`; long-entry block allows uptrend/mixed at ≥2.5 (half) / ≥3.5 (full) and a half-size counter-trend long in a downtrend at ≥4.0; updated docstring, downtrend message, startup print.
- Dashboard parity (`dashboard_professional.html`): added shared consts `SIGNAL_BUY_SCORE=3.5` / `SIGNAL_HALF_SCORE=2.5` / `SIGNAL_DOWNTREND_LONG_SCORE=4.0` + `swingLowStop4h()` helper (mirrors Python). Updated every signal-score display to the consts (renderScoreDist buckets/labels, Signals notification + scoreBar + actionPill + quick-buy gate, gap-scanner `signalScore` color, Market-Overview color, Scanner KPIs/labels/scoreBar/msActionPill, top-opps filter, watch button, `portActionChip`). Autopilot: thresholds 3.5/2.5, downtrend half-long ≥4, max 4/3, **4H swing-low exit** (fixed-% fallback), half-size sizing. Conviction (gap) score left untouched per the parity rule. Relabeled Command hard-rules stop row + Positions stop tooltips as 4H-swing-low reference. **`barsStart`/`barsEnd` gained `5Min`/`1Hour`** so the scalp window + in-progress-bar cutoff are correct.

**Item 2 — Scalping tab.** New nav button under ⚡ Trade (`switchTab('scalp')`, id `scalp`, in `TAB_ORDER`, no auto-run). Page `page-scalp`: TF selector (5/15/60-min), ▶ Scan, KPIs, shared score-distribution tile, and a table (score, pill, RSI, ATR, regime, Buy/Sell). `loadScalp()` maps the TF down a notch via `SCALP_TF_MAP` (5m→5m·1h·4h, 15m→15m·1h·4h, 1h→1h·4h·1D) and runs the **same `calcSignalScore`** on those bars; `scalpActionPill` reuses the shared gates; Buy/Sell open `openTradeModal`. Manual tickets only — no autonomous scalp loop.

**Verified:** `python scripts/risk.py` → all self-checks pass; `ast.parse` + guarded `import run_evaluation` OK; dashboard inline `<script>` → `new Function()` syntax check 0 errors. Footer v2026-06-19.1. Roadmap cleared.

**Known characteristic:** sizing still uses 1.5×ATR for the qty calc while the exit stop is the 4H range low — realized risk can differ from a strict 1% when the range low sits farther/closer than 1.5×ATR (bounded by the 8% clamp). Documented in CLAUDE.md.

### 2026-06-18 — Roadmap: last 3 Autopilot-log messages under the trading-status word (v2026-06-18.4)

Rescan roadmap. Bugs list empty; sole roadmap item: *"add the last 3 messages from the Autopilot log to the tradingstatus window/div."*

**Implementation (`docs/dashboard_professional.html`):**
- Added `#tradingStatusLog` directly under the big `#tradingStatus` permission word in the Command Center (centered, monospace 11px). Kept it a **separate sibling** because `renderCommand()` sets `$("tradingStatus").textContent`, which would wipe any child nodes.
- New `apRenderStatusLog()` renders the **last 3** entries from the Autopilot log (`apGetLog().slice(-3).reverse()`, newest-first) using the same `{t, [KIND], m}` formatting + colour map (`entry`/`exit`/`block`/`error`/`info`) as the full `#apLog`. Empty log → empty string (no clutter in the Connect-Alpaca state).
- Hooked it into `apRenderLog()` (one extra call at the end) so it stays in sync automatically: `apRenderLog()` already fires after every `apLog()` push **and** on autopilot init (line ~6745), so no other wiring was needed.

**Verified:** extracted the inline `<script>`s and validated each via `vm.Script` (`node`) → 2 scripts checked, 0 errors. Function declarations (`apRenderStatusLog`, `apGetLog`) are hoisted so the init-time `apRenderLog()` call resolves them. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-18.4.

### 2026-06-18 — Roadmap: latest 2 activities in the Command-center permission area (v2026-06-18.3)

Rescan roadmap. Bugs list empty; sole roadmap item: *"Show the latest 2 activities in the command center in the trade permissions area. Put it in the top left corner of the area."*

**Implementation (`docs/dashboard_professional.html`):**
- `loadContext()` already fetches the FILL activity feed (`/v2/account/activities?activity_type=FILL&page_size=100&sort=desc`, newest-first) but only used it for `computeFifoStats`. Added the raw `activities` array to the returned context object so renderers can reuse it (no extra API call).
- Added a `#recentActivities` block to the **🚦 Trading Permission Rules** panel, placed **above** `#permissionRules` (top-left of the panel), `text-align:left`.
- `renderCommand(c)` now renders a **Latest Activity** label + the latest 2 FILL activities (`c.activities.slice(0,2)`): time formatted GMT+2 via `Etc/GMT-2` (`MMM dd HH:mm`), colour-coded side (BUY green / SELL red), qty, `tvLink(toSlash(symbol))`, and `$price`. Empty feed shows "No recent activity."

**Verified:** extracted the inline `<script>`s and validated each via `vm.Script` (`node`) → 2 scripts checked, 0 errors. Confirmed helpers (`fmt`, `tvLink`, `toSlash`) and the `c` context param are in scope at the call site. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-18.3.

### 2026-06-18 — Bug (follow-up): scanner returns only 33 symbols while Max Symbols = 60 (v2026-06-18.2)

Rescan roadmap. User sharpened the bug after v2026-06-18.1: *"The market and signal scanner still only return 33 symbols while the setting is set higher for example 60."*

**Investigation:** After the v2026-06-18.1 fix (no longer caching the `TOP30_SYMBOLS` fallback), `getCryptoUniverse()` now correctly resolves Alpaca's full tradable-crypto list. The result is ~33 because **Alpaca only offers ~20–33 USD-quoted (`*/USD`) crypto pairs** — its other pairs (~56 total trading pairs) are quoted in USDT / USDC / BTC, which the dashboard deliberately drops (the entire bot — caps, positions, evaluation — is USD-only). Confirmed via Alpaca support docs (≈21–33 USD pairs vs 56 total). So 60 is unreachable with USD pairs; **this is a real exchange ceiling, not a code defect.** No local API credentials were available (`.env` absent, env vars unset), so the universe size couldn't be queried directly — relied on Alpaca's published pair list.

**Decision (asked the user):** chose **"Make the UI honest"** over broadening the universe to USDT/USDC pairs (which would surface signals the USD-only strategy can't act on).

**Fix (`docs/dashboard_professional.html`):**
- `updateScanBtnLabel()` now clamps the displayed count to `_cryptoUniverse.length` when known: shows `▶ Scan Top <universe> (all available)` when Max Symbols exceeds the universe, else `▶ Scan Top <min(n, universe)>`. Falls back to the raw `n` before the universe has loaded.
- Scanner (`loadMarketSignals`) final status appends, when `maxSyms > universe.length`: "Max Symbols (N) exceeds the M tradable USD pairs Alpaca offers — scanning all available".
- Market Overview (`loadMarketOverview`) status appends the analogous note.

**Verified:** extracted the single inline `<script>` and ran `node --check` → SYNTAX OK. `_cryptoUniverse`, `universe`, and `maxSyms` confirmed in scope at each edit site. Footer v2026-06-18.2. Bug cleared from `CLAUDE.md`.

### 2026-06-18 — Bug: fewer symbols scanned than the Max Symbols setting (v2026-06-18.1)

Rescan roadmap. Roadmap empty; sole open bug: *"There are less symbols scanned than in the max. symbols setting specified."*

**Root cause (`docs/dashboard_professional.html` › `getCryptoUniverse()`):** the function caches the tradable-crypto universe in `_cryptoUniverse` on first call (`if (_cryptoUniverse) return _cryptoUniverse`). The old code also cached the **`TOP30_SYMBOLS` fallback** whenever the `/v2/assets` call failed or returned nothing. `getCryptoUniverse()` first runs on page load via `loadSettings()` → `renderWatchlistTags()` → `populateWatchlistOptions()` — which can fire before credentials are seeded (or during a transient network hiccup). When that happened, the 30-symbol fallback was cached for the whole session, so every later Scanner / Market Overview scan computed `universe.slice(0, maxSyms)` against only 30 symbols. With Max Symbols set above 30 the scan silently returned fewer than requested — the reported bug.

**Fix:** only cache a **real, non-empty** assets result; on failure/empty, return the `TOP30_SYMBOLS` fallback **without** assigning it to `_cryptoUniverse`, so the next call retries and can pick up the full universe once credentials/network recover. The fallback path still populates `_universeRank` from the 30 symbols so any rendering in the meantime shows real ranks.

**Verified:** extracted the single inline `<script>` and ran `node --check` → SYNTAX OK. Confirmed `_cryptoUniverse` stays `null` on the fallback path (so retries happen) and is set only on a non-empty real result. Footer bumped to v2026-06-18.1. Bug cleared from `CLAUDE.md`.

### 2026-06-17 — Roadmap: Scanner score-distribution tile matches Signals page (v2026-06-17.22)

Rescan roadmap. Sole item: "Use the same score distribution tile in the Scanner tab as in the Signals page."

**Problem:** The two tabs rendered score distribution differently. The Signals tab (`#scoreDist`) showed a **bucketed horizontal-bar tile** (≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR, colour-coded, with count + bar). The Market → Scanner sub-tab (`#msScoreDist`) showed a **compact per-integer inline list** (`+4: 3  +3: 1 …`) keyed on exact integer scores — so it also mis-bucketed fractional scores like 3.5.

**Fix (`docs/dashboard_professional.html`):** Extracted the Signals tile rendering into a shared helper `renderScoreDist(elId, scores)` (defined just above `loadSignals`) containing the exact bucket logic + markup. Replaced the Signals inline block (≈28 lines) with `renderScoreDist("scoreDist", scores)` and the Scanner inline block with `renderScoreDist("msScoreDist", valid.map(r=>r.score).filter(s=>s!==null))`. Both tabs now render the identical tile, and the Scanner correctly handles fractional scores. No orphaned variables (old local `dist`/`total`/`distEl` removed with their blocks).

**Verified:** extracted the inline `<script>` and ran `node --check` → SYNTAX OK; confirmed `scores` (loadSignals) and `valid` (loadMarketSignals) are in scope at the call sites. Roadmap cleared. Footer v2026-06-17.22.

### 2026-06-17 — Roadmap: remove duplicate KPI + new 🧠 Behavioral Insights tab (v2026-06-17.21)

Implemented the two-item roadmap the user added to `CLAUDE.md` ("start roadmap"). Decisions taken via the question prompt: remove obvious duplicates at discretion; behavioral insights as a **new top-level nav tab**; rule-breaks computed **best-effort from trade history**.

**Item 1 — remove redundant/duplicate/low-impact metrics.** Audited every `kpi()` block. Removed the one clearly-misplaced visible duplicate: the **"Filled Orders" tile on the Performance tab** (labelled "Recent order sample" — an order-count metric that duplicates the Execution tab and doesn't belong in performance stats). Deliberately preserved the other apparent overlaps because they're legitimate: Current Drawdown / Open Risk appear on both Command (summary cockpit) and Risk (detail) — a standard summary-vs-detail pattern; Win Rate / Profit Factor on P&L vs Backtest are documented as **intentional parity** (`computeFifoStats()` so they can't diverge). The `positionKpis` "Open Risk" lives in the **defunct, null-guarded Positions render** (no longer mounted) so it's invisible — left untouched rather than editing dead code.

**Item 2 — 🧠 Behavioral Insights tab.** New top-level tab (`page-insights`, nav button in the **📊 Analysis** section, id `insights`, deep link `#insights`, added to `TAB_ORDER`; manual ▶ Analyze, no auto-run — same on-demand pattern as Edge/Markov). New JS (`loadInsights`, `insRoundTrips`, `insStmt`, `insGap`) placed right after `loadEdge`. `insRoundTrips()` is a dedicated FIFO matcher (kept separate from `computeFifoStats`/`edgeFifoTrades` to avoid touching the shared engines) that returns round-trips carrying `pnl`, entry `cost`, `pnlPct`, `entryT`, `exitT`, sorted chronologically by exit. Four insight cards + 3 KPI tiles:
- **🗓 Day-of-Week Edge** — per-weekday win rate + net P&L (GMT+2 exit time); flags the worst consistently-losing weekday ("You trade worse on Tuesdays").
- **📉 After Losing Streaks** — win-rate baseline vs after-1-loss vs after-2+-consecutive-losses; flags a ≥5pt drop ("win rate drops after 2 losses").
- **🔁 Cadence After Outcome** — median hours to the next entry after a win vs after a loss; flags shorter post-win gap ("overtrade after wins").
- **⚠ Rule Discipline** — best-effort rule-break detection: −5% hard-stop breaches (realized loss% < −5) + per-symbol cap breaches (entry cost > `portCapFor(sym)`% × *current* equity, labelled approximate). KPI "Rule Breaches" surfaces the count and same-day stop breaches.

**Verified:** extracted the inline `<script>` and ran `node --check` → SYNTAX OK; unit-tested `insRoundTrips` + streak/cadence/breach logic on synthetic fills (5 round-trips −6/−4/+2.1/+10/+1.8%): FIFO correct, baseline 3/4 vs after-2-loss 1/1, 1 stop breach (BTC −6%, ETH −4% correctly not flagged), cadence medians sane. `getSettings().apiKey` guard mirrors `loadEdge`. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-17.21.

### 2026-06-17 — Layout/style consistency sweep (v2026-06-17.20)

Request: "check the dashboard for any inconsistencies in layout and style" → "proceed". Reviewed the CSS + markup of `docs/dashboard_professional.html` and fixed seven defects:

1. **Undefined `--fg`** — `.footer-name` used `color:var(--fg)` (no such token; palette defines `--text`), so the footer project name silently fell back to muted grey. Changed to `var(--text)`.
2. **Invisible `.spinner`** — five portfolio loading states (`<span class="spinner">` in Portfolio Overview + Allocation) referenced a class that was never defined → empty span. Added a real spinner (`width/height:13px`, border ring, `border-top-color:var(--blue)`, `animation:spin .7s linear infinite`) plus `@keyframes spin`.
3. **Undefined `.error-box`** — the two portfolio error containers (`#portErrorBox`, `#portDistErrorBox`) used `class="error-box"` (undefined) → unstyled text. Switched both to the existing `.error` red box. JS still toggles `display`/`textContent`, so no JS change needed.
4. **Dead/duplicate `.score-pip`** — base `.score-pip` was defined twice; the `.on-pos/.on-neg/.on-half` variants were unused (renderer `portScoreBar` only emits `.on`). Removed the first base + the three dead variants; the still-used base (`.score-pip`/`.on`/`.neg`) remains.
5. **Hardcoded, non-theme-aware hover greys** — `.btn:hover`/`th:hover` used `#222b3a` and `th.port-sortable:hover` used `#21262d`; neither adapted to light theme (only `.btn`/inputs were overridden), so hovering a table header in light mode flashed dark, and the two sortable-header shades disagreed. Added a `--hover` token (`#222b3a` dark / `#e2e7ed` light) and pointed all three at it; removed the now-redundant light-theme `.btn:hover` override.
6. **`.period-btns` had no CSS** — Portfolio Overview's period-button wrapper was undefined while the Performance row used inline `display:flex;gap:6px`. Added `.period-btns { display:flex; gap:6px; flex-wrap:wrap; }`.
7. **Breakout-card symbol off-pattern** — the `gg-card` symbol was an inline-styled `<span>`, not a TradingView link (CLAUDE.md: every symbol label is a `tvLink()` anchor). Changed to `<span class="symbol" style="font-size:20px">${tvLink(a.symbol)}</span>`.

Left as intentional: `.subtab-btn` font-weight (600) is deliberately lighter than `.tab-btn` (850) for nav hierarchy.

**Verified:** grep confirms 0 remaining `var(--fg)`, `error-box`, `on-pos/on-half`, and only the `--hover` token definition retains the `#222b3a` literal. Footer bumped to v2026-06-17.20.

### 2026-06-17 — Memory consolidation: merged projects file into single `memory/memory.md`

Merged `memory/projects/alpaca-trading-agent.md` into `memory/memory.md` so the project has **one** memory file (request: "memory.md is the single memory file for the whole project"). The projects file was the comprehensive superset (metadata, architecture, schedule, full session history, dashboard reference, API/indicator notes); the old `memory.md` changelog was a near-duplicate subset. Folded in the one entry unique to the old changelog ("buttons/links not reacting" orphan-`else` syntax fix), fixed the architecture tree to show the single file, then copied the superset over `memory/memory.md` and deleted `memory/projects/` (`git rm`). Updated the three live path references in `CLAUDE.md` (roadmap note, standing rule, doc-update list) from `memory/projects/alpaca-trading-agent.md` → `memory/memory.md`. Historical references inside dated changelog entries and `data/market_research/` reports left intact as accurate records. Verified: 708-line merged file, projects folder gone, no stale live refs.

### 2026-06-17 — Roadmap: portfolio overview tiles horizontal (v2026-06-17.19)

Rescan roadmap. Sole item: "Align the tiles in the portfolio overview page horizontally instead of vertically."

**Problem:** The account-overview tiles use `<div class="cards">` as their container, but there was **no `.cards` CSS rule** anywhere in `dashboard_professional.html`. With no `display`, the wrapper was a plain block and the six `.card` children stacked vertically (one per row) on the Portfolio Overview tab (and the five summary cards on the Allocation tab).

**Fix (`docs/dashboard_professional.html`):** Added a responsive grid rule next to `.grid-2`/`.grid-3`: `.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }`. The tiles now flow horizontally and wrap responsively. Both `.cards` instances (Portfolio Overview "Account Overview" and Allocation "Portfolio Allocation" summaries) are fixed by the single rule.

**Verified:** `.cards` had zero prior CSS matches, so the new rule introduces no override conflict; only the two portfolio-tab containers use the class, both intended to be horizontal. Roadmap is now empty. Footer v2026-06-17.19.

### 2026-06-17 — Roadmap: ticker strip follows the active watchlist (v2026-06-17.18)

Rescan roadmap. Sole remaining item: "On the command center page, make sure that the tickers are showing symbols from the watchlist."

**Problem:** The top-of-page live ticker strip (`loadTickerStrip()`) used a hardcoded 10-symbol `WATCH = ["BTC/USD",…,"AAVE/USD"]` array — identical to the old default but ignoring whatever the user configured in the Settings watchlist. So adding/removing watchlist symbols never changed the ticker.

**Fix (`docs/dashboard_professional.html`):** `loadTickerStrip()` now calls `getWatchlist()` (the same source the Signals tab, Autopilot, and journal already use) and returns early on an empty list. To avoid a up-to-15 s lag after editing the watchlist, `saveWatchlistData()` now also calls `loadTickerStrip()` (guarded by `typeof … === "function"`) so the ticker re-renders immediately on every add/remove/reset. `loadTickerStrip` is best-effort and guards on missing API keys, so the call is safe during early init.

**Verified:** `getWatchlist()` is a hoisted function declaration available to `loadTickerStrip` regardless of source order; watchlist max is 20, well within the snapshots endpoint limit. Roadmap is now empty. Footer v2026-06-17.18.

### 2026-06-17 — Roadmap: Analytics parent tab (Performance+P&L+Edge), drop Positions; Bug: Signals duplication (v2026-06-17.17)

Rescan roadmap, all items confirmed. Bug fixed first (rule 0), then both roadmap items.

**Bug 1 — "Signals" appeared as both a top-level menu item and a Market sub-tab.** Renamed the Market tab's full-universe scanner sub-tab from **🔭 Signals → 🔭 Scanner** (button label + Overview cross-link "View matching signals →" → "View scanner →"). Sub-id stays `market-signals` and the `#market-signals` deep link is unchanged — non-destructive. Now "Signals" names only the watchlist tab (action/execute); "Scanner" is the universe confluence scan (+ watchlist add/remove). Both tools kept — they serve different workflows, so neither was removed.

**Roadmap 1 — merge Performance + P&L + Edge into one 🔬 Analytics tab.** Generalised the Market sub-tab machinery into a reusable system: CSS `.market-subnav`/`.market-subpage` renamed to `.subnav`/`.subpage` (shared); new generic `_activateSubTab(parentId, subId)` scopes the `.subpage`/`.subtab-btn` toggling to `#page-<parent>` so Market and Analytics never clash; button ids unified to `subtab-<subId>` (Market's `msubtab-*` renamed). `marketSubTab`/`analyticsSubTab` are thin wrappers over it. New `ANALYTICS_SUBS = ["performance","pnl","edge"]`, `_analyticsSub`. The three former top-level pages were physically relocated (via a Node div-depth-counting script) into a new `page-analytics` as `subpage-performance/pnl/edge`; nav shows one **🔬 Analytics** button in a renamed **📊 Analysis** section (with Backtest + Markov). `switchTab()` redirect + `applyTabFromUrl()` `SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)` keep `#performance`/`#pnl`/`#edge` deep links + keyboard working. Performance auto-loads (`refreshCurrent`→`loadDashboard`→`renderPerformance`); P&L on select (`loadPnl`); Edge manual.

**Roadmap 2 — drop standalone Positions.** Removed the `page-positions` block + its nav button (positions table already exists in Portfolio Overview). `renderPositions` is retained (still called by `loadDashboard` via the wrapper that caches `_lastPositions`/`_lastEquity` for the Risk concentration panel + positions CSV export), but its two DOM writes (`positionKpis`/`positionsBody`) are now null-guarded so they no-op with the page gone. The `exportCsv("positions")` branch is now unreachable (no button wired) but left in the still-used `exportCsv` function — harmless, no churn.

**Nav now:** 🧭 Command · ⚡ Trade [Signals · Market · Execution] · 💼 Portfolio [Overview · Allocation · Risk] · 📊 Analysis [🔬 Analytics · Backtest vs Live · Markov] · ⚙ Settings. Keyboard `TAB_ORDER` updated.

**Verified:** inline-script parse clean (0 errors); whole-document div-balanced (459/459); `subpage-performance/pnl/edge` nested inside `page-analytics`; no stale `page-positions`/`page-performance`/`page-pnl`/`page-edge` ids; no `.market-subpage`/`msubtab-` left; 11 nav buttons + 3 section labels; no dead `switchTab('positions'…)` links. Footer v2026-06-17.17.

### 2026-06-17 — Roadmap: regroup nav into Trade/Portfolio/Analytics + fold Breakout into Market tab (v2026-06-17.16)

Owner accepted the nav-IA advice and added it as a roadmap item. Implemented the two parts of the pasted target menu; the two leftover consolidation bullets (merge Performance+P&L+Edge; drop standalone Positions) stay on the roadmap pending sign-off since they change tab behavior/URLs.

**Nav regrouping (menu-only, no behavior change).** Reordered the sidebar `<nav>` and added two `.nav-section-label` headers so all tabs sit under labelled groups: **🧭 Command** (ungrouped, top) · **⚡ Trade** (Signals, Market, Execution) · **💼 Portfolio** (Overview [renamed from "Portfolio Overview"], Positions, Allocation, Risk) · **🔬 Analytics** (Performance, P&L, Backtest vs Live, Edge, Markov) · **⚙ Settings** (ungrouped, bottom, `margin-top:14px`). Act → Hold → Analyze flow. Kept Edge's 🔬 emoji (the pasted target showed 🧭, which collides with Command). No id/onclick changed, so `validTabIds()`/`tabBtnFor()`/routing are untouched. Updated the keyboard `TAB_ORDER` to the new visual order (keys 1-9).

**Breakout Scanner folded into the Market tab as a third sub-tab.** Moved the former standalone `page-gapgo` content into `page-market` as `subpage-gapgo` (class `market-subpage`), added a third sub-tab button `msubtab-gapgo` ("📊 Breakout") to `.market-subnav`, and removed the top-level Breakout nav button. New `const MARKET_SUBS = ["market-overview","market-signals","gapgo"]` is the single source of truth: `marketSubTab()` validates against it, `applyTabFromUrl()` uses `SUBS = MARKET_SUBS`, and `switchTab()` gained a guard at the top that redirects any of the three sub-ids to the parent (`market`) + sub-tab — so keyboard shortcuts, the `#gapgo` deep link, and any legacy `switchTab('gapgo')` keep working. Removed the now-dead `else if (id === "gapgo")` branch. Breakout stays manual (▶ Run Analysis); added a "← Back to market context" cross-link in its toolbar. The sub-tab buttons were also shortened to "Overview / Signals / Breakout" (the parent is already "Market").

**Verified:** inline-script parse clean (`new Function`, 0 errors); `page-market` div-balanced (33/33) with all three sub-pages; nav has 14 tab buttons + 3 section labels; no stale `page-gapgo`/`switchTab('gapgo')` page refs remain (only the moved markup + `loadGapGo` internals + the intentional redirect comment). Footer v2026-06-17.16.

### 2026-06-17 — Roadmap: merge Market Overview+Signals into one tabbed page + Market Signals watchlist buttons (v2026-06-17.15)

Rescan roadmap → implemented the two well-specified items. The third ("add applied Indicators in the left pane to the top pane") was **dropped per the owner** — it belonged to a separate charting project, not this dashboard (which has no chart/indicator pane). Roadmap now empty.

**Roadmap 2 — single tabbed parent for Market Overview + Market Signals.** Replaced the two sidebar nav buttons with one **🌐 Market** button (`switchTab('market')` → `page-market`). The two former pages are now `.market-subpage` divs (`subpage-market-overview`, `subpage-market-signals`) inside `page-market`, switched by a sub-tab bar (`.market-subnav` / `.subtab-btn`) via new `marketSubTab(subId)`. `marketSubTab` toggles the sub-pages + sub-tab buttons, writes the precise sub-tab id to the URL hash and `localStorage.lastTab` (so old deep links `#market-overview` / `#market-signals` still resolve), lazy-loads Overview (manual Signals), and stores `_marketSub` so `switchTab('market')` restores the last sub-tab. `applyTabFromUrl()` gained a `SUBS` list that recognises the two sub-ids from hash or stored value and opens the parent + sub-tab (sets `_marketSub` first to avoid a wasted Overview load when deep-linking to Signals). Cross-links added: Overview header "View matching signals →" and Signals header "← Back to market context". CSS: `.market-subnav`, `.subtab-btn`(+`.active`), `.market-subpage`(+`.active`). Selection state persists because both sub-pages keep their DOM.

**Roadmap 1 — per-symbol watchlist Add/Remove on Market Signals.** Added a **Watchlist** column (header + colspans 13→14, error-row inner colspan 10→11). `msWatchlistCell(row)`: **+ Watch** when score ≥ 4 and symbol not on watchlist; **– Unwatch** when score ≤ −2 (sell) and no open position; else "✓ watched" / "–" (and "full" at the 20-symbol cap). `loadMarketSignals()` now fetches `/v2/positions` into `_msOpenPosSyms` (normalised to `BASE/USD`) to gate the remove button, and caches `_msLastRows`. Buttons → `msAddWatch`/`msRemoveWatch`, which mutate the shared watchlist (`saveWatchlistData` + `renderWatchlistTags`) and re-render only the watchlist cells (`renderMsWatchlistCells()`, cells keyed `mswl-<alpSym>`) — no rescan. Reuses existing `trade-action-btn`/`trade-close-btn` styles.

**Verified:** inline-script parse clean (`new Function` over the extracted script block, 0 errors); `page-market` segment div-balanced (24 open / 24 close) with both sub-pages + sub-nav present; column counts reconciled (14 data tds = 14 headers; error row 3 + 11). Footer bumped to v2026-06-17.15. Roadmap items 1 & 2 cleared from CLAUDE.md; item 3 flagged for clarification.

### 2026-06-17 — Bugs: exclude stablecoins from scans + fix false "Over Cap" badge (v2026-06-17.14)

New workflow rule 8 added to CLAUDE.md: a "rescan roadmap" request must **implement** the roadmap items and **fix** the listed bugs, not just report status.

**Bug 1 — stablecoins in symbol scans.** `getCryptoUniverse()` kept every `*/USD` pair, so `USDT/USD`, `USDC/USD`, etc. (stablecoins priced in dollars — never tradeable setups) appeared in Market Signals, Market Overview, and the Settings watchlist dropdown. Fix: added a `STABLECOIN_BASES` set (USDT, USDC, DAI, USDP, PYUSD, TUSD, BUSD, GUSD, USDG, FDUSD, USDD, FRAX, LUSD, USTC) and skip any pair whose base is in it (`STABLECOIN_BASES[sym.slice(0,-4)]`). Fixed at the source, so every consumer of `getCryptoUniverse()` is covered.

**Bug 2 — false "Over Cap" badge at exactly 100%.** In the Allocation tab's cap-utilisation table, `utilPct` was clamped with `Math.min(...,100)` for the text while `isOver = curPct > capPct` used the raw value. A position fractionally over cap (e.g. 100.3%) displayed "100% of cap used" yet showed "⚠ Over Cap" — a visible contradiction. Fix: `utilPct` is now the true un-clamped utilisation, `isOver = Math.round(utilPct) > 100`, and the progress-bar width is clamped separately (`Math.min(utilPct,100)`). The badge now always agrees with the displayed "% of cap used": at-cap → Near Cap, only >100% rounded → Over Cap.

**Verified:** Bug 1 — base-slice logic handles both `USDT/USD` and bare `USDCUSD` (normalized first). Bug 2 — walked the boundary cases: 100.4% → round 100 → Near Cap / "100% of cap used"; 100.6% → round 101 → Over Cap / "101% of cap used". Footer v2026-06-17.14. Both items moved out of CLAUDE.md's Roadmap/Bugs lists.

### 2026-06-17 — Roadmap: single-line responsive footer + delete legacy portfolio-dashboard.html (v2026-06-17.13)

**Roadmap — footer on a single line depending on window size.** The footer was two stacked `.footer-row` divs (the `<footer>` was `flex-direction:column`). Flattened to a single `<footer>` flex row with `flex-wrap:wrap; align-items:baseline; gap:4px 14px` — all items (name · description · creator · last modified · version) sit on one line on wide windows and wrap naturally as the window narrows. Removed the now-unused `.footer-row` CSS rule and its mobile override; kept the `@media(max-width:700px)` footer padding tweak. Footer bumped to v2026-06-17.13.

**Deleted `docs/portfolio-dashboard.html`.** The legacy standalone dashboard (its tabs were merged into the Professional Dashboard on 2026-06-15) was removed at the user's request. Updated all current-state references (CLAUDE.md, README.md, this file's architecture tree, dashboard_layout.md) to note the deletion; historical changelog entries describing the original merge are left intact as the record.

**Verified:** Footer change is CSS + markup only, all required footer fields (description, creator, last-modified, version) retained. Surgical reference cleanup; no code logic touched.

### 2026-06-17 — Roadmap: Market Overview Buy/Sell buttons + Settings watchlist exchange dropdown (v2026-06-17.12)

Cleared the two open roadmap items (both completed; roadmap now empty).

**Roadmap 2 — Buy/Sell buttons on Market Overview rows.** Added a **Trade** column to the Market Overview table (header + all `colspan` placeholders bumped 9 → 10). New helper `moTradeButtons(row)` renders **Buy** / **Sell** buttons that call the existing shared `openTradeModal(orderSym, displaySym, side, '', price)` — order symbol in Alpaca `BTCUSD` format, qty left blank for the user to size, side + live price pre-filled. Shows `–` when the row has no live price. Reuses the same `trade-action-btn` / `trade-close-btn` classes as the Signals and Positions tabs, so no new modal/submit logic was needed.

**Roadmap 1 — Settings watchlist add via exchange dropdown.** Replaced the free-text `#watchlistAddInput` with an `<input list="watchlistSymbolOptions">` + `<datalist>` populated from the full tradable Alpaca crypto universe via new `populateWatchlistOptions()` → `getCryptoUniverse()`. User can pick from the exchange list or type to filter; already-added symbols are excluded. Called from `renderWatchlistTags()` so the dropdown re-syncs after add/remove/reset. Degrades gracefully to plain free-text entry if the assets call fails — the existing `addWatchlistSymbol()` still normalizes input to `BASE/USD`, so add/cap(20)/dedupe logic is untouched.

**Verified:** Surgical edits — header/colspan, one render-cell call, two new helper functions, one markup swap. Both features reuse existing, already-tested code paths (`openTradeModal`, `getCryptoUniverse`, `addWatchlistSymbol`). Footer bumped to v2026-06-17.12 / Last modified 2026-06-17.

### 2026-06-15 — Bug fix: Signals tab ignored Settings watchlist (v2026-06-15.11)

**Problem:** `loadSignals()` hardcoded `const SYMBOLS = ["BTC/USD",...]` — the 10 default symbols. Adding or removing symbols in the Settings watchlist had no effect on the Signals tab scan.  
**Fix:** Replaced the hardcoded array with `getWatchlist()` so the Signals tab now dynamically reads whatever symbols the user configured.  
**Verified:** Code change is surgical — one line. `SYMBOLS` is used throughout the function (bar fetches, correlation matrix, row iteration) so using `getWatchlist()` propagates correctly everywhere.

### 2026-06-15 — Bug fix: Total P&L in Performance tab (v2026-06-15.10)

**Problem:** After v2026-06-15.9, "Total P&L" pointed at `acct.unrealized_pl` (open-position paper gains) — still not matching the P&L tab which shows `fifoStats.totalPnl` (FIFO-realized P&L from FILL activities).  
**Fix:** Changed to `c.fifoStats.totalPnl` which is already computed in `loadContext()` via `computeFifoStats()` over the same 100-fill sample. Both tabs now use the same number.

### 2026-06-15 — Bug fix: Total P&L in Performance tab (v2026-06-15.9)

**Problem:** "Total P&L" in the Performance tab used equity-history subtraction (`equitySeries[last] - equitySeries[0]`), which measures equity change over the loaded 3-month window — different from Portfolio Overview's "Unrealized P&L" card which reads `acct.unrealized_pl`.  
**Fix:** Replaced `totalReturnCurrency` with `totalPL = parseFloat(c.acct.unrealized_pl ?? 0)`. The tooltip now says "Unrealized P&L — matches Portfolio Overview". Both tabs now display the same number from the same API field.

### 2026-06-15 — Bug fixes + Roadmap: score distribution, applySort, Total P&L (v2026-06-15.8)

**Bug fix — Score distribution (Signals tab):** Distribution bucket `else if (s <= 2)` sent score 2.5 to the BUY category. Fixed to `else if (s < 3)`. Labels updated to "0.5–2.9 (HOLD)" and "−2.9–0 (HOLD)". Dict key renamed from `1to2` → `1to3`. Version v2026-06-15.7.

**Bug fix — `applySort` / `numOrStr` not defined:** `portRenderPositions()` called `applySort()` (undefined), and the sort helpers in `portRenderDistTable` / `portRenderDistCap` called `numOrStr()` (also undefined). Added both as shared sort helpers before `portRenderPositions`: `numOrStr(v)` = `parseFloat(v)` if numeric else `String(v).toLowerCase()`; `applySort(arr, key, dir)` = shallow-copy sort via `numOrStr`. Portfolio Overview positions table now sorts correctly.

**Roadmap — Total P&L in currency (Performance tab):** `renderPerformance()` now computes `totalReturnCurrency = equitySeries[last] − equitySeries[0]` and adds (a) a **Total P&L** KPI tile (first in the `grid-3`) formatted as `+$X.XX` / `-$X.XX` with pos/neg colour, and (b) a "Total P&L ($)" row as the first entry in the Performance Summary table. Version v2026-06-15.8.

### 2026-06-15 — Roadmap 1–2 + Bugs 1–2 (v2026-06-15.6)

Four items completed in `docs/dashboard_professional.html`:

**Roadmap 1 — Remove "Watchlist — No Position":** Deleted the `<section>` with `portNoPosBody`, removed `portRenderWatchlistNoPos()` function and its 2 call sites in `portRenderPositions()`, removed the watchlist snapshot fetch block from `portLoadPositions()`, and removed `portWlSnaps` declaration.

**Roadmap 2 — Sort Signals tab descending by score:** Added `rows.sort((a, b) => ...)` before `signalBody.innerHTML` assignment in `loadSignals()`.

**Bug 1 — Market Overview Score column:** Two fixes: (a) `loadSignals()` now calls `Object.assign(_msPrevScores, newMap)` after saving `_prevScoreMap`; (b) Market Signals scan now calls `moApplySort()` if `_moData.length > 0` after updating `_msPrevScores`. Score column now populates from either Signals or Market Signals scans.

**Bug 2 — Score inconsistency in Breakout Scanner:** `loadGapGo()` now fetches 15-min and 4H bars via `fetchBars()` in the same `Promise.all`. Per symbol: maps bars to `{c,h,l,v}` and calls `calcSignalScore()`. Result attached as `ggA.signalScore`. In `ggRenderCards()`, added `ssColor`/`ssText` variables and rendered a **Signal /6** badge next to the existing Conviction score in each card header. Legend updated to clarify both metrics. Now consistent with Signals and Market Signals tabs.

### 2026-06-15 — Roadmap items 1–5: favicon, title, remove Orders/HotSymbols/MorningBrief

Applied all 5 remaining roadmap items to `docs/dashboard_professional.html` via a Python script (to avoid encoding corruption from PowerShell):
1. **Favicon** — Inline SVG candlestick chart (`data:image/svg+xml`), 3 candles on dark background. Added to `<head>` alongside updated `<title>`.
2. **Title** — Changed from "Professional Trader Dashboard" to "CryptoPro Dashboard".
3. **Remove Orders pane** — Deleted the `<!-- Orders -->` `<section>` from `page-port-overview`; removed `portFilterOrders`, `portSortOrd`, `portLoadOrders` JS; removed `portLoadOrders()` from `portLoadOverview`'s `Promise.all`; removed `portAllOrders`, `portOrdSort`, `PORT_STATUS_GROUPS` declarations.
4. **Remove Hot Symbols tab** — Deleted nav button, `page-port-hot` HTML, all Hot Symbols JS (`portWlCard`, `portSortHot`, `portRenderHot`, `portLoadCryptoWatchlist`, `portLoadHot`), and related vars (`portRawHotRows`, `portHotSort`).
5. **Remove Morning Brief** — Deleted nav button, header button, `page-port-brief` HTML, `#briefDocBackdrop` modal, and all Brief JS (`portLoadBrief`, `portSortBriefPos`, `portRenderBriefPos`, `portSortConf`, `portRenderConf`, `generateMorningBrief`, `closeBriefDoc`, `downloadBriefDoc`, `copyBriefDoc`); removed vars (`port_briefEquity`, `portRawBriefPos`, `portRawConfRows`, `portBriefPosSort`, `portConfSort`); fixed `switchTab`, `refreshCurrent`, `setInterval`, `setSortIcons` init calls.
Version: v2026-06-15.5. File: 7395 lines (down from 8070).

### 2026-06-15 — Bug fix: buttons/links not reacting on dashboard

**Problem:** After the drawdown-rule removal commit (c505713), a dangling `else` was left at the top level of `renderCommand()` — removing `if/else if (drawdown ≥ max/warn)` left its trailing `else add("Drawdown OK",...)` behind. An orphan `else` (no matching `if`) is a JavaScript **syntax error** that prevented the entire script block from being parsed, so no function declarations were hoisted and ALL onclick handlers (`switchTab`, `saveSettings`, etc.) were undefined — the "nothing reacts" symptom. Additionally `setSortIcons()` (present in the original `portfolio-dashboard.html`) was accidentally omitted during the portfolio merge, causing a `ReferenceError` that prevented the Port init block from completing.
**Fix 1:** Removed the orphan `else add("green", "Drawdown OK", ...)` line from `renderCommand()` (~line 3039).
**Fix 2:** Added `setSortIcons(headId, activeKey, dir)` before the Port init calls (uses the `port-sorted` CSS class).
**Verified:** if/else chain for daily-loss and open-risk checks is now valid; `setSortIcons` defined before its first call.

### 2026-06-15 — All 3 roadmap items completed

Three roadmap items completed in one session (items tackled in order: 2, 3, 1):

**Item 2: Merge portfolio-dashboard.html into dashboard_professional.html**
Roadmap item #2: merged `docs/portfolio-dashboard.html` into `docs/dashboard_professional.html` as four new nav tabs under a "💼 Portfolio" section label. Changes made surgically via Edit tool — no full rewrite.

**What was added:**
1. **CSS block** — All portfolio-specific CSS classes (`port-filter-btn`, `hot-stat`, `bar-track/fill`, `wl-card`, `port-period-btn`, `port-status-badge`, `health-*`, `alerts-box`, `conf-table`, `score-bar-pips`, `chip-*`, `pos-health-wrap`, `progress-bar`, `brief-*`, `sort-icon`, `port-sortable/sorted`) added before `</style>`.
2. **Header button** — `🌅 Morning Brief` button added next to `📓 Daily Journal` in the header, calls `generateMorningBrief()`.
3. **Nav section** — Four new tab buttons under a `💼 Portfolio` section label inserted before Settings: Portfolio Overview, Hot Symbols, Allocation, Morning Brief.
4. **Four portfolio pages** — `page-port-overview`, `page-port-hot`, `page-port-brief` (inline `<style>` dropped, CSS moved to global block), `page-port-dist` inserted before `page-settings`. All element IDs prefixed with `port`, all onclick handlers prefixed with `port`, `sortable/sorted/filter-btn` CSS classes prefixed with `port-`, `period-btn` class renamed to `port-period-btn`.
5. **Morning Brief modal** — `#briefDocBackdrop` inserted after the Daily Journal modal.
6. **Portfolio JavaScript block** — ~700 lines of portfolio JS (all functions prefixed `port*`): `portCapFor()` using existing `PORTFOLIO_CAPS`, account/chart/positions/orders loader, hot symbols, TA engine (standalone `portEmaSeries/portComputeRSI/portComputeMACD/portComputeBB/portVolumeRatio/portConfluenceScore`), brief loader, dist loader, morning brief doc generator (`generateMorningBrief`, `closeBriefDoc`, `downloadBriefDoc`, `copyBriefDoc`), 60-second auto-refresh interval for portfolio tabs.
7. **`switchTab` extension** — Added `port-overview/port-hot/port-dist/port-brief` branches.
8. **`refreshCurrent` extension** — Added same four branches so ⟳ Refresh works on portfolio tabs.

**Key design decisions:** `portCapFor(sym)` returns `PORTFOLIO_CAPS[sym] || 5` (percentage, not decimal) matching the pro dashboard's existing cap table. The portfolio's standalone TA functions do not conflict with the pro dashboard's `calcSignalScore` — they are prefixed and independent. The inline `<style>` block from `page-brief` was dropped and its CSS moved to the global `<style>` tag to avoid duplication.

**Verification:** All 23 key identifiers confirmed present (page IDs, function names, CSS classes, modal ID). Final file: 7971 lines.

**Footer redesign (Workflow rule 6)**
Replaced the single-line footer in `docs/dashboard_professional.html` with a two-row structured footer: row 1 = project name "CryptoPro Dashboard" + description; row 2 = Creator, Last modified date, Version (v2026-06-15.4). CSS: `.footer-row` flex wrap with mobile fallback. Roadmap cleared.

**Item 3: Remove 6% drawdown hard rule**
Removed the "current drawdown ≤ 6%, STOP trading" rule from `dashboard_professional.html`. Four locations cleaned: `DEFAULT_LIMITS` (removed `maxCurrentDrawdownPct`/`warningCurrentDrawdownPct`), the live hard-rules panel (removed the drawdown row), the permission-rules check, and the alerts block. The drawdown metric still renders on the Risk tab — only the trading halt was removed. Footer updated to v2026-06-15.2.

**Item 1: Watchlist management in Settings tab**
Added a `📋 Active Watchlist` section to the Settings tab: a tag editor (`#watchlistTagsEl`) showing up to 20 symbols as removable pills, an Add input field, and a Reset-to-defaults link. Storage key: `localStorage.proDashboardWatchlist`. New JS: `DEFAULT_WATCHLIST`, `getWatchlist()`, `saveWatchlistData()`, `renderWatchlistTags()`, `addWatchlistSymbol()`, `removeWatchlistSymbol(idx)`, `resetWatchlist()`. All three previous hardcoded arrays replaced: `JOURNAL_WL` → `getWatchlist()`, `AP_WATCHLIST` → `getApWatchlist()`, `PORT_CRYPTO_WL` → `getPortCryptoWL()`. `loadSettingsForm()` calls `renderWatchlistTags()`. Footer updated to v2026-06-15.3. CSS added: `.wl-tag-editor`, `.wl-sym-tag`, `.wl-sym-tag-x`.

### 2026-06-11 — Pro-trader review: scout, stop-clamp, shorts off, dashboard Autopilot + Edge
Professional-trader review of dashboard + project (focus: max profit, autonomy). Key context: account 100% cash ($95.4k), all 10 watchlist majors in confirmed downtrend (corr ~0.81), and Alpaca spot crypto **cannot be shorted** (every SHORT ever attempted was rejected; none filled). Five changes:
1. **Stop-loss self-rejection fix** — `trade.py` clamps a stale stop-loss limit to the nearest 0.5%-band edge of the fresh ask instead of rejecting (journals showed repeated AVAX/LINK stop rejections leaving positions exposed a full cycle). Tests in `tests/test_trade_stop_clamp.py`.
2. **Universe scout** — new `scripts/scout.py` + `config.json › scout` block: scans tradable non-watchlist `*/USD` pairs, daily-uptrend filter, full confluence, promotes top 3 (score ≥ 4) to `data/watchlist_dynamic.json` (atomic, TTL 6 h); merged in `run_evaluation.main()`. All existing gates apply (5% default cap, Tier-2 budget). Live test: scanned 26, promoted 0 (broad downtrend — correct). Tests in `tests/test_scout.py`.
3. **Shorts disabled** — `strategy.shorts_enabled=false` gates the SHORT entry branch in `run_evaluation.py` (venue unsupported); cover logic retained; HOLD reason now says "shorts disabled (venue unsupported)".
4. **Dashboard Autopilot panel (Command tab)** — autonomous in-browser loop, OFF-on-load, kill switch, all hard-rule gates, trailing HWM + activity log in localStorage.
5. **Dashboard Edge tab + short-UI removal** — FIFO realized-edge analytics; ⚡ Short buttons removed, SHORT pills → BEAR (informational).
Suite: 84/84 (3 new clamp + 3 new scout tests). Dry-run evaluation verified end-to-end on fresh data. NOTE: streaming file-tool edits on the mounted repo can truncate files (sync race) — all edits done via bash `python3` string-replace with asserts + `py_compile`/`node --check` verification; trade.py and run_evaluation.py were each restored from `git show HEAD` once.

### 2026-06-11 — Fix critical stale-bars bug in get_crypto_bars (sort=desc)
First market-researcher run (reports in `data/market_research/2026-06-11-1023-*.md`, both FAIL) found the live evaluation path was trading on stale data: `get_crypto_bars()` passed `start` (1.6× buffer) + `limit=N` without `sort`, and Alpaca returns ascending by default → the *first* N bars of the window. Daily bars ended 2026-04-18 (54 d stale), 4H 2026-05-17, 15-min ~30 h stale. Consequence: daily regime read "uptrend" from April data while all 10 watchlist symbols were in confirmed downtrend — longs permitted in mark-down, shorts blocked. Fix in `scripts/run_evaluation.py`: add `"sort": "desc"` to params and return `bars[::-1]` (chronological for indicators). `rebalance.py` delegated already; `research.py` had its own bare-`limit` `get_bars()` (found by the post-fix verification run) and now delegates its crypto path to `run_evaluation.get_crypto_bars` too — one fetcher for all Python paths; dashboard already paginated correctly. Verified live: 15-min/4H/daily last bars now current. Added `tests/test_bars_fetch.py` (3 regression tests, mocked api_get); suite 78/78 green. Note: during editing the mounted file was once truncated mid-write by a sync race — restored from `git show HEAD` and re-applied; verify `python -m py_compile` after edits in Cowork sessions. Updated CLAUDE.md (parity table + consistency check #11), README.md (API notes), glossary.

### 2026-06-11 — Add market-researcher subagent
Created `.claude/agents/market-researcher.md`: an analysis-only "research desk" subagent (professional crypto spot trader persona). Mission 1: verify strategy assumptions/risk/profitability vs. current Alpaca spot-market conditions. Mission 2: verify the project after every strategy change (rule consistency across CLAUDE.md/README/config/indicators.py/risk.py/dashboard, hard-rule soundness, walk-forward evidence, pytest run). Logs every run as a timestamped Markdown report in the new `data/market_research/` folder (GMT+2; `-market.md` / `-project-verification.md` suffixes; Scope/Findings/Verdict/Recommendations/Data sources structure). Hard limits: never trades, never mutates account state, never edits strategy code. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Fix correlation matrix left whitespace
The Live Correlation Matrix rendered with a large blank area on its left (matrix shoved right). Root cause: the global `table { min-width:760px }` rule forced the corr table to 760px, and since the data cells are fixed 28px but the row-label column had no fixed width, that label column stretched to absorb the slack, pushing the whole grid right. Fix: `.corr-wrap table` now sets `min-width:0; width:auto` (same pattern as the `.mk-matrix` override) so the table sizes to its content and aligns left. Pure CSS, no logic change. Updated CLAUDE.md, README.md, dashboard_layout.md.

### 2026-06-07 — Risk tab: move Live Correlation Matrix to the left column
Per user request, swapped the two panels in the "Portfolio Concentration & Correlation Risk" `grid-2` on the Risk page of `dashboard_professional.html` so the 🔗 Live Correlation Matrix is now the **left** column and 📊 Effective Exposure the right (previously reversed). Pure markup reorder; no logic change. Updated CLAUDE.md, README.md, dashboard_layout.md (no new glossary terms).

### 2026-06-07 — Add docs/dashboard_layout.md to the doc-update rule; rewrite it
Per user request, `docs/dashboard_layout.md` is now part of the project documentation-update rule (it was previously a standalone, stale design-notes file). Updated the rule in **both** places in `CLAUDE.md` (the top "Standing rule" and the bottom "Documentation update rule" — now "all five"), the `feedback_doc_updates.md` memory + its `MEMORY.md` index hook, and the README file-tree comment. Rewrote `dashboard_layout.md` itself: it was badly out of date (wrong file names, pre-sidebar nav, only 10 tabs, no Market Overview/Signals/Markov). Now structured as two clear sections — **1. Professional Dashboard** (`dashboard_professional.html`, 13 tabs, sidebar nav, hash routing, shared `getCryptoUniverse()`/`symbolInfo()`, Daily Journal) and **2. Portfolio Dashboard** (`portfolio-dashboard.html`, 5 tabs: Overview/Hot Symbols/Allocation/Morning Brief/Settings, Morning Brief generator) — each with tabs table, key features, and a dated changelog. Kept the Design Philosophy and Original Design Reference. Going forward, dashboard changes must add a changelog entry to the matching section here. Updated CLAUDE.md, README.md, glossary, MEMORY.md.

### 2026-06-07 — Give every symbol a real rank number (no more #?)
Symbols outside the curated `TOP30_INFO` were rendering rank `#?` (and `99` for sorting) on Market Overview / Market Signals. Added `_universeRank` (sym → 1-based position in the ordered universe), populated by `rebuildUniverseRank()` which is called at the end of `getCryptoUniverse()` (covers both the success and fallback branches). New shared helper `symbolInfo(sym)`: returns `TOP30_INFO[sym]` when known, else `{ rank: _universeRank[sym] || 99, tier:"?", capLabel:"?", name: sym without /USD }`. Replaced all four inline `TOP30_INFO[…] || {…}` fallbacks (`renderMoTable`, `loadMarketOverview` rows map, Market Signals row render, and the Top Opportunities panel) with `symbolInfo(…)`. Because the universe is ordered (still-tradable TOP30 by rank first, then the rest alphabetically), ranks are now contiguous: 1–30 match the curated cap ranks, 31+ follow universe position. Sort-by-rank works for all rows. Validated via `new Function` parse (0 errors); only the `symbolInfo` definition still references `TOP30_INFO`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Remove 30-symbol cap on BOTH Market Signals and Market Overview (real fix)
The prior session wired Market Signals to `getCryptoUniverse()` but the user still saw a 30 cap on both pages. Deep search found two remaining causes: (1) **Market Overview was never converted** — `loadMarketOverview()` still hardcoded `TOP30_SYMBOLS` for its snapshots/bars fetch and `rows` map; (2) **`getCryptoUniverse()` was fragile** — its filter `a.symbol.endsWith("/USD")` silently dropped everything and fell back to the 30 if Alpaca returned bare `BTCUSD` symbols. Fixes: (a) hardened `getCryptoUniverse()` to normalize both `BTC/USD` and bare `BTCUSD` → `BASE/USD`, drop non-USD quotes (USDT/USDC/BTC), de-dupe, and only fall back when truly empty; (b) `loadMarketOverview()` now does `universe = await getCryptoUniverse(); MO_SYMBOLS = universe.slice(0, maxSyms)` using the same `maxSignalSymbols` setting, and all three references (placeholder text, the `Promise.all` fetches, the `rows` map) use `MO_SYMBOLS`; (c) header label changed `🌍 Market Overview — Top 30 Crypto` → `🌍 Market Overview — Crypto` with a tooltip pointing at the Max Symbols setting. Both pages now scan/show up to the entered Max Symbols, capped only by the tradable universe. Validated via `new Function` parse (0 errors) and confirmed both pages call `getCryptoUniverse()`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Market Signals: remove 30-symbol scan ceiling, honour Max Symbols fully
The Max Symbols setting (`maxSignalSymbols`) was already uncapped on entry (`Math.max(1, …)`, no `max` attr), but the scan was still limited to 30 because the universe was the hardcoded 30-element `TOP30_SYMBOLS` and `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, n)` can't exceed the array length. Added `getCryptoUniverse()` (near `loadMarketSignals` in dashboard_professional.html): fetches `/v2/assets?asset_class=crypto&status=active` via the existing `apiFetch`, filters to tradable `…/USD` pairs, orders them as still-tradable `TOP30_SYMBOLS` first then the rest alphabetically, caches the result in `_cryptoUniverse`, and falls back to `TOP30_SYMBOLS` on any error. `loadMarketSignals()` now does `const universe = await getCryptoUniverse(); SCAN_SYMBOLS = universe.slice(0, maxSyms)`. So a Max Symbols value above 30 genuinely scans more than 30 symbols, capped only by how many USD pairs the account can trade. Symbols outside `TOP30_INFO` already render gracefully (rank `?`). Market Overview tab still uses the static 30 — unchanged. Validated via `new Function` parse (0 errors). Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Dashboard: tab deep-linking + last-tab restore on refresh
Added hash-based routing to `dashboard_professional.html`. `switchTab()` now writes the active tab id to the URL hash (`history.replaceState(null,"","#"+id)`) and to `localStorage.lastTab`. New helpers near `openSettings`: `tabBtnFor(id)`, `validTabIds()` (derives valid ids from the nav buttons' `switchTab('<id>',…)` onclick, so it never drifts as tabs change), and `applyTabFromUrl()` which resolves the target tab from the URL hash first, then `localStorage.lastTab`, and activates it (no-op if it's already active). A `hashchange` listener calls `applyTabFromUrl` so editing the `#tab` anchor or following a deep link switches tabs live. `applyTabFromUrl()` is called at the end of the `bootstrapDashboard()` IIFE (after initial render, in both the configured and not-configured branches) so a refresh or a `…/dashboard_professional.html#signals` link lands on the right tab instead of always Command. The switchTab loader dispatch already runs after the active-class swap, so even if a loader throws without credentials the tab still visually switches. Validated by parsing the script block via `new Function` (0 errors). Updated CLAUDE.md, README.md, glossary.

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

## Dashboard (`dashboard_professional.html`) — current as of v2026-06-15.6

**15 tabs** in a **left sidebar nav** (210px sticky column; collapses to horizontal scroll bar on mobile ≤700px). Tab routing via URL hash + `localStorage.lastTab`.

| Tab | ID | Key feature |
|-----|----|-------------|
| 🧭 Command | `command` | Live hard-rules panel (6 checks), cash reserve gate, trade modal, 🤖 Autopilot toggle + kill switch |
| 📈 Performance | `performance` | Equity curve, rolling Sharpe, win rate, profit factor |
| ⚠ Risk | `risk` | MDD, Sharpe, Sortino, cap usage, 10×10 Pearson correlation heatmap |
| 📂 Positions | `positions` | P&L%, Stop $, Target $, Live R:R, short-aware badges + cover button |
| 🎯 Execution | `execution` | Orders table, cancel-all, ATR Position Sizer |
| 📡 Signals | `signals` | 6-point confluence scanner (watchlist 10 symbols), sorted descending by score, trend arrows, ATR qty, ⚡ quick-buy, ▶ execute |
| 💰 P&L | `pnl` | FIFO realized P&L, calendar heatmap, attribution by symbol, day-of-week perf |
| 🧪 Backtest vs Live | `backtest` | Live FIFO metrics vs saved expected metrics (Sharpe, max DD, win rate, PF, avg daily return) |
| 📊 Breakout Scanner | `gapgo` | Pre-session gap/breakout analysis per watchlist symbol. Card header shows **Conviction** (gap-specific, max ±7) + **Signal /6** (standard `calcSignalScore()` — fetches 15-min + 4H bars) |
| 🌍 Market Overview | `market-overview` | Price, 24h%, 7d%, volume, trend, cap tier per symbol. Score column auto-fills from Signals or Market Signals scan |
| 🔭 Market Signals | `market-signals` | On-demand 6-point scan across full tradable Alpaca universe (sliced by Max Symbols setting) |
| 🔗 Markov | `markov` | First-order Markov chain for BTC/USD & ETH/USD over 30/60/90/180/365-day windows |
| 🔬 Edge | `edge` | On-demand realized-edge analytics: FIFO round-trips, per-symbol expectancy, hour/day P&L |
| 📊 Portfolio Overview | `port-overview` | Account cards, equity curve (Chart.js), sortable positions table |
| 🥧 Allocation | `port-dist` | Donut chart, breakdown table, cap utilisation vs `PORTFOLIO_CAPS` |
| ⚙ Settings | `settings` | Paper/Live credentials, Risk Limits, Max Symbols, Active Watchlist tag editor |

**Top-of-page ticker strip** — 10 symbols, price + 24h%. Auto-refreshes every 15 s.  
**3-mode auto-refresh** — `Auto OFF` → `Prices 15s` → `Full 60s`.  
**📓 Daily Journal button** — generates closing journal from live data, preview modal with Copy + Download `.md`.

---

## Known Issues

(none as of 2026-06-15)

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
- **Critical**: Also pass `sort=desc` and reverse to chronological; default ascending sort returns the *oldest* N bars of the window (fixed 2026-06-11)
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
