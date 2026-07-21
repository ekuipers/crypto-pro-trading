# CryptoPro Trader
Description: Professional cryptocurrency trading & analytics platform. 
Creator: Erik Kuipers.
Year: 2026

> **Detail archive:** this file was compacted 2026-07-19. The complete pre-compaction text (full
> hard-rule tables with config keys, bug histories, dashboard tab specs, Node-port table, parity
> checklist) lives in **`memory/claude_md_archive.md`** — consult it before changing anything below.

# Workflow rules
> Master rules shared across all CryptoPro sub-projects: [CryptoPro Suite CLAUDE.md](https://github.com/ekuipers/crypto-pro-suite/blob/main/CLAUDE.md)

1. Keep a maximum of 2 months of journals and reports.
2. **Standing rule:** after every change (code, dashboard, config, scripts) update `CLAUDE.md`, `README.md`, `memory/memory.md`, `memory/glossary.md`, and — for dashboard changes — `docs/dashboard_layout.md`. No exceptions.

## Roadmap

## Bugs


## Hosting & frontend
- Live trading engine = Python via GitHub Actions cron (`.github/workflows/*.yml`); hosting concerns the dashboard only.
- Dashboard = React/Vite shell (`client/`) + 30 unchanged classic-global `src/js/*.js` files + 10 `src/css/*.css`. `server.js` serves `client/dist` (`npm run build` first, then `npm start`/`npm run dev`). No `file://` or GitHub Pages; Vercel works.
- `client/` is its own npm project, not an npm workspace — root `npm run build` runs `npm --prefix client install && npm --prefix client run build` (not just `... run build`) so a fresh clone (Vercel) installs `client/`'s own `vite`/`react` deps before building. Fixed 2026-07-19 after Vercel failed with "vite: command not found"; details `memory/memory.md`.
- React owns only the shell chrome; vanilla `switchTab()` owns all tab switching/loaders. Browser click-through **not yet verified** — exercise Autopilot toggle, Settings save, and every tab before relying on it. Details: archive › Dashboard.
- **Auth / SSO (2026-07-19):** `src/auth.js` + `src/db.js` + `src/totp.js` (ported from CryptoPro Charts/Suite) add a `👤 Sign in` header button — username/password + optional TOTP 2FA, accounts/sessions in Postgres. `db.js`'s `CONN_VARS` prefers `DBCRYPTOCHARTS_POSTGRES_URL[_NON_POOLING]` (the suite-shared DB) over this project's own pre-existing `trading_POSTGRES_URL*` vars, so accounts are shared suite-wide — **but only once the deployed env actually points at Charts' Supabase project**; that's a Vercel dashboard step, not done yet (see `.env.example`). Client: `src/js/auth.js` (classic script, added to `client/src/scriptLoader.js`'s `SCRIPT_ORDER`) + `#authModalBackdrop` in `client/src/fragments/modals.html`.
- **User manual (2026-07-22, Suite roadmap item 1):** `📖 Help` button (`❓`, `client/src/components/Header.jsx`, next to the theme toggle) opens `#manualPanel` — an off-canvas panel that unfolds from the left (`src/css/manual.css`, `.manual-overlay.open`), consistent with the panel Charts already ships. Content is a static `MANUAL_SECTIONS` array in `src/js/manual.js` (classic global script, added to `scriptLoader.js`'s `SCRIPT_ORDER`) covering every tab group plus Account/sign-in and keyboard shortcuts, with a left-rail TOC and a live search box filtering by title/body. No markdown fetch, no network call — content is hand-written and ships with the bundle.
- **Cross-project SSO ticket (2026-07-20):** `db.createSsoTicket`/`consumeSsoTicket` + a `POST /api/auth/sso-ticket` route and an `?sso=<token>` consume middleware in `src/auth.js` (single-use, 60s TTL) let this app accept an auto-sign-in handoff from a sibling CryptoPro app — same shared `sso_tickets` table, ported identically to Charts/Training/Suite. Suite's landing page is the only issuer today; this app only consumes. Details: `memory/memory.md` v2026-07-20.1, full cross-repo narrative in `CryptoPro Suite/memory/memory.md`.

## Node.js port (Phase 3 complete — NOT wired to production)
- `src/*.js` ports order execution + the evaluation loop incl. scout, plus (2026-07-21) `stopWatchdog.js` and `dailySummary.js` — every script the GitHub Actions workflows call now has a Node equivalent (305 tests, `npm test`; `npm run evaluate` dry-run). Live engine is still 100% Python.
- Cutover gated on 4 checks — status as of 2026-07-21 (cutover session):
  1. **Decision parity — evidence gathered, not a true frozen-fixture replay.** Python doesn't support injected fixtures (no dependency-injection design like Node's `deps`), so `scripts/verify_decision_parity.py`/`.mjs` instead call `evaluate_symbol()`/`evaluateSymbol()` directly (bypassing state/journal writes entirely — read-only) against the SAME live positions/account/market data, run concurrently. Two concurrent trials: **10/10 watchlist symbols matched exactly** on action + every indicator field. A first *sequential* trial showed BTC/ETH mismatches, traced to a one-bar timing skew between the two process calls on the two most actively-traded pairs (not a logic bug) — confirmed by the concurrent re-runs matching exactly. See `memory/memory.md` v2026-07-21.8.
  2. **≥24h live shadow-run parity — NOT satisfied yet, clock started 2026-07-21.** New `.github/workflows/node-shadow-run.yml` runs independently of `trade.yml` (offset schedule, own concurrency group, never touches `positions_state.json`/`journal/*.md`/order placement) every 8h, diffs Python vs Node decisions, and appends to `data/shadow_run_log.jsonl` (`scripts/shadow_run_diff.py`). Seeded with 3 session comparisons (0 mismatches in the 2 concurrent ones) but **this requires real elapsed wall-clock time and multiple independent automated cycles — do not treat as passed until the log shows ≥24h of clean automated runs.**
  3. **State-file round-trip Python↔Node — PASSED.** `scripts/verify_state_roundtrip.py` round-trips the real committed state plus a synthetic fully-populated position through the actual `load_state()`/`save_state()` (Python) and `loadState()`/`saveState()` (Node) — both directions lossless.
  4. **Vercel function execution-time budget — risk found and fixed, unverified in production.** Local dry-run timing: `runEvaluation.main` ~37.7s, `stopWatchdog.main` ~0.1s, `dailySummary.main` ~1.6s (`debug/time_cron_jobs.mjs`). `/api/cron/dispatch` awaits due jobs **sequentially in a loop**, so a hour where all three are due could sum to ~40s — and `vercel.json` had no `maxDuration` configured, meaning Vercel's low default timeout would likely 504 this in production. Fixed: `vercel.json` now sets `functions."server.js".maxDuration: 120` (Pro plan allows up to 300s). Local timing is a proxy only — an actual Vercel deployment test is still needed to fully close this gate.
  - `-- --execute` / `CRON_EXECUTE=true` still NOT recommended — gate 2 alone blocks it, needs real elapsed time, not more engineering.

## Cron cutover (Suite roadmap, "For Trader only", 2026-07-21 — NOT live yet)
- `src/cronRoutes.js` (`GET/POST /api/cron/evaluate|watchdog|daily-summary`, plus `GET /api/cron/dispatch`) runs the Node engines as Vercel Cron-triggered serverless functions instead of GitHub Actions. `GET` (the Vercel Cron contract) requires the `CRON_SECRET` bearer header; `POST` (dashboard "Run now") requires signing in as the single `TRADER_OWNER_UID` account — see `.env.example`. State/journal persist to Postgres (`trader_state`/`trader_journal` tables in `src/db.js`, not `positions_state.json`/`journal/*.md`) since a serverless function has no persistent local disk; `job_runs` is the audit trail + concurrency lock (one `status='running'` row per job, DB-enforced via a partial unique index).
- **Adjustable schedule (2026-07-21 follow-up):** a single dispatcher (`/api/cron/dispatch`) reads each job's dashboard-configured `hour_utc` from `cron_config` and only runs it once that UTC hour arrives and it hasn't already run today (`src/cronSchedule.js`'s `isJobDue()`, unit-tested). The individual `/api/cron/<job>` routes are untouched and still run immediately/unconditionally when hit directly (manual trigger or direct bearer call) — `hour_utc` only gates the dispatcher.
- **Vercel plan upgraded to Pro (2026-07-21):** the Hobby plan's once-daily cron limit briefly blocked deployment (an hourly `vercel.json` entry was rejected at deploy time) and was worked around with a GitHub Actions hourly pinger (`cron-dispatch-ping.yml`). That workaround was Suite roadmap item #1 ("remove all GitHub workflow code, Vercel executes autonomously") in reverse, so the project was upgraded to **Vercel Pro** instead: `vercel.json`'s cron now runs `/api/cron/dispatch` natively every hour (`0 * * * *`), and `cron-dispatch-ping.yml` has been deleted — no GitHub involvement in triggering the dispatcher anymore.
- **Roadmap item #1 partially done:** the dispatcher no longer needs GitHub. `trade.yml`, `watchdog.yml`, and `forward.yml` still run the **live Python engine** on GitHub Actions and are intentionally NOT removed yet — they're the production trading engine, and retiring them means cutting over to the Node port, which is still gated on the 4-check parity process below. Removing them now would stop the live paper-trading loop. Full remaining scope tracked in Suite `CLAUDE.md` roadmap.
- **`CRON_EXECUTE` defaults unset/false — these routes are dry-run only today.** GitHub Actions stays the live engine until the Node.js port's 4-gate cutover checkpoint above passes; this exists so the infrastructure (routes, DB schema, dashboard panel) is built and testable ahead of that decision, not so it goes live automatically. Full analysis: `memory/memory.md` v2026-07-21.3/.4/.5/.6/.7.
- Command tab's "☁ Scheduled Jobs" panel (owner-only, `/api/cron/status`) shows last-run status per job, a per-job enabled toggle, an hour-of-day selector (UTC) for the adjustable schedule, and a manual "Run now" trigger. `cron_config.updated_by_uid` records who last changed a job's config — one shared schedule per job, attributed to the account that set it, not a separate schedule per account (this is a single-tenant trading engine).

# Coding instructions
1. **Think before coding** — state assumptions, surface tradeoffs and simpler alternatives, ask when unclear.
2. **Simplicity first** — minimum code that solves the problem; nothing speculative.
3. **Surgical changes** — touch only what the request requires; match existing style; clean up only your own orphans.
4. **Goal-driven** — define verifiable success criteria (tests) and loop until they pass.

# Trading agent
Autonomous paper-crypto agent on Alpaca. Crypto trades 24/7 — no weekday/market-clock gate. All times GMT+2.
**Always read `skills/crypto-trader/SKILL.md` before evaluating any trade.** Other skills: `crypto-catalysts` (news severity ladder — defensive only, never justifies an entry), `hourly-research`, `morning-brief`, `daily-journal`.

## Schedule
- **Hourly on the hour:** research every watchlist symbol per `skills/hourly-research-SKILL.md` (`Research HH:MM GMT+2` block).
- **Hourly at :23:** `scripts/run_evaluation.py --execute` (CADENCE WARNING if previous run >90 min old; state file committed every run).
- **Daily 03:00 UTC:** `scripts/stop_watchdog.py --execute` via `watchdog.yml` — open-long exit levels only. Throttled from the original every-5-min cadence 2026-07-20 to cut GitHub Actions minutes (`memory/memory.md` v2026-07-21.3).
- **Daily 23:21:** closing journal (`scripts/daily_summary.py` appends the Daily Summary block).

## Hard rules — never break (full table + config keys: archive › Hard Rules)
- Preserve ≥20% cash. Per-symbol caps (`config.json › portfolio_caps.caps`, % of equity): BTC 30, ETH 15, ADA/SOL 10, DOGE 8, LTC/DOT 6, LINK/AVAX/AAVE 5, default 5.
- **Limit orders only** (≤0.2% from ask; 0.5% for stops, clamped to band edge, never self-rejected). **All orders via `scripts/trade.py`** — direct API calls forbidden. Stop dedup: check `get_open_orders`, cancel-replace wider after 2 cycles.
- Long stop = previous 4H swing low (20 bars, ≤8% below entry; fallback −5%). Short stop = +5% adverse. Trailing stop arms at +2.5% profit, trails 3% below HWM (persisted in `data/positions_state.json`). Never move a stop away from entry.
- Partial TP at +1R: sell 50%, remaining stop → breakeven (effective stop = max(swing low, breakeven)). Stale exit: >48h held, trail never armed, score <2.5. Rotation at full budget: candidate ≥4.0 and ≥2.0 above weakest holding ≤0 → swap, max 1/cycle.
- Correlation budget: **7 total / 5 per tier** (Tier-1 = BTC, ETH; Tier-2 = rest). BUDGET EXCEEDED warning when positions exceed it (budget gates entries only). Net R:R soft entry gate: <1.0 block, <1.5 half-size (target BB-upper minus round-trip cost = 2×25 bps + spread).
- Streak throttle (**ACTIVE**): 3 straight losing round-trips OR 7-day drawdown ≥5% → risk ×0.5; releases after 2 winners AND drawdown <2.5%.
- Score gates: long ≥3.5 full / ≥2.5 half (daily not downtrend); counter-trend half-long ≥4.0 in a downtrend. TA sell at ≤−2. **Shorts disabled** (Alpaca spot; cover logic stays at ≥+2 / +5% stop). Close any position flagged by research, before TA signals.
- ATR sizing: risk = equity×1%; stop dist = 1.5×ATR; qty = risk/dist; hard-capped by symbol cap. (Exit stop is the swing low, so realized risk can differ from 1%.)
- Ships-OFF flags — never enable without reading archive detail (`assertNotShipped()` guards the Node side): chandelier trail, pyramiding, conviction sizing, measured-move target, maker-first entries, breadth gate. Session-edge filter is **ON** (half-size in negative-expectancy GMT+2 buckets, ≥20-sample guard).
- Journal every day, even quiet ones ("No trades — reason: …").

## Method
- Top-down: daily regime (last vs SMA50 + SMA20 vs SMA50) → 4H structure (EMA20/50 = primary trend filter) → 15-min execution. Only trade with the 4H + daily trend. Wyckoff awareness: accumulation/mark-up = long; distribution/mark-down = take profit / stay flat.
- 6-point Signal Confluence score (auto-computed by `run_evaluation.py`): EMA cross, MACD histogram, RSI, Bollinger %b, volume ratio, 4H regime. Full table, entry/cover rules, decision checklist, sizing examples, common mistakes: archive.
- Log every evaluation to `journal/YYYY-MM-DD.md` (block format in archive › Output Format); one line per symbol on all-HOLD hours.

## Modules
- `scripts/scout.py` — promotes ≤3 uptrending high-confluence `*/USD` pairs (score ≥4) into `data/watchlist_dynamic.json` (TTL 6h, merged when `scout.enabled`). Analysis-only.
- `scripts/rebalance.py` — aligns positions to caps (over-cap SELL immediate; under-cap BUY gated by score ≥3 + regime). Manual; dry-run default, `--execute` to submit.
- `.claude/agents/market-researcher.md` — research/verification subagent; **invoke after every strategy change**; writes reports to `data/market_research/`; never trades or edits code.

## Dashboard (details: archive › Dashboard + `docs/dashboard_layout.md`)
- Left-sidebar nav (Command / Trade / Portfolio / Analysis / Settings), hash deep links + `localStorage.lastTab`. Command hosts the Autopilot loop (always OFF on page load; its orders tagged `client_order_id` `ap-`; kill switch cancels all orders) plus News/Socials/Glossary sub-tabs. Settings persist to `localStorage`, seeded from `config.json` (load-only fallback).
- **☁ Scheduled Jobs panel (2026-07-21, Suite roadmap — cron cutover; adjustable schedule same day):** Command tab, below Autopilot. Owner-only (`TRADER_OWNER_UID`); shows last-run status/time per job (evaluate/watchdog/daily-summary) from `/api/cron/status`, a per-job enabled toggle, an hour-of-day (UTC) schedule selector, and a "Run now" manual trigger. See "Cron cutover" above — dry-run only (`CRON_EXECUTE` unset) until the Node/Python parity checkpoint passes.
- **Settings sync (2026-07-21, Suite roadmap):** `src/js/settings-sync.js` mirrors theme, last tab, watchlist, backtest-form defaults, and the non-secret parts of dashboard settings (mode, position limits) to Postgres (`layouts` table, one row per account keyed by `db.SESSION_NAME`, via `/api/session` GET/PUT) so they follow the signed-in account across devices/browsers — server wins whenever it has data, same precedent as CryptoPro Charts' `persistence.js`. **Deliberately excluded, stays local-only:** Alpaca API key/secret (paper and live) and all `autopilotXxx` runtime keys (HWM, partial-TP, entry time, order age) — syncing live trading credentials or cross-device Autopilot bookkeeping was scoped out on purpose (memory/memory.md v2026-07-21.2).
- **Scoring parity:** `calcSignalScore()` (JS) must stay identical to `indicators.py signal_score()`. On any indicator change run the 15-point checklist (archive › Python ↔ Dashboard consistency check): EMA seeding + ±0.05% dead zone, MACD NaN-stripped signal line + partial credits, RSI rising rule, thresholds 3.5/2.5/4.0 (never `=== 3`), BB population std-dev, volume window excl. current bar, daily-regime SMA rule, ATR sizing, bar completeness (`end = now − 1 bar`) and recency, annualization **365**, min **60** bars, `STRAT_CFG` seeded from `config.json`, trade-economics function pairs.
- **Reconciliation parity (2026-07-20 lesson):** `reconcile_positions_from_fills()` exists in **3 places** — `scripts/run_evaluation.py` (Python live engine), `src/js/edge-insights.js`'s `apReconcileFromFills()` (browser Autopilot — places real orders independently whenever toggled on), `src/reconcile.js` (Node port). Any fix to the FIFO/flatness/dust-tolerance logic must be applied to all three — a Bug #9 fix landed in Python only first, and the browser Autopilot kept round-tripping real orders for another day before the other two copies were found. See `memory/memory.md` v2026-07-20.2.
- ADX/OBV are informational only — never fold into the score. Never revert the FILL fetch to a single page — realized P&L must use `edgeFetchAllFills()` everywhere (P&L, Backtest vs Live, journal all agree via `computeFifoStats()`).
