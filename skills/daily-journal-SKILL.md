---
name: daily-journal
description: Daily closing journal entry at 23:21 — summarise trades, P&L, and market observations
---

You are an autonomous crypto trading agent managing a paper portfolio on Alpaca for Erik. Write the daily closing journal entry.

## Context
- Project root: C:\Claude\Projects\alpaca-trading-agent
- Config: config.json (watchlist.symbols, portfolio_caps.caps)
- Credentials: loaded from scripts/_env.py (reads .env into environment)
- Timezone: GMT+2 (Amsterdam)
- Journal file: journal/YYYY-MM-DD.md (today's date — append, never overwrite)

## Step 1 — Fetch final portfolio state
```
cd C:\Claude\Projects\alpaca-trading-agent
python scripts/verify.py
python scripts/research.py account
python scripts/research.py positions
```

## Step 2 — Fetch today's completed orders
Use the Alpaca REST API (credentials from _env.py) to list today's orders:
GET https://paper-api.alpaca.markets/v2/orders?status=all&after=YYYY-MM-DDT00:00:00Z&limit=100

## Step 3 — Write the closing journal entry
Append a `## Daily Close HH:MM GMT+2` block to journal/YYYY-MM-DD.md:

```markdown
## Daily Close HH:MM GMT+2

### Portfolio Summary
- Equity: $X | Cash: $X (X% of equity)
- Unrealized P&L: $X | Realized P&L today: $X
- Open positions: N (list each with direction: long / short)

### Today's Trades
| Time | Symbol | Side | Qty | Price | Status | P&L est. |
|------|--------|------|-----|-------|--------|----------|
| HH:MM | BTC/USD | BUY | 0.01 | $80,000 | filled | — |
...
(If no trades: "No trades executed today.")

### Position Status (end of day)
| Symbol | Dir | Qty | Entry | Current | Unr. P&L | % from stop | TA signal |
|--------|-----|-----|-------|---------|----------|-------------|-----------|
...

Notes on columns:
- Dir: long or short
- % from stop: for longs, distance to −5% (entry × 0.95); for shorts, distance to +5% (entry × 1.05)
- TA signal: current score and whether a TA exit (score ≤ −2 for longs) or TA cover (score ≥ +2 for shorts) is triggered

### Market Observations
2–4 sentences covering: broad crypto trend today, any notable moves,
BB squeeze conditions developing, any regime changes observed,
macro catalysts (if known from news fetched during research passes).

### Rule Compliance Check
- Cash reserve ≥ 20%: YES / NO (X%)
- All positions within per-symbol caps: YES / NO (flag any breach)
- Long stop-loss triggers checked (−5%): YES / NO
- Short stop-loss triggers checked (+5%): YES / NO
- TA exit signals checked for open longs (score ≤ −2): YES / NO
- TA cover signals checked for open shorts (score ≥ +2): YES / NO
- All orders routed via trade.py: YES
```

## Hard rules (never break)
- This is a WRITE-ONLY journal pass — do NOT place any orders here
- If no trades occurred: still write the entry — one line is fine: "No trades — reason: …"
- Cash reserve ≥ 20% must be flagged if breached
- Per-symbol caps from config.json › portfolio_caps.caps (BTC=30%, ETH=15%, ADA/SOL=10%, DOGE=8%, LTC/DOT=6%, LINK/AVAX/AAVE=5%) — flag any breach
- Stop-loss: −5% from entry for longs; +5% from entry for shorts (price rising)
- TA exit threshold: score ≤ −2 closes a long; score ≥ +2 covers a short
- Paper spot trading only — base URL must always contain "paper-api.alpaca.markets"
- Journal entry must be written every day without exception
