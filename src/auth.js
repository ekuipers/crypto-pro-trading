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

const SESSION_COOKIE = 'cpc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SSO_TICKET_TTL_MS = 60 * 1000; // single-use, must be redeemed within 60s

// ---- Rate limiting -----------------------------------------------------
// In-memory sliding window per IP. Dependency-free rather than pulling in
// express-rate-limit for two routes. Swept periodically so long-running
// processes don't leak memory.
const rateBuckets = new Map(); // key -> timestamps[]
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter(t => now - t < windowMs);
  hits.push(now);
  rateBuckets.set(key, hits);
  return hits.length > limit;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, hits] of rateBuckets) {
    const kept = hits.filter(t => t > cutoff);
    if (kept.length) rateBuckets.set(key, kept); else rateBuckets.delete(key);
  }
}, 15 * 60 * 1000).unref();

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
function setCookie(res, name, value, maxAgeMs) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) bits.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
    return await db.getAccount(uid);
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
    res.json({ user: user ? publicUser(user) : null });
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

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const sid = parseCookies(req)[SESSION_COOKIE];
      if (sid) await db.deleteSession(sid);
    } catch { /* clear the cookie regardless */ }
    clearCookie(res, SESSION_COOKIE);
    res.json({ ok: true });
  });
}
