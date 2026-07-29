// ============================================================
// CREDENTIALS ROUTES — per-user Alpaca API keys (multi-tenant Phase 2)
// ------------------------------------------------------------
// See memory/project-trader-multitenant-plan.md. Lets each signed-in Suite
// account connect its OWN Alpaca credentials for the server-side engine,
// instead of every scheduled run using the one shared APCA_* env-var account.
//
// Nothing in this file trades. Phase 5 is what teaches the cron dispatcher to
// pick these up; until then these rows are stored and managed but unused, so
// this phase is shippable on its own with zero behavior change.
//
// Security shape (this is a secrets-handling surface — read before editing):
//   * Write-only. There is NO route that returns a stored key or secret.
//     Reads project through db.listAlpacaCredentials(), whose SELECT lists
//     metadata columns explicitly and cannot leak the ciphertext.
//   * Every route is scoped to `currentUid(req)`. The uid is never taken from
//     the path, body, or a query param, so one account cannot address
//     another's rows even by guessing a username.
//   * baseUrl is DERIVED from `mode` here, never accepted from the client —
//     an attacker-supplied base URL would let a stored credential be replayed
//     against an arbitrary host by our own server (SSRF + credential exfil).
//   * A missing/invalid TRADER_CREDENTIALS_ENC_KEY fails closed with 503;
//     credentials are never stored in plaintext as a fallback.
//   * CryptoPro Trader is paper-trading only (CLAUDE.md hard rule / Suite
//     workflow rule 30). A live credential may still be STORED — the engine
//     uses live keys for read-only insight — but src/alpacaClient.js's
//     assertPaperTrading() independently blocks every order placement and
//     cancellation on a non-paper base URL. Storing a key here does not, and
//     must not, become a way around that.
//   * Phase 6 adds step-up auth on DESTRUCTIVE changes only (disconnecting a
//     credential, or overwriting one that is currently active — i.e. the one
//     the engine is trading with). Connecting a first credential stays
//     frictionless: it takes nothing away, and a password prompt on the very
//     first setup step is where users give up. Every mutation writes a row to
//     trader_credential_audit regardless.
// ============================================================
import * as db from './db.js';
import { currentUid, verifyStepUpPassword } from './auth.js';
import { cryptoEnabled, CryptoNotConfigured, DecryptFailed, KeyMismatch } from './secretsCrypto.js';
import { ALPACA_HOSTS } from './alpacaClient.js';
import { rateLimited } from './rateLimit.js';

export const MODES = ['paper', 'live'];

// Per-uid windows. Writes are deliberately tight: a legitimate user connects
// a key a handful of times ever, while each write is an AES encrypt plus a
// locking transaction that holds one of only five pooled connections — an
// authenticated flood would otherwise starve session lookups app-wide.
const WRITE_LIMIT = 20;
const READ_LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;

// Alpaca key ids look like "PK..."/"AK..." (uppercase alphanumeric, ~20
// chars); secrets are ~40 chars of base64-ish text. Bounds are deliberately
// wider than today's real formats (so a format change doesn't lock users out)
// but tight enough to reject pasted JSON, URLs, or whole .env files.
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_RE = /^[\x21-\x7e]{8,256}$/; // printable ASCII, no spaces/control chars

export const isValidMode = (mode) => MODES.includes(mode);

/**
 * The step-up policy in one place, as a pure predicate: which credential
 * mutations require the account password to be re-entered.
 *
 * Step-up guards actions that DESTROY access or redirect a live engine, not
 * actions that add or merely re-select. Requiring a password to connect a
 * first key would put a friction wall at the one step every user must clear,
 * and would protect nothing — an attacker holding the session could simply
 * connect their own key without it.
 *
 * @param {'connect'|'replace'|'activate'|'delete'} action
 * @param {{isActive?: boolean}} ctx isActive => the credential being replaced
 *   is the one the engine is trading with right now.
 */
export function stepUpRequired(action, { isActive = false } = {}) {
  // Irreversible: the ciphertext is gone, the plaintext was never recoverable
  // from us, and if it was active the account's engine stops — stop-loss
  // watchdog included.
  if (action === 'delete') return true;
  // Overwriting the live credential redirects every future scheduled run to a
  // different Alpaca account. Replacing a stored-but-inactive mode changes
  // nothing that is running.
  if (action === 'replace') return isActive === true;
  // 'connect' (nothing to lose) and 'activate' (picks between keys the user
  // already connected, trivially reversible) stay frictionless.
  return false;
}

/**
 * Validates the client payload and builds exactly what gets encrypted.
 * Pure — no I/O — so the rules are unit-testable without a database.
 * @returns {{ok: true, payload: {keyId, secret, baseUrl}, activate: boolean}
 *          | {ok: false, error: string}}
 */
export function buildCredentialPayload(mode, body) {
  if (!isValidMode(mode)) return { ok: false, error: 'mode must be "paper" or "live"' };
  const keyId = String(body?.keyId ?? '').trim();
  const secret = String(body?.secret ?? '').trim();
  if (!KEY_ID_RE.test(keyId)) {
    return { ok: false, error: 'Enter a valid Alpaca API key id (8-128 chars: letters, digits, - _)' };
  }
  if (!SECRET_RE.test(secret)) {
    return { ok: false, error: 'Enter a valid Alpaca API secret (8-256 printable characters, no spaces)' };
  }
  return {
    ok: true,
    // baseUrl is derived, never client-supplied — see the header note.
    payload: { keyId, secret, baseUrl: ALPACA_HOSTS[mode] },
    // Strict === true so a truthy string like "false" can't coerce into
    // activating a credential (same guard cronRoutes.js uses for `enabled`).
    activate: body?.activate === true,
  };
}

/** Maps a thrown error to an HTTP status + a message that never echoes secret material. */
export function errorResponse(e) {
  if (e instanceof CryptoNotConfigured) {
    return { status: 503, body: { error: 'Server-side credential storage is not configured on this deployment.' } };
  }
  // Must precede the DecryptFailed arm — KeyMismatch extends it. The message
  // is deliberately more specific: this one is an operator/deployment
  // problem (the row was written from another environment against the shared
  // database), and "reconnect it" alone would send the user in circles.
  // Safe to state plainly: it names no key material, only that they differ.
  if (e instanceof KeyMismatch) {
    return {
      status: 409,
      body: {
        error:
          'This credential was saved from a different environment and cannot be read here. ' +
          'Reconnect it from this environment, or use the environment that saved it.',
      },
    };
  }
  if (e instanceof DecryptFailed) {
    return { status: 500, body: { error: 'Stored credential could not be read — please reconnect it.' } };
  }
  // Unique-violation on the "one active credential per user" index: two
  // activations raced. The transaction rolled back so the data is consistent —
  // this is genuinely retryable, and a 500 would read as data loss on a
  // secrets screen.
  if (e?.code === '23505') {
    return { status: 409, body: { error: 'Another change was in flight — please retry.' } };
  }
  return { status: 500, body: { error: 'Could not complete the request — database error, please retry.' } };
}

export function installCredentialsRoutes(app) {
  /**
   * Resolves the signed-in uid, or null for guests / rate-limited callers
   * (this function has already answered 401/429 in that case).
   * The uid comes only from the session cookie — never from the path, body or
   * query — which is what makes cross-account access impossible.
   */
  async function requireUid(req, res, limit, { needsCrypto = false } = {}) {
    const uid = await currentUid(req);
    if (uid === db.GUEST) {
      res.status(401).json({ error: 'Sign in first' });
      return null;
    }
    // Answered BEFORE a rate-limit token is spent. A deployment with no usable
    // encryption key cannot store anything, so this write was going to 503
    // regardless — and charging it against the budget makes a misconfiguration
    // self-limiting: the operator gets locked out of the endpoint precisely
    // while diagnosing it. Observed for real on 2026-07-28, where a missing
    // TRADER_CREDENTIALS_ENC_KEY burned the 20/hour write budget on 503s.
    // Safe to check here: currentUid() has already run, so this leaks
    // deployment state only to signed-in callers, who can read the same field
    // from GET /api/alpaca-credentials anyway.
    if (needsCrypto && !cryptoEnabled()) {
      res.status(503).json({ error: 'Server-side credential storage is not configured on this deployment.' });
      return null;
    }
    if (rateLimited(`credentials:${limit}:${uid}`, limit, WINDOW_MS)) {
      res.status(429).json({ error: 'Too many requests — please try again later.' });
      return null;
    }
    return uid;
  }

  /**
   * Records one successful mutation in both channels: the platform log (uid +
   * mode only, never the key preview or the request body) and the durable
   * per-user trail the Settings panel shows. db.appendCredentialAudit never
   * throws, so a trail failure cannot turn a completed change into an error.
   */
  const audit = (action, uid, mode, detail = null) => {
    console.log(`[credentials] ${action} uid=${uid} mode=${mode} at=${new Date().toISOString()}`);
    return db.appendCredentialAudit(uid, action, mode, detail);
  };

  /**
   * Answers 401 and returns false unless the caller re-proves the account
   * password. Used only where the action destroys or replaces a credential
   * the engine may be trading with right now.
   */
  async function requireStepUp(req, res, uid) {
    if (await verifyStepUpPassword(uid, req.body?.password)) return true;
    // Deliberately identical wording whether the password was absent or
    // wrong, and no hint about which credential exists.
    res.status(401).json({ error: 'Enter your account password to confirm this change.', stepUp: true });
    return false;
  }

  /** True when this mode already holds the credential the engine would trade with. */
  async function isActiveMode(uid, mode) {
    const rows = await db.listAlpacaCredentials(uid);
    return rows.some((r) => r.mode === mode && r.active);
  }

  // Metadata only: which modes are connected, which is active, last 4 of each
  // key id. Never the key, never the secret, never the ciphertext.
  app.get('/api/alpaca-credentials', async (req, res) => {
    try {
      const uid = await requireUid(req, res, READ_LIMIT);
      if (!uid) return;
      const [credentials, auditTrail] = await Promise.all([
        db.listAlpacaCredentials(uid),
        db.listCredentialAudit(uid, 10),
      ]);
      // Account-scoped: never let an intermediary cache it.
      res.set('Cache-Control', 'no-store');
      res.json({ configured: cryptoEnabled(), credentials, audit: auditTrail });
    } catch (e) {
      console.error('[credentials] list failed:', e?.stack || e);
      const { status, body } = errorResponse(e);
      res.status(status).json(body);
    }
  });

  // Connect or replace one mode's credential. Write-only: the response
  // repeats the metadata list, not the submitted values.
  app.post('/api/alpaca-credentials/:mode', async (req, res) => {
    try {
      const uid = await requireUid(req, res, WRITE_LIMIT, { needsCrypto: true });
      if (!uid) return;
      const built = buildCredentialPayload(req.params.mode, req.body);
      if (!built.ok) return res.status(400).json({ error: built.error });
      const replacingActive = await isActiveMode(uid, req.params.mode);
      if (stepUpRequired('replace', { isActive: replacingActive }) && !(await requireStepUp(req, res, uid))) return;
      await db.putAlpacaCredential(uid, req.params.mode, built.payload, built.activate);
      await audit(
        replacingActive ? db.CREDENTIAL_ACTIONS.REPLACED : db.CREDENTIAL_ACTIONS.CONNECTED,
        uid,
        req.params.mode,
        built.activate ? 'set active' : null,
      );
      res.json({ ok: true, credentials: await db.listAlpacaCredentials(uid) });
    } catch (e) {
      // Log the error message only — never req.body, which holds the secret.
      console.error('[credentials] save failed:', e?.message || e);
      const { status, body } = errorResponse(e);
      res.status(status).json(body);
    }
  });

  // Switch which stored credential the engine would use.
  app.post('/api/alpaca-credentials/:mode/activate', async (req, res) => {
    try {
      const uid = await requireUid(req, res, WRITE_LIMIT);
      if (!uid) return;
      const { mode } = req.params;
      if (!isValidMode(mode)) return res.status(400).json({ error: 'mode must be "paper" or "live"' });
      const switched = await db.setActiveAlpacaMode(uid, mode);
      if (!switched) return res.status(404).json({ error: `No ${mode} credential is connected` });
      // No step-up: this only picks between credentials the user already
      // connected, destroys nothing, and is trivially reversible.
      await audit(db.CREDENTIAL_ACTIONS.ACTIVATED, uid, mode);
      res.json({ ok: true, credentials: await db.listAlpacaCredentials(uid) });
    } catch (e) {
      console.error('[credentials] activate failed:', e?.stack || e);
      const { status, body } = errorResponse(e);
      res.status(status).json(body);
    }
  });

  app.delete('/api/alpaca-credentials/:mode', async (req, res) => {
    try {
      const uid = await requireUid(req, res, WRITE_LIMIT);
      if (!uid) return;
      const { mode } = req.params;
      if (!isValidMode(mode)) return res.status(400).json({ error: 'mode must be "paper" or "live"' });
      // Checked before the delete, not after.
      if (stepUpRequired('delete') && !(await requireStepUp(req, res, uid))) return;
      const removed = await db.deleteAlpacaCredential(uid, mode);
      if (!removed) return res.status(404).json({ error: `No ${mode} credential is connected` });
      await audit(db.CREDENTIAL_ACTIONS.DELETED, uid, mode);
      res.json({ ok: true, credentials: await db.listAlpacaCredentials(uid) });
    } catch (e) {
      // Message only — this request body carries the account password.
      console.error('[credentials] delete failed:', e?.message || e);
      const { status, body } = errorResponse(e);
      res.status(status).json(body);
    }
  });
}
