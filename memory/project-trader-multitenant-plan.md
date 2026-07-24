# Multi-tenant conversion plan (Node engine only)

Full design doc for converting CryptoPro Trader's Node engine from single-tenant (one Alpaca
account via env vars, one shared trading engine, one `TRADER_OWNER_UID` owner) to full
multi-tenant (each signed-in user connects their own Alpaca credentials and gets isolated
positions/journal/cron-schedule/strategy-config). Referenced from `CLAUDE.md`'s Roadmap item 2.

User-confirmed scope (2026-07-24): Node engine only (Python/GitHub Actions is being retired via
a separate in-progress cutover, untouched here); full per-user Alpaca credentials, not a shared
account; per-user strategy/risk config too, not just credentials.

Staged into 6 phases so each is independently shippable/testable/reviewable. Phase 1 shipped
2026-07-24 (see `memory.md`'s dated entry for the summary); phases 2-6 are designed below but not
yet implemented.

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

## Phase 2 — encrypted credential storage (not yet implemented)

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

## Phase 3 — per-user strategy/risk config (not yet implemented)

New table `trader_strategy_config(uid primary key, data jsonb, updated_at)`, mirroring `layouts`'
shape. New `resolveConfigForUser(uid)` merges a per-uid override row over the compiled-in
`config.json` defaults — `strategyConfig.js`/`risk.js` stay untouched as the "default layer."
`risk.js`'s ~20 pure functions already accept overrides as optional trailing parameters (e.g.
`checkLimitBand(limitPrice, ask, bid, limitBandPctOverride)`), so multi-tenant call sites just
pass the resolved values explicitly instead of relying on module defaults. `evaluateSymbol.js`/
`rotation.js`/`entrySizing.js` each need a mechanical change: accept one merged `cfg` object
(via their existing `deps`/options parameter) instead of reading `strategyConfig.js`'s bare
imports directly — a rename-in-place, not a structural rewrite. Legacy/CLI path (no uid) keeps
resolving to today's compiled constants — zero behavior change for anyone not opted in.

**Open judgment call:** threading ~20-30 distinct constants individually through function
signatures would be noisy — recommend one merged `cfg` object as a single new parameter/deps
field instead. Flag for confirmation when this phase starts.

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
