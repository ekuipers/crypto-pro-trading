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

const { Pool } = pg;

// Sentinel uid for anonymous (not-signed-in) requests.
export const GUEST = '__guest__';
export const SESSION_NAME = '__session__';

// For accounts to actually be *shared* across the suite, this must resolve
// to the exact same Supabase Postgres project CryptoPro Charts uses — hence
// DBCRYPTOCHARTS_* takes priority over this project's own pre-existing
// `trading_*` Postgres vars (a separate Supabase project). See .env.example.
const CONN_VARS = [
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
  // watchdog/daily-summary engines run as Vercel Cron-triggered serverless
  // functions instead of GitHub Actions. A serverless function has no
  // persistent local disk across invocations, so positions_state.json and
  // journal/*.md move here — single-tenant (this project has one trading
  // engine, not one row per account), same reasoning as the Python engine's
  // git-committed files, just a different storage backend.
  await q(`create table if not exists trader_state (
    id         text primary key default 'trader',
    data       jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  await q(`create table if not exists trader_journal (
    day        text primary key,
    content    text not null default '',
    updated_at timestamptz not null default now()
  )`);
  // One row per job run — doubles as the audit trail git commits used to be
  // (job_runs.status='running' also acts as the concurrency lock: a job
  // already running blocks a second scheduled/manual trigger from starting).
  await q(`create table if not exists job_runs (
    id          bigserial primary key,
    job         text not null,
    status      text not null default 'running',
    triggered_by text not null default 'cron',
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    detail      text
  )`);
  await q(`create index if not exists job_runs_job_started_idx on job_runs (job, started_at desc)`);
  // Partial unique index backing the concurrency lock: at most one 'running'
  // row per job at the database level, so startJobRun's insert can be
  // atomic (ON CONFLICT DO NOTHING) instead of a check-then-insert that two
  // near-simultaneous requests could both pass (security review finding,
  // 2026-07-21 — see memory/memory.md).
  await q(`create unique index if not exists job_runs_running_uidx on job_runs (job) where status = 'running'`);
  // Per-job enable/disable toggle the dashboard can flip without a redeploy
  // (the actual time-of-day schedule is still static in vercel.json).
  await q(`create table if not exists cron_config (
    job        text primary key,
    enabled    boolean not null default true,
    updated_at timestamptz not null default now()
  )`);
  console.log('[db] connected; tables ready');
  return true;
}

// ---- Accounts --------------------------------------------------------------
function toAccount(r) {
  return r && {
    id: r.id, username: r.username, displayName: r.display_name,
    salt: r.salt, passwordHash: r.password_hash,
    createdAt: r.created_at, lastLogin: r.last_login,
    totpSecret: r.totp_secret, totpEnabled: !!r.totp_enabled,
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

// ---- Trader state / journal (cron cutover) ---------------------------------
export async function getTraderState() {
  const { rows } = await q(`select data from trader_state where id = 'trader'`);
  return rows[0]?.data ?? null;
}
export async function putTraderState(data) {
  await q(
    `insert into trader_state (id, data, updated_at) values ('trader', $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(data)],
  );
}
export async function getTraderJournal(day) {
  const { rows } = await q('select content from trader_journal where day = $1', [day]);
  return rows[0]?.content ?? '';
}
/** Appends `block` to the day's journal text (creates the row if absent). */
export async function appendTraderJournal(day, block) {
  await q(
    `insert into trader_journal (day, content, updated_at) values ($1, $2, now())
     on conflict (day) do update set content = trader_journal.content || excluded.content, updated_at = now()`,
    [day, block],
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
export async function startJobRun(job, triggeredBy) {
  // A 'running' row older than 15 minutes is treated as abandoned (crashed/
  // timed-out function) and released first, so a stuck row can't block the
  // job forever — Vercel functions are capped well under this.
  await q(
    `update job_runs set status = 'abandoned' where job = $1 and status = 'running' and started_at <= now() - interval '15 minutes'`,
    [job],
  );
  const { rows } = await q(
    `insert into job_runs (job, status, triggered_by) values ($1, 'running', $2)
     on conflict (job) where status = 'running' do nothing
     returning id`,
    [job, triggeredBy],
  );
  return rows[0]?.id ?? null;
}
export async function finishJobRun(id, status, detail) {
  await q(`update job_runs set status = $2, detail = $3, finished_at = now() where id = $1`, [id, status, detail ?? null]);
}
/** Latest run per job (for the dashboard status panel). */
export async function getLatestJobRuns() {
  const { rows } = await q(
    `select distinct on (job) job, status, triggered_by, started_at, finished_at, detail
     from job_runs order by job, started_at desc`,
  );
  return rows;
}

// ---- Cron enable/disable toggle ---------------------------------------------
export async function isCronJobEnabled(job) {
  const { rows } = await q('select enabled from cron_config where job = $1', [job]);
  return rows[0]?.enabled ?? true; // no row yet => enabled by default
}
export async function setCronJobEnabled(job, enabled) {
  await q(
    `insert into cron_config (job, enabled, updated_at) values ($1, $2, now())
     on conflict (job) do update set enabled = excluded.enabled, updated_at = now()`,
    [job, enabled],
  );
}
export async function getCronConfig() {
  const { rows } = await q('select job, enabled from cron_config');
  return rows;
}
