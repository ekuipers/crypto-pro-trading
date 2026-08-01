# CryptoPro Trader — Roadmap

Open items only; completed ones are deleted, not archived (Suite rule 5). Scan the
[Suite roadmap](../CryptoPro%20Suite/ROADMAP.md) first.

**Nothing user-facing is open.** Items 1–3 decide whether the strategy has an edge at all, 4 is a
correctness gap that has already shipped bugs twice, 5 needs a market event, 6 is a limitation nobody has
hit. **Do not add a browser click-through item** — the whole dashboard, all four languages, was verified in
the browser and found clean.

## 1. Whether the 6-point score predicts direction has never been tested

The top item, because it gates every other strategy question — and nothing in the project answers it.
`scripts/replay.mjs` measures score and gate distributions with **no fills and no P&L**. Walk-forward was
removed rather than ported, so building a validator with fills and P&L is new work, not a restoration.

The consequence is concrete: the 4H-execution finding (mean net R:R **2.01** vs production's **−0.12**)
**cannot be acted on**, because net R:R is geometry, not edge — 2:1 at a 30% win rate still loses.

## 2. Volume signal 5 is mean-baselined, so it is skew-biased everywhere

`src/indicators.js`'s `volumeRatio()` divides by the *mean* of the previous 20 bars. Crypto volume is
right-skewed, so −0.5 fires roughly 3× more often than +1 — even on BTC/ETH 4H.

Recommended direction: **4H volume with a median baseline.** 4H is 0–16% empty on all ten symbols against
64–92% on 15-min, so it fixes sparsity *and* skew everywhere rather than on two symbols.

**Do not tune `MIN_TRADED_BARS`.** No value works — it behaves as a per-symbol on/off switch (pass rates
BTC/ETH 100%, SOL 78%, AVAX 11%, LINK 4%, LTC/DOGE 0%), and SOL at 78% flips scored↔n/a about one scan in
four. Measure with `scripts/replay.mjs` before shipping.

## 3. The sizing stop and the exit stop are different numbers

`src/entrySizing.js` sizes on `1.5 × ATR` of the *execution* timeframe (0.45–0.96% measured), while the
position actually exits at the **4H swing low** (`src/risk.js`'s `swingLowStopPrice()`, up to 8% below
entry — 6.46% measured). That is a **6–9× divergence**, so "risk = equity × 1%" is nominal and realized
risk per trade can be several multiples of it.

Fixing it means picking one stop as the sizing input — the exit stop is the honest choice. That is a real
strategy change, so measure it first.

## 4. Parity coverage stops at the score

`src/scoreParity.test.js` pins the 6-point score and nothing else — not order placement, not the entry
gates, not reconciliation. **Both engine/dashboard bugs that shipped lived in that uncovered area** (the
stop-escalation clamp that made stops unfillable, and the R:R gate that failed open on exactly the setups
it exists to catch), and the `reconcile.js` ↔ `apReconcileFromFills()` FIFO pair is still enforced by prose
alone.

Extend the parity test to cover the limit-band/clamp math and the entry-gate decision.

## 5. Stop escalation has never been observed against a real unfilled stop

The fix is deployed but unconfirmed. The next stop-loss that goes 2 cycles unfilled is the proof that the
0.5%→0.8% widening now reaches an order.

**A browser pass cannot close this** — it needs a live spread to widen past the base band, which is a
market event, not a UI action. Do not fold it into a click-through item.

## 6. Sub-daily cron cadence is not supported

`src/cronSchedule.js`'s `isJobDue()` takes a single `hourUtc` and gates on "hasn't run today", so it cannot
express "every N hours" without a design change (an array of hours, or a repeat-interval per job). Blocks
running `watchdog` more than once a day. **Nobody has asked for this** — it is listed so the limitation is
not rediscovered as a bug.
