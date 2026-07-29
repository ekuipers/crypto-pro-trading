// ============================================================
// STRATEGY CONFIG ROUTES — per-user strategy/risk overrides (Phase 6 UI)
// ------------------------------------------------------------
// The write surface for the Phase 3 storage layer (src/userConfig.js +
// db.getStrategyConfig/putStrategyConfig). Until now nothing wrote a config
// row; these routes are what the Settings JSON editor calls.
//
// Security shape (this decides real money-at-risk parameters — read first):
//   * Every route is scoped to `currentUid(req)`. The uid comes from the
//     session cookie only — never the body, path, or a query param.
//   * PUT REJECTS on `!validateOverrides().ok` and stores `clean`, never the
//     raw body. That is stricter than the engine's own read path, which
//     merges `clean` and drops bad keys so one stale value can't stop a
//     running engine. Both behaviours are wanted: silent degradation is right
//     for a resolve that must not fail, and wrong for a save the user is
//     watching — there, a dropped key would read as "saved" while the engine
//     kept trading the old number.
//   * Locked keys (shorts, the streak throttle, every ships-OFF flag) are
//     rejected by validateOverrides, so CLAUDE.md's hard rules cannot be
//     edited through this surface. The bounds in CONFIG_SPEC are where the
//     0.2% limit band, ≤30% symbol cap, ≤2% risk/trade and the 7/5
//     correlation budget are enforced against user JSON.
//   * The engine re-validates on EVERY read anyway (resolveConfigForUser), so
//     a row written by some other path still cannot smuggle an out-of-range
//     value into a trading decision.
// ============================================================
import * as db from './db.js';
import { currentUid } from './auth.js';
import { validateOverrides, mergeConfig, CONFIG_SPEC, EDITABLE_KEYS, DEFAULT_CFG } from './userConfig.js';
import { rateLimited } from './rateLimit.js';

const READ_LIMIT = 120;
const WRITE_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;

// A valid override object has at most EDITABLE_KEYS.length entries. The cap is
// generous but bounded, so a 2mb body of junk keys can't be turned into a 2mb
// array of error strings (express.json's own limit is far too loose to rely on
// as the only bound here).
const MAX_KEYS = 200;

/** CONFIG_SPEC trimmed to what the editor may set — type/bounds only, no locked entries. */
export const editableSpec = () =>
  Object.fromEntries(EDITABLE_KEYS.map((k) => [k, CONFIG_SPEC[k]]));

/**
 * Validates a PUT body into exactly what should be stored.
 * Pure — no I/O — so the rules are unit-testable without a database.
 * @returns {{ok: true, clean: object} | {ok: false, status: number, errors: string[]}}
 */
export function buildConfigUpdate(body) {
  // Accept either {config:{...}} or a bare object, so a hand-written curl and
  // the dashboard editor agree.
  const raw = body && Object.hasOwn(body, 'config') ? body.config : body;
  if (raw === null || raw === undefined) return { ok: true, clean: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, errors: ['config must be a JSON object'] };
  }
  if (Object.keys(raw).length > MAX_KEYS) {
    return { ok: false, status: 413, errors: [`config has too many keys (max ${MAX_KEYS})`] };
  }
  const { ok, errors, clean } = validateOverrides(raw);
  // Reject rather than store the partial `clean` — see the header note.
  if (!ok) return { ok: false, status: 400, errors };
  return { ok: true, clean };
}

export function installStrategyConfigRoutes(app) {
  async function requireUid(req, res, limit) {
    const uid = await currentUid(req);
    if (uid === db.GUEST) {
      res.status(401).json({ error: 'Sign in first' });
      return null;
    }
    if (rateLimited(`strategy-config:${limit}:${uid}`, limit, WINDOW_MS)) {
      res.status(429).json({ error: 'Too many requests — please try again later.' });
      return null;
    }
    return uid;
  }

  const dbError = (res, what, e) => {
    console.error(`[strategy-config] ${what} failed:`, e?.stack || e);
    res.status(500).json({ error: 'Could not complete the request — database error, please retry.' });
  };

  // The editor's whole payload: what this user has overridden, what the
  // compiled defaults are, and which keys are settable within what bounds.
  app.get('/api/strategy-config', async (req, res) => {
    try {
      const uid = await requireUid(req, res, READ_LIMIT);
      if (!uid) return;
      const overrides = (await db.getStrategyConfig(uid)) || {};
      // Surfaces a row that predates a tightened bound: the engine silently
      // drops those keys on resolve, and without this the user would see
      // their saved value in the editor and never learn it isn't in force.
      const { errors } = mergeConfig(overrides);
      res.set('Cache-Control', 'no-store');
      res.json({
        overrides,
        defaults: DEFAULT_CFG,
        spec: editableSpec(),
        editableKeys: EDITABLE_KEYS,
        staleErrors: errors,
      });
    } catch (e) { dbError(res, 'read', e); }
  });

  app.put('/api/strategy-config', async (req, res) => {
    try {
      const uid = await requireUid(req, res, WRITE_LIMIT);
      if (!uid) return;
      const built = buildConfigUpdate(req.body);
      if (!built.ok) return res.status(built.status).json({ error: 'Invalid settings', errors: built.errors });
      await db.putStrategyConfig(uid, built.clean);
      console.log(`[strategy-config] saved uid=${uid} keys=${Object.keys(built.clean).length}`);
      res.json({ ok: true, overrides: built.clean });
    } catch (e) { dbError(res, 'save', e); }
  });

  // Revert to the compiled defaults. Not step-up guarded: it moves the user
  // back to the shipped, known-safe configuration rather than away from it,
  // and nothing unrecoverable is lost.
  app.delete('/api/strategy-config', async (req, res) => {
    try {
      const uid = await requireUid(req, res, WRITE_LIMIT);
      if (!uid) return;
      const removed = await db.deleteStrategyConfig(uid);
      console.log(`[strategy-config] reset uid=${uid} had_row=${removed}`);
      res.json({ ok: true, overrides: {} });
    } catch (e) { dbError(res, 'reset', e); }
  });
}
