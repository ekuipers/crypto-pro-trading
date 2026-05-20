# Glossary — Alpaca Trading Agent

Full decoder ring. Everything that would clutter `memory.md` lives here.

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
| Confluence score | 6-point TA signal score; ≥4 = buy, 3 = half-size, ≤2 = hold |
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
| `_bars_start()` | Computes: `now − (limit × tf_minutes × 1.6)` to ensure enough history |
| Multi-symbol pagination | Bars API paginates by *total bars*, not per-symbol. Must follow `next_page_token` until `null`. |

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
| `get_crypto_bars(symbol, limit, timeframe)` | `run_evaluation.py` | Fetches bars with correct start date |
| `_bars_start(limit, timeframe, buffer=1.6)` | `run_evaluation.py` | Computes start datetime string |
| `evaluate_symbol(symbol, positions, equity, buying_power)` | `run_evaluation.py` | Full eval + ATR sizing + journal write |
| `place_order(symbol, side, qty, ask)` | `trade.py` | Limit order; enforces hard rules |

---

## Hard Rules Quick Reference

| # | Rule | Value |
|---|------|-------|
| 1 | Position cap | ≤5% of equity per symbol |
| 2 | Order type | Limit only; within 0.2% of ask |
| 3 | Stop-loss | −5% from entry → immediate close |
| 4 | Take-profit | +10% from entry → immediate close |
| 5 | Buy gate | Score ≥4/6 full size; score=3/6 half-size if R:R≥1:3 |
| 6 | Regime gate | No buys in daily downtrend (close < 50-SMA AND 20-SMA < 50-SMA) |
| 7 | Sizing | ATR: qty=(equity×1%)/(ATR×1.5), cap at 5% equity |
| 8 | Order routing | All via `scripts/trade.py`; direct API calls forbidden |
| 9 | Journal | Every day, even quiet ones |
