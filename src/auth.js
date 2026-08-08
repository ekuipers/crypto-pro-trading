// ============================================================
// AUTH — multi-user sessions with username/password (application-only)
// ------------------------------------------------------------
// Ported from CryptoPro Charts/CryptoPro Suite so all four CryptoPro Suite
// apps share one accounts database (Suite workflow rule 18 — single sign-on).
// Cookie parsing, opaque session tokens, and salted scrypt password hashing.
// Accounts and sessions are persisted in Postgres (Supabase) via db.js — see
// that module for the schema. There is no third-party SSO.
// ============================================================
import crypto from 'crypto';
import * as db from './db.js';
import { generateSecret, verifyTotp, otpauthUri } from './totp.js';
import { rateLimited } from './rateLimit.js';

const SESSION_COOKIE = 'cpc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SSO_TICKET_TTL_MS = 60 * 1000; // single-use, must be redeemed within 60s

// ---- Rate limiting -----------------------------------------------------
// The sliding-window helper lives in src/rateLimit.js so the per-user Alpaca
// credential routes can share it (see that file for the per-process caveat).
// The windows below are unchanged: per IP, for register and login.
function clientIp(req) { return req.ip || req.socket?.remoteAddress || 'unknown'; }

// ---- Passwords (salted scrypt + constant-time compare) -----------------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, salt, expected) {
  const got = Buffer.from(hashPassword(password, salt), 'hex');
  const exp = Buffer.from(expected, 'hex');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

// ---- Cookies -------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    // A malformed percent-encoding (e.g. a hand-crafted "%zz") makes
    // decodeURIComponent throw synchronously; since callers are async
    // functions that throw becomes an unhandled rejection that can crash
    // the whole process. Skip just the one bad cookie instead.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* ignore malformed cookie value */ }
  }
  return out;
}
// Domain=.cryptoprosuite.com (production only — localhost has no subdomains
// to share) is what makes SSO actually work on a cold entry: without it, each
// app's cookie only ever lives on its own subdomain, so a bookmark straight
// into this app shows whatever session was last set here directly, not
// whatever's currently signed in on Suite or a sibling app. The ticket relay
// (?sso=) only bridges accounts at the moment of a click; it can't retroactively
// apply to a request that never carried one. All four hosts are subdomains of
// (or, for Suite, exactly) cryptoprosuite.com, so all four can validly set this.
function setCookie(res, name, value, maxAgeMs) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) bits.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (process.env.NODE_ENV === 'production') bits.push('Secure', 'Domain=.cryptoprosuite.com');
  res.setHeader('Set-Cookie', bits.join('; '));
}
function clearCookie(res, name) {
  const bits = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  // Must match Domain exactly, or this sets a second, narrower-scoped cookie
  // instead of clearing the wide one — the browser keys a Set-Cookie's target
  // by name+domain+path, not name alone.
  if (process.env.NODE_ENV === 'production') bits.push('Domain=.cryptoprosuite.com');
  res.setHeader('Set-Cookie', bits.join('; '));
}

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');

// Fixed dummy salt/hash used to pay the same scrypt cost for a login attempt
// against a username that doesn't exist, so response time doesn't leak
// whether the account is real (timing-based username enumeration).
const DUMMY_SALT = 'a'.repeat(32);
const DUMMY_HASH = crypto.scryptSync('dummy-password-for-timing-parity', DUMMY_SALT, 64).toString('hex');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normUser = (u) => String(u || '').trim().toLowerCase();
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, totpEnabled: !!u.totpEnabled, notificationEmail: u.notificationEmail || '' });

// ---- Public: who is this request? ---------------------------------------
export async function currentUser(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  try {
    const uid = await db.getSessionUid(sid);
    if (!uid) return null;
    const account = await db.getAccount(uid);
    // A blocked or pending-deletion account is treated as signed-out on every
    // request — currentUser() gates every authenticated route, so no separate
    // session teardown is needed. softDeleteAccount already drops the sessions
    // rows; this is what makes a deletion (or a block set in CryptoPro Suite's
    // admin panel) take effect instantly in this app too, since all four share
    // one database.
    if (account?.isBlocked || account?.deletedAt) return null;
    return account;
  } catch (e) {
    console.error('[auth] currentUser lookup failed:', e?.message || e);
    return null; // storage hiccup — treat as signed-out, don't crash
  }
}

// The uid whose data this request owns: the signed-in account, or GUEST.
export async function currentUid(req) {
  const user = await currentUser(req);
  return user?.id || db.GUEST;
}
// ---- Plan gating (monetization phase 4) ------------------------------------
// Entitlement has two independent sources and either one grants access:
//
//   - `accounts.role`, set by an admin via Suite's POST /api/admin/users/:uid/role.
//     'admin' must pass or an admin cannot see the features they support users
//     on; 'pro' is the manual comp grant, and checking only getPlan() would
//     make that existing admin control silently do nothing.
//   - `subscriptions.plan` via db.getPlan(), the Patreon-driven path. It
//     already fails closed on its own — missing row, non-active status, lapsed
//     period and "no database configured" all read as 'free'.
//
// Status codes are deliberately three, not one: 401 (not signed in) and 402
// (signed in, not entitled) are different fixes for the user, and the client
// turns only the 402 into the upgrade prompt. An unexpected failure is 503,
// never 402 — telling a paying subscriber to upgrade because a query blipped
// is worse than telling them to retry. All three deny access.
//
// Uses currentUser(), not currentUid(): currentUid() falls back to db.GUEST for
// signed-out callers, which must never be treated as an account to price.
// The decision itself, kept pure so it can be tested without a live Postgres
// or a session cookie (same reason as credentialsRoutes.js's validators).
// Returns null to allow, or the HTTP status to deny with.
export function planGateStatus(user, actualPlan, wanted = 'pro') {
  if (!user) return 401;
  if (user.role === 'admin' || user.role === wanted) return null;
  if (actualPlan === wanted) return null;
  return 402;
}

/**
 * Any authenticated account, Free or Pro — Trader's credentials/strategy-
 * config/trader-state routes and the session-scoped cron endpoints used to
 * require Pro (requirePlan('pro')); they now require only a session, since
 * Free tenants get real engine access capped by src/risk.js's
 * planPositionCapAllows() and userConfig.js's FREE_WATCHLIST_LIMIT instead of
 * a route-level block (see CLAUDE.md "Plan entitlements").
 */
export function requireSignedIn() {
  return async (req, res, next) => {
    let user;
    try {
      user = await currentUser(req);
    } catch (e) {
      console.error('[auth] requireSignedIn lookup failed:', e?.message || e);
      return res.status(503).json({ error: 'plan_check_unavailable' });
    }
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    return next();
  };
}

export function requirePlan(plan = 'pro') {
  return async (req, res, next) => {
    let user;
    try {
      user = await currentUser(req);
    } catch (e) {
      console.error('[auth] requirePlan lookup failed:', e?.message || e);
      return res.status(503).json({ error: 'plan_check_unavailable' });
    }
    // Resolved only when the cheap role check cannot already decide it, so a
    // signed-out caller never costs a query.
    let actual = null;
    if (user && user.role !== 'admin' && user.role !== plan) {
      try {
        actual = await db.getPlan(user.id);
      } catch (e) {
        console.error('[auth] requirePlan getPlan failed:', e?.message || e);
        return res.status(503).json({ error: 'plan_check_unavailable' });
      }
    }
    const denied = planGateStatus(user, actual, plan);
    if (denied === 401) return res.status(401).json({ error: 'Sign in required' });
    if (denied) return res.status(denied).json({ error: 'upgrade_required' });
    return next();
  };
}


/**
 * Step-up authentication: proves the person holding this session also knows
 * the account password, before a destructive or high-consequence action.
 *
 * Exported (unlike hashPassword/verifyPassword, which stay module-private) so
 * that credential routes re-authenticate through this one code path rather
 * than each reaching for the raw hash. Callers pass the uid they already
 * resolved from the session cookie — never a uid from the request body.
 *
 * Returns false, never throws, for every failure mode (unknown account,
 * missing password, storage hiccup): a step-up check that errors open is
 * worse than one that simply denies.
 *
 * @param {{getAccount?: Function}} deps test seam only — production callers
 *   pass two arguments and get db.getAccount.
 */
export async function verifyStepUpPassword(uid, password, { getAccount = db.getAccount } = {}) {
  const pw = String(password || '');
  if (!uid || uid === db.GUEST || !pw) return false;
  try {
    const user = await getAccount(uid);
    if (!user?.salt || !user?.passwordHash) return false;
    return verifyPassword(pw, user.salt, user.passwordHash);
  } catch (e) {
    console.error('[auth] step-up verification failed:', e?.message || e);
    return false;
  }
}

// ---- Routes --------------------------------------------------------------
export function installAuthRoutes(app) {
  // ---- Cross-project SSO handoff -----------------------------------------
  // Registered before the static/SPA routes below so it can intercept any
  // page request. A ticket in the query string is single-use and expires in
  // 60s (see db.consumeSsoTicket), so the brief exposure in server logs/
  // Referer headers can't be replayed into a second session.
  app.use(async (req, res, next) => {
    const ticket = req.method === 'GET' && typeof req.query?.sso === 'string' ? req.query.sso : null;
    if (!ticket) return next();
    try {
      const uid = await db.consumeSsoTicket(ticket);
      if (uid && await db.getAccount(uid)) {
        const sid = token(24);
        await db.createSession(sid, uid, Date.now() + SESSION_TTL_MS);
        setCookie(res, SESSION_COOKIE, sid, SESSION_TTL_MS);
      }
    } catch (e) {
      console.error('[auth] sso ticket consume failed:', e?.message || e);
      // fall through to a clean redirect either way — a bad/expired ticket
      // should never block the page from loading signed-out
    }
    const clean = new URL(req.originalUrl, 'http://x');
    clean.searchParams.delete('sso');
    res.redirect(302, clean.pathname + clean.search + clean.hash);
  });

  // Issues a short-lived ticket the client attaches to a link to another
  // CryptoPro Suite app (?sso=<token>) so that app can sign the same
  // account in automatically instead of showing its own login form.
  app.post('/api/auth/sso-ticket', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const t = token(24);
      await db.createSsoTicket(t, uid, Date.now() + SSO_TICKET_TTL_MS);
      res.json({ token: t });
    } catch (e) {
      console.error('[auth] sso-ticket failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not create SSO ticket — database error, please retry.' });
    }
  });

  app.get('/api/me', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.json({ user: null });
    // Same shortcut as requirePlan()/planGateStatus(): role grants first (free
    // for a signed-in caller), subscriptions.plan only when neither applies.
    // Feeds the Plans modal's free-vs-Pro CTA — a getPlan() hiccup here must
    // not break sign-in, so it degrades to 'free' rather than failing the request.
    let plan = 'free';
    if (user.role === 'admin' || user.role === 'pro') {
      plan = 'pro';
    } else {
      try { plan = await db.getPlan(user.id); } catch (e) { console.error('[auth] /api/me getPlan failed:', e?.message || e); }
    }
    // Link status is independent of `plan` — a role grant makes plan:'pro'
    // with no Patreon link at all, and a lapsed pledge can leave
    // patreon.linked:true with plan:'free'. Same fail-soft rule as getPlan().
    let patreon = { linked: false, status: null, currentPeriodEnd: null };
    try {
      const sub = await db.getSubscription(user.id);
      if (sub) {
        patreon = {
          linked: !!sub.patreon_member_id,
          status: sub.status || null,
          currentPeriodEnd: sub.current_period_end || null,
        };
      }
    } catch (e) { console.error('[auth] /api/me getSubscription failed:', e?.message || e); }
    res.json({ user: { ...publicUser(user), plan, patreon } });
  });

  app.post('/api/auth/register', async (req, res) => {
    // 8 attempts / hour / IP — generous for real users, blunts automated account creation.
    if (rateLimited(`register:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts — please try again later.' });
    }
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-32 chars: letters, digits, . _ -' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const uid = normUser(username);
      if (await db.getAccount(uid)) return res.status(409).json({ error: 'Username already taken' });

      const salt = token(16);
      const record = { id: uid, username, displayName: username, salt, passwordHash: hashPassword(password, salt) };
      await db.createAccount(record);

      const sid = token(24);
      await db.createSession(sid, uid, Date.now() + SESSION_TTL_MS);
      setCookie(res, SESSION_COOKIE, sid, SESSION_TTL_MS);
      res.json({ user: publicUser(record) });
    } catch (e) {
      console.error('[auth] register failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not create account — database error, please retry.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    // 10 attempts / 15 min / IP — blunts password-guessing without punishing
    // a real user who mistypes a couple of times.
    if (rateLimited(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts — please try again later.' });
    }
    try {
      const uid = normUser(req.body?.username);
      const password = String(req.body?.password || '');
      const user = await db.getAccount(uid);
      // Same response whether the user is missing or the password is wrong —
      // and pay the same scrypt cost either way (verify against a dummy
      // hash when there's no account) so response time doesn't leak which
      // usernames exist.
      const passwordOk = user
        ? verifyPassword(password, user.salt, user.passwordHash)
        : (verifyPassword(password, DUMMY_SALT, DUMMY_HASH), false);
      if (!user || !passwordOk) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      // TOTP challenge: password verified but 2FA is on and no/invalid code
      // was supplied — ask the client for one instead of creating a session.
      if (user.totpEnabled) {
        const code = req.body?.totpCode;
        if (!code) return res.status(401).json({ error: 'Enter your 2FA code', requiresTotp: true });
        if (!verifyTotp(user.totpSecret, code)) return res.status(401).json({ error: 'Invalid 2FA code', requiresTotp: true });
      }
      // Checked only after the password (and 2FA) verify, so this never tells an
      // unauthenticated prober whether a given username is blocked or pending
      // deletion. Both states are set in CryptoPro Suite; this app enforces them.
      if (user.isBlocked) {
        return res.status(403).json({ error: 'This account has been blocked. Contact an administrator.' });
      }
      if (user.deletedAt) {
        return res.status(403).json({ error: 'This account is scheduled for deletion. Contact an administrator if this was a mistake.' });
      }
      try { await db.updateLastLogin(uid); } catch { /* non-critical */ }

      const sid = token(24);
      await db.createSession(sid, uid, Date.now() + SESSION_TTL_MS);
      setCookie(res, SESSION_COOKIE, sid, SESSION_TTL_MS);
      res.json({ user: publicUser(user) });
    } catch (e) {
      console.error('[auth] login failed:', e?.stack || e);
      res.status(500).json({ error: 'Sign-in failed — database error, please retry.' });
    }
  });

  // ---- Password change (authenticated) ----------------------------------
  // Full "forgot password" email flow is deferred: it needs an SMTP/email
  // provider that isn't configured anywhere in this project. This covers the
  // self-service case, which is the one every signed-in user can act on.
  app.post('/api/auth/change-password', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const user = await db.getAccount(uid);
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      const current = String(req.body?.currentPassword || '');
      const next = String(req.body?.newPassword || '');
      if (!verifyPassword(current, user.salt, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      const salt = token(16);
      await db.updatePassword(uid, salt, hashPassword(next, salt));
      // Invalidate any other signed-in session (e.g. a stolen cookie) — keep
      // only the session that made this request alive.
      const sid = parseCookies(req)[SESSION_COOKIE];
      await db.deleteOtherSessions(uid, sid);
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] change-password failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not change password — database error, please retry.' });
    }
  });

  // ---- Notification email (Suite roadmap) --------------------------------
  // Unrelated to sign-in; just an address the account can be reached at for
  // future notifications. Optional — an empty body clears it.
  app.post('/api/auth/notification-email', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const email = String(req.body?.email || '').trim();
      if (email && !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Enter a valid email address' });
      }
      await db.updateNotificationEmail(uid, email || null);
      res.json({ ok: true, notificationEmail: email });
    } catch (e) {
      console.error('[auth] notification-email update failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not save email — database error, please retry.' });
    }
  });

  // ---- TOTP 2FA (optional) ----------------------------------------------
  // Setup stages a secret without enabling it; enable requires proving the
  // user's authenticator app actually has it (a valid code) before it's
  // enforced at login — otherwise a typo during setup could lock them out.
  app.post('/api/auth/2fa/setup', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const user = await db.getAccount(uid);
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      const secret = generateSecret();
      await db.setPendingTotpSecret(uid, secret);
      res.json({ secret, otpauthUri: otpauthUri(user.username, secret) });
    } catch (e) {
      console.error('[auth] 2fa setup failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not start 2FA setup — database error, please retry.' });
    }
  });

  app.post('/api/auth/2fa/enable', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const user = await db.getAccount(uid);
      if (!user?.totpSecret) return res.status(400).json({ error: 'Start setup first' });
      if (!verifyTotp(user.totpSecret, req.body?.code)) return res.status(401).json({ error: 'Invalid code' });
      await db.enableTotp(uid);
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] 2fa enable failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not enable 2FA — database error, please retry.' });
    }
  });

  app.post('/api/auth/2fa/disable', async (req, res) => {
    try {
      const uid = await currentUid(req);
      if (uid === db.GUEST) return res.status(401).json({ error: 'Sign in first' });
      const user = await db.getAccount(uid);
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      if (!verifyPassword(String(req.body?.password || ''), user.salt, user.passwordHash)) {
        return res.status(401).json({ error: 'Password is incorrect' });
      }
      await db.disableTotp(uid);
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] 2fa disable failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not disable 2FA — database error, please retry.' });
    }
  });

  // ---- Self-service account deletion (Suite roadmap 2026-07-29) -----------
  // Soft-deletes the caller's own account: sign-in stops working across the
  // whole suite immediately and every session dies, but the rows survive the
  // grace period so an admin (in CryptoPro Suite) can undo it. Requires the
  // account password even though the caller is already signed in — a session
  // alone should not be enough to destroy an account.
  app.post('/api/auth/delete-account', async (req, res) => {
    if (!db.dbEnabled()) return res.status(503).json({ error: 'Accounts are unavailable right now — please retry later.' });
    try {
      // currentUser, not currentUid: currentUid falls back to the GUEST
      // sentinel when signed out, so a truthiness check would let an anonymous
      // caller through.
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      const uid = user.id;
      // Same budget as sign-in: this endpoint verifies a password, so it is
      // also a password-guessing surface for anyone holding a stolen session.
      if (rateLimited(`delete-account:${uid}`, 5, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many attempts — please try again later.' });
      }
      const password = String(req.body?.password || '');
      if (!verifyPassword(password, user.salt, user.passwordHash)) {
        return res.status(401).json({ error: 'Password is incorrect' });
      }
      // Typing the username is the deliberate friction that separates this from
      // a misclick; checked server-side so a modified client can't skip it.
      if (normUser(req.body?.confirmUsername) !== uid) {
        return res.status(400).json({ error: 'Type your username exactly to confirm deletion' });
      }
      // 2FA, when enabled, is part of proving identity — not requiring it here
      // would make deletion the weakest door into the account.
      if (user.totpEnabled) {
        const code = req.body?.totpCode;
        if (!code) return res.status(401).json({ error: 'Enter your 2FA code', requiresTotp: true });
        if (!verifyTotp(user.totpSecret, code)) return res.status(401).json({ error: 'Invalid 2FA code', requiresTotp: true });
      }
      const ok = await db.softDeleteAccount(uid, uid);
      clearCookie(res, SESSION_COOKIE);
      console.log(`[auth] account ${uid} soft-deleted by self; purge in ${db.ACCOUNT_PURGE_GRACE_DAYS} days`);
      res.json({ ok, graceDays: db.ACCOUNT_PURGE_GRACE_DAYS });
    } catch (e) {
      console.error('[auth] delete account failed:', e?.stack || e);
      res.status(500).json({ error: 'Could not delete the account — database error, please retry.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const sid = parseCookies(req)[SESSION_COOKIE];
      if (sid) await db.deleteSession(sid);
    } catch { /* clear the cookie regardless */ }
    clearCookie(res, SESSION_COOKIE);
    res.json({ ok: true });
  });
}
