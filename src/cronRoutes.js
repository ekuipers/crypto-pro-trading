// src/cronRoutes.js
//
// Vercel Cron-triggered (or dashboard-triggered) HTTP entry points for the
// Node evaluation/watchdog/daily-summary engines — the Suite roadmap item
// (Trader only) to replace the GitHub Actions Python cron workflows with an
// "unattended process orchestrated via the front end". See
// memory/memory.md v2026-07-21.3 for the full analysis this implements.
//
// A Vercel serverless function has no persistent local disk across
// invocations, so runEvaluation.js/stopWatchdog.js/dailySummary.js's default
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
// (memory/claude_md_archive.md "Node.js port"), this must stay false until
// the three parity gates (fixture parity, >=24h shadow-run parity, state
// round-trip) have actually been run -- do not flip it on trust alone.
import crypto from "node:crypto";
import * as db from "./db.js";
import { currentUid } from "./auth.js";
import * as ps from "./positionState.js";
import { main as runEvaluationMain } from "./runEvaluation.js";
import { buildJournalBlockText } from "./journal.js";
import { main as stopWatchdogMain, buildStopWatchdogBlockText } from "./stopWatchdog.js";
import { main as dailySummaryMain } from "./dailySummary.js";
import { amsterdamParts } from "./tz.js";

const CRON_EXECUTE = process.env.CRON_EXECUTE === "true";
const JOBS = ["evaluate", "watchdog", "daily-summary"];

// This project's accounts table is shared Suite-wide (any CryptoPro Charts/
// Training/Suite account can sign in here too, registration is open) — but
// the cron endpoints control a single shared trading engine, not
// caller-owned data. Gating the manual/"Run now" and config-toggle routes
// on "any signed-in account" would let any Suite account trigger real order
// placement or disable the stop watchdog. TRADER_OWNER_UID restricts those
// routes to one account; unset means fail closed (manual trigger/config
// disabled, scheduled runs via CRON_SECRET are unaffected) rather than fail
// open (security review finding, 2026-07-21 — see memory/memory.md).
const OWNER_UID = process.env.TRADER_OWNER_UID ? String(process.env.TRADER_OWNER_UID).trim().toLowerCase() : null;

async function loadTraderState() {
  const data = await db.getTraderState();
  return data || ps.EMPTY_STATE();
}

async function persistJournal(text, now) {
  if (!text) return;
  const { dateStr } = amsterdamParts(now);
  await db.appendTraderJournal(dateStr, text);
}

async function runEvaluate() {
  const state = await loadTraderState();
  let journalText = null;
  let journalNow = null;
  const code = await runEvaluationMain({
    execute: CRON_EXECUTE,
    deps: {
      loadState: () => state,
      saveState: () => {}, // persisted explicitly below
      appendJournalBlock: (args) => {
        journalText = buildJournalBlockText(args);
        journalNow = args.now;
        return "postgres";
      },
    },
  });
  await db.putTraderState(state);
  await persistJournal(journalText, journalNow);
  return { code, detail: code === 0 ? "ok" : "evaluation failed (see logs)" };
}

async function runWatchdog() {
  const state = await loadTraderState();
  let journalText = null;
  let journalNow = null;
  const code = await stopWatchdogMain({
    execute: CRON_EXECUTE,
    deps: {
      loadState: () => state,
      saveState: () => {}, // persisted explicitly below
      appendStopWatchdogBlock: (actions, now) => {
        journalText = buildStopWatchdogBlockText(actions, now);
        journalNow = now;
        return "postgres";
      },
    },
  });
  await db.putTraderState(state);
  await persistJournal(journalText, journalNow);
  return { code, detail: code === 0 ? "ok" : "watchdog failed (see logs)" };
}

async function runDailySummary() {
  let block = null;
  let blockNow = null;
  const code = await dailySummaryMain({
    deps: {
      appendDailySummaryBlock: (b, now) => {
        block = b;
        blockNow = now;
        return "postgres";
      },
    },
  });
  await persistJournal(block, blockNow);
  return { code, detail: code === 0 ? "ok" : "daily summary failed (see logs)" };
}

const RUNNERS = { evaluate: runEvaluate, watchdog: runWatchdog, "daily-summary": runDailySummary };

/** Constant-time compare against `Authorization: Bearer $CRON_SECRET`. */
function cronSecretOk(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.authorization || "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** True only for the single configured owner account — see OWNER_UID's comment above. */
async function isOwner(req) {
  if (!OWNER_UID) return false;
  const uid = await currentUid(req);
  return uid === OWNER_UID;
}

// GET is the Vercel Cron contract (bearer secret ONLY — session cookies are
// SameSite=Lax, which are still sent on a top-level cross-site GET
// navigation, so accepting session auth on GET here would let a hostile
// page trigger a run just by getting the signed-in owner to open a link;
// security review finding, 2026-07-21). POST is the owner-only manual path,
// covered by server.js's CSRF Origin check on mutating /api/* requests.
async function handleCronTrigger(req, res, job) {
  if (!cronSecretOk(req)) return res.status(401).json({ error: "unauthorized" });
  return runJob(req, res, job, "cron");
}
async function handleManualTrigger(req, res, job) {
  if (!(await isOwner(req))) return res.status(401).json({ error: "unauthorized" });
  return runJob(req, res, job, "manual");
}

async function runJob(req, res, job, triggeredBy) {
  if (triggeredBy === "cron" && !(await db.isCronJobEnabled(job))) {
    return res.json({ skipped: true, reason: "disabled via dashboard" });
  }

  const runId = await db.startJobRun(job, triggeredBy);
  if (runId === null) return res.status(409).json({ error: "already running" });

  try {
    const result = await RUNNERS[job]();
    await db.finishJobRun(runId, result.code === 0 ? "ok" : "error", result.detail);
    res.json({ ok: result.code === 0, job, triggeredBy, ...result });
  } catch (e) {
    const detail = String(e?.message || e);
    console.error(`[cron] ${job} failed:`, e?.stack || e);
    await db.finishJobRun(runId, "error", detail);
    res.status(500).json({ error: detail });
  }
}

export function installCronRoutes(app) {
  for (const job of JOBS) {
    app.get(`/api/cron/${job}`, (req, res) => handleCronTrigger(req, res, job));
    app.post(`/api/cron/${job}`, (req, res) => handleManualTrigger(req, res, job));
  }

  // Dashboard-only: status/config, owner-only (see isOwner's comment).
  app.get("/api/cron/status", async (req, res) => {
    try {
      if (!(await isOwner(req))) return res.status(401).json({ error: "Sign in first" });
      const [runs, config] = await Promise.all([db.getLatestJobRuns(), db.getCronConfig()]);
      res.json({ runs, config });
    } catch (e) {
      console.error("[cron] status failed:", e?.stack || e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.put("/api/cron/config/:job", async (req, res) => {
    try {
      if (!(await isOwner(req))) return res.status(401).json({ error: "Sign in first" });
      const { job } = req.params;
      if (!JOBS.includes(job)) return res.status(400).json({ error: "unknown job" });
      await db.setCronJobEnabled(job, Boolean(req.body?.enabled));
      res.json({ ok: true });
    } catch (e) {
      console.error("[cron] config update failed:", e?.stack || e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
