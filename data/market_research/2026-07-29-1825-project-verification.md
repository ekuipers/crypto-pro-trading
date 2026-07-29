# Project Verification — 2026-07-29 18:25 GMT+2

## Scope

Triggered by CLAUDE.md's rule to invoke the market-researcher after every strategy change.
Two scoring commits shipped to `main` today, neither previously reviewed:

- **a601d27** — volume sparse-tape guard. `volumeRatio()` returns `null` unless ≥ `MIN_TRADED_BARS`
  (10) of the 20 baseline bars have volume > 0. Mirrored in `src/js/ta-lib.js`'s `calcVolRatio()`.
- **93e9c0f** — dashboard EMA-cross bar threshold moved 50 → 51 (`EMA_CROSS_MIN_BARS`), matching
  `emaCrossState()`. Engine unchanged.

Verified against code (`src/indicators.js`, `src/js/ta-lib.js`, `src/evaluateSymbol.js`, `src/risk.js`,
`src/alpacaClient.js`, `config.json`, README.md, `docs/dashboard_layout.md`), against live Alpaca
market data, and against the live paper account's realized fill ledger. Analysis only — no orders,
no code or config edits.

---

## Findings

### 1. Both commits do what they claim; tests pass

`npm test` — **483 pass, 0 fail, 107 suites, 32.5 s.** Matches 93e9c0f's stated count.
`src/scoreParity.test.js` genuinely enforces the dashboard↔engine identity rule end-to-end
(200 seeded markets + data-sufficiency edges); it is the first real guard on an invariant that had
lived only as prose. That is a clear net improvement.

The EMA-cross fix (93e9c0f) is **correct and low-risk**. At exactly 50 bars an EMA-50 is its SMA
seed; the engine has always required 51; `evaluateSymbol` enforces `MIN_BARS` 60 so only the
dashboard/Autopilot short-history path moves. No objection.

### 2. The volume guard's stated effect does not generalize — it is a net score *inflator*

The commit describes the change as symmetric noise removal ("removes noise, not information",
"4× +0.5, 2× −1.0"). Replaying the full 6-point score bar-by-bar over the live 15-min history,
with and without the guard (140 evaluation points per symbol, 1,400 total — `gates.mjs`):

| Symbol | avg score old | avg score new | Δ avg | bars changed | ≥2.5 old→new | ≥3.5 old→new |
|---|---|---|---|---|---|---|
| BTC/USD | −0.65 | −0.65 | 0.00 | 0% | 3 → 3 | 0 → 0 |
| ETH/USD | 1.09 | 1.09 | 0.00 | 0% | 22 → 22 | 5 → 5 |
| SOL/USD | −1.02 | −0.98 | +0.04 | 27% | 0 → 0 | 0 → 0 |
| AVAX/USD | 0.21 | 0.34 | +0.14 | 83% | 10 → 11 | 3 → 1 |
| LINK/USD | 0.36 | 0.62 | +0.25 | 96% | 6 → 7 | 1 → 0 |
| DOT/USD | −1.44 | −1.14 | +0.31 | 98% | 1 → 0 | 0 → 0 |
| LTC/USD | −0.25 | 0.08 | +0.34 | 80% | 10 → 13 | 2 → 0 |
| DOGE/USD | −0.95 | −0.68 | +0.27 | 92% | 0 → 0 | 0 → 0 |
| ADA/USD | −0.72 | −0.59 | +0.14 | 79% | 0 → 0 | 0 → 0 |
| AAVE/USD | 0.59 | 0.94 | +0.34 | 94% | 10 → 11 | 0 → 0 |
| **Total** | | | **+0.18 avg** | | **62 → 67 (+8%)** | **11 → 6 (−45%)** |

The average score change is **positive on every symbol**, never negative. The "2 lost −1.0"
characterization is a single-scan artifact: over the window, SOL's mean score *rose* +0.04 and
AVAX's rose +0.14. Cause: on Alpaca's 15-min tape the volume component reads −0.5 on 68–86% of
bars and +1 on only 10–23% (`probe3.mjs`), so deleting the component deletes a net negative.

Net directional effect: **+8% more half-size entry opportunities, −45% fewer full-size ones.**
Notional-neutral to first order (+5 half-size ≈ −5 full→half downgrades), but it is *not* the
neutral change described.

### 3. The guard fixes the denominator and leaves the numerator degenerate

`volumeRatio` is `volumes[last] / mean(previous 20)`. The guard tests only the baseline window.
The current bar is unchecked, so "did a trade land in this bucket" survives — on precisely the two
symbols the guard preserves. Live at 18:10 GMT+2: **BTC scored `0.07x avg (thin, −0.5)` and ETH
`0.00x avg (thin, −0.5)`** with 19/20 baseline bars traded. Over 180 rolling windows the current
bar is empty in 3% (BTC) / 8% (ETH) of scored windows.

Worse, for the marginal alts the guard admits exactly the wrong windows (`probe2.mjs`,
share of *guard-passing* windows whose current bar has zero volume):

| Symbol | 15-min empty | guard passes | zero numerator among passers | post-guard mix |
|---|---|---|---|---|
| BTC | 3% | 100% | 3% | +1:23% −0.5:69% 0:7% |
| ETH | 10% | 100% | 8% | +1:19% −0.5:72% 0:9% |
| SOL | 41% | **78%** | 39% | +1:21% −0.5:73% 0:6% |
| AVAX | 64% | 11% | 70% | +1:20% −0.5:80% |
| LINK | 70% | 4% | 88% | **+1:0% −0.5:100%** |
| DOT | 74% | 8% | 60% | +1:7% −0.5:80% 0:13% |
| ADA | 65% | 13% | 67% | +1:8% −0.5:92% |
| AAVE | 75% | 2% | 100% | **+1:0% −0.5:100%** |
| LTC | 93% | 0% | — | — |
| DOGE | 80% | 0% | — | — |

For LINK and AAVE, every window that survives the guard scores −0.5. The guard removed the
positive spikes and kept a near-pure penalty on the residue.

**SOL at 78% pass rate is a new instability**, not a fix: the component now flips between *scored*
and *n/a* roughly one scan in four, which is itself a ±0.5–1.0 swing at the gate. Raising the
threshold to 15 would move SOL to 20% pass and 18 to 0% — i.e. the parameter is a per-symbol
on/off switch, not a per-scan sufficiency test. There is no value of `MIN_TRADED_BARS` that both
keeps SOL stable and admits the alts.

### 4. The deeper defect is the **mean** baseline, not sparsity — and it affects BTC/ETH too

Crypto volume is right-skewed and bursty, so most bars sit below the 20-bar mean regardless of
tape density. Same-window comparison of mean vs median baselines (`probe3.mjs`):

| Symbol | 15m mean | 15m median | 4H mean | 4H median |
|---|---|---|---|---|
| BTC | +1:23% −0.5:69% | +1:47% −0.5:43% | +1:32% −0.5:54% | +1:51% −0.5:37% |
| ETH | +1:19% −0.5:72% | +1:48% −0.5:40% | +1:30% −0.5:48% | +1:47% −0.5:35% |
| SOL | +1:21% −0.5:73% | +1:46% −0.5:52% | +1:26% −0.5:55% | +1:50% −0.5:37% |
| LINK | +1:16% −0.5:80% | — (n=8) | +1:27% −0.5:65% | +1:43% −0.5:41% |
| LTC | +1:5% −0.5:95% | — | +1:16% −0.5:70% | +1:45% −0.5:45% |
| DOGE | +1:12% −0.5:85% | — | +1:18% −0.5:72% | +1:46% −0.5:47% |
| AAVE | +1:10% −0.5:86% | — | +1:24% −0.5:65% | +1:53% −0.5:45% |

Signal 5 fires −0.5 roughly **3× more often than +1 on every symbol, every timeframe, including
BTC and daily bars.** That is a systematic ≈ −0.3 bias on a 6-point score, not noise, and the guard
does not touch it on the symbols it preserves. A median baseline centres the component
(~45/45 split) on all ten symbols including LTC and DOGE.

**4H volume is clean on every watchlist symbol**: guard passes 100% (LTC and DOGE included),
zero-numerator 0–15%, and the distribution is well-behaved. If the volume component is worth
keeping, 4H volume with a median baseline is the empirically supported form.

### 5. Consistency check

| Item | Status |
|---|---|
| `src/indicators.js` ↔ `src/js/ta-lib.js` score parity | **PASS** — pinned by `scoreParity.test.js` (full 6-point, 200 markets, edges) |
| `MIN_TRADED_BARS` = 10 on both sides | PASS (`indicators.js:359`, `ta-lib.js:142`; asserted `scoreParity.test.js:118`) |
| `EMA_CROSS_MIN_BARS` = 51 on both sides | PASS (`ta-lib.js:146`, `indicators.js:53`) |
| CLAUDE.md scoring-invariants list updated | PASS (CLAUDE.md:88–91) |
| `memory/memory.md`, `memory/glossary.md` updated | PASS |
| **README.md** | **FAIL** — Signal Confluence Table row 5 (README.md:331) still reads `≥1.2× 20-bar avg +1 / <0.7× avg −0.5` with no n/a case. Neither commit touched README.md. Workflow rule 1 names it explicitly. |
| **`docs/dashboard_layout.md`** | **FAIL** — `src/js/ta-lib.js` is dashboard scoring code and both commits changed it; the doc's changelog has no 2026-07-29 scoring entry. Workflow rule 1: "for dashboard changes — `docs/dashboard_layout.md`". |
| `config.json` | **WARN** — `MIN_TRADED_BARS` is a hardcoded literal in two files. Every other scoring threshold is config-seeded (CLAUDE.md invariant: "`STRAT_CFG` seeded from `config.json`"). It is also absent from `userConfig.js`'s `CONFIG_SPEC`, so it is neither per-user tunable nor locked-by-declaration. Related pre-existing gap: `config.json › indicators.volume_period` (20) is never read — `volumeRatio()` hardcodes `period = 20`, and `MIN_TRADED_BARS` is documented as "half the window" of that unread value. |
| `src/evaluateSymbol.js` | PASS — consumes `signalScore` only; no separate volume gate; `volumes` derive from bars with `c`, so zero-volume bars are retained and counted correctly. |
| `src/risk.js` | PASS w.r.t. these two commits (no volume coupling). Separate findings below. |
| `src/scout.js` | **WARN, unflagged side-effect** — promotes at `signalScore ≥ 4.0` across a ≤60-symbol `*/USD` universe that is overwhelmingly thin. Full-gate crossings fell 45% on the watchlist; scout promotion rate will fall materially. Not necessarily bad (scout picks BONK/CRV/GRT cost −$1,060 realized) but it is an untracked behaviour change. |
| `src/js/tabs-gapgo.js:234` | OK — has its own 20-bar mean volume ratio, but on **daily** bars (0% empty), and the Conviction score is an explicit parity exemption. No action. |
| Dashboard label honesty | **MEDIUM** — below 51 bars `ta-lib.js:277` sets `signals.ema_cross = "0 Neutral"` and `:334` `regime4h = "0 –"`. The engine says `"n/a (need 51 bars)"`. Scores match, but the dashboard tells the user the cross *was* evaluated and came out neutral when it was not evaluated at all. |
| Hard rules (cash reserve, caps, limit-only, stop logic, regime gates) | Not weakened by either commit — both are score-input changes upstream of every gate. |
| Ships-OFF flags / `assertNotShipped()` | Unaffected. |
| `.env` | Cosmetic: still carries a `TRADER_OWNER_UID=` line. Code and `.env.example` both record it as removed (Phase 5); harmless dead entry. |
| `skills/hourly-research-SKILL.md` | **Missing.** Referenced by this agent's own brief; does not exist anywhere in the repo. |

### 6. Evidence base

`reports/` **does not exist** — no walk-forward output at any path. `journal/` does not exist
either (journal moved to Postgres `trader_journal` at Phase 4). `walkforward_evaluate.py` /
`forward.yml` were deleted 2026-07-25 and no Node port exists.

**Neither commit is backtest-validated, and none can be until a Node walk-forward evaluator is
written.** The measurements in both commit messages are single live scans. Per the brief: stating
this plainly rather than estimating.

The 2026-07-24 `data/positions_state.json` shows `streak_throttle_active: true` — the throttle has
been holding risk at ×0.5, consistent with the realized record below.

---

## Live account: the edge is not decaying, it is absent

Read-only from the paper account's own fill ledger (1,215 fills, account opened 2026-05-08):

- Equity **$91,209.81** (−8.8% from $100k in 81 days). Cash $80,559.51. 2 open positions
  (ETH +0.72%, LTC −2.49%). Cash reserve 88% — well clear of the 20% rule.
- **331 whole round trips: 44.1% win rate, profit factor 0.30, net −$7,043**, avg win $20.48 vs
  avg loss $54.24, per-trade Sharpe-like −0.23.
- Per lot-leg (590 legs, `perf3.mjs`): win rate 37.3%, **avg win +2.42% vs avg loss −4.25%,
  payoff ratio 0.57**, expectancy **−1.77%/trade gross of fees, −2.27% net**.
  **Break-even win rate required: 71.3%. Achieved: 37.3%.**
- Hold time: median 45.0 h, p90 162 h, max 1,510 h. The 48 h stale exit rarely fires (it also
  requires trail-never-armed *and* score < 2.5).
- Per-symbol net: SOL −1,798 · ETH −1,038 · ADA −967 · BTC −659 · AVAX −561 · LINK −518 ·
  BONK −466 · DOT −391 · DOGE −376 · CRV −353 · LTC −262 · GRT −241 · BAT −59 · SUSHI +7 ·
  AAVE +58 · UNI +582. BTC wins 70% of trips and still loses $659 — the payoff ratio, not the
  hit rate, is what is broken.
- Traded notional ≈ $969k → **≈ $2,424 in explicit taker fees alone (25 bps/side), ~34% of the
  total loss**, before any spread cost.

**The problem both commits address (±0.5–1.0 of score) is second-order to a 0.57 payoff ratio.**
Score changes alter trade *selection*; they cannot fix win/loss asymmetry.

---

## Two structural findings outside the commits' scope

### A. The 2-cycle stop-loss escalation is a proven no-op — CRITICAL

CLAUDE.md hard rule: "Stop dedup: check `getOpenOrders`, cancel-replace **wider** after 2 cycles."

`risk.js:373 stopLossLimitPrice()` widens the band from 0.5% to 0.8% at cycle ≥ 2, then
`alpacaClient.js:198-210 placeOrder(isStopLoss=true)` clamps any limit outside ±0.5% of ask back
to the band edge. Verified numerically (`clamp.mjs`, ask = 100):

```
cycles=0  stopLossLimitPrice=99.5  -> clamped to 99.5
cycles=2  stopLossLimitPrice=99.2  -> clamped to 99.5   <-- escalation erased
cycles=3  stopLossLimitPrice=99.2  -> clamped to 99.5
```

`STOP_LOSS_ESCALATION_EXTRA_PCT` (0.003) can never take effect, because 0.005 + 0.003 > 0.005 by
construction. The replacement order is priced identically to the one it replaces.

This bites because the stop-limit floor (ask × 0.995) is **inside the spread** on part of the
watchlist. Bid-ask, three samples ~4 s apart, stable:

| BTC | ETH | LINK | DOT | AAVE | ADA | DOGE | SOL | **AVAX** | **LTC** |
|---|---|---|---|---|---|---|---|---|---|
| 0.08–0.13% | 0.100% | 0.198% | 0.224% | 0.19–0.24% | 0.299% | 0.300% | 0.368% | **0.570–0.577%** | **0.586%** |

On AVAX and LTC a stop-loss sell limit at ask × 0.995 sits **above the bid** and does not cross —
permanently, since escalation is clamped away. That is a plausible mechanical contributor to the
measured −4.25% average loss against stops that should cap near −5%.

### B. 15-min execution is economically unviable on this venue for this watchlist

Round-trip cost = 2 × 25 bps + live spread. Live net R:R at the flat-entry gate (`rr.mjs`,
BB-upper target vs 4H swing-low stop, exactly as `evaluateSymbol.js:569-590` computes it):

| Symbol | cost % | stop dist % | target dist % | net R:R | gate |
|---|---|---|---|---|---|
| BTC | 0.619 | 2.26 | 0.85 | 0.10 | BLOCK |
| ETH | 0.575 | 2.27 | 1.03 | 0.20 | BLOCK |
| SOL | 0.915 | 1.52 | 0.78 | −0.09 | BLOCK |
| AVAX | 1.128 | 1.71 | 0.04 | −0.64 | BLOCK |
| LINK | 0.715 | 1.22 | 1.48 | 0.63 | BLOCK |
| DOT | 0.718 | 2.21 | n/a | n/a | **no geometry → gate skipped** |
| LTC | 1.118 | 1.00 | 0.35 | −0.76 | BLOCK |
| DOGE | 0.806 | 1.66 | 0.56 | −0.15 | BLOCK |
| ADA | 0.800 | 6.46 | 0.69 | −0.02 | BLOCK |
| AAVE | 0.688 | 5.84 | 0.43 | −0.04 | BLOCK |

**The BB-upper target is nearer than the round-trip cost on 8 of 10 symbols.** 15-min ATR is
0.30–0.64% of price while friction is 0.58–1.13% — the execution timeframe's entire move budget is
smaller than the cost of taking it. This is the deeper problem the sparse-tape guard is papering
over: a tape too thin to measure participation on is also a tape whose 15-min moves cannot pay
for a round trip.

Two sub-findings:

1. **The soft R:R gate fails open.** `netRr()` returns `null` when `target ≤ entry`
   (`risk.js:423`) and `evaluateSymbol.js:582` then skips the check entirely. DOT is in that state
   right now. The gate is bypassed precisely when price is *above* the BB upper band — the most
   extended, worst-cost setups.
2. **Sizing stop ≠ exit stop, by 6–9×.** ATR sizing uses 1.5 × ATR(15m) = 0.45–0.96% of price,
   but the exit stop is the 4H swing low: ADA 6.46% (8.8× the sizing distance), AAVE 5.84% (6.1×).
   CLAUDE.md acknowledges "realized risk can differ from 1%"; the live magnitude is 6–9×, which
   makes the 1%-risk rule nominal.

---

## Verdict

- **PASS** — 93e9c0f (EMA threshold 50 → 51). Correct, engine-aligned, zero engine-behaviour change.
- **PASS** — `src/scoreParity.test.js`. Real enforcement of a previously prose-only invariant; the
  right pattern for all future indicator work.
- **PASS** — Tests: 483/483, 0 failures.
- **PASS WITH WARNINGS** — a601d27 (volume guard). Directionally defensible (the raw ratio was
  genuinely degenerate) but mischaracterized: it is a net **+0.18** score inflator across the
  watchlist, not symmetric noise removal; it leaves the numerator unguarded (BTC and ETH are
  scoring −0.5 on 0.07x/0.00x *right now*); and it introduces a 22% scored/n-a flip on SOL.
- **FAIL** — Workflow rule 1: README.md not updated (Signal Confluence Table row 5 is now wrong).
- **FAIL** — Workflow rule 1: `docs/dashboard_layout.md` not updated for a dashboard-code change.
- **FAIL** — Evidence: no walk-forward validation exists or can be produced. `reports/` does not
  exist; the Node port remains unwritten. Both changes rest on single live scans.
- **WARN** — `MIN_TRADED_BARS` hardcoded in two files, outside `config.json` and `CONFIG_SPEC`,
  breaking the config-seeding invariant it sits next to.
- **WARN** — Unflagged side-effect: scout promotion rate falls with the 45% drop in ≥4.0 crossings.
- **WARN (MEDIUM)** — Dashboard reports "0 Neutral" where the engine reports "n/a (need 51 bars)".
- **FAIL (CRITICAL, pre-existing, outside these commits)** — The "cancel-replace wider after 2
  cycles" hard rule does not function: escalation to 0.8% is clamped back to 0.5%. On AVAX and LTC
  (spread 0.57–0.59%) the stop-loss limit never crosses the spread.
- **FAIL (pre-existing)** — Net R:R soft gate fails open when no BB-upper target exists above ask.
- **CONTEXT** — Live edge is unproven-to-negative: PF 0.30, payoff 0.57, break-even win rate 71%
  vs 37% achieved, −$7,043 over 331 round trips.

---

## Recommendations

Advice only. No trades, no code changes made.

**Immediate (documentation debt, blocks the standing rule):**

1. Update README.md:331 — signal 5 needs its n/a case: "n/a when < 10 of the 20 baseline bars
   traded (contributes 0)".
2. Add a 2026-07-29 entry to `docs/dashboard_layout.md` covering both `ta-lib.js` changes.
3. Move `MIN_TRADED_BARS` and `EMA_CROSS_MIN_BARS` into `config.json › indicators` and seed
   `STRAT_CFG` from them; add `MIN_TRADED_BARS` to `CONFIG_SPEC` with a bound (or lock it) so a
   per-user config cannot silently disable the guard. While there, either wire
   `indicators.volume_period` to `volumeRatio()` or delete the unread key.

**On the volume component itself — pick one, do not stack them:**

4. *Preferred:* **drop signal 5 from the 15-min score and recompute it on 4H volume with a median
   baseline.** 4H volume is 0–16% empty on every watchlist symbol (guard passes 100%), and a
   median baseline yields a centred +1:43–53% / −0.5:35–47% distribution instead of the current
   3:1 penalty skew. This fixes the sparsity *and* the mean-skew defects at once, on all ten
   symbols rather than two. Requires a parity-test extension and a `bars4h` volume plumb-through.
5. *Minimum viable, if 4 is too large:* keep the guard but **also require the current bar to have
   traded** (`volumes[last] > 0`), otherwise return `null`. Three watchlist symbols are being
   penalized −0.5 by an empty current bucket at this moment, including both symbols the guard was
   designed to preserve.
6. Do **not** tune `MIN_TRADED_BARS` up or down. 10 already behaves as a per-symbol on/off switch;
   15 zeroes SOL and 18 zeroes ETH's stability. The parameter cannot be made to work.
7. Re-word CLAUDE.md:89 and `memory/memory.md`: the measured effect is a net **+0.18** average
   score across the watchlist and **+8% half-size / −45% full-size** gate crossings, not a
   symmetric 4×+0.5 / 2×−1.0. Preserving the incorrect framing risks the next change being sized
   against it.

**Structural — these dominate anything the score can do:**

8. **Fix the stop escalation.** Either raise the clamp band when `cyclesOpen ≥ escalationCycles`
   (pass the effective band into `placeOrder`), or drop `STOP_LOSS_ESCALATION_EXTRA_PCT` and stop
   documenting a rule that cannot fire. Today's behaviour is the worst case: documented, tested at
   the `risk.js` layer, and erased at the client layer.
9. **Make the R:R gate fail closed.** When `netRr()` returns `null` because no BB-upper target sits
   above ask, block the entry rather than skipping the check. A soft gate that opens on the most
   extended setups is worse than no gate.
10. **Reconsider the 15-min execution timeframe for everything except BTC/ETH.** Round-trip cost
    (0.58–1.13%) exceeds the BB-upper target distance (0.04–1.48%) on 8 of 10 symbols and exceeds
    1.5×ATR(15m) (0.45–0.96%) on all ten. Either move execution to 1H/4H, where the move budget can
    pay for the round trip, or cut the watchlist to the symbols whose spread is under ~0.15%
    (BTC, ETH only, today). This is the answer to "is the guard papering over a deeper problem":
    yes — a tape too thin to measure volume on is the same tape whose 15-min range cannot cover
    its own frictions.
11. **Reconcile ATR sizing with the swing-low exit.** Size on the actual stop distance
    (`swingLowStopPrice`) rather than 1.5×ATR(15m), or the 1%-risk rule stays nominal at a measured
    6–9× overshoot on ADA/AAVE.
12. **Write the Node walk-forward evaluator before the next scoring change.** Three consecutive
    strategy commits now rest on single live scans. With realized PF at 0.30 there is no basis for
    believing any score tweak helps or hurts; the honest position is unproven, and it will stay
    unproven until a backtest harness exists.

---

## Data sources

**Scripts run** (all read-only; scratchpad, not committed):
`research.mjs` (per-symbol regime/ATR/tape/score), `probe2.mjs` (180 rolling windows, guard pass
rate + residual noise, 15m vs 4H), `probe3.mjs` (mean vs median baseline, 15m/4H/1D),
`gates.mjs` (1,400-point score replay with/without guard vs the 2.5/3.5 gates),
`perf.mjs` / `perf2.mjs` / `perf3.mjs` (account, FIFO round trips, per-symbol P&L, per-trip
return %), `rr.mjs` (live net R:R gate), `clamp.mjs` (stop escalation vs clamp, pure function),
`spread.mjs` (3× spread sampling). `npm test` (483 pass).

**Alpaca REST (read-only):** `/v1beta3/crypto/us/bars` (15Min/4Hour/1Day, 10 symbols),
`/v1beta3/crypto/us/latest/quotes`, `/v2/account`, `/v2/positions`, `/v2/account/activities`
(1,215 FILL records). No order, cancel, or state-mutating endpoint was called.

**Files read:** `CLAUDE.md`, `README.md` (312–345, 506), `config.json`,
`src/indicators.js` (1–120, 300–522), `src/js/ta-lib.js` (120–353), `src/evaluateSymbol.js`,
`src/risk.js` (152–177, 373–428), `src/alpacaClient.js` (72–215), `src/marketData.js` (1–130),
`src/scout.js`, `src/js/tabs-gapgo.js` (225–290), `src/js/tabs-signals.js` (233),
`src/scoreParity.test.js`, `src/indicators.test.js`, `skills/crypto-trader/SKILL.md`,
`docs/dashboard_layout.md`, `memory/glossary.md`, `data/positions_state.json`,
`data/shadow_run_log.jsonl`, `.env.example`.
**Git:** `git show a601d27`, `git show 93e9c0f`, `git log`.
**Web:** none — all findings derive from live venue data and the repository.
