# Glossary — CryptoPro Trader

Trading-term reference for the dashboard's 📖 Glossary tab — acronyms and trading
concepts for a user to understand while trading, not a developer/implementation
reference. Implementation notes and the dated changelog live in `memory/memory.md`;
architecture and hard rules live in `CLAUDE.md`.

---

## Acronyms & Abbreviations

| Term | Meaning | Context |
|------|---------|---------|
| AAD | Additional Authenticated Data | AES-GCM input that is authenticated but not encrypted; binds a stored credential to its own `(uid, mode)` row so a copied ciphertext fails to decrypt |
| AES-256-GCM | Advanced Encryption Standard, 256-bit key, Galois/Counter Mode | Authenticated encryption used for per-user Alpaca credentials at rest (`src/secretsCrypto.js`) |
| ATR | Average True Range | Volatility measure; used for stop distance & position sizing |
| Key fingerprint | Short non-secret digest of an encryption key | First 4 bytes of SHA-256 over `TRADER_CREDENTIALS_ENC_KEY`, stored per credential row (`key_fp`) so a credential saved from another environment reports itself instead of failing silently |
| BB | Bollinger Bands | 20-period, 2σ envelope around SMA |
| BoS | Break of Structure | Trend change signal (lower-high broken = bearish BoS) |
| BW | Bandwidth | Bollinger Band width: (upper−lower)/mid |
| EMA | Exponential Moving Average | Weighted MA; reacts faster than SMA |
| HH | Higher High | Bullish structure |
| HL | Higher Low | Bullish structure |
| LH | Lower High | Bearish structure |
| LL | Lower Low | Bearish structure |
| Audit trail (credentials) | Append-only record of credential changes | `trader_credential_audit` — who changed which Alpaca credential, when. Holds no key material; has no foreign key, so it outlives the account it documents |
| Step-up auth | Re-entering your account password to confirm a high-consequence action | Asked only when disconnecting a credential, or replacing the one the scheduled engine is trading with. Connecting a first key, and switching between keys you already stored, do not ask |
| Legacy engine uid | Sentinel uid for the pre-multi-tenant engine | `'trader'` — `trader_state`'s old fixed row id (`db.LEGACY_ENGINE_UID`), kept as a rollback snapshot after the Phase 4 backfill copies it to the owner's uid |
| MACD | Moving Average Convergence Divergence | 12/26 EMA diff; 9-period signal line |
| MiCA | Markets in Crypto-Assets Regulation | EU crypto regulation; reason this project is paper-trading only |
| POC | Point of Control | Volume profile: price level with highest traded volume |
| R:R | Risk-to-Reward ratio | Stop distance vs take-profit distance (need ≥1:2, prefer 1:3) |
| RSI | Relative Strength Index | Wilder method, 14-period; overbought >70, oversold <30 |
| SMA | Simple Moving Average | Equal-weight average |
| SoS | Sign of Strength | Wyckoff: volume-confirmed breakout above trading range |
| TA | Technical Analysis | Chart-based signal analysis |
| Tenant | An account the scheduled engine runs for | Defined by having an **active** Alpaca credential row, not by having an account — `db.getActiveTenantsForJob()`. An account without one is skipped, never run on the env-var account (`src/tenantEngine.js`) |
| TF | Timeframe | e.g. 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Position within band: 0=lower, 1=upper |

---

## Trading Terms

| Term | Meaning |
|------|---------|
| Confluence score | 6-point TA signal score; ≥3.5 = buy, ≥2.5 = half-size, <2.5 = hold (≥4.0 = half-size counter-trend long in a downtrend); ≤−4 = short, −3 = half-size short, ≥+2 = cover |
| Markov analysis | Dashboard Markov tab. First-order Markov chain over daily close-to-close returns. |
| Transition matrix | 3×3 matrix where cell (i,j) = empirical probability of moving from state i to state j on the next day. Rows sum to 1. |
| Stationary distribution | Long-run state probabilities π satisfying π = πP; computed via power iteration. The Markov tab shows it alongside the empirical state frequencies. |
| Regime block | Daily downtrend detected → all new long entries blocked |
| BB squeeze | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |
| Golden cross | 20 EMA crosses above 50 EMA → bullish |
| Death cross | 20 EMA crosses below 50 EMA → bearish |
| EMA cross state | Detected from last two bars; "golden" / "death" / "neutral" |
| 4H regime | Primary trend filter: 20 EMA vs 50 EMA on 4-hour bars |
| ADX | Average Directional Index (14, Wilder) — trend *strength* 0–100, direction-agnostic. |
| OBV / OBV trend | On-Balance Volume — cumulative volume signed by close-to-close direction. |
| Wyckoff | Market cycle phases: Accumulation → Mark-Up → Distribution → Mark-Down |
| Mark-Up | Wyckoff trend phase: consistent HH/HL, buy pullbacks |
| Mark-Down | Wyckoff downtrend phase: consistent LH/LL, stay flat |
| Accumulation | Wyckoff buy zone: range after downtrend, look for SoS |
| Distribution | Wyckoff exit zone: range after uptrend, do not add positions |
| Regime (daily) | last_close > 50-day SMA AND 20-day SMA > 50-day SMA = uptrend |
| Hard cap | Position capped at 5% of total equity; enforced in `src/trade.js` |
| ATR sizing | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at 5% equity |
| Limit order | Only order type used; price ≤ ask + 0.2% |
| Stop escalation | A stop-loss order that hasn't filled for 2 cycles is cancel-replaced with a wider limit band (0.5% → 0.8% from ask), so it can still cross a spread that has widened past the base band |
| Paper spot trading | Simulated spot trades only; Alpaca paper environment (no futures support yet) |
| Read-only mode | Live Alpaca credentials show account/positions/quotes but can never place or cancel an order |
| Morning brief | Scheduled 7 AM task: eval + journal block + dashboard summary |
| Daily regime | Computed from 90-day daily bars: SMA-20 vs SMA-50 vs last close |
| Vol ratio | Current bar volume / 20-bar average volume. Scored only when at least 10 of those 20 baseline bars actually traded — Alpaca's 15-min crypto tape is 64–92% empty for the alts, and a mostly-empty baseline makes the ratio a coin flip on trade arrival rather than a measure of participation. Too sparse ⇒ n/a, worth 0, never a penalty or a bonus |
| Live R:R | Real-time risk-to-reward: `(target − current) / (current − stop)` using −5% stop, +10% target |
| Ticker strip | Top-of-dashboard price bar driven by the active watchlist. |
| Correlation heatmap | 10×10 Pearson ρ matrix of daily log-returns; shown in Risk tab |
| Trend arrow | ↑/↓/→ indicator in Signals tab comparing current confluence score to previous scan |
| Quick-buy (⚡) | Signals tab button for setups scoring ≥ 3; pre-fills trade modal with ATR-sized qty |
| Execute button (▶) | Directly submits the signal row's ATR-sized paper order from the Signals tab without opening the trade modal |
| Trailing stop | Activates once a long position is ≥2.5% in profit. Trails 3% below the high-water mark (HWM). |
| HWM | High-water mark — the highest close price seen since entry. |
| Tier-1 symbols | BTC/USD and ETH/USD — most liquid, highest correlation. Separate per-tier budget from Tier-2 alts |
| Daily drawdown gate | If portfolio equity drops ≥3% vs day-open equity, capital preservation mode activates: all new entries blocked, existing stops tighten to 3%. Resets at midnight UTC |
| Over-cap trim | Position value > cap% of equity → sell excess to bring back to cap. No signal gate; always fires |
| Under-cap top-up | Position value < cap% → buy to close the gap, subject to signal gate (score ≥ 3) and regime gate (no downtrend) |
