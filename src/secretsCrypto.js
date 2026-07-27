// ============================================================
// SECRETS CRYPTO — AES-256-GCM envelope for at-rest Alpaca credentials
// ------------------------------------------------------------
// Multi-tenant conversion Phase 2 (see memory/project-trader-multitenant-plan.md).
// Each user connects their own Alpaca key/secret; those land in Postgres
// (trader_alpaca_credentials.ciphertext) and must not be readable by anyone
// with a database dump alone.
//
// Node's built-in `crypto` only — no new dependency. GCM (not CBC) so the
// stored blob is authenticated: a tampered/truncated ciphertext fails loudly
// at decrypt time instead of silently yielding garbage that would then be
// sent to Alpaca as an API key.
//
// Wire format (base64 of): iv[12] || authTag[16] || AES-256-GCM(JSON payload)
//
// Every call is additionally bound to the row it belongs to via GCM's AAD
// (see credentialAad below) — the tag then covers not just the bytes but
// *whose* credential this is, so a blob copied between rows fails to
// decrypt. Nothing here is a defense against an attacker who already has
// both the database and TRADER_CREDENTIALS_ENC_KEY.
//
// The key comes from TRADER_CREDENTIALS_ENC_KEY and is read LAZILY inside
// every call, never cached in a module-level constant — that import-time
// capture is exactly the anti-pattern Phase 1 removed from trade.js, and it
// also makes this module testable (a test can set/unset the env var between
// cases). Missing/invalid key => throw => callers fail closed with a 503,
// matching db.js's dbEnabled() convention.
//
// Key rotation is explicitly out of scope for Phase 2; the enc_version column
// on the table is a forward hook so a future version can tell blobs apart.
// ============================================================
import crypto from 'node:crypto';

const KEY_ENV = 'TRADER_CREDENTIALS_ENC_KEY';
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

/** Bumped only if the wire format changes; stored alongside each row. */
export const ENC_VERSION = 1;

/** No usable encryption key configured — routes should answer 503, not 500. */
export class CryptoNotConfigured extends Error {
  constructor(message) { super(message); this.name = 'CryptoNotConfigured'; }
}
/** Ciphertext failed authentication/parsing — treat the credential as disconnected. */
export class DecryptFailed extends Error {
  constructor(message) { super(message); this.name = 'DecryptFailed'; }
}

/**
 * Reads + validates the 32-byte base64 key on every call (see header note).
 * Buffer.from(..., 'base64') silently drops invalid characters rather than
 * throwing, so the byte-length check is the real validation.
 */
function readKey() {
  const raw = process.env[KEY_ENV];
  if (!raw || !String(raw).trim()) {
    throw new CryptoNotConfigured(`${KEY_ENV} is not set — server-side credential storage is disabled`);
  }
  const key = Buffer.from(String(raw).trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new CryptoNotConfigured(
      `${KEY_ENV} must decode to exactly ${KEY_BYTES} bytes (generate one with: openssl rand -base64 32)`,
    );
  }
  return key;
}

/** True when a valid key is configured — for capability probes/health output. */
export function cryptoEnabled() {
  try { readKey(); return true; } catch { return false; }
}

/**
 * Binds a ciphertext to the row it belongs to.
 *
 * GCM's tag authenticates the *bytes*, not their location — without this an
 * attacker with database write access (leaked Supabase credentials, a console
 * session) could copy another user's ciphertext into their own row and have
 * the engine trade the victim's Alpaca account on the attacker's schedule.
 * They never learn the secret and never break GCM; it's a confused-deputy
 * move that additional authenticated data closes outright. The version is
 * included so a future format can't be replayed into the v1 path either.
 */
export const credentialAad = (uid, mode) => `v${ENC_VERSION}|${uid}|${mode}`;

/**
 * @param {object} obj plain JSON-serializable payload (e.g. {keyId, secret, baseUrl})
 * @param {string} aad additional authenticated data — use credentialAad(uid, mode).
 *   Not secret, not stored: it is recomputed from the row's own columns at
 *   decrypt time, which is exactly what makes relocation detectable.
 * @returns {string} base64 envelope
 */
export function encryptSecret(obj, aad) {
  const key = readKey();
  if (typeof aad !== 'string' || !aad) {
    throw new TypeError('encryptSecret requires an aad string — use credentialAad(uid, mode)');
  }
  // Fresh random IV per call — IV reuse under one key is the catastrophic
  // GCM failure mode (it leaks plaintext XOR and forges the auth tag), so
  // this must never be derived from the uid/mode or otherwise be stable.
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * @param {string} b64 envelope produced by encryptSecret
 * @param {string} aad must equal the value used at encrypt time — a mismatch
 *   (i.e. the row was moved to another uid/mode) fails as DecryptFailed.
 * @returns {object} the original payload
 * @throws {CryptoNotConfigured|DecryptFailed}
 */
export function decryptSecret(b64, aad) {
  const key = readKey();
  if (typeof aad !== 'string' || !aad) {
    throw new TypeError('decryptSecret requires an aad string — use credentialAad(uid, mode)');
  }
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new DecryptFailed('stored credential is truncated or malformed');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  // Everything from here down sits inside the try: a malformed tag/IV makes
  // createDecipheriv/setAuthTag throw a bare crypto Error, and callers need
  // "credential unreadable" (DecryptFailed) rather than an opaque 500 they
  // can't distinguish from a database fault.
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Wrong key, or the row was tampered with. Never fall through to a
    // partial/unauthenticated read — the caller treats this as "credential
    // disconnected" and refuses to trade rather than sending junk to Alpaca.
    throw new DecryptFailed('stored credential failed authentication — wrong encryption key, or the row was modified');
  }
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new DecryptFailed('stored credential decrypted to invalid JSON');
  }
}
