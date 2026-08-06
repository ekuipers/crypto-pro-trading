// Multi-tenant Phase 5 — per-tenant context resolution.
//
// The property under test throughout: a tenant whose credential is missing,
// inactive or unreadable is SKIPPED, and never silently run against the legacy
// env-var account. That fallback is the one failure mode that looks healthy
// while placing one user's orders on someone else's Alpaca account, so most of
// these tests assert on what did NOT happen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTenantContext, tenantDeps, SKIP } from "./tenantEngine.js";
import { DecryptFailed, KeyMismatch } from "./secretsCrypto.js";
import { DEFAULT_CFG } from "./userConfig.js";
import { ALPACA_HOSTS } from "./alpacaClient.js";

const PAPER = {
  keyId: "PKTEST0001",
  secret: "s3cret",
  baseUrl: ALPACA_HOSTS.paper,
  mode: "paper",
  tradingEnabled: true,
};

/** Records every createAlpacaClient call so a test can prove which keys were used. */
function stubClientFactory() {
  const calls = [];
  const factory = (opts) => {
    calls.push(opts);
    return { __stub: true, opts, getPositions: async () => [], getAccount: async () => ({}) };
  };
  return { factory, calls };
}

// Baseline tenant: a plain account with no role grant, entitled through the
// Patreon-driven subscriptions row. Chosen over a role grant so the default
// path through every other test still exercises the getPlan() call.
const deps = (over = {}) => ({
  getActiveAlpacaCredential: async () => PAPER,
  resolveConfigForUser: async () => ({ cfg: DEFAULT_CFG, errors: [] }),
  createAlpacaClient: stubClientFactory().factory,
  getAccount: async () => ({ id: "alice", role: null }),
  getPlan: async () => "pro",
  ...over,
});

/** Records every getPlan call so a test can prove the role shortcut skipped it. */
function stubGetPlan(plan = "free") {
  const calls = [];
  return { calls, getPlan: async (uid) => { calls.push(uid); return plan; } };
}

describe("buildTenantContext", () => {
  test("builds a client from the tenant's own credential", async () => {
    const { factory, calls } = stubClientFactory();
    const ctx = await buildTenantContext("alice", deps({ createAlpacaClient: factory }));

    assert.equal(ctx.ok, true);
    assert.equal(ctx.uid, "alice");
    assert.equal(ctx.mode, "paper");
    assert.equal(ctx.tradingEnabled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].keyId, PAPER.keyId);
    assert.equal(calls[0].secret, PAPER.secret);
    assert.equal(calls[0].baseUrl, ALPACA_HOSTS.paper);
  });

  test("a user with no active credential is skipped, and no client is built", async () => {
    const { factory, calls } = stubClientFactory();
    const ctx = await buildTenantContext("bob", deps({
      getActiveAlpacaCredential: async () => null,
      createAlpacaClient: factory,
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.NO_CREDENTIAL);
    assert.equal(calls.length, 0, "a client was built for a user with no credential");
    assert.equal(ctx.client, undefined, "a skipped tenant must not carry a client");
  });

  test("an unreadable credential is skipped as UNREADABLE, not run", async () => {
    const { factory, calls } = stubClientFactory();
    const ctx = await buildTenantContext("bob", deps({
      getActiveAlpacaCredential: async () => { throw new DecryptFailed("bad tag"); },
      createAlpacaClient: factory,
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.UNREADABLE);
    assert.equal(calls.length, 0);
  });

  test("a key written by another environment reports WRONG_ENVIRONMENT specifically", async () => {
    // KeyMismatch extends DecryptFailed, so ordering matters: a generic
    // instanceof check first would collapse the two and lose the only
    // diagnosis that tells an operator what to actually do about it.
    const ctx = await buildTenantContext("bob", deps({
      getActiveAlpacaCredential: async () => { throw new KeyMismatch("row abc vs deployment def"); },
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.WRONG_ENVIRONMENT);
    assert.match(ctx.detail, /abc/);
  });

  test("an unexpected error propagates instead of being swallowed as a skip", async () => {
    // A database outage must not be reported as "this user has no credential" —
    // that reads as a deliberate opt-out and would hide an engine-wide failure.
    await assert.rejects(
      () => buildTenantContext("bob", deps({
        getActiveAlpacaCredential: async () => { throw new Error("connection reset"); },
      })),
      /connection reset/,
    );
  });

  test("the client is built from the tenant's resolved cfg, not the compiled defaults", async () => {
    const { factory, calls } = stubClientFactory();
    const tightened = { ...DEFAULT_CFG, LIMIT_BAND_PCT: 0.0005, MAX_POSITION_PCT: 0.1 };
    const ctx = await buildTenantContext("alice", deps({
      resolveConfigForUser: async () => ({ cfg: tightened, errors: ["SHORTS_ENABLED: not user-configurable"] }),
      createAlpacaClient: factory,
    }));

    assert.equal(ctx.ok, true);
    // createAlpacaClient bakes in order-band rules from cfg, so passing
    // DEFAULT_CFG here would silently widen this user's bands back out.
    assert.equal(calls[0].cfg.LIMIT_BAND_PCT, 0.0005);
    assert.equal(ctx.cfg.LIMIT_BAND_PCT, 0.0005);
    assert.deepEqual(ctx.configErrors, ["SHORTS_ENABLED: not user-configurable"]);
  });

  test("symbolCap resolves through the tenant's own portfolio caps", async () => {
    const { factory, calls } = stubClientFactory();
    const capped = {
      ...DEFAULT_CFG,
      PORTFOLIO_CAPS: { caps: { "BTC/USD": 0.12 }, default_cap: 0.03 },
    };
    await buildTenantContext("alice", deps({
      resolveConfigForUser: async () => ({ cfg: capped, errors: [] }),
      createAlpacaClient: factory,
    }));

    assert.equal(calls[0].symbolCap("BTC/USD"), 0.12);
    assert.equal(calls[0].symbolCap("SOL/USD"), 0.03);
  });

  // ---- Plan entitlement (ROADMAP item 7) ---------------------------------
  // requirePlan('pro') stops the API, not the work: the two GET cron routes
  // are bearer-authenticated with no session, so the dispatcher used to run a
  // free tenant's full cycle — Alpaca calls and all — on a valid credential.
  // The skip has to happen here, and before the client is built.
  test("a free-plan tenant with a valid credential is skipped, and no client is built", async () => {
    const { factory, calls } = stubClientFactory();
    const ctx = await buildTenantContext("bob", deps({
      getAccount: async () => ({ id: "bob", role: null }),
      getPlan: async () => "free",
      createAlpacaClient: factory,
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.NOT_PRO);
    assert.equal(calls.length, 0, "a client was built for a tenant with no Pro entitlement");
    assert.equal(ctx.client, undefined, "a skipped tenant must not carry a client");
  });

  test("a lapsed subscription (getPlan resolves 'free') is skipped", async () => {
    // The account still exists and still has a working credential — only the
    // subscriptions row has gone non-active/expired. db.getPlan already folds
    // every one of those cases into 'free'.
    const ctx = await buildTenantContext("bob", deps({
      getAccount: async () => ({ id: "bob", role: null, username: "bob" }),
      getPlan: async () => "free",
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.NOT_PRO);
  });

  test("no accounts row at all fails closed to NOT_PRO, not an error", async () => {
    // Possible after a deletion race. Fail closed: an absent account is not a
    // tenant to trade, and must not surface as an engine-wide failure either.
    const ctx = await buildTenantContext("ghost", deps({
      getAccount: async () => null,
      getPlan: async () => "pro",
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.NOT_PRO);
  });

  test("role 'admin' is entitled without a getPlan query", async () => {
    // Same shortcut as auth.js's requirePlan()/planGateStatus(): checking only
    // subscriptions.plan would lock admins out of the engine they support
    // users on, and make Suite's manual role grant silently do nothing.
    const { calls, getPlan } = stubGetPlan("free");
    const ctx = await buildTenantContext("root", deps({
      getAccount: async () => ({ id: "root", role: "admin" }),
      getPlan,
    }));

    assert.equal(ctx.ok, true);
    assert.equal(calls.length, 0, "the role grant should decide it without a getPlan query");
  });

  test("role 'pro' is entitled without a getPlan query", async () => {
    // The manual comp grant, set by an admin via Suite's role endpoint.
    const { calls, getPlan } = stubGetPlan("free");
    const ctx = await buildTenantContext("comped", deps({
      getAccount: async () => ({ id: "comped", role: "pro" }),
      getPlan,
    }));

    assert.equal(ctx.ok, true);
    assert.equal(calls.length, 0, "the role grant should decide it without a getPlan query");
  });

  test("a credential problem outranks a plan problem in the reported reason", async () => {
    // Check order is load-bearing: a tenant who is both unentitled AND
    // mis-keyed should hear about the credential, which is the one thing they
    // can actually act on.
    const ctx = await buildTenantContext("bob", deps({
      getActiveAlpacaCredential: async () => { throw new KeyMismatch("row abc vs deployment def"); },
      getAccount: async () => ({ id: "bob", role: null }),
      getPlan: async () => "free",
    }));

    assert.equal(ctx.ok, false);
    assert.equal(ctx.reason, SKIP.WRONG_ENVIRONMENT);
  });

  test("a getPlan database failure propagates instead of reading as 'not paying'", async () => {
    // Same rule as the credential path above: a known bad state is a skip, an
    // unexpected error is not. Swallowing an outage here would stop every
    // tenant's engine while every skip line read like a deliberate opt-out.
    await assert.rejects(
      () => buildTenantContext("bob", deps({
        getAccount: async () => ({ id: "bob", role: null }),
        getPlan: async () => { throw new Error("connection reset"); },
      })),
      /connection reset/,
    );
  });

  test("a getAccount database failure propagates instead of becoming a skip", async () => {
    await assert.rejects(
      () => buildTenantContext("bob", deps({
        getAccount: async () => { throw new Error("connection reset"); },
      })),
      /connection reset/,
    );
  });

  test("a live-mode credential resolves but is not trading-enabled", async () => {
    const ctx = await buildTenantContext("alice", deps({
      getActiveAlpacaCredential: async () => ({
        ...PAPER, mode: "live", baseUrl: ALPACA_HOSTS.live, tradingEnabled: false,
      }),
    }));

    assert.equal(ctx.ok, true);
    assert.equal(ctx.mode, "live");
    assert.equal(ctx.tradingEnabled, false, "live credentials must never report as trading-enabled");
  });
});

describe("tenantDeps", () => {
  const ctx = (uid = "alice") => ({
    uid,
    cfg: DEFAULT_CFG,
    client: {
      getPositions: async () => [{ symbol: "BTC/USD" }],
      getAccount: async () => ({ equity: "1000" }),
      getOpenOrders: async () => [],
      getLatestQuote: async () => ({}),
      cancelOrder: async () => ({}),
      placeOrder: async () => ({}),
    },
  });

  test("every injected call routes through the tenant's client", async () => {
    // stopWatchdog.js does NOT read deps.client — it takes individual
    // functions whose defaults are env-var bound. If any of these were left
    // out, that runner would trade the legacy account while the dispatcher
    // looked correct.
    const d = tenantDeps(ctx(), {}, {});
    assert.deepEqual(await d.getPositions(), [{ symbol: "BTC/USD" }]);
    assert.deepEqual(await d.getAccount(), { equity: "1000" });
    for (const fn of ["getOpenOrders", "getLatestQuote", "cancelOrder", "placeOrder",
                      "getCryptoBars4h", "fetchAllFills"]) {
      assert.equal(typeof d[fn], "function", `${fn} was not injected`);
    }
  });

  test("cacheKey is the uid, so one tenant's session buckets can't leak to the next", async () => {
    // The dispatcher loops every user inside ONE serverless invocation, and
    // reconcile.js caches session penalties by cacheKey.
    assert.equal(tenantDeps(ctx("alice"), {}, {}).cacheKey, "alice");
    assert.equal(tenantDeps(ctx("bob"), {}, {}).cacheKey, "bob");
  });

  test("loadState returns the passed-in state and saveState is inert", () => {
    const state = { positions: { "BTC/USD": {} } };
    const d = tenantDeps(ctx(), state, {});
    assert.equal(d.loadState(), state);
    // The runners call saveState synchronously (an fs-era contract), so an
    // async Postgres write here would not be awaited. Persistence happens in
    // cronRoutes after main() resolves.
    assert.equal(d.saveState(), undefined);
  });

  test("journal appenders capture text instead of writing, for both job shapes", () => {
    const capture = {};
    const d = tenantDeps(ctx(), {}, capture);
    const now = new Date("2026-07-28T12:00:00Z");

    d.appendStopWatchdogBlock([], now);
    assert.equal(typeof capture.journalText, "string");
    assert.equal(capture.journalNow, now);

    d.appendJournalBlock({ decisions: [], executed: [], now });
    assert.equal(typeof capture.journalText, "string");
    assert.equal(capture.journalNow, now);
  });

  test("the removed daily-summary appender is gone, not left dangling", () => {
    // daily-summary was deleted 2026-07-29. A leftover dep here would be a
    // silent no-op seam that later reads as a supported job.
    assert.equal(tenantDeps(ctx(), {}, {}).appendDailySummaryBlock, undefined);
  });
});
