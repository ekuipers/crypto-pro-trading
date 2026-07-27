# Multi-tenant conversion plan (Node engine only)

Full design doc for converting CryptoPro Trader's Node engine from single-tenant (one Alpaca
account via env vars, one shared trading engine, one `TRADER_OWNER_UID` owner) to full
multi-tenant (each signed-in user connects their own Alpaca credentials and gets isolated
positions/journal/cron-schedule/strategy-config). Referenced from `CLAUDE.md`'s Roadmap item 2.

User-confirmed scope (2026-07-24): Node engine only (Python/GitHub Actions is being retired via
a separate in-progress cutover, untouched here); full per-user Alpaca credentials, not a shared
account; per-user strategy/risk config too, not just credentials.

Staged into 6 phases so each is independently shippable/testable/reviewable. Phases 1-3 have shipped
(1 on 2026-07-24, 2 and 3 on 2026-07-27 — see `memory.md`'s dated entries); phases 4-6 are designed
below but not yet implemented.

---

## Phase 1 — DONE (2026-07-24): credential-injection seam in the Alpaca HTTP layer

**Problem:** `src/trade.js` read `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`/`APCA_BASE_URL` as
module-level constants at import time — every exported function closed over these, so there was
no way to run the same trading logic against two different Alpaca accounts in one process.

**Fix — factory + legacy shim, not a breaking rewrite:**

1. New `src/alpacaClient.js` — `createAlpacaClient({keyId, secret, baseUrl, dataUrl, symbolCap})`
   returns `{headers, getMarketStatus, getAccount, getPositions, getLatestQuote, placeOrder,
   getOpenOrders, getOrder, cancelOrder, cancelAllOrders, baseUrl, dataUrl}`. Also exports
   `TradeRejected` and the credential-free `isCrypto(symbol)` helper. Every CLAUDE.md hard rule
   (limit-only orders, band %, position cap) moved here verbatim — mechanical relocation, not a
   logic change. `symbolCap` is injected as a resolver function rather than read from
   `config.json` directly, since credential scope and config scope are deliberately kept separate
   (per-user config is Phase 3's concern).

2. `src/trade.js` is now a thin legacy shim: builds `defaultClient = createAlpacaClient({...env
   vars...})`, destructures the same named exports from it (`export const {getAccount,
   getPositions, ...} = defaultClient`). Every existing `import {getAccount} from "./trade.js"`
   call site (all 305 tests, CLI scripts) keeps working unchanged — same function objects, still
   env-var-bound. `loadCaps()`/`CAPS_DATA`/`symbolCap()` (portfolio caps from `config.json`) stay
   in `trade.js` untouched.

3. `src/marketData.js`/`src/reconcile.js`/`src/scout.js` extended with an optional
   `{client = defaultClient}` field on their existing trailing-options-object convention, replacing
   direct `BASE_URL`/`DATA_URL`/`headers` imports from `trade.js` with `client.baseUrl`/
   `client.dataUrl`/`client.headers()`. `scout.js`'s own dead duplicate `BASE_URL` read (never
   actually reused) was deleted in the same pass.

4. Closed a latent gap in `src/runEvaluation.js`: `main()`'s own `deps` already overrode
   top-level calls (`getPositions`, `getAccount`, etc.), but its calls to `evaluateSymbol()` and
   `applyRotation()` had **no credential-override seam at all** — those two would have silently
   kept trading on the env-var account even if every other dep were swapped for a per-user one.
   Both already had a `deps`/options parameter internally (no signature change needed); added a
   `client = deps.client || defaultClient` binding in `main()` and a `symbolDeps` object
   (`getLatestQuote`/`getOpenOrders`/`cancelOrder`/`getAccount`/`getCryptoBars*`, all bound to
   `client`) threaded into both calls.

**Files touched:** `src/alpacaClient.js` (new), `src/trade.js`, `src/marketData.js`,
`src/reconcile.js`, `src/scout.js`, `src/runEvaluation.js`. Zero schema/route/behavior changes.

**Verified:** full 305-test suite — 297 pass / 8 fail, and the failing set is byte-for-byte
identical before and after (confirmed by diffing against a `git stash`-ed baseline run) — the 8
failures are pre-existing and unrelated (this environment's `.env` has no `APCA_BASE_URL` set, so
a handful of tests that don't stub every call hit a real "undefined/v2/..." URL error regardless
of this refactor). Grep confirms the only remaining `process.env.APCA_*` reads are in `trade.js`'s
legacy shim.

---

## Phase 2 — DONE (2026-07-27): encrypted credential storage

Shipped as designed below, with these deliberate deviations (all from the mandatory security
review — see `memory.md` v2026-07-27.1):

1. **AAD binding added.** `encryptSecret`/`decryptSecret` now take a required `aad` argument
   (`credentialAad(uid, mode)` = `v1|<uid>|<mode>`). Without it the tag authenticates the bytes but
   not the row, so anyone with database *write* access could copy a victim's ciphertext into their
   own row and have the engine trade the victim's Alpaca account — a confused deputy that never
   requires breaking GCM. Done now while the table is empty; retrofitting later needs a re-encrypt
   migration. This also covers `enc_version`, which is otherwise written but never read.
2. **`baseUrl` is not trusted from the ciphertext.** It is derived from `mode` at write time
   (`ALPACA_HOSTS`, now exported from `alpacaClient.js` next to `isPaperTradingUrl` so the paper
   host literal exists exactly once), validated again in `putAlpacaCredential`, and *re-derived*
   from the `mode` column in `getActiveAlpacaCredential`. It is the value `assertPaperTrading()`
   keys on, so it must come from a server-side constant, never from stored data or a client body.
3. **Rate limiting.** `auth.js`'s sliding-window helper was extracted to `src/rateLimit.js` and
   applied per-uid (20 writes/h, 120 reads/h). Registration is open suite-wide and the pg pool is
   `max: 5`, so an authenticated flood of locking transactions could otherwise starve the session
   lookups that decide whether *anyone* is signed in.
4. **Concurrency.** `tx()` sets `statement_timeout`/`idle_in_transaction_session_timeout` via
   `SET LOCAL` (survives Supabase's transaction-mode pgbouncer, unlike a connection-level option),
   takes `pg_advisory_xact_lock` per uid before flipping `active`, uses `select … for update` in
   `setActiveAlpacaMode`, and returns the final UPDATE's `rowCount` — the original design could
   report success while leaving the user with zero active credentials (which, per Phase 5's
   no-fallback rule, silently stops their engine including the stop watchdog).
5. **`tradingEnabled`** added to the metadata shape (`mode === 'paper'`) so Phase 5's dispatcher and
   Phase 6's UI key on one field instead of each re-deriving the paper-only hard rule.

**Deferred, with reasons (pick up in Phase 6):**

- Step-up authentication (require the account password) on credential write/delete. The codebase
  sets that precedent for disabling 2FA. Deferred because it changes the API contract the Phase 6
  UI is built against — decide it with the UI, not before.
- A credential audit *table*. Successful mutations currently log one line (uid + mode, never the key
  preview or body); a queryable trail belongs with Phase 4's schema work.
- `deleteAlpacaCredential` goes through `q()`'s transient-retry loop, so a connection reset after a
  committed DELETE can return a confusing 404. Low impact, no data risk.
- Deleting the active credential leaves the user with nothing active and no promotion/warning.
  Phase 6 should surface an active-count.

**Ops note:** `TRADER_CREDENTIALS_ENC_KEY` must differ per Vercel environment — add the variable
three times, each scoped to exactly one environment (Vercel's form pre-ticks all three, which is how
a shared key happens). One key + the shared Supabase database means any preview build of any branch
could decrypt every stored production credential.

**Follow-up shipped 2026-07-27 (`memory.md` v2026-07-27.3):** because all environments share one
database, per-environment keys make the isolation boundary the `(uid, mode)` ROW, not the
environment. `putAlpacaCredential` upserts, so writing the same row from two environments replaces
the ciphertext and the other environment reads it as a generic `DecryptFailed` — which Phase 5 treats
as "disconnected", silently stopping that user's engine. `vercel dev` runs against the production
database, so this is live, not theoretical. Mitigations now in place: a nullable `key_fp` column
records which key wrote each row, `decryptSecret` raises `KeyMismatch` (a `DecryptFailed` subclass,
so refuse-to-trade is unchanged) naming both fingerprints, and `listAlpacaCredentials` returns
`readableHere` for the Phase 6 UI. **This diagnoses, it does not prevent** — the operational rule is
"outside Production, never sign in as your real account; use a test uid". Phase 6's UI should surface
`readableHere: false` prominently, and Phase 5's dispatcher should log `KeyMismatch` distinctly from
an ordinary missing credential.

Original design, as implemented:

New `src/secretsCrypto.js`: AES-256-GCM via Node's built-in `crypto` module (no new dependency).
`encryptSecret(obj) -> base64`, `decryptSecret(b64) -> obj`. Key from new env var
`TRADER_CREDENTIALS_ENC_KEY` (32 random bytes, base64) — **read lazily inside the encrypt/decrypt
functions, never cached as a module-level constant** (that pattern is exactly the anti-pattern
Phase 1 removed from `trade.js`). Missing key ⇒ throw ⇒ routes fail closed (503), matching
`db.js`'s `dbEnabled()` convention. Key rotation is explicitly out of scope; `enc_version` column
is a forward hook only.

New table:
```sql
create table if not exists trader_alpaca_credentials (
  uid          text not null references accounts(id) on delete cascade,
  mode         text not null check (mode in ('paper','live')),
  active       boolean not null default false,
  key_preview  text not null,        -- last 4 chars of the Alpaca key id, plaintext, UI display only
  ciphertext   text not null,        -- base64(iv[12] || authTag[16] || AES-256-GCM({keyId, secret, baseUrl}))
  enc_version  integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (uid, mode)
);
create unique index if not exists trader_alpaca_credentials_active_uidx
  on trader_alpaca_credentials (uid) where active;
```
Both paper and live are supported per user (two rows); exactly one may be `active`.

New `src/db.js` accessors mirroring the existing `getLayout`/`putLayout` upsert idiom:
`listAlpacaCredentials(uid)` (metadata only, safe to serialize to a client), `getActiveAlpacaCredential(uid)`
(decrypts — server-internal only, must never flow into a JSON response), `putAlpacaCredential(uid, mode, {keyId, secret, baseUrl}, makeActive)`,
`setActiveAlpacaMode(uid, mode)`, `deleteAlpacaCredential(uid, mode)`.

New `src/credentialsRoutes.js`: `GET/POST/DELETE /api/alpaca-credentials/:mode`,
`POST /api/alpaca-credentials/:mode/activate` — all require `currentUid(req) !== db.GUEST`.

**Mandatory security-reviewer pass before merge** (new auth/crypto surface, per the user's global
security rules) — focus on IV uniqueness per encryption call, authTag-failure handling ("treat as
disconnected," never crash/ignore), and an explicit audit that every route projects through the
metadata-only shape, never the decrypted one.

## Phase 3 — DONE (2026-07-27): per-user strategy/risk config

Shipped as designed, with the merged-`cfg`-object approach (the open judgment call below) confirmed
by the user at phase start. Two premises in the original text were wrong and are corrected here:

1. **`risk.js`'s functions did NOT already accept overrides.** The plan cited
   `checkLimitBand(limitPrice, ask, bid, limitBandPctOverride)` as evidence; the real signature was
   `checkLimitBand(limitPrice, ask, bid = null)` reading the module-level `LIMIT_BAND_PCT`. Eight
   functions needed new trailing override params: `checkLimitBand`, `shouldStopOut`,
   `shouldCoverShort`, `stopLossPrice`, `shortStopPrice`, `effectiveStopPct`, `tierCount`,
   `correlationBudgetAllows` (the last two had no way to override `TIER1_SYMBOLS` at all).
2. **The blast radius was 8 modules, not 3.** Beyond `evaluateSymbol`/`rotation`/`entrySizing`, the
   conversion also had to cover `runEvaluation`, `stopWatchdog`, `reconcile`, `journal`, and
   `alpacaClient` — 179 bare constant reads in total.

**What shipped:** new `src/userConfig.js` — `DEFAULT_CFG` (compiled `config.json` flattened, keeping
the old UPPER_SNAKE names so each conversion is a mechanical `X` → `cfg.X` rename and stays greppable),
`CONFIG_SPEC`, `EDITABLE_KEYS`, `validateOverrides`, `mergeConfig`, `cfgSymbolCap`,
`resolveConfigForUser`. New table `trader_strategy_config(uid pk, data jsonb, updated_at)` +
`get/put/deleteStrategyConfig` in `db.js`. Consumers take `cfg` through their existing `deps`/options
parameter, defaulting to `DEFAULT_CFG`.

**Design decision worth keeping:** the resolver re-validates on **every read**, not just on write.
`putStrategyConfig` is storage-only and deliberately unvalidated, so the guarantee "an out-of-range or
locked value cannot reach a trading decision" holds even against a row edited directly in the database
— verified end-to-end. An invalid key degrades to its default and is reported rather than failing the
resolve, because a bad config row must not be able to stop a user's engine (including the stop
watchdog).

**Hard rules are enforced as CONFIG_SPEC bounds** — 0.2% limit band, 0.5% stop band, ≤30% symbol cap,
≤2% risk/trade, 7 total / 5 per-tier, ≤8% swing-low stop; a user may tighten, never loosen. Shorts,
the streak throttle, and every unported ships-OFF flag are **locked** (rejected outright), which is
what lets the existing module-load `assertNotShipped()` guards keep checking only the compiled config.

**Latent multi-tenant bugs found and fixed in passing** (both would have surfaced in Phase 5):
`reconcile.js`'s session-penalty cache was an unkeyed module-level singleton — the dispatcher loops
every user inside one serverless invocation, so user B would have inherited the buckets computed from
user A's fill history; it is now keyed by `cacheKey`. And `runEvaluation.js` called
`sevenDayDrawdown()` without `client`, so one user's drawdown would have driven another's streak
throttle.

**Self-review findings, fixed before commit:** `Number(value)` coercion accepted a quoted `"4.0"` and
coerced `true` → 1 (now a strict `typeof` check); cross-field conflicts were reported but still
applied, since `mergeConfig` applies `clean` regardless of `ok` (conflicting pairs are now deleted
from `clean`); `CONFIG_SPEC[key]` resolved inherited members so `__proto__`/`constructor` bypassed the
unknown-key error (now `Object.hasOwn`, same in `cfgSymbolCap`).

**Not done, carry into Phase 6:** no HTTP route writes a config row. The Phase 6 editor route must
call `validateOverrides` and reject on `!ok` rather than relying on the resolver's degrade-to-default
behaviour, and should get the agent-based security-reviewer pass that Phase 2 had (this phase's review
was done inline; agent use was disabled in the session that shipped it).

Original open judgment call, resolved: threading ~20-30 distinct constants individually through
function signatures would be noisy — one merged `cfg` object as a single deps field was recommended
and chosen.

## Phase 4 — schema migration + one-time data backfill (not yet implemented)

- `trader_state`: `id text PK default 'trader'` → `id` becomes the uid itself (drop the default,
  parameterize `getTraderState`/`putTraderState`).
- `trader_journal`: `day text PK` → composite `(uid, day)`.
- `job_runs`: add `uid`; concurrency lock's partial unique index changes from `(job)` to
  `(job, uid)` — **without this, two different users' jobs would contend for the same lock and
  block each other**, a correctness bug that's latent today with only one user.
- `cron_config`: `job text PK` → composite `(uid, job)`; `updated_by_uid` becomes redundant and
  can be dropped.
- One-time **manual** SQL backfill (not part of `db.js`'s idempotent `init()`) attributing all
  existing global rows to the current owner's uid — run during a maintenance window with
  `CRON_EXECUTE` confirmed off and a `pg_dump` of the 4 tables taken immediately before.

## Phase 5 — cron dispatcher rewrite, highest-risk phase (not yet implemented)

`cronRoutes.js`'s `handleDispatch` loop becomes nested: for each job, for each uid with an active
credential **and** that job enabled in their own `cron_config` row (new
`db.getEnabledUidsForJob(job)` joining `trader_alpaca_credentials` + `cron_config`).
`executeJob`/`runEvaluate`/`runWatchdog`/`runDailySummary` all gain a `uid` parameter, threading a
per-user `createAlpacaClient(...)` into `deps` (via Phase 1's seam) plus uid-scoped
`getTraderState`/`putTraderState`/`appendTraderJournal`. **If a user has no active credential,
skip with a clear reason — never fall back to the legacy env-var client** (would silently trade
one user's schedule against another's account).

Phase 3 added the config half of the same seam: each per-user run must also pass
`deps.cfg = (await resolveConfigForUser(uid)).cfg` and `deps.cacheKey = uid`. **Both matter.**
Omitting `cfg` silently runs that user on the compiled defaults instead of their own strategy;
omitting `cacheKey` hands them the session-penalty buckets of whichever user the loop processed
first. Log the `errors` array `resolveConfigForUser` returns — it is how a user learns their stored
config had a key rejected. Note `createAlpacaClient` takes `cfg` too (its two order-band rules), so
the per-user client must be built from the resolved config, not `DEFAULT_CFG`.

`isOwner`/`TRADER_OWNER_UID` gating on the manual-trigger/config routes is replaced by
`requireSelf` (any signed-in user manages only their own rows).

**Open judgment call:** recommend keeping `TRADER_OWNER_UID` around, repurposed as an optional
admin/diagnostic override (e.g. a read-only "view any user's job history" route), rather than
deleting it outright. Confirm with the user when this phase starts.

Ships with `CRON_EXECUTE` forced false through a shadow-run verification window, mirroring the
original Python→Node cutover's parity-gate discipline (see `project-trader-node-cutover-gates.md`
in the global auto-memory).

## Phase 6 — dashboard UI (not yet implemented)

Extends `client/src/tabs/settings.html` with a new, visually distinct "☁ Server-Side Trading
Engine" credential section (write-only fields, masked "•••• connected" badge from
`listAlpacaCredentials`, never pre-filled) — kept clearly separate from the existing browser-only
Alpaca fields (those already work per-browser via `localStorage`, untouched). A JSON-textarea
config editor (not a full field-by-field form — that's a larger separate follow-up) pre-filled
with `resolveConfigForUser`'s merged output. The "☁ Scheduled Jobs" sub-tab (`tabs-command.js`)
needs **zero UI changes** — it already calls `GET /api/cron/status` unconditionally and shows a
friendly message on 401; once the backend gate changes from `isOwner` to `requireSelf` in Phase
5, the same UI transparently becomes "your own jobs" for any signed-in user.

**Open judgment call:** JSON textarea vs. a full field-by-field form for the config editor (~30
fields) — plan assumes the textarea for the first cut, a form is a larger separate UI project.

## Rollout safety (phases 4-5)

The existing owner has live paper-trading positions today. Recommended sequence once Phase 4
lands: the owner becomes the *first* multi-tenant user (migrate their own global rows to their
own uid, connect their existing `.env` keys through the new Phase 6 UI, verify identical
behavior) before any other Suite account is invited to connect. Keep the legacy env-var
`defaultClient` and CLI path (`npm run evaluate`) fully functional indefinitely as an instant
rollback — Phases 1-3's changes are purely additive and don't remove it.
