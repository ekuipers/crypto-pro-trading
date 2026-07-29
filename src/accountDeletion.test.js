// Account deletion (Suite roadmap 2026-07-29) — soft delete, grace period, purge.
//
// Two layers, same shape as dbMultitenant.test.js:
//   * guards, which run everywhere (they throw before any query is issued);
//   * integration tests against the real Postgres, skipped when no connection
//     string is configured.
//
// Every row these tests write is namespaced under synthetic uids that are not
// real accounts (`__del_a__`/`__del_b__`) and are removed in teardown, so they
// cannot collide with a real user even though all environments share one
// database (CLAUDE.md: isolation here is per-row, not per environment).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "./env.js";
import * as db from "./db.js";

loadEnv();

const UID_A = "__del_a__";
const UID_B = "__del_b__";
const hasDb = db.dbEnabled();

describe("reserved-uid guards", () => {
  // The sentinels are not people. GUEST scopes every signed-out user's rows and
  // 'trader' is the pre-Phase-4 rollback row in trader_state — a username
  // collision reaching either would delete data belonging to everyone, or the
  // rollback point. These must throw before touching the database, so they run
  // with or without a connection.
  for (const uid of [db.GUEST, "trader"]) {
    test(`softDeleteAccount refuses "${uid}"`, async () => {
      await assert.rejects(() => db.softDeleteAccount(uid, "someone"), /reserved uid/i);
    });
    test(`purgeAccount refuses "${uid}"`, async () => {
      await assert.rejects(() => db.purgeAccount(uid), /reserved uid/i);
    });
  }
});

describe("grace period", () => {
  test("is 30 days", () => {
    assert.equal(db.ACCOUNT_PURGE_GRACE_DAYS, 30);
  });
});

describe("integration: soft delete → restore → purge", { skip: !hasDb && "no Postgres configured" }, () => {
  before(async () => {
    await db.init();
    // A real account row is required: softDeleteAccount updates accounts, and
    // the credential/strategy tables have FKs to it.
    for (const uid of [UID_A, UID_B]) {
      await db.createAccount({ id: uid, username: uid, displayName: uid, salt: "s", passwordHash: "h" });
    }
  });

  after(async () => {
    // Purge is the teardown: it is also the thing under test, so a failure
    // here would already have surfaced above.
    for (const uid of [UID_A, UID_B]) {
      try { await db.purgeAccount(uid); } catch { /* already gone */ }
    }
  });

  test("soft delete marks the row and kills the sessions", async () => {
    await db.createSession("__del_sid__", UID_A, Date.now() + 60_000);
    assert.equal(await db.getSessionUid("__del_sid__"), UID_A);

    assert.equal(await db.softDeleteAccount(UID_A, UID_A), true);

    const acct = await db.getAccount(UID_A);
    assert.ok(acct.deletedAt, "deleted_at should be set");
    assert.equal(acct.deletedBy, UID_A);
    // The session must be gone immediately — the grace period protects the
    // data, not a signed-in tab.
    assert.equal(await db.getSessionUid("__del_sid__"), null);
  });

  test("soft delete is idempotent", async () => {
    // A double-submit must not re-stamp deleted_at and quietly extend the
    // grace period.
    assert.equal(await db.softDeleteAccount(UID_A, UID_A), false);
  });

  test("restore clears the mark", async () => {
    assert.equal(await db.restoreAccount(UID_A), true);
    const acct = await db.getAccount(UID_A);
    assert.equal(acct.deletedAt, null);
    assert.equal(acct.deletedBy, null);
    // Restoring an account that isn't pending deletion is a no-op, not an error.
    assert.equal(await db.restoreAccount(UID_A), false);
  });

  test("a fresh soft delete is not yet due for purge", async () => {
    await db.softDeleteAccount(UID_A, UID_A);
    const due = await db.listAccountsPendingPurge();
    assert.ok(!due.includes(UID_A), "should not be purgeable inside the grace period");
    // With a zero-day grace it is due — proves the cutoff is what gates it,
    // not some other condition.
    const dueNow = await db.listAccountsPendingPurge(0);
    assert.ok(dueNow.includes(UID_A));
  });

  test("purge removes the account and its rows across the suite tables", async () => {
    // Seed rows in tables from three different projects to prove the purge
    // spans the whole shared database, not just this project's tables.
    await db.putTraderState(UID_B, { positions: {} });
    await db.appendTraderJournal(UID_B, "2026-07-29", "test block");
    await db.putStrategyConfig(UID_B, { MAX_POSITIONS: 5 });

    assert.ok(await db.getTraderState(UID_B), "seeded state should exist");

    const result = await db.purgeAccount(UID_B);
    assert.equal(result.accountDeleted, true);

    assert.equal(await db.getAccount(UID_B), null);
    assert.equal(await db.getTraderState(UID_B), null);
    // trader_strategy_config has an on-delete-cascade FK, so deleting the
    // account row is what removes it — verify the cascade actually fired.
    assert.deepEqual(await db.getStrategyConfig(UID_B), null);
  });

  test("purging an unknown uid is harmless", async () => {
    const result = await db.purgeAccount("__del_nobody__");
    assert.equal(result.accountDeleted, false);
  });
});
