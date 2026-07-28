// scripts/backupPhase4Tables.mjs
//
// Dumps the four tables scripts/migratePhase4.mjs reshapes, as JSON, to
// backups/phase4-<timestamp>.json. Stands in for pg_dump, which isn't on PATH
// on this machine — these tables are small (tens of rows), so a full JSON
// snapshot is a complete and directly re-insertable backup.
//
// Run immediately before the migration. The output includes each table's
// primary-key columns as they were at dump time, so a restore knows which
// shape the rows came from.
import { loadEnv } from "../src/env.js";
loadEnv();

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const TABLES = ["trader_state", "trader_journal", "job_runs", "cron_config"];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "backups");

const CONN =
  process.env.CRYPTOPROTRADER_POSTGRES_URL ||
  process.env.CRYPTOPROTRADER_POSTGRES_URL_NON_POOLING ||
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

const dump = { takenAt: new Date().toISOString(), tables: {} };
for (const table of TABLES) {
  const { rows } = await pool.query(`select * from ${table}`);
  const { rows: pk } = await pool.query(
    `select a.attname from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = $1::regclass and i.indisprimary`,
    [table],
  );
  const { rows: idx } = await pool.query(
    `select indexname, indexdef from pg_indexes where tablename = $1 order by indexname`,
    [table],
  );
  dump.tables[table] = {
    primaryKey: pk.map((r) => r.attname),
    indexes: idx,
    rowCount: rows.length,
    rows,
  };
  console.log(`  ${table.padEnd(16)} ${String(rows.length).padStart(4)} rows  pk(${pk.map((r) => r.attname).join(", ")})`);
}

mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, `phase4-${dump.takenAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(dump, null, 2), "utf-8");
console.log(`\nWrote ${file}`);

await pool.end();
process.exit(0);
