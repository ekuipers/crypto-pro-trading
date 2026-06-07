# Journal -- YYYY-MM-DD

## Account Snapshot (00:00 UTC)
- Equity: $
- Cash: $
- Buying power: $
- Open positions: N

## Research HH:MM UTC
For each symbol on the watchlist (this block is appended every hour at :30 UTC+1):

### TICKER
- Last close (15-min): $
- Intraday 20-period MA (5h):  $
- Intraday 50-period MA (12.5h): $
- Daily 20-day MA: $       (regime filter)
- Daily 50-day MA: $       (regime filter)
- Daily regime: uptrend / downtrend / mixed
- RSI (14): __ (oversold <30, overbought >70, divergence?)
- MACD (12/26/9): line= signal= hist= (flip? bullish/bearish/none)
- Bollinger (20, 2): %b= bandwidth= trend= (widening/tightening) squeeze?
- Recent news (top 1-3 headlines):
  -
- Read:

## Evaluation HH:MM UTC
This block is appended hourly by run_evaluation.py.

For each symbol, one line + indicator readout:

- TICKER ACTION score=+/-X qty= limit=$ ask=$ (reason)
    score   : +/-X
    rsi     : __
    macd    : line= sig= hist= (FLIP if any)
    bb      : lower= mid= upper= bw= pb= trend= squeeze=
    daily   : ma20= ma50= last= regime= (uptrend/downtrend/mixed)

### Orders submitted
- TICKER ACTION -> {alpaca_response_json}
(or "(dry-run)" if --execute was not passed)

## Stops & Adjustments
- Positions reviewed for -5% stop-loss / +10% take-profit:
- Actions taken:

## Reflection (23:00 UTC, daily journal routine)
- What worked:
- What didn't:
- What to watch tomorrow:
- Rule-adherence check: all trades within 5% position cap / limit-only / -5% stop / +10% take-profit respected? yes / no
