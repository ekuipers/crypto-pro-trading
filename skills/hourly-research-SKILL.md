---
name: hourly-research
description: Hourly research routine (top of every hour) — per-symbol TA snapshot + news scan appended to the daily journal so evaluations always have research ≤1 hour old
---

You are an autonomous crypto trading agent managing a paper portfolio on Alpaca for Erik. Run the hourly research routine. This is the **top-of-the-hour** pass that feeds the `:23` evaluation — evaluations must always have research no more than ~1 hour old.

## Context
- Project root: c:\Claude\Projects\CryptoPro Trader
- Symbols: config.json › watchlist.symbols, **plus** any scout-promoted symbols in
  data/watchlist_dynamic.json when config.json › scout.enabled is true and the file
  is younger than scout.ttl_hours (6)
- Credentials: `.env` (APCA_API_KEY_ID / APCA_API_SECRET_KEY / APCA_BASE_URL) — same vars
  the Node engine reads (`src/trade.js`)
- Timezone: GMT+2 (Amsterdam)
- Journal file: journal/YYYY-MM-DD.md (today's date — append, never overwrite)

## Step 1 — Fetch data per symbol

For the full indicator readout (all 6 confluence signals, one pass, no orders placed —
same engine the live `:XX` evaluation uses), run a local dry-run of the Node evaluator:

```bash
node src/runEvaluation.js            # dry-run: full indicator readout, no orders placed
```

For per-symbol news headlines, call Alpaca's data API directly:

```bash
set -a; source .env; set +a   # load APCA_API_KEY_ID / APCA_API_SECRET_KEY into the shell

curl -s "https://data.alpaca.markets/v1beta1/news?symbols=BTC/USD&limit=5" \
  -H "APCA-API-KEY-ID: $APCA_API_KEY_ID" \
  -H "APCA-API-SECRET-KEY: $APCA_API_SECRET_KEY"
```

## Step 2 — Append the research block

Append a `## Research HH:MM GMT+2` block to today's journal with one sub-section per symbol:

```markdown
## Research HH:MM GMT+2

### TICKER
- Last close (15-min): $
- 15-min EMA 20/50: golden / death / neutral
- 4H EMA 20/50: golden / death / neutral
- Daily regime: uptrend / downtrend / mixed (ma20= ma50= last=)
- RSI (14): __ (divergence?)
- MACD (12/26/9): line= signal= hist= (flip: bullish/bearish/none)
- Bollinger (20, 2): %b= bandwidth= trend= squeeze?
- ADX (14): __ (ranging/emerging/trending/strong)  · OBV: rising/falling/flat
- Recent news (top 1–3 headlines):
  - …
- Read: 1–2 sentences — bias, setups forming, and any catalyst flag.
```

Keep the `Read:` line honest and terse. If a headline or event materially threatens an
**open position**, flag it explicitly — the evaluation's take-profit rule acts on
research close flags ("flagged to close: SYMBOL — reason").

## Step 3 — Interpret, don't just record

- Score interpretation, Wyckoff phase, and indicator meaning: follow
  `skills/crypto-trader/SKILL.md`.
- News and event weighing (ETF flows, unlocks, hacks, depegs, funding extremes, macro):
  follow `skills/crypto-catalysts/SKILL.md`.

## Hard rules (never break)
- This is a RESEARCH-ONLY pass — do NOT place any orders here. Orders happen at the
  live `evaluate` job (Node engine, Vercel Cron dispatcher — see CLAUDE.md › "Node.js port"),
  routed through `src/trade.js`.
- Never skip a symbol; if data fetch fails, write "data unavailable — reason" for it.
- Append only; never overwrite earlier blocks.
- News can flag a position for closing (take-profit rule) or argue for skipping an entry,
  but it never justifies an entry below the score gates.
