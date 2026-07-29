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
  // Multi-tenant Phase 4 (memory/project-trader-multitenant-plan.md): all four
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
  // near-simultaneous requests could both pass (security review finding,
  // 2026-07-21 — see memory/memory.md).
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
  // and syncs that into this row on every boot — the rest of the file is a
  // dated implementation changelog, not glossary content (user correction,
  // 2026-07-24). This also fixes a latent production bug: server.js never
  // statically served memory/, so the live Glossary tab was silently falling
  // back to the small hardcoded GLOSSARY_FALLBACK_MD snapshot instead of the
  // real file.
  await q(`create table if not exists glossary (
    id         text primary key default 'trader',
    content    text not null,
    updated_at timestamptz not null default now()
  )`);

  // Multi-tenant conversion Phase 2 (memory/project-trader-multitenant-plan.md):
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
  // Deliberately NO foreign key to accounts: this is evidence, and evidence
  // that vanishes when the account it incriminates is deleted is not evidence
  // (same reasoning as job_runs). It also stores no key material whatsoever —
  // `detail` is a short server-authored phrase, never anything user-supplied.
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
export async function getGlossary() {
  const { rows } = await q(`select content, updated_at from glossary where id = 'trader'`);
  return rows[0] ? { content: rows[0].content, updatedAt: rows[0].updated_at } : null;
}
/** Upserts the single shared glossary row; only writes when content actually changed. */
export async function putGlossary(content) {
  await q(
    `insert into glossary (id, content, updated_at) values ('trader', $1, now())
     on conflict (id) do update set content = excluded.content, updated_at = now()
     where glossary.content is distinct from excluded.content`,
    [content],
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
