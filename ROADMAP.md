# CryptoPro Trader — Roadmap

Open items only; completed ones are deleted, not archived (Suite rule 5). Scan the
[Suite roadmap](../CryptoPro%20Suite/ROADMAP.md) first.

**Nothing user-facing is open.** Items 1–3 decide whether the strategy has an edge at all, 4 is a
correctness gap that has already shipped bugs twice, 5 needs a market event, 6 is a limitation nobody has
hit, 7 is a pre-launch decision left open by the plan-skip that just shipped. **Do not add a browser click-through item** — the
whole dashboard, all four languages, was verified in the browser and found clean.

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

**The engine half is covered; the browser half is the gap.** `src/trade.test.js` already pins the clamp and
the 2-cycle escalation ceiling, but the dashboard re-implements both independently and untested:
`src/js/autopilot.js:477` carries the escalated band as its own literal (`0.005 + escalationExtraPct/100`)
and `src/js/strategy-config.js:65`'s `netRrPct()` is a second implementation of the R:R gate, consumed by
`autopilot.js` and `tabs-signals.js`. Those two are the concrete divergence risk — extend the parity test
to diff them against `trade.js` and `evaluateSymbol.js` the way the score is diffed today.

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

## 7. A plan lapse now skips the tenant, including their open positions

The engine half shipped 2026-08-06: `buildTenantContext()` resolves entitlement (role `admin`/`pro`, else
`db.getPlan()`) and returns `SKIP.NOT_PRO` before building an Alpaca client, so a free tenant no longer
costs a cycle of Alpaca calls on any of the three paths. It sits in `tenantEngine.js` rather than
`cronRoutes.js` because the two GET cron routes are bearer-authenticated with no session and cannot take a
`requirePlan()` route check.

**What is left is the hazard the skip creates**, deferred deliberately: a skipped tenant gets no stop
watchdog either, so an entitlement lapse abandons whatever is open. Acceptable now — every account is a
test account, paper money, pre-production — and **must be decided before this project goes live**. The
options are the usual three: flatten on lapse, keep running exits-only (watchdog yes, entries no), or a
grace period. Suite's roadmap owns the pricing side of that decision.
