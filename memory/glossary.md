# Glossary — Alpaca Trading Agent

Full decoder ring. Everything that would clutter `memory.md` lives here.

---

## 2026-07-09 — Command › 🐦 Socials sub-tab (v2026-07-09.6)

| Term | Meaning |
|------|---------|
| Socials sub-tab (Command) | `subpage-socials` under the 🧭 Command parent tab (deep link `#socials`). Crypto tweets + stats from curated >0.5M-follower accounts, T1/T2-badged, GMT+2 timestamps, 10-min cache. Stats live via fxtwitter; tweets best-effort via Nitter mirrors. Analysis-only, defensive input only. |
| fxtwitter API | `GET https://api.fxtwitter.com/<handle>` — the FixTweet service's keyless JSON API with `Access-Control-Allow-Origin: *` (verified 2026-07-09). `j.user` carries live `followers`, `tweets`, `name`, etc. The **only** keyless CORS-open X endpoint found working; used by `socFetchStats()`. No timeline endpoint — tweet text still needs the mirror RSS path. |
| `SOC_ACCOUNTS` | Curated 14-account list, every one >0.5M followers (the roadmap gate — enforced by curation). Fields: `h` (handle), `name`, `followersM` (static snapshot in millions, 2026-07 — render fallback when fxtwitter fails, marked `*`), optional `general:true` (non-crypto-native → crypto-keyword filter applies). |
| Nitter-mirror RSS | X/Twitter has no keyless API and blocks CORS. Nitter mirrors expose `https://<host>/<handle>/rss`; fetched through the same rss2json bridge as News. `SOC_NITTER_HOSTS` = xcancel.com, nitter.poast.org, nitter.privacyredirect.com, lightbrd.com — tried in order per account (`socFetchAccount()`), mirrors die often. Retweet items start with an `RT by` prefix in the title and are skipped. |
| `SOC_CRYPTO_RE` | Crypto-keyword gate applied to `general:true` accounts only (bitcoin/btc/eth/solana/doge/defi/nft/etc.) so e.g. non-crypto Musk tweets stay out. |
| `socToXUrl()` | Rewrites the mirror status link back to `https://x.com/...` and strips Nitter's `#m` anchor. |
| `SOC_CACHE_MS` / `SOC_MAX_ITEMS` / `SOC_MAX_PER_ACCT` | 10-min auto-load cache / 60 rendered tweets / 8 tweets per account (keeps one account from flooding the feed). |
| `.soc-acct` chips | Per-account stat chips (`#socAccts`): @handle · follower count (`socFollowersLabel()`) · tweets fetched; `.soc-dead` (red ✕) when all mirrors failed for that account. |

## 2026-07-09 — Command › 📰 News sub-tab (v2026-07-09.5)

| Term | Meaning |
|------|---------|
| News sub-tab (Command) | `subpage-news` under the 🧭 Command parent tab. Aggregated crypto headlines from 4 sources, deduped, T1/T2-badged, GMT+2 timestamps, 5-min cache. Analysis-only. Deep link `#news`. |
| `COMMAND_SUBS` | `["command-overview","news"]` — Command's sub-tab ids; `commandSubTab(subId)` mirrors `marketSubTab`/`analyticsSubTab`. *(v2026-07-09.6: `"socials"` appended.)* |
| `subParentOf(id)` / `subTabFnOf(parent)` | Shared helpers (added v2026-07-09.5) mapping a sub-tab id to its parent tab and the parent to its `<parent>SubTab` function — single source of truth for the sub-tab redirects in `switchTab()` and `applyTabFromUrl()`. |
| Alpaca News API | `GET https://data.alpaca.markets/v1beta1/news?symbols=BTCUSD,…&limit=50&sort=desc` with the standard `APCA-API-KEY-ID`/`SECRET` headers. Benzinga-sourced. Response: `{ news: [{ id, headline, created_at, url, source, symbols[] }] }`. Skipped when no keys are stored. |
| rss2json bridge | `https://api.rss2json.com/v1/api.json?rss_url=<feed>` — keyless RSS→JSON proxy with `Access-Control-Allow-Origin: *`. Used because direct RSS fetches are CORS-blocked in the browser and the CryptoCompare (`min-api.cryptocompare.com`, now 401) and CoinGecko (`/api/v3/news`, now PRO-only 10005) news APIs both require keys as of 2026-07. `pubDate` comes back as `"YYYY-MM-DD HH:MM:SS"` in UTC — parse as `replace(" ","T")+"Z"`. |
| `NEWS_RSS_FEEDS` | CoinDesk (`coindesk.com/arc/outboundfeeds/rss/`), Cointelegraph (`cointelegraph.com/rss`), Decrypt (`decrypt.co/feed`). |
| `newsCatalystTier()` | Keyword ladder → `"T1"` (structural: hack/exploit/depeg/delist/enforcement/chain halt/insolvency), `"T2"` (flow: ETF, unlock, halving, listing, treasury buys, Fed/FOMC/CPI/rates), or `null`. Aligned with `skills/crypto-catalysts`; heuristic, not scored — news stays a defensive input. |
| `newsDedupe()` / `newsNormTitle()` | Cross-source dedupe: newest-first, drop items whose normalized headline (lowercase, punctuation→space, first 80 chars) or URL was already seen. |
| `newsDetectCoins()` | Base-ticker chips for RSS items: case-sensitive ticker (`\bSOL\b`) OR any-case coin name (`[Ss]olana`) so ordinary words like "Sol"/"Ada" never match. Alpaca items use their native `symbols` array instead. |
| `NEWS_CACHE_MS` / `NEWS_MAX_ITEMS` | 5 min auto-load cache / 40 rendered headlines. |

## 2026-07-09 — Execution order table Total column (v2026-07-09.4)

| Term | Meaning |
|------|---------|
| Total column (Execution tab) | Sortable USD order-value column in the Recent Orders table (after Avg Fill), roadmap item 2026-07-09. Value = `filled_qty × filled_avg_price` for (partially) filled orders, else `qty × limit_price` for unfilled limit orders, else the order's `notional` field; "–" when none available. Rendered in `renderExecution()`; sorting comes free from the generic `sortTable()`/`parseCellValue()` (strips `$`/commas). |

## 2026-07-09 — Canonical symbol notation BASE/QUOTE (v2026-07-09.3)

| Term | Meaning |
|------|---------|
| Canonical symbol notation | The one symbol format used project-wide: the slash pair `BASE/QUOTE` (`BTC/USD`, `BTC/USDT`) — config, journals, logs, state files, and every dashboard label. Alpaca's no-slash form (`BTCUSD`) lives only at the API boundary (positions/orders/activities responses, order payloads, bars/snapshot map keys). Rule documented in CLAUDE.md › "Symbol notation (canonical)". |
| `scripts/symbols.py` / `to_slash()` | Single Python converter `'BTCUSD' → 'BTC/USD'` (quotes USDT/USDC/USD, longest match first, so `BTCUSDT → BTC/USDT`). Replaced four duplicated local `_to_slash`/`_slash` implementations in `rebalance.py`, `run_evaluation.py`, `trade.py`, `scout.py`. Mirrors the dashboard's `toSlash()` — keep the two in sync. Tested in `tests/test_symbols.py`. |
| `baseTicker()` exemptions | The dashboard helper is no longer used for symbol labels. Remaining functional uses: news-site URL slugs in Breakout cards (CryptoPanic/CoinGecko want the bare base), the space-capped 4-char correlation-matrix axis ticks, and the `symbolInfo()` asset-*name* fallback. Each site carries a comment referencing the notation rule. |

## 2026-07-09 — All 8 trader-effectiveness items implemented (v2026-07-09.1)

| Term | Meaning |
|------|---------|
| Round-trip cost | Total cost of a completed trade: 2× `costs.taker_fee_bps_per_side` (25 bps/side, Alpaca crypto base tier) + live bid-ask spread. Python `risk.round_trip_cost_pct(bid, ask)` returns a fraction; JS `roundTripCostPct(spreadPct)` returns a percent. Feeds net R:R, the scalp viability gate, and the walk-forward fee default. |
| Net-of-cost R:R (net R:R) | Reward:risk after subtracting the round-trip cost from the reward leg: `((target − entry) − entry×cost) ÷ (entry − stop)`. Stop = 4H swing low, target = BB upper. Python `risk.net_rr()`, JS `netRrPct()`. Shown in the Signals **Net R:R** column + trade modal (`_signalRrMap` carries `rr`/`grossRr`/`costPct`). |
| Net R:R soft gate | Entry gate in both engines: net R:R < `strategy.min_rr_half` (1.0) → block; < `min_rr_full` (1.5) → half-size; skipped when stop/target geometry is unavailable ("soft"). |
| Scalp viability gate (Cost Check) | Scalping-tab column: distance to the BB-upper target must be ≥ 2× round-trip cost, else the row shows red "⚠ costly" (flag, not block — Buy stays available). |
| Position rotation | Implemented in `run_evaluation.apply_rotation()` + the Autopilot budget-full branch: a budget-blocked candidate scoring ≥ `strategy.rotation_min_score` (4.0) and ≥ `rotation_score_margin` (2.0) above the weakest open holding (which must score ≤ 0) replaces it in the same cycle. Pure gate: `risk.rotation_allows()`. One rotation per cycle; exits execute before entries; regime/tier/R:R gates still apply. |
| Over-budget reconciliation | `BUDGET EXCEEDED n/m` warning (console + bold journal line) whenever open positions exceed `risk.max_open_positions`; red `#budgetChip` on the Command tab (`renderBudgetChip()`); optional weakest-overflow trim behind `risk.enforce_budget_on_open_positions` (default false). |
| Partial TP / break-even ladder (+1R scale-out) | At +`partial_tp_r_multiple`R (R = entry − swing-low stop; −5% fallback) sell `partial_tp_fraction` (50%) and raise the remaining stop to breakeven. Fires once (`partial_tp_done`); afterwards the hard stop is `max(swing low, breakeven)`. Python: `risk.should_partial_tp()` + `position_state.mark_partial_tp()`; Autopilot mirror: `localStorage.autopilotPartialTp` (sym → breakeven), merged from the Python state file. |
| Stale-position exit | `risk.max_hold_hours` (48): exit positions older than the limit that never armed their trailing stop and score below the half-size gate (2.5). Pure gate: `risk.is_stale_position()`; entry clock: `entry_time_iso` in the state file / `localStorage.autopilotEntryTime`. Winners (armed trail) exempt. |
| 4H aggregation fallback / synthetic 4H | When the native 4H fetch returns < 51 bars, both engines aggregate 1H bars into synthetic 4H bars on 4-hour UTC boundaries, complete buckets only (`aggregate_bars_to_4h()` / `aggregate1hTo4h()` + `fill4hFallback()`). Failure → explicit `DATA-QUALITY WARNING` journal line / red ⚠ in the Signals 4H cell (yellow ⚠ = synthetic in use). |
| Session-edge filter | OFF by default (`strategy.session_filter_enabled`): half-size entries during GMT+2 exit-hour/weekday buckets with ≥ `session_min_sample` (20) realized FIFO round trips and negative net P&L. Python `_session_penalty_active()` (run_evaluation); JS `apSessionPenaltyActive()` (6h cache over `edgeFetchAllFills`). |
| `entry_time_iso` / `partial_tp_done` / `breakeven_stop` | New per-position fields in `data/positions_state.json` (position_state.py `_EMPTY_POSITION`): when the position opened, whether the +1R scale-out already fired, and the breakeven stop level for the remainder. |
| `localStorage.autopilotPartialTp` / `autopilotEntryTime` | Autopilot mirrors of the above (sym → breakeven price; sym → entry epoch-ms). Pruned to held symbols each cycle; merged from the Python state file so both engines run the same ladder on a shared position. |

## 2026-07-08 — Roadmap sweep: Autopilot hardening + dashboard parity (v2026-07-08.1)

| Term | Meaning |
|------|---------|
| `STRAT_CFG` | Dashboard const object holding the strategy/risk params shared with Python: `taExitScore` (−2), `trailArmPct` (2.5), `trailPct` (3), `cashReservePct` (20), `swingLowLookback` (20), `swingLowBufferPct` (0.1), `swingLowMaxStopPct` (8), `minBarsForSignal` (60), `dailyDrawdownGatePct` (3), `escalationCycles` (2), `escalationExtraPct` (0.3). Defaults are fallbacks; `seedStrategyConfig(cfg)` overwrites from `config.json › strategy/risk/data` on page load. Replaced the hardcoded `AP_TA_EXIT_SCORE`/`AP_TRAIL_*`/`AP_CASH_RESERVE_PCT`/`SWING_LOW_*` consts. |
| `seedStrategyConfig(cfg)` | Called by `loadConfigFromFile()`; maps config keys → `STRAT_CFG` (fractions ×100 to percent) + `_scoutTtlHours` from `scout.ttl_hours`. |
| `fetchLocalJson(paths)` | Graceful multi-path relative JSON fetch (first parsed object wins, else null). Used for `./config.json` → `../config.json`, `data/watchlist_dynamic.json`, and `data/positions_state.json`. |
| `localStorage.autopilotDayOpen` | `{day, equity}` — day-open equity snapshot per GMT+2 day (`en-CA` date). Drives the Autopilot **daily-drawdown gate**: equity ≥ `dailyDrawdownGatePct` below it → entries blocked (exits active), reset at day roll. Mirrors `risk.daily_drawdown_gate_triggered`. |
| `localStorage.autopilotOrderAge` | `{orderId: cycles}` — how many Autopilot cycles each open order has survived. Entry limits cancelled at age > 1 (**only `ap-`-tagged orders** — bugfix 2026-07-08 v2); exit limits cancel-replaced at age ≥ `escalationCycles` with band `0.5% + escalationExtraPct`. Cleared by the ⛔ kill switch. |
| `ap-` `client_order_id` tag | `apPlaceOrder()` tags every Autopilot order `client_order_id = "ap-<SYM>-<ms>"`. The stale-entry sweep only cancels buy limits carrying this prefix, so Python-engine entries and manual trade-modal orders are never swept (bugfix 2026-07-08 v2). Exit cancel-replace stays untargeted — it always re-places a protective SELL immediately. |
| `trailArmed` (Autopilot) | Trailing stop arms from the **HWM**, not current P&L: `hwm ≥ entry × (1 + trailArmPct/100)`. Once armed, fires at `cur ≤ hwm × (1 − trailPct/100)` even if P&L pulled back below the arm threshold — mirrors `risk.should_trail_stop_out` (bugfix 2026-07-08 v2; previously the whole check was gated on `plPct ≥ 2.5`, so a pullback un-armed the trail). |
| `apCancelOrder(id)` | DELETE `/v2/orders/{id}`; 404 (already filled/cancelled) counts as success. |
| `liveQuote{}` | Per-cycle map of live snapshot prices (`fetchSnapshotsInBatches`) used for **all Autopilot limit prices**; `res.lastClose` (last completed 15-min bar) stays scoring-only. |
| `apMaxCorrWith(sym, openSyms, bD)` | Max Pearson ρ of 30-day daily log-returns between a candidate and each open position. ρ > `AP_CORR_LIMIT` (0.9) → half-size entry (correlation-aware gate). |
| `loadScoutPromotions()` / `scoutExtraSymbols(base)` | Reads `data/watchlist_dynamic.json` → `_scoutPromos {symbols, details, generated, ageHours, fresh}`. `fresh` = age ≤ `_scoutTtlHours` (config `scout.ttl_hours`, default 6). Fresh promotions merge into the Signals scan + Autopilot; rows get a blue **SCOUT** tag; Command tab shows the 🔭 chip (`renderScoutChip()`). |
| `renderHwmSplitWarning()` | Command-tab warning (`#hwmSplitWarning`) when `data/positions_state.json` and `localStorage.autopilotHwm` both hold an active trailing HWM for one symbol. The Autopilot also seeds `hwm[sym] = max(local, file)` each cycle. |
| `calcADX()` / `adxLabel()` / `calcObvTrend()` | JS ports of `indicators.adx` / `adx_label` / `obv_trend` — display-only ADX + OBV columns in Signals + Scalping. NOT part of `calcSignalScore` (parity exemption). |
| `_signalRrMap` | sym → `{stop, stopDistPct, target, rr}` cached by the Signals scan. Drives the **R:R column** (risk = 4H swing-low stop distance, reward = BB-upper distance) and the trade-modal `#tradeRrInfo` box. Display-only. |
| Min-bars 60 | All five dashboard scoring paths (Signals, Scalping, Breakout, Scanner, Autopilot) gate on `STRAT_CFG.minBarsForSignal` = `data.min_bars_for_signal` (60). Was 55 — parity checklist item 13. |

---

## 2026-06-19 — Loosened gates, 4H swing-low stop, Scalping tab

| Term | Meaning |
|------|---------|
| Swing-low stop (4H) | TA-driven long stop that replaced the fixed −5% hard stop. Sits just below the previous 4H range low — lowest low of the last `swing_low_lookback_bars` (20) completed 4H bars, ×(1−`swing_low_buffer_pct`), clamped so it is never more than `swing_low_max_stop_pct` (8%) below entry. `risk.stop_loss_mode = "swing_low_4h"`. |
| `swing_low_stop_price(entry, lows_4h, …)` | `risk.py` helper returning the swing-low stop price, or `None` when <5 bars or the level isn't below entry (caller then falls back to the fixed `stop_loss_pct`). |
| `should_stop_out(entry, current, stop_price=None)` | `risk.py` — now takes an explicit `stop_price` (the swing-low level); falls back to the fixed `stop_loss_pct` drawdown when `stop_price` is None. |
| `swingLowStop4h(lows4h, entry)` | Dashboard JS mirror of `swing_low_stop_price` (used by Autopilot exits). |
| `downtrend_long_score_threshold` | `config.json › strategy` (= 4.0). Minimum confluence score for a **half-size counter-trend long** in a confirmed daily downtrend. Dashboard const: `SIGNAL_DOWNTREND_LONG_SCORE`. |
| `SIGNAL_BUY_SCORE` / `SIGNAL_HALF_SCORE` | Dashboard consts (3.5 / 2.5) mirroring `strategy.buy_score_threshold` / `buy_score_half_size_threshold`; used by every signal-score display + Autopilot. |
| ⚡ Scalping tab | Low-timeframe confluence scanner (`page-scalp`, `loadScalp()`). TF selector maps the (exec, trend, regime) stack down via `SCALP_TF_MAP` (5m→5m·1h·4h, 15m→15m·1h·4h, 1h→1h·4h·1D) and runs the same `calcSignalScore`. Scanner + manual Buy/Sell (`openTradeModal`); no auto-loop. |
| `SCALP_TF_MAP` | Dashboard map from a scalp timeframe to its `{exec, trend, regime}` bar timeframes. |

---

## 2026-06-17 — Shared Score Distribution tile

| Term | Meaning |
|------|---------|
| `renderScoreDist(elId, scores)` | Shared helper (defined just above `loadSignals`) that renders the 6-point **Score Distribution** tile into the given element id. Buckets an array of scores into ≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR (handles fractional scores) and draws colour-coded horizontal bars. Used by both the Signals tab (`#scoreDist`) and the Market → Scanner sub-tab (`#msScoreDist`) so they render identically. Replaced the Scanner's old per-integer inline list. |

---

## 2026-06-17 — Behavioral Insights tab

| Term | Meaning |
|------|---------|
| `c.activities` | Context field added by `loadContext()` (the newest-first FILL feed it already fetches for `computeFifoStats`). `renderCommand()` uses `c.activities.slice(0,2)` to render the **Latest Activity** block (`#recentActivities`) in the top-left of the 🚦 Trading Permission Rules panel. |
| `apRenderStatusLog()` | Renders the last 3 Autopilot log entries (`apGetLog().slice(-3).reverse()`) into `#tradingStatusLog`, the readout under the big trading-status word in the Command Center. Called by `apRenderLog()` so it stays in sync with the full `#apLog` on every push and on init. |
| `loadInsights()` | Entry point for the 🧠 Insights tab (top-level `page-insights`, id `insights`). On-demand (▶ Analyze). Fetches all FILL history (`edgeFetchAllFills()`), builds round-trips (`insRoundTrips()`), renders 3 KPI tiles + 4 behavioral cards. Analysis-only. |
| `insRoundTrips(activities)` | Dedicated FIFO round-trip matcher for Insights (separate from `computeFifoStats`/`edgeFifoTrades` so the shared engines stay untouched). Returns `{sym, pnl, cost, pnlPct, entryT, exitT}` sorted chronologically by exit time. `cost` = matched entry cost; `pnlPct` = pnl ÷ cost × 100. |
| `insStmt(text, cls)` / `insGap(h)` | Insights render helpers: a coloured headline statement line (`neg`/`pos`/else yellow), and an hour-gap formatter (`m`/`h`/`d`). |
| After-2-Loss Win Rate | Win rate of round-trips that follow ≥2 consecutive losing round-trips (chronological), vs the all-trades baseline. Drives the "win rate drops after losses" insight. |
| Cadence after outcome | Median hours from a round-trip's exit to the next round-trip's entry, split by whether the prior trip won or lost. Shorter gap after wins ⇒ "overtrade after wins". |
| Rule breach (best-effort) | Insights heuristic: **stop-loss breach** = realized `pnlPct < −5` (the −5% hard stop wasn't honored); **cap breach** = entry `cost` > `portCapFor(sym)`% × *current* equity (approximate — historical equity unknown). |

---

## 2026-06-17 — Layout/style consistency sweep

| Term | Meaning |
|------|---------|
| `--hover` | Theme-aware CSS token for control hover backgrounds (`#222b3a` dark / `#e2e7ed` light). Used by `.btn:hover`, `th:hover`, `th.port-sortable:hover`. Replaced hardcoded `#222b3a`/`#21262d` greys that didn't adapt to the light theme. |
| `.spinner` + `@keyframes spin` | Small spinning ring (13px, blue top border) shown inline before portfolio "Loading…" text. Previously referenced by markup but never defined (invisible). |
| `.error` (vs `.error-box`) | The one defined red error-box class. The portfolio error containers (`#portErrorBox`, `#portDistErrorBox`) previously used the undefined `.error-box`; now reuse `.error`. |

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

## 2026-07-07 — Informational indicators ADX + OBV

- `indicators.py` gained `adx()`, `adx_label()`, `obv_series()`, `obv_trend()` — journal-only, not in `signal_score()`, exempt from dashboard parity.
- Journal indicator block now has `adx :` and `obv :` lines between `atr` and `4h`.

## 2026-07-07 — New skills: hourly-research + crypto-catalysts

- `skills/hourly-research-SKILL.md` — procedure for the top-of-hour research pass (per-symbol TA + news block `Research HH:MM GMT+2`); research-only, no orders. Symbol set = watchlist + fresh scout promotions.
- `skills/crypto-catalysts/SKILL.md` — knowledge guide for weighing crypto news/events; defensive only (veto/downsize/flag-to-close, never entries below score gates).
- **Catalyst severity ladder (T1/T2/T3)** — T1 structural (hack, stablecoin depeg, delisting, enforcement naming the asset, chain halt → flag position close + block entries), T2 flow (large token unlock, ETF flow streak, funding > +0.1%/8h, listing, OI extreme → downsize/skip borderline entries), T3 noise (record only). Cited in the research block's `Read:` line, e.g. `flagged to close: SOL/USD — T1 venue exploit headline`.
- **Unlock veto** — skip new entries in an alt with a large (>2–3% supply) token-unlock cliff inside ~7 days, even at full-size score.
- **Skill split convention** — knowledge playbooks live in directories (`skills/<name>/SKILL.md`: crypto-trader, crypto-catalysts); scheduled-routine procedures are flat files (`skills/<name>-SKILL.md`: hourly-research, morning-brief, daily-journal).

## Trading Terms

| Term | Meaning |
|------|---------|
| Confluence score | 6-point TA signal score; ≥3.5 = buy, ≥2.5 = half-size, <2.5 = hold (≥4.0 = half-size counter-trend long in a downtrend); ≤−4 = short, −3 = half-size short, ≥+2 = cover |
| Markov analysis | Dashboard Markov tab. First-order Markov chain over daily close-to-close returns. 3 states via ±1% band (`MK_THRESH`): Up (r>+1%), Flat (|r|≤1%), Down (r<−1%). Builds transition matrix `P(next\|current)`, stationary distribution (power iteration), and next-day forecast from current state. Run for BTC/USD & ETH/USD over 30/60/90/180/365-day windows. Analysis-only, no order routing. Matrix tables use the `.mk-matrix` CSS class (`min-width:0; table-layout:fixed`) to override the global 760px table min-width so they fit their narrow grid panels without overlapping. |
| Transition matrix | 3×3 matrix where cell (i,j) = empirical probability of moving from state i to state j on the next day. Rows sum to 1. |
| Stationary distribution | Long-run state probabilities π satisfying π = πP; computed via power iteration. The Markov tab shows it alongside the empirical state frequencies. |
| Regime block | Daily downtrend detected → all new long entries blocked |
| BB squeeze | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |
| Golden cross | 20 EMA crosses above 50 EMA → bullish |
| Death cross | 20 EMA crosses below 50 EMA → bearish |
| EMA cross state | Detected from last two bars; "golden" / "death" / "neutral" |
| 4H regime | Primary trend filter: 20 EMA vs 50 EMA on 4-hour bars |
| ADX | Average Directional Index (14, Wilder) — trend *strength* 0–100, direction-agnostic. Journal-only informational line (`adx :`), not part of the 6-point score. Labels via `adx_label()`: <20 ranging/weak, 20–25 emerging trend, 25–40 trending, ≥40 strong trend |
| OBV / OBV trend | On-Balance Volume — cumulative volume signed by close-to-close direction. `obv_trend()` compares OBV now vs 20 bars ago with a 5%-of-window-volume dead zone → rising/falling/flat. Journal-only informational line (`obv :`), not scored |
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
| Ticker strip | Top-of-dashboard price bar driven by the active watchlist (`getWatchlist()`, up to 20 symbols — not a static 10); 15-second auto-refresh via Alpaca snapshots API, re-renders immediately on watchlist edits |
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
| Correlation budget | Max open positions total + max per tier are **user-configurable** (defaults loosened 2026-06-19 to 4 total, 3 per tier; Tier-1: BTC/USD+ETH/USD; Tier-2: alts). New entries blocked when either limit is reached. Python reads `config.json › risk.max_open_positions` / `max_positions_per_tier` (checked by `correlation_budget_allows()` in `risk.py`); the dashboard Autopilot reads `getSettings().limits.maxOpenPositions` / `maxPositionsPerTier` (Settings › 🔗 Correlation Budget) live via `apMaxPositions()` / `apMaxPerTier()` |
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
| _activateSubTab(parentId, subId) | Generic dashboard helper powering both parent tabs' sub-tabs. Scoped to `#page-<parentId>`, it toggles the `.subpage` divs + `.subtab-btn` buttons within that parent (so 🌐 Market and 🔬 Analytics never clash), then mirrors `subId` to the URL hash + `localStorage.lastTab`. `marketSubTab`/`analyticsSubTab` are thin wrappers that add validation + lazy-loading. (CSS `.subnav`/`.subpage` were renamed from `.market-subnav`/`.market-subpage` when generalised 2026-06-17; button ids unified to `subtab-<subId>`.) |
| Market tab / page-market | Single nav tab merging Market Overview + Scanner + Breakout (2026-06-17). `switchTab('market')` shows `page-market`; the shared `.subnav`/`.subtab-btn` bar switches the three `.subpage` divs (`subpage-market-overview`/`subpage-market-signals`/`subpage-gapgo`). Middle sub-tab labelled **🔭 Scanner** (renamed from "Signals" to fix the duplicate-name bug; sub-id stays `market-signals`) |
| Analytics tab / page-analytics | Single nav tab merging Performance + P&L + Edge (roadmap, 2026-06-17), in the **📊 Analysis** nav section. `switchTab('analytics')` shows `page-analytics`; `.subpage` divs `subpage-performance`/`subpage-pnl`/`subpage-edge`. Performance auto-loads (`refreshCurrent`→`loadDashboard`); P&L on select (`loadPnl`); Edge manual |
| MARKET_SUBS / ANALYTICS_SUBS | Const arrays of each parent tab's valid sub-ids — `["market-overview","market-signals","gapgo"]` and `["performance","pnl","edge"]`. Single source of truth used by `marketSubTab`/`analyticsSubTab` (validation), `applyTabFromUrl()` (`SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)`, deep-link resolution), and `switchTab()` (redirect guard: any sub-id → its parent + sub-tab, so keyboard shortcuts / `#gapgo` / `#pnl` / legacy `switchTab('pnl')` keep working) |
| marketSubTab(subId) / analyticsSubTab(subId) | Wrappers over `_activateSubTab` for the two parent tabs: validate `subId` against `MARKET_SUBS`/`ANALYTICS_SUBS`, store `_marketSub`/`_analyticsSub` for restore, and lazy-load (Overview / Performance auto-load; P&L on select; Scanner/Breakout/Edge manual). Cross-link buttons in each sub-tab header call them |
| Breakout sub-tab / subpage-gapgo | Pre-session breakout/gap analysis, formerly the standalone `gapgo` tab, folded into the Market tab as the third sub-tab 2026-06-17. `loadGapGo()` renders Conviction (±7) + Signal (`calcSignalScore`; the `/6` suffix was dropped 2026-06-29) per card; manual run. Element `subpage-gapgo`, button `subtab-gapgo` |
| Market Overview sub-tab | Dashboard sub-tab (inside the Market tab) showing live price, 24h%, 7d%, volume, trend and cap tier; auto-loads on selection; includes momentum heatmap. Symbol set is the shared `getCryptoUniverse()` filtered to `/USD` pairs (`usdPairsOnly()`, bugfix 2026-07-09 v2) and sliced by the Max Symbols setting (`MO_SYMBOLS = usdPairsOnly(universe).slice(0, n)`) — no longer hardcoded to 30; symbol cells show the full pair. Each row has a **Trade** column with Buy/Sell buttons (`moTradeButtons()`) |
| moTradeButtons(row) | Dashboard fn rendering the Market Overview row's Buy/Sell buttons; calls `openTradeModal(row.sym→BTCUSD, displaySym, side, '', row.price)` (qty blank, side+price pre-filled). Returns `–` when the row has no live price. Reuses the shared trade modal — no new submit logic |
| populateWatchlistOptions() | Dashboard fn filling the Settings watchlist `<datalist id="watchlistSymbolOptions">` from `getCryptoUniverse()`, excluding already-added symbols. Called from `renderWatchlistTags()` so it re-syncs after add/remove/reset. Powers the watchlist add-symbol dropdown (`<input list>`); degrades to free-text if the assets call fails. When the **Show stablecoins** checkbox (`#watchlistShowStable`, default off) is checked, also appends `getStablecoinPairs()` so stablecoin pairs appear in the dropdown |
| getStablecoinPairs() / _stablecoinUniverse | `_stablecoinUniverse` is the list of stablecoin `*/USD` pairs found in the tradable universe — collected (not just dropped) by `getCryptoUniverse()` alongside `_cryptoUniverse`. `getStablecoinPairs()` awaits the universe build then returns it. Used only by the Settings symbol selector's opt-in **Show stablecoins** filter; the trading universe / scans never include these |
| Market Signals sub-tab | Dashboard sub-tab (inside the Market tab) running the full 6-point confluence scan on demand across `getCryptoUniverse()` filtered to `/USD` pairs (`usdPairsOnly()`, bugfix 2026-07-09 v2 — USDT/USDC duplicates removed), capped by the Max Symbols setting; same scoring engine as the watchlist Signals tab. Symbol cells show the full pair (`BTC/USD`). Has a per-symbol Watchlist column (`msWatchlistCell()`) |
| msWatchlistCell(row) / msAddWatch / msRemoveWatch | Market Signals Watchlist-column helpers. `msWatchlistCell()` renders **+ Watch** when score ≥ 4 and symbol not on watchlist, **– Unwatch** when score ≤ −2 (sell) and no open position (`_msOpenPosSyms`), else ✓ watched / – (or "full" at the 20-cap). The buttons call `msAddWatch`/`msRemoveWatch`, which mutate the shared watchlist (`saveWatchlistData`+`renderWatchlistTags`) and re-render only the cells via `renderMsWatchlistCells()` (cached `_msLastRows`, cells keyed `mswl-<alpSym>`) — no rescan |
| _msOpenPosSyms / _msLastRows | Market Signals globals: `_msOpenPosSyms` is a Set of `BASE/QUOTE` symbols with an open position (normalized via `toSlash`, from `/v2/positions`, fetched in `loadMarketSignals`) used to gate the Watchlist – Unwatch button; `_msLastRows` caches the last scanned rows so watchlist cells can re-render without a rescan |
| symbolInfo(sym) / _universeRank | `symbolInfo()` returns a symbol's display info: curated `TOP30_INFO` when known, else `{ rank: _universeRank[sym] (1-based universe position), tier:"?", capLabel:"?", name: baseTicker(sym) }`. `_universeRank` is rebuilt by `rebuildUniverseRank()` at the end of `getCryptoUniverse()`. Used by Market Overview + Market Signals so every row has a contiguous rank instead of `#?` |
| getCryptoUniverse() | Dashboard fn that fetches the full tradable crypto universe once (`/v2/assets?asset_class=crypto&status=active`), caches it in `_cryptoUniverse`, and orders it as still-tradable `TOP30_SYMBOLS` first then the rest alphabetically. Robust to symbol format: normalizes both `BTC/USD` and bare `BTCUSD` to `BASE/QUOTE`. Accepts quotes in `ALLOWED_QUOTES` (**USD, USDT, USDC** — so `BTC/USDT`/`ETH/USDC` are included, roadmap 2026-06-19), drops other quotes (BTC-quoted etc.), and drops stablecoin bases (see `STABLECOIN_BASES`). Falls back to `TOP30_SYMBOLS` on failure/empty **without caching it** (fixed 2026-06-18) — only a real, non-empty result is stored in `_cryptoUniverse`, so a failed first call (e.g. on page load before credentials are seeded) retries instead of sticking the universe at 30 for the session and capping every scan below `maxSignalSymbols`. Shared by **both** Market Signals and Market Overview (and the Settings watchlist dropdown), replacing the 30-symbol ceiling so `maxSignalSymbols` can exceed 30 on both |
| ALLOWED_QUOTES | Dashboard const `{USD,USDT,USDC}` — the quote currencies `getCryptoUniverse()` keeps. Added 2026-06-19 to allow stablecoin-quoted pairs (BTC/USDT, ETH/USDC) into the dashboard universe; pairs in any other quote (BTC-quoted, EUR, …) are dropped. `addWatchlistSymbol()` validates against the same three quotes. Since the 2026-07-09 v2 bugfix the USDT/USDC pairs feed only the Settings watchlist selector — the scan surfaces filter them out via `usdPairsOnly()` |
| usdPairsOnly(universe) | Dashboard helper (bugfix 2026-07-09 v2) — filters the shared crypto universe to symbols ending `/USD`. Applied by `loadMarketSignals()` (Scanner), `loadMarketOverview()`, and `updateScanBtnLabel()`'s ceiling clamp, because Alpaca executes trades against USD and the mixed USDT/USDC quotes made the same base appear up to 3× per scan (all displayed as the bare base ticker). Scan-surface symbol cells now also render the full pair (`tvLink(row.sym)` → `BTC/USD`) instead of `baseTicker()` |
| baseTicker(sym) | Dashboard helper returning the base asset before the slash (`BTC/USDT`→`BTC`, `BTC/USD`→`BTC`, bare `BTC`→`BTC`). Replaced display-only `sym.replace("/USD","")` calls everywhere once USDT/USDC quotes entered the universe (the old strip turned `BTC/USDT` into `BTCT`). Display labels only — order symbols still use `sym.replace("/","")` |
| STABLECOIN_BASES | Dashboard const set of stablecoin base symbols (USDT, USDC, DAI, USDP, PYUSD, TUSD, BUSD, GUSD, USDG, FDUSD, USDD, FRAX, LUSD, USTC) excluded from the trading universe by `getCryptoUniverse()` — a `USDT/USD`/`USDC/USD` pair is just the stablecoin priced in dollars, never a tradeable setup, so it must not pollute scans/overview. Since 2026-06-19 these pairs are *collected* into `_stablecoinUniverse` (see `getStablecoinPairs()`) so the Settings symbol selector's opt-in **Show stablecoins** filter can offer them in the watchlist dropdown only |
| _msPrevScores | Dashboard JS cache (`{}` keyed by symbol) storing confluence scores from the last Market Signals scan; read by Market Overview to populate its Score column |
| applyTabFromUrl() | Dashboard fn that resolves the active tab from the URL hash, then `localStorage.lastTab`, and activates it. Called at end of `bootstrapDashboard()` and on `hashchange`. Enables deep-linking to a tab (`#signals`) and restoring the last tab on browser refresh. A `SUBS = MARKET_SUBS` list (`market-overview`/`market-signals`/`gapgo`) makes it recognise Market sub-tab ids and open the parent `market` tab + sub-tab (sets `_marketSub` first to skip a wasted Overview load when deep-linking to a non-Overview sub-tab) |
| nav-section-label / nav grouping | Sidebar tabs grouped under `.nav-section-label` headers: ⚡ Trade (Signals · Market · Execution) · 💼 Portfolio (Overview · Allocation · Risk) · 📊 Analysis (🔬 Analytics · Backtest vs Live · Markov); Command + Settings are ungrouped anchors. (As of v2026-06-17.17: Performance/P&L/Edge live inside the 🔬 Analytics parent tab, and the standalone Positions tab was dropped.) Keyboard `TAB_ORDER` (keys 1-9) follows the visual order |
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
| `maxSignalSymbols` | `getSettings().limits.maxSignalSymbols` — sets how many symbols the Market Signals scanner analyses. Default 30, minimum 1, **no upper clamp**. `loadMarketSignals()` uses `SCAN_SYMBOLS = universe.slice(0, n)` where `universe = usdPairsOnly(getCryptoUniverse())` (full tradable Alpaca crypto list filtered to `/USD` pairs since the 2026-07-09 v2 bugfix, no longer the 30-symbol `TOP30_SYMBOLS`), so values above 30 genuinely scan more symbols. Also caps Market Overview's row count (same setting, same filtered universe); does not affect the watchlist Signals tab. |
| `maxOpenPositions` / `maxPositionsPerTier` | `getSettings().limits.*` — user-configurable Autopilot correlation-budget caps (Settings › 🔗 Correlation Budget; inputs `setMaxOpenPositions` / `setMaxPositionsPerTier`, defaults 4 / 3, min 1). Read live each cycle by `apMaxPositions()` / `apMaxPerTier()`; replaced the old hardcoded `AP_MAX_POSITIONS` / `AP_MAX_PER_TIER` consts. Dashboard-Autopilot only — the Python eval loop uses `config.json › risk.max_open_positions` / `max_positions_per_tier`. |
| `updateScanBtnLabel()` | Sets the Market Signals scan button (`#msScanBtn`) text from `maxSignalSymbols`. Called on page init, after `saveSettings()`, and at the start of `loadMarketSignals()`. **Clamps to the real universe size** when `_cryptoUniverse` is loaded — `usdPairsOnly(_cryptoUniverse).length` since the 2026-07-09 v2 bugfix: `▶ Scan Top <universe> (all available)` when Max Symbols exceeds the tradable `/USD` pairs Alpaca offers, else `▶ Scan Top <min(n, universe)>`. Honest indicator of the active cap (2026-06-18) — the universe, not the setting, is the true ceiling. |
| USD-pair universe ceiling | Alpaca lists only ~20–33 tradable `*/USD` crypto pairs (its ~56 total pairs include USDT/USDC/BTC quotes — USDT/USDC stay in the universe for the watchlist selector but are filtered off the scan surfaces by `usdPairsOnly()` since 2026-07-09 v2; other quotes are dropped outright). So Max Symbols > ~33 can't be satisfied; the Scanner button and the Scanner + Market Overview status lines say so explicitly rather than implying more symbols exist. This is the resolution of the "only 33 scanned while setting is 60" bug — a real exchange limit, not a defect. |
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
| `computeFifoStats(activities)` | `dashboard_professional.html` | Shared FIFO realized-P&L engine. Returns `{totalPnl, wins, losses, winPnl, lossPnl, winRate, profitFactor, avgWin, avgLoss, tradeRows}`. Long-only buy→sell matching. Single source of truth for both the P&L tab (`loadPnl`) and Backtest tab (`renderBacktest` via `c.fifoStats`). **Must be fed the full paginated FILL history via `edgeFetchAllFills()` — a single 100-fill page truncates the realized total and mis-books SELLs whose matching BUY predates the window as $0 "wins" (fixed 2026-07-06). All three feeders (`loadContext`, `loadPnl`, `generateDailyJournal`) now use `edgeFetchAllFills()`.** A SELL is only counted as a realized trade when it matched a prior BUY (`matchedQty > 1e-9`); an unmatched SELL (empty FIFO queue) stays in the trade log with `pnl: null` and is excluded from win/loss stats — so it can no longer book a phantom $0 "win" (hardened 2026-07-07, aligns with `edgeFifoTrades`/`insRoundTrips`). |
| `tradingDaysPerYear` | `dashboard_professional.html` (`DEFAULT_LIMITS`) | Annualization factor for Sharpe/Sortino/Calmar and annualized volatility (`× √tradingDaysPerYear`). **Set to `365`, not 252** — crypto trades 24/7 and the portfolio-history feed returns daily calendar points, so annualization must use 365 (matches `scripts/metrics.py` `annualization_factor("1D") = 365.0`). Was `252` (equity-market convention) until 2026-07-07, which understated all annualized KPIs by √(252/365) ≈ 0.83. |

---

## Python ↔ Dashboard Parity Notes

Critical implementation details to keep `indicators.py` and `dashboard_professional.html` in sync:

| Concern | Detail |
|---------|--------|
| MACD NaN prefix | `macdLine` has NaN for indices 0–24 (ema26 only valid from index 25). Must strip NaN before calling `emaArr` for signal EMA, then re-pad to original length. Otherwise signal line = NaN always (MACD always 0). |
| Buy/half thresholds | Loosened 2026-06-19. Python: `score >= 3.5` full, `>= 2.5` (`< 3.5`) half — `strategy.buy_score_threshold` / `buy_score_half_size_threshold`. Dashboard: consts `SIGNAL_BUY_SCORE` (3.5) / `SIGNAL_HALF_SCORE` (2.5). Keep in sync. |
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
| 3 | Long stop-loss | 4H swing low (lowest low of last 20 4H bars, ≤8% below entry) → immediate SELL; −5% fallback if no 4H data |
| 3b | Short stop-loss | +5% above entry → immediate COVER |
| 4 | TA exit (long) | Score ≤ −2 → SELL |
| 4b | TA cover (short) | Score ≥ +2 → COVER |
| 5 | Buy gate | Score ≥3.5/6 full size; ≥2.5 (<3.5) half-size (loosened 2026-06-19) |
| 5b | Short gate | Score ≤−4/6 full size; score=−3/6 half-size if R:R≥1:3; downtrend only |
| 6 | Long regime gate | Uptrend/mixed: buy ≥2.5/≥3.5. Downtrend: half-size counter-trend long only at score ≥4.0 |
| 6b | Short regime gate | Shorts ONLY in confirmed daily downtrend; blocked in uptrend/mixed |
| 7 | Sizing | ATR: qty=(equity×1%)/(ATR×1.5), cap at 5% equity |
| 8 | Order routing | All via `scripts/trade.py`; direct API calls forbidden |
| 9 | Journal | Every day, even quiet ones |
| 10 | Partial TP (2026-07-09) | +1R → sell 50%, remaining stop → breakeven (fires once per position) |
| 11 | Stale exit (2026-07-09) | Held > 48h + trail unarmed + score < 2.5 → SELL at normal band |
| 12 | Rotation (2026-07-09) | Budget full: candidate ≥ 4.0 scoring ≥ +2.0 above a weakest holding ≤ 0 → swap same cycle |
| 13 | Net R:R gate (2026-07-09) | Net of 2×25 bps fee + spread: < 1.0 block, 1.0–1.5 half-size |
| 14 | Over-budget (2026-07-09) | Positions > budget → journal warning + Command chip; optional trim (config-flagged) |
