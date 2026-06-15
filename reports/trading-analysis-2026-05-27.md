# Trading Agent Performance Analysis
**Date:** 2026-05-27 | **Period:** May 9 – May 27, 2026 (18 days of paper trading)

---

## Executive Summary

The portfolio started at ~$100,000 and currently sits at **$97,302** — a **−2.7% loss** over 18 days in a market that itself declined roughly 7% (BTC $80,313 → $74,595). In that sense, the agent held up better than pure buy-and-hold. However the picture is more nuanced: almost all of that paper loss came from **six simultaneous stop-outs in mid-May** on entries that were made near price highs, and the portfolio has been sitting at 85%+ cash ever since — capturing almost none of the 24/7 crypto opportunity.

The walk-forward evaluation confirms the problem quantitatively: every Sharpe ratio is negative across all timeframes (1H avg −0.65, 4H ETH −1.35, 1D BTC −1.59). The strategy is **not yet reliably edge-positive**.

Below is a full diagnostic across five domains — risk management, signal quality, market-reading, execution infrastructure, and profit maximisation — followed by a prioritised improvement roadmap.

---

## 1. What Actually Happened (Trade History)

### Phase 1 — Day 1 Chaos (May 9)
The very first evaluation run generated BUY signals for **9 symbols simultaneously** using a primitive `ma20 > ma50` trend filter. The system attempted to fill ~$4,900 of each symbol at once, blowing past the total available USD balance of ~$6,000. Most orders bounced with `insufficient balance` errors. Only a handful (BTC, ETH, SOL, AVAX, LINK, DOT, LTC, DOGE, AAVE) actually submitted — and of those, several were filled near the session high.

**Root cause:** The old pre-6-point strategy had no per-evaluation budget discipline and no "how much cash do I have?" gate before iterating across the watchlist.

### Phase 2 — Entries at the Top (May 9–14)
After the 6-point system was stood up, entries gradually accumulated: ETH @ $2,307, SOL @ $93, LINK @ $10.35, ADA @ $0.272, AAVE @ $95. These all happened during the late phase of the May rally — the market peaked around May 12–13 and then rolled over sharply.

### Phase 3 — Mass Stop-Out (May 16–17)
Six positions (ETH, LINK, ADA, AAVE, SOL, DOT) all hit the −5% stop in a single session as the market declined. Estimated realised loss from these stop-outs: approximately **−$2,500 to −$3,000**.

**Critical bug discovered:** ADA's stop-loss generated **30+ duplicate SELL attempts over two days** because the system did not check for existing open orders before placing a new one. The first stop placed a pending limit order; subsequent evaluation cycles saw the position still "open" (pending order not yet filled), placed another limit order, and so on. Eventually many got `insufficient balance for ADA (available: 0)` errors — the asset was already earmarked for the pending sell, so the broker blocked additional sell orders.

### Phase 4 — Cash Paralysis (May 17–27)
With 85%+ cash and a market in mixed/downtrend regime, the 4/6 score threshold has not been cleared once. The only new position opened was a small SOL half-size buy (May 26, score 3.0/6), and currently only BTC long remains (0.1861 BTC, near its −5% stop).

---

## 2. Risk Management — What Needs Fixing

### 2.1 Stop-Loss Order Deduplication (CRITICAL)

**Problem:** Every evaluation cycle re-fires a stop-loss SELL for the same position regardless of whether a pending sell order already exists. This creates 30+ duplicate orders, most of which fail or partially execute in unexpected ways.

**Fix:** Before placing any stop-loss order, call `GET /v2/orders?status=open&symbols=SYMBOL` and check if an unfilled SELL already exists. If yes, skip. If the existing order's limit price is now too far from the market, cancel-and-replace.

```python
# Pseudo-code addition to run_evaluation.py
open_orders = get_open_orders(symbol)
existing_sell = any(o['side'] == 'sell' and o['type'] == 'limit' for o in open_orders)
if existing_sell:
    # check if it will fill; cancel-replace if price drifted > 0.5%
    continue  # skip re-sending
```

### 2.2 Stop-Loss Fill Reliability (HIGH)

**Problem:** Stop-loss orders use a tight limit price (`ask × 0.9995`). In a fast-moving market, these sit unfilled while price blows through. A stop-loss that doesn't fill is worthless.

**Fix:** For stop-losses specifically, use a slightly wider limit band — `ask × 0.998` (0.2% below ask at trigger time). Alternatively, implement a **time-escalation rule**: if a stop-loss limit order remains unfilled after 2 evaluation cycles (30 minutes), widen the limit price by an additional 0.3%.

### 2.3 Trailing Stops (HIGH)

**Problem:** Stops are fixed at −5% from entry forever. Once BTC moved from $77,962 entry to a high of ~$82,000 (+5.2%), the stop stayed anchored at $74,064 instead of trailing up. All unrealised gains get given back.

**Fix:** After a position reaches +2.5% unrealised gain, begin trailing the stop at 3% below the highest close seen since entry. This is sometimes called a "high-water mark" stop.

```python
# In evaluate_symbol, for open long positions:
trail_pct = 0.03
high_water = max(entry_price, current_price)  # needs to be persisted
trailing_stop = high_water * (1 - trail_pct)
if current_price < trailing_stop:
    action = "SELL"
    reason = f"TRAILING STOP: HWM=${high_water:.2f}, trail=${trailing_stop:.2f}"
```

This requires storing `high_water_mark` per position in a JSON state file between evaluations.

### 2.4 Correlation Budget (MEDIUM)

**Problem:** All 9 watchlist symbols are crypto and highly correlated. Opening 6 positions simultaneously means when the market corrects, all 6 stop out together. The 5% per-symbol cap correctly limits single-symbol concentration but does nothing for correlated-asset concentration.

**Fix:** Add a rule: **maximum 3 open positions at one time**, with at most 2 in the same "tier" (BTC/ETH are Tier 1; altcoins are Tier 2). When 3 positions are open, new BUY signals are queued (not executed) until a position closes.

### 2.5 Portfolio-Level Max Drawdown Gate (MEDIUM)

**Problem:** There is a per-position stop at −5% but no portfolio-level circuit breaker. If 6 positions all lose 5%, the portfolio drops ~3% in a single day with no intervention.

**Fix:** If total portfolio equity drops more than **3% in a single calendar day**, enter a "capital preservation mode" for 24 hours — no new entries, existing stop-losses tightened to −3%.

---

## 3. Signal Quality — What Needs Fixing

### 3.1 The 4H Data Feed Is Broken for BTC (CRITICAL)

**Problem:** BTC/USD shows `insufficient 4H history (0 bars)` in every single evaluation. Signal 6 (the 4H regime check, worth ±1 point) is therefore always N/A. This means BTC scores are computed on only 5 signals instead of 6 — artificially depressing entry likelihood for the most important asset.

**Fix:** Debug `get_crypto_bars_4h("BTC/USD")`. The likely cause is that the `start` timestamp calculation for 4H bars is too recent — 120 bars × 4 hours × 1.6 buffer = ~32 days back, but Alpaca may be returning an empty result. Try fetching 200 4H bars with a 90-day `start` window and log the raw response.

### 3.2 Volume Signal Is Almost Always −0.5 (HIGH)

**Problem:** 90%+ of evaluations show volume at 0.00–0.17× the 20-bar average on the 15-min timeframe. This gives a −0.5 penalty almost every hour, making it very hard to reach the 4/6 buy threshold. The score would need all other 5 signals to be perfect (+4.5 from 5 signals) to overcome the volume drag.

**Root cause:** The evaluation runs 24 hours a day, but meaningful volume on most altcoins only occurs during the **Asian session (UTC 01:00–05:00) and US session (UTC 13:00–21:00)**. At off-peak hours (e.g., UTC 07:00–12:00), 15-min bar volumes are genuinely near zero.

**Fix options:**
- Weight the volume signal less harshly outside peak hours (change the -0.5 to -0.2 between UTC 06:00–12:00)
- Add a "volume clock" gate: skip entries during demonstrably low-volume hours based on historical patterns
- Switch the volume signal to use a **session-aware average** (compare to the same clock-hour's average across the past 20 days)

### 3.3 RSI Signal Is Too Narrow (MEDIUM)

**Problem:** The current RSI rule gives +1 only when RSI is 40–65 AND rising. This excludes a large part of the valid entry zone. Specifically, RSI between 30–40 in an uptrend (recovering from oversold) is often the best entry point and currently gets 0 credit.

**Fix:** Change the RSI band to 35–68 for the +1 condition. Add a secondary +0.5 for RSI 30–40 rising (early recovery from oversold), separate from the existing <30 oversold signal.

### 3.4 EMA Dead Zone Too Wide on 15-Min (LOW)

**Problem:** The ±0.05% dead zone on the 15-min EMA cross means that when EMA20 and EMA50 are very close (a common condition during consolidation), the signal returns "neutral" (0 points) instead of rewarding the fact that fast EMA is at least slightly above slow. In low-volatility regimes, EMAs stay in the dead zone for hours.

**Fix:** Tighten the dead zone to ±0.02% on the 15-min timeframe while keeping ±0.05% for 4H.

### 3.5 No RSI Divergence Detection (MEDIUM)

**Problem:** The SKILL.md explicitly calls out RSI divergence (price makes lower low, RSI makes higher low) as a strong leading signal. The code does not implement this at all.

**Fix:** Add `rsi_divergence(closes, highs, lows, period=14, lookback=10)` to `indicators.py`:
1. Find the last two swing lows in price (using a simple local-minimum detector)
2. Compare the RSI values at those swing lows
3. Return `'bullish'` if price LL but RSI HL, `'bearish'` if price HH but RSI LH

This would be an optional +0.5/−0.5 bonus signal layered on top of the existing RSI score.

### 3.6 No MACD Zero-Line Cross Detection (MEDIUM)

**Problem:** The SKILL.md notes that MACD crossing from negative to positive (zero-line cross) is "a lagging but high-conviction signal." The code currently only checks histogram direction, not MACD line vs zero.

**Fix:** Add `macd_zero_cross(values)` — returns `'bullish'` if the MACD line just crossed above 0, `'bearish'` if just crossed below. Award an extra +0.5 for bullish zero-line cross in the score calculation.

---

## 4. Market Reading — What We're Missing

### 4.1 No Macro/Sentiment Context

The current system runs in a vacuum — it has no awareness of macro conditions that dominate crypto: funding rates, Fear & Greed Index, BTC dominance, or major news catalysts.

**Today's context (not in any evaluation):**
- Strategy (MicroStrategy) has bought 171,238 BTC in 2026 — structural demand signal
- Tesla/SpaceX merger would create the world's 5th-largest BTC treasury — bullish for BTC
- XRP in "extreme fear" zone — potential contrarian long but not in our watchlist
- Multiple altcoins in confirmed Wyckoff Mark-Down phases

**Immediate fix:** Add a `market_context.json` file updated by the morning brief that flags:
- BTC dominance trend (rising = altcoins weak, falling = altcoin season)
- Macro regime: "risk-on" / "risk-off" / "neutral"
- Any active news catalyst (+/- flag per symbol)
- The evaluation script checks this file and downgrades the buy threshold to 5/6 in "risk-off" macro regimes

### 4.2 Wyckoff Phase Is Never Actually Determined

**Problem:** CLAUDE.md has an excellent Wyckoff section. The research briefs mention Wyckoff in passing but never actually commit to a phase (Accumulation / Mark-Up / Distribution / Mark-Down) for each symbol with specific price evidence.

**What we're missing:** Every morning brief should explicitly state, for each symbol:
- Current Wyckoff phase (with the candle pattern evidence)
- Whether we're in a Spring (last shakeout below range before breakout) — the single highest R:R long entry pattern
- Whether we're in a UTAD (upthrust after distribution) — the highest-conviction short signal

**Fix:** Add a structured Wyckoff template to the morning brief and require it to be filled before any trade decision.

### 4.3 No Support/Resistance Level Tracking

**Problem:** The signal score computes indicators in isolation. It doesn't know that BTC has major support at $74,000 (previous range low) or that ETH has resistance at $2,150. Without these levels, entries happen mid-range rather than at high-probability bounce zones.

**Fix:** Add a `levels.json` that stores key S/R levels per symbol (updated weekly). The evaluation checks: is current price within 0.5% of a support level? If yes, add +0.5 to the score. Near resistance? Add −0.5.

### 4.4 Volume Profile Not Implemented

**Problem:** The SKILL.md has a full section on Volume Profile (POC, VAH, VAL, HVN, LVN). None of this is in `indicators.py`. Price at POC = fair value, ambiguous. Price below VAL = undervalued, long bias. Price above VAH = overvalued, caution.

**Fix (medium-term):** Build `volume_profile(prices, volumes, bins=50)` in indicators.py to find the POC and value area. Add to the evaluation block.

### 4.5 BTC Is the Market — Its Regime Drives Everything

**Problem:** Each symbol is evaluated independently. But for altcoins, the single most important variable is "what is BTC doing?" If BTC is in a confirmed downtrend or printing bearish structure, altcoin longs are low-probability regardless of their individual scores.

**Fix:** Add a "BTC overlay" rule: if BTC's daily regime is `downtrend` AND current position in BTC/USD is short or flat, apply a −1 penalty to all altcoin scores. This alone would have prevented the May 9–14 entries in ETH, SOL, LINK, ADA, AAVE during a period when BTC was exhibiting distribution.

---

## 5. Profit Maximisation — What We're Leaving on the Table

### 5.1 No Partial Take-Profits

**Problem:** The system runs positions either to stop-loss (−5%) or to a TA SELL signal (score ≤ −2). There is no partial exit at any positive target. In volatile crypto, a position that reaches +8% before reversing to −5% and stopping out is a net −5% trade — the full round-trip gain is surrendered.

**Fix:** Implement partial take-profit at **+5% from entry (sell 50%)**. The remaining 50% runs with a trailing stop (see 2.3). This locks in profit on every winner while giving the other half room to run.

### 5.2 Score Gate Is Too Conservative (Net Effect: Zero Trades)

**Problem:** Score ≥ 4/6 is required for a full-size buy. In practice, with the volume penalty at −0.5 almost always, the 4H data missing (+1 unavailable for BTC), and the BB near-upper-band penalty at −1 whenever price has already moved, the effective threshold is rarely hit. In 18 days, the agent made entries only in the window just before the mid-May drop, and has made essentially zero entries since.

**Evidence:** DOT/USD today has score 3.5/6 — blocked by the daily downtrend regime gate despite showing golden cross on both 15-min and 4H, rising MACD, and 7x average volume. That's a missed opportunity.

**Fix options:**
- Lower the full-size threshold to 3.5/6 during peak volume hours (UTC 13:00–21:00)
- Add a "volume-corrected score" that adjusts for the structural low-volume environment
- Allow half-size entries at 3/6 even in mixed regime (currently blocked)

### 5.3 The 20% Cash Rule Kills Compounding

**Problem:** The 20% minimum cash rule plus the small-cap position sizes (~$4,900 each at 5% equity) means the maximum deployed capital is 80% across ~16 symbols. But the watchlist has only 10 symbols, so maximum deployment is 80% if all 10 are open. Currently: 14.7% deployed, 85.3% idle.

The 85% idle cash generates 0% return. In crypto bear phases this is fine, but during bull phases it is a massive drag.

**Fix:** When 5+ signals are simultaneously strong (score ≥ 4), allow deployment up to **85% of equity** across the top signals, temporarily relaxing the 20% floor to 15%. Restore the 20% floor after positions open.

### 5.4 No Short-Side Exploitation

**Problem:** The short logic exists in the code but the regime gate is extremely restrictive: only short when daily regime is confirmed `downtrend`. Currently DOT/USD and DOGE/USD are in confirmed downtrend but their 15-min scores are +3.5 and +1.0 — too bullish to short. The short setup requires a score ≤ −3/6 AND daily downtrend simultaneously, a very rare confluence.

**Evidence from the walk-forward:** Negative Sharpe on all timeframes means the signal is *consistently wrong* in the direction taken — which means the inverse trade would often be right. In a downtrending market, a system that never opens shorts leaves money on the table.

**Fix:** Develop a short-specific sub-strategy with dedicated bearish indicators: RSI < 40 and falling, MACD red and dropping, price below 200 EMA (not yet in the signal set), BB walk along the lower band. Short entries should be allowed at score ≤ −3/6 even in "mixed" regime if at least 3 of the 4 short-specific conditions are met.

### 5.5 The Hourly Evaluation Misses Intra-Hour Opportunities

**Problem:** Evaluations run once per hour (at :23). A strong breakout that starts at :24 won't be caught until the next evaluation at :23 the following hour — potentially 59 minutes late. For the crypto market, that's multiple ATRs of missed movement.

**Fix:** Add a **price-alert trigger** alongside the hourly schedule: if any watchlist symbol moves more than 1.5× its current ATR within a 15-min bar (detectable via WebSocket price feed or a 5-minute polling loop), fire an immediate out-of-schedule evaluation for that symbol only.

---

## 6. Infrastructure Bugs to Fix Now

| Priority | Bug | Impact |
|----------|-----|--------|
| P0 | Duplicate stop-loss orders — no open-order check before placing | Broken stop-loss mechanics, 30+ noise entries in journal |
| P0 | BTC 4H data returns 0 bars — Signal 6 always N/A for BTC | Score miscalculation for most important symbol |
| P1 | Stop-loss limit price too tight — orders don't fill in fast markets | Stops don't execute, losses exceed −5% |
| P1 | No position state file — high-water mark for trailing stops can't be computed | Can't implement trailing stops |
| P2 | No order deduplication in SELL path — same qty re-submitted each cycle | API spam, possible double-fills |
| P2 | Walk-forward uses BTC/USDC not BTC/USD — results may not match live Alpaca data | Backtest unreliable |
| P3 | LTC volume sometimes returns `n/a` — scoring inconsistent | Minor score noise |

---

## 7. Prioritised Improvement Roadmap

### Week 1 — Stop the Bleeding (Infrastructure)
1. Fix duplicate stop-loss: add `get_open_orders()` check before SELL/COVER
2. Fix BTC 4H data fetch: increase lookback to 90 days, add debug logging
3. Add position state file (`data/positions_state.json`) to track: entry price, high-water mark, open order IDs
4. Widen stop-loss limit band to `ask × 0.998` for faster fills

### Week 2 — Improve Signal Quality
5. Add RSI divergence to `indicators.py` (+0.5 bonus signal)
6. Add MACD zero-line cross detection (+0.5 bonus)
7. Session-aware volume scoring: reduce penalty during off-peak hours
8. Add key S/R levels to `config.json` (manually maintained, weekly update)

### Week 3 — Better Market Reading
9. Add `market_context.json` with BTC regime, macro mood, key news flags
10. Implement BTC-overlay rule for altcoin scoring
11. Add Wyckoff phase to the structured morning brief template
12. Add partial take-profit at +5% (50% of position)

### Week 4 — Profit Maximisation
13. Implement trailing stops using the position state file
14. Implement the 3-position correlation budget rule
15. Add intra-hour alert trigger for 1.5× ATR moves
16. Lower buy threshold to 3.5/6 during peak volume sessions
17. Develop short-specific sub-strategy indicators

---

## 8. What a Good Day Looks Like (Target State)

When the above is implemented, a typical profitable evaluation should look like:

```
## Evaluation 14:23 GMT+2

Market context: BTC daily regime=uptrend, macro=risk-on, no negative news
BTC-overlay: +0 penalty (BTC uptrend, supportive for alts)

- SOL/USD BUY score=+4.5/6 qty=65.4 limit=$87.50 ask=$87.55
    ENTRY REASON: Near $85 support (0.4% above S/R level), Wyckoff retest of breakout
    score: ema_golden(+1) macd_green_rising(+1) rsi_40-65_rising(+1) bb_lower(+1) volume_1.8x(+1) 4h_golden(+1) S/R_proximity(+0.5) rsi_divergence(+0.5)
    entry: $87.50  stop: $84.88 (trailing from $85.20 HWM)  target: $96.25
    R:R: 1:3.4 ✓   ATR: $0.82  position: $5,732 (5.9% equity)

### Orders submitted
- SOL/USD BUY 65.4 @ $87.50 → filled
```

---

## 9. Bottom Line

The agent has good bones — the 6-point system, regime gates, ATR sizing, and limit-only discipline are all correct in principle. The problems are:

1. **Execution reliability** (stop-loss deduplication, fill guarantee) is broken
2. **Signal sensitivity** is too low (volume penalty, missing 4H data, narrow RSI band) creating a paradox where the agent almost never enters
3. **Market context** is blind — no BTC overlay, no macro regime, no Wyckoff structure in decisions
4. **Profit mechanics** are one-dimensional — only stop-loss exits, no trailing stops, no partial takes

Fix #1 this week. The compounding improvement from #2–4 will follow. A realistic target for the next 30 days of paper trading, with the roadmap above implemented, is **+3% to +8% from current equity** while maintaining the same or lower max drawdown.
