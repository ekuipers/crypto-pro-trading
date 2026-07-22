---
name: crypto-catalysts
description: >
  Crypto news & event interpretation guide for the Alpaca paper spot trading agent.
  Use this skill whenever the hourly research pass fetches headlines, whenever the
  Decision Checklist asks "What does recent news say? Any macro catalysts?", or
  before entering/holding a position through a known scheduled event. It maps
  crypto-specific catalysts (ETF flows, token unlocks, hacks, depegs, regulatory
  actions, funding extremes, macro prints) to concrete risk actions within the
  existing rules. It never overrides the score gates or hard rules.
---

# Crypto Catalyst & News Interpretation

The 6-point confluence score reads the *chart*; this skill reads the *tape context*
around it. Catalysts are used **defensively only**:

> **Prime directive:** News can veto or downsize an entry, or flag an open position
> for closing (the take-profit-on-research rule). News can NEVER justify an entry
> that the score gates, regime gate, or correlation budget would reject.

---

## 1. Catalyst Severity Ladder

Classify every headline into one of three tiers before reacting:

| Tier | Definition | Action |
|------|-----------|--------|
| **T1 — Structural** | Changes the asset's fundamentals or market plumbing: exchange/protocol hack, stablecoin depeg, delisting, enforcement action against the asset itself, chain halt | Flag open position for close in the research block; block new entries in the symbol until resolved |
| **T2 — Flow** | Shifts supply/demand for days–weeks: large token unlock, ETF creation/redemption streak, major listing, halving window, treasury buys/sells | Downsize or skip borderline entries (score < 4); tighten attention on stops; note in journal |
| **T3 — Noise** | Price commentary, analyst targets, influencer takes, re-reported old news | Record headline, take no action |

Most headlines are T3. When unsure between tiers, pick the lower severity and re-check
next hour — reacting to noise is a documented Common Mistake (overtrading).

---

## 2. Macro Catalysts (market-wide)

Crypto trades as one risk asset in macro windows — the 10 watchlist majors correlate
at ~0.8, so macro hits everything at once.

| Event | Bullish read | Bearish read |
|-------|-------------|--------------|
| FOMC / rate decision | Cuts or dovish surprise → risk-on | Hikes or hawkish surprise → risk-off |
| CPI / PCE print | Below consensus | Above consensus |
| DXY (dollar index) | Falling / breaking down | Rising / breaking out |
| US equity indices | Grinding higher (risk appetite) | Volatility spike / breaking down |

**Practical rules:**
- In the 2 hours around a scheduled macro print, treat any borderline entry
  (half-size gate, 2.5–3.5) as a skip. Volatility spikes make the 0.2% limit band
  and fresh stops unreliable.
- A macro shock does not change the exit rules — stops and TA exits fire as normal.

---

## 3. Flow Catalysts (crypto-native)

| Signal | Bullish | Bearish |
|--------|---------|---------|
| Spot ETF net flows (BTC/ETH) | Multi-day inflow streak | Multi-day outflow streak |
| Token unlocks (alts) | Small (<1% supply), already priced | Large cliff unlock (>2–3% of supply) within days |
| Exchange listings | Major-venue listing announced | Delisting / trading suspension |
| Funding rate (perps) | Neutral to slightly positive | > +0.1%/8h = longs overcrowded (flush risk); deeply negative = squeeze fuel but unstable |
| Open interest | Rising OI + rising price | Rising OI + falling price, or OI blow-off at highs |
| BTC dominance | Falling in an uptrend → alt rotation (alt longs work) | Rising sharply → flight to BTC, alt longs underperform |

**Practical rules:**
- A large unlock inside the next ~7 days for a specific alt: skip new entries in that
  symbol even at full-size score; note "unlock veto" in the research block.
- Overcrowded funding (> +0.1%/8h) on a symbol we hold long: tighten expectations,
  make sure the trailing stop/HWM state is current — the next flush will be fast.

---

## 4. Structural Events (T1 handling)

- **Hack/exploit of the asset's chain or main venue** → flag any open position for
  close in the research block ("flagged to close: SYMBOL — exploit headline, T1").
  The evaluation's take-profit-on-research rule executes it through `trade.py`.
- **Stablecoin depeg** (USDT/USDC materially off $1) → market-wide T1: block all new
  entries; liquidity and quoted prices are unreliable during a depeg.
- **Regulatory enforcement naming the asset** (not general industry chatter) → T1 for
  that symbol; general "regulation coming" articles are T3.
- **Chain halt / consensus failure** → T1; also distrust the bars — indicators computed
  across a halt window are garbage.

---

## 5. Weekend & Session Liquidity

- Crypto trades 24/7 but liquidity is not uniform: weekends and 00:00–06:00 UTC are
  thin. Moves on thin volume reverse more often — the volume signal (#5) already
  scores this, but treat weekend breakouts with extra skepticism.
- Large-candle moves during thin hours with no catalyst attached are usually
  liquidations, not information. Don't chase (Common Mistakes rule).

---

## 6. Output Convention

In the hourly `Research HH:MM GMT+2` block, express catalyst conclusions in the
symbol's `Read:` line using this shape:

```
- Read: bias bullish; T2 ETF inflow streak day 4; no veto.
- Read: bias neutral; T2 unlock 3.1% supply on Jul 12 — unlock veto on new entries.
- Read: flagged to close: SOL/USD — T1 venue exploit headline.
```

The `:23` evaluation reads these flags. Keep one line per symbol; cite the tier so
future reviews can audit the call.

---

## What this skill is NOT

- Not a sentiment-trading system — no entries on "good news" alone.
- Not a replacement for the confluence score, regime gate, or sizing rules
  (`skills/crypto-trader/SKILL.md` remains the execution playbook).
- Not on-chain analytics — exchange flows/whale wallets are covered in
  crypto-trader §8; this skill covers *events and headlines*.
