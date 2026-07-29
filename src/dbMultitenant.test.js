// Multi-tenant Phase 4 — uid scoping of the four engine tables.
//
// Two layers:
//   * argument guards, which run everywhere (no database contact — requireUid
//     throws before any query is issued);
//   * integration tests against the real Postgres, skipped when no connection
//     string is configured or when the Phase 4 migration hasn't been run yet.
//
// Every row these tests write is namespaced under a synthetic uid that is not
// an account (`__t4a__`/`__t4b__`) and is deleted in the teardown, so they
// cannot collide with a real tenant's state even though all environments share
// one database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { loadEnv } from "./env.js";
import * as db from "./db.js";

loadEnv();

const UID_A = "__t4a__";
const UID_B = "__t4b__";

describe("uid argument guards", () => {
  // Each accessor must reject a missing uid rather than silently defaulting —
  // a uid-less call would otherwise read or overwrite whichever tenant the old
  // single-tenant literal happened to name.
  const cases = [
    ["getTraderState", () => db.getTraderState()],
    ["putTraderState", () => db.putTraderState(undefined, {})],
    ["getTraderJournal", () => db.getTraderJournal(null, "2026-07-27")],
    ["appendTraderJournal", () => db.appendTraderJournal("", "2026-07-27", "x")],
    ["startJobRun", () => db.startJobRun(undefined, "evaluate", "cron")],
    ["getLatestJobRuns", () => db.getLatestJobRuns()],
    ["isCronJobEnabled", () => db.isCronJobEnabled(undefined, "evaluate")],
    ["getCronJobConfig", () => db.getCronJobConfig(null, "evaluate")],
    ["setCronJobConfig", () => db.setCronJobConfig(undefined, "evaluate", true, 6)],
    ["getCronConfig", () => db.getCronConfig()],
  ];
  for (const [name, call] of cases) {
    test(`${name} rejects a missing uid`, async () => {
      await assert.rejects(call, (e) => e instanceof TypeError && /requires a uid/.test(e.message));
    });
  }
});

// ---------------------------------------------------------------------------

function connectionUrl() {
  const conn = process.env.CRYPTOPROTRADER_POSTGRES_URL;
  if (!conn) return null;
  return /sslmode=/.test(conn)
    ? conn.replace(/sslmode=[^&]+/, "sslmode=no-verify")
    : conn + (conn.includes("?") ? "&" : "?") + "sslmode=no-verify";
}

// Probed once at load time so the suite can report *why* it is skipping. An
// unmigrated database is a legitimate transient state (the migration is run
// by hand, before the deploy) and must not read as a code failure — db.js's
// init() already warns about it on every boot.
let skipReason = null;
if (!db.dbEnabled() || !connectionUrl()) {
  skipReason = "no Postgres connection string configured";
} else {
  const probe = new pg.Pool({ connectionString: connectionUrl(), max: 1 });
  try {
    const { rows } = await probe.query(
      `select 1 from pg_class where relname = 'job_runs_uid_running_uidx' and relkind = 'i'`,
    );
    if (!rows.length) skipReason = "database not yet migrated — run scripts/migratePhase4.mjs --confirm";
  } catch (e) {
    skipReason = `database unreachable: ${e.message}`;
  } finally {
    await probe.end();
  }
}
if (skipReason) console.log(`[dbMultitenant.test] skipping integration tests: ${skipReason}`);

// The options object is omitted entirely when not skipping: node:test treats a
// present `skip` key as "skip" even when its value is null, so passing
// `{ skip: null }` silently skips the whole suite and reports its tests as
// cancelled rather than run.
const suiteOpts = skipReason ? { skip: skipReason } : {};

let pool = null;

describe("uid-scoped engine tables", suiteOpts, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: connectionUrl(), max: 2 });
    await cleanup();
  });

  after(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
  });

  async function cleanup() {
    await pool.query("delete from trader_state where id = any($1)", [[UID_A, UID_B]]);
    for (const t of ["trader_journal", "job_runs", "cron_config"]) {
      await pool.query(`delete from ${t} where uid = any($1)`, [[UID_A, UID_B]]);
    }
  }

  test("trader_state rows are per uid", async () => {
    await db.putTraderState(UID_A, { positions: { "BTC/USD": { hwm: 1 } } });
    await db.putTraderState(UID_B, { positions: { "ETH/USD": { hwm: 2 } } });

    assert.deepEqual(await db.getTraderState(UID_A), { positions: { "BTC/USD": { hwm: 1 } } });
    assert.deepEqual(await db.getTraderState(UID_B), { positions: { "ETH/USD": { hwm: 2 } } });
    assert.equal(await db.getTraderState("__t4_never_written__"), null);

    // An update to one tenant must not touch the other's row.
    await db.putTraderState(UID_A, { positions: {} });
    assert.deepEqual(await db.getTraderState(UID_A), { positions: {} });
    assert.deepEqual(await db.getTraderState(UID_B), { positions: { "ETH/USD": { hwm: 2 } } });
  });

  test("journal appends accumulate per (uid, day) without crossing tenants", async () => {
    const day = "2026-07-27";
    await db.appendTraderJournal(UID_A, day, "a1");
    await db.appendTraderJournal(UID_A, day, "a2");
    await db.appendTraderJournal(UID_B, day, "b1");

    assert.equal(await db.getTraderJournal(UID_A, day), "a1a2");
    assert.equal(await db.getTraderJournal(UID_B, day), "b1");
    assert.equal(await db.getTraderJournal(UID_A, "2026-07-26"), "");
  });

  test("the job lock is per (job, uid), not per job", async () => {
    // The regression this phase exists to prevent: on the old (job)-only
    // partial unique index, user B's evaluate run could not start while user
    // A's was running — two tenants contending for one lock.
    const a1 = await db.startJobRun(UID_A, "evaluate", "cron");
    assert.ok(a1, "first run should acquire the lock");

    const a2 = await db.startJobRun(UID_A, "evaluate", "cron");
    assert.equal(a2, null, "same uid + job must be blocked while running");

    const b1 = await db.startJobRun(UID_B, "evaluate", "cron");
    assert.ok(b1, "a DIFFERENT uid must NOT be blocked by another tenant's run");

    const a3 = await db.startJobRun(UID_A, "watchdog", "cron");
    assert.ok(a3, "a different job for the same uid must not be blocked");

    // Releasing one tenant's lock lets that tenant start again, and leaves the
    // other tenant's running row alone.
    await db.finishJobRun(a1, "ok", null);
    const a4 = await db.startJobRun(UID_A, "evaluate", "manual");
    assert.ok(a4, "lock should be released after finishJobRun");
    assert.equal(await db.startJobRun(UID_B, "evaluate", "cron"), null, "B's lock must still be held");

    await db.finishJobRun(a3, "ok", null);
    await db.finishJobRun(a4, "ok", null);
    await db.finishJobRun(b1, "ok", null);
  });

  test("latest job runs are scoped to the requesting uid", async () => {
    const id = await db.startJobRun(UID_A, "watchdog", "manual");
    await db.finishJobRun(id, "ok", "detail-a");

    const forA = await db.getLatestJobRuns(UID_A);
    assert.ok(forA.some((r) => r.job === "watchdog" && r.detail === "detail-a"));

    const forB = await db.getLatestJobRuns(UID_B);
    assert.ok(!forB.some((r) => r.job === "watchdog"), "B saw A's job run");
  });

  test("cron config is per (uid, job) and defaults to enabled", async () => {
    assert.equal(await db.isCronJobEnabled(UID_A, "evaluate"), true, "no row => enabled");
    assert.deepEqual(await db.getCronJobConfig(UID_A, "evaluate"), { enabled: true, hourUtc: null });

    await db.setCronJobConfig(UID_A, "evaluate", false, 9);
    await db.setCronJobConfig(UID_B, "evaluate", true, 17);

    assert.equal(await db.isCronJobEnabled(UID_A, "evaluate"), false);
    assert.equal(await db.isCronJobEnabled(UID_B, "evaluate"), true);
    assert.deepEqual(await db.getCronJobConfig(UID_A, "evaluate"), { enabled: false, hourUtc: 9 });
    assert.deepEqual(await db.getCronJobConfig(UID_B, "evaluate"), { enabled: true, hourUtc: 17 });

    // updated_by_uid defaults to the owning uid.
    const [rowA] = await db.getCronConfig(UID_A);
    assert.equal(rowA.updated_by_uid, UID_A);

    // The listing never includes another tenant's jobs.
    assert.deepEqual((await db.getCronConfig(UID_A)).map((r) => r.job), ["evaluate"]);
    assert.deepEqual((await db.getCronConfig(UID_B)).map((r) => r.job), ["evaluate"]);
  });

  test("every uid-scoped table actually carries the uid in its key", async () => {
    // Guards against a database that was never migrated: without the composite
    // keys the isolation above is enforced only by the WHERE clauses, and an
    // ON CONFLICT would target the wrong row.
    for (const table of ["trader_journal", "cron_config"]) {
      const { rows } = await pool.query(
        `select a.attname from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = $1::regclass and i.indisprimary`,
        [table],
      );
      assert.ok(rows.some((r) => r.attname === "uid"), `${table} primary key is missing uid — run scripts/migratePhase4.mjs`);
    }
    const { rows: idx } = await pool.query(
      `select indexdef from pg_indexes where indexname = 'job_runs_uid_running_uidx'`,
    );
    assert.equal(idx.length, 1, "job_runs per-uid lock index is missing — run scripts/migratePhase4.mjs");
    assert.match(idx[0].indexdef, /\(uid, job\)/);

    const { rows: old } = await pool.query(`select 1 from pg_class where relname = 'job_runs_running_uidx'`);
    assert.equal(old.length, 0, "the old (job)-only lock index still exists — two tenants would contend for one lock");
  });
});
