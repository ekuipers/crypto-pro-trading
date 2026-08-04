// src/cronRoutes.js
//
// Vercel Cron-triggered (or dashboard-triggered) HTTP entry points for the
// Node evaluation/watchdog engines — the Suite roadmap item
// (Trader only) to replace the GitHub Actions Python cron workflows with an
// "unattended process orchestrated via the front end". See
// CLAUDE.md "Cron engine" for the contract this implements.
//
// A Vercel serverless function has no persistent local disk across
// invocations, so runEvaluation.js/stopWatchdog.js's default
// file-based state/journal deps can't be used here. Their `deps` injection
// point (built for testing) is reused instead: loadState/saveState/
// appendJournalBlock etc. are swapped for Postgres-backed equivalents.
//
// IMPORTANT (safety): main()'s `saveState(state)`/`appendJournalBlock(...)`
// calls are NOT awaited internally (they're synchronous fs calls in the
// original file-based design). An async Postgres write passed directly as
// one of those deps would therefore not be guaranteed to finish before the
// function returns. Instead, the injected deps only mutate/capture
// in-memory values (`state` is mutated in place by positionState.js's
// functions, matching its existing contract; the journal text is captured
// synchronously) and the actual `await db.put...`/`await db.append...`
// calls happen explicitly here, after `main()` has resolved.
//
// CRON_EXECUTE gates real order placement, same shape as the CLI's
// `--execute` flag, and defaults OFF. Per the existing cutover checkpoint
// (see CLAUDE.md "Cron engine"), this must stay false until
// the three parity gates (fixture parity, >=24h shadow-run parity, state
// round-trip) have actually been run -- do not flip it on trust alone.
import crypto from "node:crypto";
import * as db from "./db.js";
import { currentUid } from "./auth.js";
import { rateLimited } from "./rateLimit.js";
import * as ps from "./positionState.js";
import * as te from "./tenantEngine.js";
import { main as runEvaluationMain } from "./runEvaluation.js";
import { main as stopWatchdogMain } from "./stopWatchdog.js";
import { DEFAULT_HOUR_UTC, isJobDue } from "./cronSchedule.js";

const CRON_EXECUTE = process.env.CRON_EXECUTE === "true";
// daily-summary removed 2026-07-29 (user decision): it was journal-only —
// it placed no orders and touched no position state — so dropping it changes
// nothing about how the engine trades. Historical `job_runs` rows for it are
// kept as an audit trail; any leftover `cron_config` row is inert, since the
// dispatcher only ever iterates this list.
const JOBS = ["evaluate", "watchdog"];

// Multi-tenant Phase 5: there is no longer a single owner account. Every
// account with an ACTIVE Alpaca credential is a tenant of the scheduled engine
// and runs on its own schedule, state, journal and strategy config.
//
// TRADER_OWNER_UID is gone entirely (user decision, 2026-07-28). The routes it
// used to gate are now scoped to the caller's own rows via requireSelf, which
// is both a smaller surface and the thing that makes the feature work for
// anyone but the owner. The concern the owner gate originally addressed —
// "registration is open suite-wide, so any Suite account could trigger real
// order placement or disable the stop watchdog" — no longer applies, because a
// caller can now only ever act on their own tenant: their own schedule, their
// own state, and their own Alpaca credentials. An account with no connected
// credential has no engine to trigger at all.

/** Runs one job for one already-resolved tenant. */
async function runJobForTenant(job, ctx) {
  const { uid } = ctx;
  const capture = { journalText: null, journalNow: null };
  const state = await te.loadTenantState(uid);
  const deps = te.tenantDeps(ctx, state, capture);

  let code;
  if (job === "evaluate") {
    code = await runEvaluationMain({ execute: CRON_EXECUTE, deps });
  } else if (job === "watchdog") {
    code = await stopWatchdogMain({ execute: CRON_EXECUTE, deps });
  } else {
    // Explicit rather than a trailing else that runs the watchdog: every
    // caller already validates against JOBS, so reaching here means a bug,
    // and silently running a different job than the one asked for would be
    // worse than failing. (Before 2026-07-29 this branch was daily-summary.)
    throw new Error(`unknown job: ${job}`);
  }

  // Both remaining jobs mutate position state, so it always persists. This
  // used to be conditional because daily-summary was journal-only and writing
  // state back would clobber whatever evaluate/watchdog last persisted.
  await db.putTraderState(uid, state);
  await te.persistTenantJournal(uid, capture);

  return { code, detail: code === 0 ? "ok" : `${job} failed (see logs)` };
}

/** Constant-time compare against `Authorization: Bearer $CRON_SECRET`. */
function cronSecretOk(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.authorization || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Manual triggers used to be reachable only by the single owner account, so
// they needed no rate limit. Now any signed-in Suite account can run its own
// jobs, and registration is open suite-wide — each request costs a credential
// decrypt, a config resolve and a burst of Alpaca calls. The concurrency lock
// caps *concurrent* runs at one per (uid, job) but not serial hammering.
const TRIGGER_LIMIT = 30; // per uid per hour
const CONFIG_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Resolves the signed-in uid, or null when the caller may not proceed (401/429
 * already sent).
 *
 * The uid comes only from the session cookie — never the path, body or query —
 * which is what makes it impossible to address another account's rows.
 */
async function requireSelf(req, res, limit = null) {
  const uid = await currentUid(req);
  // Explicitly reject falsy as well as the GUEST sentinel: if currentUid ever
  // returned null/undefined, an identity check alone would fall through and
  // hand a bad uid to a db accessor.
  if (!uid || uid === db.GUEST) {
    res.status(401).json({ error: "Sign in first" });
    return null;
  }
  if (limit !== null && rateLimited(`cron:${limit}:${uid}`, limit, RATE_WINDOW_MS)) {
    res.status(429).json({ error: "Too many requests — please try again later." });
    return null;
  }
  return uid;
}

/**
 * Runs one job for one user (lock + record), independent of any HTTP response —
 * shared by the direct-trigger routes and the dispatcher.
 *
 * Credential resolution happens BEFORE the job_runs row is created, so a tenant
 * with no usable credential reads as a skip rather than a failed run. And it is
 * a skip, never a fallback: running this user's schedule against the legacy
 * env-var account would place their orders on someone else's Alpaca account
 * while the engine looked perfectly healthy.
 */
async function executeJob(job, triggeredBy, uid) {
  if (!uid) return { job, triggeredBy, status: 400, error: "missing uid" };

  if (triggeredBy === "cron" && !(await db.isCronJobEnabled(uid, job))) {
    return { job, uid, triggeredBy, skipped: true, reason: "disabled via dashboard" };
  }

  let ctx;
  try {
    ctx = await te.buildTenantContext(uid);
  } catch (e) {
    console.error(`[cron] ${job} tenant resolution failed for ${uid}:`, e?.stack || e);
    return { job, uid, triggeredBy, status: 500, error: String(e?.message || e) };
  }
  if (!ctx.ok) {
    console.warn(`[cron] ${job} skipped for ${uid}: ${ctx.reason}`);
    return { job, uid, triggeredBy, skipped: true, reason: ctx.reason };
  }
  // How a user learns a stored config key was rejected — resolveConfigForUser
  // degrades it to the default rather than failing, so it is otherwise silent.
  if (ctx.configErrors?.length) {
    console.warn(`[cron] ${job} config warnings for ${uid}: ${ctx.configErrors.join("; ")}`);
  }

  const runId = await db.startJobRun(uid, job, triggeredBy);
  if (runId === null) return { job, uid, triggeredBy, status: 409, error: "already running" };
  try {
    const result = await runJobForTenant(job, ctx);
    await db.finishJobRun(runId, result.code === 0 ? "ok" : "error", result.detail);
    return { job, uid, triggeredBy, ok: result.code === 0, ...result };
  } catch (e) {
    const detail = String(e?.message || e);
    console.error(`[cron] ${job} failed for ${uid}:`, e?.stack || e);
    await db.finishJobRun(runId, "error", detail);
    return { job, uid, triggeredBy, status: 500, error: detail };
  }
}

/** Runs one job for every eligible tenant, ignoring the schedule (direct bearer trigger). */
async function executeJobForAllTenants(job, triggeredBy) {
  const tenants = await db.getActiveTenantsForJob(job);
  const results = [];
  for (const t of tenants) {
    if (!t.enabled) {
      results.push({ job, uid: t.uid, triggeredBy, skipped: true, reason: "disabled via dashboard" });
      continue;
    }
    results.push(await executeJob(job, triggeredBy, t.uid));
  }
  return results;
}

// GET is the Vercel Cron contract (bearer secret ONLY — session cookies are
// SameSite=Lax, which are still sent on a top-level cross-site GET
// navigation, so accepting session auth on GET here would let a hostile
// page trigger a run just by getting the signed-in owner to open a link;
// security review finding, 2026-07-21). POST is the manual path and is scoped
// to the CALLER'S OWN uid, covered by server.js's CSRF Origin check on
// mutating /api/* requests. Both run immediately/unconditionally (aside from
// the enabled + concurrency-lock checks) — the configured hour_utc only gates
// the hourly dispatcher below, not a direct/manual trigger.
async function handleCronTrigger(req, res, job) {
  if (!cronSecretOk(req)) return res.status(401).json({ error: "unauthorized" });
  const results = await executeJobForAllTenants(job, "cron");
  res.json({ results });
}
async function handleManualTrigger(req, res, job) {
  // No owner check any more: a signed-in user may trigger their OWN job, and
  // the uid comes from the session rather than the request, so there is no way
  // to name someone else's.
  const uid = await requireSelf(req, res, TRIGGER_LIMIT);
  if (!uid) return;
  const result = await executeJob(job, "manual", uid);
  res.status(result.status || 200).json(result);
}

/**
 * Vercel Cron wakes this once an hour (bearer-secret only, same as the
 * individual job routes). It now loops per (job, tenant): for each job, every
 * account with an active Alpaca credential is evaluated against ITS OWN
 * hour_utc and last-run time (src/cronSchedule.js's isJobDue), which is what
 * makes "each user manages their own schedule" real rather than cosmetic.
 *
 * One serverless invocation runs every tenant sequentially. That is deliberate:
 * the per-tenant Alpaca clients are independent, but running them concurrently
 * would multiply the Alpaca rate-limit pressure and make a partial failure much
 * harder to read in the job log.
 */
async function handleDispatch(req, res) {
  if (!cronSecretOk(req)) return res.status(401).json({ error: "unauthorized" });
  const now = new Date();
  const results = [];

  for (const job of JOBS) {
    const [tenants, lastRunAtByUid] = await Promise.all([
      db.getActiveTenantsForJob(job),
      db.getLastRunAtByUid(job),
    ]);
    for (const t of tenants) {
      const hourUtc = t.hourUtc ?? DEFAULT_HOUR_UTC[job];
      if (!t.enabled) {
        results.push({ job, uid: t.uid, skipped: true, reason: "disabled via dashboard" });
      } else if (!isJobDue(hourUtc, now, lastRunAtByUid[t.uid])) {
        results.push({ job, uid: t.uid, skipped: true, reason: "not due yet" });
      } else {
        results.push(await executeJob(job, "cron", t.uid));
      }
    }
  }
  // An empty result set means nobody has connected credentials. Say so
  // explicitly — otherwise a silently idle engine looks identical to a healthy
  // one that simply had nothing due.
  res.json({ results, tenants: new Set(results.map((r) => r.uid)).size });
}

export function installCronRoutes(app) {
  for (const job of JOBS) {
    app.get(`/api/cron/${job}`, (req, res) => handleCronTrigger(req, res, job));
    app.post(`/api/cron/${job}`, (req, res) => handleManualTrigger(req, res, job));
  }
  app.get("/api/cron/dispatch", handleDispatch);

  // The dashboard Autopilot coexists with the cron engine by design -- it only
  // runs while a browser tab is open, the cron engine covers the gaps like
  // overnight/asleep. Autopilot merges HWM/partial-TP/entry-time from this
  // endpoint so a closed-then-reopened browser never regresses bookkeeping the
  // cron engine advanced while it was away.
  //
  // SCOPED TO THE SESSION as of Phase 5. It used to be unauthenticated, which
  // was defensible when there was one shared engine, but now the row holds one
  // tenant's open positions and entry prices -- serving it to anyone would be a
  // cross-account disclosure. Guests get the file fallback, which is this
  // deployment's own committed state, not a user's.
  app.get("/api/trader-state", async (req, res) => {
    try {
      const uid = await currentUid(req);
      const data = uid === db.GUEST ? null : await db.getTraderState(uid);
      if (data) return res.json(data);
    } catch (e) {
      console.error("[trader-state] db read failed, falling back to file:", e?.message || e);
    }
    res.json(ps.loadState());
  });

  // Dashboard-only: each signed-in user sees their own runs and schedule.
  app.get("/api/cron/status", async (req, res) => {
    try {
      const uid = await requireSelf(req, res);
      if (!uid) return;
      const [runs, config] = await Promise.all([db.getLatestJobRuns(uid), db.getCronConfig(uid)]);
      // Fill in the compiled-in default hour for any job with no saved config yet.
      const byJob = Object.fromEntries(config.map((c) => [c.job, c]));
      const jobs = JOBS.map((job) => ({
        job,
        enabled: byJob[job]?.enabled ?? true,
        hourUtc: byJob[job]?.hour_utc ?? DEFAULT_HOUR_UTC[job],
        updatedByUid: byJob[job]?.updated_by_uid ?? null,
      }));
      // `connected` tells the UI why an otherwise-enabled schedule never runs:
      // without an active credential this account is not a tenant of the engine
      // and the dispatcher skips it entirely.
      const credentials = await db.listAlpacaCredentials(uid);
      res.json({ runs, jobs, connected: credentials.some((c) => c.active) });
    } catch (e) {
      console.error("[cron] status failed:", e?.stack || e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.put("/api/cron/config/:job", async (req, res) => {
    try {
      const uid = await requireSelf(req, res, CONFIG_LIMIT);
      if (!uid) return;
      const { job } = req.params;
      if (!JOBS.includes(job)) return res.status(400).json({ error: "unknown job" });
      const hourUtc = Number(req.body?.hourUtc);
      if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
        return res.status(400).json({ error: "hourUtc must be an integer 0-23" });
      }
      // The uid comes from the session, never the request, so a user can only
      // ever write their own (uid, job) row.
      // Strict === true (not Boolean(...)) so a stray truthy string like "false" can't coerce to enabled.
      await db.setCronJobConfig(uid, job, req.body?.enabled === true, hourUtc);
      res.json({ ok: true });
    } catch (e) {
      console.error("[cron] config update failed:", e?.stack || e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
