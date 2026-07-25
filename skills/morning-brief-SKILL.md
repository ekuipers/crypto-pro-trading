---
name: morning-brief
description: Daily 7 AM morning brief — portfolio health, alerts, and signal confluence
---

You are an autonomous crypto trading agent managing a paper portfolio on Alpaca. Run the daily morning brief for Erik.

## Your task

Produce a structured morning brief covering portfolio health, risk alerts, and signal confluence for every symbol in the watchlist. Then open the dashboard so Erik can see the live Morning Brief tab.

## Step 1 — Fetch portfolio state

Check connectivity, then run a local dry-run of the Node evaluator to get the full
signal-confluence readout for every watchlist symbol:

```bash
set -a; source .env; set +a
curl -s -o /dev/null -w "%{http_code}\n" "$APCA_BASE_URL/v2/account" \
  -H "APCA-API-KEY-ID: $APCA_API_KEY_ID" -H "APCA-API-SECRET-KEY: $APCA_API_SECRET_KEY"

node src/runEvaluation.js   # dry-run: full indicator readout, no orders placed
```

## Step 2 — Write the brief to the journal

Append a `## Morning Brief HH:MM GMT+2` block to today's journal file at `journal/YYYY-MM-DD.md` with the following sections:

### Portfolio Health
- Total equity, cash (and cash % of equity)
- Total unrealized P&L
- Number of open positions, noting direction (long / short) for each

### 🚨 Alerts (flag any of the following)
- Any position exceeding its per-symbol cap (config.json › portfolio_caps.caps) → must trim
- Any **long** position at −4% or worse from entry → near stop-loss (hard stop at −5%)
- Any **short** position at +4% or worse from entry (price rose) → near stop-loss (hard stop at +5%)
- Any **long** position with a confluence score ≤ −2 → TA exit signal triggered
- Any **short** position with a confluence score ≥ +2 → TA cover signal triggered
- Cash below 25% of equity → buying power running low (hard floor is 20%)
- Daily regime = downtrend for any held **long** position → regime has turned against us
- Daily regime ≠ downtrend for any held **short** position → regime no longer supports the short

### 📡 Signal Confluence (one line per watchlist symbol)
For each symbol in the watchlist, report:
- Symbol, score (X/6), 4H regime, daily regime, action (BUY / HALF-BUY / SHORT / HALF-SHORT / COVER / TA EXIT / HOLD / REGIME BLOCK)

Use the output from `node src/runEvaluation.js` (which already computes all of this).

Action mapping:
- score ≥ 4 AND daily not downtrend → **BUY** (full size)
- score 3–3.9 AND daily not downtrend → **HALF-BUY** (half size, R:R ≥ 1:3 required)
- score ≤ −4 AND daily downtrend → **SHORT** (full size)
- score −3 to −3.9 AND daily downtrend → **HALF-SHORT** (half size, R:R ≥ 1:3 required)
- open short AND score ≥ +2 → **COVER** (TA cover)
- open long AND score ≤ −2 → **TA EXIT**
- otherwise → **HOLD**

### 📝 Market Notes
Two or three sentences on the broad crypto market conditions based on today's price action across the watchlist. Note any BB squeezes, broad RSI levels, 4H regime changes, or notable divergences.

## Step 3 — Open the dashboard

Start the dashboard (`npm start` from the project root, or it may already be running/deployed
on Vercel) and tell Erik to open it in a browser — `http://localhost:3000` locally, or the
Vercel deployment URL — and click the 🌅 Morning Brief tab for the live signal confluence view.

## Output format

After running everything, give Erik a short summary (5–8 lines) covering:
1. Equity and cash status
2. Any red alerts
3. The top-scoring symbol(s) from the confluence table
4. One market observation
5. A reminder that the full interactive brief is in the dashboard

Keep the tone professional but conversational — like a trading desk morning note.

## Context

- Project root: `c:\Claude\Projects\CryptoPro Trader`
- Watchlist: config.json › watchlist.symbols (BTC/USD, ETH/USD, SOL/USD, AVAX/USD, LINK/USD, DOT/USD, LTC/USD, DOGE/USD, ADA/USD, AAVE/USD)
- Hard rules (per CLAUDE.md):
  - Cash reserve ≥ 20% at all times
  - Per-symbol position caps from config.json › portfolio_caps.caps (BTC=30%, ETH=15%, ADA/SOL=10%, DOGE=8%, LTC/DOT=6%, LINK/AVAX/AAVE=5%)
  - Limit orders only; stop-loss at −5% (long) / +5% (short)
  - TA exit: long exits when score ≤ −2; short covers when score ≥ +2
  - Long entry: score ≥ 4 (full) or 3–3.9 (half, R:R ≥ 1:3), daily not downtrend
  - Short entry: score ≤ −4 (full) or −3 to −3.9 (half, R:R ≥ 1:3), daily downtrend only
  - All scores computed by the Node engine (`src/evaluateSymbol.js`/`src/indicators.js`) using the 6-point confluence table (EMA×, MACD, RSI, BB %b, Volume, 4H regime)
- Timezone: GMT+2 (Amsterdam)
