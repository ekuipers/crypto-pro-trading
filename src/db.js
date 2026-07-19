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
