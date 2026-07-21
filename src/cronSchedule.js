// src/cronSchedule.js
//
// Pure scheduling logic for the dashboard-adjustable cron schedule (Suite
// roadmap, "For Trader only", 2026-07-21 follow-up: "Add the option to
// adjust the schedules"). Vercel Cron's own schedule is static config baked
// in at deploy time (vercel.json) -- it can't be rewritten at runtime. So
// the dashboard-adjustable "hour of day" lives in Postgres (cron_config.
// hour_utc) instead, and a single hourly dispatcher (src/cronRoutes.js's
// /api/cron/dispatch, invoked by vercel.json every hour) checks each job's
// configured hour against the current UTC hour and only runs it once that
// hour has arrived AND it hasn't already run today -- decoupling "how often
// Vercel wakes the function" from "does this specific job actually run now".

export const DEFAULT_HOUR_UTC = { evaluate: 2, watchdog: 4, "daily-summary": 6 };

/** "YYYY-MM-DD" for `now`, in UTC (matches hour_utc's timezone). */
export function todayUtcDateStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * True when a job configured for `hourUtc` is due to run at `now`: the
 * current UTC hour matches, and it hasn't already run today (`lastRunAt`,
 * an ISO timestamp or null, is the job's most recent job_runs.started_at).
 */
export function isJobDue(hourUtc, now, lastRunAt) {
  if (hourUtc === null || hourUtc === undefined) return false;
  if (now.getUTCHours() !== Number(hourUtc)) return false;
  if (!lastRunAt) return true;
  const lastRunDate = new Date(lastRunAt);
  if (Number.isNaN(lastRunDate.getTime())) return true;
  return todayUtcDateStr(lastRunDate) !== todayUtcDateStr(now);
}
