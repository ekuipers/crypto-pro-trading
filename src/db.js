// ============================================================
// DB — Supabase (Postgres) persistence for accounts & sessions
// ------------------------------------------------------------
// Ported from CryptoPro Charts/CryptoPro Suite so this project's login
// shares the same accounts database as the rest of CryptoPro Suite (Suite
// workflow rule 18 — single sign-on). Connects with the `pg` driver. Tables
// are created on startup via init(). Trader-specific data (positions,
// journal, etc.) is unaffected — this module only owns accounts/sessions.
// ============================================================
import pg from 'pg';
import { encryptSecret, decryptSecret, credentialAad, keyFingerprint, ENC_VERSION } from './secretsCrypto.js';
import { ALPACA_HOSTS } from './alpacaClient.js';

const { Pool } = pg;

// Sentinel uid for anonymous (not-signed-in) requests.
export const GUEST = '__guest__';
export const SESSION_NAME = '__session__';

// For accounts to actually be *shared* across the suite, this must resolve
// to the exact same Supabase Postgres project CryptoPro Charts uses. As of
// 2026-07-24 the Vercel Supabase integration issues per-project-prefixed
// vars (CRYPTOPROTRADER_*, CRYPTOPROCHARTS_*, ...) that all point at the
// SAME underlying Supabase project ref (confirmed by diffing this project's
// .env against Charts' — identical host/password) rather than one project
// aliasing another's var names, so CRYPTOPROTRADER_* is now the live source.
// DBCRYPTOCHARTS_*/`trading_*` are kept as fallbacks for instant rollback.
// See .env.example.
const CONN_VARS = [
  'CRYPTOPROTRADER_POSTGRES_URL',
  'CRYPTOPROTRADER_POSTGRES_URL_NON_POOLING',
  'DBCRYPTOCHARTS_POSTGRES_URL',
  'DBCRYPTOCHARTS_POSTGRES_URL_NON_POOLING',
  'trading_POSTGRES_URL',
  'trading_POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL',
];
function connString() {
  for (const v of CONN_VARS) if (process.env[v]) return process.env[v];
  return null;
}
export const dbEnabled = () => Boolean(connString());

// Supabase serves a cert that isn't in Node's default trust store, so use
// sslmode=no-verify (TLS on, chain not verified) rather than failing the chain.
function normalizeSsl(url) {
  return /sslmode=/.test(url)
    ? url.replace(/sslmode=[^&]+/, 'sslmode=no-verify')
    : url + (url.includes('?') ? '&' : '?') + 'sslmode=no-verify';
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: normalizeSsl(connString()),
      max: 5,
      // Supabase free-tier projects pause after inactivity and can take well
      // over 12s to wake on the first request after a nap.
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  }
  return pool;
}

// Query with retries on transient connection errors — a Supabase cold-start
// or brief pool exhaustion looks like one of these.
function isTransient(e) {
  const codes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', '57P01', '08006', '08003'];
  if (codes.includes(e.code)) return true;
  return /timeout/i.test(e.message || '');
}
async function q(text, params) {
  const delays = [300, 1500, 4000];
  for (let i = 0; ; i++) {
    try { return await getPool().query(text, params); }
    catch (e) {
      if (i >= delays.length || !isTransient(e)) throw e;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
}

/**
 * Runs `fn` inside a single transaction on one pooled client. Needed where a
 * partial unique index makes two writes mutually exclusive mid-statement —
 * e.g. flipping which Alpaca credential is `active`, which must clear the old
 * row before setting the new one or the index rejects the transient duplicate.
 * No retry wrapper: replaying half a transaction is worse than surfacing the
 * error to the caller.
 */
async function tx(fn) {
  const client = await getPool().connect();
  let poisoned = null;
  try {
    await client.query('begin');
    // Bound how long one transaction can hold a client from a 5-connection
    // pool: without these, a slow/stuck statement starves every other
    // request, including the session lookups that decide whether a user is
    // signed in. SET LOCAL (not a connection-level option) so this survives
    // Supabase's transaction-mode pgbouncer.
    await client.query(`set local statement_timeout = '15s'`);
    await client.query(`set local idle_in_transaction_session_timeout = '15s'`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      // The connection may still be inside an aborted transaction. Handing it
      // back to the pool would poison the next caller — release(err) makes pg
      // destroy it instead.
      poisoned = rollbackError;
    }
    throw e;
  } finally {
    client.release(poisoned || undefined);
  }
}

export async function init() {
  if (!dbEnabled()) { console.warn('[db] no Postgres connection string set — database disabled'); return false; }
  await q(`create table if not exists accounts (
    id            text primary key,
    username      text not null,
    display_name  text,
    salt          text not null,
    password_hash text not null,
    created_at    timestamptz not null default now(),
    last_login    timestamptz not null default now()
  )`);
  await q(`alter table accounts add column if not exists totp_secret text`);
  await q(`alter table accounts add column if not exists totp_enabled boolean not null default false`);
  await q(`alter table accounts add column if not exists password_changed_at timestamptz`);
  // Suite roadmap: optional email for notifications, unrelated to sign-in.
  await q(`alter table accounts add column if not exists notification_email text`);
  // Suite roadmap 2026-07-29: account deletion, ported identically across the
  // suite. Two-stage — `deleted_at` marks a soft delete (sign-in dies suite-wide
  // at once, the username stays reserved) and the scheduled purge in CryptoPro
  // Suite hard-deletes the data once the grace period expires. `is_blocked` is
  // added here too: the column is owned by Suite's admin backend, but this
  // project now enforces it, and rule 23 says each project must stand alone.
  await q(`alter table accounts add column if not exists deleted_at timestamptz`);
  await q(`alter table accounts add column if not exists deleted_by text`);
  await q(`alter table accounts add column if not exists is_blocked boolean not null default false`);
  await q(`create index if not exists accounts_deleted_at_idx on accounts(deleted_at) where deleted_at is not null`);
  await q(`create table if not exists sessions (
    sid        text primary key,
    uid        text not null references accounts(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await q(`create index if not exists sessions_expires_idx on sessions(expires_at)`);
  await q(`create table if not exists sso_tickets (
    token      text primary key,
    uid        text not null references accounts(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used       boolean not null default false
  )`);
  await q(`create index if not exists sso_tickets_expires_idx on sso_tickets(expires_at)`);
  // ---- Monetization phase 2 (Suite roadmap item 1): plan entitlements ----
  // Created identically in all four projects, same precedent as sso_tickets:
  // whichever app cold-starts first creates it, and each app still stands its
  // own database up alone (rule 23). Nothing gates on it yet — phase 4 adds
  // the requirePlan('pro') middleware. Every column except uid is owned by the
  // billing provider — Patreon — and written only by Suite's webhook (phase 3).
  await q(`create table if not exists subscriptions (
    uid                text primary key references accounts(id) on delete cascade,
    plan               text not null default 'free',
    status             text,
    current_period_end timestamptz,
    patreon_member_id  text,
    updated_at         timestamptz not null default now()
  )`);
  // ---- Migration 2026-07-31: stripe_customer_id -> patreon_member_id -------
  // The column shipped hours earlier under the old name, before billing moved
  // to Patreon. `create table if not exists` above skips an existing table
  // wholesale, so without this an already-created database would keep the old
  // name while a fresh one got the new — diverging silently.
  //
  // Done expand/contract, because the bare rename does not work: **`create
  // index if not exists` resolves its column list before it checks the index
  // name**, so the moment `stripe_customer_id` disappeared, any build still
  // carrying the old `create index … (stripe_customer_id)` threw in init() —
  // measured against the live database, not assumed. This is the same
  // deploy-window hazard as the `job_runs_running_uidx` resurrection in Phase 4,
  // from the other direction. The expand step therefore kept BOTH columns while
  // such builds could still cold-start.
  //
  // **Contract step, same day:** the vestigial column is now dropped and this
  // is the whole migration. Keep the rename guarded below anyway — it is what a
  // database created by a pre-rename build still needs, and it costs one
  // catalogue lookup per cold start. Zero data risk throughout: nothing has
  // ever written this column, and the table has no rows.
  await q(`do $$
    begin
      if exists (select 1 from information_schema.columns
                 where table_name = 'subscriptions' and column_name = 'stripe_customer_id')
      and not exists (select 1 from information_schema.columns
                 where table_name = 'subscriptions' and column_name = 'patreon_member_id')
      then
        alter table subscriptions rename column stripe_customer_id to patreon_member_id;
      end if;
    end $$`);
  await q(`alter table subscriptions add column if not exists patreon_member_id text`);
  await q(`alter table subscriptions drop column if exists stripe_customer_id`);
  // ---- One patron, one account -------------------------------------------
  // UNIQUE so a single Patreon member cannot be linked to several CryptoPro
  // accounts and hand Pro to all of them (Suite roadmap, phase 3). Postgres
  // permits many NULLs under a unique index, which is exactly right here: every
  // free account leaves this column NULL and only linked patrons are
  // constrained.
  //
  // `create unique index if not exists` would silently keep a pre-existing
  // NON-unique index of the same name, so the upgrade has to be an explicit
  // drop — guarded on `indisunique` so it happens once, not on every start. The
  // name is deliberately unchanged and provider-neutral: a build still running
  // `create index if not exists subscriptions_customer_idx` finds the name and
  // no-ops, instead of building a second, non-unique index alongside this one.
  await q(`do $$
    begin
      if exists (select 1 from pg_class where relname = 'subscriptions_customer_idx')
      and not exists (select 1 from pg_index i
                      join pg_class c on c.oid = i.indexrelid
                      where c.relname = 'subscriptions_customer_idx' and i.indisunique)
      then
        drop index subscriptions_customer_idx;
      end if;
    end $$`);
  await q(`create unique index if not exists subscriptions_customer_idx on subscriptions(patreon_member_id)`);
  // Dashboard settings sync (Suite roadmap: save user state — layouts,
  // progress, etc. — in the database so it follows the account across
  // devices/browsers). Same generic uid+name→jsonb shape CryptoPro Charts
  // already uses for its layouts table; here there's only ever one row per
  // user (SESSION_NAME) — no named/multiple saves. Deliberately excludes
  // Alpaca API keys/secrets and all live Autopilot runtime state (HWM,
  // partial-TP, entry-time, order-age) — see src/js/settings-sync.js for
  // exactly what is/isn't included and why.
  await q(`create table if not exists layouts (
    uid        text not null,
    name       text not null,
    data       jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (uid, name)
  )`);

  // Cron cutover (Suite roadmap, "For Trader only"): the Node evaluation/
  // watchdog engines run as Vercel Cron-triggered serverless
  // functions instead of GitHub Actions. A serverless function has no
  // persistent local disk across invocations, so positions_state.json and
  // journal/*.md move here.
  //
  // Multi-tenant, per-uid keying: all four
  // of these tables are now keyed by uid. The DDL below is the *target* shape,
  // which a fresh database gets directly. An existing single-tenant database is
  // reshaped by scripts/migratePhase4.mjs, which must be run BEFORE deploying
  // this code — `create table if not exists` cannot alter an existing table, so
  // init() alone would leave the old primary keys in place. checkPhase4Migrated()
  // below warns loudly if that hasn't happened.
  //
  // Deliberately NO foreign key to accounts(id): the engine's legacy uid
  // (LEGACY_ENGINE_UID) is a sentinel, not an account, and job_runs is an audit
  // trail that should survive an account deletion rather than cascade with it.
  await q(`create table if not exists trader_state (
    id         text primary key,
    data       jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  // Note: `id` now holds the owning uid rather than the fixed 'trader'
  // sentinel. Dropping the old column default is the migration script's job,
  // not init()'s — `alter table` takes an ACCESS EXCLUSIVE lock even when it
  // changes nothing, and init() runs on every serverless cold start.
  await q(`create table if not exists trader_journal (
    uid        text not null,
    day        text not null,
    content    text not null default '',
    updated_at timestamptz not null default now(),
    primary key (uid, day)
  )`);
  await q(`alter table trader_journal add column if not exists uid text`);
  // One row per job run — doubles as the audit trail git commits used to be
  // (job_runs.status='running' also acts as the concurrency lock: a job
  // already running blocks a second scheduled/manual trigger from starting).
  await q(`create table if not exists job_runs (
    id          bigserial primary key,
    uid         text not null,
    job         text not null,
    status      text not null default 'running',
    triggered_by text not null default 'cron',
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    detail      text
  )`);
  await q(`alter table job_runs add column if not exists uid text`);
  await q(`create index if not exists job_runs_uid_job_started_idx on job_runs (uid, job, started_at desc)`);
  // Partial unique index backing the concurrency lock: at most one 'running'
  // row per (job, uid) at the database level, so startJobRun's insert can be
  // atomic (ON CONFLICT DO NOTHING) instead of a check-then-insert that two
  // near-simultaneous requests could both pass (security review finding).
  //
  // The uid is part of the key as of Phase 4: on the old (job)-only index two
  // different users' evaluate runs would contend for one lock and block each
  // other, which is a correctness bug rather than just an isolation gap.
  await q(`create unique index if not exists job_runs_uid_running_uidx on job_runs (uid, job) where status = 'running'`);
  // Per-job enable/disable toggle + adjustable schedule the dashboard can
  // change without a redeploy — vercel.json's own cron entry just wakes the
  // hourly dispatcher (src/cronRoutes.js), which reads hour_utc from here to
  // decide whether a given job is actually due (src/cronSchedule.js).
  // One row per (uid, job) as of Phase 4: each user schedules their own jobs.
  // `updated_by_uid` is kept (rather than dropped as the plan sketched) because
  // dropping a column is irreversible and it still records *who* last wrote the
  // row, which stays meaningful if an admin override is added in Phase 5.
  await q(`create table if not exists cron_config (
    uid        text not null,
    job        text not null,
    enabled    boolean not null default true,
    hour_utc   integer,
    updated_by_uid text,
    updated_at timestamptz not null default now(),
    primary key (uid, job)
  )`);
  await q(`alter table cron_config add column if not exists hour_utc integer`);
  await q(`alter table cron_config add column if not exists updated_by_uid text`);
  await q(`alter table cron_config add column if not exists uid text`);
  // Suite roadmap: "Add glossary to the database instead of loading it from
  // a file." Same single-shared-row shape as trader_state — memory/glossary.md
  // stays the git-tracked, human/AI-edited source in full (Trader CLAUDE.md
  // workflow rule 2 still applies to it), but server.js extracts just the
  // "Acronyms & Abbreviations" + "Trading Terms" sections (src/glossaryExtract.js)
  // and syncs that into this row on every boot. server.js deliberately does
  // not statically serve memory/, which is why the tab reads /api/glossary
  // rather than fetching the file.
  await q(`create table if not exists glossary (
    id         text primary key default 'trader',
    content    text not null,
    updated_at timestamptz not null default now()
  )`);

  // Per-user Alpaca credentials:
  // per-user Alpaca credentials so the server-side engine can eventually run
  // one schedule per account instead of one shared env-var account.
  // `ciphertext` is an AES-256-GCM envelope (src/secretsCrypto.js) — a
  // database dump alone does not yield usable API keys. `key_preview` is the
  // only plaintext fragment (last 4 chars of the key id) and exists purely so
  // the UI can show *which* key is connected without ever decrypting.
  // A user may store both a paper and a live row; the partial unique index
  // enforces that at most one is `active` (the one the engine would use).
  await q(`create table if not exists trader_alpaca_credentials (
    uid          text not null references accounts(id) on delete cascade,
    mode         text not null check (mode in ('paper','live')),
    active       boolean not null default false,
    key_preview  text not null,
    ciphertext   text not null,
    enc_version  integer not null default 1,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (uid, mode)
  )`);
  await q(`create unique index if not exists trader_alpaca_credentials_active_uidx
           on trader_alpaca_credentials (uid) where active`);
  // Which TRADER_CREDENTIALS_ENC_KEY encrypted this row (non-secret digest —
  // see secretsCrypto.js's keyFingerprint). Production/Preview/Development
  // share one database but hold different keys, so a row written from one
  // environment is unreadable in another; without this the reader could only
  // report a generic "credential disconnected" and a user's engine would stop
  // for no visible reason. Nullable on purpose: rows predating this column
  // skip the check rather than reading as broken.
  await q(`alter table trader_alpaca_credentials add column if not exists key_fp text`);

  // Multi-tenant conversion Phase 3: per-user strategy/risk overrides. Same
  // generic uid→jsonb shape as `layouts`. The row holds only the keys the
  // user actually changed, not a full config snapshot — src/userConfig.js
  // merges it over the compiled config.json defaults on read, so a default
  // that later changes in config.json still reaches users who never
  // overrode it. Values are re-validated against CONFIG_SPEC on every
  // resolve, so a row written before a bound was tightened degrades to the
  // default for that key rather than trading an out-of-range value.
  await q(`create table if not exists trader_strategy_config (
    uid        text primary key references accounts(id) on delete cascade,
    data       jsonb not null,
    updated_at timestamptz not null default now()
  )`);

  // Multi-tenant conversion Phase 6: append-only trail of who changed which
  // credential, when. Deferred from Phase 2 because until Phase 5 the rows
  // weren't wired to anything that trades; now they decide which Alpaca
  // account the engine places orders against, so a change needs a record.
  //
  // NO foreign key to accounts, but note this no longer means the trail
  // survives the account. The original reasoning was that evidence which
  // vanishes when the account it incriminates is deleted is not evidence; the
  // user overrode that on 2026-07-29 in favour of complete erasure, so
  // `purgeAccount` deletes these rows explicitly (see USER_DATA_TABLES). The
  // missing FK now only means the rows aren't destroyed *implicitly* by a
  // cascade — the purge is the one and only thing that removes them, and it is
  // gated behind a 30-day grace period.
  // It stores no key material whatsoever — `detail` is a short server-authored
  // phrase, never anything user-supplied.
  await q(`create table if not exists trader_credential_audit (
    id      bigserial primary key,
    uid     text not null,
    action  text not null,
    mode    text,
    detail  text,
    at      timestamptz not null default now()
  )`);
  await q(`create index if not exists trader_credential_audit_uid_at_idx
           on trader_credential_audit (uid, at desc)`);

  await checkPhase4Migrated();
  console.log('[db] connected; tables ready');
  return true;
}

/**
 * Warns if this database still has the pre-Phase-4 single-tenant shape.
 *
 * init() can create the new tables but cannot reshape existing ones, so a
 * database that predates Phase 4 keeps its old primary keys until
 * scripts/migratePhase4.mjs runs. Running this code against that shape fails
 * loudly on the first journal/job/config write (`ON CONFLICT` finds no matching
 * unique index) — this turns that into a startup warning naming the fix instead
 * of a runtime error with no context.
 */
async function checkPhase4Migrated() {
  const { rows } = await q(`
    select c.relname as table_name
    from pg_class c
    join pg_index i on i.indrelid = c.oid and i.indisprimary
    where c.relname in ('trader_journal','cron_config')
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attnum = any(i.indkey) and a.attname = 'uid'
      )`);
  if (rows.length) {
    console.warn(
      `[db] WARNING: ${rows.map((r) => r.table_name).join(', ')} still use the pre-Phase-4 ` +
        'single-tenant primary key. Run `node scripts/migratePhase4.mjs --confirm` before serving traffic — ' +
        'journal, job-run and cron-config writes will fail until then.',
    );
  }
  return rows.length === 0;
}

// ---- Accounts --------------------------------------------------------------
function toAccount(r) {
  return r && {
    id: r.id, username: r.username, displayName: r.display_name,
    salt: r.salt, passwordHash: r.password_hash,
    createdAt: r.created_at, lastLogin: r.last_login,
    totpSecret: r.totp_secret, totpEnabled: !!r.totp_enabled,
    notificationEmail: r.notification_email,
    isBlocked: !!r.is_blocked,
    deletedAt: r.deleted_at || null,
    deletedBy: r.deleted_by || null,
  };
}
export async function getAccount(uid) {
  const { rows } = await q('select * from accounts where id = $1', [uid]);
  return toAccount(rows[0]) || null;
}
export async function createAccount(rec) {
  await q(
    `insert into accounts (id, username, display_name, salt, password_hash)
     values ($1, $2, $3, $4, $5)`,
    [rec.id, rec.username, rec.displayName, rec.salt, rec.passwordHash],
  );
}
export async function updateLastLogin(uid) {
  await q('update accounts set last_login = now() where id = $1', [uid]);
}
export async function updatePassword(uid, salt, passwordHash) {
  await q('update accounts set salt = $2, password_hash = $3, password_changed_at = now() where id = $1', [uid, salt, passwordHash]);
}
// Secret is stored once `enableTotp` confirms a valid code; `setPendingTotpSecret`
// only stages it during setup (not yet enforced at login).
export async function setPendingTotpSecret(uid, secret) {
  await q('update accounts set totp_secret = $2, totp_enabled = false where id = $1', [uid, secret]);
}
export async function enableTotp(uid) {
  await q('update accounts set totp_enabled = true where id = $1', [uid]);
}
export async function disableTotp(uid) {
  await q('update accounts set totp_enabled = false, totp_secret = null where id = $1', [uid]);
}
export async function updateNotificationEmail(uid, email) {
  await q('update accounts set notification_email = $2 where id = $1', [uid, email]);
}

// ---- Account deletion (Suite roadmap 2026-07-29) ---------------------------
// Ported identically into all four projects, same convention as the auth
// routes. Deliberately two-stage: a delete request soft-deletes (sign-in stops
// working everywhere in the suite immediately and every session is killed), but
// the rows survive a grace period so an accidental — or malicious, if someone
// got a session — deletion is recoverable by an admin in CryptoPro Suite. Only
// the scheduled purge actually destroys data, and it cannot be undone.
//
// The username stays reserved for the whole grace period on purpose: releasing
// it at soft-delete would let someone re-register it and inherit whatever rows
// the purge hasn't reached yet.
export const ACCOUNT_PURGE_GRACE_DAYS = 30;

// Sentinel uids that are not people. GUEST scopes every signed-out user's rows
// (Charts writes anonymous alerts under it) and 'trader' is the pre-Phase-4
// rollback row in trader_state. A username collision must never let a delete
// reach either, so these are refused outright rather than filtered.
const RESERVED_UIDS = new Set([GUEST, 'trader']);

// Every table in the shared suite database that holds per-user rows, and the
// column carrying the uid. The list spans all four projects on purpose: rule 18
// puts them in ONE database, so deleting a user from any app has to clear their
// rows in every app's tables or the erasure is partial and silent. Tables that
// don't exist in a given deployment are skipped (`to_regclass`), which is what
// lets this same list ship in all four projects (rule 23, autonomy).
//
// NOT listed, deliberately: `klines`, `market_events`, `market_status_cache`
// and `glossary` hold no per-user data. `sessions`, `sso_tickets`,
// `subscriptions`, `trader_alpaca_credentials` and `trader_strategy_config`
// are absent because they already have `on delete cascade` FKs to accounts —
// deleting the account row takes them. (`subscriptions` was added by
// monetization phase 2 on 2026-07-31 and is cascade-covered by design; the
// pledge itself still has to be cancelled on Patreon, which is phase 3's job,
// not this list's.)
//
// `job_runs` and `trader_credential_audit` ARE listed. Trader's db.js used to
// document them as audit trails that should outlive an account deletion; the
// user overrode that on 2026-07-29 in favour of complete erasure, and those
// comments were corrected in the same change.
const USER_DATA_TABLES = [
  ['layouts', 'uid'],
  ['alerts', 'uid'],
  ['templates', 'uid'],
  ['saved_scans', 'uid'],
  ['paper_trades', 'uid'],
  ['trader_journal', 'uid'],
  ['cron_config', 'uid'],
  ['job_runs', 'uid'],
  ['trader_credential_audit', 'uid'],
  // trader_state keys the owning uid in `id`, not `uid` — the Phase 4 migration
  // reused the existing PK column rather than adding one.
  ['trader_state', 'id'],
];

// Table and column names cannot be parameterized, so they are interpolated.
// They come only from the const above, never from a request — this assertion
// makes that guarantee local and load-time rather than a matter of trust.
for (const [table, col] of USER_DATA_TABLES) {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(col)) {
    throw new Error(`[db] unsafe identifier in USER_DATA_TABLES: ${table}.${col}`);
  }
}

// A dedicated client, not q(): q() retries transient failures, which is exactly
// wrong mid-transaction — a retry after the server aborted the tx would run
// against a dead snapshot.
async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    try { await client.query('rollback'); } catch { /* connection may already be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

async function tableExists(client, table) {
  const { rows } = await client.query('select to_regclass($1) as t', [table]);
  return Boolean(rows[0]?.t);
}

/**
 * Mark an account deleted and cut off every way back in. Returns false when the
 * account doesn't exist or is already soft-deleted, so a double-submit is a
 * no-op rather than a second audit entry.
 */
export async function softDeleteAccount(uid, byUid) {
  if (RESERVED_UIDS.has(uid)) throw new Error(`Refusing to delete reserved uid "${uid}"`);
  return withTx(async (c) => {
    const { rowCount } = await c.query(
      `update accounts set deleted_at = now(), deleted_by = $2
       where id = $1 and deleted_at is null`,
      [uid, byUid || uid],
    );
    if (!rowCount) return false;
    // The grace period protects the data, not the session: a tab that is
    // already signed in must not keep working, and a pending SSO ticket must
    // not hand out a fresh session in a sibling app.
    await c.query('delete from sessions where uid = $1', [uid]);
    await c.query('delete from sso_tickets where uid = $1', [uid]);
    return true;
  });
}

/** Cancel a pending deletion. Admin-only, in CryptoPro Suite — a soft-deleted user cannot sign in to undo it themselves. */
export async function restoreAccount(uid) {
  const { rowCount } = await q(
    `update accounts set deleted_at = null, deleted_by = null
     where id = $1 and deleted_at is not null`,
    [uid],
  );
  return rowCount > 0;
}

/**
 * Hard-delete one account and every row it owns, in a single transaction.
 * Irreversible. Returns a per-table tally so the caller can log what went.
 */
export async function purgeAccount(uid) {
  if (RESERVED_UIDS.has(uid)) throw new Error(`Refusing to purge reserved uid "${uid}"`);
  return withTx(async (c) => {
    const perTable = {};
    for (const [table, col] of USER_DATA_TABLES) {
      if (!await tableExists(c, table)) continue;
      const r = await c.query(`delete from ${table} where ${col} = $1`, [uid]);
      if (r.rowCount) perTable[table] = r.rowCount;
    }
    // Another account's cron_config row can still name this user as its last
    // editor — a dangling identity reference that would outlive the purge.
    if (await tableExists(c, 'cron_config')) {
      const r = await c.query('update cron_config set updated_by_uid = null where updated_by_uid = $1', [uid]);
      if (r.rowCount) perTable['cron_config.updated_by_uid'] = r.rowCount;
    }
    // Last: this cascades sessions, sso_tickets, trader_alpaca_credentials and
    // trader_strategy_config via their FKs.
    const acct = await c.query('delete from accounts where id = $1', [uid]);
    return { uid, accountDeleted: acct.rowCount > 0, perTable };
  });
}

/** uids whose grace period has expired and are due for permanent deletion. */
export async function listAccountsPendingPurge(graceDays = ACCOUNT_PURGE_GRACE_DAYS) {
  const { rows } = await q(
    `select id from accounts
     where deleted_at is not null and deleted_at < now() - ($1 || ' days')::interval
     order by deleted_at asc`,
    [String(graceDays)],
  );
  return rows.map(r => r.id);
}

/**
 * Purge every account past its grace period. Each is its own transaction, so
 * one failure can't strand the rest half-deleted; failures are reported rather
 * than thrown, because a scheduled sweep should keep going.
 */
export async function purgeExpiredAccounts(graceDays = ACCOUNT_PURGE_GRACE_DAYS) {
  const due = await listAccountsPendingPurge(graceDays);
  const purged = [];
  const failed = [];
  for (const uid of due) {
    try { purged.push(await purgeAccount(uid)); }
    catch (e) { failed.push({ uid, error: e?.message || String(e) }); }
  }
  return { due: due.length, purged, failed };
}


// ---- Plan entitlements (monetization phase 2) ------------------------------
// The single answer to "what is this account entitled to", ported identically
// to all four projects. 'pro' only while the subscription is active/trialing
// AND the paid period has not lapsed, so an event we never receive (a missed
// Patreon pledge webhook, which has no replay guarantee) degrades to 'free' rather
// than granting Pro forever. A missing row is 'free' — every account that
// existed before billing keeps working untouched — and so is "no database
// configured", which keeps this fail-closed.
export async function getPlan(uid) {
  if (!uid) throw new TypeError('getPlan requires a uid');
  if (!dbEnabled()) return 'free';
  const { rows } = await q(
    'select plan, status, current_period_end from subscriptions where uid = $1',
    [String(uid).toLowerCase()],
  );
  const row = rows[0];
  if (!row || row.plan !== 'pro') return 'free';
  if (row.status !== 'active' && row.status !== 'trialing') return 'free';
  if (row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) return 'free';
  return 'pro';
}

// ---- Sessions --------------------------------------------------------------
export async function createSession(sid, uid, expiresAtMs) {
  await q('delete from sessions where expires_at < now()'); // prune expired
  await q('insert into sessions (sid, uid, expires_at) values ($1, $2, to_timestamp($3 / 1000.0))', [sid, uid, expiresAtMs]);
}
export async function getSessionUid(sid) {
  const { rows } = await q('select uid from sessions where sid = $1 and expires_at > now()', [sid]);
  return rows[0]?.uid || null;
}
export async function deleteSession(sid) {
  await q('delete from sessions where sid = $1', [sid]);
}
// Invalidates every other session for this account (e.g. on password change),
// keeping the caller's own current session (`keepSid`) alive.
export async function deleteOtherSessions(uid, keepSid) {
  await q('delete from sessions where uid = $1 and sid != $2', [uid, keepSid]);
}

// ---- SSO tickets -------------------------------------------------------
// Short-lived, single-use handoff tokens for cross-project auto-sign-in
// (Suite roadmap: "signed in to the Suite -> automatically signed in to
// other projects"). Session cookies can't be shared directly — each app
// lives on its own Vercel subdomain, not a shared apex domain a cookie's
// Domain attribute could target — so a signed-in app mints a ticket and
// hands it to the destination app via a URL param; the destination
// consumes it once to mint its own local session.
export async function createSsoTicket(token, uid, expiresAtMs) {
  await q('delete from sso_tickets where expires_at < now()'); // prune expired
  await q('insert into sso_tickets (token, uid, expires_at) values ($1, $2, to_timestamp($3 / 1000.0))', [token, uid, expiresAtMs]);
}
// Atomic consume: only succeeds once per ticket (used flag flips inside the
// same statement as the validity check), so a replayed/leaked URL can't be
// used to mint a second session.
export async function consumeSsoTicket(token) {
  const { rows } = await q(
    `update sso_tickets set used = true
     where token = $1 and used = false and expires_at > now()
     returning uid`,
    [token],
  );
  return rows[0]?.uid || null;
}

// ---- Settings sync (session row only — no named layouts) ------------------
export async function getLayout(uid, name) {
  const { rows } = await q('select data from layouts where uid = $1 and name = $2', [uid, name]);
  return rows[0]?.data ?? null;
}
export async function putLayout(uid, name, data) {
  await q(
    `insert into layouts (uid, name, data, updated_at) values ($1, $2, $3::jsonb, now())
     on conflict (uid, name) do update set data = excluded.data, updated_at = now()`,
    [uid, name, JSON.stringify(data)],
  );
}

// ---- Trader state / journal (cron cutover; uid-scoped since Phase 4) -------
//
// Every accessor below takes the owning uid first. There is deliberately NO
// default: an accidental uid-less call must be a TypeError here, not a silent
// read of (or write into) some other tenant's positions. Callers that still
// represent the single legacy engine pass LEGACY_ENGINE_UID explicitly.

/** Sentinel uid for the pre-multi-tenant engine, matching trader_state's old fixed row id. */
export const LEGACY_ENGINE_UID = 'trader';

function requireUid(uid, fn) {
  if (typeof uid !== 'string' || !uid) throw new TypeError(`${fn} requires a uid`);
  return uid;
}

export async function getTraderState(uid) {
  requireUid(uid, 'getTraderState');
  const { rows } = await q('select data from trader_state where id = $1', [uid]);
  return rows[0]?.data ?? null;
}
export async function putTraderState(uid, data) {
  requireUid(uid, 'putTraderState');
  await q(
    `insert into trader_state (id, data, updated_at) values ($1, $2::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [uid, JSON.stringify(data)],
  );
}
export async function getTraderJournal(uid, day) {
  requireUid(uid, 'getTraderJournal');
  const { rows } = await q('select content from trader_journal where uid = $1 and day = $2', [uid, day]);
  return rows[0]?.content ?? '';
}
/** Appends `block` to the day's journal text for one user (creates the row if absent). */
export async function appendTraderJournal(uid, day, block) {
  requireUid(uid, 'appendTraderJournal');
  await q(
    `insert into trader_journal (uid, day, content, updated_at) values ($1, $2, $3, now())
     on conflict (uid, day) do update set content = trader_journal.content || excluded.content, updated_at = now()`,
    [uid, day, block],
  );
}

// ---- Job runs (audit trail + concurrency lock) ------------------------------
/**
 * Returns the started job_runs row id, or null if one is already running
 * (lock held). Atomic at the database level: `job_runs_running_uidx` (a
 * partial unique index on `job` where status='running') means the INSERT
 * itself is the lock acquisition — two near-simultaneous callers can't both
 * succeed, unlike a separate check-then-insert (security review finding,
 * 2026-07-21).
 */
export async function startJobRun(uid, job, triggeredBy) {
  requireUid(uid, 'startJobRun');
  // A 'running' row older than 15 minutes is treated as abandoned (crashed/
  // timed-out function) and released first, so a stuck row can't block the
  // job forever — Vercel functions are capped well under this. Scoped to this
  // uid so one user's stuck run is never released by another user's request.
  await q(
    `update job_runs set status = 'abandoned'
     where uid = $1 and job = $2 and status = 'running' and started_at <= now() - interval '15 minutes'`,
    [uid, job],
  );
  const { rows } = await q(
    `insert into job_runs (uid, job, status, triggered_by) values ($1, $2, 'running', $3)
     on conflict (uid, job) where status = 'running' do nothing
     returning id`,
    [uid, job, triggeredBy],
  );
  return rows[0]?.id ?? null;
}
export async function finishJobRun(id, status, detail) {
  await q(`update job_runs set status = $2, detail = $3, finished_at = now() where id = $1`, [id, status, detail ?? null]);
}
/** Latest run per job for one user (for the dashboard status panel). */
export async function getLatestJobRuns(uid) {
  requireUid(uid, 'getLatestJobRuns');
  const { rows } = await q(
    `select distinct on (job) job, status, triggered_by, started_at, finished_at, detail
     from job_runs where uid = $1 order by job, started_at desc`,
    [uid],
  );
  return rows;
}

// ---- Cron config: enable/disable + adjustable schedule (uid-scoped) --------
export async function isCronJobEnabled(uid, job) {
  requireUid(uid, 'isCronJobEnabled');
  const { rows } = await q('select enabled from cron_config where uid = $1 and job = $2', [uid, job]);
  return rows[0]?.enabled ?? true; // no row yet => enabled by default
}
/** { enabled, hourUtc } for one user's job — hourUtc is null if never configured (caller applies a default). */
export async function getCronJobConfig(uid, job) {
  requireUid(uid, 'getCronJobConfig');
  const { rows } = await q('select enabled, hour_utc from cron_config where uid = $1 and job = $2', [uid, job]);
  const r = rows[0];
  return { enabled: r?.enabled ?? true, hourUtc: r?.hour_utc ?? null };
}
/**
 * Upserts enabled + hour_utc together (the dashboard form always submits both).
 * `updatedByUid` defaults to the owning uid — it differs only if an admin
 * override ever edits someone else's schedule (a Phase 5 open question).
 */
export async function setCronJobConfig(uid, job, enabled, hourUtc, updatedByUid) {
  requireUid(uid, 'setCronJobConfig');
  await q(
    `insert into cron_config (uid, job, enabled, hour_utc, updated_by_uid, updated_at) values ($1, $2, $3, $4, $5, now())
     on conflict (uid, job) do update set enabled = excluded.enabled, hour_utc = excluded.hour_utc, updated_by_uid = excluded.updated_by_uid, updated_at = now()`,
    [uid, job, enabled, hourUtc, updatedByUid ?? uid],
  );
}
export async function getCronConfig(uid) {
  requireUid(uid, 'getCronConfig');
  const { rows } = await q('select job, enabled, hour_utc, updated_by_uid from cron_config where uid = $1', [uid]);
  return rows;
}

// ---- Tenant discovery for the per-user dispatcher (Phase 5) ----------------

/**
 * Every account the scheduled engine should consider for one job.
 *
 * Membership is defined by having an ACTIVE Alpaca credential — that, not the
 * accounts table, is what makes an account a tenant of the trading engine. A
 * user who never connected keys simply isn't in the list, which is why the
 * dispatcher has no reason to ever fall back to the legacy env-var account.
 *
 * The cron_config join is a LEFT join with `coalesce(..., true)`: a tenant who
 * has never touched the schedule UI has no row, and must still run on the
 * compiled defaults rather than being silently skipped.
 *
 * @returns {Promise<Array<{uid, enabled, hourUtc}>>}
 */
export async function getActiveTenantsForJob(job) {
  const { rows } = await q(
    `select c.uid, coalesce(cc.enabled, true) as enabled, cc.hour_utc
     from trader_alpaca_credentials c
     left join cron_config cc on cc.uid = c.uid and cc.job = $1
     where c.active
     order by c.uid`,
    [job],
  );
  return rows.map((r) => ({ uid: r.uid, enabled: !!r.enabled, hourUtc: r.hour_utc ?? null }));
}

/**
 * Latest start time per uid for one job, as a plain object — one query instead
 * of one per tenant inside the dispatch loop.
 * @returns {Promise<Record<string, Date>>}
 */
export async function getLastRunAtByUid(job) {
  const { rows } = await q(
    `select distinct on (uid) uid, started_at from job_runs where job = $1 order by uid, started_at desc`,
    [job],
  );
  return Object.fromEntries(rows.map((r) => [r.uid, r.started_at]));
}

// ---- Glossary (Suite roadmap: DB-backed instead of file-loaded) -----------
//
// Per-language rows land in the SAME table under a suffixed id: 'trader' is
// English, 'trader:nl' | 'trader:fr' | 'trader:es' are the translations.
//
// That is deliberate, and it is why this shipped with **no schema migration**.
// A composite `(id, lang)` primary key would have been the tidier modelling
// choice, but it breaks the direction this project has already been bitten in:
// an OLD build cold-starting during a deploy window re-runs its own init() and
// its own queries. The old putGlossary does `on conflict (id)`, which has no
// matching unique constraint once the key is composite, so its boot sync would
// throw; the old getGlossary does `where id = 'trader'` and would start
// matching several rows and return an arbitrary language via rows[0]. With the
// suffix scheme an old build reads and writes exactly the row it always did,
// and simply never sees the other three. See CLAUDE.md's migration rule.
export const GLOSSARY_BASE_ID = 'trader';

/** Row id for a language. English keeps the bare, pre-existing id. */
export function glossaryId(lang) {
  return !lang || lang === 'en' ? GLOSSARY_BASE_ID : `${GLOSSARY_BASE_ID}:${lang}`;
}

export async function getGlossary(lang) {
  const { rows } = await q(`select content, updated_at from glossary where id = $1`, [glossaryId(lang)]);
  return rows[0] ? { content: rows[0].content, updatedAt: rows[0].updated_at } : null;
}

/** Upserts one language's glossary row; only writes when content actually changed. */
export async function putGlossary(content, lang) {
  await q(
    `insert into glossary (id, content, updated_at) values ($2, $1, now())
     on conflict (id) do update set content = excluded.content, updated_at = now()
     where glossary.content is distinct from excluded.content`,
    [content, glossaryId(lang)],
  );
}

// ---- Per-user Alpaca credentials (multi-tenant Phase 2) --------------------
// The secret itself only ever exists in this module in two places: the
// encryptSecret() call on write and the decryptSecret() call in
// getActiveAlpacaCredential() on read. Everything else — and every route —
// works with the metadata shape below, which has no ciphertext and no secret.

/** Metadata for one row; deliberately has no ciphertext/secret field so it is always safe to serialize. */
function toCredentialMeta(r, currentKeyFp = null) {
  return {
    mode: r.mode,
    active: !!r.active,
    keyPreview: r.key_preview,
    encVersion: r.enc_version,
    // False only when we can positively prove this row was encrypted under a
    // different key (i.e. written from another environment against the shared
    // database). Unknown cases — no stored fingerprint, or no key configured
    // here — report true, because "we cannot tell" must not render as "your
    // credential is broken". The fingerprint itself is never returned; the
    // client only needs the verdict.
    readableHere: !r.key_fp || !currentKeyFp || r.key_fp === currentKeyFp,
    // One authoritative field for "may this credential place orders", so the
    // Phase 5 dispatcher and the Phase 6 UI key on it instead of each
    // re-deriving the paper-only hard rule a third time. alpacaClient.js's
    // assertPaperTrading() remains the actual enforcement point.
    tradingEnabled: r.mode === 'paper',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Serializes the lock for one user's credential rows onto the current transaction. */
const lockUidRows = (client, uid) =>
  client.query('select pg_advisory_xact_lock(hashtext($1))', [`alpaca-cred:${uid}`]);

/** All of one user's stored credentials, metadata only — safe to send to that user's client. */
export async function listAlpacaCredentials(uid) {
  const { rows } = await q(
    `select mode, active, key_preview, enc_version, key_fp, created_at, updated_at
     from trader_alpaca_credentials where uid = $1 order by mode`,
    [uid],
  );
  // An unconfigured/invalid key here must not make the listing throw — this
  // is the read-only metadata route, and it should still say what is
  // connected. keyFingerprint() throws CryptoNotConfigured in that case, and
  // a null fingerprint makes readableHere fall back to "assume readable".
  let currentKeyFp = null;
  try { currentKeyFp = keyFingerprint(); } catch { /* no key configured here */ }
  return rows.map((r) => toCredentialMeta(r, currentKeyFp));
}

/**
 * The credential the server-side engine should trade with for this user.
 * DECRYPTS — server-internal only. The returned object contains the raw
 * Alpaca secret and must never reach a JSON response, a log line, or an
 * error message.
 * @returns {Promise<{mode, keyId, secret, baseUrl}|null>} null when the user
 *   has no active credential. Throws DecryptFailed if the row can't be
 *   authenticated (caller must treat that as "disconnected", never as "trade
 *   with the legacy env-var account").
 */
export async function getActiveAlpacaCredential(uid) {
  const { rows } = await q(
    `select mode, ciphertext, key_fp from trader_alpaca_credentials where uid = $1 and active`,
    [uid],
  );
  if (!rows[0]) return null;
  const { mode } = rows[0];
  // AAD is recomputed from this row's own uid/mode: a ciphertext copied out
  // of another user's row (or another mode) fails authentication here rather
  // than handing back working credentials for the wrong account. key_fp turns
  // the specific case of "written by another environment" into KeyMismatch
  // (a DecryptFailed subclass, so the refuse-to-trade behaviour is unchanged).
  const payload = decryptSecret(rows[0].ciphertext, credentialAad(uid, mode), rows[0].key_fp);
  return {
    ...payload,
    mode,
    // Re-derived from the `mode` column, NOT trusted from the decrypted blob.
    // baseUrl is what assertPaperTrading() keys on, i.e. it decides whether
    // orders may be placed at all — that decision must come from a
    // server-side constant, never from stored data.
    baseUrl: ALPACA_HOSTS[mode],
    tradingEnabled: mode === 'paper',
  };
}

/**
 * Stores (or replaces) one mode's credential for a user.
 * @param {object} payload {keyId, secret, baseUrl} — encrypted as a unit.
 * @param {boolean} makeActive true => this becomes the active credential and
 *   any other mode is deactivated. false => an existing row keeps whatever
 *   active flag it already had (re-saving the key you're using shouldn't
 *   silently disconnect you); a new row starts inactive.
 */
export async function putAlpacaCredential(uid, mode, payload, makeActive) {
  if (!ALPACA_HOSTS[mode]) throw new Error(`unknown Alpaca mode: ${mode}`);
  // Defence in depth against a future caller (a CLI import, a backfill
  // script, a test fixture) passing its own host: baseUrl is what gates order
  // placement, so anything but the mode's canonical host is refused here too,
  // not only in the route's validation one layer up.
  if (payload?.baseUrl !== ALPACA_HOSTS[mode]) {
    throw new Error(`baseUrl for mode "${mode}" must be ${ALPACA_HOSTS[mode]}`);
  }
  // Encrypt before opening a transaction so a missing/invalid encryption key
  // fails without holding a pooled client.
  const ciphertext = encryptSecret(payload, credentialAad(uid, mode));
  // Recorded alongside the blob so a later read from a different environment
  // can name the cause instead of failing opaquely.
  const keyFp = keyFingerprint();
  const keyPreview = String(payload?.keyId || '').slice(-4);
  const activate = makeActive === true;
  await tx(async (client) => {
    if (activate) {
      // Serialize concurrent activations for this user. The UPDATE below only
      // takes a row lock when a row is actually active, so from a zero-active
      // state two simultaneous activate requests would otherwise both proceed
      // and one would fail the partial unique index with a raw 23505.
      await lockUidRows(client, uid);
      // Must clear the previous active row first: the partial unique index
      // (uid) where active rejects even a transient second active row.
      await client.query(
        'update trader_alpaca_credentials set active = false, updated_at = now() where uid = $1 and active',
        [uid],
      );
    }
    await client.query(
      `insert into trader_alpaca_credentials (uid, mode, active, key_preview, ciphertext, enc_version, key_fp)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (uid, mode) do update set
         active      = case when $3 then true else trader_alpaca_credentials.active end,
         key_preview = excluded.key_preview,
         ciphertext  = excluded.ciphertext,
         enc_version = excluded.enc_version,
         key_fp      = excluded.key_fp,
         updated_at  = now()`,
      [uid, mode, activate, keyPreview, ciphertext, ENC_VERSION, keyFp],
    );
  });
}

/** Switches which stored mode is active. Returns false (changing nothing) when that mode isn't stored. */
export async function setActiveAlpacaMode(uid, mode) {
  return tx(async (client) => {
    await lockUidRows(client, uid);
    // `for update` matters: a concurrent DELETE of this very row could
    // otherwise commit between this check and the UPDATE below, leaving the
    // user with NOTHING active while this call still reported success — which
    // silently stops their engine, stop-loss watchdog included.
    const { rows } = await client.query(
      'select 1 from trader_alpaca_credentials where uid = $1 and mode = $2 for update',
      [uid, mode],
    );
    // Bail before deactivating anything — otherwise a request naming a mode
    // the user never stored would disconnect the credential they do have.
    if (!rows.length) return false;
    await client.query(
      'update trader_alpaca_credentials set active = false, updated_at = now() where uid = $1 and active',
      [uid],
    );
    const { rowCount } = await client.query(
      'update trader_alpaca_credentials set active = true, updated_at = now() where uid = $1 and mode = $2',
      [uid, mode],
    );
    // Report what actually happened, not what the earlier SELECT saw.
    return rowCount > 0;
  });
}

/** Removes one mode's credential. Returns false when there was nothing to delete. */
export async function deleteAlpacaCredential(uid, mode) {
  const { rowCount } = await q(
    'delete from trader_alpaca_credentials where uid = $1 and mode = $2',
    [uid, mode],
  );
  return rowCount > 0;
}

// ---- Per-user strategy config (multi-tenant Phase 3) -----------------------
// Storage only: these accessors deliberately do no validation. The engine
// resolves through src/userConfig.js's resolveConfigForUser(), which
// re-validates every key against CONFIG_SPEC, so a row cannot smuggle an
// out-of-range value into a trading decision by any path.

/** The user's raw override object, or null when they've never saved one. */
export async function getStrategyConfig(uid) {
  const { rows } = await q('select data from trader_strategy_config where uid = $1', [uid]);
  return rows[0]?.data ?? null;
}

/** Upsert the user's overrides. `data` should already have been validated. */
export async function putStrategyConfig(uid, data) {
  await q(
    `insert into trader_strategy_config (uid, data, updated_at) values ($1, $2::jsonb, now())
     on conflict (uid) do update set data = excluded.data, updated_at = now()`,
    [uid, JSON.stringify(data)],
  );
}

/** Drop all overrides for a user, reverting them to the compiled defaults. */
export async function deleteStrategyConfig(uid) {
  const { rowCount } = await q('delete from trader_strategy_config where uid = $1', [uid]);
  return rowCount > 0;
}

// ---- Credential audit trail (multi-tenant Phase 6) ------------------------

/** Actions the audit trail records. Server-authored — never echo a client string. */
export const CREDENTIAL_ACTIONS = Object.freeze({
  CONNECTED: 'connected',
  REPLACED: 'replaced',
  ACTIVATED: 'activated',
  DELETED: 'deleted',
});

/**
 * Appends one audit row. Never throws: the mutation it records has already
 * committed, so rejecting here would report a failure that didn't happen and
 * could push a user into re-submitting their key. A failed write is logged
 * loudly instead, and credentialsRoutes.js also emits its own console line per
 * mutation, so the trail survives in the platform logs either way.
 * @param {string} detail short server-authored phrase — MUST NOT contain key material.
 */
export async function appendCredentialAudit(uid, action, mode, detail = null) {
  try {
    await q(
      'insert into trader_credential_audit (uid, action, mode, detail) values ($1, $2, $3, $4)',
      [uid, action, mode ?? null, detail],
    );
  } catch (e) {
    console.error('[db] credential audit write failed:', e?.message || e);
  }
}

/** Most recent audit rows for one user, newest first. Safe to return to that user. */
export async function listCredentialAudit(uid, limit = 20) {
  // Clamped, not trusted: this bound is what stops a client from asking for
  // the whole table through a query param.
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  // Scoped to rows created after the account itself. accounts.id IS the
  // normalized username (see auth.js's register), so a username that is
  // deleted and re-registered yields a *different* account owning the *same*
  // uid string — and this table intentionally has no cascade, because an
  // audit trail that vanishes with the account it documents is not a trail.
  // Without this join the new owner would be shown credential changes they
  // never made, which reads exactly like a compromise. The rows stay in the
  // table for forensics; they are just not attributed to the new account.
  const { rows } = await q(
    `select a.action, a.mode, a.detail, a.at
     from trader_credential_audit a
     join accounts acc on acc.id = a.uid
     where a.uid = $1 and a.at >= acc.created_at
     order by a.at desc, a.id desc limit $2`,
    [uid, n],
  );
  return rows.map((r) => ({ action: r.action, mode: r.mode, detail: r.detail, at: r.at }));
}
