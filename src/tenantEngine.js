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
// Plan entitlement (2026-08-08 revision) no longer gates cycle participation:
// Free tenants get a real client and run real cycles too, so someone can see
// the engine work before paying (Suite ROADMAP's "Free vs Pro distinction"
// analysis). The resolved plan ('pro'|'free') is threaded onto cfg.PLAN and
// onto the tenant's watchlist instead, so risk.js's planPositionCapAllows()
// and the watchlist truncation below do the actual capping. This replaces the
// old SKIP.NOT_PRO / ENGINE_GRACE_MS grace-period mechanism (ROADMAP item 7)
// entirely: nobody is skipped for plan reasons anymore, so a lapsed Pro tenant
// just becomes a capped Free tenant with permanent watchdog coverage instead
// of a 3-day grace window.
import * as db from "./db.js";
import { createAlpacaClient } from "./alpacaClient.js";
import { resolveConfigForUser, cfgSymbolCap, DEFAULT_WATCHLIST, FREE_WATCHLIST_LIMIT } from "./userConfig.js";
import { DecryptFailed, KeyMismatch } from "./secretsCrypto.js";
import { buildJournalBlockText } from "./journal.js";
import { buildStopWatchdogBlockText } from "./stopWatchdog.js";
import { amsterdamParts } from "./tz.js";
import { isCrypto } from "./trade.js";
import * as ps from "./positionState.js";
import * as marketData from "./marketData.js";

/** Why a tenant was not run. Surfaced in the dispatch response and the job log. */
export const SKIP = {
  NO_CREDENTIAL: "no active Alpaca credential connected",
  UNREADABLE: "stored credential could not be decrypted",
  WRONG_ENVIRONMENT: "credential was saved from a different environment (key mismatch)",
};

/**
 * Resolves one tenant's trading context.
 *
 * @returns {Promise<{ok: true, uid, client, cfg, configErrors: string[], mode, tradingEnabled, plan: string, watchlist: string[]}
 *                 | {ok: false, uid, reason: string, detail?: string}>}
 */
export async function buildTenantContext(uid, deps = {}) {
  const getActiveAlpacaCredential = deps.getActiveAlpacaCredential || db.getActiveAlpacaCredential;
  const resolveConfig = deps.resolveConfigForUser || resolveConfigForUser;
  const makeClient = deps.createAlpacaClient || createAlpacaClient;
  const getAccount = deps.getAccount || db.getAccount;
  const getPlan = deps.getPlan || db.getPlan;
  const getUserWatchlist = deps.getUserWatchlist || db.getUserWatchlist;

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

  // Plan resolution (2026-08-08 revision): no longer gates whether the tenant
  // runs at all — see the module header. Just decides which cap applies.
  // Role-then-getPlan mirrors auth.js's requirePlan()/planGateStatus() exactly:
  // an 'admin' or 'pro' role grants Pro without spending a getPlan() query,
  // because checking only the Patreon-driven subscriptions row would make
  // Suite's manual role grant silently do nothing. Not wrapped in try/catch:
  // a missing accounts row (a deletion race) is a known bad state and fails
  // closed to 'free', but a database outage must PROPAGATE, exactly like a
  // non-DecryptFailed error above — reporting an outage as "this user is
  // free" would silently cap every tenant's positions instead of surfacing
  // the failure.
  const account = await getAccount(uid);
  const roleGrants = account?.role === "admin" || account?.role === "pro";
  const plan = account && (roleGrants || (await getPlan(uid)) === "pro") ? "pro" : "free";

  // Config is resolved before the client is built: createAlpacaClient bakes in
  // two of the order-band hard rules from cfg, so a per-user client built from
  // DEFAULT_CFG would quietly ignore that user's (tighter) bands.
  const { cfg: resolvedCfg, errors: configErrors } = await resolveConfig(uid);
  // PLAN rides alongside the CONFIG_SPEC-validated tunables so evaluateSymbol.js's
  // Gate 2b can read it off the same cfg bag as everything else — it is
  // account/subscription data, not a user-settable CONFIG_SPEC key, so it's
  // added after resolveConfig rather than going through mergeConfig.
  const cfg = Object.freeze({ ...resolvedCfg, PLAN: plan });

  // Per-tenant watchlist: the user's own Settings-page list (same one
  // Autopilot/Journal/Signals/Portfolio already use), falling back to the
  // canonical default for a tenant who never customized it. Free plan is
  // capped to FREE_WATCHLIST_LIMIT symbols here as defense in depth — the
  // client (analytics-watchlist.js) and PUT /api/session are the primary
  // enforcement, this only covers a stale row from before a Pro->Free
  // downgrade.
  const rawWatchlist = (await getUserWatchlist(uid)) || DEFAULT_WATCHLIST;
  let watchlist = [...new Set(rawWatchlist.filter(isCrypto))];
  if (plan === "free") watchlist = watchlist.slice(0, FREE_WATCHLIST_LIMIT);

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

  return { ok: true, uid, client, cfg, configErrors, mode: cred.mode, tradingEnabled: cred.tradingEnabled, plan, watchlist };
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
