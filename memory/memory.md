# Project: CryptoPro Trader

## v2026-07-29.6 — 2026-07-29 — replay harness; volume numerator guard, measured before shipping

The point of this one is the **order of operations**: build the measurement, then use it, then ship.
Four strategy changes shipped earlier today on single-scan evidence, and one carried a wrong
published figure as a direct result.

- **`src/replay.js` + `scripts/replay.mjs` (new).** Drives the real `evaluateSymbol` across a
  sliding window of historical bars and reports score distribution, gate crossings, net-R:R stats,
  and a bucketed tally of *which gate decided each window*. **Explicitly not a backtester** — no
  fills, no P&L, answers nothing about profitability. That is the larger follow-up that also
  retires the Backtest tab's stale banner.
- **Two fidelity rules it would be worthless without**, both pinned by tests: higher-timeframe bars
  align by **timestamp, not index** (index alignment leaks future 4H/daily regime into every
  window — the classic way a replay flatters a strategy), and `spreadPct` is **required with no
  default**, because it feeds round-trip cost and therefore the R:R gate directly.
- **Baseline, 3,410 windows at a 0.58% spread:** 191 windows cleared the ≥2.5 score gate,
  **180 of those were then blocked by R:R**, 6 entries. The R:R gate does ~97% of the rejecting,
  and 139 of 179 evaluated net-R:R values are negative. `blocked:rr-no-target` = 7 — the fail-open
  path closed earlier today, so 7 windows would previously have entered unchecked.
- **A misread of my own, worth recording.** Two runs at 0.05% and 0.58% spread produced identical
  bucket counts and I called it a harness bug. It wasn't: the spread *does* propagate (mean netRr
  −0.11 → −0.42), but every value is negative at both spreads, so the outcome bucket is the same.
  Chasing it produced the sharper finding — **at a 0.05% spread the round-trip cost is still 0.55%,
  so the 2×25bps taker fee ALONE exceeds the 15-min BB-upper target distance.** It is not mainly
  the spread. `summarize()` now reports `meanNetRr`/`rrNegative` so this is visible in the report
  instead of needing a probe.
- **Volume numerator guard, measured then applied.** `volumeRatio` now also returns `null` when the
  **measured bar itself had no trades** — `0 / anything` is 0, which the caller scored −0.5, but
  zero trades is an absence of observation, not "maximally thin". A small-but-real volume is
  genuine thinness and still scores. **Predicted from replay before merging: mean +0.039, positive
  on every symbol, 7.7% of windows changed, ≥2.5 crossings 191 → 202. Confirmed post-merge: 202.**
  DOGE and LTC were unchanged — so sparse that the baseline guard already returns null first.
- Semantics tightened as a result: "thin" now means *few* trades, not *none*. An existing test
  asserting a zero-volume bar still scores −0.5 had its fixture changed to a small non-zero volume,
  and the two n/a causes are now labelled separately in the journal.
- **`config.json › indicators.min_traded_bars` is the single source of truth** (raised by
  market-researcher: the constant was absent from config.json entirely, breaking the
  "STRAT_CFG seeded from config.json" invariant it sits beside). `indicators.js` stays a config-free
  pure module and `ta-lib.js` needs a value before config.json loads, so both keep a mirroring
  literal — and `scoreParity.test.js` now fails if any of the three drift. The long-unread
  `indicators.volume_period` is pinned the same way.
- **Dashboard label honesty.** Below 51 bars `ta-lib.js` said `"0 Neutral"` / `"0 –"` where the
  engine says `"n/a (need 51 bars)"` — scores matched, but the label told the user the cross *was*
  evaluated when there was never enough history to look. Both now say n/a.
- 508 tests pass (492 + 16: 13 harness, 3 volume/label). Build clean.
- **Next, in order:** 4H+median volume baseline (the remaining skew defect); order-placement and
  entry-gate parity tests, since two of today's three engine bugs were there and `scoreParity`
  covers scoring only; then the walk-forward evaluator with fills and P&L.

## v2026-07-29.5 — 2026-07-29 — the net R:R entry gate failed OPEN, inverted

Third finding from the same market-researcher pass, and the same shape as the stop-escalation one:
a documented rule that did not do what it said, in **both** engines.

- **The inversion.** `netRr()` returns `null` when either leg is missing, and both
  `evaluateSymbol.js` and the dashboard's `autopilot.js` guarded with `if (rr !== null)` /
  `if (rrNet !== null && ...)` — i.e. **skipped the gate entirely** on null. But `target` is null
  precisely when `bb.upper <= ask`, meaning **price is at or above the BB upper band**. So the most
  extended setups — the exact case the gate exists to catch — passed unchecked, while ordinary
  setups were tested. A null `entryStop` (fewer than 5 usable 4H lows, or a swing low above entry)
  skipped it too, entering with an unmeasurable risk leg.
- **It was known and worked around, not unknown.** `evaluateSymbol.test.js`'s existing R:R test
  carried the comment *"upper == ask -> no usable target -> rr stays null -> gate skipped"* and
  chose a different fixture to avoid it. The behaviour was documented in a test as expected rather
  than recognised as a defect. Worth remembering as a review smell: a test comment explaining how to
  route *around* a code path is often describing a bug.
- **Fix:** both null cases now **block**, and the reason string names which leg is missing
  ("no upside to the BB upper band" vs "risk leg is unmeasurable") — "R:R unavailable" alone would
  have sent the next investigation guessing, the same way bare "n/a" did on the volume component.
  Applied to `evaluateSymbol.js` and `src/js/autopilot.js` together. The word "soft" was dropped
  from the rule in CLAUDE.md.
- 492 tests pass (488 + 4). **No existing test failed when the behaviour changed** — none of them
  exercised the fail-open path, which is why it survived. The four new tests cover: at the band,
  above the band, missing stop, and a healthy setup still entering (so the gate didn't become a
  blanket block).
- **Pattern across today's three engine bugs — worth acting on.** Stop escalation, and now this,
  were both **engine/dashboard divergences or shared fail-opens in order/entry logic**, not scoring.
  `src/scoreParity.test.js` covers scoring only. There is still no parity or fail-closed test over
  order placement and entry gating, and that is where two of the three live-money bugs were.

## v2026-07-29.4 — 2026-07-29 — the 2-cycle stop escalation was a no-op; stops were unfillable

Found by the market-researcher pass, verified in code before acting. **Not a scoring nicety — this
was a live risk-management failure.**

- **The bug, exact and arithmetic.** `risk.js`'s `stopLossLimitPrice(ask, cyclesOpen)` widens the
  band 0.5% → 0.8% at `cyclesOpen >= STOP_LOSS_ESCALATION_CYCLES` (2). `alpacaClient.js` then
  clamped any stop-loss limit more than `STOP_LOSS_LIMIT_BAND_PCT` (0.5%) from the ask back to
  exactly `ask − 0.5%`. Since `0.005 + 0.003 > 0.005` **by construction**, the escalated price was
  always clamped straight back to the un-escalated price. `STOP_LOSS_ESCALATION_EXTRA_PCT` could
  never reach an order. CLAUDE.md's "cancel-replace wider after 2 cycles" hard rule did not
  function in the engine, and had not since the clamp was introduced (2026-06-11).
- **Why it mattered, not hypothetically.** Measured spreads 2026-07-29: **AVAX 0.570–0.577%,
  LTC 0.586%** — *wider than the 0.5% base band*. A stop-loss sell priced at `ask × 0.995`
  therefore sat **above the bid** and could never cross. Those stops were not executable at all.
  Plausible mechanical contributor to the measured −4.25% average loss per losing leg against
  stops that should cap nearer −5%.
- **It also worked fine in the dashboard the whole time.** `autopilot.js`'s `escBand = 0.005 +
  escalationExtraPct/100` is sent straight through with no clamp. So one documented rule had two
  behaviours: live in the browser loop, dead in the cron engine. Another instance of the
  engine/dashboard divergence class that `scoreParity.test.js` was written for — worth remembering
  that the parity risk is **not confined to scoring**.
- **Fix.** `MAX_STOP_LOSS_BAND_PCT = STOP_LOSS_LIMIT_BAND_PCT + STOP_LOSS_ESCALATION_EXTRA_PCT` is
  now the clamp ceiling. `placeOrder` receives a *price*, not a cycle count, so it cannot tell a
  deliberately escalated stop from a stale one — `risk.js` stays the authority on which band
  applies, and the client enforces only the outer bound. `CONFIG_SPEC`'s
  `STOP_LOSS_ESCALATION_EXTRA_PCT` bound tightened 0.01 → 0.005 in the same change, so the absolute
  ceiling a user override can reach is 1.0% from ask (default path stays 0.8%).
- **The pre-existing test pinned the bug.** `trade.test.js`'s "stale limit is clamped" asserted the
  base-band edge, i.e. it encoded the broken behaviour as correct. Updated to the max-band edge,
  plus 5 new tests including one that asserts an escalated stop actually crosses the *measured*
  AVAX/LTC spreads — a fixture that fails if anyone re-narrows the ceiling.
- 488 tests pass (483 + 5). **Deployed but not yet observed against a real unfilled stop** — the
  next stop-loss that goes 2 cycles unfilled is the confirmation.
- **Still open from the same research pass, in priority order:** (1) the soft R:R gate **fails
  open** — `netRr()` returns `null` when `target <= entry` (`risk.js:423`) and `evaluateSymbol.js:582`
  then skips the check entirely, so the gate is bypassed precisely on the most extended setups
  (DOT was in that state at the time of the report); (2) the volume guard's unguarded numerator;
  (3) sizing stop (1.5×ATR 15m, 0.45–0.96%) vs exit stop (4H swing low, up to 6.46%) differ by
  6–9×, so the "1% risk per trade" rule is nominal; (4) no Node walk-forward evaluator.

## v2026-07-29.3 — 2026-07-29 — volume component only scores when the tape is real

Chased down the `volume: 0.00x avg (thin, -0.5)` line that appeared on nearly every symbol in the
2026-07-28 evaluate journal. **Two hypotheses were wrong before the right one; both are recorded
because each cost a probe and would otherwise be re-tried.**

- **Wrong #1: the in-progress bar leaking past `end = now − 1 bar`.** `barsEnd()` is correct.
- **Wrong #2: the price series being synthetic.** It isn't. Zero-trade bars have **0**
  consecutive-identical closes, **0** bars with `o==h==l==c`, and their closes still move
  0.15–0.19%/bar. Alpaca derives real OHLC from quotes even when its own trade tape is empty, so
  EMA/MACD/RSI/Bollinger were never affected. Five of the six score components were fine.
- **Actual cause: Alpaca's 15-min crypto tape is nearly empty for the alts.** Measured live
  2026-07-29 — share of 200 15-min bars with zero trades: BTC 2%, ETH 9%, SOL 38%, AVAX 64%,
  ADA 66%, LINK 71%, AAVE 73%, DOT 75%, DOGE 80%, **LTC 92%**. 4H is 0–16% empty and daily is 0%,
  so the regime filters and the swing-low stop source were never in question either.
- **Why that broke the signal.** `volumeRatio` is `last bar ÷ mean of previous 20`. When most of
  the window is zero the mean collapses, so the ratio degenerates into a near-binary readout of
  "did a trade land in the last bucket": in one scan, 0.000 on five symbols (→ thin, −0.5) and
  58×/80×/126× on three others (→ above average, +1). **LTC's 126× was one trade after nineteen
  empty buckets.** The clincher: **AVAX read 0.000/−0.5 in one probe and 4.385/+1 minutes later** —
  the same symbol swinging the full 1.5 points on trade arrival alone, on a 6-point score whose
  gates are 3.5 and 2.5.
- **My earlier framing of this as "a permanent −0.5" was wrong on mechanism** — it is noise, not
  bias, which is worse: a constant can be calibrated out, random can't.
- **Fix: a data-sufficiency guard, matching the house style** (`MIN_TRADED_BARS = 10`, half the
  window). Below that, `volumeRatio` returns `null` → scored n/a, worth 0, never ±. Same shape as
  the existing min-bars and `SESSION_MIN_SAMPLE` guards: when the input can't answer the question,
  decline to score it rather than emit a number that reads as signal. A genuinely empty bar in an
  *active* tape still scores −0.5 — the guard removes noise, not information.
- **Applied to both sides** per CLAUDE.md's identity rule: `src/indicators.js` and the dashboard's
  `calcVolRatio` in `src/js/ta-lib.js`. Only the *score* has to match; the label strings already
  differed legitimately ("−0.5 Low vol" vs "0.42x avg (thin, -0.5)"), so the engine's journal label
  was improved to name the cause (`n/a (only 3/20 baseline bars traded — too thin to score)`)
  without touching the dashboard's.
- **`src/scoreParity.test.js` (new) is the first test that actually enforces the dashboard↔engine
  identity rule** — it had lived only as prose in CLAUDE.md while the two files sat in different
  module systems, which is exactly the split that drifts silently. `ta-lib.js` loads standalone in
  a `vm` context (nothing touches window/document at definition time). Extended the same day to the
  **full 6-point score**: `fixture()` is the translator (`calcSignalScore` takes bar objects,
  `signalScore` takes parallel arrays), driven by a seeded PRNG so any failure is reproducible from
  the seed printed in the assertion. Covers 200 random markets across drift/volatility/tape-density,
  the data-sufficiency edges, and the -6..+6 range.

  **It immediately found a second, unrelated divergence — which is the point.** `emaArr()` yields a
  value at exactly 50 bars, so the dashboard scored ±1 on **signal 1 (15-min EMA cross) and signal 6
  (4H regime)** where the engine's `emaCrossState()` — which requires `slow + 1` = 51 — scored
  `n/a`. Up to **2 points** of disagreement on short history, on a score whose gates are 3.5/2.5.
  Not hypothetical: reachable through `fill4hFallback()`'s synthetic 4H series and newly-listed
  symbols. Fixed by moving the dashboard to the engine's threshold (`EMA_CROSS_MIN_BARS = 51`),
  because at exactly 50 bars an EMA-50 is still just its SMA seed with no exponential character yet,
  and because the engine is what trades on the cron. **Engine behaviour unchanged** — `evaluateSymbol`
  already enforced `MIN_BARS` 60, so only the dashboard/Autopilot short-history path moves.
- **Live effect — CORRECTED 2026-07-29 by the market-researcher pass; the original figure here was
  wrong.** I reported "7/10 changed: 4× +0.5, 2× −1.0" from a *single scan*. Replayed properly over
  140 evaluation points per symbol (1,400 total): average score **+0.18, positive on every symbol
  and negative on none**. SOL and AVAX — the two I said lost 1.0 — actually *rose* (+0.04, +0.14);
  the −1.0 was a single-scan artifact. Gate crossings: ≥2.5 62→67 (+8%), ≥3.5 11→6 (−45%), i.e.
  more, smaller entries. Root reason it is net-positive: on the 15-min tape signal 5 reads −0.5 on
  68–86% of bars and +1 on only 10–23%, so deleting it deletes a net negative. **Lesson: a single
  live scan is not a measurement of a scoring change.** Three consecutive strategy commits now rest
  on single scans, against a live record of PF 0.30 — write the Node walk-forward evaluator before
  the next one.
- **The guard is INCOMPLETE — two defects found by market-researcher, verified in code, unfixed.**
  (1) **The numerator is unguarded.** `volumeRatio` tests only the *baseline* window, so a dense
  baseline still scores −0.5 whenever the current bar is empty: BTC measured `0.07x (thin, −0.5)`
  and ETH `0.00x` at 19/20 baseline bars traded — the exact artifact the guard exists to remove,
  surviving on the two symbols it was meant to preserve. On the alts it is worse: guard-*passing*
  windows still have an empty current bar 67–100% of the time, so post-guard LINK and AAVE are
  **+1: 0% / −0.5: 100%** — positives removed, near-pure penalty kept. Minimum fix: also require
  `volumes[last] > 0`. (2) **The mean baseline is skew-biased on every symbol and timeframe,
  including daily** — crypto volume is right-skewed, so −0.5 fires ~3× more often than +1 even on
  BTC/ETH 4H; a **median** baseline centres it near 45/45. **Do not tune `MIN_TRADED_BARS`** — it is
  a per-symbol on/off switch, not a per-scan test (pass rates BTC/ETH 100%, SOL 78%, AVAX 11%,
  LINK 4%, LTC/DOGE 0%), and SOL at 78% is *new* instability, flipping scored↔n/a ~1 scan in 4.
  Recommended direction: **4H volume with a median baseline** (4H is 0–16% empty on all ten).
- Verified: 475 tests pass (464 + 11 new: 6 guard tests, 5 parity tests); build clean.
- **Not done:** CLAUDE.md's rule to run the **market-researcher** subagent after a strategy change.
  Flagged to the user rather than invoked, per the session instruction not to spawn agents unasked.

## v2026-07-29.2 — 2026-07-29 — daily-summary cron job deleted

User decision, taken after being offered three scopes (unschedule only / delete the feature /
disable in the DB): **delete the feature entirely.**

- **No trading impact.** daily-summary was journal-only — it placed no orders and touched no
  position state. What is actually lost is the closing daily journal block: equity + day change,
  cash, open positions with unrealized P&L, today's fills, and FIFO realized P&L for round trips
  closed that day. That block is now produced by nothing, by cron *or* by hand.
- Deleted: `src/dailySummary.js` (114 lines), `src/dailySummary.test.js` (74), the `JOBS` and
  `DEFAULT_HOUR_UTC` entries, `tenantDeps`' `appendDailySummaryBlock`, the Scheduled Jobs row in
  `tabs-command.js`, and the mentions in `command.html`/`db.js`/`.env.example`. Both
  `/api/cron/daily-summary` routes now 404 (routes are registered by iterating `JOBS`).
- **`runJobForTenant` now throws on an unknown job.** It used to end in a trailing `else` that ran
  daily-summary; with that gone the same shape would silently run the *watchdog* for any unrecognised
  job. Callers all validate against `JOBS`, so reaching it means a bug — and running a different job
  than the one asked for is worse than failing.
- **`putTraderState` became unconditional.** It was guarded by `if (job !== "daily-summary")`
  precisely because that job was journal-only and writing state back would clobber what
  evaluate/watchdog last persisted. Both remaining jobs mutate state, so the guard is now dead.
- Kept deliberately: historical `job_runs` rows (audit trail), and any stale `cron_config` row —
  inert, because the dispatcher only ever iterates `JOBS`.
- The panel's mutual "Run now" disable between Evaluate and Watchdog now covers the whole panel,
  since daily-summary was the only job that didn't touch `trader_state`.
- **Process note worth keeping.** The first route-removal check reported `POST
  /api/cron/daily-summary` → 401 instead of 404, which looked like the route surviving. It was a
  **stale `node server.js` from an earlier smoke test still holding port 3000** — the new server had
  died with `EADDRINUSE` and curl was talking to the old build. `pkill -f "node server.js"` does not
  work in this Git Bash environment; use `tasklist //FI "IMAGENAME eq node.exe"` + `taskkill //F
  //PID`. **Always confirm the server actually bound** (grep the log for "listening" or EADDRINUSE)
  before trusting a local HTTP smoke test.
- Verified: 464 tests pass (was 469: −6 dailySummary tests, +1 new asserting the removed
  `appendDailySummaryBlock` dep is gone rather than left dangling as a silent no-op seam); build
  clean; `daily-summary` 404s on both verbs while `evaluate`/`watchdog` still answer 401 for a guest.

## v2026-07-29.1 — 2026-07-29 — Multi-tenant Phase 6: dashboard UI (FINAL PHASE)

The conversion is feature-complete. **Code complete, not yet deployed.** Unlike Phase 4 this needs no
migration script and no migrate-before-deploy ordering: the one new table is a pure addition created by
`init()`'s `create table if not exists`, reshaping nothing.

- **`src/strategyConfigRoutes.js` (new)** — `GET`/`PUT`/`DELETE /api/strategy-config`, the write surface
  the Phase 3 storage layer never had. **PUT rejects on `!validateOverrides().ok` and stores `clean`,
  never the raw body.** That is deliberately stricter than the engine's own read path, which merges
  `clean` and drops bad keys so one stale value cannot stop a running engine. Both behaviours are
  wanted: silent degradation is right for a resolve that must not fail, and wrong for a save the user
  is watching — there a dropped key reads as "saved" while the engine keeps trading the old number.
  GET returns `staleErrors` from `mergeConfig` for the same reason: a saved value that a
  later-tightened bound has since disabled must be visible, not silently displayed as if in force.
- **Body-size bound before validation.** `MAX_KEYS = 200` is checked before `validateOverrides`,
  because `express.json`'s 2mb limit would otherwise let a body of junk keys become a 2mb array of
  per-key error strings in the response.
- **Step-up auth, destructive actions only.** `stepUpRequired(action, {isActive})` in
  `credentialsRoutes.js` is the entire policy as one pure, tested predicate: **delete** always;
  **replace** only when overwriting the credential the engine is trading with right now;
  **connect**/**activate** never. `auth.js` gained an exported
  `verifyStepUpPassword(uid, password, {getAccount})` — `hashPassword`/`verifyPassword` stay
  module-private, so routes re-authenticate through one path instead of each reaching for the raw
  hash. It returns false and never throws for *every* failure mode (guest, no password, unknown
  account, malformed stored hash, database error): a step-up check that errors open is worse than one
  that denies.
- **The limit of step-up, stated because it is easy to misread as a hole.** It protects against
  *losing* access, not against a session holder *adding* their own key — an attacker with the session
  can connect and activate their own credential without a password, exactly as a legitimate new user
  does. Closing that would put a password wall on the one step every user must clear, protecting
  nothing. Failed attempts do spend a write-limit token, so the 20/hour/uid budget doubles as the
  password-guessing ceiling on these routes.
- **`trader_credential_audit` (new table)** — deferred from Phase 2, added now that these rows decide
  which Alpaca account trades. Append-only `(uid, action, mode, detail, at)`; **no FK to `accounts`**
  (evidence that vanishes with the account it documents is not evidence — same reasoning as
  `job_runs`) and no key material, `detail` being a short server-authored phrase.
  `appendCredentialAudit` never throws: the mutation it records has already committed, so rejecting
  there would report a failure that did not happen and could push a user into re-submitting their key.
  `credentialsRoutes.js` still logs its own line per mutation, so a trail write failure still leaves a
  platform-log trace.
- **`listCredentialAudit` joins `accounts` and filters `at >= accounts.created_at`.** Found during the
  security pass: `accounts.id` IS the normalized username (`auth.js`'s register), and this table has
  no cascade by design — so a username deleted and re-registered would show the new owner credential
  changes they never made, which reads exactly like a compromise. The rows stay for forensics; they
  are just no longer attributed to the new account.
- **Two more security-pass fixes in `src/js/settings-engine.js`.** (1) It does **not** use utils.js's
  `escapeHtml`, which escapes only `& < >` — this file interpolates into attribute values as well as
  text, where an unescaped quote breaks out. It carries its own attribute-safe escaper. (2) The
  per-credential buttons use `data-engine-action` + delegation instead of an inline `onclick` built by
  concatenation; an interpolated `onclick` is HTML-decoded *before* it is parsed as JS, so escaping
  alone never makes that pattern safe. Neither was exploitable today (the only interpolated value is
  `mode`, constrained to `paper`/`live` by a CHECK constraint) — both are the latent kind that becomes
  real the moment someone adds a field.
- **`withStepUp` re-prompts without restarting.** The first draft recursed into the whole flow on a
  wrong password, which re-issued a password-less attempt and spent two rate-limit tokens per retry —
  halving the guessing budget that is supposed to be the ceiling.
- **UI is a deliberately separate panel.** `.engine-panel` (blue accent rail + tint) in
  `client/src/tabs/settings.html`, below the existing Alpaca fields. Those are browser-only
  `localStorage`; these go to the server and trade unattended. Badge states are *in use* / *stored* /
  *unreadable here* — the third is `readableHere:false`, a row encrypted under another environment's
  key, which the engine skips; rendering that as "connected" would be a lie the Scheduled Jobs panel
  would then contradict. Step-up prompts inline and masked (`#engineStepUpEl`), not via
  `window.prompt()`.
- Wiring: new classic-global `src/js/settings-engine.js` in `scriptLoader.js`'s `SCRIPT_ORDER` after
  `auth.js`; `nav.js`'s `switchTab("settings")` also calls `loadEngineSettings()` (guarded — it loads
  later in SCRIPT_ORDER than nav.js, so a `#settings` deep link can fire before it exists). New CSS in
  `forms-modals-footer.css`, including the `.warn-banner` class Phase 5 had already referenced in
  `tabs-command.js` without ever defining.
- **Verified:** 469 tests pass (438 baseline + 31 new in `strategyConfigRoutes.test.js` /
  `stepUp.test.js`); `npm run build` clean; i18n 594 keys × 4 locales in parity with all 47 markup +
  24 script refs resolving. **Not verified — no browser tool this session:** an actual click-through
  of connect / activate / disconnect / save-overrides. **Also worth checking on first deploy:** the
  disconnect flow sends its password in a `DELETE` body; Express parses it, but a proxy that strips
  DELETE bodies would make disconnect impossible (fails closed, but as a confusing "password
  incorrect").

## v2026-07-28.2 — 2026-07-28 — Multi-tenant Phase 5: per-user cron dispatcher

The phase that actually turns the seams on. **Code complete, NOT deployed** — see the blocker below.

- **`src/tenantEngine.js` (new)** is the single place that answers "which account are we trading".
  `buildTenantContext(uid)` resolves the active credential, resolves that user's config, and builds a
  per-user `createAlpacaClient` **from that resolved cfg** (the client bakes in two order-band hard
  rules, so building it from `DEFAULT_CFG` would silently widen a user's tightened bands back out).
  `tenantDeps()` returns the runner dep bundle.
- **`tenantDeps` injects every call individually, not just `client`.** `stopWatchdog.js` and
  `dailySummary.js` do not read `deps.client` — they take individual functions whose defaults are
  env-var bound. Passing only a client would leave those two runners trading the legacy account while
  the dispatcher looked correct. `getCryptoBars4h` is bound explicitly rather than spread, because its
  options are the *third* positional argument: `(...a, {client})` would land the options object in
  `limit` whenever a caller passed only a symbol, silently reverting to the default client.
- **A tenant with no/unreadable credential is skipped with a reason, never run on the env-var
  account** — the one failure mode that looks healthy while placing one user's orders on someone
  else's Alpaca account. `KeyMismatch` is reported separately from a plain decrypt failure (it is a
  subclass, so the check order matters). An *unexpected* error propagates instead of degrading to a
  skip: a database outage reported as "this user has no credential" would read as a deliberate opt-out
  and hide an engine-wide failure.
- **`db.getActiveTenantsForJob(job)`** defines tenancy as "has an active credential", LEFT JOINed to
  `cron_config` with `coalesce(enabled, true)` so a user who never opened the schedule UI still runs.
  Plus `getLastRunAtByUid(job)` — one query instead of one per tenant inside the loop.
- **`TRADER_OWNER_UID` deleted entirely** (user decision, 2026-07-28; the plan had recommended keeping
  it as an admin override). `requireSelf` scopes manual trigger / status / config to the caller's own
  rows, with the uid taken only from the session cookie.
- **`/api/trader-state` is now session-scoped.** It was unauthenticated, which was defensible with one
  shared engine; the row now holds one tenant's open positions and entry prices, so serving it to
  anyone would be cross-account disclosure. Guests get the committed-file fallback.
- **Security review (inline) found two things worth fixing before merge:** manual trigger and config
  routes were owner-only and therefore unrated; now that any signed-in account can reach them and
  registration is open suite-wide, they gained per-uid rate limits (30/60 per hour) — each request
  costs a credential decrypt, a config resolve and a burst of Alpaca calls, and the concurrency lock
  caps concurrent runs but not serial hammering. And `requireSelf` now rejects a falsy uid as well as
  the `GUEST` sentinel, so a future `currentUid` returning null can't fall through into a db accessor.
- Dashboard: `/api/cron/status` returns `connected`, and the Scheduled Jobs panel shows a banner when
  the account has no active credential — otherwise an enabled-looking toggle implies a schedule that
  the dispatcher will never visit.

**Verified:** `npm test` 438/438 (12 new), `npm run build` clean, full server import smoke test.

**Unblocked and pushed 2026-07-28 ~21:00 UTC.** `ekuipers`/paper is stored and active (`key_fp`
81203168, `key_preview` H4Z4 matching the `.env` key, 224-char envelope), and
`getActiveTenantsForJob` returns that one tenant for all three jobs. Connecting it took four attempts
and each failure taught something worth keeping:

1. **`configured: false` on Production** — the Vercel **shared** environment variables existed but had
   never been *connected to the project*, so `TRADER_CREDENTIALS_ENC_KEY` was absent at runtime and
   every write 503'd. The docs had recorded this ops step as done and verified on 2026-07-27, which
   made an empty table look like "never got round to it" instead of "cannot store at all".
2. **Those 503s spent the write budget.** `requireUid` records the rate-limit hit *before* the
   handler runs, so ~20 failed attempts produced a 429 — the misconfiguration locked the endpoint
   while it was being diagnosed. Fixed: the 503 is now answered before a token is charged, for the
   one route that needs the key. Validation 400s still count, deliberately.
3. **A 400 on `keyId`** came from pasting a documentation placeholder containing a literal `…`, which
   is not in `[A-Za-z0-9_-]`. Worth writing snippets with `prompt()` instead of inline placeholders —
   it also keeps the secret out of console history.
4. **Verify writes against the database, not the response.** Two pasted "successes" were the example
   echoed back; only a direct query settled it. The discriminator for "did Production write somewhere
   else?" was `/api/cron/status` — matching millisecond timestamps proved one shared database.

## v2026-07-28.1 — 2026-07-28 — Phase 4 applied; two findings from doing it

Migration applied to the shared database (`--confirm`) and the code pushed to `main`. Backfill
attributed 5 `trader_journal`, 31 `job_runs` and 1 `cron_config` row to `ekuipers`; `trader_state`'s
legacy `id='trader'` row was copied, and both rows carry the same `updated_at`, so the engine reads
the same state it had before. Sequenced migration-first on purpose: the reverse order deploys new code
onto the old schema, where `getTraderState('ekuipers')` finds no row and returns `EMPTY_STATE()` while
`isCronJobEnabled` defaults to enabled — evaluate would have run on empty state and could place orders
blind, with `CRON_EXECUTE` true in production. Migration-first fails safe instead: old code errors at
`startJobRun`'s `ON CONFLICT` before reaching order placement.

Two things only doing it surfaced:

1. **The old build's `init()` resurrects the dropped lock index.** During the deploy window a cold
   start of the previously deployed code ran `create unique index if not exists job_runs_running_uidx`
   against the already-migrated table, restoring the `(job)`-only lock alongside the new `(uid, job)`
   one — the exact contention bug Phase 4 exists to remove. The migration's `job_runs` branch is
   skipped on a re-run (it keys on `uid` being NOT NULL), so it would not have cleaned this up.
   Fixed: the legacy-index drop now lives **outside** that branch, so every run sweeps it. **Standing
   rule: re-run `node scripts/migratePhase4.mjs --confirm` once the new build is serving**, and check
   `pg_indexes` for `job_runs_running_uidx` — it must be absent.
2. **`node:test` treats `{ skip: null }` as "skip".** The Phase 4 integration tests were passing the
   option unconditionally, so the whole suite had been silently skipped since it was written — the
   earlier "420/420" never executed them. The suite reported `# SKIP` while listing its tests as
   cancelled, which is what gave it away. Fixed by omitting the options object entirely when not
   skipping. **Any suite gated this way needs the same treatment** — pass no options rather than a
   null `skip`.

**Verified after both fixes:** `npm test` 426/426 with the integration half genuinely running against
the migrated schema, including the test that user B's `startJobRun` is not blocked by user A's.

**Closed out same day:** user confirmed the production deploy clean and working. Post-deploy sweep
re-run performed — nothing had come back, so the single resurrection was a one-off from the
old-build cold start during the deploy window. `job_runs` now carries only `job_runs_pkey` and the two
uid-scoped indexes; `npm test` 426/426 against the live schema.

**End-to-end verified 2026-07-28 20:02 UTC.** All three jobs triggered from the dashboard ran `ok`
on the new code, every row under `uid=ekuipers`. What the timestamps prove, beyond "it ran":

- `trader_state.ekuipers` updated 20:02:37 while the legacy `trader` row stayed at 04:00:57 — new
  code writes only the uid row, and the copy-not-move rollback point is genuinely still intact.
- `trader_journal` for 2026-07-28 grew 8.3k → 19,026 chars — the `on conflict (uid, day)` append
  path works against the composite key.
- `cron_config` upserted from the Scheduled Jobs panel via `on conflict (uid, job)`: `evaluate`
  hour 0, `watchdog` hour 3, both `updated_by_uid = ekuipers`.
- `startJobRun`'s `on conflict (uid, job) where status='running'` issued three lock acquisitions and
  releases with no 23505 and no error rows.

Caveat on scope: these were **manual** triggers, so `executeJob` → runner → persistence is proven,
while the *dispatcher's* own path (`handleDispatch` → `getLatestJobRuns(uid)` → `getCronJobConfig` →
`isJobDue`) is covered only by unit tests plus the hourly no-op ticks. It won't fire for real until
tomorrow at each job's hour, because `isJobDue` also requires "hasn't run today" and these manual
runs satisfy that for today.

`daily-summary` still has no `cron_config` row and runs on the compiled `DEFAULT_HOUR_UTC` 6.

## v2026-07-27.5 — 2026-07-27 — Multi-tenant Phase 4: uid-keyed engine tables

Schema + code for the multi-tenant conversion's Phase 4. The four engine tables are now keyed by
uid. **The migration has been written and dry-run but NOT applied** — see "Pending" below.

- `src/db.js`: `trader_state.id` now holds the owning uid (the `default 'trader'` is dropped, since a
  default would silently collect every uid-less write into one row); `trader_journal` pk `(day)` →
  `(uid, day)`; `job_runs` gains `uid` with the lock index `(job)` → `(uid, job)`; `cron_config` pk
  `(job)` → `(uid, job)`. **No foreign key to `accounts`** on any of them — the legacy engine uid is a
  sentinel rather than an account, and `job_runs` is an audit trail that should outlive an account
  deletion instead of cascading with it.
- Every accessor takes the uid first and **throws `TypeError` when it is missing** rather than
  defaulting. A silent default is the failure mode worth designing out: it would read or overwrite
  another tenant's positions. New `db.LEGACY_ENGINE_UID` (`'trader'`) names the old sentinel.
- `job_runs`' lock is the one genuine correctness fix here, not just isolation: on the old
  `(job)`-only partial unique index two users' evaluate runs contend for a single lock and block each
  other. `startJobRun`'s 15-minute abandoned-row release is now uid-scoped too, so one tenant's stuck
  run can't be released by another's request.
- `src/cronRoutes.js`: `executeJob(job, triggeredBy, uid)` and the three runners take a uid, so
  Phase 5's per-user loop only has to change the callers. A new `ENGINE_UID` (= `OWNER_UID`) threads
  the single engine through. **Fails closed when `TRADER_OWNER_UID` is unset** (503) instead of
  falling back to the legacy sentinel: that uid has no state, which presents as "no open positions" —
  evaluate would re-enter blind and the watchdog would manage nothing, silently, on a live paper
  account.
- `scripts/migratePhase4.mjs` — one-shot, transactional, idempotent (catalog-checked, so a re-run
  reports "already migrated"), dry-run by default. Refuses to run unless the target uid exists in
  `accounts`. `trader_state`'s legacy row is **copied, not moved**, so `id='trader'` survives as a
  free rollback point. Deliberately not in `init()`: init() boots in every environment against one
  shared database, and attributing existing rows to a uid is a once-only human decision.
- `scripts/backupPhase4Tables.mjs` — JSON snapshot of the four tables (pg_dump isn't on PATH here;
  at ~34 rows a JSON dump is a complete backup). Output goes to `backups/`, now gitignored.
- `db.init()` gained `checkPhase4Migrated()`, which warns at boot if a database still has the old
  primary keys — otherwise the first journal/job/config write fails with an opaque `ON CONFLICT`
  error naming no cause.

**Verified:** `npm test` 420/420 (10 new argument-guard tests). `src/dbMultitenant.test.js` also adds
integration tests — state/journal/cron-config isolation between two synthetic uids and, most
importantly, that user B's `startJobRun` is *not* blocked by user A's running job. They skip with an
explicit reason until the migration runs, since an unmigrated database is a legitimate transient
state rather than a code failure. Migration dry run against the real database is clean: 1
`trader_state`, 4 `trader_journal`, 28 `job_runs`, 1 `cron_config` row, all attributing to `ekuipers`.

**Pending (not done):** the migration has not been applied and the code has not been deployed. Run
order matters — backup, `node scripts/migratePhase4.mjs --confirm`, then deploy immediately. Between
those last two the *old* deployed code runs against the *new* schema and its `ON CONFLICT (day)` /
`(job)` clauses error, so jobs fail (loudly, before placing any order) until the deploy lands. Keep
the window short and off the watchdog's scheduled hour.

## v2026-07-27.3 — 2026-07-27 — Credential key fingerprint (cross-environment diagnosis)

Follow-up to Phase 2's ops guidance. Production/Preview/Development are to hold **different**
`TRADER_CREDENTIALS_ENC_KEY` values but share **one** Supabase database, so the isolation boundary is
the `(uid, mode)` row, not the environment. `putAlpacaCredential` upserts on that key, so writing the
same row from two environments replaces the ciphertext and the other environment's next read failed
as a generic `DecryptFailed` — which Phase 5 treats as "credential disconnected", silently stopping a
user's engine with no indication of why. `vercel dev` runs against the production database, so this
was a live hazard, not a theoretical one.

- `src/secretsCrypto.js`: `keyFingerprint()` (first 4 bytes of SHA-256 over the key, hex — non-secret,
  safe to store and log) and a new `KeyMismatch` error. `decryptSecret(b64, aad, expectedFp)` checks
  the fingerprint before attempting decryption. **`KeyMismatch extends DecryptFailed`** so every
  existing caller keeps refusing to trade — only the diagnosis changes, not the behaviour.
- `src/db.js`: new nullable `key_fp` column (`alter table ... add column if not exists`; nullable on
  purpose — a row without a fingerprint skips the check rather than reading as broken). Written by
  `putAlpacaCredential`, checked by `getActiveAlpacaCredential`. `listAlpacaCredentials` gained a
  `readableHere` boolean for the Phase 6 UI; it returns the verdict, never the fingerprint, and
  reports `true` whenever it cannot prove otherwise (no stored fp, or no key configured here).
- `src/credentialsRoutes.js`: `KeyMismatch` maps to 409 with a message naming the real cause. Ordered
  before the `DecryptFailed` arm, since it is a subclass.

**Verified:** `npm test` 410/410 (9 new). Plus 18 end-to-end checks against the real database
(`debug/keyfp_e2e.mjs`, gitignored) simulating the actual scenario — write under a "production" key,
read under a "dev" key, then the clobber case where dev overwrites the row and production reads it.
Confirms `KeyMismatch` is raised, is still a `DecryptFailed`, names both fingerprints, leaks no key
material or secret, and that legacy null-`key_fp` rows behave exactly as before. Rows cleaned up.

**Not a security control** — an attacker who can rewrite `ciphertext` can rewrite `key_fp` too. Its
only job is turning a silent failure into a legible one.


## v2026-07-27.2 — 2026-07-27 — Multi-tenant Phase 3: per-user strategy/risk config

Suite roadmap item 1 (multi-tenant). Resolution layer + engine plumbing only — nothing writes a
config row yet (the route ships with Phase 6's UI), so this has zero behavior change.

- `src/userConfig.js` (new): `DEFAULT_CFG` (the compiled `config.json` values flattened, same
  UPPER_SNAKE key names so each conversion is a mechanical `X` → `cfg.X` rename), `CONFIG_SPEC`
  (per-key type/bounds/locked), `validateOverrides`, `mergeConfig`, `resolveConfigForUser(uid)`.
  Bounds are where CLAUDE.md's hard rules are enforced against stored JSON: 0.2% limit band, 0.5%
  stop band, ≤30% symbol cap, ≤2% risk/trade, 7 total / 5 per-tier budget, ≤8% swing-low stop.
  Shorts, the streak throttle, and every unported ships-OFF flag are **locked** — not settable at
  all, so `assertNotShipped()` can keep checking the compiled config only.
- `src/db.js`: new `trader_strategy_config(uid pk, data jsonb, updated_at)` + `getStrategyConfig`/
  `putStrategyConfig`/`deleteStrategyConfig`. Stores only the keys a user changed; the resolver
  re-validates on every read, so a row written before a bound was tightened degrades that one key
  to its default instead of failing the resolve and stopping the engine.
- `src/risk.js`: added trailing override params to the 8 pure functions that read module constants
  directly (`checkLimitBand`, `shouldStopOut`, `shouldCoverShort`, `stopLossPrice`,
  `shortStopPrice`, `effectiveStopPct`, `tierCount`, `correlationBudgetAllows`). The plan doc had
  claimed these already accepted overrides; they did not.
- Converted to take `cfg` (defaulting to `DEFAULT_CFG`) through their existing `deps`/options
  parameter: `evaluateSymbol.js`, `runEvaluation.js`, `rotation.js`, `entrySizing.js`,
  `stopWatchdog.js`, `reconcile.js`, `journal.js`, `alpacaClient.js` — 179 constant reads in all.
- **Latent multi-tenant bug fixed:** `reconcile.js`'s session-penalty cache was an unkeyed
  module-level singleton. Phase 5 loops every user inside one serverless invocation, so user B
  would have inherited the buckets computed from user A's fills. Now keyed by `cacheKey`.
  Same pass: `sevenDayDrawdown()` in `runEvaluation.js` was not passed `client`, so one user's
  drawdown would have driven another's streak throttle.

**Self-review findings, fixed before commit:** numeric validation used `Number(value)`, so a quoted
`"4.0"` (and `true` → 1) coerced through — now a strict `typeof` check, since a typo in a JSON
editor silently trading a coerced value is the exact failure this spec exists to prevent. Cross-field
conflicts were reported but still applied, because `mergeConfig` deliberately applies `clean`
regardless of `ok`; conflicting pairs are now dropped from `clean`. `CONFIG_SPEC[key]` resolved
inherited members, so `__proto__`/`constructor` bypassed the unknown-key error — now `Object.hasOwn`,
and `cfgSymbolCap` likewise. Note: **no agent-based security-reviewer pass was run this session**
(agent use is disabled in this session's config) — worth running before Phase 6 exposes a write route.

**Verified:** `npm test` 401/401 (42 new, baseline 359 unchanged). Plus 15 end-to-end checks against
the real Supabase database (`debug/phase3_e2e.mjs`, gitignored): jsonb round-trip, merge-over-default,
upsert-replaces, cascade delete, and — importantly — that an out-of-bound or locked value written
*directly into the table* still never reaches the resolved cfg. Test rows cleaned up, table left empty.

**Not in this phase:** no HTTP route writes a config row yet. `putStrategyConfig` is storage-only and
does no validation by design; the Phase 6 editor route must call `validateOverrides` before writing.


## v2026-07-27.1 — 2026-07-27 — Multi-tenant Phase 2: encrypted per-user Alpaca credentials

Suite roadmap item 1 (multi-tenant). Storage + management only — the cron dispatcher still uses the
shared env-var account until Phase 5, so this ships with zero behavior change.

- `src/secretsCrypto.js` (new): AES-256-GCM envelope (`iv[12] || tag[16] || ciphertext`), key from
  `TRADER_CREDENTIALS_ENC_KEY` read lazily per call. Bound to its row via GCM AAD
  (`credentialAad(uid, mode)`) so a ciphertext copied into another user's row fails to decrypt.
- `src/db.js`: new `trader_alpaca_credentials` table (PK `(uid, mode)`, partial unique index
  `(uid) where active`), `tx()` transaction helper, and the credential accessors. `baseUrl` is
  re-derived from the `mode` column on read, never trusted from the decrypted blob — it is what
  `assertPaperTrading()` keys on.
- `src/credentialsRoutes.js` (new): `GET/POST/DELETE /api/alpaca-credentials/:mode` + `/activate`.
  Write-only — no route can return a stored key, secret or ciphertext. Scoped to the session uid
  only. Rate-limited per uid via the new shared `src/rateLimit.js` (extracted from `auth.js`).
- `src/alpacaClient.js`: `ALPACA_HOSTS` constant so the paper host literal exists once.
- `server.js`: routes wired, JSON-parse errors return a fixed 400 (the parser's message can embed a
  fragment of the submitted secret), boot warns when the encryption key is missing.

**Security review (mandatory for this phase):** no CRITICAL findings. Fixed before merge — missing
rate limiting (HIGH), ciphertext relocation via missing AAD, `baseUrl` round-tripping through the
blob, a `setActiveAlpacaMode` race that could leave zero active credentials while reporting success,
unique-violation surfacing as a 500, poisoned pooled connection on rollback failure. Deferred with
reasons: step-up password on credential write/delete (a Phase 6 UI decision), audit-trail table.

**Verified:** `npm test` 359/359 (36 new). Plus 24 end-to-end checks against the real Supabase
database (`debug/verify-phase2.mjs`, gitignored): no plaintext in the stored row, metadata never
leaks the ciphertext, exactly-one-active holds, cross-user ciphertext relocation rejected, wrong key
throws, account delete cascades. Test rows cleaned up; the table is left empty.


## v2026-07-26.1 — 2026-07-26 — Live Alpaca mode is read-only (Suite roadmap)

Suite roadmap: live trading must be insights-only; only paper mode may place orders or manage a
portfolio (EU MiCA, Suite workflow rule 30).

- Node engine: `alpacaClient.js` gained `isPaperTradingUrl()` + `assertPaperTrading()` guarding
  `placeOrder`/`cancelOrder`/`cancelAllOrders`; reads stay open. Fails closed on an unknown base URL;
  `trade.js`'s `BASE_URL` now defaults to the paper host when `APCA_BASE_URL` is unset. 6 new tests
  (316 pass).
- Dashboard: same gate in `api-config.js` (`apiPost` + new `apiDelete`, which Autopilot's two raw
  DELETE cancels now use). Header shows a 🔒 read-only badge while Live is selected.
- Copy: mode selector, trade modal, Autopilot messages, manual and Terms modal reworded from "live
  trading risk" to "live is read-only", in all 4 languages.


## v2026-07-24.14 — 2026-07-24 ~18:20 UTC — Glossary scope correction: Acronyms + Trading Terms only

**Task:** user correction on the `.13` entry below: "I meant only the Acronyms and Trading terms from the
glossary. Please correct in the database." The initial implementation synced the entire `memory/glossary.md`
(~700 lines, ~30 dated implementation-changelog sections) into the DB — too broad. The user's actual intent was
the two stable reference sections that already exist as distinct `## ` headings in the file: "Acronyms &
Abbreviations" and "Trading Terms" — not the dated feature/bug-history sections around them.

**Fix:** new `src/glossaryExtract.js` (`extractGlossarySections(md, headings)`) locates level-2 headings by
title and slices out just the matched sections (trimming trailing blank lines / `---` separators), defaulting
to `["Acronyms & Abbreviations", "Trading Terms"]`. 5 unit tests (`src/glossaryExtract.test.js`): correct
sections pulled in file order, dated/other sections excluded, trailing-separator trimming, empty-input and
no-match edge cases, and a section running to end-of-file with no trailing heading. `server.js`'s startup sync
and `glossaryRoutes.js`'s file-read fallback (used when the DB is unset) both now pipe the raw file through the
extractor before storing/serving — `memory/glossary.md` itself is completely untouched, still the full
git-tracked source, workflow rule 2 still applies to it unchanged. Only the DB row (and what
`GET /api/glossary` serves) narrowed.

**Verified:** `npm test` 310/310 passing (305 prior + 5 new). Standalone extraction against the real file
confirmed exactly the two sections (22,709 chars) with no dated-changelog text leaking in. Re-booted
`node server.js` locally against real Postgres credentials and re-curled `/api/glossary`: confirmed the DB row
now holds exactly that same 22,709-char content, starting `## Acronyms & Abbreviations`, containing
`## Trading Terms`, containing zero occurrences of "Roadmap rescan" (the dated-section marker) — the reseed
took effect cleanly (`putGlossary`'s `is distinct from` guard fired a real write since content changed from the
full-file version).

**Docs:** `CLAUDE.md` (correction note appended under item 4, not rewritten — preserves the original
implementation's own verification trail), `README.md`, `docs/dashboard_layout.md`, and this file updated.
`memory/glossary.md` was not touched — the correction only affects what's extracted from it downstream.

---

## v2026-07-24.13 — 2026-07-24 ~18:10 UTC — Roadmap rescan: Suite item 1 — glossary moved from file to database

**Task:** "rescan suite roadmap." Suite `CLAUDE.md`'s uncommitted hand-draft (flagged read-only in the `.12` entry
above) had roadmap item 1 as "Add glossary to the database instead of loading it from a file." Item 2 (multi-tenant)
is already mid-flight with its own dedicated-session plan (Suite workflow rule 26); item 9 (Trader GH-workflow
removal) is time-gated on the 2026-07-25 ~02:00–06:00 UTC confirmation window. Item 1 was the actionable one this
session.

**Scope check:** a research pass confirmed only Trader has a *file*-backed glossary (`memory/glossary.md`, fetched
by `src/js/tabs-glossary.js`). Charts has no glossary feature. Training has its own, wholly independent glossary —
a hardcoded `GLOSSARY` JS array in `src/js/course.js` — which doesn't match "loading it from a file" and is a
different feature with different content; left untouched, out of scope for this item.

**Implementation:** new Postgres `glossary` table (`src/db.js`, single-row shape identical to `trader_state`) +
`getGlossary()`/`putGlossary()`. New `src/glossaryRoutes.js` → `GET /api/glossary`, DB first, falls back to reading
`memory/glossary.md` off local disk (dev without a DB configured), then 404 (client's own hardcoded snapshot is the
last resort). `memory/glossary.md` stays the git-tracked, human/AI-edited source — workflow rule 2 still applies to
it unchanged — `server.js` now upserts its content into the DB row once on every boot (`putGlossary`'s `is distinct
from` guard makes repeat boots a no-op write). `src/js/tabs-glossary.js`'s `loadGlossary()` now calls
`fetchLocalJson(["/api/glossary"])` instead of the removed `fetchLocalText()` helper (deleted from `api-config.js`
as dead code — nothing else used it); rendering logic (`renderGlossaryMarkdown`, search/filter) is unchanged since
the content shape is identical, just the transport moved.

**Bonus bug found and fixed:** `server.js` never statically served `memory/` (only `/js`, `/css`, `client/dist`,
`docs`), so in production the Glossary tab's `fetch()` of the file could never have succeeded at all — it had been
silently stuck on the small ~14-term hardcoded `GLOSSARY_FALLBACK_MD` constant this entire time, not just under
`file://` as the original 2026-07-18 bugfix assumed. `/api/glossary` is reachable in production, closing this gap
as a side effect.

**Verified:** `npm test` 305/305 passing, no regressions. `node --check` on all 5 touched/new files. Local
`node server.js` boot against the real `.env` Postgres credentials logged `[db] connected; tables ready` with no
sync errors; `curl localhost:3000/api/glossary` returned the live ~700-line content (confirmed *not* the fallback
snapshot — real end-to-end proof the DB round-trip works). `curl /api/health` still 200. **Not verified — no
browser tool this session:** an actual click-through of the Glossary sub-tab, search box, and ↻ Refresh in a
running browser.

**Docs:** `CLAUDE.md` (new roadmap item 4), `README.md`, `docs/dashboard_layout.md`, and this file all updated;
`memory/glossary.md` itself gained a dated entry documenting this change (consistent with its own established
pattern of logging dated feature notes). Suite `CLAUDE.md`'s roadmap item 1 marked done and moved to Suite's own
`memory/memory.md` per Suite workflow rule 15 — see Suite's own memory for that side.

---

## v2026-07-24.11 — 2026-07-24 — Add progress indicator to Scheduled Jobs "Run now"

**Problem:** user reported clicking "Run now" gave no visible feedback — because it doesn't: the POST doesn't
resolve until the job fully finishes (`evaluate` takes ~20s for its real Alpaca round-trip), and the panel only
learns "running" from the server on its next `/api/cron/status` poll, so the button just sat there disabled
(from the previous race-condition fix) with nothing else changing.

**Fix (`src/js/tabs-command.js`):** `cronRunNow()` now records the click in a local `_cronLocalRunning` map
*before* the request goes out and starts a 1s ticker (`_cronTicker`) that re-renders while it's outstanding.
`renderCronJobs()` treats local state the same as a server-confirmed `status:'running'` row, shows the existing
`.spinner` CSS class (already used elsewhere in the dashboard, reused rather than adding a new one) plus a live
"running… (Ns)" elapsed-time label, and folds the Evaluate/Watchdog mutual-disable logic into the same
`thisRunning`/`stateJobRunning` computation so both concerns share one code path instead of two separate ones.
Full test suite still 380 pass / 0 fail (no backend touched).

---

## v2026-07-24.10 — 2026-07-24 17:45 UTC — Fix: race condition let overlapping "Run now" clicks lose trader_state writes

**Context:** user fixed the Vercel Alpaca env vars from v2026-07-24.9 and confirmed all 3 cron jobs now run
`status='ok'`. Re-verified via `job_runs` + a direct Postgres read of `trader_state`.

**New problem found during that verification:** `trader_state` still held the stale 08:56 UTC snapshot (3
phantom positions, old `last_evaluation_iso`) even though the row's `updated_at` showed a fresh write at
`17:33:38.546Z` — a write happened, but with the wrong (old) content.

**Root cause:** `db.putTraderState()` (`src/db.js`) is a blind full-blob overwrite with no locking. `evaluate`
and `watchdog` each do their own independent load→mutate→save cycle over that same blob. The user's manual
"Run now" clicks overlapped: `watchdog` started (17:33:38.339) before `evaluate` (started 17:33:19.226, ~19s of
real Alpaca calls) had written back (17:33:38.649) — so watchdog's stale read-then-write silently clobbered
whichever write landed in between. The automatic hourly dispatcher isn't affected (`handleDispatch` awaits jobs
strictly in sequence) — only concurrent manual triggers can hit this, and the dashboard didn't stop that.

**Fix:** `src/js/tabs-command.js` — `CRON_JOBS` entries for `evaluate`/`watchdog` now carry `touchesState:
true`; `renderCronJobs()` disables both jobs' "Run now" buttons whenever either shows `status:'running'`, and
`cronRunNow()` also disables them optimistically the instant a state-touching job is clicked (closes the gap
before the next status poll). `daily-summary` stays independently clickable (journal-only, never touches
`trader_state`). Considered a backend Postgres advisory lock instead, but the pooler connection
(`pooler.supabase.com:6543`, PgBouncer transaction mode) doesn't reliably support session-scoped advisory locks
across separate queries, and holding a `SELECT ... FOR UPDATE` transaction open across evaluate's ~20s external
API calls would tie up one of only 5 pooled connections for that whole duration — judged worse than the
frontend guard for this specific trigger (manual button clicks, not the dispatcher). Full test suite: 380 pass,
0 fail (also the first run with real Alpaca creds available locally — the previously-known 8 env-dependent
failures are gone as a side effect, not related to this fix).

**Still open:** the already-corrupted `trader_state` row itself isn't repaired by this fix — needs one clean,
solo `evaluate` run (dashboard, post-redeploy) to prune the phantom positions and refresh `last_evaluation_iso`.

---

## v2026-07-24.9 — 2026-07-24 17:30 UTC — Bug found: all 3 cron jobs failing in production since ~17:22 UTC (Alpaca env vars)

**Problem:** user reported the Scheduled Jobs panel now shows jobs (TRADER_OWNER_UID fix confirmed live), but
running them fails: `FAIL: daily summary: TypeError: Invalid URL` (seen in Vercel logs).

**Investigation:** used the real `CRON_SECRET` now in `.env` to hit `/api/cron/{evaluate,watchdog,daily-summary}`
directly — all three return `{"ok":false,"code":1}`. Queried `job_runs` directly via Postgres (same pooler
credentials): the 08:56 UTC cron-triggered runs of all 3 jobs succeeded (`status='ok'`); **every** run since
17:22 UTC — both dashboard "Run now" clicks and the hourly hands-off `cron` dispatch — fails. Git history for
`alpacaClient.js`/`trade.js`/`cronRoutes.js`/`env.js` shows no commits in that window, ruling out a code
regression. `dailySummary.js`'s `main()` does `console.error("FAIL: daily summary: " + e)` around
`getAccount()`/`getPositions()` (from `trade.js`'s `defaultClient`, which reads `APCA_API_KEY_ID`/
`APCA_API_SECRET_KEY`/`APCA_BASE_URL` off `process.env`) — a `TypeError: Invalid URL` there is the exact
signature of `APCA_BASE_URL` being `undefined` (`new URL(undefined + "/v2/account")`). Evaluate/watchdog share
the same client, so they're almost certainly failing for the identical reason (both also `error` since 17:22).

**Working theory:** the redeploy that picked up the new `TRADER_OWNER_UID` var (previous entry) is also the
first deploy where the Alpaca env vars aren't reaching the Production runtime — timing lines up exactly.
Cannot confirm from this sandbox (no Vercel dashboard access) whether they were dropped, mis-scoped to a
non-Production environment, or something else.

**Action needed (user, Vercel dashboard):** verify `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`/`APCA_BASE_URL` are
set on the *Production* environment specifically, then redeploy.

**Caution flagged:** `CRON_EXECUTE=true` is live in production — once Alpaca connectivity is restored, the next
successful `evaluate`/`watchdog` run places real (paper) orders if conditions are met. Avoided further
diagnostic triggers of those two from this sandbox for that reason; `daily-summary` is safe to re-test (no
orders, no position-state writes, per its own docstring).

**Side effect noted:** Postgres `trader_state` has been stuck at the 08:56 UTC snapshot (3 phantom positions,
see v2026-07-24.7) and can't self-correct until a cron cycle completes successfully.

---

## v2026-07-24.8 — 2026-07-24 — Fix: Scheduled Jobs panel showed no schedules/no "Run now" button (TRADER_OWNER_UID unset)

**Problem:** user reported the Command tab's "☁ Scheduled Jobs" sub-tab showed no schedules and no "Run now"
button — for anyone, including the actual owner.

**Root cause:** `TRADER_OWNER_UID` was never set (only a commented-out example in `.env.example`), so
`src/cronRoutes.js`'s `isOwner()` — `if (!OWNER_UID) return false` — unconditionally returns `false`. `GET
/api/cron/status` 401s for every request, and `src/js/tabs-command.js`'s `renderCronJobs()` renders only the
"Sign in as the configured owner account..." fallback, never the jobs table or its buttons. Confirmed
`/api/cron/status` itself is otherwise fine — `jobs` is built from the static `JOBS` array with compiled-in
default hours, so it renders correctly even with zero `cron_config` rows once auth passes; this was purely an
auth-gating bug, not a data problem.

**Fix:** the user supplied real credentials in `.env` (Alpaca + Supabase Postgres + `CRON_SECRET`). Queried the
shared `accounts` table directly (read-only) to find the real owner account rather than guessing — the only
owner-shaped row is `id='ekuipers'` (test/`dbu...`/`hesticus` are other unrelated accounts). Set
`TRADER_OWNER_UID=ekuipers` in the local `.env`.

**Still open:** the same var must be added to Vercel's dashboard env vars and the project redeployed (env var
changes don't apply to an already-built deployment — same caveat documented for `CRON_EXECUTE`). Not done from
this sandbox — no Vercel deploy access here. Logged in `CLAUDE.md`'s `## Bugs` section.

---

## v2026-07-24.5 — 2026-07-24 — Correction: Suite roadmap items 1+2 were misimplemented (logo doubled, not text; footer touched, not skipped)

**Task:** user flagged that the earlier same-day pass (v2026-07-24.4, `76a9e99`) got the Suite roadmap items
wrong and asked to force the correct implementation, ignoring the previous commit.

**What was wrong:** Suite roadmap item 1 says "Increase the header **text** ... 2x. Don't touch the footer."
Item 2 says "Decrease the **logo** size in the footer to half the size." The earlier pass doubled the
`.logo-icon`/`.footer-logo-icon` **image** (not text) in **both** header and footer — wrong element for item
1 and it touched the footer (forbidden), and wrong direction/scope for item 2 (increased instead of decreased,
and applied to the header too).

**Fix:** `src/css/base-layout.css`'s `.logo-icon` (header image) reverted to its original `18×18px`/
`border-radius:4px` — item 1 never asked to resize the logo, only the text. `.logo` (header text container,
covers both the `.logo-brand` "CryptoPro" span and the plain "Trader" text) `font-size` doubled `13px→26px`.
`src/css/forms-modals-footer.css`'s `.footer-logo-icon` (footer image, shared by both the site logo and the
Developer Studio logo) set to **half of the original pre-error size**: `9×9px`/`border-radius:2px`. Footer
text (`.footer-name`, a separate class from `.logo`) untouched, matching item 1's "don't touch the footer."
Same correction applied identically across Suite, Charts, Training, and Mobile's header mockup — full
cross-project detail in `CryptoPro Suite/memory/memory.md` (2026-07-24, entry "Roadmap items 1+2 corrected").

**User-confirmed (2026-07-24, same day):** visually checked and confirmed correct — no outstanding caveat.

---

## v2026-07-24.2 — 2026-07-24 — Fix: sign-in database error (stale Supabase env var names)

**Task:** Suite roadmap item — "I changed the environment variables in Vercel and the local .env
files accordingly. Please verify Trader app whether the correct vars are used." Also directly
closes Suite `CLAUDE.md`'s Bug #1 ("The trader app gives a database error when signing into the
app").

**Root cause:** `src/db.js`'s `CONN_VARS` only recognized `DBCRYPTOCHARTS_POSTGRES_URL[_NON_POOLING]`,
`trading_POSTGRES_URL[_NON_POOLING]`, and the generic `POSTGRES_URL*`/`DATABASE_URL` names. The
user's Vercel Supabase-integration reconfiguration now issues **per-project-prefixed** vars instead
— this project's local `.env` (and, per the user, Vercel's dashboard identically) now only has
`CRYPTOPROTRADER_POSTGRES_URL[_NON_POOLING]` (plus unused `*_SUPABASE_*` keys `db.js` never reads).
None of `CONN_VARS`' old names matched, so `connString()` returned `null`, `dbEnabled()` was false,
and every sign-in/register attempt hit the "database disabled" 503 path — reads as a generic
"database error" in the UI.

**Verified same underlying DB, not a new one:** diffed this project's `.env` against CryptoPro
Charts' — identical Supabase host (`bgxjmpzfkxqwoyupqldj.supabase.co`) and password, just under each
project's own prefix (`CRYPTOPROTRADER_*` here, `CRYPTOPROCHARTS_*` there). So the shared-accounts
requirement (Suite workflow rule 18) still holds; only the var *names* changed, not the target
database. Charts' own `src/db.js` has the identical-looking stale-`CONN_VARS` code pattern, but the
user confirmed (same day, follow-up) Charts is still working fine — so that pattern isn't actually
causing a bug there, most likely because Charts' real deployed Vercel env has a working fallback
(e.g. generic `POSTGRES_URL`) this sandbox's local `.env` doesn't show. Lesson: local `.env` isn't a
reliable proxy for a sibling project's actual deployed env — don't extrapolate a bug across projects
from matching code alone.

**Fix:** added `CRYPTOPROTRADER_POSTGRES_URL`/`CRYPTOPROTRADER_POSTGRES_URL_NON_POOLING` to
`CONN_VARS` as the first (highest-priority) entries; kept `DBCRYPTOCHARTS_*`/`trading_*`/generic as
fallbacks for instant rollback. Updated `.env.example` and `README.md`'s sign-in section and
`memory/glossary.md`'s SSO entry to describe the new per-project-prefix scheme.

**Verified:** sourced the real local `.env` and called `db.dbEnabled()` (true) then `db.init()`
against the live Supabase project — connected successfully, `create table if not exists` ran clean
(idempotent, tables already exist from Charts). Full suite: 297/305 pass, same 8 pre-existing
`APCA_*`-env-dependent failures as before this change (unrelated — Alpaca creds, not Postgres).

**Not investigated:** whether Vercel's dashboard env vars actually match local `.env` as the user
stated (not independently verifiable from this sandbox) — the code fix is correct for whatever the
user pasted into both places identically, but if Vercel drifted from local `.env` this won't help.
Also not investigated: `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`/`CRON_SECRET`/`TRADER_OWNER_UID` are
absent from local `.env` (only Supabase-prefixed vars present) — out of scope for "verify the DB
vars" but worth the user double-checking those weren't dropped from Vercel too when they pasted the
new Supabase snippet over the old file.

## v2026-07-24.1 — 2026-07-24 — Multi-tenant conversion Phase 1: Alpaca credential-injection seam

**Task:** roadmap rescan surfaced two new workflow rules (cron cadence + "cron jobs should be
user bound") that don't match current behavior. User confirmed scope: convert the Node engine
(only — Python/GitHub Actions is being retired separately) to full multi-tenant, each user
connecting their own Alpaca credentials, with per-user strategy/risk config too. Full 6-phase
design in `memory/project-trader-multitenant-plan.md`; this entry covers Phase 1 only.

**Problem:** `src/trade.js` read `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`/`APCA_BASE_URL` as
module-level constants at import time — every exported function closed over these, so there was
no way to run the same trading logic against two different Alpaca accounts in one process. This
is the root blocker every later phase depends on.

**Fix:** new `src/alpacaClient.js` — `createAlpacaClient({keyId, secret, baseUrl, dataUrl,
symbolCap})` factory holding every CLAUDE.md hard rule (limit-only orders, band %, position cap),
moved verbatim out of `trade.js`. `trade.js` is now a thin legacy shim (`defaultClient` bound to
the env vars, same destructured named exports) — every existing call site (tests, CLI scripts)
keeps working unchanged. `marketData.js`/`reconcile.js`/`scout.js` gained an optional
`{client = defaultClient}` option on their existing trailing-options convention, replacing direct
`BASE_URL`/`headers` imports from `trade.js` (also deleted `scout.js`'s own dead duplicate
`BASE_URL` read in the same pass). Closed a latent gap in `runEvaluation.js`: `evaluateSymbol()`/
`applyRotation()` had zero credential-override seam at all even though `main()`'s other deps were
overridable — added a `client`-bound `symbolDeps` object threaded into both calls.

**Verified:** full 305-test suite — 297 pass / 8 fail, identical failing set before and after
(diffed against a `git stash`-ed baseline run to confirm). The 8 failures are pre-existing and
unrelated to this change — this sandbox's `.env` has no `APCA_BASE_URL` set, so a handful of
tests that don't stub every HTTP call hit a real "undefined/v2/..." URL error regardless of the
refactor. Grep confirms the only remaining `process.env.APCA_*` reads are in `trade.js`'s legacy
shim.

**Not done in this entry:** the earlier same-day Node-cutover-flip work (pushing commit `227c818`
to trigger Vercel's redeploy after `CRON_EXECUTE=true` was saved) and the cron-cadence roadmap
item are tracked in `CLAUDE.md`'s Roadmap and the global auto-memory system, not backfilled into
this file's changelog — out of scope for this entry, flagged here so it isn't mistaken for
"already logged."

## v2026-07-23.3 — 2026-07-23 — Fix: footer Developer Studio name typo ("SoftVibe" → "VibeSoft")

**Task:** user asked to revise the footer's studio line. The name landed transposed in v2026-07-23.2 —
Suite's shared master `CLAUDE.md` (source of truth, workflow rule/line 9) has always said "VibeSoft Studio",
but this project's footer and journal entry both said "SoftVibe Studio".

**Fix:** `client/src/components/Footer.jsx` — corrected the `<strong>` text to "VibeSoft Studio". Also
corrected the v2026-07-23.2 journal entry above, which had the same typo. Bumped footer Version
`v2026-07-23.2` → `.3`. Single-project fix — did not check whether Charts/Training/Suite footers have the
same typo.

**Verified:** visual diff of the two strings against Suite `CLAUDE.md` line 9; no build run (single JSX text
change).

## v2026-07-23.2 — 2026-07-23 — Roadmap: "rescan workflows rules" — Developer Studio logo added to footer

**Task:** "rescan roadmap" (Suite's shared master `CLAUDE.md`, roadmap item #1: "rescan workflows rules").
Suite workflow rule 3 had just been updated to require a "company logo" + "developer studio name" in the
footer, alongside a genuinely new source asset (`docs/VibeSoft Studio logo.png` in the Suite repo). No footer
in any of the 4 projects showed the Developer Studio's own name/logo before this — only each project's
own favicon-as-site-logo (a separate, earlier rule). Implemented identically across all 4 projects (shared
footer pattern, Suite workflow rule 17); full cross-project detail in Suite's own `memory/memory.md`
2026-07-23 (4).

**Fix:** resized the source PNG to a 96×96 `docs/studio-logo.png` (served at `/studio-logo.png` via this
project's existing `express.static(docs)`, same path convention as `favicon.svg`). `client/src/components/
Footer.jsx` gained a "Developer Studio: **VibeSoft Studio**" span (logo + text) next to the existing
"Creator: Erik Kuipers" line, reusing the existing `.footer-logo-icon` (18×18) sizing; added a `.footer-studio`
flex-wrapper class to `src/css/forms-modals-footer.css`. Bumped footer Version `v2026-07-23.1` → `.2`.

**Verified:** `npm --prefix client run build` (46 modules, clean); local `node server.js` smoke test confirmed
`/studio-logo.png` serves `200 image/png` and `/` still 200; server stopped immediately after. No browser
render check this session.

## v2026-07-23.1 — 2026-07-23 — Roadmap: donation link swapped from Buy Me a Coffee to Patreon

**Task:** "scan roadmap" (Suite's shared master `CLAUDE.md`, roadmap item #1: "Replace the buymeacoffee
donation link to Patreon"). Suite's own `CLAUDE.md`/README/docs already *described* Patreon as the active
donation link, but the actual footer code in all 4 suite projects still pointed at
`buymeacoffee.com/erikkuipers` — the doc update had never been followed by a code change. Implemented
identically across all 4 projects since the footer donate link is a shared pattern (Suite workflow rule 17).

**Fix:** `client/src/components/Footer.jsx` — `.footer-donate` link now points to
`https://patreon.com/vibesoftstudio` with label "♥ Support" (was "☕ Donate" → buymeacoffee). Bumped the
footer's Last modified/Version fields to 2026-07-23 / v2026-07-23.1. Removed the completed item from Suite's
`CLAUDE.md` "Roadmap (implement)" list (item 2, the Skip'd GitHub-workflow item, renumbered to 1).

**Verified:** visual diff of the footer JSX only (link target + label text); no dev server run this session —
this is a static link/label change with no logic to exercise. Full cross-project writeup: Suite's
`memory/memory.md` this same date.

## v2026-07-22.7 — 2026-07-22 — Roadmap: notification email on the account profile

**Task:** "rescan roadmap" (Suite's shared master `CLAUDE.md`, roadmap item #1: "Add the option for the
user to add an email address to their profile to receive notifications. Save it in the accounts table in
the database"). Same shared auth stack as the 2FA QR code above, so implemented in all 4 suite projects.

**Fix:** `src/db.js` — `alter table accounts add column if not exists notification_email text` (same
idempotent pattern as `totp_secret`), `toAccount()` maps it, new `updateNotificationEmail(uid, email)`.
`src/auth.js` — new authenticated `POST /api/auth/notification-email` route (plain regex validation, empty
body clears the field); `publicUser()` now includes `notificationEmail`. `src/js/auth.js` — the account
modal (`openAccountModal()`) gained a "Notification email" input + inline Save button that posts to the
new route and updates local state on success, no page reload needed. No email is actually sent anywhere
yet — this only captures and persists the address (no SMTP provider configured anywhere in the suite,
same gap already noted for "forgot password").

**Verified:** `node --check` passed on `src/db.js`, `src/auth.js`, `src/js/auth.js`. **Not verified: an
actual browser save round-trip** — no running dev server with a live DB connection was exercised this
session. Full cross-project writeup: Suite's `memory/memory.md` v2026-07-22.7.

## v2026-07-22.6 — 2026-07-22 — Roadmap: 2FA registration QR code

**Task:** "scan roadmap" (Suite's shared master `CLAUDE.md`, roadmap item #3: "Add a QR Code to the 2FA
registration dialog"). This is auth infrastructure shared identically across all 4 suite projects (per
this project's own `CLAUDE.md` "Auth / SSO" note — `src/auth.js`/`src/db.js`/`src/totp.js` were ported
from Charts/Suite), so implemented in all 4, not just here. `/api/auth/2fa/setup` (`src/auth.js`) already
returned an `otpauthUri` (`src/totp.js`'s `otpauthUri()`), but the client's `openSetupTotpModal()`
(`src/js/auth.js`) only ever rendered the raw secret as text.

**Fix:** vendored `qrcode-generator` (Kazuhiko Arase, MIT, pure JS, no deps — deliberately not hand-rolled,
Reed-Solomon QR encoding is easy to get subtly wrong; also avoids a CDN script per the web-security
ruleset) as `src/js/qrcode-lib.js`, added to `client/src/scriptLoader.js`'s `SCRIPT_ORDER` right before
`auth.js` (loads as a classic global, `window.qrcode`). `openSetupTotpModal()` now renders a new
`totpQrTag(setup.otpauthUri)` helper's `<img>` (inline data-URI, no network call) above the existing
secret text.

**Verified:** `node --check` passed on `src/js/auth.js` and `client/src/scriptLoader.js`; `npm run build`
(client) built clean; the vendored encoder was round-tripped in Node against a real `otpauth://` URI to
confirm it actually produces a valid QR (41×41-module `data:image/gif;base64,...`), not just that the file
parses — same check run against all 4 projects' copies, checksums identical. **Not verified: an actual
phone-camera scan of the rendered modal** — no browser-automation tool or a signed-in test session (needs
Postgres) was available in this run; worth a manual check before considering this fully closed. Full
cross-project writeup: Suite's `memory/memory.md` v2026-07-22.6.

## v2026-07-22.3 — 2026-07-22 — Roadmap rescan: "Paper Trading" → "Paper Spot Trading"

**Task:** Suite `CLAUDE.md` roadmap item 2: "Trader: replace all references 'Paper Trading' with 'Paper
Spot Trading'. The reason for this is that Futures trading not yet available is in this Suite." Item removed
from Suite roadmap per the "move completed items to the project's memory.md" workflow rule.

**Implementation:** Updated every user-facing UI label and first-party doc/skill reference to the app's own
paper-trading mode (left Alpaca's own dashboard UI label alone in README.md, since that's an external
screenshot-accurate instruction, not our copy):
- `client/src/components/Header.jsx` — mode-select dropdown option `"Paper Trading"` → `"Paper Spot Trading"`.
- `client/src/components/Footer.jsx` — tagline "paper-trading cockpit" → "paper-spot-trading cockpit"; the
  disclaimer line "Paper trading by default" → "Paper spot trading by default".
- `client/src/tabs/settings.html` — "📄 Paper Trading" section header → "📄 Paper Spot Trading".
- `client/src/fragments/modals.html` — Terms of Service copy: "paper-crypto trading cockpit" → "paper-crypto
  spot trading cockpit", "paper trading mode by default" → "paper spot trading mode by default".
- `src/js/trade-modal.js` — both live-order-blocked alert strings now say "Switch to Paper Spot Trading mode".
- `README.md` — Settings-tab description (2 places) and the closing agent-purpose note now say "Paper Spot
  Trading" / "paper spot trading agent".
- `skills/crypto-trader/SKILL.md`, `skills/crypto-catalysts/SKILL.md` — frontmatter descriptions now say
  "Alpaca paper spot trading agent".
- `skills/daily-journal-SKILL.md` — hard-rule bullet now says "Paper spot trading only".
- `memory/glossary.md` — glossary term renamed `Paper trading` → `Paper spot trading` with a "(no futures
  support yet)" note.
- **Left unchanged (historical record, not live copy):** past dated entries in `memory.md`,
  `claude_md_archive.md`, and `reports/*.md` that quote the old wording as of when it was written; those
  describe what shipped at the time, not current UI text.

**Verified:** `npm run build` (Vite: 46 modules, 0 errors).

## v2026-07-22.2 — 2026-07-22 — Roadmap rescan: Scheduled Jobs own sub-tab, footer disclaimer + Terms of Service

**Task:** A "rescan roadmap" pass found two uncommitted items hand-drafted in `CryptoPro Suite/CLAUDE.md`
(item 1, the GitHub-cron-to-Vercel item, was already marked `(skip)` there — untouched):
- Item 2: "Trader: In command center at the bottom of the page a panel is created to monitor scheduled
  jobs in the backend. Move this section to a new pane next to the Overview pane in command center."
- Item 3: "Add a disclaimer [to] the footer [for] Suite and Trader that trading can incur losses and that
  the user is at risk if trading live. Also add a link 'Terms of Service' which opens the Terms of Service
  description." (Suite side is out of scope for this repo's own memory.)

**Implementation:**
- **Scheduled Jobs → own sub-tab.** `client/src/tabs/command.html`'s ☁ Scheduled Jobs `<section>` moved out
  of `subpage-command-overview` into a new `subpage-jobs`; `nav.js`'s `COMMAND_SUBS` gained `"jobs"`
  (`["command-overview","jobs","news","socials","glossary"]`), placed right after `command-overview` so it's
  the first sub-tab a user hits, matching the roadmap wording ("next to the Overview pane"). `commandSubTab()`
  now calls `renderCronJobs()` when `subId === "jobs"` (same lazy-load-on-entry pattern as News/Socials/
  Glossary); the previously-unconditional `renderCronJobs()` call inside `renderCommand(c)` (fired on every
  Overview data refresh) is now gated on `_commandSub === "jobs"` so it only keeps refreshing while that
  sub-tab is actually open. No changes to `src/cronRoutes.js`, `/api/cron/*`, or the panel's own markup —
  purely a navigation reorganization.
- **Footer disclaimer + Terms of Service.** `Footer.jsx` gained a yellow `.footer-disclaimer` line ("⚠ Paper
  trading by default. Live trading can incur real losses — you are solely responsible for that risk.") and a
  `.footer-terms-link` button calling `openTermsModal()`. New `src/js/terms-modal.js` (added to
  `client/src/scriptLoader.js`'s `SCRIPT_ORDER`, now 31 files, right after `manual.js`) opens/closes a new
  `#termsModalBackdrop` (`client/src/fragments/modals.html`) via `style.display = "flex"/"none"` — the same
  pattern `trade-modal.js`/`daily-journal-shortcuts.js`/`auth.js` already use, no new modal framework. The
  modal's copy is static (paper-by-default, live-trading risk, no financial advice, no warranty, user accepts
  risk when enabling live trading) — no network fetch. `src/css/forms-modals-footer.css` gained
  `.footer-disclaimer`/`.footer-terms-link` rules. `src/js/manual.js`'s Command section updated to say
  "Scheduled Jobs sub-tab" instead of "panel" so the in-app manual doesn't describe stale navigation.

**Verified:** `npm run build` (Vite: 46 modules, 0 errors — the two new files are runtime-loaded classic
assets like the other 29, not part of the Vite bundle); a local `node server.js` smoke test (`/` and
`/js/terms-modal.js` both 200). **Not verified — no browser tool this session:** an actual click-through of
the new ☁ Scheduled Jobs sub-tab switching correctly, or the Terms of Service modal opening/closing and
reading legibly in both themes. Footer version/last-modified bumped to `v2026-07-22.2` / `2026-07-22`.

## v2026-07-22.1 — 2026-07-22 — Roadmap: in-app user manual (Help button, unfolds from the left)

**Task:** CryptoPro Suite roadmap item 1 ("add a user manual to Trader, invoked via the Help button in the
top bar, enfolding from the left — consistent with Charts"), surfaced by a roadmap scan. Suite roadmap
item 2 ("move all GitHub cron workflows to Vercel") was explicitly marked `(skip)` in the same scan and
left untouched — it's also still blocked on the Node cutover's gate 2 (see `v2026-07-21.8` above).

**Implementation:** Ported Charts' pattern (`helpBtn` → off-canvas `#manualPanel`, TOC + content + search)
rather than reinventing it, adapted for this project's architecture:
- `client/src/components/Header.jsx` — new `❓` `#helpBtn` next to the theme toggle (no `onClick`; wired by
  the classic script below, matching how `#accountBtn` is wired by `src/auth.js`).
- `client/src/fragments/modals.html` — `#manualPanel` markup (search input, left-rail `#manualToc`,
  `#manualContent`) added alongside the existing modal fragments; rendered into the DOM the same way
  (`Modals.jsx`'s `dangerouslySetInnerHTML`).
- `src/css/manual.css` (new file, linked in `client/index.html`) — `.manual-overlay` is `position:fixed`,
  `left:-560px` → `.open` flips it to `0` with `transition:left .2s`, same off-canvas mechanism Charts uses,
  restyled with this project's own CSS variables (`--surface`/`--border`/`--blue`/`--hover`, no
  `--panel`/`--topbar-h` equivalents existed here) and a `top:57px` to clear the sticky header (matches the
  sidebar's own `top:57px`).
- `src/js/manual.js` (new file, added to `client/src/scriptLoader.js`'s `SCRIPT_ORDER` right before
  `main.js`) — plain global-scope script (Charts uses ES modules; this project's `src/js/*.js` share one
  global scope, so the module syntax didn't port, only the wiring pattern). `MANUAL_SECTIONS` is a static
  array of `{id, title, html}` written fresh for Trader's own tab structure (Command/Trade/Portfolio/
  Analysis/Settings, Autopilot, Scheduled Jobs, Account/sign-in, keyboard shortcuts) — Charts' content
  described its own charting/watchlist UI and didn't transfer. `initManualGuide()` self-invokes at the
  bottom of the file, same pattern as `auth.js`'s `initAuth()`.
- Footer version bumped to `v2026-07-22.1`, last-modified `2026-07-22`.

**Verified:** `node --check src/js/manual.js`; `npm --prefix client run build` (46 modules, 0 errors, same
count as before — no new modules since the CSS/classic-script files aren't bundled by Vite); a local
`node server.js` smoke test — `/`, `/js/manual.js`, `/css/manual.css` all 200, and the served page contains
`manual.css`'s `<link>`; `modals.html` div balance unchanged (41 open / 41 close). **Not verified — no
browser tool in this session:** an actual click-through confirming the panel slides open, the TOC/search
filter correctly, and Escape/✕ close it. Exercise it manually before relying on it.

## v2026-07-21.5 — 2026-07-21 — Roadmap follow-up: adjustable cron schedule + settings permission

**Task:** "rescan roadmap and always allow bash commands, don't ask for approval." Two parts:

**1. Settings:** added `"Bash"` to `.claude/settings.local.json`'s permission allow-list (this project's
existing local overrides file — already tracked in git here, unusually, but that's pre-existing repo
state, not something to "fix" unprompted). Bash commands in this project no longer prompt for approval.

**2. Roadmap rescan:** own Roadmap/Bugs empty; Suite's Bugs empty; Suite's Roadmap had the one item from
v2026-07-21.4, edited in-place by the user with two additions: *"Schedule these processes with Cron 1x day
2 hours apart. The frontend is used to setup and monitor the scheduled cron jobs"* became, later the same
day, a fuller item: *"add a panel to the Command Center which shows information about the cron jobs and
their schedule. Add the option to adjust the schedules and monitor execution. Save the schedules
configuration for each user account."* The "shows schedule" and "monitor execution" parts were already
satisfied by v2026-07-21.4's panel; "adjust the schedules" and "save... for each user account" were new.

**Key design problem:** Vercel Cron's schedule (`vercel.json`) is static, compiled-in config — it cannot be
rewritten at runtime, so a dashboard control that "adjusts the schedule" can't mean editing `vercel.json`
from the browser. Resolved by decoupling "when does Vercel wake the function" from "does this specific job
actually run now": `vercel.json` now points a single **hourly dispatcher** (`GET /api/cron/dispatch`,
`0 * * * *`) instead of 3 fixed daily times; the dispatcher reads each job's dashboard-configured hour from
a new `cron_config.hour_utc` column and only runs it once that UTC hour arrives and it hasn't already run
today. The due/not-due decision is pure logic (`src/cronSchedule.js`'s `isJobDue()`, `todayUtcDateStr()`)
— extracted into its own tested module rather than left inline, matching this project's strong convention
of unit-testing all pure logic (7 new tests, 305 total) even though the routing/DB layer around it isn't
unit-tested (see v2026-07-21.4's note on that convention).

**Explicit tradeoff, documented rather than hidden:** hourly Vercel Cron invocation needs a non-daily tier
(Pro or above) — Vercel Hobby only allows once-daily schedules. This is the same open question flagged
back in the original v2026-07-21.3 analysis, now actually load-bearing instead of avoidable: "adjust the
schedule" and "stay on Hobby's daily-only cron" are mutually exclusive, so the daily-cadence workaround
from v2026-07-21.4 (3 separate daily crons, no dispatcher) had to be replaced. Documented prominently in
`CLAUDE.md`, `README.md`, and the dashboard panel's own HTML comment — including the fallback (an external
hourly pinger hitting `/api/cron/dispatch` with the bearer secret) for anyone who stays on Hobby.

**"Save the schedule configuration for each user account"** — applied honestly rather than literally:
this is a single-tenant trading engine (one Alpaca account), so a genuinely separate schedule per Suite
account would be incoherent (whose schedule wins?). Implemented as `cron_config.updated_by_uid`:
attribution of which account last changed the one shared schedule, not a schedule-per-uid table. Since
only `TRADER_OWNER_UID` can write it at all (per v2026-07-21.4's fix), this is consistent with the existing
security model rather than a new tenancy concept bolted on top.

**Second security-reviewer pass** (mandatory per this project's rules — new route, new DB writes) on
`/api/cron/dispatch` and the extended `PUT /api/cron/config/:job` (now `{enabled, hourUtc}`, validated as
an integer 0-23): no CRITICAL/HIGH. Confirmed the dispatcher reuses the exact same bearer-only auth and
`job_runs` concurrency lock as the existing per-job routes (no new bypass), and that `hourUtc`'s type
coercion has no injection path (parameterized query regardless). Two LOW nits fixed opportunistically:
`enabled` is now checked with strict `=== true` instead of `Boolean(...)` (a stray truthy string like
`"false"` previously would have coerced to enabled — never reachable from the one real client, but cheap
to close). Not fixed (accepted as genuinely low-severity): a last-write-wins race if the owner toggles
`enabled` and changes the hour in very quick succession from two overlapping requests — self-inflicted,
single-account, doesn't bypass any gate.

**Verified:** `npm test` (305/305), `npm run build` (46 modules, 0 errors), `node --check` + a full
`server.js` import smoke test. **Still not verified** — same caveats as v2026-07-21.4: no live Vercel Cron
invocation, no browser click-through of the new hour selector, no live Postgres connection to confirm the
`alter table cron_config add column if not exists hour_utc/updated_by_uid` migrations apply cleanly.

**Filed:** Suite's `CLAUDE.md` Roadmap item cleared again; `CLAUDE.md`/`README.md`/`.env.example`/glossary/
dashboard-layout updated. Footer version bumped v2026-07-21.4 → v2026-07-21.5.

## v2026-07-21.4 — 2026-07-21 — Roadmap implementation: cron cutover infrastructure built (dry-run only)

**Task:** "Rescan and implement roadmap." Own Roadmap/Bugs empty; Suite's Bugs empty; Suite's Roadmap had
the one item filed as v2026-07-21.3 below, now elaborated with two clarifications the user added directly
to Suite's `CLAUDE.md`: "Schedule these processes with Cron 1x day 2 hours apart. The frontend is used to
setup and monitor the scheduled cron jobs." Both resolved open questions from the v2026-07-21.3 analysis —
once/day-per-job sidesteps the Vercel Hobby-tier cron-cadence limit entirely, and "frontend sets up" was
implemented as a per-job enable/disable toggle (the actual time-of-day stays static in `vercel.json`,
since Vercel doesn't expose a runtime API to rewrite it) plus status/manual-trigger, not a fully dynamic
scheduler.

**Built, in order:** (1) `src/stopWatchdog.js`/`src/dailySummary.js` — ports of the two Python scripts
the workflows call that weren't ported yet (Node port was previously blocked on `stop_watchdog.js`
specifically, since it shares `positions_state.json` with `run_evaluation`); 16 new tests, 298 total,
same `deps`-injection pattern as `runEvaluation.js`. Split `journal.js`'s `appendJournalBlock()` (and the
two new modules' equivalents) into a pure text-builder + a thin fs-writer wrapper — needed so the cron
routes could reuse the exact same formatting without doing synchronous file I/O. (2) `src/db.js` —
`trader_state`/`trader_journal` (replace `positions_state.json`/`journal/*.md`, since a Vercel serverless
function has no persistent local disk across invocations), `job_runs` (audit trail + concurrency lock),
`cron_config` (per-job enable toggle). (3) `src/cronRoutes.js` — `GET`/`POST /api/cron/evaluate|watchdog|
daily-summary`, `GET /api/cron/status`, `PUT /api/cron/config/:job`, wired into `server.js`. (4)
`vercel.json` — 3 cron jobs, once daily, 2h apart (02:00/04:00/06:00 UTC) per the user's clarification.
(5) Command-tab "☁ Scheduled Jobs" panel (`command.html`/`tabs-command.js`) — status, enable toggle,
"Run now" per job.

**Safety decisions made without asking (consistent with the project's own standing hard rules, not a new
judgment call):** `CRON_EXECUTE` gates real order placement and defaults unset/false — the existing
Node.js port cutover checklist (frozen-fixture parity, ≥24h live shadow-run parity, state round-trip; see
below) hasn't been run, and flipping it on trust alone would risk two engines (Python cron + this) placing
duplicate orders against the same paper account. This ships the *infrastructure* — routes, schema,
dashboard panel, all real and testable — ahead of that go-live decision, which is deliberately left to
the user. GitHub Actions workflows are untouched and remain the live engine.

**Mandatory security-reviewer pass** (this project's code-review rules require it for new auth/DB/
external-API code) found 3 HIGH findings before commit, all fixed: (1) the `GET` cron routes originally
accepted *either* the `CRON_SECRET` bearer token *or* a signed-in session — since the session cookie is
`SameSite=Lax` (still sent on a top-level cross-site GET navigation), a hostile link could have triggered
a real run just by getting the signed-in owner to click it; fixed by making `GET` bearer-only and `POST`
the session-auth path. (2) the manual-trigger/config-toggle routes accepted *any* signed-in account —
this project's accounts table is shared Suite-wide (open registration, any Charts/Training/Suite account
works here too), so any Suite user could have triggered paper orders or disabled the stop watchdog; fixed
with a new `TRADER_OWNER_UID` env var, fail-closed when unset. (3) the concurrency lock (`job_runs`,
`status='running'`) was a check-then-insert two near-simultaneous requests could both pass; fixed with a
partial unique index (`job_runs_running_uidx ... where status = 'running'`) making the insert itself
atomic. Also applied on review as defense-in-depth: `crypto.timingSafeEqual` for the bearer-token compare
(was `===`).

**Verified:** `npm test` (298/298), `npm run build` (46 modules, 0 errors), `node --check` on every
touched file, a full `server.js` import smoke test with `NODE_ENV=test` (catches missing-export/wiring
bugs without needing a live Postgres connection). **Not verified — no DB/browser in this session:** an
actual Vercel Cron invocation, the dashboard panel rendering/toggling in a real browser, or the Postgres
schema's `create table if not exists`/index statements against a live database. `cronRoutes.js` itself
(the routing/auth layer) has no dedicated test file — consistent with this repo's existing convention
that I/O-boundary modules (`server.js`, `auth.js`, `db.js`, `totp.js`) aren't unit-tested the same way
pure-logic modules are; there's no mocking/supertest infra anywhere in this codebase to test Express
routes or a live Postgres pool against, and adding one felt like scope creep beyond what "implement this
roadmap item" asked for.

**Filed:** removed the item from CryptoPro Suite's `CLAUDE.md` Roadmap. `CLAUDE.md` gained a new "Cron
cutover" section + a Dashboard bullet for the new panel + `.env.example` entries for `CRON_SECRET`/
`CRON_EXECUTE`/`TRADER_OWNER_UID`; `README.md` gained a "Scheduled jobs via Vercel Cron" setup section;
`memory/glossary.md` gained a full term list. Footer version bumped v2026-07-21.3 → v2026-07-21.4.

**Next step, when the user wants to go live:** check the Vercel plan tier isn't needed now (once/day sidesteps
it), set `TRADER_OWNER_UID`, optionally `CRON_SECRET`, run the 4-gate parity checklist (`CLAUDE.md` ›
Node.js port), then and only then set `CRON_EXECUTE=true`.

## v2026-07-21.2 — 2026-07-21 — Roadmap: settings sync to Postgres (Suite roadmap)

**Task:** "rescan roadmap." Own Roadmap/Bugs empty; Suite's Bugs empty; Suite's Roadmap had exactly one
open item, freshly added: "Across all projects, save any user state like layouts, progress, etc. in the
database. This makes it possible to save settings across devices, browsers and sessions."

**Found a proven reference implementation already in production — CryptoPro Charts.** `src/db.js` there has
a generic `layouts(uid, name, data jsonb, updated_at)` table (one row per account, or the `GUEST` sentinel
when signed out), `/api/session` GET/PUT (a single autosave row keyed by `SESSION_NAME`) plus `/api/layouts`
for named saves, and a client `persistence.js` with a debounced autosave and a server-first/localStorage-
fallback load. Didn't need to design anything new — ported the exact same `layouts` table shape and
`/api/session` routes; this project doesn't have a "named multiple saves" concept like Charts' layouts, so
skipped `/api/layouts` entirely.

**Security fork surfaced before writing any code:** `localStorage.proDashboardSettings` bundles paper/live
Alpaca API key+secret together with plain preferences (mode, limits) — Charts' own synced state never
included credentials (only chart layout/indicator prefs). Presented the user the choice explicitly rather
than deciding silently: sync everything including API keys, or sync preferences only and keep keys local.
**Chose preferences only.** This shaped the whole client design — `settingsSnapshot()`/`applySyncedSettings()`
in the new `src/js/settings-sync.js` never touch `paperApiKey`/`paperApiSecret`/`liveApiKey`/`liveApiSecret`,
only `mode`/`limits` from that object plus `dashTheme`/`lastTab`/`proDashboardWatchlist`/`proBacktestDefaults`.

**Second exclusion, found while auditing every `localStorage` key in `src/js/*.js`, not asked about
separately:** every `autopilotXxx` key (`autopilotHwm`, `autopilotPartialTp`, `autopilotEntryTime`,
`autopilotOrderAge`, `autopilotDayOpen`, `autopilotEnabled`, `autopilotIntervalMin`, `autopilotLog`) is live
Autopilot runtime bookkeeping, not a user preference — syncing it cross-device would risk two browser
tabs/devices both believing they own the same position's trailing-stop/partial-TP state, or worse, two
Autopilot loops running for one account simultaneously (Autopilot already places real paper orders whenever
toggled on). `CLAUDE.md` already documents Autopilot as deliberately always-OFF-on-page-load; syncing its
state would silently work against that design. Excluded outright, no separate question needed — the
reasoning was unambiguous once the key was found.

**Change:** `src/db.js` — added the `layouts` table to `init()` plus `getLayout`/`putLayout` (identical to
Charts', `GUEST`/`SESSION_NAME` constants already existed unused since the SSO port). `server.js` — imported
`currentUid`, added `/api/session` GET/PUT. New `src/js/settings-sync.js` (added to `client/src/
scriptLoader.js`'s `SCRIPT_ORDER`, right before `main.js`): `settingsSnapshot()`/`applySyncedSettings()`
(explicit allowlist, not a blanket copy of `proDashboardSettings`), a 1.5s-debounced `scheduleSettingsSync()`,
and `loadSyncedSettings()` (server-wins-if-present, matching Charts' `loadAutosave()` exactly — no merge/diff
against local). Hooked `scheduleSettingsSync()` into the 6 existing save call-sites: `applyTheme()`
(`theme-hooks.js`), `switchTab()` + `_activateSubTab()` (`nav.js`, both `lastTab` writers), `onModeChange()`
(`nav.js`), `saveWatchlistData()` (`analytics-watchlist.js`), `saveBacktestDefaults()` + `saveSettings()`
(`tabs-backtest-settings.js`) — every one guarded with `typeof scheduleSettingsSync === "function"` since
some of these files load earlier in `SCRIPT_ORDER` than `settings-sync.js` itself (harmless: none of these
functions actually *run* until a user interacts, by which point every script has loaded). `main.js`'s
`bootstrapDashboard()` now `await`s `loadSyncedSettings()` **before** `loadConfigFromFile()`, so precedence
is fresh local edits > synced state from another device > `config.json` deploy-time defaults; also re-calls
`loadBacktestForm()` after both loads so the backtest tab's expected-value inputs pick up a synced copy
instead of showing pre-sync stale values on first paint. `saveSettings()`'s confirmation alert text updated
— it previously said "Settings saved locally in this browser," which is no longer accurate for mode/limits.

**Not touched, correctly out of scope:** `clearSettings()` (the button that wipes `proDashboardSettings`
entirely, credentials included) — left local-only; wiring a server-side clear wasn't part of this feature
and touching it risked conflating "clear my API keys" with "clear my synced preferences." Also didn't
extend this to CryptoPro Training or re-touch Charts — those are separate repos/sessions (Training done in
the same pass, see its own `memory/memory.md`; Charts already had this feature before today).

**Verified:** `npm --prefix client run build` (46 modules, 0 errors). `node --check` on every touched
`.js`/`server.js`/`db.js` file. Booted the server locally with no DB configured (`PORT=3011 node server.js`)
and confirmed via `curl`: `/api/session` GET/PUT both 500 (caught by the route's own try/catch, logged, and
by the client's try/catch — falls back to localStorage exactly as before this change, matching Charts'
existing unguarded-`dbEnabled()` behavior on the same routes), `/js/settings-sync.js` 200s with the new
file's content. Footer version bumped v2026-07-21.1 → v2026-07-21.2; `docs/dashboard_layout.md` updated.

## v2026-07-21.1 — 2026-07-21 — Roadmap rescan: header logo scaled down to match the footer

**Task:** "rescan roadmap." Own Roadmap/Bugs (`CLAUDE.md`) and Suite's Bugs list were both empty. Suite's
Roadmap had exactly one open item: "In every project use the same height, font and colors for the project
logo in the header as in the footer." Checked Training and Charts too (`src/css/course.css`,
`src/css/style.css`) — the same header/footer size mismatch exists in both, confirming this is a genuine,
suite-wide gap and not something already fixed elsewhere to copy from.

**Root cause:** the 2026-07-18 cross-suite branding pass (v2026-07-18.7) aligned header/footer *padding*
and gave the footer its own logo icon for the first time, but never made the two identical — header stayed
at a `22px` icon / `17px` weight-850 "CryptoPro Trader" with only "CryptoPro" colored `var(--blue)`, while
the footer stayed at `18px` / `13px` weight-700 plain `var(--text)`, no color split at all. The roadmap item
was still open because that pass solved *presence* (footer got a logo) but not *parity* (the two don't
match).

**Options presented to the user before touching anything** (three shapes: grow the footer up to the
header, shrink the header down to the footer, or leave each section's own type scale and just unify icon
radius + color): **chose shrinking the header down** to the footer's existing compact treatment.

**Change:** `client/src/components/Header.jsx` — replaced the inline `style={{width:'22px',height:'22px',
borderRadius:'6px',verticalAlign:'-5px'}}` on the logo `<img>` with the shared `.logo-icon` class (added to
`src/css/base-layout.css`, `width/height:18px; border-radius:4px; vertical-align:middle` — identical values
to the existing `.footer-logo-icon`). `.logo`'s `font-size`/`font-weight`/`gap`/`letter-spacing` changed
from `17px`/`850`/`10px`/`-.2px` to `13px`/`700`/`6px`/*(removed)* — now byte-identical to `.footer-name`.
`client/src/components/Footer.jsx` gained the missing `<span className="logo-brand">CryptoPro</span>`
split (previously the footer's "CryptoPro Trader" was one plain, uncolored text node) — reuses the
existing global `.logo-brand{color:var(--blue)}` rule already defined for the header, so no new CSS class
was needed for the color half of the fix.

**Not touched, correctly out of scope:** CryptoPro Charts (not yet converted to React per Suite TO DO item
2 — its header uses a fixed `--topbar-h:44px` compact terminal chrome, deliberately left alone in the
2026-07-18 pass since it's a dense charting UI) and CryptoPro Training (same unresolved header/footer
mismatch found there during this scan, `src/css/course.css:49-52` vs `:84-85` — that project's own session
needs to apply the equivalent fix; not edited from here since it's a separate repo with its own memory.md/
CLAUDE.md workflow).

**Verified:** `npm --prefix client run build` — succeeds, 46 modules, no JSX/CSS errors. No backend files
touched, Python/Node test suites unaffected. Footer version bumped v2026-07-19.7 → v2026-07-21.1;
`docs/dashboard_layout.md` changelog updated.

## v2026-07-20.2 — 2026-07-21 — Roadmap rescan: Bug #9 was never fully fixed — 2 more copies found

**Task:** "rescan roadmap." Suite `CLAUDE.md` had a fresh bug report: LTC/USD and BTC/USD still
round-tripping within minutes (4m/13m apart) *after* v2026-07-20.1's Python fix (`scripts/
run_evaluation.py`) had already been pushed and was live for several hourly cron runs — confirmed via
`journal/2026-07-20.md`'s 15:19/17:23/18:49/21:10/22:43 GMT+2 evaluations, none of which logged a
`PARTIAL-TP RECONCILED` warning (the BTC/USD sell in that window was a legitimate stale-exit, not the
bug). So the Python fix *was* working — the new round trips had to be coming from somewhere else.

**Root cause: the exact same Bug #9 logic exists in two more places I hadn't touched.** This codebase
carries three independent ports of `reconcile_positions_from_fills()`, and I'd only fixed the original:
1. `scripts/run_evaluation.py` (Python, live engine) — fixed in v2026-07-20.1.
2. `src/js/edge-insights.js`'s `apReconcileFromFills()` — used by the **browser-side Autopilot**
   (`src/js/autopilot.js`), which runs independently in the user's browser whenever toggled on and places its
   own real orders (`client_order_id` `ap-`). This was still running the pre-fix per-lot-dust logic, so it
   kept mis-flagging LTC/BTC as "partial TP already done" and pinning breakeven stops — explaining the
   continued round trips despite the Python fix being live.
3. `src/reconcile.js` — the Node.js port's version (Phase 2, not wired to production, but kept at parity
   for when cutover happens).

Applied the identical peak-relative-flatness fix (net-qty scalar vs. episode peak, not each lot's own
size) to both. `src/reconcile.js` has real test coverage (`src/reconcile.test.js`) — added the same 2
regression tests ported from `tests/test_reconcile.py` (small-trailing-lot repro + repeated-episode
non-inflation); 282/282 Node tests pass (was 280). `src/js/edge-insights.js` has no test harness (classic
dashboard script, matches the rest of `src/js/*.js`) — verified with `node --check` only.

**Lesson — three-way Python/browser-Autopilot/Node-port parity is easy to under-scope.** `CLAUDE.md`
already has a documented parity discipline for `calcSignalScore()`, but this is the first time a
*reconciliation-logic* bug needed the same three-way port. Any future fix to `scripts/run_evaluation.py`'s
`reconcile_positions_from_fills` (or `prune_stale_position_state`) must also touch
`src/js/edge-insights.js`'s `apReconcileFromFills` and `src/reconcile.js`'s `reconcilePositionsFromFills`
— added as a glossary entry so this isn't missed again.

**Verified:** `npm test` (282/282), `node --check` on `src/js/edge-insights.js` and `src/reconcile.js`.

## v2026-07-20.1 — 2026-07-20 — Roadmap rescan: quick-loss positions, dead Charts link, cross-project auto sign-in

**Task:** "rescan roadmap." Own Roadmap/Bugs were empty; the open items lived at the Suite level
(`CryptoPro Suite/CLAUDE.md`). Per rule 22 (bugs before roadmap), triaged all three Trader-relevant items
with the user before touching trading logic, then implemented all three.

**Bug #9 (P0) — LINK/ETH/LTC round-tripping into small losses within ~1h of entry.** Root cause: a
2026-07-18 fix (Bug #6/#7) made `reconcile_positions_from_fills()`'s FIFO walk compare each SELL's leftover
against *that lot's own* size (`scripts/run_evaluation.py`), which works for a single-lot position but not
a multi-tranche one — if the aggregate fee-rounding shortfall happened to land inside a small trailing lot
(e.g. a leftover partial-TP remainder), that lot's own tight tolerance never popped it, so the walk never
saw the position go flat again. Every SELL for that symbol *forever after* got miscounted as "partial sell
— still open," so `sells_since_start` only ever grew (LINK/USD: 16 → 37 partial sells across 10 days per
the journal) and every fresh entry reconciled as "partial TP already done" on its first evaluation —
pinning an un-overridable breakeven stop (`run_evaluation.py:1022-1037`) before any real profit, so the
next tick's noise closed it for a few bps loss. Fixed by tracking flatness with a single running net-qty
scalar compared against the *episode's peak size*, not each lot's own size — immune to how many tranches
made up the position. Added 2 regression tests to `tests/test_reconcile.py` reproducing the exact
small-trailing-lot shape and a multi-episode sequence; all 173 Python tests pass (was 171).

**Bug (Suite list) — Trader→Charts symbol links never resolved.** Not actually a watchlist-membership
issue (the user's guess in the bug report) — `tvLink()` (`src/js/utils.js`) always emits USD-quoted tickers
(Alpaca is USD-only), but Charts' router applied the link straight to its *default* exchange (binance/
bybit), which lists alts in USDT, not USD, so the fetch 404'd for anything but a handful of USD-native
pairs. Fixed by pinning `&exchange=alpaca` on every `tvLink()` URL — Alpaca is the venue Trader actually
trades on and is genuinely USD-quoted, so every link now resolves regardless of Charts' own default
exchange or watchlist contents.

**Roadmap (Suite list) — "signed in to the Suite → automatically signed in to other projects."** Session
cookies can't be shared directly (each CryptoPro app is its own Vercel subdomain, not a shared apex domain
a cookie's `Domain` attribute could target), so implemented a short-lived (60s) single-use SSO ticket
handoff instead: `POST /api/auth/sso-ticket` (authenticated) mints a token in a new `sso_tickets` table
(shared Postgres); a `?sso=<token>` query param on any GET request is consumed atomically (`UPDATE ...
WHERE used=false AND expires_at>now() RETURNING uid`) by a new `app.use` middleware registered before the
static/SPA routes in `src/auth.js`, which mints a normal local session and always 302-redirects to a clean
URL. Ported identically into `CryptoPro Charts`, `CryptoPro Training`, and `CryptoPro Suite`'s `src/auth.js`
+ `src/db.js` (see each project's own memory.md / `CryptoPro Suite/memory/memory.md` for the full
cross-repo narrative) — Trader and Charts/Training only gained the *consuming* side for now; Suite's
landing page (`src/js/auth.js`'s `wireCrossProjectLinks()`) is the one issuing tickets, since the roadmap
item is specifically "signed in to the Suite." Trader's own `/api/auth/sso-ticket` issuance endpoint exists
for symmetry/future use but nothing calls it yet.

security-reviewer ran against the full 4-repo diff before commit (mandatory per this repo's
code-review.md for auth changes): no CRITICAL/HIGH findings (atomic single-use consume, redirect target
is always relative — verified no open-redirect via `new URL(req.originalUrl, 'http://x')`.pathname
reconstruction, CSRF via SameSite=Lax + Origin/Referer check). One MEDIUM accepted risk, not mitigated:
anyone who self-registers can mint a ticket for their own account and hand a victim a link that silently
signs the victim's browser into the *attacker's* account on another app (session-fixation-style, no
privilege escalation against the victim's own data) — acceptable for a single-operator hobby suite today,
revisit if the suite gains other real users. One incidental fix: `CryptoPro Suite/server.js` was missing
`trust proxy` + the Origin/Referer CSRF middleware the other three apps already had (drift, not part of
this feature) — added for consistency since Suite is now the SSO trigger point.

**Verified:** `npm test` (280/280 Node), `python -m pytest tests/` (173/173), `node --check` on every
edited JS file across all 4 repos, `npm --prefix client run build` unaffected (no client/src touched).

## v2026-07-19.8 — 2026-07-19 — Suite TO DO item 1: SSO with CryptoPro Charts/Suite

**Task:** explicit user request ("implement one roadmap item from the Suite project" → chose "SSO across
all projects" from Suite `CLAUDE.md › TO DO`, over the smaller alternatives — email-in-profile, test 2FA,
social login). Neither this project nor CryptoPro Training had any auth code at all; CryptoPro Charts and
CryptoPro Suite already share one Postgres accounts/sessions database with username/password login +
optional TOTP 2FA. Ported that exact pattern into both.

**Change:** added `src/auth.js` (routes: `GET /api/me`, `POST /api/auth/{register,login,logout,
change-password}`, `POST /api/auth/2fa/{setup,enable,disable}`), `src/db.js` (trimmed to just the
`accounts`/`sessions` tables — Charts' other tables are its own feature data, not part of the SSO pattern),
and `src/totp.js` (RFC 6238, zero deps) — all near-verbatim ports from CryptoPro Charts. `server.js` gained
`app.set('trust proxy', 1)`, a CSRF Origin/Referer host-check middleware scoped to mutating `/api/*`
requests, `express.json()`, `installAuthRoutes(app)`, and a `db.init()` call. Added `pg` to `package.json`
and a new `.env.example` documenting the shared-DB env var convention. Client: a `👤 Sign in` button in
`Header.jsx`, a generic `#authModalBackdrop`/`#authModalBody` shell added to `client/src/fragments/
modals.html` (reusing the existing `.modal-backdrop`/`.modal-header`/`.modal-body`/`.modal-footer` CSS),
a new `src/js/auth.js` classic script (ported from Charts' client auth.js, adapted from Charts'
`showModal()/closeModal()` helpers — which don't exist here — to this dashboard's own `style.display`
modal-toggle convention) added to `scriptLoader.js`'s `SCRIPT_ORDER`, and a small `.acct-*` CSS block in
`forms-modals-footer.css`.

**`db.js`'s `CONN_VARS` priority:** `DBCRYPTOCHARTS_POSTGRES_URL[_NON_POOLING]` (the suite's existing
shared-DB identifier) first, then this project's own pre-existing `trading_POSTGRES_URL*` vars (a
*different* Supabase project, going by the distinct naming prefix) as fallback, then generic
`POSTGRES_URL`/`DATABASE_URL`. **Not done yet — a manual, outside-of-code step:** the deployed (Vercel)
environment still needs `DBCRYPTOCHARTS_POSTGRES_URL[_NON_POOLING]` added, pointed at the exact same
Supabase project Charts uses, or accounts here won't actually be shared with the rest of the suite — the
code is ready, the environment isn't wired yet.

**Security review:** ran the security-reviewer agent over all 5 new/changed files (both this project and
CryptoPro Training, ported identically). Found and fixed: (1) **CRITICAL** — `GET /api/me` had no
try/catch around `parseCookies()`'s `decodeURIComponent()`, so one malformed cookie (`Cookie:
cpc_session=%zz`) crashed the entire Node process via an unhandled promise rejection; reproduced live
against a running server, confirmed fixed (process stays alive, cookie is just skipped) after wrapping the
per-cookie decode in its own try/catch. (2) Login leaked a timing side-channel for username enumeration
(scrypt only ran when the account existed) — fixed by always paying the same scrypt cost against a fixed
dummy salt/hash when the account doesn't exist. (3) TOTP code comparison used `===` instead of
`crypto.timingSafeEqual` — fixed. Flagged but **not** fixed (inherited from the already-deployed Charts/
Suite pattern, out of scope for a straight port): the in-memory per-IP rate limiter won't survive across
separate Vercel serverless instances/cold starts, and the CSRF Origin/Referer check fails open when a
request supplies neither header (only reachable on `/api/auth/login|register`, which don't require an
existing session cookie the way every other mutating route does).

**Verified:** `node --check` on every new/changed `.js` file; `node -e "import('./server.js')"` boots
clean with the DB gracefully disabled (no live credentials touched); `npm --prefix client run build`
succeeds; `npm test` — 280/280 still green (no Python/Node-port files touched); manually confirmed the
critical-fix regression with `curl --cookie "cpc_session=%zz" .../api/me` against a locally running server
— 200, process stays alive.

## v2026-07-19.7 — 2026-07-19 — Roadmap: suite-wide workflow-rules verification pass

**Task:** "rescan roadmap." Own Roadmap/Bugs were empty; Charts/Training Roadmap/Bugs were also empty. The
only open item across the whole suite was the Suite-level roadmap: "Verify all projects against the
workflow rules in this file" (25 rules in `CryptoPro Suite/CLAUDE.md`). Ran `git fetch` first per the
existing lesson below — local HEAD was already even with the remote, no stale-checkout risk this time.

**Gaps found and fixed in this repo** (checked against Suite rules 3, 14, 16 — full audit + Charts/Training
fixes logged in `CryptoPro Suite/memory/memory.md`):
- Rule 3 (title/year/creator/donation link in footer): `client/src/components/Footer.jsx` had everything
  except the donation link. Added a `☕ Donate` link to `https://buymeacoffee.com/[username]` (same URL
  Suite's own footer uses) + a matching `.footer-donate` style (`src/css/forms-modals-footer.css`, same
  amber `#e0b45c` Suite already uses, for cross-suite consistency per rule 17).
- Rule 14 ("CryptoPro" a different color than the project-name extension): `Header.jsx` rendered
  `CryptoPro Trader` as one plain-colored text node — no split at all. Wrapped `CryptoPro` in a
  `<span className="logo-brand">`, colored `var(--blue)` (`src/css/base-layout.css`) — this repo's
  existing accent-ish highlight color (no `--accent` var previously existed here, unlike Charts/Training).
- Rule 16 (`/debug/` + `.gitignore`): `.gitignore` had no `/debug/` entry (Suite's own repo already did).
  Added, matching Suite's comment style. No `debug/` folder exists yet in any of the 3 sub-projects.

**Not touched, correctly out of scope:** Suite's own `CLAUDE.md › TO DO (don't implement, for planning
only)` already lists "Trader: save settings and other items in the database" and "Use SSO on all
projects" — rule 18 (single Supabase DB + SSO) work stays there, not auto-implemented from a roadmap
scan. Rule 24 (React frontend) and rule 9 (frontend/backend split) were already satisfied here from the
2026-07-19 conversions earlier today.

**Verified:** `npm --prefix client run build` — succeeds, no JSX/CSS errors. `npm test` — 280/280 still
green (no backend file touched). Footer version bumped v2026-07-19.3 → v2026-07-19.7.

## v2026-07-19.6 — 2026-07-19 — Bug closed: black screen on startup (browser cache, not app-side)

**Task:** "rescan roadmap." Suite-level `CLAUDE.md` Bugs listed "Trader app is broken and only shows a
black screen upon startup," filed after the React/Vite conversion. Per Suite workflow rule 22, bugs take
precedence over roadmap.

**Investigation:** rebuilt `client/` and served it locally (`node server.js`) — homepage, JS bundle, and
all `/js/*` `/css/*` assets returned 200 with correct content; no reproduction. Confirmed by the user: the
black screen was a stale browser cache on the client side, not a server/build/app defect — no code change
needed.

**Resolved:** removed from `CryptoPro Suite/CLAUDE.md` › Bugs (moved here per Suite workflow rule 15).
Suite roadmap remains empty — no further action from this scan.

## v2026-07-19.5 — 2026-07-19 — Bug fix: Vercel deploy failed with "vite: command not found"

**Task:** "scan roadmap." Suite-level `CLAUDE.md` roadmap had no open items, but its Bugs list had one
open item filed after the 2026-07-19 React/Vite conversion (v2026-07-19.2): Vercel's build step exited
127 with `sh: line 1: vite: command not found`. Per Suite workflow rule 22, the bug took precedence over
(the empty) roadmap.

**Root cause:** `client/` is its own npm project (own `package.json` + `package-lock.json`, holding
`vite`/`@vitejs/plugin-react`/`react`/`react-dom`) — not an npm workspace of the root project. Root
`package.json`'s `build` script was `npm --prefix client run build`, which assumes `client/node_modules`
already exists. A hosting platform's default install step (`npm install`, root only) never touches
`client/`, so `vite` was never installed before the build script tried to invoke it.

**Reproduced locally:** moved `client/node_modules` aside and ran `npm run build` from root — failed the
same way (`'vite' is not recognized...` on Windows; Vercel's Linux shell reports it as `vite: command not
found`, same missing-binary cause).

**Fix:** `package.json` → `"build": "npm --prefix client install && npm --prefix client run build"`
(one-line change; installs `client/`'s own deps before building it, no workspace restructuring, no
lockfile changes needed).

**Verified:** re-ran `npm run build` from root with `client/node_modules` still absent — install +
build both succeeded, `client/dist/index.html` + hashed JS bundle produced (2.36s). `npm test` — full
280/280 Node suite still green (unrelated to this change, confirms nothing else broke). Docs updated:
`README.md` › Hosting (explains the workspace-vs-not gap), this file. Suite-level bug marked fixed —
remove it from `CryptoPro Suite/CLAUDE.md` › Bugs (moved here per Suite workflow rule 15).

## v2026-07-19.3 — 2026-07-19 — CLAUDE.md compacted; full detail archived

**Change (docs only, no code touched):** CLAUDE.md had grown to 746 lines (~70k tokens), dominated by
full hard-rule tables, per-tab dashboard specs, the Node-port table, and bug histories. It was compacted
to a <100-line operational summary. **Every removed line is preserved verbatim in
`memory/claude_md_archive.md`** (pre-compaction snapshot + header note), which the compact file points to
as the authoritative detail layer. Kept in CLAUDE.md: workflow/standing doc rule, schedule, one-line hard
rules with key numbers and config pointers, ships-OFF flag list, method summary, module pointers,
dashboard parity rules. `README.md`, `memory/glossary.md`, and `docs/dashboard_layout.md` unchanged (no
feature or behavior change to describe).

## v2026-07-19.2 — 2026-07-19 — EJS shell replaced with a React (Vite) shell, mid-session rule discovery

**What happened:** immediately after finishing the EJS conversion below and moving to clear the
CryptoPro Suite roadmap item, `CryptoPro Suite/CLAUDE.md` was found to have gained two new standing
rules since this session started — "Use React as Front-end framework for all projects" and "Use Node.js
as backend for all projects" (the latter already satisfied). This wasn't visible at the start of the
task; the file must have been edited by the user while this session was in progress (they had it open in
their IDE). Flagged the conflict directly rather than silently either ignoring the new rule or discarding
completed work, and asked how to reconcile it.

**Decision:** the user chose to redo the conversion as React now. When warned that a full blind JSX
rewrite of ~200 render functions plus the Autopilot's imperative loop couldn't be verified without a
browser tool in this environment (a real risk for a live paper-trading UI), they chose the safe middle
option over the other two offered (full blind rewrite now; pilot one tab first): build the real
React/Vite shell now, keep tab bodies and all business logic as the already-verified vanilla
`src/js/*.js`/`src/css/*.css` unchanged, and convert tabs to true JSX incrementally in future sessions,
each verified in a browser before the next — the same phased-with-checkpoint pattern already used for the
backend's Node.js port.

**Design choice that lowered risk further, found during planning, not assumed upfront:** rather than
reimplementing `switchTab()`'s per-tab loader dispatch table (`signals` → `loadSignals()`,
`port-overview` → `portLoadOverview()`, etc.) as new React state/effects — which risked silently
duplicating and drifting from logic already proven correct in `src/js/nav.js` — React was designed to
render the entire static shell **once** (mechanically equivalent to what the EJS shell produced) and then
hand off **all** interactivity, unchanged, to the same 30 vanilla files. The only genuinely new code
became: (1) mechanical EJS→JSX conversion of 4 static shell partials (Header/Nav/Footer — Modals used
`dangerouslySetInnerHTML` instead, since its many inline `style="..."` strings would each need
error-prone manual conversion to JSX style objects with no way to visually verify the result), and (2) a
script-loading timing fix — `main.js`'s `bootstrapDashboard()` touches the DOM immediately, so the 30
`src/js/*.js` files are now loaded dynamically from a `useEffect` in `App.jsx` (after React's first
commit) rather than as static `<script>` tags in `index.html`, guaranteeing the `.page` divs it queries
already exist. No `src/js/*.js` file was edited.

**Output:** `client/` (new Vite + React project — `package.json`, `vite.config.js` with a dev-proxy to
the Express server for `/js`/`/css`/`/api`/favicons, `index.html`). `client/src/components/*.jsx`
(Header/Nav real JSX, Footer real JSX, Modals via `dangerouslySetInnerHTML`). `client/src/tabs/*.html` —
the 13 tab partials copied verbatim (diff-verified byte-identical modulo one blank line) from the deleted
`views/tabs/*.ejs`. `client/src/App.jsx` + `main.jsx` + `scriptLoader.js`. `views/` deleted; `ejs`
uninstalled; `concurrently` added as a dev dependency for running the Express + Vite dev servers
together; root `package.json` gained a `build` script.

**A note-worthy build hiccup, caught and fixed before finishing:** the initial `vite@^5.4`/
`@vitejs/plugin-react@^4.3` pairing pulled in a known moderate esbuild dev-server CORS vulnerability
(GHSA-67mh-4wv8-2f99). Rather than accept a known vulnerability in newly-added scaffolding, re-pinned to
`vite@^7.3.6` + `@vitejs/plugin-react@^5.0.4` (compatible per its peer-dependency range) — `npm audit`
now reports 0 vulnerabilities for the client project.

**Verified:** `npm --prefix client run build` completes with no errors (the real compile/syntax check for
JSX, since `node --check` doesn't apply); the built bundle contains the expected tab/modal DOM-id markers
and script-order markers; `curl` smoke tests on a production `node server.js` — `/` (200, contains
`<div id="root">` and the hashed bundle script tag), the built `/assets/*.js` bundle (200), every
`/js/*.js` and `/css/*.css` (unchanged, 200), `/api/health` (200); the 280-test backend suite still
passes unchanged. **Not verified — no browser tool available this session:** whether React actually
mounts correctly, whether the dynamically-injected scripts successfully fire `bootstrapDashboard()`, or
whether clicking a nav button correctly switches tabs and triggers the right loader. This is more
significant here than for the EJS conversion, since the script-injection timing fix is genuinely new
integration glue with no mechanical proof of behavioral equivalence (the EJS conversion had a
byte-for-byte reconstruction diff as its safety net; this doesn't). Flagged explicitly to the user:
run `npm run dev` and click through every tab, a couple of sub-tabs, and the Autopilot toggle before
trusting this for live trading.

## v2026-07-19.1 — 2026-07-19 — Dashboard converted to a Node.js-rendered frontend, static HTML removed

**Change (CryptoPro Suite roadmap item — the only open roadmap item across all four sub-projects at the
time of the scan):** "convert the dashboard's static HTML file to a Node.js frontend and remove the static
HTML." Given the size (10,088 lines) and the fact this is the live paper-trading UI (Autopilot places
real paper orders), this was planned first (`EnterPlanMode`) rather than executed blind. Chosen approach:
Express + EJS templates + classic (non-module) `<script>` files — a structural extraction, not a rewrite,
deliberately avoiding a bundler/SPA-framework rewrite (React/Vite) that would have meant re-implementing
scoring/Autopilot logic inside new component boundaries with no frontend test harness to catch a
regression. Also deliberately avoided ES modules with `import`/`export`: the original script relied on
same-scope function hoisting and a few immediately-executing top-level statements (the
`bootstrapDashboard()` IIFE; three `_orig<Fn> = <Fn>` monkey-patch overrides for
`renderPositions`/`renderRisk`/`renderPerformance`); hand-wiring ~350 cross-file imports for a
live-trading UI with no way to catch a missed one was judged too risky, so 30 classic
`<script src>` files sharing one global `window` scope were used instead, loaded in an order that exactly
reproduces the original single script's execution order (one deliberate exception: `main.js`, containing
only `bootstrapDashboard()` + 3 bootstrap calls, is pulled out of its original mid-file position and
loaded last, since it transitively depends on code defined throughout the rest of the file).

**Method:** the split was scripted (Node, ~30 lines of boundary-detection + a byte-for-byte
reconstruction diff against the original as a correctness gate), not hand-copied — this caught a real bug
mid-process (a named IIFE, `(async function bootstrapDashboard(){...})()`, wasn't recognized by the first
version of the boundary-detector, which would have silently cut the function in half across two files;
found and fixed before any file was written by cross-checking every top-level executable statement in the
file, not just declarations). Full line coverage (no line dropped, duplicated, or reordered within any
single output file) was mathematically verified before any file was written, not assumed.

**Output:** `views/dashboard.ejs` + `views/partials/{head,header,nav,main-open,modals,footer}.ejs` +
13 `views/tabs/*.ejs`; `src/css/*.css` (10 files, original cascade order preserved via `<link>` tags);
`src/js/*.js` (30 files — see `CLAUDE.md › Dashboard frontend architecture` for the full list and load
order). `server.js`: `res.sendFile()` → `res.render('dashboard')` (EJS view engine), plus two new
`express.static` mounts (`/js` → `src/js`, `/css` → `src/css`). The dashboard's old static HTML file
deleted. Fixed a real (if minor) breakage this caused: `tests/test_socials_fetch.js` hardcoded a path to
the now-deleted file — repointed at `src/js/tabs-socials.js` (its new home) and re-verified the 7 tests
still pass logically (via a scratch `.cjs` copy, since the file has an unrelated pre-existing
`require()`-in-an-ESM-project bug dating to 2026-07-13, outside `npm test`'s glob, left unfixed as
out-of-scope).

**Consequence flagged to the user:** the dashboard's old GitHub Pages URL
(`[username].github.io/crypto-pro-trading/`) no longer works — GitHub Pages only serves static files and none remain to publish. The
Vercel deployment (`server.js`, already Node-capable) is the live URL now; local use requires
`npm start`/`npm run dev`.

**Verified:** all 30 `src/js/*.js` files pass `node --check` (proves no file boundary fell mid-statement);
the existing 280-test backend suite (`npm test`) passes unchanged (no backend file touched); `curl` smoke
tests on `/`, every `/js/*.js` (30/30), every `/css/*.css` (10/10), and `/api/health` return 200 with
correct content-type; rendered-page DOM `id`s are an exact 198/198 match against the original file's ids.
**Not verified — no browser tool available this session:** an actual click-through of every tab in a
browser. Flagged explicitly to the user rather than claimed; recommended manually exercising the
Autopilot toggle, Settings save, and a few tabs before relying on this for live trading.

## v2026-07-18.6 — 2026-07-18 — Cross-suite title-bar/footer branding consistency

**Change (driven by a CryptoPro Suite workflow-rules audit, rules 7 + 17):** aligned the dashboard's
header/footer chrome with CryptoPro Suite and CryptoPro Training (the two other sub-projects close
enough in page genre — a spacious dashboard/content page, not Charts' dense charting terminal) to a
shared standard: header padding `14px 22px` → `16px 24px`; footer padding `20px 28px` → `16px 24px`;
header logo icon `20px` → `22px` with `border-radius:6px` added; footer gained a matching `18px`
favicon icon before "CryptoPro Trader" (previously text-only, so rule 10 "favicon as logo everywhere"
didn't reach the footer). Footer `align-items` switched from `baseline` to `center` so the new icon
sits level with the text. Font-family was already the canonical stack shared across the suite
(`-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif`) — left unchanged. Footer
version bumped v2026-07-18.6 → v2026-07-18.7. **Verified:** `git diff --stat` shows exactly the 4
targeted edits (16 lines changed across 2 CSS blocks + 2 markup lines); `wc -l` + tail confirmed the
file's line count (10,088) and closing `</html>` are intact — no truncation (see the Cowork-edit-tool
truncation lesson below).

## v2026-07-18.5 — 2026-07-18 — CryptoPro suite favicon & logo

**Change (branding, requested by the user):** Added the shared CryptoPro suite favicon to the dashboard:
`docs/favicon.svg` (dark navy rounded square, green/red rising candlesticks, green trend line,
orange badge — this app's badge is opposing buy/sell arrows; Charts uses a line-chart badge,
Training a graduation cap) plus raster fallbacks `favicon.ico`, `favicon-32.png`,
`apple-touch-icon.png` (cairosvg). The dashboard's static HTML file: favicon `<link>` tags added to
`<head>`, header logo 📊 emoji replaced with the icon image, footer version bumped to
v2026-07-18.5. **Verified:** icon rendered at 180px and inspected visually; grepped head for links.

## Session History

### 2026-07-18 — Bug fix: Glossary sub-tab dead-ended on "Could not load memory/glossary.md" ("rescan roadmap" trigger)

**Task:** Owner opened the newly-shipped 📖 Glossary sub-tab (previous session) and filed directly in `CLAUDE.md › Bugs`: "Could not load memory/glossary.md — the dashboard needs to be served (or the file must sit two directories as expected, ../memory/glossary.md from docs/); some browsers block file:// fetches of sibling files." — that text is literally the error message the tab itself showed. Then sent "rescan roadmap"; per rule 8 that triggers implementation, and rule 0 gives the (now-filed) bug precedence over the roadmap (which was already empty).

**Investigation:** Confirmed this is a genuine, structural limitation, not a wrong relative path: the dashboard's static HTML file is designed to be opened directly via `file://` (`CLAUDE.md` workflow rule 2 explicitly forbids starting a local server), and most browsers — Chrome in particular — block `fetch()`/`XMLHttpRequest()` reads of a *different* local file from a page loaded via `file://`, with no workaround available from page script (this is a browser security policy, not a bug in the fetch call itself). The dashboard's existing `loadConfigFromFile()` already hits this same wall for `config.json`, but degrades silently (`console.info`, not a UI error) because it has a harmless fallback — browser-stored settings. The new Glossary tab had no equivalent fallback, so the *first* time this general limitation became user-visible was the tab that had no graceful degradation path. Verified the private repo can't be used as a network fallback either: `curl` confirmed general internet connectivity works from this environment (`api.github.com` → 200) but `raw.githubusercontent.com/[username]/alpaca-trading-agent/main/...` 404s for both `README.md` and `glossary.md` — consistent with the repo being private, so an unauthenticated raw-GitHub fetch is a dead end, and embedding a GitHub token client-side to work around it would violate the project's own secret-handling rule.

**Fix (the dashboard's static HTML file):**
- Added a small built-in `GLOSSARY_FALLBACK_MD` constant: a deliberately low-churn curated subset of the real glossary — the Acronyms & Abbreviations table plus ~14 core conceptual Trading Terms (Confluence score, Wyckoff phases, Golden/Death cross, BB squeeze, Regime, Hard cap, ATR sizing, Trailing stop, HWM, Correlation budget, Tier-1 symbols, Daily drawdown gate, Short stop-loss/regime gate, Live R:R). Deliberately excludes the fast-changing dated/implementation-detail sections (function names, dashboard internals) so it won't need updating on every code change the way `memory/glossary.md` itself does.
- `loadGlossary(force)` now sets `_glossaryLive = !!md` and falls back to `GLOSSARY_FALLBACK_MD` when the live fetch returns nothing, instead of blanking the list with a red dead-end error. The status line (`#glossaryStatus`) shows "Live from memory/glossary.md" (muted) when the fetch succeeded, or a yellow explanation + ↻ Refresh prompt when showing the fallback.
- Updated the sub-tab's intro text to mention the fallback behavior.
- Bumped the footer version to `v2026-07-18.3`.

**Verified:**
1. `node -e "new Function(...)"` on the extracted `<script>` block — 0 parse errors (392,770 chars after the addition).
2. Extracted `GLOSSARY_FALLBACK_MD` + `escapeHtml`/`mdInline`/`mdTable`/`renderGlossaryMarkdown` via marker/brace-matching into a Node sandbox (script saved to the session scratchpad, not the repo) and ran the renderer against the fallback string directly: 2,586 chars of markdown → 6,090 chars of HTML, both tables (`.glossary-table`) parsed correctly, no exceptions.
3. `wc -l` (9951 → 10007) and `tail -3` confirmed the file's closing `</body></html>` is intact — no truncation.
4. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` (bug cleared, Glossary feature-table row updated), `README.md`, `docs/dashboard_layout.md`, `memory/glossary.md` (new terms below).

---

### 2026-07-18 — Roadmap: added the 📖 Glossary pane to the dashboard Command tab ("rescan roadmap" trigger)

**Task:** `CLAUDE.md › Roadmap` item 1: "Add the glossary to the dashboard by adding a pane under command center called Glossary." Bugs list was empty (rule 0 gives bugs precedence over the roadmap, but there were none open), so "rescan roadmap" (rule 8) triggered implementation of this item directly.

**Design decision:** Rather than hand-copying glossary content into the dashboard (which would drift from `memory/glossary.md` the moment either file was edited), the new sub-tab **renders the actual `memory/glossary.md` file live** — same principle as `config.json` already being fetched into the dashboard via `fetchLocalJson()`. This keeps `memory/glossary.md` as the single source of truth per the project's existing documentation-update rule.

**Implementation (the dashboard's static HTML file):**
- Added a 4th sub-tab to the 🧭 Command parent tab: **📖 Glossary** (`subtab-glossary` / `subpage-glossary`), alongside Overview/News/Socials. `COMMAND_SUBS` extended to `["command-overview","news","socials","glossary"]`; `commandSubTab()` routes `"glossary"` to a new `loadGlossary()`. Deep link `#glossary` resolves via the existing `applyTabFromUrl()`/`SUBS` machinery — no changes needed there since it already concatenates `COMMAND_SUBS`.
- `fetchLocalText(paths)`: text-fetching sibling of the existing `fetchLocalJson(paths)` helper (same fallback-path-list pattern), used to read the raw markdown file.
- `loadGlossary(force)`: fetches `["../memory/glossary.md", "./memory/glossary.md", "memory/glossary.md"]` (first hit wins — `docs/` → `../memory/glossary.md` is the real path), 5-min cache (`GLOSSARY_CACHE_MS`), ↻ Refresh button forces a re-read. Shows a clear error message (not a silent blank tab) if every path 404s or the browser blocks the `file://` fetch.
- `renderGlossaryMarkdown(md)` / `mdTable(rows)` / `mdInline(escaped)`: a deliberately tiny markdown-subset renderer covering exactly what `glossary.md` uses — `#`/`##`/`###` headers, `| … |` tables (drops the `---|---` separator row), `**bold**`, `` `code` ``, and `---` horizontal rules. Everything is HTML-escaped first (`escapeHtml`) then the inline markdown patterns are applied on the escaped text, so the renderer can't be used to inject arbitrary HTML even if the file content changes unexpectedly.
- `filterGlossary()`: a search box (`#glossarySearch`) hides table rows and paragraphs whose lowercased text doesn't contain the query; section headers are never hidden so the document structure stays legible even mid-search.
- Added `.glossary-h` / `.glossary-p` / `.glossary-table` CSS (reusing the existing `.table-wrap` scroll wrapper and `--text`/`--muted`/`--border` theme tokens — no new colors introduced).
- Bumped the footer version to `v2026-07-18.2`.

**Verified:**
1. `node -e "new Function(...)"` on the extracted `<script>` block — 0 parse errors (388,899 chars, unchanged approach from prior sessions' truncation-safety check).
2. Extracted just `escapeHtml`/`mdInline`/`mdTable`/`renderGlossaryMarkdown` via brace-matching (same technique as `tests/test_socials_fetch.js`) and ran `renderGlossaryMarkdown()` against the **real** `memory/glossary.md` (525 lines) in a Node sandbox: 169,811 chars of output, all 29 markdown tables parsed into `<table class="glossary-table">`, headers and `---` rules present, no exceptions.
3. `wc -l` before/after (9797 → 9951 lines) and `tail -5` confirmed the file's closing `</body></html>` is intact — no truncation (the exact failure mode flagged in the Lessons section below).
4. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` (roadmap item moved to "none open", Command tab row + new Glossary row added to the feature table), `README.md` (Dashboard section: sub-tab list, hash-routing sentence, new bullet), `docs/dashboard_layout.md` (tab count line, `COMMAND_SUBS` mention, Command tab row), `memory/glossary.md` (new term entries below).

---

### 2026-07-18 — Bug fix: manual trade-ticket dialog didn't honor the max portfolio cap ("rescan roadmap" trigger)

**Task:** Owner filed directly in `CLAUDE.md › Bugs`: "When scanning the markets and the user executes an order, a dialog is shown to enter the order. However, the dialog isn't honoring the max. portfolio cap so the user can enter values over the cap resulting in a STOP trading permission block." Then sent "rescan roadmap" — per Workflow rule 8 this triggers implementation, and rule 0 gives the bugs list precedence over the (empty) roadmap.

**Investigation:** the dashboard's static HTML file's manual Execute Paper Trade dialog (`openTradeModal()` → `submitPaperTrade()`) is the shared trade ticket used from the Signals tab, Market Overview, Scanner, and Scalping tab. `submitPaperTrade()` only validated `symbol` present, `qty > 0`, and `limitPrice > 0` before posting straight to `/v2/orders` — no check against `PORTFOLIO_CAPS`/`portCapFor()` at all, unlike `scripts/trade.py`, which enforces the per-symbol cap in code for every automated order. A user could enter a BUY qty that pushed a position well past its cap (e.g. LINK/USD's 5%), submit it, and only discover the problem when the Command tab's live hard-rules panel flipped to a red **STOP** trading-permission status afterward — by which point the over-cap order had already filled.

**Fix (the dashboard's static HTML file):**
- Added `tradeCapProjection(symbol, side, qty, price)`: reads the symbol's existing position from `window._lastPositions`/equity from `window._lastEquity` (already cached by `loadDashboard()`), projects the post-order notional (existing ± this order, direction-aware for buy vs. sell/reduce), and compares it to `portCapFor(symbol) × equity`.
- `updateTradeSummary()` (fires on every keystroke in the ticket) now renders a live cap-check line in a new `#tradeCapWarning` div — green/neutral when within cap, red with the exact max-additional-qty allowed when it would breach the cap.
- `submitPaperTrade()` now calls the same projection for BUY orders and **blocks submission outright** with a detailed alert (cap %, existing notional, projected notional, max additional qty at that price) if it would breach the cap — mirroring `trade.py`'s hard enforcement, but client-side and pre-submission instead of discovered after the fact. SELL/COVER orders (which reduce exposure) are never blocked by this check.

**Verified:** `node -e "..."` extracted and ran every inline `<script>` block through `new Function()` — 1 block, parses with 0 errors. No Python changes, so the existing 171/171 pytest suite is unaffected. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` bugs list cleared, `README.md` (Risk Rules bullet — note: `README.md` was independently reset to an older revision by the user's IDE mid-session; per instruction this was left as-is and the new bullet was appended to the current, simpler file rather than restoring the pre-reset version), `docs/dashboard_layout.md` changelog.

---

### 2026-07-18 — Bug #7: Python never cleared stale per-symbol state on a stop-loss-type full close (dashboard Autopilot already did this correctly)

**Task:** Follow-up to the Bug #6 fix (below): owner asked to check consistency between `scripts/*.py` and the dashboard Autopilot's buy/sell order logic. Direct code comparison surfaced a second, independent defect in the same failure family.

**Investigation:**
- Live-queried `/v2/positions` — the account currently holds **only BTC/USD**. Yet `data/positions_state.json` still carried `partial_tp_done: true` (with a stale `breakeven_stop` at or near the old entry price) for **8 fully-closed symbols**: BAT, CRV, SOL, AAVE, LTC, ETH, DOT, LINK.
- Root cause, found by direct code reading (`scripts/run_evaluation.py`): `ps.clear_position()` — which resets `partial_tp_done`/`breakeven_stop`/`stop_order_id`/etc. — is only called from two places: (1) inside the "position still held" branch, when a tracked `stop_order_id` is found to be filled/gone (requires the symbol to *still* appear in `position_by_symbol` that same cycle — i.e., a partial fill scenario, not a full close); (2) immediately after submitting a **non-stop-loss TA exit** (`elif d["action"] in ("SELL","COVER") and not is_stop_loss: ps.clear_position(...)`). Every **stop-loss-type** full exit (swing-low stop, trailing stop, breakeven-after-partial-TP — anything with `is_stop_loss=True`) only calls `ps.set_stop_order()`, never `clear_position()`. Once that exit fully closes the position, the symbol drops out of `position_by_symbol` on the *next* cycle, so the branch that would eventually clear it is never reached again — the stale flags persist forever, waiting to be misapplied to the next unrelated position opened for that symbol (this is what made the LTC/USD 2026-07-17 incident's "breakeven $45.8120" not even match that trade's real entry of $45.9060 — it was carried over from an earlier, unrelated LTC round trip).
- Compared against the dashboard: its static HTML file's Autopilot **already implements the correct behavior** — every cycle it prunes `hwm`/`partialTp`/`entryTime` for any symbol not in `heldSyms` (`Object.keys(hwm).forEach(k => { if (!heldSyms.includes(k)) delete hwm[k]; })`, mirrored for the other two maps). Python had no equivalent pass.

**Fix (`scripts/run_evaluation.py`):** added `prune_stale_position_state(state, open_symbols)` — clears `ps.clear_position()` for every symbol in `state["positions"]` not present in the current cycle's live `open_symbols`. Called once in `main()`, right after the live positions fetch and `open_symbols` list are built (before reconciliation and per-symbol decisions run). Mirrors the dashboard's `heldSyms` prune exactly.

**Verified:** `tests/test_reconcile.py::TestPruneStaleState` (2 new tests: a closed symbol's state is cleared, a still-held symbol's state is untouched). Full suite: 171/171 pass. Also **applied the fix to the live `data/positions_state.json`** directly (ran `prune_stale_position_state` against the real file with the real live position list `["BTC/USD"]`) rather than waiting for the next scheduled run — removed the 8 stale entries (113 lines), leaving only `BTC/USD`.

**Not changed:** did not touch the dashboard — its behavior was already correct and was the reference implementation for this fix.

---

### 2026-07-18 — Bug #6: fee-residue false partial-TP reconciliation caused fast, mostly-losing buy→sell round trips

**Task:** Owner reported "buy orders are followed up with sell orders way too fast, resulting in negative profit most of the trades" and asked for an analysis using the journal + execution history. Per Workflow rule 0 the finding became a bugs-list item and was fixed immediately.

**Investigation:** Spawned the `market-researcher` agent to pull the full live paper-account FIFO fill history (`edgeFetchAllFills()`-style pagination, not a single 100-fill page) and cross-reference every SELL against its stated journal exit reason. Findings, verified directly against the code afterward:

- Of the last 9 SELL decisions logged since 2026-07-11, 8 (89%) were labeled `STOP-LOSS (breakeven after partial TP)` — and every one closed ~99.8–100% of the position, not the 50% scale-out the label implies. The real `should_partial_tp()` path hasn't legitimately fired since 2026-07-10.
- Aggregate live paper P&L: 276 FIFO round trips, 47.8% win rate, profit factor 0.29, **-$6,614.67 realized**.
- Root cause: `reconcile_positions_from_fills()` (`scripts/run_evaluation.py`) rebuilds `partial_tp_done` from Alpaca's own fill history when state is lost, by FIFO-walking BUY/SELL fills and checking `if lot[0] < 1e-6` to decide a lot fully closed. Alpaca paper SELL fills consistently return qty ~0.1–0.25% *smaller* than the matching BUY (fee/precision rounding — confirmed across 15 symbols, e.g. the 2026-07-17 LTC/USD round trip: buy 59.693 @ $45.9060, sell 59.5616754 @ $44.9684, a 0.22% short-fill). That residual is far above the old absolute epsilon, so a fully-closed lot never popped to empty, and the per-symbol `sells_since_start` counter (meant to detect a genuine scale-out) kept incrementing forever across every historical round trip instead of resetting on a real full close.
- Consequence: every brand-new position for a previously-traded symbol saw a stale non-zero `sells_since_start` on its very first post-entry evaluation, triggered `mark_partial_tp()`, and pinned `breakeven_stop = entry` immediately — before any real profit. `eff_stop = max(swing_stop, breakeven)` then picked the tight breakeven price over the intended TA swing-low stop (up to 8% of room), so ordinary volatility took the position out within hours of entry, mislabeled as a "breakeven" exit even when the fill landed materially below entry (spread/band + price drift during the exit's own cycle).

**Fix (`scripts/run_evaluation.py`, `reconcile_positions_from_fills`):** lots now carry their original quantity (`[remaining, price, original_qty]`); the "fully closed" check compares the leftover against `max(1e-9, original_qty * _RECONCILE_DUST_REL_TOL)` (0.5% relative tolerance — 2x the largest observed ~0.25% fee residual) instead of an absolute `1e-6`. A full close now correctly zeroes the lot queue and resets `sells_since_start`/`start_iso`; a genuine ~50% partial sell still leaves well above the dust threshold and is still correctly detected.

**Verified:** Added `tests/test_reconcile.py::TestPartialTpIdempotency::test_fee_mismatched_full_close_not_counted_as_partial`, replaying the exact real LTC/USD figures above — asserts a fresh position after that fee-mismatched full close does NOT reconcile as partial-TP-done. Full suite: `python -m pytest tests/` → 169/169 pass (10/10 in `test_reconcile.py`).

**Not changed (scoped out):** did not add a stricter "sell must be ~`partial_tp_fraction` of position" check on top of the dust fix — the dust fix alone removes the false accumulation that was the confirmed cause; adding fraction-matching now would be speculative hardening without an observed failure mode to justify it.

---

### 2026-07-13 — Bug: Socials tab Twitter/X feeds still not fetched — investigated, confirmed platform limitation, added unit tests (v2026-07-13.2)

**Task:** "rescan roadmap." Per Workflow rule 0 the bugs list took precedence. `git fetch origin main` confirmed the local checkout was already current (no divergence this time — see the `[[Lessons]]` entry below about always checking first).

**Bug as filed:** "In the news section under command center, Twitter aka X feeds are still not fetched. Find a way to get the relevant twitter feeds. Unit test fetching data from twitter." The actual Twitter/X sourcing lives in the **🐦 Socials sub-tab** (not News — News is headlines/RSS only), built 2026-07-09 and last touched 2026-07-10 (v2026-07-10.1: Telegram-mirror-first sourcing + feed-title validation guard).

**Investigation (live, this session):**
- X's own syndication CDN (`cdn.syndication.twimg.com/timeline/profile`) answers with `Access-Control-Allow-Origin: https://platform.twitter.com` — locked to Twitter's own embed widget origin, unusable from any other site regardless of request headers. No keyless direct-X path exists.
- Re-tested **8 public Nitter mirrors** (the full RSS-enabled list from the status.d420.de tracker: xcancel.com, nitter.poast.org, nitter.net, nitter.privacyredirect.com, nitter.tiekoetter.com, lightbrd.com, nuku.trabun.org, nitter.space) through the same `rss2json.com` bridge the dashboard uses — **all 8 are dead**: connection failures, HTTP errors, or (xcancel only) the fake "RSS reader not yet whitelisted!" 200-OK feed that the 2026-07-10 title-verification guard already correctly rejects. This is a **regression from "best-effort, sometimes works"** (2026-07-10 assessment) to **fully non-functional** as of today.
- Re-verified the 4 existing Telegram-mirror accounts (`binance_announcements`, `WatcherGuru`, `whale_alert_io`, `cointelegraph`) via the RSS-Bridge — all 4 still return HTTP 200 with correctly-titled feeds. These remain the only real working source.
- Attempted to expand Telegram-mirror coverage to the other 10 curated accounts by guessing likely official channel usernames (`cz_binance`, `coinbase`, `VitalikButerin`, `saylor`, `justinsuntron`, `BitcoinMagazine`, `APompliano`, `ErikVoorhees`, `novogratz`, `MicroStrategy`, `tron_foundation`) — **every guess 500'd** on the RSS-Bridge (channel doesn't exist under that name). A `WebSearch` for Bitcoin Magazine's Telegram turned up two plausible handles (`Bitcoin_Magazine`, `bitcoinmagazinetelegram`) that both resolve, but neither could be confirmed as *official* against bitcoinmagazine.com's own social links — **not added**, since surfacing an unverified channel as an "official" source on a defensive-input feature is a worse outcome than leaving it out. Individual crypto figures (Elon, Vitalik, CZ, Saylor, Voorhees, Novogratz, Pompliano) do not appear to run official Telegram channels at all — Telegram announcement channels are mostly an org pattern (exchanges, media, projects), not a personal-account pattern.

**Conclusion: this is a confirmed external platform limitation, not a code defect.** There is no keyless, client-side way to fetch X/Twitter content today beyond what's already implemented. No further "fix" is coded — implementing a workaround would mean adding a paid API (X API, or a paid RSS/proxy service), which is a cost/architecture decision for the owner, not something to add silently.

**What was actually delivered this session:**
1. The dashboard's static HTML file: `SOC_NITTER_HOSTS` comment rewritten from "best-effort... rarely yields posts" to state the confirmed-dead status and today's date plainly (so a future session doesn't have to re-derive this from scratch). Socials empty-state copy updated to say the Nitter ecosystem is confirmed dead rather than implying occasional success.
2. **`tests/test_socials_fetch.js`** (new) — a standalone Node test harness (`node:test` + `node:assert` + `node:vm`, no npm dependency, no network) satisfying the "unit test fetching data from twitter" part of the bug. It extracts `socFetchAccount()`, `socCleanText()`, `socToXUrl()`, `socTgFeedUrl()`, and their consts **directly from the live HTML file's source text** (bracket-matching extraction, not a reimplementation) so the test can never silently drift from production behaviour, then runs them against mocked `fetch` responses covering: a successful Telegram-mirror fetch with retweet + media-only-post filtering, the fake-"whitelisted"-feed rejection (regression test for the 2026-07-10 bug — this is the scenario that previously rendered garbage as real tweets), a genuinely-working Nitter mirror (URL rewritten to x.com, `#m` stripped), the crypto-keyword filter for generalist accounts, and total-source-failure error messaging. Run with `node tests/test_socials_fetch.js` — 7/7 pass.
3. Footer bumped to `v2026-07-13.2`.

**Verified:** `node tests/test_socials_fetch.js` (7/7 pass), `node --check` on the extracted inline `<script>` (0 errors), `<div>`/`</div>` balance 535/535 unchanged. Did not start the local dashboard/node server per Workflow rule 2.

---

### 2026-07-13 — Bug: Autopilot stale-entry sweep needed a real 4h floor + Roadmap: Execution tab order filters (v2026-07-13.1)

**Task:** "rescan roadmap." Per Workflow rule 0 the bugs list took precedence, so the stale-entry bug was implemented first, then the Execution-filters roadmap item.

**Important process note — local checkout was ~200 commits behind origin/main.** The local working directory's `git log` showed a HEAD from 2026-06-22, but `git fetch` revealed origin/main had moved on through 2026-07-13 with ~200 commits of scheduled/manual work (autopilot hardening, famous-trader package, news/socials tabs, etc.) that had never been pulled locally. The user had hand-edited the local (stale) `CLAUDE.md` to add the two Roadmap/Bugs items being actioned this session — a reasonable workflow (edit CLAUDE.md, then say "rescan roadmap"), but against a copy of the file that didn't reflect ~3 weeks of upstream history. A first implementation pass was done against that stale base and committed locally; pushing failed (`! [rejected] ... fetch first`), and `git pull --rebase` produced conflicts across every doc + the dashboard. Rather than resolve conflicts blind, the stale local commit was preserved on branch `backup-local-stale-work` and `git reset --hard origin/main` brought the working tree to the real current state, followed by re-reading the current `CLAUDE.md`/dashboard code and re-implementing both fixes against it (this entry describes the real, re-based implementation — the stale first pass never reached origin and can be ignored/deleted).

**Bug — stale-entry sweep could cancel an entry after ~15 minutes.** The Autopilot's stale-entry sweep (added 2026-07-08, the dashboard's static HTML file, inside `apCycle()`) gated cancellation of unfilled, Autopilot-tagged (`client_order_id` starting `ap-`) entry limit orders on the `orderAge` cycle counter: `if (... || orderAge[o.id] <= 1) continue;` — meaning an order was eligible for cancellation as soon as it had survived past its 2nd cycle. At the fastest Autopilot interval (15 min) that could fire in as little as ~15–30 minutes, not a fair chance for a limit order to fill.

**Fix:**
- `config.json › risk`: added `"min_stale_entry_age_hours": 4`.
- The dashboard's static HTML file: `STRAT_CFG` gained `minStaleEntryAgeHours: 4` (seeded from the new config key via `seedStrategyConfig()`, same pattern as every other `STRAT_CFG` threshold). The sweep's entry-cancellation condition now computes `ageMs = Date.now() - new Date(o.created_at).getTime()` and only cancels once `ageMs >= STRAT_CFG.minStaleEntryAgeHours * 3600000` — real wall-clock time instead of the cycle counter. The `orderAge` map itself, and its use for the separate exit-order cancel-replace escalation (2 cycles, protects an unprotected position — intentionally fast, left unchanged), were not touched.

**Roadmap — Execution tab order filters.** Added a filter bar above the 🎯 Execution tab's Recent Orders table: Symbol / Type / Side / Status `<select>` controls plus a Reset button and a "Showing X of Y orders" counter.
- HTML: 4 `<select>` filters + Reset button inserted above the existing orders table (which already had a Total (USD) column from the 2026-07-09 roadmap work).
- JS: `_lastExecutionCtx` caches the last-loaded context so filtering never refetches. `populateExecutionFilters(orders)` fills the Symbol/Type/Status dropdowns from the distinct values actually present in the loaded orders (Side is static Buy/Sell), preserving the current selection across refreshes. `applyExecutionFilters()` filters `c.allOrders` by the four criteria and re-renders `executionOrdersBody` (row markup unchanged, including the Total column). `resetExecutionFilters()` clears all four back to "All". `renderExecution(c)` now stores `c` and calls `populateExecutionFilters` + `applyExecutionFilters` instead of rendering the full unfiltered list directly.

**Verified:** extracted the largest inline `<script>` from the real (post-reset) dashboard and ran `node --check` (0 syntax errors) after both changes. Checked `<div>`/`</div>` balance for the `page-execution` block (7/7) and the whole document (535/535). `python -c "import json; json.load(...)"` on the `config.json` edit. Did not start the local dashboard/node server per Workflow rule 2 — verification was static (syntax + markup balance + JSON validity), not a live browser check. `pytest` was unavailable in this shell (no module found) so the Python suite wasn't re-run — the change is dashboard/config-only and no Python code reads the new `min_stale_entry_age_hours` key yet.

**Docs:** CLAUDE.md's Autopilot row updated (stale-order lifecycle description) and a new 🎯 Execution tab row added to the dashboard feature table; Roadmap/Bugs sections were already empty on the real `CLAUDE.md` (both items existed only as the user's uncommitted local edit against the stale checkout, never as committed content) so nothing needed clearing. README.md gained an Execution-tab-filters bullet and an updated Autopilot-hardening bullet. `memory/glossary.md` gained a `2026-07-13` terms section. `docs/dashboard_layout.md` Command + Execution rows updated and a changelog row added. Footer bumped to `2026-07-13` / `v2026-07-13.1`.

### 2026-07-10 — Rescan roadmap: famous-trader package, all 10 audit items + item 11 v2 (v2026-07-10.3)

**Task:** rescan roadmap (second pass of the day). Bugs list empty; implemented all 10 audit items plus the owner's re-added item 11 v2. **Deployment posture:** entry-affecting features ship config-flagged **OFF** pending walk-forward validation (`strategy.pyramid_enabled`, `risk.trail_mode`, `strategy.conviction_sizing_enabled`, `strategy.measured_move_enabled`, `strategy.breadth_gate_enabled`, `costs.maker_first_entries`); defensive machinery is ON (streak throttle, stop watchdog, session filter, baseline staleness warning).

**risk.py** — third-stage config loader `_load_risk_cfg3()` (20 new keys) + pure helpers: `chandelier_trail_pct()` (item 2 — max(fixed 3%, k×ATR4H/price)), `conviction_risk_multiplier()` (item 3 — 0.75/1.0/1.5× by score band, 1.5× requires daily+4H alignment), `update_streak_throttle()` + `consecutive_losses/wins_tail()` + `rolling_drawdown_pct()` (item 4 — trigger: 3 straight losing round-trips OR 7-day DD ≥ 5%; release: 2 straight winners AND DD < 2.5% — conservative hysteresis, stricter than the spec's "or", deliberate), `measured_move_target()` (item 5 — prior 4H swing high, else entry + 2× range height), `pyramid_trigger_price()`/`should_pyramid()` (item 1 — +1R/+2R tranches, ADX ≥ 25, score ≥ full gate), `breadth_pct()`/`breadth_policy()` (item 10 — ≤30% uptrend breadth → Tier-1 only + budget halved). `check_limit_band()` gained a `bid` param: any limit inside the live spread is accepted (maker-safe, item 6); `trade.py` passes the bid.

**run_evaluation.py** — one shared fills fetch feeds reconciliation + session filter + throttle (`_fifo_round_trips()` extracted; `_compute_session_penalty()` refactored to consume it); `_seven_day_drawdown()` reads `/v2/account/portfolio/history`; `_THROTTLE_ACTIVE` module flag persists as `streak_throttle_active` in the state file and halves entry risk with a journal warning. `compute_entry_qty()` gained `risk_mult` (hard cap never scaled). Entry path: conviction multiplier (skips the legacy ×0.5 half-band halving when enabled), measured-move target feeding `net_rr` when ADX ≥ 25, maker-first limit at the bid + a 1-cycle stale-entry-BUY sweep (only when the flag is on — it cancels non-position BUY limits; caveat for manual orders documented). Held-long path: trend/chop mode split (pyramid enabled + ADX ≥ `pyramid_adx_min` → pyramiding replaces the partial-TP ladder), pyramid adds sized at half risk × throttle, capped by remaining symbol-cap headroom, executed as BUY with `is_pyramid` → `ps.mark_pyramid_add()` (never `init_position`, which would reset HWM/entry clock) + breakeven stop; chandelier trail width when `trail_mode="chandelier"`; the breakeven eff-stop now reads `breakeven_stop` unconditionally (set only by partial-TP/pyramid flows — behavior identical for existing states). Post-pass breadth gate demotes non-Tier-1 new-entry BUYs with a journal warning.

**position_state.py** — `pyramid_tranches` per position, `streak_throttle_active` top-level, `mark_pyramid_add()`.

**Item 7 — `scripts/stop_watchdog.py` + `.github/workflows/watchdog.yml`** (cron `*/5 * * * *`, same concurrency group as the bot, `pip install requests` only — the import chain is pure-Python + requests): checks ONLY open-long exits (trailing from the state HWM — the watchdog never ratchets the HWM, that stays the hourly engine's job; max(swing-low, breakeven); fixed −5% fallback; chandelier-aware), dedups against any pending SELL, orders via `trade.py` (`is_stop_loss=True`), records `set_stop_order` so the hourly dedup/escalation sees it, journals + commits **only when a stop fires** (quiet runs = zero repo churn). Note: GH cron is best-effort (5–15 min real cadence) and ~288 runs/day consumes Actions minutes on private repos.

**Item 8** — `forward.yml` fee corrected 5 → 25 bps (it was silently overstating edge; the daily reports were NOT stale — the audit's 2026-05-14 claim was outdated, reports land daily via forward.yml); `write_reports()` now also writes the stable-named compact `reports/walkforward_latest.json`; dashboard Backtest tab gained `#wfBaseline` + `loadWalkforwardBaseline()` (fetches `../reports/walkforward_latest.json`, shows date/fees/avg-Sharpe per TF, red when older than `walkforward.max_baseline_age_days` 45, seeded into `STRAT_CFG.wfMaxAgeDays`). The fresh 25-bps baseline could not run locally (32-bit Python — no pandas wheel); it lands with the next forward.yml run (daily 04:08 UTC, or manual dispatch).

**Item 9** — `strategy.session_filter_enabled` → **true** (config + dashboard STRAT_CFG default). Safe by construction: a bucket needs ≥ `session_min_sample` (20) round trips AND negative net P&L before any penalty, so with thin history the filter is a no-op that arms itself as data accumulates.

**Item 11 v2 (dashboard, v2026-07-10.3)** — the owner re-added item 11 with sharper wording: controls above the **trade-permission indicator** (the big status word), not just above the permission panel (the v2026-07-10.2 reading). The control row (`#apToggleBtn`, `#apInterval`, kill switch, `#apStatus`) now sits at the very top of Command › Overview above `#tradingStatus`; the permission grid returned to its original spot; the 🤖 Autopilot panel at the bottom keeps only the description + activity log. Element IDs unchanged → zero JS changes. Verified: JS parse, unique IDs, DOM order buttons < status < permissions < log, div-balance parity with HEAD.

**Verified:** 168 pytest tests pass (27 new in `tests/test_risk_roadmap.py`: chandelier, conviction bands, throttle state machine incl. hysteresis, rolling DD, measured move, pyramid triggers +1R/+2R/max-tranches/gates, breadth pct+policy, maker-safe band); `python scripts/risk.py` self-checks pass; module-import smoke test confirms flag states (throttle ON, session ON, pyramid OFF, trail fixed); dashboard `new Function()` parse OK. Docs updated ×5. Footer → v2026-07-10.3.

### 2026-07-10 — Rescan roadmap: all 5 audit bugs fixed + roadmap item 11 (v2026-07-10.2)

**Task:** rescan roadmap. Per workflow rule 0 the 5 bugs from the same-day profit-maximization audit took preference; roadmap item 11 (the only item with no dependencies) shipped alongside. Roadmap items 1–10 remain open — now unblocked, but each needs walk-forward validation before enabling.

**Bug #1 (P0 — state never persisted).** Root cause confirmed in `.github/workflows/trade.yml`: the commit step ran `git add journal/` only, so `data/positions_state.json` was never committed and every fresh Actions checkout reset it to the 2026-06-18 copy (frozen `day_open_date=2026-06-11`). Two-part fix: (a) both workflow jobs now `git add journal/ data/positions_state.json`; (b) defense in depth — new `reconcile_positions_from_fills()` in `run_evaluation.py` rebuilds lost per-position facts from Alpaca's own FILL history (FIFO walk per symbol): any SELL since the position's last flat→long transition restores `partial_tp_done` + breakeven stop (idempotency — the AAVE 6×-re-fire can never happen again even if the file is lost), `entry_time_iso` is backfilled from the transition (stale-exit clock), and `entry_price` is seeded. Runs only when something is missing/corrupt; one paginated fills fetch.

**Bug #2 (P1 — 4H bars short).** Root-caused live: Alpaca now caps a single bars response at ~7 days regardless of `limit` and returns `next_page_token` (probe: 4Hour limit=120 → 43 bars; 1Hour limit=480 → 169 — exactly the journal symptoms, and why the 1H fallback also failed). `get_crypto_bars` now follows `next_page_token` (≤10 pages) until `limit` bars are collected, then slices newest-`limit` and reverses to chronological. Verified live post-fix: 4Hour → 120 bars, 1Hour → 480, 1Day → 90, chronological order intact.

**Bug #3 (P1 — corrupt cost basis).** Guarded in the same reconciliation: when the API `avg_entry_price` ≤ 0 (SOL `$-4.4931` case — Alpaca after repeated partial sells), it is replaced with the FIFO-derived weighted average of the still-open lots and a `DATA GUARD` warning is journaled. All downstream logic (stops, partial TP, stale exit, P&L%) inherits the corrected basis.

**Bug #4 (P1 — cadence).** The cron was `7 */4 * * *` (every 4 hours — matches the observed 5–7 evals/day), not hourly. Fixed to `23 * * * *` (+ the schedule-match `if` condition). Cadence self-monitoring: `run_evaluation` stores `last_evaluation_iso` in the state file (new key, also in `_EMPTY_STATE`) and journals a `CADENCE WARNING` when the gap exceeds 90 minutes. The 23:21 job previously ran a second evaluation (why "daily summary" commits had no P&L); it now runs the new `scripts/daily_summary.py`, which appends a `## Daily Summary HH:MM GMT+2` block: equity + day change vs `last_equity`, cash %, open positions with unrealized P&L, today's fills (GMT+2), and FIFO realized P&L for round trips closed today (same matching rule as the dashboard Edge/P&L tabs — unmatched SELLs excluded).

**Bug #5 (P2 — budget config).** `risk.max_open_positions` 15 → **7** (the reachable ceiling: Tier-1 holds only BTC+ETH, so 2 + 5-per-tier caps the book at 7); `max_positions_per_tier` stays 5. Dashboard `DEFAULT_LIMITS` fallback aligned 4/3 → 7/5. CLAUDE.md hard-rules row updated (saved Settings in `localStorage` still win over defaults, unchanged).

**Roadmap item 11 (dashboard, v2026-07-10.2):** the 🤖 Autopilot panel `<section>` (toggle, interval, ⛔ kill switch, activity log) moved above the 🚦 Trading Permission Rules / 📌 Hard Rules `grid-2` section in the Command › Overview sub-tab — controls always in sight, log at the bottom of the panel as before. Pure block move; div balance verified identical to git HEAD (27/28 with the same slice bounds), JS parses (node `new Function`), footer bumped to v2026-07-10.2.

**Verified:** 141 pytest tests pass (11 new: `tests/test_reconcile.py` — partial-TP idempotency incl. no-refetch when state is intact, entry-price guard, entry-clock backfill, shorts ignored, daily-summary FIFO; `tests/test_bars_fetch.py` — pagination follows the token, stops at `limit`); `py_compile` clean; live probes of the paginated fetch (above). Local `.env` has no Alpaca keys (they exist only as GitHub secrets), so trading-API paths were verified via the mocked tests; the market-data path was verified live keyless. Docs updated: CLAUDE.md (Bugs cleared per rule 3, roadmap preamble + item 11 removed, correlation-budget row, responsibilities/cadence, Command row), README.md (Roadmap + key features), glossary.md, dashboard_layout.md.

### 2026-07-10 — Profit-maximization audit: 10 roadmap items + 5 bugs filed (no code changes)

**Task (owner):** analyse structure, strategies and profits; mimic famous traders' behaviours; file improvements to the Roadmap and faulty parts to Bugs *before* implementing.

**Audit findings (evidence in journals/git):**
- **P0 bug — position state never persists between runs.** `data/positions_state.json` frozen at `day_open_date=2026-06-11` (last committed 2026-06-18) while journals commit every evaluation. Behavioral proof: AAVE/USD's +1R partial TP re-fired on 6 consecutive evaluations (2026-07-09 15:29 → 2026-07-10 07:46), each selling "50%" of the remainder (6.54 → 0.05 AAVE) — the flag `partial_tp_done` is read from a state file that resets every run. Also silently broken: trailing-stop HWM persistence, breakeven stops, stale-exit entry clocks, daily-drawdown gate (compares to 2026-06-11's $95,428). Code itself is correct (`run_evaluation.py` calls `ps.mark_partial_tp`/`ps.save_state`); the runner's git sync likely discards/never commits the file.
- **P1 — 4H bars chronically short** (43–50 < 51 required) for BTC/ADA/AAVE with the 1H fallback also failing → Signal 6 = 0 and stops degraded to fixed −5% on the highest-cap symbols.
- **P1 — corrupt cost basis** in journal output: `SOL/USD HOLD 29.5132 @ $-4.4931 (-1842.96%)`.
- **P1 — cadence gap:** no hourly `Research` blocks since 2026-05-21; only 5–7 evaluations/day instead of 24; the 23:21 closing journal writes no P&L summary.
- **P2 — config inconsistency:** `risk.max_open_positions=15` unreachable with `max_positions_per_tier=5` (2 Tier-1 symbols → ceiling 7); CLAUDE.md hard-rules table still says 4/3.
- Walk-forward baseline stale (2026-05-14, pre-dates the 2026-06-19 loosening and the 2026-07-09 economics package).

**Roadmap filed (CLAUDE.md › Roadmap, 10 items):** (1) pyramid into winners in strong 4H trends (Livermore/Turtle 2N adds/Druckenmiller; mutually exclusive with the partial-TP ladder per position, trend vs chop by ADX 25); (2) Chandelier ATR-adaptive trail (Turtles); (3) conviction-scaled sizing 0.75/1.0/1.5% by score (Druckenmiller/PTJ); (4) losing-streak + 7-day-drawdown throttle (PTJ); (5) trend-based measured-move targets + walk-forward test `min_rr_full` 1.5→2.0 (PTJ asymmetry); (6) maker-first entry pricing (cut ~50 bps round trip); (7) 5-min stop-loss watchdog script; (8) monthly walk-forward re-baseline + dashboard staleness warning; (9) enable session-edge filter once sampled; (10) portfolio breadth/regime gate (Weinstein). Items 1–5 depend on Bugs #1/#4 being fixed first — noted in the roadmap preamble.

**Docs updated:** CLAUDE.md (Roadmap + Bugs), README.md (Roadmap section), this file, glossary.md (new terms). No code changed; no dashboard change (dashboard_layout.md untouched per its rule). **Process note:** the file-tool truncation bug hit CLAUDE.md during the edit (70,870 → truncated mid-file at identical byte count); recovered by splicing HEAD + new sections via python in bash — lesson added above.

### 2026-07-10 — Bugfix: Socials sub-tab "RSS reader not yet whitelisted!" (v2026-07-10.1)

**Bug (CLAUDE.md › Bugs #1):** the Socials tab couldn't load tweets and surfaced the error "RSS reader not yet whitelisted!". **Root cause (two-part, verified live with curl):** (1) xcancel.com answers `/rss` with **HTTP 200 and a fake feed whose title/content is the whitelist error** (they UA-whitelist RSS readers; rss2json's fetcher isn't on the list) — that passed `socFetchAccount()`'s old `j.status === "ok" && items.length` check, so the error text rendered as if it were tweets; (2) every other RSS-enabled public Nitter instance (all 5 per the status.d420.de tracker: nitter.net, xcancel, poast, privacyredirect, nt.vern.cc) is bot-walled (Anubis/go-away/Cloudflare) or UA-whitelisted → "Cannot download this RSS feed" through rss2json. Alternatives probed and dead: fxtwitter has **no timeline endpoint** (404; user endpoint carries no tweet text), openrss.org → 401, twiiit redirector → dead, allorigins → timeout. **What does work (verified live):** the public **RSS-Bridge TelegramBridge** (`rss-bridge.org/bridge01`) turns `t.me/s/<channel>` into Atom that rss2json reads fine.

**Fix (the dashboard's static HTML file):** (a) **feed-title validation** — `socFetchAccount()` now requires the account handle in the feed title (Nitter: `Name / @handle`; TelegramBridge: `Name (@channel) - Telegram`) and rejects anything else ("mirror blocks RSS readers" for whitelist pages), so error feeds can never render as posts; (b) **official-Telegram-mirror-first sourcing** — new `tg:` field on `SOC_ACCOUNTS` (binance=`binance_announcements`, WatcherGuru=`WatcherGuru`, whale_alert=`whale_alert_io`, Cointelegraph=`cointelegraph`; channels confirmed live), new `socTgFeedUrl()` builds the bridge URL, tried before the Nitter mirrors; TG posts link to `t.me` and are marked **TG** (item source + chip suffix via new `_socAcctVia`); media-only TG posts (`Please open Telegram…`) skipped; (c) `SOC_NITTER_HOSTS` trimmed to xcancel + poast (≤2 failing calls/account keeps rss2json's rate limit safe); (d) honest copy: sub-tab description, empty-state, and status line now say posts come from Telegram mirrors and X blocks keyless readers. Footer bumped to v2026-07-10.1.

**Verified:** node syntax parse of the inline script (OK) + live functional test of the exact new fetch logic in Node: whale_alert → 8 posts via TG (real t.me links/timestamps), Cointelegraph → 8 via TG, saylor (no TG) → rejected cleanly with no whitelist text leaking into items. Docs updated: CLAUDE.md (bug cleared per rule 3, Socials feature row), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Command › 🐦 Socials sub-tab (v2026-07-09.6)

**Roadmap item:** "Add a Socials tab to the Command center. This tab show Crypto tweets and stats from accounts with more than 0.5 million followers." *(the follower gate was edited from 1M → 0.5M in CLAUDE.md before implementation; the on-disk 0.5M value was honored)*

**Change (the dashboard's static HTML file):** third Command sub-tab (`COMMAND_SUBS = ["command-overview","news","socials"]`, deep link `#socials`). **Problem:** X/Twitter has no keyless API and blocks CORS. Source research during implementation: rss2json × 4 Nitter mirrors → all 500; direct mirror probes → only xcancel.com serves RSS but answers "RSS reader not yet whitelisted!"; allorigins bridge → 520; Twitter syndication endpoint → 429 + no CORS; openrss.org → 401; sotwe API → 403 Cloudflare. **The only keyless CORS-open X endpoint found working is the fxtwitter API** (`api.fxtwitter.com/<handle>`, `Access-Control-Allow-Origin: *`, live follower/tweet counts — verified live, WatcherGuru 4.43M followers). **Design — split the job:** *stats live* via `socFetchStats()` (fxtwitter; static `followersM` snapshots only as render fallback, marked `*` in the chip), *tweet text best-effort* via Nitter-mirror RSS through the same `api.rss2json.com` bridge as News (`socFetchAccount()` tries `SOC_NITTER_HOSTS` xcancel.com → nitter.poast.org → nitter.privacyredirect.com → lightbrd.com; mirrors come and go — all four down at ship time, the empty state says so and the stats half still works). `loadSocials(force)` fetches timelines + stats in parallel `Promise.allSettled`; dead accounts show a red ✕ chip, never a blank tab. The **>0.5M-follower gate is enforced by curation**: `SOC_ACCOUNTS` (14 accounts — elonmusk, binance, cz_binance, coinbase, VitalikButerin, saylor, justinsuntron, WatcherGuru, whale_alert, BitcoinMagazine, Cointelegraph, APompliano, ErikVoorhees, novogratz). **Retweets skipped** (`RT by` title prefix); generalist accounts (`general:true` — elonmusk) filtered to crypto-keyword tweets via `SOC_CRYPTO_RE`. Caps: 8 tweets/account, 60 total, 10-min cache (↻ forces). "Stats" = per-account chips (`#socAccts`: @handle · live followers · tweets fetched, red ✕ when timeline unreachable) + a status line with reachable-timeline count, live-stats coverage, combined reach in M followers, and key-tweet count. Renderer reuses the News family: `newsCatalystTier()` T1/T2 badges, `newsDetectCoins()` coin chips, All/⚡ Key-only filter (`socSetFilter()`), `.news-item` CSS; new CSS is only `.soc-acct/.soc-dead/.soc-followers`. Tweet links rewritten from the mirror to `x.com` (`socToXUrl()`). Analysis-only — never places orders; social flow is a defensive input only per the crypto-catalysts skill. Footer bumped to v2026-07-09.6. *(Note: the roadmap item's follower gate was edited 1M → 0.5M in CLAUDE.md before this run; the on-disk 0.5M was honored.)*

**Verified:** node syntax parse of the inline script (1 block, OK), page-command div balance 45/45, presence check of all new symbols, and live endpoint tests (fxtwitter 200 + ACAO:* with real follower counts; every tweet-mirror path probed and documented above). Docs updated: CLAUDE.md (roadmap cleared per rule 3, Command row + new feature-table row), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Command › 📰 News sub-tab (v2026-07-09.5)

**Roadmap item:** "Add a news tab to the command center page. There you will list the latest crypto news you deem important for the trader. Use famous crypto news sources and prevent duplicate news items when using multiples sources."

**Change (the dashboard's static HTML file):** the 🧭 Command tab became the third parent tab with sub-tabs (`COMMAND_SUBS = ["command-overview","news"]`): the original command center is now the **Overview** sub-page (`subpage-command-overview`, unchanged content) and a new **📰 News** sub-page aggregates headlines from **4 sources** — the **Alpaca News API** (`/v1beta1/news`, Benzinga, watchlist symbols, existing keys; skipped gracefully when keys are absent) plus **CoinDesk / Cointelegraph / Decrypt RSS** through the keyless `api.rss2json.com` bridge (`Access-Control-Allow-Origin: *`). *Why rss2json:* direct RSS fetches are CORS-blocked in a browser, and both the CryptoCompare and CoinGecko news APIs now return 401/10005 "API key required" (verified via curl during implementation). `loadNews(force)` uses `Promise.allSettled` so one dead source never blanks the tab (per-source errors go to the status line), merges, **dedupes by normalized headline** (`newsNormTitle()` — lowercase, punctuation stripped, first 80 chars) **+ URL**, keeps the newest 40, caches 5 min (↻ Refresh forces). "Important for the trader" = **T1/T2 catalyst badges** (`newsCatalystTier()`, keyword ladders aligned with `skills/crypto-catalysts`: T1 structural — hack/exploit/depeg/delist/enforcement/halt/insolvency; T2 flow — ETF/unlock/halving/listing/treasury buys/Fed/FOMC/CPI/rates) plus an **⚡ Key only** filter; base-ticker chips via `newsDetectCoins()` (case-sensitive ticker + any-case coin name — bare-`Sol`-in-"GPT-5.6 Sol" false positive caught and fixed during testing). Sub-tab plumbing refactored once instead of a third copy-paste: `subParentOf(id)`/`subTabFnOf(parent)` now drive the redirects in `switchTab()` and `applyTabFromUrl()`; deep links `#news` / `#command-overview` work like the Market/Analytics ones. New CSS: `.news-item/.news-time/.news-badge/.news-t1/.news-t2/.news-src/.news-syms/.news-filter-btn`. Footer bumped to v2026-07-09.5.

**Verified:** node syntax parse of the inline script (OK), div balance of the page-command region (37/37), live end-to-end run of the extracted news module against the real feeds (30 items fetched, deduped, 3 correct T1/T2 badges incl. a USDT-delisting T1 and a BTC-ETF-outflows T2), rss2json CORS header confirmed with an `Origin` GET. Docs updated: CLAUDE.md (roadmap cleared per rule 3, nav + feature-table rows), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Execution order table Total column (v2026-07-09.4)

**Roadmap item:** "Add total amount in currency to the order table in the Execution page."

**Change (the dashboard's static HTML file):** the 🎯 Execution › Recent Orders table gains a sortable **Total** column (after Avg Fill) showing each order's USD value: `filled_qty × filled_avg_price` for (partially) filled orders, else `qty × limit_price` for unfilled limit orders, else the order's `notional` field; "–" when none is available. Rendered as `$X,XXX.XX` via the existing `fmt()` helper in `renderExecution()`. The empty-state placeholder colspan went 9 → 10. Sorting needs no extra wiring — `enhanceTables()`/`sortTable()` are generic per-column and `parseCellValue()` strips the `$`/commas. Footer bumped to v2026-07-09.4.

**Verified:** node parse of the dashboard inline script (1 block, syntax OK). Docs updated: CLAUDE.md (roadmap cleared per workflow rule 3), README.md (Key features bullet), glossary.md, dashboard_layout.md (Execution row + changelog).

### 2026-07-09 — Rescan roadmap: canonical symbol notation BASE/QUOTE everywhere (v2026-07-09.3)

**Roadmap item (owner):** "different notations for symbols … bad design practice. Always use a consistent format throughout this project like e.g BTC/USD or BTC/USDT." Audit found (a) four duplicated local `'BTCUSD' → 'BTC/USD'` converters on the Python side and (b) dashboard surfaces still labelling symbols with the bare base (`BTC`) while tables showed the full pair.

**Canonical rule (now in CLAUDE.md › "Symbol notation (canonical)"):** the slash pair `BASE/QUOTE` (`BTC/USD`) is the one notation for config, journals, logs, state files, and every display label. Alpaca's no-slash form (`BTCUSD`) exists only at the API boundary (positions/orders/activities responses, order payloads, bars/snapshot keys).

**Python (DRY consolidation):**
- New `scripts/symbols.py` — single `to_slash()` converter, USDT/USDC/USD quotes longest-match-first (mirrors the dashboard's `toSlash()`; the old duplicates only handled `USD`, so `BTCUSDT` passed through unnormalised). Self-checks under `__main__`.
- `rebalance.py` (module-level `_to_slash` removed), `run_evaluation.py` (nested `_to_slash` removed), `trade.py` (nested `_slash` in `get_open_orders` removed), `scout.py` (inline bare-symbol block replaced) — all now `from symbols import to_slash`. Behavior-preserving: scout still drops non-`/USD` quotes; both symbol forms are still indexed in `pos_by_symbol`.
- New `tests/test_symbols.py` (10 parametrized cases incl. USDT/USDC, stablecoin base `USDTUSD`, unknown quote, empty input).

**Dashboard (its static HTML file, v2026-07-09.3):** bare-base display labels → full pair: Command-tab 🔭 Scout chip (`tvLink(s)` instead of `tvLink(s, baseTicker(s))`), live ticker strip items, Market Overview "Best/Worst 24h" KPIs, Market Overview momentum-heatmap tiles, and Market Overview Buy/Sell button tooltips. **Documented exemptions (functional, not labels):** `baseTicker()` remains for news-site URL slugs (CryptoPanic/CoinGecko need the base), the space-capped 10×10 correlation-matrix axis ticks, and the `symbolInfo()` asset-*name* fallback — each now carries an explanatory comment, and the `baseTicker()` doc-comment states it is not for symbol labels. Footer bumped to v2026-07-09.3.

**Verified:** pytest 120 → **130 passed**; `python scripts/symbols.py` self-checks pass; `py_compile` clean on all five touched scripts; node parse of the dashboard inline script (1 block, 0 errors, `</html>` intact). Docs updated: CLAUDE.md (roadmap cleared → new canonical-notation section), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan bugs: Scanner duplicate-symbol fix — USD-only scan universe (v2026-07-09.2)

**Bug (owner-reported, CLAUDE.md Bugs #1):** the Market › Scanner results table listed the same symbol up to three times — once per quote currency (BTC/USD, BTC/USDT, BTC/USDC) — because the 2026-06-19 roadmap broadened `ALLOWED_QUOTES` to USDT/USDC and the symbol cell showed only the base ticker (`baseTicker()` → "BTC"), making the rows look like exact duplicates. Alpaca executes trades against USD, so the non-USD rows were noise on a trading surface.

**Fix (the dashboard's static HTML file):**

- New `usdPairsOnly(universe)` helper next to `getCryptoUniverse()` — filters to symbols ending `/USD`.
- `loadMarketSignals()` (Scanner) and `loadMarketOverview()` now slice from `usdPairsOnly(await getCryptoUniverse())`, so each base appears exactly once and the "tradable USD pairs" capped-scan notes are accurate again.
- `updateScanBtnLabel()` clamps against the USD-only count instead of the full mixed-quote universe length.
- Symbol cells in the Scanner table (normal + error rows), the Top Opportunities panel, and the Market Overview table now render `tvLink(row.sym)` (full pair, e.g. `BTC/USD`) instead of the bare base — per the owner's request to show the quote in the symbol.
- Scope deliberately narrow: the full USD/USDT/USDC universe is unchanged and still feeds the Settings watchlist selector dropdown (`populateWatchlistOptions()`), which was a deliberate 2026-06-19 feature. Only the two scan surfaces filter.

**Verified:** all inline `<script>` blocks parse clean via `new Function` under node (2 blocks, 0 errors). Footer bumped to v2026-07-09.2. Docs updated: CLAUDE.md (bug closed, Scanner/Market Overview/Settings rows corrected), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: all 8 trader-effectiveness items implemented (v2026-07-09.1)

"Rescan roadmap" → implemented every candidate from the same-day analysis, across the Python engine AND the dashboard Autopilot (both engines stay in parity — new consistency-checklist item 15). Roadmap cleared per workflow rule 3.

**Config (`config.json`):** new `costs` section (`taker_fee_bps_per_side: 25`); `strategy` gains `rotation_enabled/rotation_min_score/rotation_score_margin`, `min_rr_full/min_rr_half`, `session_filter_enabled/session_min_sample`; `risk` gains `enforce_budget_on_open_positions`, `max_hold_hours: 48`, `partial_tp_enabled/partial_tp_r_multiple/partial_tp_fraction`. (Owner separately raised `risk.max_open_positions` 4 → 15 mid-session — all new code reads it live from config.)

**Python:**
- `risk.py` — second config loader `_load_risk_cfg2()` (keeps the original 17-tuple untouched) + pure helpers: `spread_pct`, `round_trip_cost_pct` (2×fee + spread), `net_rr` (cost subtracted from the reward leg), `partial_tp_trigger_price`/`should_partial_tp`, `position_age_hours`/`is_stale_position`, `rotation_allows`. Self-checks extended; correlation-budget self-checks now pass explicit caps (they asserted the old 4-position default and broke when the owner set 15 — config-independent now).
- `position_state.py` — `_EMPTY_POSITION` gains `entry_time_iso`, `partial_tp_done`, `breakeven_stop`; `init_position()` stamps entry time; new `mark_partial_tp()`.
- `run_evaluation.py` — (item 6) 4H fallback: `aggregate_bars_to_4h()` builds synthetic 4H bars from a `1Hour` fetch when the native 4H series is < 51 bars; explicit `DATA-QUALITY WARNING` journal line when even that fails, `regime_4h` notes "(synthetic 4H from 1H)". (item 4) partial TP fires between the trailing stop and the hard stop; the hard stop then uses `max(swing_stop, breakeven)`; executed-order handler calls `mark_partial_tp` (a partial SELL no longer clears position state). (item 5) stale exit after the TA-sell check. (items 1+7) net-R:R soft gate on new entries (`net_rr < 1.0` block, `< 1.5` half-size; journal line shows `net_rr=`). (item 8) session-edge filter — paginated FILL history, FIFO round trips, GMT+2 exit-hour/weekday buckets, ≥ 20 samples + negative P&L → half-size (OFF via config). (item 2) `apply_rotation()` post-evaluation pass: budget-blocked candidate ≥ 4.0 replaces the weakest HOLD holding (score ≤ 0, margin ≥ 2.0, tier budget re-checked after removal, R:R gate applied); one per cycle; SELLs sorted before BUYs in the execute loop. (item 3) `BUDGET EXCEEDED n/m` console + journal warning; optional weakest-overflow trim behind `enforce_budget_on_open_positions`. `evaluate_symbol`'s `_compute_qty` extracted to module-level `compute_entry_qty()` for reuse.
- `walkforward_evaluate.py` — (item 1d) `fee_bps` default 0 → 25 (dataclass, `default_sim_config()` from `config.json › costs`, and the `--fee-bps` CLI default).

**Dashboard (its static HTML file, v2026-07-09.1):**
- `STRAT_CFG` gains the 11 new keys (fee bps, R:R gates, rotation, max-hold, partial-TP, session filter); `seedStrategyConfig()` seeds them from `config.json › strategy/risk/costs`. New shared helpers `roundTripCostPct()`, `netRrPct()`, `aggregate1hTo4h()`, `fill4hFallback()` (JS ports of the Python functions — verified value-for-value against risk.py with a standalone node test).
- Signals tab: new **Spread** column (snapshot `latestQuote`, red > 0.3%), R:R column is now **net-of-cost** (tooltip shows gross + cost breakdown; thresholds from `minRrHalf/minRrFull`), ⚠ marker in the 4H Regime cell (yellow = synthetic 4H, red = degraded). Table 16 → 17 columns; all placeholder/error colspans updated. `_signalRrMap` entries carry `{rr, grossRr, costPct}`; trade modal `#tradeRrInfo` shows net + gross + cost.
- Scalping tab: **Spread** + **Cost Check** columns (viability gate: target distance < 2× round-trip cost → red "⚠ costly", else "✓ viable"; flag not block). 10 → 12 columns.
- Autopilot `apCycle()`: 4H fallback before scoring (log lines for synthetic/degraded); partial-TP ladder (+1R sell `partialTpFraction`, breakeven stored in `localStorage.autopilotPartialTp`, merged from the Python file's `partial_tp_done/breakeven_stop`); effective stop = max(swing low, breakeven) when not trail-armed; stale exit from `localStorage.autopilotEntryTime` (entry stamped at BUY, merged from file `entry_time_iso`); rotation at a full budget (sell weakest ≤ 0 scoring holding when candidate ≥ 4.0 leads by ≥ 2.0, budget counters updated, then entry proceeds); net-R:R soft gate + half-size note; session filter via `apSessionPenaltyActive()` (reuses `edgeFetchAllFills`/`edgeFifoTrades`, 6h cache, OFF by default). Both new maps pruned to held symbols and re-persisted after entries.
- Command tab: red **⚠ BUDGET EXCEEDED n/m** chip (`#budgetChip`, `renderBudgetChip()`) under the scout chip when open positions exceed the Settings budget.

**Verified:** pytest 95 → **120 passed** (25 new tests: trade economics, partial TP, stale exit, rotation, 1H→4H aggregation incl. partial-bucket drop); `python scripts/risk.py` self-checks pass; `vm.Script` parse of the dashboard inline script (1 block, 0 errors, `</html>` intact); node parity test of the JS helpers against the Python values. Dry-run `run_evaluation.py` starts clean (positions fetch needs live credentials not present in the sandbox shell). Docs updated: CLAUDE.md (roadmap cleared, hard-rules table +5 rows, exit strategy, dashboard rows, checklist items 14/15), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Trader-effectiveness analysis → 8 new roadmap candidates (docs-only, no code change)

Owner asked for a professional-trader review of the dashboard + trading rules (scalping and longer-term) with improvements added to the CLAUDE.md roadmap. Reviewed: CLAUDE.md hard rules, `config.json`, recent journals (2026-07-07/08), the latest walk-forward report (`walkforward_20260708T063702Z.md`), and the dashboard/scripts (grep-verified — no fee/spread accounting, no partial-TP/break-even, no max-hold logic exists anywhere).

**Evidence found in live data:**
- Journals 2026-07-08 show `BLOCKED: correlation budget: 5/4 positions open` — the book was **over** budget (cap only gates entries), and a UNI/USD score **+4.0** setup was repeatedly blocked while AAVE/USD sat open at score **−1.0**. Capital allocation is not re-ranked once the budget is full.
- Journals 2026-07-07/08 repeatedly log `insufficient 4H history (0 bars)` for ADA/USD and AAVE/USD → Signal 6 silently contributes 0 and the swing-low stop silently falls back to fixed −5%.
- `walkforward_evaluate.py` defaults `fee_bps=0`; latest report shows negative avg Sharpe on 4H/1D even before costs. No P&L surface (P&L/Edge/R:R column) accounts for Alpaca taker fees (~0.15–0.25%/side) or spread — critical for scalping economics.

**8 roadmap items added (CLAUDE.md › Roadmap):** (1) HIGH fee- & spread-aware economics (Spread column, net-of-cost R:R, scalp viability gate, walk-forward fee default); (2) HIGH position rotation at the correlation budget (rotate weakest holding out for a ≥4.0 candidate scoring ≥2.0 pts higher); (3) HIGH over-budget reconciliation + Command-tab warning chip; (4) MEDIUM partial take-profit at +1R + break-even ladder; (5) MEDIUM time-based stale-position exit (`risk.max_hold_hours`); (6) MEDIUM 4H data fallback via 1H-bar aggregation + explicit data-quality warning; (7) LOW R:R soft entry gate (block <1.0, half 1.0–1.5); (8) LOW session-edge feedback loop (hour/day expectancy → half-size, OFF by default).

No code changed — roadmap/docs only (CLAUDE.md, README.md, memory.md, glossary.md; dashboard_layout.md untouched — no dashboard change). Implementation deferred until a "rescan roadmap" request per workflow rule 8.

### 2026-07-08 — Bug rescan of v2026-07-08.1 → two Autopilot defects fixed (v2026-07-08.2)

"Rescan bugs" pass over yesterday's +558-line Autopilot commit (`fd16c7f`). Reviewed the full diff, re-verified the `seedStrategyConfig()` unit conversions against `config.json` (all `*_pct` are fractions — ×100 correct), confirmed the `AP_MAX_POSITIONS`/`AP_MAX_PER_TIER` locals exist, and found **two real bugs**, both in `apCycle()` in the dashboard's static HTML file:

**Bug 1 (HIGH) — trailing stop un-armed itself on a pullback below +2.5%.** The exit logic gated the entire trailing-stop check on *current* P&L (`if (plPct >= AP_TRAIL_ARM_PCT) { …trail check… }`). Python arms from the **HWM** (`risk.should_trail_stop_out`: `(hwm − entry)/entry ≥ activation`), so once armed the trail fires at HWM−3% regardless of current P&L. Failure case: entry $100 → run to $106 (HWM recorded) → pull back to $102.40. Trail should fire at $102.82; the dashboard skipped the branch (plPct 2.4 < 2.5) and fell through to the far-lower 4H swing-low stop, giving back profit and breaking Python parity. Fix: HWM still only ratchets while plPct ≥ arm, but arming is now `trailArmed = hwm ≥ entry × (1 + arm/100)` and the trail check runs whenever armed. Verified with a 5-case standalone node test (pullback-below-arm fires trail; within-band holds; unarmed falls to swing stop; new high ratchets; Python-file-seeded HWM arms correctly).

**Bug 2 (MEDIUM-HIGH) — stale-entry sweep cancelled orders it didn't own.** The item-3 lifecycle cancelled **every** open `buy`+`limit` order older than 1 cycle — including the Python engine's entries and any manual resting buy limit placed via the trade modal (e.g. a deliberate below-market bid). Fix: `apPlaceOrder()` now tags every Autopilot order with `client_order_id = "ap-<SYM>-<ms>"`, and the sweep skips any order whose `client_order_id` doesn't start with `ap-`. The exit cancel-replace path stays untargeted on purpose — it immediately re-places a protective SELL for the full qty at a wider band (mirrors Python's escalation and never leaves the position unprotected), so acting on a foreign sell order is safe there.

Verified: `vm.Script` parse on the inline script (1 block, 0 errors), `</html>` intact, behavioral test green, pytest suite still 95/95 (Python untouched). Footer → v2026-07-08.2. Docs updated: CLAUDE.md (Autopilot row + Bugs note), README.md, glossary.md, dashboard_layout.md.

### 2026-07-08 — Roadmap: all 10 dashboard effectiveness/consistency candidates implemented (v2026-07-08.1)

Rescan roadmap. The owner left all 10 candidates from the 2026-07-07 analysis in place → implemented every one. All changes in the dashboard's static HTML file (single file); Python untouched. Roadmap cleared per workflow rule 3.

**Foundation (new shared plumbing):**
- `STRAT_CFG` const object — dashboard-side strategy/risk params (TA-exit score −2, trail arm 2.5 / trail 3, cash reserve 20, swing-low lookback 20 / buffer 0.1% / clamp 8%, min-bars 60, daily-drawdown gate 3%, escalation 2 cycles / +0.3% band). Defaults mirror `config.json`; `seedStrategyConfig(cfg)` overwrites them from the file on load.
- `fetchLocalJson(paths)` — graceful multi-path relative JSON fetch. `loadConfigFromFile()` now tries `./config.json` **then `../config.json`** (the Python engine's file — `docs/config.json` doesn't exist in this repo, so previously the dashboard never actually loaded any config file).
- `calcADX()` / `adxLabel()` / `calcObvTrend()` — JS ports of `indicators.adx/adx_label/obv_trend` (Wilder ADX, OBV with 5%-of-window dead zone). Informational only; `calcSignalScore()` untouched.
- `loadScoutPromotions()` / `scoutExtraSymbols()` — reads `data/watchlist_dynamic.json` (TTL from `config.json › scout.ttl_hours`, seeded into `_scoutTtlHours`).

**Item 1 (HIGH) — Autopilot daily-drawdown gate.** `apCycle()` snapshots day-open equity per GMT+2 day (`localStorage.autopilotDayOpen`, `en-CA` date key, reset at day roll); when equity is ≥ `STRAT_CFG.dailyDrawdownGatePct` below it, the candidates list is emptied (all new entries blocked, `[BLOCK]` log), exits stay fully active. Mirrors `risk.daily_drawdown_gate_triggered` + capital preservation.

**Item 2 (HIGH) — fresh quotes for limit prices.** `apCycle()` fetches `fetchSnapshotsInBatches(_apwl)` once per cycle into `liveQuote{}`; entry ask (`×1.001`) and exit limits (`×0.995`, escalated band) anchor to `liveQuote[sym] || lastClose`. `lastClose` stays scoring-only. Graceful fallback + log line when snapshots fail.

**Item 3 (HIGH) — stale-order lifecycle.** Open orders fetched each cycle; per-order age counter persisted in `localStorage.autopilotOrderAge` (pruned when no longer open). Unfilled BUY limits older than 1 cycle → cancelled via new `apCancelOrder()` (DELETE `/v2/orders/{id}`, 404 = success). Exit path: when `qty_available` is locked and the tracked SELL order age ≥ `STRAT_CFG.escalationCycles` (2), cancel-replace with the full position qty at a wider band (0.5% + `escalationExtraPct` 0.3%). Kill switch clears the tracker.

**Item 4 (MEDIUM) — config-seeded Autopilot constants.** Removed hardcoded `AP_CASH_RESERVE_PCT`/`AP_TA_EXIT_SCORE`/`AP_TRAIL_ARM_PCT`/`AP_TRAIL_PCT` consts and the `SWING_LOW_LOOKBACK_4H`/`SWING_LOW_MAX_STOP_PCT` consts; `apCycle()` reads them from `STRAT_CFG` at cycle start and `swingLowStop4h()` reads lookback/buffer/clamp from `STRAT_CFG` (buffer was hardcoded `×0.999`, now `1 − swingLowBufferPct/100` — same 0.999 default).

**Item 5 (MEDIUM) — min-bars 55 → 60.** All five scoring paths (Signals, Scalping, Breakout, Market Scanner, Autopilot) now gate on `STRAT_CFG.minBarsForSignal` (60, = `config.json › data.min_bars_for_signal`). Added as item 13 of the Python ↔ Dashboard consistency checklist; item 14 documents the STRAT_CFG seeding rule.

**Item 6 (MEDIUM) — scout promotions surfaced.** Signals scan and Autopilot merge fresh (≤ TTL) promotions into their symbol set; promoted rows get a blue **SCOUT** tag; Command tab shows a 🔭 chip (`renderScoutChip()`) listing promotions with freshness (stale promotions shown greyed, excluded from scans). Promoted symbols use the default 5% cap + Tier-2 budget — same as Python.

**Item 7 (MEDIUM) — ADX + OBV columns.** Signals table and Scalping table gained display-only ADX (with `adxLabel()` tooltip) and OBV columns on the exec timeframe. Score-parity exemption intact — not folded into `calcSignalScore`. Signals table is now 16 columns (was 13), Scalping 10 (was 8); all placeholder/error colspans updated.

**Item 8 (LOW) — R:R preview.** New Signals **R:R** column: risk = distance to `swingLowStop4h`, reward = distance to BB-upper target; `1:X` green ≥ 2 / yellow ≥ 1 / red < 1; "–" with tooltip when price sits at/above the BB upper. Values cached in `_signalRrMap`; `openTradeModal()` shows the same numbers in a new `#tradeRrInfo` box. Display-only — no gate.

**Item 9 (LOW) — correlation-aware entry gate.** New `apMaxCorrWith(sym, openSyms, bD)` computes max Pearson ρ of 30-day daily log-returns vs open positions; ρ > `AP_CORR_LIMIT` (0.9) → **half-size** the entry (chose half-size over hard block — the static tier budget already caps count; log line records ρ and the correlated symbol).

**Item 10 (LOW) — HWM state merge.** `apCycle()` reads `data/positions_state.json` each cycle and seeds `hwm[sym] = max(localStorage, file high_water_mark)` before trailing; Command tab shows `renderHwmSplitWarning()` (`#hwmSplitWarning`) when both engines carry an active HWM for the same symbol.

**Verified:** `node` `vm.Script` on the extracted inline script → 1 block, 0 errors; `</html>` intact; repo grep confirms no `>= 55`/`< 55` scoring gates, no removed consts referenced, and the only `activity_type=FILL` URL remains in `edgeFetchAllFills()`. Footer → v2026-07-08.1. Docs updated across CLAUDE.md (roadmap cleared, Autopilot/Signals/Scalping/Command/Settings rows, checklist items 13–14, ADX/OBV note), README.md, glossary.md, dashboard_layout.md.

### 2026-07-07 — Analysis: dashboard effectiveness & strategy-consistency review → 10 roadmap candidates (no code changed)

User asked to analyze the dashboard's effectiveness and strategy consistency and add suggested improvements to the roadmap for owner selection. **Analysis-only session — no code, config, or dashboard changes; CLAUDE.md roadmap + this entry are the only edits.**

**Method.** Reviewed the dashboard's static HTML file (Autopilot `apCycle()` block ~6940–7253, signal engine consts ~2272–2300, order paths), `config.json`, `scripts/risk.py`, `run_evaluation.py`, `position_state.py` for cross-engine drift, against the CLAUDE.md hard rules and parity checklist.

**Findings (ranked, all added to the CLAUDE.md roadmap as candidates 1–10):**

1. **Autopilot has no daily-drawdown gate** — Python blocks entries at −3% day drawdown (`daily_drawdown_gate_triggered` + capital-preservation mode); `apCycle()` has no counterpart, so the in-browser loop keeps buying through a portfolio slide.
2. **Autopilot limit prices are stale** — entries/exits use `res.lastClose` (last *completed* 15-min bar, by design of `barsEnd()` up to ~15–30 min old) instead of a fresh snapshot quote; in a fast move the ±0.1%/−0.5% bands anchor to a stale price.
3. **No stale-order lifecycle** — Autopilot orders are GTC; only the ⛔ kill switch ever cancels. An unfilled exit is skipped every cycle by the `qty_available` dedup ("qty locked"), leaving the position unprotected, where Python cancel-replaces after `stop_loss_escalation_cycles` (2) with a wider band. Unfilled entries also linger indefinitely.
4. **Autopilot strategy consts hardcoded** (TA exit −2, trail 2.5/3, cash reserve 20, swing-low params) vs Python reading `config.json` — engines can silently fork.
5. **Min-bars drift** — dashboard scores at ≥55 bars, Python `min_bars_for_signal` = 60.
6. **Scout promotions invisible to the dashboard** — Python merges `data/watchlist_dynamic.json`; the dashboard never reads it (no `scout`/`watchlist_dynamic` reference in the HTML), so Signals/Autopilot see a narrower universe than the bot trades.
7. **ADX/OBV journal-only** — the 2026-07-07 informational indicators have no dashboard display (score-parity exemption intact; this is about *showing* them, not scoring).
8. **No R:R computation anywhere** despite Decision Checklist item 12 ("prefer R:R ≥ 1:2").
9. **Correlation budget is static tiers** while the Risk tab already computes a live ρ matrix that could gate correlated entries.
10. **Trailing-stop HWM state split** — Python `data/positions_state.json` vs Autopilot `localStorage.autopilotHwm`; two engines managing the same position trail from different HWMs.

**Confirmed consistent (no action):** score gates 3.5/2.5/4.0 shared via `SIGNAL_*` consts and matching `config.json`; trailing 2.5%/3% matches `risk.trailing_*`; swing-low stop params (20 bars / 0.999 / 8% clamp) mirrored in `swingLowStop4h()`; entry band ×1.001 within the 0.2% rule and exit band ×0.995 within 0.5%; cash-reserve 20% post-order gate present; correlation-budget caps read live from Settings; all realized-P&L KPIs on the shared `edgeFetchAllFills()`/`computeFifoStats()` path (2026-07-06/07 fixes verified still in place); annualization 365 both sides.

**Verified:** findings grep-confirmed against the live files (`daily_drawdown|capital_preservation` absent from the HTML; `length >= 55` at lines 6204/7147 vs `min_bars_for_signal` 60; `cancel` only in the kill switch; no `watchlist_dynamic` in the HTML). Roadmap items are proposals — owner selects; nothing moved to "completed".

### 2026-07-07 — Roadmap: `crypto-catalysts` skill added

User added roadmap item 1 ("look at the skills in this project and add any skill that could benefit this project, with the focus on crypto. Don't overlap skills and don't add too many") and requested "rescan roadmap" (= implementation per workflow rule 8).

**Gap identified:** news/catalyst interpretation — the Decision Checklist asks "What does recent news say? Any macro catalysts?" but nothing taught how to weigh crypto-specific events (crypto-trader §8 covers on-chain *metrics* only, not events/headlines).

**Added `skills/crypto-catalysts/SKILL.md` (knowledge, directory form matching crypto-trader).** News & event interpretation guide with a T1/T2/T3 severity ladder — T1 structural (hack, depeg, delisting, enforcement, chain halt) → flag open positions for close + block entries; T2 flow (large unlocks, ETF flow streaks, funding > +0.1%/8h, listings, OI extremes) → downsize/skip borderline entries; T3 noise → record only. Plus macro-window handling (skip half-size-gate entries within ±2h of FOMC/CPI), weekend/thin-liquidity skepticism, and an output convention for `Read:` lines (`flagged to close: SYMBOL — T1 …`). Prime directive: **defensive only** — catalysts veto/downsize/flag, never override score gates, regime gate, correlation budget, or any hard rule.

**Verified:** lint-clean frontmatter (name/description) consistent with existing skills; no code paths touched, so no tests affected.

### 2026-07-07 — Roadmap: indicator-list analysis — ADX + OBV added as informational indicators

User re-added roadmap item 1 ("Analyze the technical indicators list and add more indicator when you deemed it necessary") and requested "rescan roadmap" (= implementation per workflow rule 8).

**Analysis.** The 6-point confluence set covers direction (EMA cross, MACD), momentum (RSI), mean-reversion (BB %b), single-bar participation (volume ratio), and HTF regime (4H EMA). Two genuine gaps: (1) **trend strength** — the EMA cross gives direction but not conviction, so a golden cross in a chop is indistinguishable from one in a real trend (whipsaw trap); (2) **cumulative volume flow** — `volume_ratio` is a one-bar snapshot and cannot see multi-bar accumulation/distribution. Rejected as redundant: Stochastic RSI / CCI / Williams %R (overlap RSI/BB), VWAP (session-ambiguous on a 24/7 venue).

**Change (`scripts/indicators.py`).** Added `adx(highs, lows, closes, period=14)` (Wilder ADX: smoothed ±DM/TR → DX → Wilder-averaged; needs ≥ 2×period+1 bars), `adx_label(value)` (<20 ranging/weak, 20–25 emerging trend, 25–40 trending, ≥40 strong trend), `obv_series(closes, volumes)` (cumulative signed volume), and `obv_trend(closes, volumes, lookback=20)` (rising/falling/flat; dead zone = 5% of window volume so noise reads flat). Self-test block extended.

**Change (`scripts/run_evaluation.py`).** `evaluate_symbol()` computes `decision["adx"]` and `decision["obv_trend"]`; `format_indicator_block()` prints `adx : XX.X (label)` and `obv : rising/falling/flat` lines between `atr` and `4h`.

**Deliberately NOT scored.** Both indicators are informational-only journal context for the hourly agent. Folding them into `signal_score()` would silently shift every trading gate (buy ≥3.5, TA exit ≤−2, scout ≥4 …) and break Python↔dashboard scoring parity; the dashboard `calcSignalScore()` is untouched and needs no counterpart (parity exemption noted in CLAUDE.md).

**Verified:** `python scripts/indicators.py` self-checks pass (ADX 38.6 "trending" and OBV "rising" on the rising sine fixture — sane); `python -m pytest tests/ -q` → **95 passed** (11 new tests: TestAdx — range, insufficient data, length mismatch, high-ADX-on-clean-trend, label buckets; TestObv — series length, mismatch, rising/falling/flat, insufficient data). Roadmap item moved out of CLAUDE.md per workflow rule 3.

### 2026-07-07 — Dashboard KPI audit: crypto annualization factor + unmatched-SELL win-rate hardening (v2026-07-07.1)

User asked to "check the dashboard on inconsistencies and incorrect KPIs." Audited every KPI computation path in the dashboard's static HTML file and cross-checked against `scripts/metrics.py`. Two fixes applied.

**Fix 1 — annualization factor 252 → 365 (incorrect KPI).** `DEFAULT_LIMITS.tradingDaysPerYear` was `252` (the equity-market convention). This is a 24/7 crypto product; the portfolio-history feed (`period=3M&timeframe=1D&intraday_reporting=continuous`) returns ~365 daily points/year, so every annualized KPI was scaled by the wrong √N. It feeds five sites: Performance **Annualized Volatility**, Risk **Sharpe/Sortino/Calmar**, Backtest **Live Sharpe**, and Analytics **rolling 30/90-day Sharpe & vol**. It also contradicted the backend — `scripts/metrics.py:17` documents *"markets are 24/7; annualization uses 365 days"* and `annualization_factor("1D")` returns `365.0`. Effect: Sharpe/Sortino/Calmar/vol were understated by √(252/365) ≈ 0.83 (~17% low), which could flip the Backtest "Strategy Health" colour. One-line change to `365`.

**Fix 2 — `computeFifoStats` no longer books unmatched SELLs as $0 "wins" (cross-tab consistency).** When a SELL hit an empty FIFO queue (no matching prior BUY), `realizedPnl` stayed `0` and `realizedPnl >= 0` counted it as a win — the same class of phantom-$0-win bug the 2026-07-06 fix addressed in the *data source* but not the *logic*. The Edge (`edgeFifoTrades`) and Insights (`insRoundTrips`) engines already skip these (require `entryT`/`cost>0`), so Overview/P&L/Backtest win-rate & trade count could diverge from Edge/Insights. Now tracks `matchedQty`; a SELL is only counted as a realized trade when `matchedQty > 1e-9`, otherwise it stays in the trade log with `pnl: null` (renders "–", excluded from stats and the P&L calendar). Latent today (paper acct from cash, shorts disabled) but future-proofs the shared engine.

**Not changed (reported as LOW, left as-is):** break-even $0 round-trips count as wins across all three engines (internally consistent); dashboard `downsideStd` uses sample-std-of-negatives while `metrics.py` uses RMS-of-downside (Sortino methodology differs — parity note only); `portLoadDist` invested/donut uses signed `market_value` vs `loadContext`'s `Math.abs()` (latent — shorts disabled).

**Verified:** re-extracted the inline `<script>` and validated with `new vm.Script` (`node`) → 1 non-src block checked, 0 errors. Grep confirms `tradingDaysPerYear`/`252` now reads `365` at the single definition and no other `252` literal drives annualization. Footer → v2026-07-07.1.

### 2026-07-06 — Bug: Total P&L / realized-profit KPIs were computed on a truncated 100-fill window (v2026-07-06.1)

Rescan roadmap. Bugs list had one item: *"The total profit kpi's are not correct. Please fix."*

**Problem (root cause):** The shared realized-P&L engine `computeFifoStats()` was fed only a **single 100-fill page** (`/v2/account/activities?activity_type=FILL&page_size=100&sort=desc`) in three places:
- `loadContext()` — drives the Overview **Total P&L** KPI, the Command tab, and the Backtest vs Live tab (`c.fifoStats`).
- `loadPnl()` — drives the P&L tab **Total Realized P&L** KPI + attribution + calendar + day-of-week.
- `generateDailyJournal()` — computes today's realized-P&L slice.

Once an account exceeds 100 fills, FIFO matching runs on a truncated tail: (1) the realized total is understated, and (2) any SELL whose matching BUY predates the 100-fill window hits an empty queue → `realizedPnl` stays 0 → booked as a **$0 "win"**, which also corrupts win rate and profit factor. The Edge and Insights tabs already did it correctly via `edgeFetchAllFills()` (paginates all fills, 10k cap), so they silently disagreed with the "matches P&L tab" KPIs.

**Fix (the dashboard's static HTML file):** routed all three feeders through the existing `edgeFetchAllFills()` helper (mode-aware — uses `apiFetch` → `getBaseUrl()`/`getHeaders()`, paginates via the activities `id` cursor with `direction=desc`, 10k safety cap). It is a hoisted function declaration in the same script block, so the earlier-defined `loadContext`/`loadPnl`/`generateDailyJournal` can call it. `loadPnl` dropped its now-unused local `baseUrl`; `generateDailyJournal` uses `edgeFetchAllFills().catch(() => [])` to preserve its "empty on failure" behaviour. Now every realized-P&L KPI (Overview Total P&L, P&L tab, Backtest, Edge, Insights, daily journal) reads the same complete fill history and cannot diverge. Footer → v2026-07-06.1.

**Verified:** extracted both inline `<script>` blocks and validated each with `new vm.Script` (`node`) → 2 blocks checked, 0 errors. Repo grep confirms the only remaining `activity_type=FILL` URL string is inside `edgeFetchAllFills()` itself; no feeder still uses `page_size=100&sort=desc`. Bugs list cleared in CLAUDE.md.

### 2026-06-29 — Chore: stop tracking `ruvector.db` runtime state

`ruvector.db` (RuVector runtime state binary) mutates continuously while the agent/process runs, so it reappeared as a modified tracked file every cycle and repeatedly tripped the Stop hook ("tracked files changed this session"). It is generated runtime state, not source.

**Fix:** added `ruvector.db` to `.gitignore` and ran `git rm --cached ruvector.db` (file kept on disk, only removed from the index). No code/logic changed. This is the resolution for the previous string of `chore: ruvector.db runtime state` commits — the file no longer needs committing each session.

**Verified:** `git status` no longer lists `ruvector.db`; working tree clean after committing the `.gitignore` change + index removal.

### 2026-06-29 — Fix: resolve committed merge-conflict markers in backtest tooling

After the `/6` rescan, a repo-wide grep surfaced **committed, unresolved `<<<<<<< / ======= / >>>>>>>` markers** (from old auto-merges under SHA `96f6b1b…`) in two source files, leaving them un-importable.

- `scripts/metrics.py` — both conflict sides were **byte-for-byte identical** (a pure duplicate of the whole module). Rewrote the single clean copy.
- `scripts/walkforward_evaluate.py` — the two sides genuinely differed; took the newer `96f6b1b` side at all 13 conflicts. That side is config-driven (`_load_sim_defaults()` / `default_sim_config()` read thresholds from `config.json`), has the half-size buy logic (`buy_score_half_size`, `size_mult`, `cap × size_mult`), reads symbols from `config.json › watchlist.symbols`, and uses a correct `"\n".join(...)` in `write_reports` (the HEAD side had a syntactically broken multiline string). Dataclass defaults (4.0/3.0) are fallbacks only; live `config.json` (3.5/2.5) wins via `default_sim_config()`.

**Verified:** `python -m py_compile` passes on both; grep confirms zero markers remain in either file. Remaining markers live only in append-only `journal/*.md` history (cosmetic, left untouched).

### 2026-06-29 — Roadmap: remove the `/6` suffix from all score values (v2026-06-29.1)

Rescan roadmap. One item: "Remove '/6' from all score values. The reason for this is that 6 is the maximum score anyway and it messes up the sorting of the columns." The `/6` suffix turned numeric score cells into strings (e.g. `+5/6`), so table columns sorted lexically instead of numerically.

**Decision:** the stated reason is column sorting (a dashboard concern), but the instruction says "all score values," so removed `/6` from every displayed/emitted score for consistency — dashboard UI **and** the Python journal output. Left it intact in historical journals/reports/`data/market_research/` (append-only logs — not rewritten) and in CLAUDE.md threshold *prose* that explains the 6-point scale (documentation, not a value).

**Implementation:**
- The dashboard's static HTML file — stripped `/6` from: BUY/BEAR notifications, the closing-journal scan narrative + table, Breakout `ssText` (incl. the `–/6`→`–` fallback) and its `Signal /6` header, Market Overview score cell (sortable column), Scalping score cell (sortable column) + Avg-Score KPI, Market Signals Avg-Score KPI + BUY/Half KPI descriptions + Top-Opportunities rows, Autopilot entry-log note, Breakout legend, and the `portActionChip` threshold chips (`BUY ≥3.5`, `½ BUY 2.5`, `SHORT ≤−4`). Grep confirms zero `/6` remain in the dashboard. Footer → v2026-06-29.1, date 2026-06-29.
- `scripts/run_evaluation.py` — `format_decision_line` (`score=%+.1f`) and `format_indicator_block` (`score   : %+.1f`).
- `scripts/rebalance.py` — the three `score=%.1f` reason/size-note strings.

**Verified:** repo-wide grep for `/6` shows only historical logs + scale-explaining prose left; no live UI or emitted-format string still carries it. CLAUDE.md Output Format block updated to the new `score=+X.X` form so docs match code. Roadmap cleared.

### 2026-06-22 — Roadmap: user-configurable open-position cap (v2026-06-22.1)

Made the Autopilot's max-open-positions / max-per-tier caps user-configurable in Settings (🔗 Correlation Budget section) instead of hardcoded consts; Python already read these from `config.json`.

### 2026-06-19 — Roadmap: loosen gates, USDT/USDC support, Scalping tab (v2026-06-19.1 – .3)

- Loosened score gates (buy 4.0→3.5, half 3.0→2.5, new 4.0 counter-trend downtrend gate); replaced the fixed 5% stop with a 4H swing-low stop (clamped ≤8% below entry, fixed-% fallback); raised the correlation budget to 4 total / 3 per tier; added a Scalping tab (5m/15m/1h scanner + manual Buy/Sell, no new auto-loop).
- Allowed USDT/USDC-quoted pairs everywhere in the dashboard (selector, watchlist, Scanner, Market Overview), not just USD; non-USD pairs use the default 5% cap.
- Added a "Show stablecoins" checkbox (default off) to optionally include stablecoin pairs in the watchlist-add dropdown only — scans stay stablecoin-free.

### 2026-06-18 — Bug fixes + roadmap (v2026-06-18.1 – .4)

- Bug: fewer symbols scanned than the Max Symbols setting — `getCryptoUniverse()` was caching the 30-symbol fallback on a transient failure; fixed to only cache real non-empty results.
- Bug (follow-up): scanner still capped near 33 symbols with Max Symbols=60 — root cause was Alpaca genuinely only offering ~20-33 USD-quoted pairs (a real exchange ceiling, not a bug); fixed the scan-count UI to say so honestly.
- Added the latest 2 FILL activities to the top-left of the Trading Permission Rules panel, and the last 3 Autopilot-log messages under the Command tab trading-status word.

### 2026-06-17 — Nav regroup, tab merges, bug sweep (v2026-06-17.12 – .22)

- Regrouped nav into Command/Trade/Portfolio/Analytics/Settings section labels; merged Market Overview + Market Signals into one tabbed Market page (added per-row Watchlist +Watch/–Unwatch buttons); folded Breakout Scanner into Market as a third sub-tab; renamed the full-universe scanner "Signals"→"Scanner" to disambiguate from the watchlist Signals tab; merged Performance+P&L+Edge into one 🔬 Analytics tab; dropped the standalone Positions tab (superseded by Portfolio Overview).
- Unified the Scanner and Signals tabs' score-distribution tile into one shared `renderScoreDist()` helper; removed the duplicate "Filled Orders" Performance tile; added the 🧠 Behavioral Insights tab (Day-of-Week Edge, After Losing Streaks, Cadence After Outcome, Rule Discipline).
- Bug fixes: excluded stablecoins from all symbol scans; fixed a false "Over Cap" badge at exactly 100% utilization; fixed Portfolio tiles stacking vertically (missing `.cards` grid CSS); ticker strip now follows the active watchlist instead of a hardcoded list.
- Layout/style consistency sweep (undefined `--fg` token, missing `.spinner`/`.error-box` styles, duplicate `.score-pip` CSS, non-theme-aware hover greys, missing `.period-btns` CSS).
- Added Buy/Sell buttons to Market Overview rows and an exchange-symbol dropdown for watchlist-add; made the footer a single responsive row; deleted the legacy `docs/portfolio-dashboard.html` (tabs already merged into the Professional Dashboard 2026-06-15).
- Memory consolidation: merged `memory/projects/alpaca-trading-agent.md` into this single `memory/memory.md`.

### 2026-06-15 — Portfolio Dashboard merge + bug fixes (v2026-06-15.1 – .11)

- Merged `docs/portfolio-dashboard.html` into the main dashboard's static HTML file as 4 new "💼 Portfolio" nav tabs (Overview, Hot Symbols, Allocation, Morning Brief); redesigned the footer into a 2-row layout; removed the 6%-drawdown hard-stop rule (metric still displays, halt removed); added the Settings watchlist tag editor.
- Applied 5 roadmap items: candlestick favicon + title renamed to "CryptoPro Dashboard"; removed the Orders pane, Hot Symbols tab, and Morning Brief (superseded by other tabs).
- Bug fixes: dashboard buttons/links stopped reacting (an orphan `else` left from a prior drawdown-rule removal broke the whole inline `<script>` parse); Signals tab hardcoded its symbol list instead of reading the Settings watchlist; Performance tab's "Total P&L" disagreed with the P&L tab across two attempts, finally fixed by pointing both at the same FIFO-realized number; score-distribution bucket off-by-one at score 2.5; undefined `applySort`/`numOrStr` sort helpers; Market Overview Score column not populating; Breakout Scanner score inconsistency (added a shared Signal /6 badge).
- Removed "Watchlist — No Position" section; sorted Signals tab descending by score.

### 2026-06-11 — Pro-trader review + stale-bars bugfix + market-researcher subagent

- Fixed a critical stale-bars bug: `get_crypto_bars()` omitted `sort=desc`, so Alpaca returned the *oldest* N bars of the window — daily bars were 54 days stale, causing wrong regime reads. Fixed across all Python fetch paths; added regression tests.
- Pro-trader review: fixed stop-loss self-rejection (clamp to band edge instead of reject); added the universe scout (`scripts/scout.py`, promotes top-3 uptrending non-watchlist symbols); disabled shorts (Alpaca spot can't actually short — every SHORT ever attempted was rejected); added the dashboard Autopilot panel and Edge tab.
- Added the `.claude/agents/market-researcher.md` analysis-only subagent (verifies strategy vs. market conditions and project consistency after every strategy change; never trades).

### 2026-06-05 to 2026-06-07 — Dashboard fixes: ranking, deep-links, Max Symbols, Markov, Morning Brief

- Fixed the 30-symbol cap on Market Signals and Market Overview for good (universe fetch was fragile; both tabs now scan/show up to the entered Max Symbols); gave every symbol a real rank number; added tab deep-linking + last-tab restore; fixed a Market Overview symbol-column overflow; fixed correlation-matrix left whitespace and reordered the Risk-tab panels; added `dashboard_layout.md` to the doc-update rule.
- Fixed the Max Symbols setting resetting to 30 on refresh (config.json was overriding saved localStorage) and removed the 1–30 hard clamp; removed config.json save-to-file (localStorage-only persistence); fixed a TDZ crash (`TOP30_SYMBOLS` accessed before init) that broke all onclick handlers; tidied the Settings tab layout; fixed broken Win Rate/Profit Factor on the Backtest tab (shared FIFO engine); fixed Markov matrices overlapping their grid panels.
- Moved tab nav to a left sidebar; added the 🔗 Markov tab (BTC/ETH transition-matrix analysis); added executable Morning Brief and Daily Journal header buttons (client-side Markdown generation with preview/copy/download).

### 2026-05-27 — Risk Management Chapter 2: five improvements implemented

Implemented all 5 improvements from the performance review: stop-loss order dedup, wider stop-loss limit band + time-escalation, trailing stops (new `position_state.py`), correlation budget (3 total / 2 per tier), and portfolio daily-drawdown gate (3%).

### 2026-05-26 — Python ↔ Dashboard consistency audit

Fixed MACD signal line always reading NaN (critical — capped max score at ±5); fixed half-size score pills using strict equality (missed 3.5/-3.5 scores); excluded the in-progress bar from all indicator calculations (was causing unstable volume/RSI/MACD); fixed 4 scoring discrepancies between dashboard and Python (EMA seeding, EMA dead zone, MACD partial credits, RSI direction check) so both engines score identically.

### 2026-05-21 to 2026-05-25 — Short-selling support, Market tabs, TradingView links

Added full short-selling support (short/cover thresholds, bidirectional trading, short-aware UI — later fully disabled 2026-06-11 once Alpaca spot proved it can't actually short); added Market Overview + Market Signals tabs; added a direct ▶ Execute button to Signals rows; added `tvLink()` TradingView symbol links across both dashboards; fixed mobile-portrait tables not horizontally scrolling.


## 2026-07-11 — Session: bug fix — Breakout scanner Key Levels duplicate labels (v2026-07-11.1)

- **Problem (Bug #1):** The Breakout sub-tab's 🎯 Daily Chart Key Levels panel showed several rows with the identical label (e.g. "Swing Low" ×3) at different prices with no date/timeframe context — indistinguishable, reading as duplicate entries. Root cause: `ggKeyLevels()` pushed every 5-bar swing point in the 6-month daily window with the bare label "Swing High"/"Swing Low"; the 0.5% dedup only collapses near-identical *prices*, not same-label rows.
- **Fix:** New `ggLevelDate(t)` helper (GMT+2 `Etc/GMT-2`, `en-GB` day+month) date-stamps each swing level with the daily bar it formed on — labels now render as e.g. "Swing Low · 21 Jun". The price-dedup and 5-level cap are unchanged. Footer bumped to v2026-07-11.1.
- **Verified:** Node test harness with the extracted `ggKeyLevels`/`ggLevelDate` over a synthetic 60-day series — all swing levels carry a date, no duplicate label+price rows (PASS).

---

## 2026-07-18 — Bug fix: Autopilot re-firing partial-TP on its own already-scaled-out positions (v2026-07-18.4)

- **Problem (Bug #1, reported by user via CLAUDE.md Bugs list):** "run_evaluation.py on GitHub Actions selling dashboard-Autopilot-opened positions without profit or a trailing stop." Journal evidence across 2026-07-09 through 2026-07-17 showed clean geometric halving cascades of "PARTIAL TP" sells on the same position (e.g. AAVE/USD: qty 6.5413 → 0.8177 → 0.4088 → 0.2044 → 0.1022 → 0.0511 → 0.0128; LINK/USD accumulated 24+ "partial SELL(s) since entry" on one open lot) followed by a `STOP-LOSS (breakeven after partial TP)` full close at essentially zero profit — well before the position's P&L ever reached the +2.5% trailing-stop arm threshold.
- **Root cause:** The dashboard Autopilot's partial-TP ladder (its static HTML file) only knows "has +1R already fired for this position" via its own `localStorage.autopilotPartialTp`, merged each cycle with the Python engine's `data/positions_state.json` (`partial_tp_done`/`breakeven_stop`) via `fetchLocalJson(["./data/positions_state.json", "../data/positions_state.json"])`. That is a same-origin relative `fetch()` of a local sibling file — the exact class of call Chromium blocks when the dashboard is opened via `file://` (the same root cause just fixed for the Glossary tab, see the 2026-07-18 entry above). When the merge silently returns `null`, the Autopilot has no way to know a scale-out already happened (by itself in a prior session, or by the Python cron), so on its next cycle it re-evaluates the (now smaller) remaining position against the same +1R trigger, sells 50% of the remainder again, and repeats — producing the observed halving cascade. Each re-fire also re-pins `breakeven_stop = entry`, so once price merely returns to the original entry (common on a pullback, long before +2.5%), the hard-stop check exits the sliver of remaining position at ~breakeven — no profit, and the trailing stop never got a chance to arm.
- **Fix:** Added `apReconcileFromFills(fills, heldSymbols)` to the dashboard's static HTML file — the same FIFO walk as Python's `reconcile_positions_from_fills()` in `scripts/run_evaluation.py` (flat→long transition tracking, dust-tolerant lot consumption at `_AP_RECONCILE_DUST_REL_TOL = 0.005`), run against Alpaca's own FILL activity ledger via the already-existing `edgeFetchAllFills()`/`apiFetch()` (a normal cross-origin HTTPS call to Alpaca — unaffected by `file://`, unlike the local state-file fetch). `apCycle()` now calls this once per cycle before the exit-management loop and merges `partialTpSyms`/`entryTime` into the existing `partialTp`/`entryTime` maps (only filling gaps, never overwriting an already-set local flag) right where `entry` is computed for each held position. This makes "has the +1R scale-out already fired" independently verifiable from Alpaca's own trade history regardless of whether the `positions_state.json` merge succeeds, so the Autopilot can no longer re-fire its own partial-TP on an already-reduced position. The `positions_state.json` HWM merge is unchanged (lower-severity: a missed merge there under-arms the trail rather than causing a premature exit).
- **Verified:** Extracted `apReconcileFromFills`/`toSlash` from the dashboard HTML with Node and ran three synthetic fill-history scenarios (fills ordered newest-first, matching Alpaca's `direction=desc`): (1) a real prior partial sell on an open lot → correctly flagged (prevents re-fire); (2) a brand-new position with only a BUY fill → correctly NOT flagged, entry time correctly backfilled; (3) an old, fully-closed round trip (partial sell + full close) followed by a brand-new BUY on the same symbol → correctly NOT flagged (old sells don't leak into the new round trip). Also parsed the full dashboard `<script>` block with `new Function(...)` to confirm no syntax errors from the edit. Footer bumped to v2026-07-18.4.

---

## 2026-07-18 — Workflow-rules rescan: stale "CryptoPro Dashboard" / "Alpaca Crypto Trading Agent" branding (v2026-07-18.6)

- **Problem:** User asked to "rescan workflow rules and apply changes when necessary." Auditing each rule in `CLAUDE.md` against actual project state surfaced a gap from the same-day rename (`f9ab333`, "docs: rename project to CryptoPro Trader"): the rename only touched `CLAUDE.md`'s header. The dashboard's static HTML file still had `<title>CryptoPro Dashboard</title>`, a `.footer-name` of "CryptoPro Dashboard", and an in-page header logo/label reading "CryptoPro Dashboard". `README.md`'s H1 still read "Alpaca Crypto Trading Agent" (pre-dating the "CryptoPro" branding entirely) — only its `## Description:` line had been touched in the earlier rename. `docs/dashboard_layout.md`'s own "Title:" line also still said "CryptoPro Dashboard". This violates rule 6 (footer must reflect the current project) and rule 5 (README must reflect changes).
- **Fix:** Updated the dashboard's static HTML file's `<title>`, `.footer-name`, and header logo/label to "CryptoPro Trader"; bumped the footer version `v2026-07-18.5` → `v2026-07-18.6`. Updated `README.md`'s H1 to "CryptoPro Trader". Updated `docs/dashboard_layout.md`'s "Title:" line and added a changelog row. Left historical changelog references to the old "CryptoPro Dashboard" name untouched in `docs/dashboard_layout.md` and this file (they document past states, not current branding).
- **Verified:** `grep -r "CryptoPro Dashboard"` across the repo now only matches historical changelog prose (this file and `docs/dashboard_layout.md`'s dated rows), not any live title/footer/header. `grep "Alpaca Crypto Trading Agent"` returns no matches anywhere. Div-tag balance on the dashboard's static HTML file unchanged (544 open / 544 close).
- **Also confirmed clean on this pass:** `.env` present and untouched (rule 10); `git status` clean before starting (rule 4); `## Roadmap` and `## Bugs` sections in `CLAUDE.md` both empty/resolved, nothing pending to move per rule 3; `## lessons` section present and populated (rule 9).

---


## 2026-07-19 — Fixed: "Deployment CryptoPro Trader failed on Vercel: No entrypoint found"

**Problem:** CryptoPro Suite's bug list (its `CLAUDE.md`, rescanned via `/rescan roadmap` with the Suite as the active project) reported a Vercel deployment of this repo failing with "No entrypoint found in /vercel/path0" — `package.json` had no `main`/server file, since this project has always been a static dashboard (GitHub Pages) plus a Python engine (GitHub Actions cron), never a Vercel app. Asked the user how to resolve it (disconnect Vercel vs. add a real entrypoint vs. investigate first) since the two options lead to very different fixes and the repo gave no signal either way; user chose to add a minimal entrypoint.

**Fix:** added `server.js` (Express, mirrors CryptoPro Suite's/Charts' `server.js` pattern) — serves `docs/` as static files, `GET /` → the dashboard's static HTML file, `GET /api/health`, skips `app.listen()` under `VERCEL`/`NODE_ENV=test`. `package.json` gained `main: server.js`, `start`/`dev` scripts, and its first real dependency (`express`) alongside the existing zero-dependency Node port under `src/`. No trading logic, no auth, no database — purely so a Vercel deploy of this repo doesn't hard-fail. Does not change how the dashboard is actually served today (GitHub Pages) or how the engine runs (GitHub Actions cron); see the new `## Hosting` section in `CLAUDE.md`.

**Verified:** `node --check server.js`; started locally on a scratch port (`PORT=3911`) — `GET /api/health` → `200 {"status":"ok",...}`, `GET /` → `200`, `GET /favicon.svg` → `200` (dashboard's relative asset paths resolve correctly under static serving); process killed immediately after (rule 2 — local server for testing only). `npm test` re-run after the `package.json` change: still 280/280 passing, no regression from adding the `express` dependency.

---

## 2026-07-19 — Added: README "Setup: Connecting to Alpaca" section

**Problem:** Alpaca connection setup was scattered across the README (a bare `.env` snippet under Configuration, GitHub Environments secrets under GitHub Actions Automation, a one-line Paper vs Live note near the bottom) with no single walkthrough for a new clone — no account-creation step, no way to verify keys actually work, and no mention of the dashboard's independent Settings-tab key fields.

**Fix:** documentation-only — added a `## Setup: Connecting to Alpaca (Paper & Live)` section to `README.md` right after the description, covering: (1) creating an Alpaca account and generating paper (then later live) API key pairs, (2) local `.env` setup with `python scripts/trade.py status`/`quote` as the connection-verification step (a 401/403 means the key pair doesn't match `APCA_BASE_URL`), (3) GitHub Environments secret setup for the scheduled workflows (`APCA_API_KEY_ID`/`APCA_SECRET_KEY` per `paper`/`live` environment — restates what already existed under GitHub Actions Automation, now as the primary walkthrough), (4) the dashboard's separate Settings-tab key fields (`localStorage`-only, independent of `.env`/GitHub secrets). No code, config, or workflow changes.

**Verified:** re-read the finished section for consistency with the existing `.env` block, `scripts/_env.py`'s actual load behavior, and `scripts/trade.py`'s real CLI (`status`/`quote`/`order` subcommands) — no invented commands or env vars.

---

## 2026-07-19 — Roadmap: symbol links now point to CryptoPro Charts instead of TradingView

**Roadmap item (CryptoPro Suite CLAUDE.md item 2):** "the Trader project's symbols are currently linked to TradingView; link to symbol URLs as provided by the Charts project."

**Fix:** `tvLink()` in `src/js/utils.js` now builds `https://crypto-pro-charts.vercel.app/?symbol=<TICKER>` instead of a `tradingview.com/chart/?symbol=CRYPTO:<TICKER>` URL. Kept the existing ticker-normalization logic (strip the `/`, bare base defaults to `USD`) — it already produced exactly the ticker form Charts' own `router.js` expects (`SYMBOL_RE = /^[A-Z0-9]{2,20}$/`, `?symbol=&exchange=` deep-link scheme read by `applyUrlOnLoad()`); `exchange` is omitted so Charts' `defaultExchange()` picks one. All 20 call sites (`analytics-watchlist.js`, `edge-insights.js`, `tabs-{gapgo,pnl,command,market,performance-risk-execution,signals,scalping,portfolio,markov}.js`) are unaffected — only `utils.js`'s function body and its doc comment changed. Deliberately did **not** rename `tvLink`/`.tv-link` (function name, CSS class) — the name is now slightly imprecise but renaming would touch all 20 call sites purely cosmetically, which the roadmap item didn't ask for.

**Verified:** confirmed Charts' `src/js/router.js` symbol regex and query-param names by reading it directly; grepped the whole repo for `tradingview` — none remain; grepped for any test asserting the old URL — none exist. Footer → v2026-07-19.3 (`docs/dashboard_layout.md` changelog entry added).

---

## 2026-07-24 — Suite roadmap: live-links swap + logo 2x (v2026-07-24.4)

Same rescan session, continued after the Suite login-503 bug fix (see `CryptoPro Suite/memory/memory.md`).
The user had live-edited Suite's `CLAUDE.md` with two new roadmap items and a new workflow rule ("always scan
the Suite roadmap first") mid-session — surfaced by the harness as an out-of-band file change, not something
found by re-reading on my own initiative. Per Suite rule 6 ("directly implement roadmap... when the roadmap
scan command is issued") and the user's explicit "implement both now" answer, did both across all 4 projects
and the mobile mockup in this same session rather than deferring to separate sessions (Suite rule 26 would
normally call for that, but the user chose otherwise this time).

1. **Vercel links → live custom domains.** `src/js/utils.js`'s `tvLink()` — the only Trader source file with
   a hardcoded sibling-app link — now points its Charts deep-link at `https://charts.cryptoprosuite.com/`
   instead of `https://crypto-pro-charts.vercel.app/` (same `?symbol=&exchange=alpaca` query, unchanged).
   `docs/dashboard_layout.md`'s changelog entry describing the original TradingView→Charts link change
   (v2026-07-19.3) was deliberately left alone — it documents what was true at the time, not current state.
2. **Logo size doubled.** `src/css/base-layout.css`'s `.logo-icon` (header) and
   `src/css/forms-modals-footer.css`'s `.footer-logo-icon` (footer, also used for the Developer Studio logo)
   both went from `18×18px`/`border-radius:4px` to `36×36px`/`border-radius:8px`. Both files are static assets
   linked directly (not Vite-bundled), so no `npm run build` was needed for this to take effect.

Full cross-project rationale, the Suite login-bug fix, and the other 3 projects' identical changes are
documented in `CryptoPro Suite/memory/memory.md` (2026-07-24) — this entry only covers what changed in this
repo specifically, per this project's own standing doc-update rule.

**Not verified:** no browser tool this session — the larger logo hasn't been visually confirmed to fit
cleanly in the header/footer flex row; worth a quick check before treating this as fully done.

**CORRECTED same day, later session (v2026-07-24.5) — see entry near the top of this file.** Item 2 above
was a misreading: it doubled the *logo image* in both header and footer, but the actual roadmap text asked
to double the header *text* only ("don't touch the footer") and *halve* the footer logo. See the corrected
entry for the actual fix.

---

## 2026-07-24 — Multi-language support Phase 0: i18n foundation + common chrome (v2026-07-24.7)

Suite roadmap item 0 ("Add multi-language support for Dutch, English, French and Spanish"),
implemented directly per the user's go-ahead (full scope: all projects' UI chrome + Training's
full course content, AI-translated now — not scaffolded placeholders). Full cross-repo plan
recorded in `memory/i18n-suite-plan.md` (a planner-agent pass surveyed all 5 repos before any
code was written) — this entry covers only what shipped in this repo this session.

Trader is the pattern-establishing project: it has the hardest case in the suite (a React shell
wrapping ~30 classic-global `src/js/*.js` files that inject text via `innerHTML`/`.textContent`,
not JSX) — solving it here produces the reusable mechanism every other app in the suite copies.

**What shipped:** `client/src/i18n/index.js` initializes `i18next` + `react-i18next` before the
app renders (`main.jsx`), and exposes two things the vanilla scripts/raw-HTML fragments need
since they can't use React hooks: a plain `window.t()` and `applyDomI18n(root)`, a generic walker
for `data-i18n`/`data-i18n-html`/`data-i18n-placeholder`/`data-i18n-title` attributes. `App.jsx`
calls `applyDomI18n(document)` in its mount effect, before `loadDashboardScripts()`. A language
switcher (`EN/NL/FR/ES` `<select>`, `.theme-btn` styling) sits in the header next to the theme
toggle; the choice persists to `localStorage`'s new `dashLang` key, added to `settings-sync.js`'s
`SETTINGS_SYNC_KEYS` — it round-trips through the existing `/api/session` server-sync with zero
new backend code (same server-wins pattern as theme/last-tab).

Translated this pass (the `common` namespace — `client/src/i18n/locales/common/{en,nl,fr,es}.json`,
meant to be ported identically to Charts/Suite/Mobile per this suite's established shared-chrome
convention): `Header.jsx`, `Footer.jsx`, `Nav.jsx` (all converted to `useTranslation()`), and
`client/src/fragments/modals.html`'s trade ticket, daily-journal, manual-panel chrome, and terms
modal (including the 5 ToS paragraphs, via `data-i18n-html` to preserve the `<b>` tags).

**Verified, not just built:** no test suite covers client strings, so used Playwright (headless
Chromium, via `npx playwright` — not `chromium-cli`, which isn't installed in this environment)
against the Vite dev server. Confirmed: EN renders correctly on load; switching to NL re-renders
nav labels ("Command"→"Commando", "Trade"→"Handelen"), footer text (tagline, disclaimer, creator/
studio labels), and the terms modal (opened via the footer link) with all 5 translated paragraphs
and intact `<b>` markup; switching back to EN restores original text; zero console errors
throughout. Screenshots kept in the session scratchpad, not committed (verification artifacts,
not project files). `npm run build` (80 modules, no errors) and the full `node --test` suite
(310/310, unchanged) both still pass.

**Not done in this pass — real, sizeable remaining scope, not an oversight:** the 13 tab HTML
fragments (`client/src/tabs/*.html`, ~1123 lines of static labels covering every tab) and the
dynamic strings inside `auth.js`/`manual.js` are still English-only; no `app` i18next namespace
exists yet. Phases 1-3 (porting the `common` pattern to Charts/Suite/Mobile, then Training's
chrome + its 67-module course content — estimated ~60,000 words across NL/FR/ES, chunked into 27
passes) haven't started. Full remaining scope and the architecture rationale: `memory/i18n-suite-plan.md`.

---

## 2026-07-25 — Multi-language support Phase 0b: tab content + auth/manual chrome (EN/NL/FR/ES)

Closes the two gaps the Phase 0 entry above flagged as not-yet-done: the 13 tab HTML fragments
and `auth.js`/`manual.js`'s dynamic strings. New `app` i18next namespace
(`client/src/i18n/locales/app/{en,nl,fr,es}.json`) parallel to `common`, following the exact same
`data-i18n`/`data-i18n-html`/`data-i18n-placeholder`/`data-i18n-title` mechanism already proven in
Phase 0 — `i18n/index.js`'s `ns` array became `['common', 'app']`, `defaultNS` stayed `'common'`
(bare keys resolve there; `app` namespace keys need an `app:` prefix, e.g.
`data-i18n="app:command.sectionTitle"`).

**Scale:** 550 keys per language, verified with a small Node script that all 4 locale files parse
and share an identical key set before wiring them in (a real risk called out in
`i18n-suite-plan.md`'s known-risks section — a missing key in one language would silently fall
back to English via `fallbackLng`, which is fine as a safety net but not something to rely on
undetected).

**New mechanism — `data-i18n-tip`:** `ui-helpers.js`'s custom tooltip system reads
`el.dataset.tip` live on hover (`tooltip.textContent = el.dataset.tip`, not cached at parse time),
so `applyDomI18n()` gained a fourth attribute handler mirroring `data-i18n-title`:
`data-i18n-tip="key"` sets `el.dataset.tip = i18n.t(key)`. The original English `data-tip` stays
in the markup untouched as a safety-net fallback. Applied across every `<th data-tip="...">` in
the 13 tabs — dozens of table-header tooltips (Symbol/Price/Score/RSI/etc. across
signals/market/analytics/execution/risk/portfolio tables).

**Sort-arrow spans:** several `<th>` elements wrap a `<span class="sort">⇅</span>` after the label
text (click-to-sort indicator). Translating the whole `<th>` via `data-i18n` would have overwritten
that span. Fix: wrap just the label text in its own `<span data-i18n="...">Label</span>` sibling to
the sort-arrow span, so `applyDomI18n`'s `textContent` assignment only touches the label.

**Coverage across the 13 tabs:** subnav tab-switcher buttons, section/panel/chart titles, period
and filter buttons (1M/3M/6M/1Y, All/⚡ Key only, etc.), every table column header + its tooltip,
and loading/empty-state placeholders. `auth.js`'s sign-in, register, change-password, 2FA setup/
disable, and account modals now build their markup with `window.t('app:auth.*')` calls at render
time (not baked at module load) so they reflect whatever language is active when the modal is
opened. `manual.js`'s 8 section titles moved from a baked `title: "text"` field to a `titleKey` +
`manualTitle()` helper called at render time — same reasoning as `auth.js`: a plain string baked
into the module-level `MANUAL_SECTIONS` array would freeze at whatever language was active when the
script first ran, since nothing else re-evaluates that array on a later language switch.

**Deliberately deferred (not oversights, called out explicitly in the task and re-confirmed
during implementation):**

- Long free-form explanatory paragraphs (command.html's Autopilot description; the News/Socials/
  Glossary explainer paragraphs) — dense multi-sentence prose where translation quality matters
  more than a mechanical label pass; lower priority per the task's own scope ordering.
- Two live-DOM-span cases discovered during implementation, not anticipated up front:
  markov.html's descriptive paragraph embeds `<span id="mkThreshLabel">1.0</span>`, which
  `tabs-markov.js` updates via `textContent` after load; port-overview.html's "Open Positions (N)"
  section title embeds `<span id="portPosCount">`, updated the same way by `tabs-portfolio.js`.
  Wrapping either in `data-i18n-html` would work at first render but a later language switch
  (`applyDomI18n` re-running) would reset the span back to the template's static placeholder,
  clobbering the live value — left as English templates instead, noted inline in the HTML.
- `manual.js`'s actual section body prose (the help documentation content itself) — only the 8
  section titles were translated, per the task's explicit "titles yes, full body defer" instruction.

**Verified:** `cd client && npm run build` — 84 modules (up from 80, the 4 new JSON files), no
errors. `npm test` from repo root — 310/310 passing, unchanged (this task touches no
backend/test-covered code). Playwright (headless Chromium via the cached
`ms-playwright/chromium-1228` binary — the `playwright` npm package itself was installed into a
scratch directory, not this repo) against the Vite dev server: confirmed the Command tab renders
correctly in English (forced explicitly — this sandbox's browser/OS locale defaults to `nl` via
`navigator.language`, which `detectInitialLanguage()` correctly picks up when no `dashLang` is
saved yet, so an unmodified fresh load isn't a reliable "English baseline" here), then switching to
NL correctly re-rendered the Command subnav/section title/jobs panel, followed by clicking through
Analytics (subnav "📈 Prestaties", title "Prestatiedashboard"), Signals (title translated, first
table header "Symbool", and its `data-tip` tooltip attribute itself translated to "Cryptopaar." —
confirming the new `data-i18n-tip` mechanism works end-to-end), and Settings (title, panel title,
and the watchlist "+ Toevoegen" button all translated). Zero new console errors — the one message
observed ("Add your Alpaca API key and secret in Settings first.") is a pre-existing app guard for
missing credentials in the fresh test browser profile, unrelated to i18n and present regardless of
language.

Suite `CLAUDE.md`'s Phase 0 status line and `memory/i18n-suite-plan.md`'s "Status" section both
updated to reflect Phase 0b as done. Remaining suite-wide scope (Charts/Suite/Mobile port,
Training's chrome + full 67-module content translation) unchanged — tracked in
`memory/i18n-suite-plan.md`.

---

## lessons
- Any `fetch()`/XHR of a same-origin relative local file (config.json, positions_state.json, glossary.md, etc.) in the dashboard's old static HTML file could be silently blocked when the dashboard is opened via `file://` — never rely on it as the *only* source for cross-engine state; prefer deriving the same fact from an HTTPS call (e.g. Alpaca's own API via `apiFetch`) when one is available, and treat the local-file fetch as a best-effort enhancement only.
- When renaming the project, `grep -ri` the whole repo (not just `CLAUDE.md`) for every prior name variant (e.g. "CryptoPro Dashboard", "Alpaca Crypto Trading Agent") before considering the rename done — `<title>` tags, in-page header labels, footer names, and README H1s are easy to miss and only surface later during an unrelated rules audit.
- Before implementing anything from a "rescan roadmap"/bug request, run `git fetch origin main` and diff against `origin/main` — automated/scheduled runs can push directly to origin far more often than a local checkout gets pulled, so `git log -3` on a stale local HEAD can look current while actually being many commits behind.
- Never guess a third party's official Telegram/social channel username and wire it in as a trusted source — verify it against the organization's own site or another authoritative reference first.
- Confirm the actual hosting-plan tier (e.g. Vercel Hobby vs. Pro) before shipping a config change that assumes a higher tier's capabilities, even when a documented fallback already exists — an unverified assumption can block a deployment outright.
