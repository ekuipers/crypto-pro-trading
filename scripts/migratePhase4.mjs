// scripts/migratePhase4.mjs
//
// Multi-tenant conversion, per-uid backfill (see CLAUDE.md):
// re-keys the four single-tenant engine tables by uid and attributes the
// existing rows to the current owner.
//
//   trader_state    id 'trader'  ->  id = <uid>   (the legacy row is COPIED, not
//                                                  moved, so it stays as a rollback point)
//   trader_journal  pk (day)     ->  pk (uid, day)
//   job_runs        + uid        ->  lock index (job) -> (uid, job)
//   cron_config     pk (job)     ->  pk (uid, job)
//
// The job_runs lock is the reason this is a correctness fix and not only an
// isolation one: on the old (job)-only partial unique index, two users' evaluate
// runs contend for a single lock and block each other.
//
// Deliberately NOT part of db.js's init(): init() runs on boot in every
// environment against one shared Supabase database, and choosing which uid owns
// the existing rows is a decision that must be made once, by a human, not
// implicitly by whichever preview deployment happens to boot first.
//
// RUN ORDER (matters):
//   1. pg_dump the four tables
//   2. node scripts/migratePhase4.mjs            (dry run — prints the plan)
//   3. node scripts/migratePhase4.mjs --confirm  (applies it, in one transaction)
//   4. deploy the Phase 4 code
// Between 3 and 4 the OLD code is running against the NEW schema and its
// ON CONFLICT clauses will error — keep the window short and the cron disabled.
//
// Idempotent: every step checks the catalog first, so a re-run against an
// already-migrated database reports "already migrated" and changes nothing.
import { loadEnv } from "../src/env.js";
loadEnv();

import pg from "pg";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const uidArg = args.find((a) => a.startsWith("--uid="))?.slice("--uid=".length);
const UID = (uidArg || process.env.TRADER_OWNER_UID || "").trim().toLowerCase();
const LEGACY_ID = "trader"; // trader_state's old fixed row id

if (!UID) {
  console.error("No target uid. Pass --uid=<account> or set TRADER_OWNER_UID.");
  process.exit(1);
}

const CONN =
  process.env.CRYPTOPROTRADER_POSTGRES_URL ||
  process.env.CRYPTOPROTRADER_POSTGRES_URL_NON_POOLING ||
  process.env.DBCRYPTOCHARTS_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;
if (!CONN) {
  console.error("No Postgres connection string in the environment.");
  process.exit(1);
}
const url = /sslmode=/.test(CONN)
  ? CONN.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : CONN + (CONN.includes("?") ? "&" : "?") + "sslmode=no-verify";

const pool = new pg.Pool({ connectionString: url, max: 2 });
const client = await pool.connect();

const plan = [];
const note = (s) => { plan.push(s); console.log("  " + s); };

/** Columns of a table's primary key, in order. */
async function pkColumns(table) {
  const { rows } = await client.query(
    `select a.attname
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = $1::regclass and i.indisprimary`,
    [table],
  );
  return rows.map((r) => r.attname);
}
async function pkName(table) {
  const { rows } = await client.query(
    `select conname from pg_constraint where conrelid = $1::regclass and contype = 'p'`,
    [table],
  );
  return rows[0]?.conname ?? null;
}
async function hasColumn(table, column) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}
async function indexExists(name) {
  const { rows } = await client.query(`select 1 from pg_class where relname = $1 and relkind = 'i'`, [name]);
  return rows.length > 0;
}
/**
 * The idempotency signal for job_runs, which has no primary key to inspect.
 *
 * Deliberately NOT "does the new index exist": db.js's init() creates that
 * index with `if not exists` and would happily create it on an unmigrated
 * table (uid is nullable there, so the index builds fine). Keying off it would
 * make this script report "already migrated" and skip the backfill, the NOT
 * NULL, and the drop of the old (job)-only lock — leaving both lock indexes in
 * place, which is the exact bug this phase exists to fix.
 */
async function columnIsNotNull(table, column) {
  const { rows } = await client.query(
    `select is_nullable from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  );
  return rows[0]?.is_nullable === "NO";
}
const count = async (sql, params = []) => (await client.query(sql, params)).rows[0].n;

console.log(`\nPhase 4 migration — target uid: ${UID}`);
console.log(`Mode: ${CONFIRM ? "APPLY (--confirm)" : "DRY RUN (no changes; pass --confirm to apply)"}\n`);

// ---- Pre-flight -----------------------------------------------------------
const { rows: acct } = await client.query(`select id from accounts where id = $1`, [UID]);
if (!acct.length) {
  console.error(`Refusing to run: no account row with id "${UID}". Existing accounts:`);
  const { rows: all } = await client.query(`select id from accounts order by created_at`);
  for (const r of all) console.error(`  ${r.id}`);
  process.exit(1);
}

console.log("Current state:");
console.log(`  trader_state:   ${await count("select count(*)::int n from trader_state")} rows (pk: ${(await pkColumns("trader_state")).join(", ")})`);
console.log(`  trader_journal: ${await count("select count(*)::int n from trader_journal")} rows (pk: ${(await pkColumns("trader_journal")).join(", ")})`);
console.log(`  job_runs:       ${await count("select count(*)::int n from job_runs")} rows (uid column: ${await hasColumn("job_runs", "uid")})`);
console.log(`  cron_config:    ${await count("select count(*)::int n from cron_config")} rows (pk: ${(await pkColumns("cron_config")).join(", ")})`);
console.log("\nPlanned changes:");

await client.query("begin");
try {
  // ---- trader_state: copy the legacy sentinel row to the uid --------------
  await client.query(`alter table trader_state alter column id drop default`);
  const legacy = await count(`select count(*)::int n from trader_state where id = $1`, [LEGACY_ID]);
  const already = await count(`select count(*)::int n from trader_state where id = $1`, [UID]);
  if (legacy && !already) {
    note(`trader_state: copy row '${LEGACY_ID}' -> '${UID}' (legacy row kept as a rollback point)`);
    await client.query(
      `insert into trader_state (id, data, updated_at) select $1, data, updated_at from trader_state where id = $2`,
      [UID, LEGACY_ID],
    );
  } else if (already) {
    note(`trader_state: row '${UID}' already exists — untouched`);
  } else {
    note(`trader_state: no legacy '${LEGACY_ID}' row to copy`);
  }

  // ---- trader_journal: pk (day) -> (uid, day) -----------------------------
  if ((await pkColumns("trader_journal")).includes("uid")) {
    note("trader_journal: already keyed by uid");
  } else {
    const n = await count(`select count(*)::int n from trader_journal`);
    note(`trader_journal: add uid, attribute ${n} row(s) to '${UID}', pk (day) -> (uid, day)`);
    await client.query(`alter table trader_journal add column if not exists uid text`);
    await client.query(`update trader_journal set uid = $1 where uid is null`, [UID]);
    await client.query(`alter table trader_journal alter column uid set not null`);
    const pk = await pkName("trader_journal");
    if (pk) await client.query(`alter table trader_journal drop constraint ${pk}`);
    await client.query(`alter table trader_journal add primary key (uid, day)`);
  }

  // ---- job_runs: add uid, re-key the lock index ---------------------------
  if (await columnIsNotNull("job_runs", "uid")) {
    note("job_runs: already keyed by uid");
  } else {
    await client.query(`alter table job_runs add column if not exists uid text`);
    const n = await count(`select count(*)::int n from job_runs where uid is null`);
    note(`job_runs: add uid, attribute ${n} row(s) to '${UID}', lock index (job) -> (uid, job)`);
    await client.query(`update job_runs set uid = $1 where uid is null`, [UID]);
    await client.query(`alter table job_runs alter column uid set not null`);
    // `if not exists` because db.js's init() may already have built these.
    await client.query(
      `create unique index if not exists job_runs_uid_running_uidx on job_runs (uid, job) where status = 'running'`,
    );
    await client.query(
      `create index if not exists job_runs_uid_job_started_idx on job_runs (uid, job, started_at desc)`,
    );
  }

  // Outside the branch above ON PURPOSE, so every run of this script removes
  // them. During the deploy window the previously deployed build can cold-start
  // and its init() recreates `job_runs_running_uidx` with `if not exists`,
  // resurrecting the (job)-only lock against the already-migrated table — two
  // tenants would then contend for one lock, the exact bug this phase fixes.
  // Observed for real on 2026-07-28. Re-run this script once the new build is
  // serving to sweep it.
  const staleLock = await indexExists("job_runs_running_uidx");
  const staleIdx = await indexExists("job_runs_job_started_idx");
  if (staleLock || staleIdx) {
    note(`job_runs: dropping resurrected pre-Phase-4 index(es): ${[staleLock && "job_runs_running_uidx", staleIdx && "job_runs_job_started_idx"].filter(Boolean).join(", ")}`);
    await client.query(`drop index if exists job_runs_running_uidx`);
    await client.query(`drop index if exists job_runs_job_started_idx`);
  }

  // ---- cron_config: pk (job) -> (uid, job) --------------------------------
  if ((await pkColumns("cron_config")).includes("uid")) {
    note("cron_config: already keyed by uid");
  } else {
    const n = await count(`select count(*)::int n from cron_config`);
    note(`cron_config: add uid, attribute ${n} row(s) to '${UID}', pk (job) -> (uid, job)`);
    await client.query(`alter table cron_config add column if not exists uid text`);
    await client.query(`update cron_config set uid = $1 where uid is null`, [UID]);
    await client.query(`alter table cron_config alter column uid set not null`);
    const pk = await pkName("cron_config");
    if (pk) await client.query(`alter table cron_config drop constraint ${pk}`);
    await client.query(`alter table cron_config add primary key (uid, job)`);
  }

  if (!plan.length) note("nothing to do");

  if (CONFIRM) {
    await client.query("commit");
    console.log("\nCOMMITTED.");
  } else {
    await client.query("rollback");
    console.log("\nROLLED BACK (dry run). Re-run with --confirm to apply.");
  }
} catch (e) {
  await client.query("rollback");
  console.error("\nFAILED — rolled back, database unchanged:\n", e.message);
  client.release();
  await pool.end();
  process.exit(1);
}

// ---- Post-state -----------------------------------------------------------
if (CONFIRM) {
  console.log("\nResulting state:");
  console.log(`  trader_state    pk: ${(await pkColumns("trader_state")).join(", ")}`);
  console.log(`  trader_journal  pk: ${(await pkColumns("trader_journal")).join(", ")}`);
  console.log(`  cron_config     pk: ${(await pkColumns("cron_config")).join(", ")}`);
  console.log(`  job_runs lock index (uid, job): ${await indexExists("job_runs_uid_running_uidx")}`);
  const { rows } = await client.query(
    `select 'trader_state' t, id uid, count(*)::int n from trader_state group by id
     union all select 'trader_journal', uid, count(*)::int from trader_journal group by uid
     union all select 'job_runs', uid, count(*)::int from job_runs group by uid
     union all select 'cron_config', uid, count(*)::int from cron_config group by uid
     order by 1, 2`,
  );
  console.log("\nRows per uid:");
  for (const r of rows) console.log(`  ${r.t.padEnd(15)} ${String(r.uid).padEnd(12)} ${r.n}`);
}

client.release();
await pool.end();
process.exit(0);
