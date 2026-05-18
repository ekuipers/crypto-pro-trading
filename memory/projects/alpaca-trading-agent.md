# Project: Alpaca Trading Agent

**Status:** Active — paper trading only  
**Account:** PA3EZEE1I9RS  
**Root:** `C:\Users\An\OneDrive\Documenten\Claude\Projects\Alpaca\alpaca-trading-agent`  
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
├── dashboard/
│   ├── dashboard.html                 ← Legacy dashboard (5 tabs: Overview, Hot Symbols, Distribution, Morning Brief, Settings)
│   ├── dashboard_professional.html    ← Primary dashboard (10 tabs — see dashboard_layout.md)
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

| Name | Cron | What it does |
|------|------|-------------|
| `morning-brief` | `0 7 * * *` | Runs verify.py + run_evaluation.py; writes ## Morning Brief block to journal; opens dashboard; gives Erik a short summary |

---

## Session History

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

**`dashboard/dashboard.html` — Morning Brief tab added:**
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

## Dashboard — Professional (`dashboard_professional.html`)

10 tabs (key `1`–`9` + Settings):

| # | Tab | Key feature |
|---|-----|-------------|
| 1 | 🧭 Command | Trading permission status, cash reserve gate, hard rules panel, trade modal |
| 2 | 📈 Performance | Equity curve, rolling 30D/90D Sharpe, win rate, profit factor |
| 3 | ⚠️ Risk | MDD, Sharpe, Sortino, portfolio cap usage, concentration panel |
| 4 | 📂 Positions | P&L%, stop distance (vs −5%), cap usage per position |
| 5 | 🎯 Execution | Orders table, cancel-all, ATR Position Sizer |
| 6 | 📡 Signals | Live 6-point confluence scanner, browser notification on score ≥ 4 |
| 7 | 💰 P&L | FIFO-matched realized P&L, calendar heatmap, CSV export |
| 8 | 🧪 Backtest vs Live | Walk-forward report loader, strategy health indicator |
| 9 | 🔥 Gap & Go | Pre-session analysis: catalyst rating, supply risk, 6M range, key levels, historical gap-and-go rate, trade plan (entry/stop/T1/T2), risk rating — all 10 symbols ranked by conviction score |
| — | ⚙ Settings | API keys, mode toggle, notification permission |

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
