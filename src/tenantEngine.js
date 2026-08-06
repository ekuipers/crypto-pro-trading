// src/tenantEngine.js
//
// Multi-tenant engine (see CLAUDE.md "Multi-tenant engine — standing rules"):
// turns a uid into everything one scheduled run needs — that user's Alpaca
// client, that user's resolved strategy config, and the Postgres-backed state
// and journal deps bound to their own rows.
//
// This module exists so the "which account are we trading?" decision lives in
// exactly one place. Phases 1-3 built the seams (createAlpacaClient, the `cfg`
// parameter, uid-keyed accessors); this is where they are finally wired
// together, and it is the last point at which a mistake could route one user's
// schedule at another user's money.
//
// THE RULE THIS FILE ENFORCES: a tenant whose credential is missing, inactive
// or unreadable is SKIPPED WITH A REASON. It is never run against the legacy
// env-var account. That fallback would look harmless — the engine keeps
// trading — while actually placing one user's orders on the owner's Alpaca
// account. Every failure path below returns a skip, never a default client.
//
// The same skip shape now also carries plan entitlement: a tenant who is not
// on the Pro plan is skipped before any Alpaca client is built. A tenant whose
// Pro subscription just lapsed gets a short engine-only grace window first —
// see ENGINE_GRACE_MS below (ROADMAP item 7, decided 2026-08-06).
import * as db from "./db.js";
import { createAlpacaClient } from "./alpacaClient.js";
import { resolveConfigForUser, cfgSymbolCap } from "./userConfig.js";
import { DecryptFailed, KeyMismatch } from "./secretsCrypto.js";
import { buildJournalBlockText } from "./journal.js";
import { buildStopWatchdogBlockText } from "./stopWatchdog.js";
import { amsterdamParts } from "./tz.js";
import * as ps from "./positionState.js";
import * as marketData from "./marketData.js";

/** Why a tenant was not run. Surfaced in the dispatch response and the job log. */
export const SKIP = {
  NO_CREDENTIAL: "no active Alpaca credential connected",
  UNREADABLE: "stored credential could not be decrypted",
  WRONG_ENVIRONMENT: "credential was saved from a different environment (key mismatch)",
  NOT_PRO: "account is not on the Pro plan",
};

// ROADMAP item 7 ("A plan lapse now skips the tenant, including their open
// positions") — decided 2026-08-06: grace period. A lapsed Pro subscription
// keeps running the engine (both evaluate and watchdog) for this long after
// `current_period_end`, so a missed Patreon webhook or a brief payment hiccup
// doesn't strand an open position with no stop-watchdog cycle. Engine-only:
// requirePlan('pro') on the HTTP surface (manual "Run now", schedule writes,
// credential/strategy config) is untouched and still gates on getPlan() the
// instant the period ends — that protects paid-only *features*, this protects
// money already at risk. 3 days is a placeholder; the exact duration is a
// pricing call Suite's roadmap owns, not an engine constraint.
export const ENGINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * True while `sub.current_period_end` fell in the recent past — i.e. the
 * account WAS a paid Pro subscriber and the paid period ended within the
 * grace window. Never true for an account that was never Pro (nothing to
 * grace from) and never true once the window has fully elapsed, which is the
 * original hazard this item exists to bound rather than remove.
 */
function withinEngineGrace(sub, now) {
  if (!sub || sub.plan !== "pro" || !sub.current_period_end) return false;
  const lapsedAt = new Date(sub.current_period_end).getTime();
  return lapsedAt <= now && now - lapsedAt <= ENGINE_GRACE_MS;
}

/**
 * Resolves one tenant's trading context.
 *
 * @returns {Promise<{ok: true, uid, client, cfg, configErrors: string[], mode, tradingEnabled, graceUntil: Date|null}
 *                 | {ok: false, uid, reason: string, detail?: string}>}
 */
export async function buildTenantContext(uid, deps = {}) {
  const getActiveAlpacaCredential = deps.getActiveAlpacaCredential || db.getActiveAlpacaCredential;
  const resolveConfig = deps.resolveConfigForUser || resolveConfigForUser;
  const makeClient = deps.createAlpacaClient || createAlpacaClient;
  const getAccount = deps.getAccount || db.getAccount;
  const getPlan = deps.getPlan || db.getPlan;
  const getSubscription = deps.getSubscription || db.getSubscription;

  let cred;
  try {
    cred = await getActiveAlpacaCredential(uid);
  } catch (e) {
    // KeyMismatch first — it is a DecryptFailed subclass, and the distinction
    // is the difference between "reconnect your keys" and "you saved these
    // from Preview against the shared database".
    if (e instanceof KeyMismatch) return { ok: false, uid, reason: SKIP.WRONG_ENVIRONMENT, detail: e.message };
    if (e instanceof DecryptFailed) return { ok: false, uid, reason: SKIP.UNREADABLE, detail: e.message };
    throw e;
  }
  if (!cred) return { ok: false, uid, reason: SKIP.NO_CREDENTIAL };

  // Plan entitlement (monetization phase 4). requirePlan('pro') already gates
  // the HTTP surface, but the two GET cron routes authenticate with the
  // CRON_SECRET bearer and carry no session or uid, so they structurally
  // cannot take a route-level check — without this, a free tenant with a
  // connected credential still cost a full cycle of Alpaca calls and function
  // time. For POST ("Run now") this is a redundant backstop that also closes
  // the plan-lapse race between the route check and the run itself.
  //
  // The role-then-getPlan order mirrors auth.js's requirePlan()/planGateStatus()
  // exactly: an 'admin' or 'pro' role grants entitlement without spending a
  // getPlan() query, because checking only the Patreon-driven subscriptions
  // row would make Suite's manual role grant silently do nothing.
  //
  // Three placement/failure decisions, all deliberate:
  //   - AFTER credential resolution, so a tenant who is both unentitled and
  //     mis-keyed reports the credential reason — the one they can act on.
  //   - BEFORE the client is built, so an unentitled tenant costs no Alpaca
  //     calls, which is the entire point of the check.
  //   - NOT wrapped in try/catch. A missing accounts row (a deletion race) is
  //     a known bad state and fails closed to "not entitled", but a database
  //     outage must PROPAGATE, exactly like a non-DecryptFailed error above.
  //     Reporting an outage as "this user isn't paying" would stop every
  //     tenant's engine while reading like a deliberate opt-out.
  const account = await getAccount(uid);
  const roleGrants = account?.role === "admin" || account?.role === "pro";
  let entitled = account ? (roleGrants || (await getPlan(uid)) === "pro") : false;

  // Grace period (ROADMAP item 7): only spent when the fast paths above
  // already failed, so a healthy Pro tenant never pays this extra query. Not
  // wrapped in try/catch, same reasoning as getPlan() above — a lookup
  // failure here must propagate, not read as "not paying".
  let graceUntil = null;
  if (!entitled && account) {
    const sub = await getSubscription(uid);
    if (withinEngineGrace(sub, Date.now())) {
      entitled = true;
      graceUntil = new Date(new Date(sub.current_period_end).getTime() + ENGINE_GRACE_MS);
    }
  }
  if (!entitled) return { ok: false, uid, reason: SKIP.NOT_PRO };

  // Config is resolved before the client is built: createAlpacaClient bakes in
  // two of the order-band hard rules from cfg, so a per-user client built from
  // DEFAULT_CFG would quietly ignore that user's (tighter) bands.
  const { cfg, errors: configErrors } = await resolveConfig(uid);

  const client = makeClient({
    keyId: cred.keyId,
    secret: cred.secret,
    // Comes from getActiveAlpacaCredential, which re-derives it from the `mode`
    // column rather than trusting the decrypted blob — it is what
    // assertPaperTrading() keys on.
    baseUrl: cred.baseUrl,
    symbolCap: (symbol) => cfgSymbolCap(cfg, symbol),
    cfg,
  });

  return { ok: true, uid, client, cfg, configErrors, mode: cred.mode, tradingEnabled: cred.tradingEnabled, graceUntil };
}

/**
 * The dep bundle for a runner, bound to one tenant.
 *
 * stopWatchdog.js doesn't read `deps.client` — it takes individual functions
 * whose defaults are env-var bound (see its imports from trade.js). So every
 * call it makes has to be injected explicitly here; passing only `client`
 * would leave it trading the legacy account while looking correct.
 *
 * State and journal writes are deliberately NOT done inside these deps: the
 * runners call saveState/appendJournalBlock synchronously (an fs-era contract),
 * so an async Postgres write passed here would not be awaited. The deps mutate
 * or capture in memory and cronRoutes.js persists explicitly afterwards — the
 * same pattern the single-tenant version used.
 */
export function tenantDeps(ctx, state, capture) {
  const { client, cfg, uid } = ctx;
  return {
    client,
    cfg,
    // Keys reconcile.js's session-penalty cache per tenant. Without it the
    // dispatcher — which loops every user inside ONE serverless invocation —
    // hands user B the buckets computed from user A's fill history.
    cacheKey: uid,

    getPositions: () => client.getPositions(),
    getAccount: () => client.getAccount(),
    getOpenOrders: (...a) => client.getOpenOrders(...a),
    getLatestQuote: (...a) => client.getLatestQuote(...a),
    cancelOrder: (...a) => client.cancelOrder(...a),
    placeOrder: (...a) => client.placeOrder(...a),
    // Bound explicitly, not spread: getCryptoBars4h takes its options in the
    // THIRD positional slot, so `(...a, {client})` would land the options
    // object in `limit` whenever a caller passes only a symbol — silently
    // reverting to the default (env-var) client.
    getCryptoBars4h: (symbol, limit) => marketData.getCryptoBars4h(symbol, limit, { client }),
    fetchAllFills: () => marketData.fetchAllFills({ client }),

    loadState: () => state,
    saveState: () => {}, // persisted by the caller once main() resolves
    appendJournalBlock: (args) => {
      capture.journalText = buildJournalBlockText(args);
      capture.journalNow = args.now;
      return "postgres";
    },
    appendStopWatchdogBlock: (actions, now) => {
      capture.journalText = buildStopWatchdogBlockText(actions, now);
      capture.journalNow = now;
      return "postgres";
    },
  };
}

/** Loads one tenant's engine state, falling back to an empty state on first run. */
export async function loadTenantState(uid, getTraderState = db.getTraderState) {
  const data = await getTraderState(uid);
  return data || ps.EMPTY_STATE();
}

/** Persists one tenant's captured journal text under their own (uid, day) row. */
export async function persistTenantJournal(uid, capture, appendTraderJournal = db.appendTraderJournal) {
  if (!capture.journalText) return;
  const { dateStr } = amsterdamParts(capture.journalNow);
  await appendTraderJournal(uid, dateStr, capture.journalText);
}
