// src/tenantEngine.js
//
// Multi-tenant conversion Phase 5 (memory/project-trader-multitenant-plan.md):
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
};

/**
 * Resolves one tenant's trading context.
 *
 * @returns {Promise<{ok: true, uid, client, cfg, configErrors: string[], mode, tradingEnabled}
 *                 | {ok: false, uid, reason: string, detail?: string}>}
 */
export async function buildTenantContext(uid, deps = {}) {
  const getActiveAlpacaCredential = deps.getActiveAlpacaCredential || db.getActiveAlpacaCredential;
  const resolveConfig = deps.resolveConfigForUser || resolveConfigForUser;
  const makeClient = deps.createAlpacaClient || createAlpacaClient;

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

  return { ok: true, uid, client, cfg, configErrors, mode: cred.mode, tradingEnabled: cred.tradingEnabled };
}

/**
 * The dep bundle for a runner, bound to one tenant.
 *
 * stopWatchdog.js and dailySummary.js don't read `deps.client` — they take
 * individual functions whose defaults are env-var bound (see their imports from
 * trade.js). So every call they make has to be injected explicitly here;
 * passing only `client` would leave them trading the legacy account while
 * looking correct.
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
    appendDailySummaryBlock: (block, now) => {
      capture.journalText = block;
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
