// ============================================================
// RATE LIMIT — in-memory sliding window, shared by auth + credentials routes
// ------------------------------------------------------------
// Extracted from auth.js (where it guarded register/login) so the per-user
// Alpaca credential routes can reuse the same mechanism instead of growing a
// second copy. Dependency-free rather than pulling in express-rate-limit for
// a handful of routes.
//
// Known limits, deliberate: state is per-process, so on Vercel each warm
// serverless instance keeps its own counters and a burst spread across
// instances gets a proportionally higher effective ceiling. That is fine for
// what this is — blunting brute-force and cheap request floods, not a quota
// system. A distributed limiter would need the database on every request,
// which costs more than the abuse it would prevent here.
// ============================================================

const buckets = new Map(); // key -> timestamps[]

/**
 * Records a hit and reports whether the caller has now exceeded `limit`
 * within `windowMs`.
 * @returns {boolean} true => reject this request
 */
export function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter(t => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > limit;
}

/** Test seam — drops all recorded hits. */
export function resetRateLimits() {
  buckets.clear();
}

// Sweep so a long-running process doesn't retain a bucket per key forever.
// unref() so this timer never holds the event loop open (tests, CLI scripts).
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, hits] of buckets) {
    const kept = hits.filter(t => t > cutoff);
    if (kept.length) buckets.set(key, kept); else buckets.delete(key);
  }
}, 15 * 60 * 1000).unref();
