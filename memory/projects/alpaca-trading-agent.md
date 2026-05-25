# Project: Alpaca Trading Agent

**Status:** Active — paper trading only  
**Account:** PA3EZEE1I9RS  
**Root:** `C:\Claude\Projects\alpaca-trading-agent`  
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
├── memory.md                    ← Hot cache (this project's working memory)
├── memory/
│   ├── glossary.md              ← Full decoder ring
│   └── projects/
│       └── alpaca-trading-agent.md  ← This file
├── config.json                  ← Central config: strategy, risk, indicators, portfolio caps, watchlist
├── scripts/
│   ├── run_evaluation.py        ← Main eval loop; run with --execute to trade
│   ├── indicators.py            ← TA library: RSI, MACD, BB, ATR, EMA cross, vol ratio
│   ├── trade.py                 ← Order placement (enforces all hard rules)
│   └── verify.py                ← API smoke test
├── journal/
│   └── YYYY-MM-DD.md            ← Daily trading journals (append, never overwrite)
├── docs/
│   ├── portfolio-dashboard.html       ← Legacy dashboard (5 tabs: Overview, Hot Symbols, Distribution, Morning Brief, Settings)
│   ├── dashboard_professional.html       ← Primary dashboard (12 tabs — see dashboard_layout.md)
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
| 07:00 daily | Morning brief (scheduled task) — eval + journal + dashboard |
| 23:21 daily | Closing journal entry |

---

## Scheduled Tasks (Cowork)

| Name | Cron | Status | What it does |
|------|------|--------|-------------|
| `morning-brief` | `0 7 * * *` | enabled | Runs verify.py + run_evaluation.py; writes ## Morning Brief block to journal; opens dashboard; gives Erik a short summary |
| `morning-evaluation` | `0 9 * * *` | **disabled** | Daily evaluation — compute signals for all watchlist symbols and execute trades where warranted |
| `daily-journal` | `21 23 * * *` | enabled | Closing journal entry — summarise trades, P&L, and market observations |

---

## Session History

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
- Note: smaller-cap symbols (1INCH, ENS, SNX, SUSHI, etc.) may return "Not available on Alpaca" — handled gracefully with an informational row.

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

## Portfolio Dashboard (`dashboard_professional.html`)

10 tabs (key `1`–`9` + Settings):

| # | Tab | Key feature |
|---|-----|-------------|
| 1 | 🧭 Command | Trading permission status, cash reserve gate, live hard rules panel (6 real-time checks), trade modal |
| 2 | 📈 Performance | Equity curve, rolling 30D/90D Sharpe, win rate, profit factor |
| 3 | ⚠️ Risk | MDD, Sharpe, Sortino, portfolio cap usage, concentration panel, 10×10 correlation heatmap |
| 4 | 📂 Positions | P&L%, Stop $ / Target $, Live R:R column, cap usage per position |
| 5 | 🎯 Execution | Orders table, cancel-all, ATR Position Sizer |
| 6 | 📡 Signals | Live 6-point confluence scanner (paginated bars), trend arrows ↑↓→, ATR qty, ⚡ quick-buy, browser notification on score ≥ 4 |
| 7 | 💰 P&L | FIFO-matched realized P&L, calendar heatmap, P&L attribution by symbol, day-of-week performance, CSV export |
| 8 | 🧪 Backtest vs Live | Walk-forward report loader, strategy health indicator |
| 9 | 🔥 Gap & Go | Pre-session analysis: catalyst rating, supply risk, 6M range, key levels, historical gap-and-go rate, trade plan (entry/stop/T1/T2), risk rating — all 10 symbols ranked by conviction score |
| — | ⚙ Settings | API keys, mode toggle, notification permission |

**Top-of-page live ticker strip** — shows all 10 symbols with price + 24h change. Auto-refreshes every 15 s via `setInterval`. Uses `/v1beta3/crypto/us/snapshots` endpoint.

**3-mode auto-refresh button** — `Auto OFF` → `Prices 15s` (ticker only) → `Full 60s` (ticker + full dashboard).

Data source for Gap & Go: `https://data.alpaca.markets/v1beta3/crypto/us/bars` — 6M daily + 8D hourly bars fetched in parallel.

---

## Known Issues (as of 2026-05-14)

| Issue | Detail | Action needed |
|-------|--------|---------------|
| All 9 positions over 5% cap | Range 9.7–14.8%; hard rule violation | Trim each to ≤5% equity (~$4,966 per position) |
| Cash at 1.1% | $1,111 of ~$99,329 equity | Need to free up cash via trimming |
| DOGE daily downtrend | close < 50-SMA AND 20-SMA < 50-SMA | Regime blocked; no new buys; watch for take-profit at +10% |
| AAVE daily downtrend | Same as DOGE | Regime blocked |
| SOL near stop | −2.07% (stop at −5%) | Watch closely |

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
