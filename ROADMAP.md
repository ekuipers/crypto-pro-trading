# CryptoPro Trader — Roadmap

Open items only; completed ones are deleted, not archived (Suite rule 5). Scan the
[Suite roadmap](../CryptoPro%20Suite/ROADMAP.md) first.

**Nothing user-facing is open.** Items 1–3 decide whether the strategy has an edge at all, 4 is a
correctness gap that has already shipped bugs twice, 5 needs a market event, 6 is a limitation nobody has
hit, 7's decision is made (grace period) but the hazard it bounds, not removes, still needs a pre-launch UI
pass. **Do not add a browser click-through item** — the
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

## 4. Parity coverage stops at the score — R:R gate + escalated band now covered, 2026-08-06

`src/scoreParity.test.js` pins the 6-point score. **Both engine/dashboard bugs that shipped lived in the
uncovered area beyond it** (the stop-escalation clamp that made stops unfillable, and the R:R gate that
failed open on exactly the setups it exists to catch) — those two are now pinned by
`src/rrAndStopParity.test.js`, using the same vm-loading technique as `scoreParity.test.js`: the real
`src/js/strategy-config.js` is loaded standalone and its `netRrPct()`/`roundTripCostPct()`/
`escalatedStopBandPct()` are diffed against `risk.js`'s `netRr()`/`roundTripCostPct()`/
`STOP_LOSS_LIMIT_BAND_PCT`+`STOP_LOSS_ESCALATION_EXTRA_PCT` across 500 randomly generated setups, the
null-geometry fail-closed cases, and a sweep of escalation-extra values. `src/js/autopilot.js`'s escalated
band was an inline literal (`0.005 + STRAT_CFG.escalationExtraPct/100`), not a callable — pulled out into
`strategy-config.js`'s `escalatedStopBandPct()` (behavior-identical, same literal) purely so the real
shipped code is what gets diffed, not a hand-typed copy of it.

**Still open:** the `reconcile.js` ↔ `apReconcileFromFills()` FIFO/flatness/dust-tolerance pair is still
enforced by prose alone, not a test — `apReconcileFromFills()` lives in `src/js/edge-insights.js`, a much
larger browser-only surface than `strategy-config.js`'s isolated pure functions, so vm-loading it standalone
is a bigger lift than this pass. Order placement itself also has no cross-engine diff test, though
`src/trade.test.js` covers the engine side alone.

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

## 7. A plan lapse now skips the tenant, including their open positions — grace period, done 2026-08-06

The engine half shipped 2026-08-06: `buildTenantContext()` resolves entitlement (role `admin`/`pro`, else
`db.getPlan()`) and returns `SKIP.NOT_PRO` before building an Alpaca client, so a free tenant no longer
costs a cycle of Alpaca calls on any of the three paths. It sits in `tenantEngine.js` rather than
`cronRoutes.js` because the two GET cron routes are bearer-authenticated with no session and cannot take a
`requirePlan()` route check.

**Decision (user, 2026-08-06): grace period**, of the usual three (flatten on lapse, exits-only, grace
period). `tenantEngine.js`'s `ENGINE_GRACE_MS` (3 days, placeholder — the exact duration is a pricing call
Suite's roadmap owns, not an engine constraint) keeps a lapsed tenant fully entitled — both `evaluate` and
`watchdog` — for that long past `subscriptions.current_period_end`, so a missed Patreon webhook or a brief
payment hiccup doesn't abandon an open position with no stop-watchdog cycle. Engine-only: `requirePlan('pro')`
on the HTTP surface (manual "Run now", schedule writes, credential/strategy config) is untouched and still
gates on `getPlan()` the instant the period ends — that protects paid-only *features*, this protects money
already at risk. `cronRoutes.js` logs a warning whenever a cycle ran on grace (`ctx.graceUntil`), otherwise
silent since the run itself looks identical to a fully-entitled one. Covered by
`tenantEngine.test.js`.

**Still open:** no UI/notification surfaces the grace window to the user — a lapsed tenant has no way to
know their positions are on borrowed time until it actually ends. And once `ENGINE_GRACE_MS` fully elapses,
the original hazard (no stop watchdog) still applies — the grace period bounds it, it doesn't remove it.
Both acceptable pre-launch for the same reason as before: every account is still a test account, paper
money.
