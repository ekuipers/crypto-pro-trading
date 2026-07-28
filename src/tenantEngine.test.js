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

const deps = (over = {}) => ({
  getActiveAlpacaCredential: async () => PAPER,
  resolveConfigForUser: async () => ({ cfg: DEFAULT_CFG, errors: [] }),
  createAlpacaClient: stubClientFactory().factory,
  ...over,
});

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
    // stopWatchdog.js and dailySummary.js do NOT read deps.client — they take
    // individual functions whose defaults are env-var bound. If any of these
    // were left out, those runners would trade the legacy account while the
    // dispatcher looked correct.
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

  test("journal appenders capture text instead of writing, for all three job shapes", () => {
    const capture = {};
    const d = tenantDeps(ctx(), {}, capture);
    const now = new Date("2026-07-28T12:00:00Z");

    assert.equal(d.appendDailySummaryBlock("summary text", now), "postgres");
    assert.equal(capture.journalText, "summary text");
    assert.equal(capture.journalNow, now);

    d.appendStopWatchdogBlock([], now);
    assert.equal(typeof capture.journalText, "string");
    assert.equal(capture.journalNow, now);
  });
});
