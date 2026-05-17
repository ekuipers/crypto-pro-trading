# Memory — Alpaca Trading Agent

Hot cache for this project. Full detail in `memory/`.

## Me
Erik (the.eekman@gmail.com). Running a paper crypto trading agent on Alpaca.

## Project
| Key | Value |
|-----|-------|
| **Root** | `C:\Users\An\OneDrive\Documenten\Claude\Projects\Alpaca\alpaca-trading-agent` |
| **Mode** | Paper trading (never live — URL contains "paper") |
| **Account** | PA3EZEE1I9RS |
| **Timezone** | GMT+2 (Amsterdam / Europe/Amsterdam) |
| **Watchlist** | BTC, ETH, SOL, AVAX, LINK, DOT, LTC, DOGE, UNI, AAVE (all /USD) |

## Key Files
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Agent hard rules — DO NOT OVERWRITE |
| `scripts/run_evaluation.py` | Main eval loop — run with `--execute` to trade |
| `scripts/indicators.py` | TA library (RSI, MACD, BB, ATR, EMA cross, volume) |
| `scripts/trade.py` | Order placement (enforces all hard rules in code) |
| `scripts/verify.py` | API smoke test |
| `watchlist_crypto.json` | 10 symbols |
| `journal/YYYY-MM-DD.md` | Daily trading journal (append, never overwrite) |
| `dashboard/dashboard.html` | Legacy dashboard — 5 tabs: Overview, Hot Symbols, Distribution, Morning Brief, Settings. Equity curve, positions table, portfolio donut chart. Paper/live toggle. |
| `dashboard/dashboard_professional.html` | Primary dashboard — 9 tabs: Command, Performance, Risk, Positions, Execution, Signals, P&L, Backtest vs Live, Settings. Hard Rules panel, Cash Reserve gate, ATR Position Sizer, Stop Distance column, Portfolio Cap Usage table, concentration + BTC-correlation panels, rolling 30D/90D Sharpe, period selector (1M/3M/6M/1Y), keyboard shortcuts (1–9 = tabs, R = refresh), browser notifications on score ≥ 4. Signals tab fixed 2026-05-16 (endpoint + barsStart helper). Journal tab removed 2026-05-16. |
| `dashboard/dashboard_layout.md` | Changelog + design reference for both dashboards. Two sections: Simple and Professional. Includes per-dashboard tab tables, feature descriptions, and dated changelog rows. |
| `skills/crypto-trader/SKILL.md` | Full strategy playbook (read before any trade eval) |

## Hard Rules (never break)
| Rule | Detail |
|------|--------|
| **5% cap** | Max 5% equity per position — `trade.py` enforces in code |
| **Limit only** | Never market orders; limit within 0.2% of ask |
| **Stop-loss** | −5% from entry → immediate close |
| **Take-profit** | +10% from entry → immediate close |
| **Score gate** | ≥ 4/6 → full size; 3/6 → half size; ≤ 2/6 → HOLD |
| **Regime gate** | No buys when daily downtrend (close < 50-day SMA & 20-day SMA < 50-day SMA) |
| **ATR sizing** | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at 5% equity |
| **Route orders** | All orders via `scripts/trade.py` only |
| **Journal** | Write every day, even quiet ones |

## Terms
| Term | Meaning |
|------|---------|
| **Confluence score** | 6-point TA signal score (≥4 = buy) |
| **4H** | 4-hour timeframe bars — primary trend filter |
| **ATR** | Average True Range — used for stop distance & position sizing |
| **EMA cross** | Golden = 20 EMA > 50 EMA (bullish); Death = 20 EMA < 50 EMA (bearish) |
| **%b** | Bollinger percent-B: 0 = at lower band, 1 = at upper band |
| **R:R** | Risk-to-reward ratio (need ≥ 1:2, prefer 1:3) |
| **BB squeeze** | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |
| **Regime block** | Daily downtrend detected → new entries blocked |
| **Wyckoff** | Market cycle phases: Accumulation → Mark-Up → Distribution → Mark-Down |
| **BoS** | Break of Structure (trend change signal) |
| **POC** | Point of Control (volume profile — highest traded price level) |
| **Morning brief** | Scheduled 7 AM task: eval + journal + dashboard |

## 6-Point Confluence Table
| # | Signal | Bullish | Bearish |
|---|--------|---------|---------|
| 1 | EMA cross (15-min) | Golden +1 | Death −1 |
| 2 | MACD histogram | Green & rising +1 | Red & falling −1 |
| 3 | RSI | 40–65 rising +1 or <30 +1 | >70 −1 |
| 4 | Bollinger %b | <0.25 +1 | >0.75 −1 |
| 5 | Volume | ≥1.2× avg +1 | <0.7× avg −0.5 |
| 6 | 4H regime | 20 EMA > 50 EMA +1 | 20 EMA < 50 EMA −1 |

## Scheduled Tasks
| Task | Schedule | What it does |
|------|----------|-------------|
| `morning-brief` | 07:00 Amsterdam daily | Runs eval, writes journal block, opens dashboard |
| `portfolio-rebalance-morning` | 10:00 Amsterdam daily | Trims all positions over 5% cap back to ≤5%; limit sells via trade.py |
| `portfolio-rebalance-evening` | 22:00 Amsterdam daily | Same as morning rebalance — second daily check |

## Recent Changes (as of 2026-05-17)
| Date | File | Change |
|------|------|--------|
| 2026-05-16 | `dashboard_professional.html` | Signals tab fixed: corrected API endpoint to `/v1beta3/crypto/us/bars`; added `barsStart()` helper for mandatory `start` param |
| 2026-05-17 | `dashboard_layout.md` | Restructured as changelog; split into Simple and Professional sections with tab tables and dated changelog rows |
| 2026-05-17 | `memory.md` | Updated key files table with dashboard_layout.md entry and correct dashboard descriptions |

## Status (as of 2026-05-14 12:35 GMT+2)
- Rebalance executed: 9 limit sell orders placed to trim all positions to ≤5% cap
- BTC and ETH fills already settled → cash jumped $1,111 → $20,583
- 7 orders still working as GTC limit sells (DOGE partial fill, 6 fully pending)
- Once all fills settle, estimated buying power: ~$54,000
- DOGE and AAVE still in daily downtrend → regime blocked for new buys
- No TA signals cleared ≥3/6 threshold today — market extended at upper BB

→ Full detail: `memory/glossary.md`, `memory/projects/alpaca-trading-agent.md`
