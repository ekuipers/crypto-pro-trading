# Glossary — Alpaca Trading Agent

Full decoder ring. Everything that would clutter `memory.md` lives here.

---

## 2026-06-15 — Portfolio Dashboard Merge

| Term | Meaning |
|------|---------|
| `port-overview` / `port-hot` / `port-dist` / `port-brief` | Tab IDs for the four portfolio tabs integrated into `dashboard_professional.html` under the "💼 Portfolio" nav section. |
| `portCapFor(sym)` | Returns the symbol's cap percentage from `PORTFOLIO_CAPS` (e.g. 30 for BTC/USD). Uses `PORTFOLIO_CAPS[sym] \|\| 5`. |
| `portConfluenceScore()` | Standalone TA confluence scorer in the Professional Dashboard (same logic as `calcSignalScore`/`signal_score`). Prefixed `port*` to avoid namespace collision. |
| `portLoadBrief()` | Loads the Morning Brief tab: fetches account + positions, computes alerts, runs `portConfluenceScore` for all 10 watchlist symbols. |
| `generateMorningBrief()` | Header-button function that produces a downloadable `.md` morning brief from live Alpaca data. Opens `#briefDocBackdrop` modal. |
| `port-filter-btn` | CSS class for the order-filter buttons (All/Filled/Open/Canceled) in the Portfolio Overview tab. Renamed from `filter-btn` to avoid collision. |
| `port-period-btn` | CSS class for chart period selector buttons in Portfolio Overview. Renamed from `period-btn`. |
| `port-sortable` / `port-sorted` | CSS classes for sortable column headers in portfolio tables. Renamed from `sortable` / `sorted`. |

---

## Acronyms & Abbreviations

| Term | Meaning | Context |
|------|---------|---------|
| ATR | Average True Range | Volatility measure; used for stop distance & position sizing |
| BB | Bollinger Bands | 20-period, 2σ envelope around SMA |
| BoS | Break of Structure | Trend change signal (lower-high broken = bearish BoS) |
| BW | Bandwidth | Bollinger Band width: (upper−lower)/mid |
| EMA | Exponential Moving Average | Weighted MA; reacts faster than SMA |
| HH | Higher High | Bullish structure |
| HL | Higher Low | Bullish structure |
| LH | Lower High | Bearish structure |
| LL | Lower Low | Bearish structure |
| MACD | Moving Average Convergence Divergence | 12/26 EMA diff; 9-period signal line |
| POC | Point of Control | Volume profile: price level with highest traded volume |
| R:R | Risk-to-Reward ratio | Stop distance vs take-profit distance (need ≥1:2, prefer 1:3) |
| RSI | Relative Strength Index | Wilder method, 14-period; overbought >70, oversold <30 |
| SMA | Simple Moving Average | Equal-weight average |
| SoS | Sign of Strength | Wyckoff: volume-confirmed breakout above trading range |
| TA | Technical Analysis | Chart-based signal analysis |
| TF | Timeframe | e.g. 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Position within band: 0=lower, 1=upper |

---

## Trading Terms

| Term | Meaning |
|------|---------|
| Confluence score | 6-point TA signal score; ≥4 = buy, 3 = half-size, ≤2 = hold; ≤−4 = short, −3 = half-size short, ≥+2 = cover |
| Markov analysis | Dashboard Markov tab. First-order Markov chain over daily close-to-close returns. 3 states via ±1% band (`MK_THRESH`): Up (r>+1%), Flat (|r|≤1%), Down (r<−1%). Builds transition matrix `P(next\|current)`, stationary distribution (power iteration), and next-day forecast from current state. Run for BTC/USD & ETH/USD over 30/60/90/180/365-day windows. Analysis-only, no order routing. Matrix tables use the `.mk-matrix` CSS class (`min-width:0; table-layout:fixed`) to override the global 760px table min-width so they fit their narrow grid panels without overlapping. |
| Transition matrix | 3×3 matrix where cell (i,j) = empirical probability of moving from state i to state j on the next day. Rows sum to 1. |
| Stationary distribution | Long-run state probabilities π satisfying π = πP; computed via power iteration. The Markov tab shows it alongside the empirical state frequencies. |
| Regime block | Daily downtrend detected → all new long entries blocked |
| BB squeeze | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |
| Golden cross | 20 EMA crosses above 50 EMA → bullish |
| Death cross | 20 EMA crosses below 50 EMA → bearish |
| EMA cross state | Detected from last two bars; "golden" / "death" / "neutral" |
| 4H regime | Primary trend filter: 20 EMA vs 50 EMA on 4-hour bars |
| Wyckoff | Market cycle phases: Accumulation → Mark-Up → Distribution → Mark-Down |
| Mark-Up | Wyckoff trend phase: consistent HH/HL, buy pullbacks |
| Mark-Down | Wyckoff downtrend phase: consistent LH/LL, stay flat |
| Accumulation | Wyckoff buy zone: range after downtrend, look for SoS |
| Distribution | Wyckoff exit zone: range after uptrend, do not add positions |
| Regime (daily) | last_close > 50-day SMA AND 20-day SMA > 50-day SMA = uptrend |
| Hard cap | Position capped at 5% of total equity; enforced in trade.py |
| ATR sizing | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at 5% equity |
| Limit order | Only order type used; price ≤ ask + 0.2% |
| Paper trading | Simulated trades only; Alpaca paper environment |
| Morning brief | Scheduled 7 AM task: eval + journal block + dashboard summary |
| Daily regime | Computed from 90-day daily bars: SMA-20 vs SMA-50 vs last close |
| Vol ratio | Current bar volume / 20-bar average volume |
| Live R:R | Real-time risk-to-reward: `(target − current) / (current − stop)` using −5% stop, +10% target |
| Ticker strip | Top-of-dashboard price bar; 10 symbols, 15-second auto-refresh via Alpaca snapshots API |
| Correlation heatmap | 10×10 Pearson ρ matrix of daily log-returns; shown in Risk tab |
| Trend arrow | ↑/↓/→ indicator in Signals tab comparing current confluence score to previous scan |
| Quick-buy (⚡) | Signals tab button for setups scoring ≥ 3; pre-fills trade modal with ATR-sized qty |
| Execute button (▶) | Directly submits the signal row's ATR-sized paper order from the Signals tab without opening the trade modal |
| SHORT (action) | Open a new short position — sends `side="sell"` to Alpaca with no existing position. Triggered when score ≤ −4 in a confirmed daily downtrend |
| COVER (action) | Close an existing short position — sends `side="buy"` to Alpaca. Triggered by stop-loss (+5%) or score ≥ +2 (bullish flip) |
| Short stop-loss | COVER triggered when price rises ≥5% above short entry (`risk.should_cover_short()`). Inverse of long stop-loss |
| Cover stop price | `entry × 1.05` — the hard stop price for a short position (`risk.short_stop_price()`) |
| Short regime gate | SHORT entries only allowed in confirmed daily downtrend (close < 50-SMA AND 20-SMA < 50-SMA). No shorts in uptrend or mixed regime |
| `should_cover_short()` | `risk.py` function: returns True if `(current - entry) / entry >= 0.05`. Short equivalent of `should_stop_out()` |
| `short_stop_price()` | `risk.py` function: returns `entry_price × (1 + STOP_LOSS_PCT)` — the hard stop price for a short |
| `SHORT_SCORE_THRESHOLD` | Constant in `run_evaluation.py` (= −4.0). Full-size short entry gate |
| `SHORT_SCORE_HALF_SIZE` | Constant in `run_evaluation.py` (= −3.0). Half-size short entry gate if R:R ≥ 1:3 |
| `COVER_SCORE_THRESHOLD` | Constant in `run_evaluation.py` (= +2.0). TA-based cover trigger when score turns bullish |
| Trailing stop | Activates once a long position is ≥2.5% in profit. Trails 3% below the high-water mark (HWM). Supersedes the hard 5% stop once active |
| HWM | High-water mark — the highest close price seen since entry. Ratchets up only, never down. Persisted in `data/positions_state.json` |
| Stop-loss deduplication | Before placing any SELL/COVER stop-loss order, `get_open_orders(symbol)` is called. If a pending order exists within the escalation window, the duplicate is suppressed |
| Time-escalation | When a stop-loss order has been pending for `stop_loss_escalation_cycles` (2) evaluation cycles without filling, it is cancelled and replaced with a wider limit (base 0.5% + extra 0.3%) |
| `stop_loss_limit_price(ask, cycles_open)` | `risk.py` function: returns the limit price for a SELL stop. Uses 0.5% band; widens after 2 unfilled cycles |
| `cover_limit_price(ask, cycles_open)` | `risk.py` function: mirror of `stop_loss_limit_price` for COVER (short) orders; limit is placed above ask |
| `is_stop_loss` | `place_order()` bool param — when True, uses 0.5% limit band instead of 0.2% to allow stop-loss fills in volatile markets |
| Correlation budget | Max 3 open positions total; max 2 per tier (Tier-1: BTC/USD+ETH/USD; Tier-2: alts). New entries blocked when either limit is reached. Checked by `correlation_budget_allows()` in `risk.py` |
| Tier-1 symbols | BTC/USD and ETH/USD — most liquid, highest correlation. Separate per-tier budget from Tier-2 alts |
| Daily drawdown gate | If portfolio equity drops ≥3% vs day-open equity, capital preservation mode activates: all new entries blocked, existing stops tighten to 3%. Resets at midnight UTC |
| Capital preservation mode | State flag in `data/positions_state.json`. Set by `activate_capital_preservation()`, cleared by `check_and_refresh_day_open()` at start of each new day |
| `position_state.py` | New module (2026-05-27): manages `data/positions_state.json`. Stores HWM, stop order IDs + cycle counts per symbol, plus day-open equity and capital preservation flag |
| `positions_state.json` | Persistent JSON state file in `data/`. Survives evaluation cycles. Atomic writes via temp-file + os.replace() |
| `correlation_budget_allows(symbol, open_symbols)` | `risk.py` function: returns `(allowed, reason)`. Checks total position count and per-tier count |
| `daily_drawdown_gate_triggered(day_open, current)` | `risk.py` function: returns True if drawdown ≥ 3% (configurable via `config.json > risk.daily_drawdown_gate_pct`) |
| Rebalance script | `scripts/rebalance.py` — trims over-cap positions, tops up under-cap positions (signal-gated). Run with `--execute` to submit orders |
| Over-cap trim | Position value > cap% of equity → sell excess to bring back to cap. No signal gate; always fires |
| Under-cap top-up | Position value < cap% → buy to close the gap, subject to signal gate (score ≥ 3) and regime gate (no downtrend) |
| `isShort` | Dashboard JS pattern: `const isShort = qty < 0`. Alpaca returns negative `qty` for open short positions |
| SHORT badge | Red `SHORT` label displayed next to symbol name in Positions tab for short positions (both dashboards) |
| ⚡ Short button | Signals tab quick-fill button for short setups (`down && score <= -3`); pre-fills trade modal with `side='sell'` and ATR-sized qty |
| TOP30_SYMBOLS | 30-element JS array in the dashboard covering the top crypto by market cap available on Alpaca (stablecoins and BNB excluded) |
| TOP30_INFO | JS object keyed by symbol; stores `rank`, `tier` (Mega/Large/Mid/Small), `capLabel`, and `name` for each of the 30 symbols |
| Market tab / page-market | Single nav tab merging Market Overview + Market Signals (roadmap, 2026-06-17). `switchTab('market')` shows `page-market`; a sub-tab bar (`.market-subnav`/`.subtab-btn`) switches between the two `.market-subpage` divs |
| marketSubTab(subId) | Dashboard fn that selects a Market sub-tab (`market-overview`/`market-signals`): toggles the `.market-subpage` + `.subtab-btn` active state, mirrors the sub-tab id to the URL hash + `localStorage.lastTab` (so legacy `#market-overview`/`#market-signals` deep links resolve), lazy-loads Overview (Signals manual), and stores `_marketSub` for restore. Cross-link buttons in each sub-tab header call it |
| Market Overview sub-tab | Dashboard sub-tab (inside the Market tab) showing live price, 24h%, 7d%, volume, trend and cap tier; auto-loads on selection; includes momentum heatmap. Symbol set is the shared `getCryptoUniverse()` sliced by the Max Symbols setting (`MO_SYMBOLS = universe.slice(0, n)`) — no longer hardcoded to 30. Each row has a **Trade** column with Buy/Sell buttons (`moTradeButtons()`) |
| moTradeButtons(row) | Dashboard fn rendering the Market Overview row's Buy/Sell buttons; calls `openTradeModal(row.sym→BTCUSD, displaySym, side, '', row.price)` (qty blank, side+price pre-filled). Returns `–` when the row has no live price. Reuses the shared trade modal — no new submit logic |
| populateWatchlistOptions() | Dashboard fn filling the Settings watchlist `<datalist id="watchlistSymbolOptions">` from `getCryptoUniverse()`, excluding already-added symbols. Called from `renderWatchlistTags()` so it re-syncs after add/remove/reset. Powers the watchlist add-symbol dropdown (`<input list>`); degrades to free-text if the assets call fails |
| Market Signals sub-tab | Dashboard sub-tab (inside the Market tab) running the full 6-point confluence scan on demand across `getCryptoUniverse()` (full tradable Alpaca crypto list), capped by the Max Symbols setting; same scoring engine as the watchlist Signals tab. Has a per-symbol Watchlist column (`msWatchlistCell()`) |
| msWatchlistCell(row) / msAddWatch / msRemoveWatch | Market Signals Watchlist-column helpers. `msWatchlistCell()` renders **+ Watch** when score ≥ 4 and symbol not on watchlist, **– Unwatch** when score ≤ −2 (sell) and no open position (`_msOpenPosSyms`), else ✓ watched / – (or "full" at the 20-cap). The buttons call `msAddWatch`/`msRemoveWatch`, which mutate the shared watchlist (`saveWatchlistData`+`renderWatchlistTags`) and re-render only the cells via `renderMsWatchlistCells()` (cached `_msLastRows`, cells keyed `mswl-<alpSym>`) — no rescan |
| _msOpenPosSyms / _msLastRows | Market Signals globals: `_msOpenPosSyms` is a Set of `BASE/USD` symbols with an open position (from `/v2/positions`, fetched in `loadMarketSignals`) used to gate the Watchlist – Unwatch button; `_msLastRows` caches the last scanned rows so watchlist cells can re-render without a rescan |
| symbolInfo(sym) / _universeRank | `symbolInfo()` returns a symbol's display info: curated `TOP30_INFO` when known, else `{ rank: _universeRank[sym] (1-based universe position), tier:"?", capLabel:"?", name: sym w/o /USD }`. `_universeRank` is rebuilt by `rebuildUniverseRank()` at the end of `getCryptoUniverse()`. Used by Market Overview + Market Signals so every row has a contiguous rank instead of `#?` |
| getCryptoUniverse() | Dashboard fn that fetches the full tradable crypto universe once (`/v2/assets?asset_class=crypto&status=active`), caches it in `_cryptoUniverse`, and orders it as still-tradable `TOP30_SYMBOLS` first then the rest alphabetically. Robust to symbol format: normalizes both `BTC/USD` and bare `BTCUSD` to `BASE/USD`, drops non-USD quotes, and drops stablecoin bases (see `STABLECOIN_BASES`). Falls back to `TOP30_SYMBOLS` on failure/empty. Shared by **both** Market Signals and Market Overview (and the Settings watchlist dropdown), replacing the 30-symbol ceiling so `maxSignalSymbols` can exceed 30 on both |
| STABLECOIN_BASES | Dashboard const set of stablecoin base symbols (USDT, USDC, DAI, USDP, PYUSD, TUSD, BUSD, GUSD, USDG, FDUSD, USDD, FRAX, LUSD, USTC) excluded by `getCryptoUniverse()` — a `USDT/USD`/`USDC/USD` pair is just the stablecoin priced in dollars, never a tradeable setup, so it must not pollute scans/overview/watchlist |
| _msPrevScores | Dashboard JS cache (`{}` keyed by symbol) storing confluence scores from the last Market Signals scan; read by Market Overview to populate its Score column |
| applyTabFromUrl() | Dashboard fn that resolves the active tab from the URL hash, then `localStorage.lastTab`, and activates it. Called at end of `bootstrapDashboard()` and on `hashchange`. Enables deep-linking to a tab (`#signals`) and restoring the last tab on browser refresh. A `SUBS` list (`market-overview`/`market-signals`) makes it recognise Market sub-tab ids and open the parent `market` tab + sub-tab (sets `_marketSub` first to skip a wasted Overview load) |
| validTabIds() / tabBtnFor(id) | Dashboard helpers: `validTabIds()` derives the list of valid tab ids by parsing each nav button's `switchTab('<id>',…)` onclick (so routing never drifts as tabs change); `tabBtnFor(id)` returns the nav button for a given id |
| lastTab (localStorage) | Dashboard `localStorage` key holding the last opened tab id; written by `switchTab()`, read by `applyTabFromUrl()` as the fallback when the URL has no tab hash |
| Cap tier | Classification of a crypto's market cap: Mega (>$100B), Large ($10B–$100B), Mid ($1B–$10B), Small (<$1B) |
| `generateMorningBrief()` | Portfolio dashboard header-button handler. Builds the morning brief Markdown (Portfolio Health, Alerts, Signal Confluence, Market Notes) from live data + the `confluenceScore`/`fetchBars` engine; shows modal `#briefDocBackdrop`; downloads `morning-brief-YYYY-MM-DD.md` |
| `generateDailyJournal()` | Professional dashboard header-button handler. Builds the closing journal Markdown (Summary, Trades Today, Open Positions, Market Observations) from account/positions/FILL activities + a `JOURNAL_WL` `calcSignalScore` scan; shows modal `#journalDocBackdrop`; downloads `daily-journal-YYYY-MM-DD.md` |
| `getWatchlist()` | Returns the active watchlist array from `localStorage.proDashboardWatchlist` (falls back to `DEFAULT_WATCHLIST` — the 10 default crypto symbols). Used by `generateDailyJournal()` (was `JOURNAL_WL`), Autopilot (`getApWatchlist()`), and portfolio tabs (`getPortCryptoWL()`). Users manage it in the Settings tab watchlist editor. |
| `DEFAULT_WATCHLIST` | `["BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","DOT/USD","LTC/USD","DOGE/USD","ADA/USD","AAVE/USD"]` — the 10-symbol fallback used when no watchlist is saved in localStorage. `resetWatchlist()` restores this. |
| `WL_STORAGE_KEY` | `"proDashboardWatchlist"` — localStorage key for the user-managed watchlist. Separate from `proDashboardSettings`. |
| `Etc/GMT-2` | IANA timezone string used by the brief/journal generators for GMT+2 timestamps and day filtering. Note the inverted sign: `Etc/GMT-2` == UTC+2 == GMT+2 |

---

## Watchlist Symbols

| Symbol | Asset | Notes |
|--------|-------|-------|
| BTC/USD | Bitcoin | Largest by cap; lowest volatility |
| ETH/USD | Ethereum | DeFi hub; correlated with BTC |
| SOL/USD | Solana | High-throughput L1; volatile |
| AVAX/USD | Avalanche | L1; subnet ecosystem |
| LINK/USD | Chainlink | Oracle network |
| DOT/USD | Polkadot | Parachain ecosystem |
| LTC/USD | Litecoin | OG altcoin; often leads BTC moves |
| DOGE/USD | Dogecoin | Meme coin; high sensitivity to sentiment |
| UNI/USD | Uniswap | DeFi AMM token |
| AAVE/USD | Aave | DeFi lending protocol |

---

## Agents

| Term | Meaning | Context |
|------|---------|---------|
| market-researcher | Analysis-only subagent in `.claude/agents/market-researcher.md` | Pro spot-trader persona; verifies strategy/risk/profitability and reviews the project after strategy changes; logs timestamped reports to `data/market_research/`; never trades |
| Universe Scout | `scripts/scout.py` — auto-promotes uptrending score-≥4 non-watchlist `*/USD` pairs | Writes `data/watchlist_dynamic.json` (TTL 6 h); merged by `run_evaluation` when `scout.enabled`; all gates + 5% default cap apply |
| Autopilot | Dashboard Command-tab autonomous trading loop | OFF on every page load; kill switch cancels all orders; gates mirror the Python agent; HWM + log in localStorage |
| `shorts_enabled` | `config.json › strategy` flag, default **false** | Alpaca spot crypto cannot be shorted — short entries gated off in `run_evaluation`; cover logic retained |
| Stop-loss clamp | `trade.py` clamps stale stop limits to the fresh ask's 0.5% band edge | Replaces self-rejection that left positions exposed a full cycle (fixed 2026-06-11) |
| `data/market_research/` | Historical research log folder | `YYYY-MM-DD-HHMM-market.md` and `…-project-verification.md`, GMT+2 timestamps |

## API & Environment

| Key | Value / Detail |
|-----|----------------|
| Base URL | `https://paper-api.alpaca.markets` |
| Data URL | `https://data.alpaca.markets` |
| Bars endpoint | `/v1beta3/crypto/us/bars` |
| Snapshots endpoint | `/v1beta3/crypto/us/snapshots?symbols=...` — returns latest trade, daily bar, prev daily bar per symbol |
| API key var | `APCA_API_KEY_ID` |
| Secret var | `APCA_API_SECRET_KEY` |
| Account ID | PA3EZEE1I9RS |
| Crypto hours | 24/7 — no market clock gate |
| Critical bug (fixed) | `limit` param alone → 1 bar; must pass explicit `start` date |
| Critical bug (fixed 2026-06-11) | default sort is ascending: `start`+`limit=N` → *oldest* N bars (daily 54 d stale, regime gate inverted); must pass `sort=desc` and reverse to chronological |
| `_bars_start()` | Computes: `now − (limit × tf_minutes × 1.6)` to ensure enough history |
| Multi-symbol pagination | Bars API paginates by *total bars*, not per-symbol. Must follow `next_page_token` until `null`. |
| Dashboard Settings inputs | `#page-settings` field IDs: `setPaperApiKey` / `setPaperApiSecret` (📄 Paper), `setLiveApiKey` / `setLiveApiSecret` (🔴 Live), `setStopLoss` / `setMaxDailyLoss` / `setMaxOpenRisk` (🛡 Risk Limits), `setMaxSignalSymbols` (🔭 Signals Analysis), `watchlistAddInput` + `watchlistTagsEl` + `watchlistCountEl` (📋 Active Watchlist). Persisted to `localStorage` key `proDashboardSettings` (main settings) and `proDashboardWatchlist` (watchlist). |
| `maxSignalSymbols` | `getSettings().limits.maxSignalSymbols` — sets how many symbols the Market Signals scanner analyses. Default 30, minimum 1, **no upper clamp**. `loadMarketSignals()` uses `SCAN_SYMBOLS = universe.slice(0, n)` where `universe = getCryptoUniverse()` (full tradable Alpaca crypto list, no longer the 30-symbol `TOP30_SYMBOLS`), so values above 30 genuinely scan more symbols. Does not affect the watchlist Signals tab or Market Overview. |
| `updateScanBtnLabel()` | Sets the Market Signals scan button (`#msScanBtn`) text to `▶ Scan Top N` from `maxSignalSymbols`. Called on page init, after `saveSettings()`, and at the start of `loadMarketSignals()`. Gives a live, visible indicator of the active symbol cap. |
| `config.json` (dashboard) | Settings store for `docs/dashboard_professional.html`, kept in the same folder. Holds `mode`, the four API key/secret fields, and a `limits` object (incl. `maxSignalSymbols`). Loaded on page open by `loadConfigFromFile()` (fetch `./config.json`), written by `saveSettings()` via `saveConfigToFile()`. Separate from the agent's top-level `config.json` (strategy/watchlist/caps). |
| `loadConfigFromFile()` | Dashboard config.json loader (load-only, seed/fallback). `fetch('./config.json')` on page open, then merge into `localStorage` where **saved localStorage values win** and config.json only fills gaps: top-level non-empty config keys seed missing fields; `merged.limits = Object.assign({}, cfg.limits, existing.limits)` so a user-saved `maxSignalSymbols` survives refresh (config.json's value applies only on a fresh browser). No save-to-file; `saveSettings()` writes `localStorage` only. |
| `docs/dashboard_layout.md` | Layout & changelog doc for both dashboards, split into **1. Professional Dashboard** and **2. Portfolio Dashboard** sections (tabs table + key features + dated changelog each). Part of the project doc-update rule: any dashboard change must add a changelog entry to the matching section. |
| TDZ init bug (fixed) | `updateScanBtnLabel()` reads `const TOP30_SYMBOLS`; calling it from the early top-level init (before that const's line) throws `Cannot access 'TOP30_SYMBOLS' before initialization`, aborting the whole script (dead scan button, Market Overview error). Fix: only call it from inside the async `bootstrapDashboard()` IIFE after `await loadConfigFromFile()`, by which time the const is initialized. |

---

## Timeframe Reference

| Alpaca TF string | Minutes | Used for |
|-----------------|---------|---------|
| `15Min` | 15 | Execution signals (MACD, RSI, BB, EMA cross) |
| `4Hour` | 240 | Primary trend filter (4H EMA cross) |
| `1Day` | 1440 | Regime detection (SMA-20 vs SMA-50) |

---

## Script Signatures

| Function | File | Purpose |
|----------|------|---------|
| `signal_score(closes, volumes, highs, lows, closes_4h)` | `indicators.py` | Returns `(score, breakdown_dict)` |
| `ema_cross_state(closes, fast=20, slow=50)` | `indicators.py` | "golden" / "death" / "neutral" |
| `atr(highs, lows, closes, period=14)` | `indicators.py` | Wilder ATR |
| `volume_ratio(volumes, period=20)` | `indicators.py` | Current / 20-bar avg |
| `should_trail_stop_out(entry, hwm, cur)` | `risk.py` | True when trailing stop fires (HWM gain ≥2.5%, current ≤ HWM×0.97) |
| `correlation_budget_allows(symbol, open_symbols)` | `risk.py` | Returns `(bool, reason)` — checks total + per-tier limits |
| `daily_drawdown_gate_triggered(day_open, current)` | `risk.py` | True if today's drawdown ≥ 3% |
| `stop_loss_limit_price(ask, cycles_open)` | `risk.py` | Limit price for stop-loss SELL; widens after 2 unfilled cycles |
| `cover_limit_price(ask, cycles_open)` | `risk.py` | Limit price for stop-loss COVER; mirrors above, price above ask |
| `get_open_orders(symbol)` | `trade.py` | Fetch pending orders for a symbol; normalises BTCUSD→BTC/USD |
| `cancel_order(order_id)` | `trade.py` | Cancel single order by ID; returns True on 200/204, no-raises on 404 |
| `place_order(..., is_stop_loss=False)` | `trade.py` | Place limit order; `is_stop_loss=True` uses wider 0.5% band |
| `load_state()` / `save_state(state)` | `position_state.py` | Load/atomically-write `data/positions_state.json` |
| `check_and_refresh_day_open(state, equity)` | `position_state.py` | Reset daily snapshot if new day; clears capital preservation mode |
| `update_high_water_mark(state, symbol, price)` | `position_state.py` | Ratchet HWM up, never down |
| `set_stop_order(state, symbol, order_id, price)` | `position_state.py` | Record a placed stop-loss order ID + limit price in state |
| `increment_stop_order_cycles(state, symbol)` | `position_state.py` | Increment + return the cycle counter for the pending stop order |
| `clear_stop_order(state, symbol)` | `position_state.py` | Null out stop_order_id + related fields (order filled or cancelled) |
| `init_position(state, symbol, entry_price)` | `position_state.py` | Called on new BUY/SHORT fill; sets entry_price, HWM, clears stop fields |
| `clear_position(state, symbol)` | `position_state.py` | Remove symbol from state (SELL/COVER fully filled) |
| `get_crypto_bars(symbol, limit, timeframe)` | `run_evaluation.py` | Fetches bars with correct start date |
| `_bars_start(limit, timeframe, buffer=1.6)` | `run_evaluation.py` | Computes start datetime string |
| `evaluate_symbol(symbol, positions, equity, buying_power)` | `run_evaluation.py` | Full eval + ATR sizing + journal write |
| `place_order(symbol, side, qty, ask)` | `trade.py` | Limit order; enforces hard rules |
| `evaluate_rebalance(symbol, pos, equity, caps_data)` | `rebalance.py` | Returns rebalance decision (HOLD/BUY/SELL) with qty, limit_price, reason |
| `append_rebalance_journal(timestamp, decisions, executed)` | `rebalance.py` | Appends `## Rebalance HH:MM GMT+2` block to daily journal |
| `computeFifoStats(activities)` | `dashboard_professional.html` | Shared FIFO realized-P&L engine. Returns `{totalPnl, wins, losses, winPnl, lossPnl, winRate, profitFactor, avgWin, avgLoss, tradeRows}`. Long-only buy→sell matching. Single source of truth for both the P&L tab (`loadPnl`) and Backtest tab (`renderBacktest` via `c.fifoStats`). |

---

## Python ↔ Dashboard Parity Notes

Critical implementation details to keep `indicators.py` and `dashboard_professional.html` in sync:

| Concern | Detail |
|---------|--------|
| MACD NaN prefix | `macdLine` has NaN for indices 0–24 (ema26 only valid from index 25). Must strip NaN before calling `emaArr` for signal EMA, then re-pad to original length. Otherwise signal line = NaN always (MACD always 0). |
| Half-size threshold | Python: `score >= 3.0` → half-size. Dashboard pills: `score >= 3 && score < 4` (NOT `=== 3`). Scores of 3.5 are valid half-size entries. |
| EMA seeding | Both sides seed with SMA of first `period` values (not first raw value). |
| EMA dead zone | Both sides use ±0.05% band: `ema20 > ema50 * 1.0005` = golden; `< 0.9995` = death; else neutral. Applies to 15-min (Signal 1) and 4H (Signal 6). |
| Volume average | `current / avg(prev-20 bars)` — prev-20 excludes current bar: Python `volumes[-21:-1]`; JS `volumes.slice(-21,-1)`. |
| Daily regime | SMA (not EMA) for both sides. `last > SMA50 && SMA20 > SMA50` = uptrend. |

---

## Hard Rules Quick Reference

| # | Rule | Value |
|---|------|-------|
| 1 | Position cap | ≤5% of equity per symbol |
| 2 | Order type | Limit only; within 0.2% of ask |
| 3 | Long stop-loss | −5% from entry → immediate SELL |
| 3b | Short stop-loss | +5% above entry → immediate COVER |
| 4 | TA exit (long) | Score ≤ −2 → SELL |
| 4b | TA cover (short) | Score ≥ +2 → COVER |
| 5 | Buy gate | Score ≥4/6 full size; score=3/6 half-size if R:R≥1:3 |
| 5b | Short gate | Score ≤−4/6 full size; score=−3/6 half-size if R:R≥1:3; downtrend only |
| 6 | Long regime gate | No buys in daily downtrend (close < 50-SMA AND 20-SMA < 50-SMA) |
| 6b | Short regime gate | Shorts ONLY in confirmed daily downtrend; blocked in uptrend/mixed |
| 7 | Sizing | ATR: qty=(equity×1%)/(ATR×1.5), cap at 5% equity |
| 8 | Order routing | All via `scripts/trade.py`; direct API calls forbidden |
| 9 | Journal | Every day, even quiet ones |
