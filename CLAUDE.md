# CryptoPro Trader

Professional cryptocurrency trading & analytics platform. Autonomous paper-crypto agent on Alpaca plus a
React/Vite dashboard. Crypto trades 24/7 — no weekday/market-clock gate. All times GMT+2.

**Master workflow rules:** [CryptoPro Suite CLAUDE.md](../CryptoPro%20Suite/CLAUDE.md).
**Open work:** [ROADMAP.md](ROADMAP.md).
**Trading method:** read `skills/crypto-trader/SKILL.md` before evaluating any trade. `skills/crypto-catalysts`
is the news-severity ladder — defensive only, it never justifies an entry.

Project-specific rules:

1. Keep `README.md`, `memory/glossary.md` (+ its three translations) and `docs/dashboard_layout.md` in step
   with behaviour changes. The glossary is served to users; the layout doc is a design reference.
2. Cron jobs are user-bound — reports are stored per user, and each account manages its own schedule in
   Command → Scheduled Jobs.

## Hosting & build

- **Live trading engine = Node.js via Vercel Cron (`/api/cron/dispatch`)** — the only engine. No Python, no
  GitHub Actions. There is no backtester: walk-forward was removed, not ported.
- **Dashboard** = React/Vite shell (`client/`) + ~30 classic-global `src/js/*.js` + 10 `src/css/*.css`.
  `server.js` serves `client/dist`, so `npm run build` before `npm start`. Vercel only — no `file://`.
- **`client/` is its own npm project, not a workspace.** Root build runs
  `npm --prefix client install && npm --prefix client run build` — the `install` half matters, or a fresh
  clone (Vercel) has no `vite`/`react`.
- React owns only the shell chrome; vanilla `switchTab()` owns all tab switching and loaders.
- **Postgres via `CRYPTOPROTRADER_POSTGRES_URL[_NON_POOLING]`.** All environments share one Supabase
  database (Suite rule 8), so accounts are already shared suite-wide. Auth/SSO/2FA live in `src/auth.js` +
  `src/db.js` + `src/totp.js`; `src/js/auth.js` is the client half, registered in `scriptLoader.js`'s
  `SCRIPT_ORDER`.
- **No third-party asset hosts** (Suite rule 26). Chart.js and `qrcode-lib.js` are vendored under `src/js/`
  with the version in the filename. No Trader HTML references an external host — keep it that way.
- The footer's date is build-stamped by `client/vite.config.js`'s `__BUILD_DATE__`; never type it.

## Cron engine

- **Two jobs: `evaluate` and `watchdog`.** Both touch `trader_state`.
- `src/cronRoutes.js` exposes `GET/POST /api/cron/evaluate|watchdog` and `GET /api/cron/dispatch`.
  **`GET` is the Vercel Cron contract** — requires the `CRON_SECRET` bearer header and runs for *every*
  tenant. **`POST` is the dashboard "Run now"** — requires a session and runs for *that caller's uid only*,
  rate-limited per uid.
- State and journal persist to Postgres (`trader_state` / `trader_journal`) because serverless has no
  local disk. `job_runs` is the audit trail and the concurrency lock — one `status='running'` row per job,
  enforced by a partial unique index.
- **Adjustable schedule:** `vercel.json` runs the dispatcher hourly (`0 * * * *`); it reads each job's
  `hour_utc` from `cron_config` and fires once that UTC hour arrives and it hasn't run today
  (`src/cronSchedule.js`'s `isJobDue()`). The individual `/api/cron/<job>` routes run unconditionally when
  hit directly — `hour_utc` gates the dispatcher only.
- **`CRON_EXECUTE=true` in production** — scheduled runs place real (paper) orders. This line is the
  authority; the Scheduled Jobs panel deliberately names no engine or env var so it cannot contradict it.
- `cron_config` is keyed `(uid, job)` — every account has its own schedule.

## Multi-tenant engine — standing rules

Breaking any of these stops the engine or crosses accounts.

- **`TRADER_CREDENTIALS_ENC_KEY` is Production-only, deliberately.** Preview/Dev having no key is the
  correct fail-closed state — they answer `configured: false` and 503 every credential write. **Do not
  "fix" this by adding keys there.** If Preview/Dev are ever used they need *different* values: all
  environments share one database, so a shared key would let a preview build decrypt production
  credentials. There is **no key-rotation path** — changing a key orphans every credential under it.
- **Check `GET /api/alpaca-credentials` → `configured` before assuming credentials can be stored.** `false`
  means unset *or* not decoding to exactly 32 bytes — `Buffer.from(x,'base64')` silently drops invalid
  characters, so a mangled paste reads as "not configured" rather than erroring. A Vercel variable can also
  exist but never have been *connected to the project*.
- **Isolation is per-row (`(uid, mode)` upsert), not per environment.** Outside Production always sign in
  as a throwaway account — `vercel dev` hits the production database. `key_fp`/`KeyMismatch` make a
  violation legible; they do not prevent it.
- **Migrate before deploying, and re-run the migration once the new build is confirmed serving.** An old
  build cold-starting during the deploy window re-runs its `init()` and *resurrects* dropped legacy
  indexes. Direction matters: new-code-on-old-schema makes evaluate run on `EMPTY_STATE()` and place orders
  blind; old-code-on-new-schema fails at `startJobRun` before any order.
- **Every `db.js` engine accessor takes the uid first and throws `TypeError` if missing** — no silent
  default, which would read or overwrite another tenant's positions.
- **`CONFIG_SPEC` (`src/userConfig.js`) enforces the hard rules against user JSON, and the resolver
  re-validates on every read** — an out-of-bound or locked value written straight into
  `trader_strategy_config` still never reaches a trading decision. Shorts, the streak throttle and every
  ships-OFF flag are **locked**, which is why `assertNotShipped()` need only check the compiled config.
  `PUT /api/strategy-config` is deliberately stricter than the read path: it rejects invalid input, where
  the engine merges `clean` and drops bad keys so one stale value can't stop a running engine.
- **`src/tenantEngine.js` is the single answer to "which account are we trading".** `tenantDeps()` injects
  **every** call individually — modules that don't read `deps.client` would otherwise stay on the legacy
  env-var account. A tenant with no or unreadable credential is **skipped with a reason, never run on the
  env-var account.**
- **Step-up auth guards *losing* access, not *adding* a key.** The account password is required on
  **delete** always, and on **replace** only when overwriting the credential the engine is trading with.
  **Connect and activate never require it** — that would put a password wall on the one step every new user
  must clear. Failed attempts spend a write-limit token, so the 20/hour/uid budget is also the
  password-guessing ceiling.
- The legacy env-var path stays functional indefinitely as an instant rollback.

## Hard rules — never break

- **Paper trading only; live Alpaca access is read-only** (Suite rule 23, EU MiCA). Reads stay open on live
  credentials so the dashboard still shows insights; placement and cancellation are paper-only. Enforced in
  two places, both failing closed on an unknown base URL: `alpacaClient.js`'s `assertPaperTrading()`
  (hostname must be exactly `paper-api.alpaca.markets`) and `api-config.js`'s `assertPaperTrading()` in the
  dashboard. Header shows a 🔒 badge while Live is selected.
- **Preserve ≥20% cash.** Per-symbol caps (`config.json › portfolio_caps.caps`, % of equity): BTC 30,
  ETH 15, ADA/SOL 10, DOGE 8, LTC/DOT 6, LINK/AVAX/AAVE 5, default 5.
- **Limit orders only** — ≤0.2% from ask; **0.5% base for stops, widening to 0.8% after 2 unfilled
  cycles**, clamped to the band edge, never self-rejected. **All orders go through `src/trade.js`**; direct
  API calls are forbidden. Stop dedup: check `getOpenOrders`, cancel-replace wider after 2 cycles.
  - **The clamp ceiling is the *escalated* band (`MAX_STOP_LOSS_BAND_PCT`), not the base one.** Clamping
    back to 0.5% erases the widening by construction and makes stops unfillable whenever the real spread
    exceeds the base band — which it does (AVAX and LTC have both measured >0.57%). `risk.js` stays the
    authority on which band applies at a given cycle, since `placeOrder` sees a price, not a cycle count.
- **Long stop = previous 4H swing low** (20 bars, ≤8% below entry; fallback −5%). Short stop = +5% adverse.
  Trailing stop arms at +2.5% profit and trails 3% below HWM. **Never move a stop away from entry.**
  - **HWM persistence is Postgres, not a file.** `src/positionState.js`'s `STATE_FILE` is the legacy/CLI
    path only — the serverless engine injects a no-op `saveState` and the caller persists to `trader_state`.
    Debugging a stale HWM by opening that file means reading an artifact of a path that no longer trades.
- **Partial TP at +1R:** sell 50%, remaining stop → breakeven (effective stop = max(swing low, breakeven)).
  Stale exit: >48h held, trail never armed, score <2.5. Rotation at full budget: candidate ≥4.0 and ≥2.0
  above the weakest holding ≤0 → swap, max 1/cycle.
- **Correlation budget: 7 total / 5 per tier** (Tier-1 = BTC, ETH). Gates entries only.
- **Net R:R entry gate: <1.0 blocks, <1.5 half-size** (target = BB upper minus round-trip cost, itself
  2×25 bps + spread).
  - **The gate FAILS CLOSED.** `netRr()` returns `null` when either leg is missing; skipping the check on
    null inverts the gate, because `target` is null precisely when the ask is at or **above** the BB upper
    band — the most extended setups, exactly what the gate exists to catch. A null `entryStop` must block
    too. Both causes are named separately in the reason string.
- **Streak throttle (ACTIVE):** 3 straight losing round-trips OR 7-day drawdown ≥5% → risk ×0.5; releases
  after 2 winners AND drawdown <2.5%.
- **Score gates:** long ≥3.5 full / ≥2.5 half (daily not downtrend); counter-trend half-long ≥4.0 in a
  downtrend; TA sell at ≤−2. **Shorts disabled** (Alpaca spot); cover logic stays at ≥+2 / +5% stop.
- **ATR sizing:** risk = equity×1%, stop dist = 1.5×ATR, qty = risk/dist, hard-capped by the symbol cap.
  **The 1% is nominal** — the position exits at the 4H swing low, 6–9× further away, so a loss can cost
  well over 1% of equity. See ROADMAP.md.
- **Ships-OFF flags**, guarded by `assertNotShipped()`: chandelier trail, pyramiding, conviction sizing,
  measured-move target, maker-first entries, breadth gate. The session-edge filter is **ON** (half-size in
  negative-expectancy GMT+2 buckets, ≥20-sample guard).

## Method

Top-down: daily regime (last vs SMA50 + SMA20 vs SMA50) → 4H structure (EMA20/50, the primary trend
filter) → 15-min execution. Only trade with the 4H *and* daily trend. Wyckoff: accumulation/mark-up =
long; distribution/mark-down = take profit or stay flat.

The **6-point Signal Confluence score** (`src/evaluateSymbol.js` + `src/indicators.js`) is EMA cross, MACD
histogram, RSI, Bollinger %b, volume ratio, 4H regime.

## Engine ↔ dashboard parity — the recurring bug class

The engine (`src/*.js`, Node) and the dashboard (`src/js/*.js`, browser) each implement the same logic.
Divergence between them has produced repeated shipped bugs, so:

- **`calcSignalScore()` (dashboard) and `signalScore()` (engine) must stay identical.**
  `src/scoreParity.test.js` enforces this — extend it rather than re-verifying by hand. It covers
  EMA seeding + dead zone, MACD partial credits, RSI rising rule, thresholds (3.5/2.5/4.0 — never
  `=== 3`), BB population std-dev, the volume sparse-tape guard, daily-regime SMA rule, bar completeness
  and recency, annualization 365, min 60 bars.
- **`MIN_TRADED_BARS` is mirrored in three places** — `config.json › indicators.min_traded_bars` is the
  source of truth, and `indicators.js` (deliberately config-free) and `ta-lib.js` (needs a value before
  config loads) each carry a literal. `scoreParity.test.js` fails if they drift.
- **Reconciliation parity:** the FIFO/flatness/dust-tolerance logic exists in both
  `src/js/edge-insights.js`'s `apReconcileFromFills()` (browser Autopilot) and `src/reconcile.js` (engine).
  **Any fix must be applied to both** — this pair is not yet covered by a test.
- **ADX/OBV are informational only** — never fold them into the score.
- **Never revert the FILL fetch to a single page.** Realized P&L must use `edgeFetchAllFills()` everywhere,
  so P&L and Backtest-vs-Live agree via `computeFifoStats()`.

## Measurement tools

- **`scripts/replay.mjs`** — drives the real `evaluateSymbol` over a sliding window of historical bars and
  reports score distribution, gate crossings, net-R:R stats and which gate decided each window. **Use it
  for any scoring or gating change; a single live scan is not a measurement.** Two fidelity rules make it
  trustworthy: higher-timeframe bars align by **timestamp, not index** (index alignment leaks future regime
  into every window), and `spreadPct` is **required with no default** because it feeds round-trip cost and
  therefore the R:R gate. **Not a backtester** — no fills, no P&L.
- **`scripts/compareTimeframes.mjs`** — compares execution timeframe / stop / target configurations over the
  **same wall-clock window**, since equal bar counts compare two market regimes rather than two timeframes.
  It self-checks against the engine's own `decision.netRr` and refuses to be trusted if that drifts.
- **Net R:R is geometry, not edge.** 2:1 at a 30% win rate still loses. Nothing in the project currently
  measures whether the score predicts direction — see ROADMAP.md item 1.

## Multi-language (EN/NL/FR/ES)

`client/src/i18n/` initialises i18next before render and also exposes a plain `window.t()` plus
`applyDomI18n(root)`, which walks `data-i18n`/`-html`/`-placeholder`/`-title`/`-tip` attributes — one
mechanism for both the JSX shell and the classic scripts. Language persists to `localStorage.dashLang` and
syncs via `/api/session`.

Runtime-rendered content goes through **`tt(ns, key, fallback, vars)`** in `utils.js` (24 namespaces,
1,125 keys × 4 languages) and re-renders on `lang-changed` via **`onLangChange(tabs, fn)`**, which gates on
`activeTab` so a switch never spends an Alpaca call on a hidden tab. Every `tt()` keeps its English literal
as the fallback, so a failed locale fetch degrades to readable English rather than raw keys.

**Five traps, each of which fails silently:**

- **Translate inside `kpi()`, never at its ~80 call sites.** It looks up `TILE_TIPS` by the English label,
  so a translated label blanks every tile tooltip in NL/FR/ES.
- **Never translate a value `ta-lib.js` or the engine emits as data** (`"uptrend"`, `"rising"`, the gap-go
  ratings). `scoreParity.test.js` diffs those strings and the colour maps index by them. Translate at render
  only: `ttRegime` / `ttTrendWord` / `ttAdxLabel` / `ggRating`.
- **A panel that caches rendered prose cannot re-render into a new language.** Cache i18n keys + params, not
  sentences — `ggAnalyze()` and `msRenderRows()` are the worked examples. Do the same for any panel whose
  loader is expensive.
- **`applyDomI18n()` owns a `[data-i18n]` node only until a script writes to it.** It assigns `textContent`,
  so placeholders a tab script later replaces were being wiped on every switch. It now records what it last
  wrote (`dataset.i18nApplied`) and skips nodes whose text no longer matches. **Do not "fix" a wiped panel
  by removing its `data-i18n`** — the placeholder should stay translated until the script renders. Pinned by
  `src/i18nDomGuard.test.js`.
- **A `data-i18n-html` block containing a script-written span must re-apply that value on `lang-changed`** —
  the block's innerHTML is replaced wholesale, resetting the nested value to its static placeholder
  (`tabs-markov.js`'s `#mkThreshLabel` is the example). This is distinct from the clobber above.

**Untranslated by design** (Suite rule 22): indicator abbreviations, the action codes BUY/HALF/BEAR/HOLD,
and Golden/Death cross. They route through `vocab` keys anyway so the decision is visible in the locale
files. Also English on purpose: the *offline* glossary snapshot in `tabs-glossary.js` (a degraded fallback —
four bundled copies would cost every user bytes on every load) and the glossary's Term column.

Weekday and month names come from `Intl` in the active language (`ttWeekdays`, `ttMonthLabel`). The GMT+2
job stamps in `tabs-command.js` deliberately stay `en-GB` — that column is fixed-width and must keep
aligning.

`src/i18nRuntimeKeys.test.js` pins the two silent failure modes: a `tt()` key missing from the locales, and
a key in `en.json` but not the other three. Extend it rather than checking by hand.

## Glossary — per-language rows in the database

`server.js` syncs four files (`memory/glossary.md` + `glossary.{nl,fr,es}.md`) into one row each on every
boot; `GET /api/glossary?lang=` serves them. **These four files are load-bearing — do not move or rename
them.** Three rules:

- **Rows share one table under a suffixed id** (`'trader'` = English, `'trader:nl'` etc.) with **no schema
  migration**. A composite `(id, lang)` key is tidier and was rejected: an old build cold-starting mid-deploy
  still runs `on conflict (id)` (no matching constraint → its boot sync throws) and `where id = 'trader'`
  (matches four rows, returns an arbitrary language).
- **Only English is section-extracted.** `extractGlossarySections()` matches the two *English* `##`
  headings, so a translated file run through it yields `""` and the tab silently falls back to English. The
  translations are serve-ready by design; a test asserts extraction returns `""` for them.
- **The Term column is the key and stays English in all four files**; only definitions translate. It is the
  lookup handle (users search for what the dashboard shows, e.g. `ATR`). **Adding a term means editing all
  four files** — `src/glossaryParity.test.js` fails on missing terms, reordering, or a definition left
  verbatim English.

## Dashboard

Left-sidebar nav (Command / Trade / Portfolio / Analysis / Settings) with hash deep links and
`localStorage.lastTab`. Command hosts the Autopilot loop plus News/Socials/Glossary/Scheduled Jobs
sub-tabs. Settings persist to `localStorage`, seeded from `config.json`.

- **Autopilot is a third, intentionally independent trading loop.** It runs only while a browser tab is
  open, reacting faster when the user is watching; the cron engine covers the gaps. Its orders are tagged
  `client_order_id` `ap-`, it is always OFF on page load, and the kill switch cancels all orders.
  `GET /api/trader-state` is **session-scoped** — the row holds one tenant's positions, so guests get the
  committed-file fallback — and lets Autopilot merge the cron engine's HWM/partial-TP/entry-time state
  regardless of which engine last acted.
- **Settings sync** (`src/js/settings-sync.js`) mirrors theme, last tab, watchlist, backtest defaults and
  the non-secret dashboard settings to Postgres via `/api/session`; server wins when it has data.
  **Deliberately local-only: Alpaca API keys/secrets and all `autopilotXxx` runtime keys.**
- **Account deletion** — the Danger zone soft-deletes the caller's own account; a soft delete blocks
  sign-in **suite-wide** instantly, and Suite's daily cron purges after 30 days. `db.js`'s
  `USER_DATA_TABLES` is the purge inventory (Suite rule 28). `job_runs` and `trader_credential_audit` are
  hard-deleted.
- **Privacy policy** states there is exactly one cookie and no tracking of any kind — a factual claim about
  this codebase, so anything adding storage, a processor or a retention change must update it (Suite rule
  27). Footer also carries a trading-risk disclaimer and a Terms of Service modal.
- **Plan entitlements — Trader is a Pro-tier project.** `requirePlan('pro')` (`src/auth.js`) gates
  `/api/alpaca-credentials`, `/api/strategy-config`, `/api/trader-state` and the session-scoped half of
  `/api/cron`, mounted in `server.js` as path prefixes *before* the route installers so sub-paths are
  covered by construction. Entitlement comes from **either** `accounts.role` (`admin`, or a manually
  granted `pro`) **or** `getPlan(uid)` — checking only `getPlan()` would lock admins out and make Suite's
  role grant do nothing. Denials are 401 (signed out) / 402 `upgrade_required` (not entitled) /
  **503 on an unexpected failure, never 402** — a paying user must not be told to upgrade because a query
  blipped. The decision is pure in `planGateStatus()` and pinned by `src/planGate.test.js`.
  - **`/api/cron` is gated by METHOD, and this is load-bearing.** **GET is never plan-gated** — it is the
    Vercel Cron contract, authenticated by the `CRON_SECRET` bearer with no session and no uid, so gating
    it would 401 the scheduler and stop the engine outright. POST ("Run now") and PUT (schedule) are
    session-scoped and are gated.
  - **The gate stops the API, not the work.** The dispatcher still runs *every* tenant's cron regardless of
    plan, so a free tenant still costs Alpaca calls and function time. Entitlement has not reached the
    engine yet — see ROADMAP.md item 7 for the Trader-side change, Suite's ROADMAP for the decision.

## Modules

- `src/scout.js` — promotes ≤3 uptrending high-confluence `*/USD` pairs (score ≥4) into
  `data/watchlist_dynamic.json` (TTL 6h, merged when `scout.enabled`). Analysis-only.
- `.claude/agents/market-researcher.md` — research/verification subagent; **invoke after every strategy
  change**. Writes reports to `data/market_research/`; never trades or edits code.

## Bugs

_None open._
