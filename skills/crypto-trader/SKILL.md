---
name: crypto-trader
description: >
  Professional crypto trading strategy guide for the Alpaca paper trading agent.
  Use this skill whenever you are evaluating a trade, running the hourly evaluation,
  researching a symbol, or writing a journal entry. It covers entry/exit signals,
  technical analysis interpretation, multi-timeframe analysis, Wyckoff market
  structure, volume profile, on-chain signals, and risk management rules.
  Always consult this skill before placing or closing any position.
---

# Professional Crypto Trading Strategies

This skill distils institutional-grade crypto trading methodology into a
step-by-step decision framework. Work through each section in order during
every hourly evaluation.

---

## 1. Market Structure First (Top-Down Bias)

Before looking at any indicator, establish the **macro bias** from the
higher timeframe down to your execution frame:

| Timeframe | Purpose |
|-----------|---------|
| Daily / 4H | Determine trend direction and key S/R levels |
| 1H | Confirm structure (higher-highs / higher-lows or opposite) |
| 15-min | Entry and exit execution (per CLAUDE.md) |

**Rule:** Only take trades in the direction of the higher-timeframe trend.
A 15-min bullish signal inside a 4H downtrend is a low-confidence setup —
skip it or reduce size significantly.

### Higher-Highs / Higher-Lows structure
- **Uptrend confirmed:** price makes a higher high AND holds above the
  previous higher low.
- **Downtrend confirmed:** lower high followed by a break below the
  previous swing low.
- A **break of structure (BoS)** — price taking out the last swing high or
  low — often marks a trend change and a potential entry in the new direction.

---

## 2. Wyckoff Phases — Where Are We in the Cycle?

The Wyckoff method maps price into four phases. Identifying the phase
prevents you from buying into distribution or selling into accumulation.

### Accumulation (buy zone)
- Price has been in a trading range after a prolonged downtrend.
- Volume is high on bounces (demand) and lighter on dips (weak supply).
- Key signs: **Preliminary Support (PS)**, **Selling Climax (SC)**,
  **Automatic Rally (AR)**, **Secondary Test (ST)**, and eventually a
  **Sign of Strength (SoS)** break above the trading range.
- Action: Look for long entries on retests of the SoS breakout level.

### Mark-Up (trend phase — ride it)
- Price makes consistent higher highs and higher lows.
- Volume expands on rallies, contracts on pullbacks.
- Action: Stay long; use pullbacks to moving averages as re-entry
  opportunities. Tighten stops progressively.

### Distribution (exit zone)
- Price enters a wide choppy range after a prolonged uptrend.
- Volume is high on drops (supply) and lighter on bounces (weak demand).
- Key signs: **Preliminary Supply (PSY)**, **Buying Climax (BC)**,
  **Automatic Reaction (AR)**, and a **Sign of Weakness (SoW)** break
  below the trading range.
- Action: Take profit on longs; do not add new longs. Watch for short
  opportunities after confirmed BoS lower.

### Mark-Down (downtrend — avoid or short)
- Price makes consistent lower highs and lower lows.
- Action: Stay flat; do not buy falling knives. Wait for accumulation
  signs before re-entering.

---

## 3. Volume Profile Analysis

Volume Profile shows where the most trading activity occurred at each price
level — not over time, but by price. Key concepts:

- **Point of Control (POC):** The price level with the highest traded
  volume. Price gravitates back to the POC; it acts as a strong magnet and
  support/resistance.
- **Value Area High (VAH) / Value Area Low (VAL):** The range containing
  70% of traded volume. Breakouts *above VAH* with strong volume are
  bullish continuation signals. Rejections *at VAH* are bearish.
- **Low-Volume Nodes (LVN):** Price moves quickly through these — good
  targets once a level is broken.
- **High-Volume Nodes (HVN):** Price stalls and consolidates here —
  useful support/resistance zones.

**Practical use:** If price is trading between the VAL and POC from a
recent session, bias is neutral-to-bearish. A reclaim of the POC with
strong volume shifts bias bullish.

---

## 4. Technical Indicator Playbook

### 4.1 Moving Averages (Trend Filter)
- **20 EMA** — short-term trend; in an uptrend, price should bounce off it.
- **50 EMA** — medium-term trend; the key "institutional" moving average.
- **200 EMA** — macro trend filter; price above = bull market environment.

**Signals:**
- *Golden Cross* (20 crosses above 50): medium-term bullish, look for longs.
- *Death Cross* (20 crosses below 50): medium-term bearish, avoid new longs.
- Price reclaiming the 50 EMA after a pullback, with rising volume = high-
  quality long entry.
- Price failing to reclaim the 50 EMA on a bounce = distribution signal,
  consider reducing longs.

### 4.2 RSI (Momentum)
- **Period:** 14. **Oversold:** < 30. **Overbought:** > 70.
- **Bullish divergence:** Price makes a lower low, RSI makes a higher low
  → momentum turning up, potential long.
- **Bearish divergence:** Price makes a higher high, RSI makes a lower
  high → momentum waning, prepare to exit or tighten stop.
- In strong uptrends, RSI can stay above 50–60 for extended periods; do
  not short simply because RSI is at 65.
- A drop from overbought (>70) back below 70 is a *sell signal* in
  ranging markets; in trending markets, wait for a break below 50.

### 4.3 MACD (Momentum + Trend)
- **Settings:** 12 / 26 / 9 (standard).
- *Bullish:* MACD line crosses above signal line, histogram turns green.
  Best when this happens *below the zero line* (oversold territory).
- *Bearish:* MACD line crosses below signal line, histogram turns red.
  Best when this happens *above the zero line* (overbought territory).
- **MACD divergence** (same logic as RSI divergence) is a strong leading
  signal — weight it heavily.
- Zero-line cross (MACD going from negative to positive) confirms a
  trend change; it is a lagging but high-conviction signal.

### 4.4 Bollinger Bands (Volatility)
- **Settings:** 20 SMA, 2 standard deviations.
- **Squeeze** (bands narrow): volatility has compressed, a big move is
  coming. Direction unknown — wait for the breakout candle.
- **Expansion** (bands widen): trend is accelerating. Ride it; don't
  fade it.
- Price touching or piercing the **lower band** in an uptrend is a
  mean-reversion long setup.
- Price touching or piercing the **upper band** in a ranging market is a
  mean-reversion short setup. In an uptrend, upper-band touches are *not*
  shorts — they confirm strength.
- **Band walk:** price repeatedly tagging the upper band while the 20 SMA
  slopes upward = very strong trend; hold longs.

### 4.5 Stochastic RSI (Short-Term Timing)
- Combines RSI and Stochastic for faster signals. More sensitive than RSI
  alone.
- **Oversold cross** (K crosses above D below 20): entry trigger for longs
  on pullbacks in an uptrend.
- **Overbought cross** (K crosses below D above 80): exit trigger or
  short entry on bounces in a downtrend.
- Use only as a timing tool after higher-timeframe bias is confirmed.

### 4.6 Fibonacci Retracement (Entry Zones)
- Draw from the most recent major swing low to swing high (or vice versa).
- Key levels: **0.382**, **0.5**, **0.618** (golden ratio — strongest).
- In an uptrend, look for longs at the 0.5–0.618 retracement zone,
  confirmed by a bullish candlestick pattern (engulfing, pin bar, etc.).
- A break *below* the 0.786 level suggests the trend is reversing;
  exit the long.

### 4.7 Ichimoku Cloud (Trend at a Glance)
- **Price above the cloud** = bullish; **below the cloud** = bearish.
- **Tenkan / Kijun cross** above the cloud = strong buy signal.
- **Cloud thickness** = strength of support/resistance. Thin cloud = easy
  to break. Thick cloud = strong barrier.
- The **Lagging Span (Chikou)** above price = additional bullish
  confirmation.
- For the fastest decisions on a 15-min chart, a quick check is: is price
  above or below the cloud? That alone gives directional bias.

### 4.8 ATR (Average True Range — Volatility Sizing)
- Use 14-period ATR to set stop-loss distances and measure risk.
- Stop-loss = entry price ± 1.5–2× ATR (tighter in trends, wider in
  ranging/volatile markets).
- If ATR is very high (crypto in a panic or euphoria), reduce position
  size to keep dollar-risk constant.

---

## 5. Entry Checklist

Before entering any position, confirm **at least 4 of these 6**:

- [ ] Higher-timeframe (4H/Daily) trend is aligned with trade direction.
- [ ] Price is in a Wyckoff Mark-Up or has completed a clear Accumulation.
- [ ] MACD histogram is green (for longs) and crossing or above signal.
- [ ] RSI is not yet overbought (< 70 for longs) and rising.
- [ ] Price has bounced off a key MA (20 or 50 EMA) or Fibonacci level.
- [ ] Volume is above the 20-period average on the breakout or bounce candle.

If fewer than 4 conditions are met, **pass on the trade**.

---

## 6. Exit Strategy

### Take-Profit Rules
1. **Primary target** = next significant resistance level (swing high,
   POC, VAH, or round number).
2. **Partial exit** at the primary target (take 50%), let the rest run.
3. **Trail the remainder** using the 20 EMA on the 15-min chart — exit
   when price closes below it.
4. **Hard rule:** If a position gains 10% from entry, close it per CLAUDE.md.

### Stop-Loss Rules
1. Place stop below the most recent swing low (for longs) or 1.5× ATR
   below entry — whichever is closer.
2. **Never move a stop further away** from entry. You may trail it
   *toward* entry as price moves in your favour.
3. **Hard rule:** If a position drops 5% from entry, close it per CLAUDE.md.

### Risk-to-Reward Filter
- Only enter if the distance to target ≥ 2× the distance to stop (1:2 R:R).
- A 1:2 R:R means you only need to be right ~40% of the time to be profitable.
- Prefer 1:3 setups when available; they require only a 30% win rate.

---

## 7. Position Sizing Formula

```
Max dollar risk per trade = Portfolio Value × 0.01   (1% rule)
Position Size = Max dollar risk ÷ (Entry Price − Stop Price)
```

This keeps losses small regardless of how volatile the asset is.

Example: $10,000 portfolio, entry at $100, stop at $97.
- Max risk = $10,000 × 0.01 = $100
- Stop distance = $3
- Position size = $100 ÷ $3 = 33.3 units

**Hard cap:** Never exceed 5% of portfolio in a single position (per CLAUDE.md).
The 1% risk rule will naturally keep positions well below this unless the
stop is extremely tight.

---

## 8. On-Chain Signals (Leading Indicators)

On-chain data reflects actual blockchain activity and often leads price by
hours or days.

| Signal | Bullish | Bearish |
|--------|---------|---------|
| Exchange inflows | Low (coins leaving = HODLing) | High (coins arriving = sell pressure) |
| Exchange outflows | High (accumulation off-exchange) | Low |
| Whale wallet activity | Large wallets accumulating | Large wallets distributing to exchanges |
| Funding rate (perps) | Slightly positive or neutral | Extremely positive (longs overcrowded) or negative (shorts overcrowded) |
| Open Interest | Rising OI + rising price = trend healthy | Rising OI + falling price = short squeeze risk |

**Practical shortcut:** If funding rate is > +0.1% per 8h, longs are
overcrowded; the next flush will be violent. Reduce exposure.

---

## 9. Regime Awareness

Match your strategy to the current market regime:

| Regime | Characteristics | Best Strategy |
|--------|----------------|---------------|
| **Trending** | Clear HH/HL or LL/LH, expanding volume | Trend-follow; use MAs and MACD for entries |
| **Ranging** | Price bouncing between defined S/R | Mean-reversion; buy lower band, sell upper band |
| **Breakout** | Bollinger Squeeze resolving, volume spike | Enter the direction of the break; target the next key level |
| **Volatile / Panic** | Large candles, ATR spiking | Reduce size or stay flat; wait for structure to re-establish |

Do not use a trend-following strategy in a ranging market, or a mean-
reversion strategy in a strong trend — both are common causes of losses.

---

## 10. Common Mistakes to Avoid

- **Chasing after a big candle.** Wait for the pullback/retest.
- **Ignoring the higher timeframe.** A perfect 15-min signal in a 4H
  downtrend is a trap.
- **Moving stops away from entry.** This turns small losses into big ones.
- **Adding to a losing position.** Only add to winning positions.
- **Overtrading on low-conviction setups.** If the checklist fails, wait.
- **Buying solely because RSI is "oversold".** In a downtrend, oversold
  becomes more oversold.
- **Using maximum position size every trade.** Save full size for
  highest-conviction setups (all 6 checklist items confirmed).

---

## Quick Reference — Signal Confluence Table

Use this at the start of each hourly evaluation to score the setup:

| Indicator | Check | Score (+1 each) |
|-----------|-------|----------------|
| 4H trend aligned | Yes / No | |
| 20 EMA > 50 EMA | Yes / No | |
| MACD histogram green & rising | Yes / No | |
| RSI 40–65 and rising (longs) | Yes / No | |
| Price above Ichimoku cloud | Yes / No | |
| Volume above 20-period avg | Yes / No | |
| **Total** | | **/6** |

**Score ≥ 4:** Enter with standard size.
**Score = 3:** Enter with half size if risk:reward ≥ 1:3.
**Score ≤ 2:** Pass. Log reason in journal.
