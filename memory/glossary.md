# Glossary — Alpaca Trading Agent

Full decoder ring. Everything that would clutter `memory.md` lives here.

---

## 2026-07-19 — Suite SSO (accounts/sessions ported from CryptoPro Charts)

| Term | Meaning |
|------|---------|
| SSO (single sign-on) here | Not a third-party identity provider — one shared Postgres `accounts`/`sessions` schema that CryptoPro Charts, Suite, Trader, and Training all read/write via the same `DBCRYPTOCHARTS_POSTGRES_URL*` connection string. Sign up once on any app, sign in on all of them, as long as each app's deployed env points at that same Supabase project. |
| Opaque session cookie | The `cpc_session` cookie holds a random 24-byte hex token (`crypto.randomBytes`), not a JWT or anything decodable client-side — the server looks it up against the `sessions` table on every request. `HttpOnly` (JS can't read it) + `SameSite=Lax` (blocks most cross-site sends) + `Secure` in production. |
| scrypt | The password-hashing function used (`crypto.scryptSync`), not bcrypt/argon2 — deliberately memory-hard to resist GPU-accelerated cracking, built into Node's `crypto` module so no extra dependency was needed. |
| TOTP (RFC 6238) | Time-based One-Time Password — the 6-digit code an authenticator app (Google Authenticator, Authy, 1Password…) generates every 30 seconds from a shared secret. Implemented by hand here (`src/totp.js`, HMAC-SHA1 + a hand-rolled base32 codec) rather than pulling in a library. |
| Timing side-channel | A way to leak information (e.g. "does this username exist?") purely from how *long* a response takes, even when the response text itself gives nothing away. Fixed here by always paying the same password-hashing cost whether or not the account exists. |

---

## 2026-07-19 — Vercel build fix: "vite: command not found"

| Term | Meaning |
|------|---------|
| npm workspace (and why `client/` isn't one) | An npm feature where a root `package.json` lists sub-directories (`"workspaces": [...]`) so one `npm install` at the root installs every sub-project's dependencies together (usually hoisted into one shared `node_modules`). This repo does **not** use it — `client/` is a fully separate npm project with its own `package.json`/`package-lock.json`/`node_modules`. That means a plain `npm install` at the repo root (what Vercel's default install step runs) never touches `client/`, so `client/`'s deps (`vite`, `react`, …) must be installed explicitly — root `npm run build` now does this itself (`npm --prefix client install && npm --prefix client run build`) rather than assuming they're already there. |

---

## 2026-07-19 — EJS shell replaced with a React (Vite) shell

| Term | Meaning |
|------|---------|
| Strangler-fig migration | The pattern used for the React conversion: a new system (React) grows around the edges of an old one (the vanilla `src/js/*.js` dashboard logic) and takes over piece by piece, rather than a big-bang rewrite. Here, React took over the outer shell (header/nav/layout) while every tab body and all business logic kept running as the exact unmodified vanilla code — a deliberately incomplete, honestly-labeled first step, not a finished React app. |
| `dangerouslySetInnerHTML` bridge | React API for injecting raw HTML into a component, bypassing React's own rendering/diffing for that subtree. Used three ways here: (1) each of the 13 tabs (`client/src/tabIndex.js`), rendering verbatim-copied markup so `switchTab()`'s existing `id="page-X"` lookups keep working; (2) `Modals.jsx`, because its many inline `style="..."` strings would each need manual conversion to JSX `style={{...}}` objects with no browser to verify the result; (3) nowhere else — `Header`/`Nav`/`Footer` are real hand-converted JSX, since their markup was simple enough to convert safely by hand. |
| Script-injection timing fix (`client/src/scriptLoader.js`) | The one piece of genuinely new logic in the React conversion. `src/js/main.js`'s `bootstrapDashboard()` queries `.page` DOM elements the instant it loads — but those elements don't exist until React's first render has committed. Fix: instead of static `<script src="...">` tags in `client/index.html` (which the browser could execute before or racing with React's mount), `App.jsx`'s `useEffect(() => {...}, [])` (runs once, guaranteed after the first commit) dynamically creates and appends all 30 `<script>` tags in the same proven order, each awaited via its `onload` before the next loads — reproducing classic sequential `<script>` execution semantics, just deferred until the DOM is actually ready. |
| Why React doesn't own tab-switching | Considered and rejected: reimplementing `switchTab()`'s per-tab loader dispatch (`signals` → `loadSignals()`, `port-overview` → `portLoadOverview()`, sub-tab redirects, hash/localStorage sync, keyboard shortcuts) as new React state/effects. Risk: silently duplicating and potentially drifting from logic already proven correct in `src/js/nav.js`, with no frontend test suite to catch a mismatch. Chosen instead: React renders the full static shell once, then `switchTab()` (completely unmodified) keeps doing everything it always did, via plain DOM `classList` toggling on the elements React put there. |
| Mid-session external rule change | `CryptoPro Suite/CLAUDE.md` gained "Use React as Front-end framework for all projects" after this session's EJS conversion had already started and finished — discovered only while updating the Suite-level roadmap afterward. Handled by surfacing the conflict directly (`AskUserQuestion`) rather than either silently ignoring the new standing rule or silently discarding the just-verified EJS work. |

---

## 2026-07-19 — Dashboard converted to a Node.js-rendered frontend

| Term | Meaning |
|------|---------|
| EJS / view engine | Templating library (`ejs` npm package, this project's second dependency after `express`). `server.js` sets `app.set('view engine','ejs')`; `res.render('dashboard')` compiles `views/dashboard.ejs` (plus every `<%- include(...) %>`'d partial) into HTML server-side, per request. Replaced `res.sendFile()` serving a static HTML file. |
| Classic script vs ES module (why this split doesn't use `import`/`export`) | A `<script src="...">` tag with no `type="module"` attribute is a "classic" script: it shares one global `window` scope with every other classic script on the page and executes top-to-bottom in document order — this is how the original single inline `<script>` block always worked (including same-scope function hoisting). An ES module (`type="module"`) gets its own private scope and needs explicit `import`/`export` for every cross-file reference. The 30-file `src/js/` split deliberately stayed classic scripts (just relocated, unchanged internals) rather than converting to ES modules, because hand-wiring ~350 cross-file imports for a live-trading UI with no frontend test runner to catch a missed one was judged too risky — a single missed import is a silent `ReferenceError` that only surfaces when that code path runs. |
| Line-coverage verification (the split's correctness gate) | The technique used to guarantee the `docs/dashboard_professional.html` → `views/`+`src/js/`+`src/css/` split lost, duplicated, or reordered nothing: a small Node script found candidate top-level statement boundaries, then a validation pass confirmed every source line appeared in the output set exactly once before any file was written (byte-for-byte reconstruction diff for the strictly-in-order pieces; a line-coverage array check for the reordered JS split). Caught a real bug mid-process — a named IIFE (`(async function bootstrapDashboard(){...})()`) that the first boundary-detector version didn't recognize, which would have silently cut the function across two files. |
| `main.js` (the one deliberate reorder) | `src/js/main.js` contains only 3 top-level bootstrap calls (`renderMode()`, `loadBacktestForm()`, `enhanceTables()`) plus the `bootstrapDashboard()` IIFE, pulled out of its original mid-file position (~line 5345 of the old single file) and loaded via the very last `<script>` tag in `views/dashboard.ejs`. Necessary because `bootstrapDashboard()` transitively calls into code defined throughout the *entire rest* of the original script (Autopilot, market-universe helpers, etc.) — in the original single script, function hoisting made this safe regardless of textual position; across separate classic-script files it is not, so the file containing it must load strictly last. |
| `express.static` mount (`/js`, `/css`) | `server.js`: `app.use('/js', express.static('src/js'))` and `app.use('/css', express.static('src/css'))`. Serves the split files as plain static assets at those URL prefixes; `docs/` stays mounted at `/` for the remaining static assets (favicons, `dashboard_layout.md`). |

---

## 2026-07-19 — Node.js port Phase 2: order execution + evaluation loop

| Term | Meaning |
|------|---------|
| `deps` injection pattern | Convention used throughout `src/evaluateSymbol.js`, `src/scout.js`, `src/rotation.js`, `src/runEvaluation.js`: every network-calling or otherwise side-effecting function accepts an optional `deps`/options object whose fields default to the real implementation (e.g. `deps.getLatestQuote` falling back to the real `getLatestQuote`). Lets tests swap in plain async functions returning canned data instead of stubbing HTTP, so the full decision ladder is unit-tested with zero network mocking. `evaluateSymbol.js` extends this to indicator functions too (`deps.ind`), letting tests force a specific score or Bollinger target without a realistic price series. |
| `assertNotShipped(flagName, flagValue, missingFn)` | `src/strategyConfig.js`. Throws a clear "not yet ported" error if a ships-OFF config flag (`pyramid_enabled`, `conviction_sizing_enabled`, `measured_move_enabled`, `breadth_gate_enabled`, `risk.trail_mode === "chandelier"`) is ever switched on before its risk.js counterpart (`shouldPyramid`, `convictionRiskMultiplier`, `measuredMoveTarget`, `breadthPct`/`breadthPolicy`, `chandelierTrailPct`) is ported. Called once at module-load time in `evaluateSymbol.js`/`runEvaluation.js` rather than left to fail with a confusing `ReferenceError` deep inside a rarely-hit branch. |
| `src/marketData.js` | New shared module with no Python equivalent as a standalone file — extracted from `run_evaluation.py`'s module-level bar-fetch/fill-history functions specifically to break the circular coupling where `scout.py`/`rebalance.py` reach into `run_evaluation.py` for them (Python tolerates this via late-binding function calls inside `main()`; ESM static imports would deadlock on it). |
| `src/strategyConfig.js` | Holds the strategy-level score thresholds and sizing constants that live as bare module-level constants in `run_evaluation.py` (not in `risk.py`) — `BUY_SCORE_THRESHOLD`, `SESSION_FILTER_ENABLED`, etc. — plus the five ships-OFF flag constants and `assertNotShipped()`. |
| `fifoRoundTrips` vs `reconcilePositionsFromFills`'s dust tolerance (two different epsilons) | `src/marketData.js`'s `fifoRoundTrips()` (session-edge filter, streak throttle P&L) closes a FIFO lot at an **absolute** `1e-6` epsilon — this is a different, unrelated function from `src/reconcile.js`'s `reconcilePositionsFromFills()`, which uses the **relative** `RECONCILE_DUST_REL_TOL = 0.005` (the Bug #6 fix below). Don't conflate the two when porting or reviewing — they intentionally use different tolerance strategies for different purposes. |
| Camel-case decision objects | `evaluateSymbol.js`/`rotation.js`/`journal.js` use camelCase keys (`limitPrice`, `dailyRegime`, `netRr`) for the internal decision object, matching this port's existing convention (`indicators.js`'s `signalScore()` breakdown already made this shift from Python's snake_case). Only the literal journal **text** (labels like `score`, `ema_x`, `4h`) has to match Python's output — the JS variable names don't need to. |
| Node port "parity checkpoint" | Defined in `CLAUDE.md`'s Node.js port section: deterministic-input parity (frozen fixtures, both engines), live shadow-run parity (≥24 hourly cycles against the same paper account, diffed), and a state-file round-trip check — the gate before `.github/workflows/*.yml` changes or `--execute` is ever pointed at the Node engine. |

---

## 2026-07-18 — Bug fix: Autopilot re-firing its own partial-TP (breakeven-pin cascade)

| Term | Meaning |
|------|---------|
| `apReconcileFromFills(fills, heldSymbols)` | Function in `docs/dashboard_professional.html`, added 2026-07-18. Dashboard-side twin of Python's `reconcile_positions_from_fills()`: walks Alpaca's own FILL activity ledger (newest-first, as the API returns it) per symbol, tracking flat→long transitions and dust-tolerant lot consumption (`_AP_RECONCILE_DUST_REL_TOL = 0.005`, same value as Python's `_RECONCILE_DUST_REL_TOL`), to determine whether a non-closing SELL already happened on the currently-open lot. Returns `{ partialTpSyms: Set, entryTime: {sym: epochMs} }`. |
| Cross-engine partial-TP re-fire (Bug #1, user-reported) | The Autopilot's `partialTp[sym]` flag previously only came from `localStorage.autopilotPartialTp` merged with `data/positions_state.json` via a same-origin `fetch()` — blocked under `file://` (same restriction as the Glossary tab's own bug, see below). When that merge silently failed, the Autopilot didn't know a +1R scale-out already fired (by itself last session, or by the Python cron) and re-sold 50% of the already-reduced remainder every cycle — a halving cascade in fill history (AAVE: 6.5413 → 0.8177 → 0.4088 → 0.2044 → 0.1022 → 0.0511 → 0.0128; LINK 24+ partial sells on one lot) that ended in a no-profit "breakeven after partial TP" exit long before the trailing stop could arm. Fixed by calling `apReconcileFromFills()` (via the already-`file://`-safe `edgeFetchAllFills()`/`apiFetch()`, a real HTTPS call to Alpaca) once per Autopilot cycle and merging its result into `partialTp`/`entryTime` before the exit-management loop. |

---

## 2026-07-18 — Dashboard 📖 Glossary sub-tab (renders this file)

| Term | Meaning |
|------|---------|
| Glossary sub-tab (Command) | `subpage-glossary` under the 🧭 Command parent tab (deep link `#glossary`), added per roadmap item "Add the glossary to the dashboard by adding a pane under command center called Glossary." Renders `memory/glossary.md` (this file) live in the dashboard instead of duplicating its content, so the two can never drift. |
| `fetchLocalText(paths)` | Text-fetching sibling of `fetchLocalJson(paths)` in `docs/dashboard_professional.html` — same fallback-path-list pattern, returns the first path's raw text instead of parsed JSON. Used to load this file. |
| `loadGlossary(force)` | Fetches `["../memory/glossary.md","./memory/glossary.md","memory/glossary.md"]` (first hit wins), 5-min cache (`GLOSSARY_CACHE_MS`), ↻ Refresh forces a re-read. Falls back to `GLOSSARY_FALLBACK_MD` when every path fails (bugfix below) instead of showing a dead-end error. |
| `renderGlossaryMarkdown(md)` / `mdTable(rows)` / `mdInline(escaped)` | Tiny markdown-subset renderer covering only what this file uses: `#`/`##`/`###` headers, `\| … \|` tables (drops the `---\|---` separator row), `**bold**`, `` `code` ``, `---` rules. Input is HTML-escaped (`escapeHtml`) before any markdown pattern is applied, so the renderer can't be turned into an HTML-injection vector. |
| `filterGlossary()` | Search box (`#glossarySearch`) that hides table rows/paragraphs whose lowercased text doesn't contain the query; section headers always stay visible so the document structure stays legible mid-search. |

---

## 2026-07-18 — Bug fix: Glossary tab dead-ended when the live fetch was blocked

| Term | Meaning |
|------|---------|
| `file://` local-fetch restriction | Browser security policy (Chrome in particular) blocking `fetch()`/`XMLHttpRequest()` reads of a *different* local file from a page loaded via `file://`, with no page-script workaround. Root cause of the "Could not load memory/glossary.md" bug — not a wrong relative path; the same restriction already silently affects `loadConfigFromFile()`'s `config.json` fetch, which degrades gracefully (console-only) because it has a harmless fallback (browser-stored settings). Glossary had none, so it was the first tab where this general limitation became user-visible. |
| `GLOSSARY_FALLBACK_MD` | Small built-in markdown constant in `docs/dashboard_professional.html` — a curated, deliberately low-churn subset of this file (Acronyms & Abbreviations table + ~14 core conceptual Trading Terms). Excludes the fast-changing dated/implementation-detail sections so it won't need touching on every glossary.md edit. Used by `loadGlossary()` whenever the live fetch of `memory/glossary.md` fails. |
| `_glossaryLive` | Boolean set by `loadGlossary()` — `true` when the live file fetch succeeded, `false` when showing `GLOSSARY_FALLBACK_MD`. Drives the `#glossaryStatus` line's text/color (muted "Live from memory/glossary.md" vs yellow fallback explanation + ↻ Refresh prompt). |
| Raw-GitHub fallback (ruled out) | Considered fetching `raw.githubusercontent.com/.../memory/glossary.md` as a network fallback (works cross-origin from `file://` unlike local-file fetch, since Alpaca API calls already do this). Ruled out: `curl` confirmed the repo 404s unauthenticated (private repo), and embedding a GitHub token client-side to work around that would violate the project's own secret-handling rule. |

---

## 2026-07-18 — Trade-ticket portfolio-cap check

| Term | Meaning |
|------|---------|
| `tradeCapProjection(symbol, side, qty, price)` | Function in `docs/dashboard_professional.html`. Projects the manual trade ticket's post-order notional for a symbol (existing position from `window._lastPositions`/`window._lastEquity`, ± this order depending on buy/sell) against `portCapFor(symbol) × equity`. Returns `overCap` plus the max additional notional/qty still allowed. Used by `updateTradeSummary()` (live warning as you type) and `submitPaperTrade()` (hard-blocks a BUY that would breach the cap). Added 2026-07-18 — the ticket previously had no cap check at all, only `qty > 0` / `price > 0`. |
| `#tradeCapWarning` | The trade modal's live cap-check line (green/neutral when OK, red with the breach detail when a BUY would exceed the symbol's cap). Populated by `updateTradeSummary()`. |

---

## 2026-07-18 — Bug #7: stale per-symbol state prune (Python/dashboard consistency)

| Term | Meaning |
|------|---------|
| `prune_stale_position_state(state, open_symbols)` | Function in `scripts/run_evaluation.py`. Calls `ps.clear_position()` for every symbol in `state["positions"]` not present in the current cycle's live `open_symbols`. Called once in `main()` right after the positions fetch. Added 2026-07-18 to mirror the dashboard Autopilot's existing `heldSyms` prune — Python previously only cleared per-symbol state reactively (inside the "still held" branch, or after a non-stop-loss TA exit), so a full close via any stop-loss-type exit left `partial_tp_done`/`breakeven_stop`/`stop_order_id` stale forever (Bug #7). |
| `heldSyms` prune (dashboard) | `docs/dashboard_professional.html`'s Autopilot: every cycle, `Object.keys(hwm).forEach(k => { if (!heldSyms.includes(k)) delete hwm[k]; })` (mirrored for `partialTp` and `entryTime`). This was already correct before the Python-side fix — it was the reference implementation `prune_stale_position_state()` was modeled on. |

---

## 2026-07-18 — Bug #6: reconciliation dust-tolerance fix

| Term | Meaning |
|------|---------|
| `_RECONCILE_DUST_REL_TOL` | Constant in `scripts/run_evaluation.py` (0.005 = 0.5%). Used by `reconcile_positions_from_fills()`'s FIFO walk to decide a lot has fully closed: leftover qty must be below `original_qty * _RECONCILE_DUST_REL_TOL`, not a fixed `1e-6`. Replaces the old absolute epsilon, which was smaller than Alpaca's typical ~0.1–0.25% fee/precision short-fill on SELLs and so never fired — every full close was misread as a partial sell, permanently inflating `sells_since_start` and fabricating "breakeven after partial TP" stops on brand-new positions (Bug #6). |
| `sells_since_start` | Per-symbol counter inside `reconcile_positions_from_fills()`'s FIFO walk — counts SELL fills that left the lot queue non-empty (i.e. a genuine scale-out) since the last flat→long transition. Must reset to 0 when a lot queue truly empties; the dust-tolerance bug (fixed 2026-07-18) meant it never reset for symbols whose SELL fills always left fee-residue dust behind. |
| fee-residue short-fill | Alpaca paper-account SELL fills return a quantity ~0.1–0.25% smaller than the matching BUY quantity for the same qty ordered — a fee/precision rounding artifact, confirmed across 15 traded symbols (e.g. LTC 0.99791, AAVE 0.99856, LINK 0.99858 of the original qty). Any FIFO reconciliation logic comparing "remaining lot qty" to an absolute near-zero epsilon must account for this. |

---

## 2026-07-13 — Socials Twitter/X fetch investigation + unit tests (v2026-07-13.2)

| Term | Meaning |
|------|---------|
| `cdn.syndication.twimg.com` | X's official embed-widget CDN. Returns tweet timelines keylessly but `Access-Control-Allow-Origin` is hardcoded to `https://platform.twitter.com` — unusable as a CORS-fetch source from any other site. Ruled out 2026-07-13. |
| Nitter mirror status (2026-07-13) | All 8 RSS-enabled public instances tracked by status.d420.de tested dead (connection failure, HTTP error, or the fake "not yet whitelisted" 200-OK feed). Confirmed regression from "some occasionally work" (2026-07-10) to fully non-functional. `SOC_NITTER_HOSTS` kept as a harmless fallback in case a mirror recovers. |
| `tests/test_socials_fetch.js` | New Node test harness (`node:test`/`node:assert`/`node:vm`, no npm deps, no network). Extracts `socFetchAccount()` and helpers straight from `docs/dashboard_professional.html`'s source text (bracket-matching, not a reimplementation) and runs them against mocked `fetch` responses. Run: `node tests/test_socials_fetch.js`. |

---

## 2026-07-13 — Autopilot stale-entry sweep 4h floor, Execution tab filters (v2026-07-13.1)

| Term | Meaning |
|------|---------|
| `STRAT_CFG.minStaleEntryAgeHours` | New `STRAT_CFG` field (= 4), seeded from `config.json › risk.min_stale_entry_age_hours`. Minimum real wall-clock time an Autopilot-tagged (`ap-` prefix) entry limit order must stay open before the stale-entry sweep is allowed to cancel it. |
| Stale-entry sweep age check (fixed) | The 2026-07-08 sweep gated cancellation on the `orderAge` cycle counter (`orderAge[o.id] <= 1`), so a fast Autopilot interval (15 min) could cancel an entry after just ~15 min. Bug fix 2026-07-13: the check now computes `Date.now() - new Date(o.created_at).getTime()` and only cancels once that real elapsed time is ≥ `STRAT_CFG.minStaleEntryAgeHours`. The `orderAge` counter itself is unchanged and still drives the separate exit-order cancel-replace escalation (2 cycles). |
| `populateExecutionFilters(orders)` | Dashboard function (Execution tab). Populates the Symbol/Type/Status `<select>` filters from the distinct values in the loaded order set, preserving the user's current selection across refreshes. |
| `applyExecutionFilters()` | Dashboard function. Re-renders `executionOrdersBody` from the cached `_lastExecutionCtx` filtered by the current Symbol/Type/Side/Status selections — client-side, no refetch. Updates the `#execFilterCount` "Showing X of Y orders" label. |
| `resetExecutionFilters()` | Dashboard function. Clears all four Execution tab filters back to "All" and re-renders. |

---

## 2026-07-10 — Socials RSS bugfix: Telegram-mirror-first sourcing (v2026-07-10.1)

| Term | Meaning |
|------|---------|
| "RSS reader not yet whitelisted!" | xcancel.com's UA-whitelist error for `/rss`: served as a **fake HTTP-200 RSS feed** (title + single item = the error text), so it passed the old `status==="ok" && items.length` check and rendered as tweets — the 2026-07-10 bug. Now rejected by feed-title validation. |
| Feed-title validation | `socFetchAccount()` accepts a feed only if its title contains the expected handle — Nitter titles are `Name / @handle`, TelegramBridge titles are `Name (@channel) - Telegram`. Anything else throws ("mirror blocks RSS readers" when the title matches /whitelist/i). |
| `SOC_ACCOUNTS[].tg` | Optional official Telegram channel per account: binance→`binance_announcements`, WatcherGuru→`WatcherGuru`, whale_alert→`whale_alert_io`, Cointelegraph→`cointelegraph`. When present it is the **first** post source; personalities without one stay Nitter-best-effort (stats still live via fxtwitter). |
| `socTgFeedUrl(ch)` | Builds `https://rss-bridge.org/bridge01/?action=display&bridge=TelegramBridge&username=<ch>&format=Atom` — the public RSS-Bridge instance turning `t.me/s/<channel>` into Atom that rss2json can read (verified working 2026-07-10). |
| RSS-Bridge TelegramBridge | Public keyless bridge (rss-bridge.org) scraping Telegram's public channel preview into a feed. Item title = message text, link = `t.me/<channel>/<id>`, pubDate = same `YYYY-MM-DD HH:MM:SS` UTC shape rss2json gives Nitter feeds. Media-only posts titled `Please open Telegram…` are skipped. |
| `_socAcctVia` | handle → `"tg"` \| `"x"`: which source served the account's posts this fetch. Drives the chip suffix (`8 tg` vs `3 tw`) and the per-post `· TG` source tag. |
| `SOC_NITTER_HOSTS` (trimmed) | Now only xcancel.com + nitter.poast.org. All 5 RSS-enabled public instances on the status.d420.de tracker bot-wall or UA-whitelist `/rss` (checked 2026-07-10), so the Nitter path rarely yields posts; the trim caps failed rss2json calls at ≤2 per account per refresh. |

## 2026-07-09 — Command › 🐦 Socials sub-tab (v2026-07-09.6)

| Term | Meaning |
|------|---------|
| Socials sub-tab (Command) | `subpage-socials` under the 🧭 Command parent tab (deep link `#socials`). Crypto tweets + stats from curated >0.5M-follower accounts, T1/T2-badged, GMT+2 timestamps, 10-min cache. Stats live via fxtwitter; tweets best-effort via Nitter mirrors. Analysis-only, defensive input only. |
| fxtwitter API | `GET https://api.fxtwitter.com/<handle>` — the FixTweet service's keyless JSON API with `Access-Control-Allow-Origin: *` (verified 2026-07-09). `j.user` carries live `followers`, `tweets`, `name`, etc. The **only** keyless CORS-open X endpoint found working; used by `socFetchStats()`. No timeline endpoint — tweet text still needs the mirror RSS path. |
| `SOC_ACCOUNTS` | Curated 14-account list, every one >0.5M followers (the roadmap gate — enforced by curation). Fields: `h` (handle), `name`, `followersM` (static snapshot in millions, 2026-07 — render fallback when fxtwitter fails, marked `*`), optional `general:true` (non-crypto-native → crypto-keyword filter applies). |
| Nitter-mirror RSS | X/Twitter has no keyless API and blocks CORS. Nitter mirrors expose `https://<host>/<handle>/rss`; fetched through the same rss2json bridge as News. `SOC_NITTER_HOSTS` = xcancel.com, nitter.poast.org, nitter.privacyredirect.com, lightbrd.com — tried in order per account (`socFetchAccount()`), mirrors die often. Retweet items start with an `RT by` prefix in the title and are skipped. |
| `SOC_CRYPTO_RE` | Crypto-keyword gate applied to `general:true` accounts only (bitcoin/btc/eth/solana/doge/defi/nft/etc.) so e.g. non-crypto Musk tweets stay out. |
| `socToXUrl()` | Rewrites the mirror status link back to `https://x.com/...` and strips Nitter's `#m` anchor. |
| `SOC_CACHE_MS` / `SOC_MAX_ITEMS` / `SOC_MAX_PER_ACCT` | 10-min auto-load cache / 60 rendered tweets / 8 tweets per account (keeps one account from flooding the feed). |
| `.soc-acct` chips | Per-account stat chips (`#socAccts`): @handle · follower count (`socFollowersLabel()`) · tweets fetched; `.soc-dead` (red ✕) when all mirrors failed for that account. |

## 2026-07-09 — Command › 📰 News sub-tab (v2026-07-09.5)

| Term | Meaning |
|------|---------|
| News sub-tab (Command) | `subpage-news` under the 🧭 Command parent tab. Aggregated crypto headlines from 4 sources, deduped, T1/T2-badged, GMT+2 timestamps, 5-min cache. Analysis-only. Deep link `#news`. |
| `COMMAND_SUBS` | `["command-overview","news"]` — Command's sub-tab ids; `commandSubTab(subId)` mirrors `marketSubTab`/`analyticsSubTab`. *(v2026-07-09.6: `"socials"` appended.)* |
| `subParentOf(id)` / `subTabFnOf(parent)` | Shared helpers (added v2026-07-09.5) mapping a sub-tab id to its parent tab and the parent to its `<parent>SubTab` function — single source of truth for the sub-tab redirects in `switchTab()` and `applyTabFromUrl()`. |
| Alpaca News API | `GET https://data.alpaca.markets/v1beta1/news?symbols=BTCUSD,…&limit=50&sort=desc` with the standard `APCA-API-KEY-ID`/`SECRET` headers. Benzinga-sourced. Response: `{ news: [{ id, headline, created_at, url, source, symbols[] }] }`. Skipped when no keys are stored. |
| rss2json bridge | `https://api.rss2json.com/v1/api.json?rss_url=<feed>` — keyless RSS→JSON proxy with `Access-Control-Allow-Origin: *`. Used because direct RSS fetches are CORS-blocked in the browser and the CryptoCompare (`min-api.cryptocompare.com`, now 401) and CoinGecko (`/api/v3/news`, now PRO-only 10005) news APIs both require keys as of 2026-07. `pubDate` comes back as `"YYYY-MM-DD HH:MM:SS"` in UTC — parse as `replace(" ","T")+"Z"`. |
| `NEWS_RSS_FEEDS` | CoinDesk (`coindesk.com/arc/outboundfeeds/rss/`), Cointelegraph (`cointelegraph.com/rss`), Decrypt (`decrypt.co/feed`). |
| `newsCatalystTier()` | Keyword ladder → `"T1"` (structural: hack/exploit/depeg/delist/enforcement/chain halt/insolvency), `"T2"` (flow: ETF, unlock, halving, listing, treasury buys, Fed/FOMC/CPI/rates), or `null`. Aligned with `skills/crypto-catalysts`; heuristic, not scored — news stays a defensive input. |
| `newsDedupe()` / `newsNormTitle()` | Cross-source dedupe: newest-first, drop items whose normalized headline (lowercase, punctuation→space, first 80 chars) or URL was already seen. |
| `newsDetectCoins()` | Base-ticker chips for RSS items: case-sensitive ticker (`\bSOL\b`) OR any-case coin name (`[Ss]olana`) so ordinary words like "Sol"/"Ada" never match. Alpaca items use their native `symbols` array instead. |
| `NEWS_CACHE_MS` / `NEWS_MAX_ITEMS` | 5 min auto-load cache / 40 rendered headlines. |

## 2026-07-09 — Execution order table Total column (v2026-07-09.4)

| Term | Meaning |
|------|---------|
| Total column (Execution tab) | Sortable USD order-value column in the Recent Orders table (after Avg Fill), roadmap item 2026-07-09. Value = `filled_qty × filled_avg_price` for (partially) filled orders, else `qty × limit_price` for unfilled limit orders, else the order's `notional` field; "–" when none available. Rendered in `renderExecution()`; sorting comes free from the generic `sortTable()`/`parseCellValue()` (strips `$`/commas). |

## 2026-07-09 — Canonical symbol notation BASE/QUOTE (v2026-07-09.3)

| Term | Meaning |
|------|---------|
| Canonical symbol notation | The one symbol format used project-wide: the slash pair `BASE/QUOTE` (`BTC/USD`, `BTC/USDT`) — config, journals, logs, state files, and every dashboard label. Alpaca's no-slash form (`BTCUSD`) lives only at the API boundary (positions/orders/activities responses, order payloads, bars/snapshot map keys). Rule documented in CLAUDE.md › "Symbol notation (canonical)". |
| `scripts/symbols.py` / `to_slash()` | Single Python converter `'BTCUSD' → 'BTC/USD'` (quotes USDT/USDC/USD, longest match first, so `BTCUSDT → BTC/USDT`). Replaced four duplicated local `_to_slash`/`_slash` implementations in `rebalance.py`, `run_evaluation.py`, `trade.py`, `scout.py`. Mirrors the dashboard's `toSlash()` — keep the two in sync. Tested in `tests/test_symbols.py`. |
| `baseTicker()` exemptions | The dashboard helper is no longer used for symbol labels. Remaining functional uses: news-site URL slugs in Breakout cards (CryptoPanic/CoinGecko want the bare base), the space-capped 4-char correlation-matrix axis ticks, and the `symbolInfo()` asset-*name* fallback. Each site carries a comment referencing the notation rule. |

## 2026-07-09 — All 8 trader-effectiveness items implemented (v2026-07-09.1)

| Term | Meaning |
|------|---------|
| Round-trip cost | Total cost of a completed trade: 2× `costs.taker_fee_bps_per_side` (25 bps/side, Alpaca crypto base tier) + live bid-ask spread. Python `risk.round_trip_cost_pct(bid, ask)` returns a fraction; JS `roundTripCostPct(spreadPct)` returns a percent. Feeds net R:R, the scalp viability gate, and the walk-forward fee default. |
| Net-of-cost R:R (net R:R) | Reward:risk after subtracting the round-trip cost from the reward leg: `((target − entry) − entry×cost) ÷ (entry − stop)`. Stop = 4H swing low, target = BB upper. Python `risk.net_rr()`, JS `netRrPct()`. Shown in the Signals **Net R:R** column + trade modal (`_signalRrMap` carries `rr`/`grossRr`/`costPct`). |
| Net R:R soft gate | Entry gate in both engines: net R:R < `strategy.min_rr_half` (1.0) → block; < `min_rr_full` (1.5) → half-size; skipped when stop/target geometry is unavailable ("soft"). |
| Scalp viability gate (Cost Check) | Scalping-tab column: distance to the BB-upper target must be ≥ 2× round-trip cost, else the row shows red "⚠ costly" (flag, not block — Buy stays available). |
| Position rotation | Implemented in `run_evaluation.apply_rotation()` + the Autopilot budget-full branch: a budget-blocked candidate scoring ≥ `strategy.rotation_min_score` (4.0) and ≥ `rotation_score_margin` (2.0) above the weakest open holding (which must score ≤ 0) replaces it in the same cycle. Pure gate: `risk.rotation_allows()`. One rotation per cycle; exits execute before entries; regime/tier/R:R gates still apply. |
| Over-budget reconciliation | `BUDGET EXCEEDED n/m` warning (console + bold journal line) whenever open positions exceed `risk.max_open_positions`; red `#budgetChip` on the Command tab (`renderBudgetChip()`); optional weakest-overflow trim behind `risk.enforce_budget_on_open_positions` (default false). |
| Partial TP / break-even ladder (+1R scale-out) | At +`partial_tp_r_multiple`R (R = entry − swing-low stop; −5% fallback) sell `partial_tp_fraction` (50%) and raise the remaining stop to breakeven. Fires once (`partial_tp_done`); afterwards the hard stop is `max(swing low, breakeven)`. Python: `risk.should_partial_tp()` + `position_state.mark_partial_tp()`; Autopilot mirror: `localStorage.autopilotPartialTp` (sym → breakeven), merged from the Python state file. |
| Stale-position exit | `risk.max_hold_hours` (48): exit positions older than the limit that never armed their trailing stop and score below the half-size gate (2.5). Pure gate: `risk.is_stale_position()`; entry clock: `entry_time_iso` in the state file / `localStorage.autopilotEntryTime`. Winners (armed trail) exempt. |
| 4H aggregation fallback / synthetic 4H | When the native 4H fetch returns < 51 bars, both engines aggregate 1H bars into synthetic 4H bars on 4-hour UTC boundaries, complete buckets only (`aggregate_bars_to_4h()` / `aggregate1hTo4h()` + `fill4hFallback()`). Failure → explicit `DATA-QUALITY WARNING` journal line / red ⚠ in the Signals 4H cell (yellow ⚠ = synthetic in use). |
| Session-edge filter | OFF by default (`strategy.session_filter_enabled`): half-size entries during GMT+2 exit-hour/weekday buckets with ≥ `session_min_sample` (20) realized FIFO round trips and negative net P&L. Python `_session_penalty_active()` (run_evaluation); JS `apSessionPenaltyActive()` (6h cache over `edgeFetchAllFills`). |
| `entry_time_iso` / `partial_tp_done` / `breakeven_stop` | New per-position fields in `data/positions_state.json` (position_state.py `_EMPTY_POSITION`): when the position opened, whether the +1R scale-out already fired, and the breakeven stop level for the remainder. |
| `localStorage.autopilotPartialTp` / `autopilotEntryTime` | Autopilot mirrors of the above (sym → breakeven price; sym → entry epoch-ms). Pruned to held symbols each cycle; merged from the Python state file so both engines run the same ladder on a shared position. |

## 2026-07-08 — Roadmap sweep: Autopilot hardening + dashboard parity (v2026-07-08.1)

| Term | Meaning |
|------|---------|
| `STRAT_CFG` | Dashboard const object holding the strategy/risk params shared with Python: `taExitScore` (−2), `trailArmPct` (2.5), `trailPct` (3), `cashReservePct` (20), `swingLowLookback` (20), `swingLowBufferPct` (0.1), `swingLowMaxStopPct` (8), `minBarsForSignal` (60), `dailyDrawdownGatePct` (3), `escalationCycles` (2), `escalationExtraPct` (0.3). Defaults are fallbacks; `seedStrategyConfig(cfg)` overwrites from `config.json › strategy/risk/data` on page load. Replaced the hardcoded `AP_TA_EXIT_SCORE`/`AP_TRAIL_*`/`AP_CASH_RESERVE_PCT`/`SWING_LOW_*` consts. |
| `seedStrategyConfig(cfg)` | Called by `loadConfigFromFile()`; maps config keys → `STRAT_CFG` (fractions ×100 to percent) + `_scoutTtlHours` from `scout.ttl_hours`. |
| `fetchLocalJson(paths)` | Graceful multi-path relative JSON fetch (first parsed object wins, else null). Used for `./config.json` → `../config.json`, `data/watchlist_dynamic.json`, and `data/positions_state.json`. |
| `localStorage.autopilotDayOpen` | `{day, equity}` — day-open equity snapshot per GMT+2 day (`en-CA` date). Drives the Autopilot **daily-drawdown gate**: equity ≥ `dailyDrawdownGatePct` below it → entries blocked (exits active), reset at day roll. Mirrors `risk.daily_drawdown_gate_triggered`. |
| `localStorage.autopilotOrderAge` | `{orderId: cycles}` — how many Autopilot cycles each open order has survived. Entry limits cancelled at age > 1 (**only `ap-`-tagged orders** — bugfix 2026-07-08 v2); exit limits cancel-replaced at age ≥ `escalationCycles` with band `0.5% + escalationExtraPct`. Cleared by the ⛔ kill switch. |
| `ap-` `client_order_id` tag | `apPlaceOrder()` tags every Autopilot order `client_order_id = "ap-<SYM>-<ms>"`. The stale-entry sweep only cancels buy limits carrying this prefix, so Python-engine entries and manual trade-modal orders are never swept (bugfix 2026-07-08 v2). Exit cancel-replace stays untargeted — it always re-places a protective SELL immediately. |
| `trailArmed` (Autopilot) | Trailing stop arms from the **HWM**, not current P&L: `hwm ≥ entry × (1 + trailArmPct/100)`. Once armed, fires at `cur ≤ hwm × (1 − trailPct/100)` even if P&L pulled back below the arm threshold — mirrors `risk.should_trail_stop_out` (bugfix 2026-07-08 v2; previously the whole check was gated on `plPct ≥ 2.5`, so a pullback un-armed the trail). |
| `apCancelOrder(id)` | DELETE `/v2/orders/{id}`; 404 (already filled/cancelled) counts as success. |
| `liveQuote{}` | Per-cycle map of live snapshot prices (`fetchSnapshotsInBatches`) used for **all Autopilot limit prices**; `res.lastClose` (last completed 15-min bar) stays scoring-only. |
| `apMaxCorrWith(sym, openSyms, bD)` | Max Pearson ρ of 30-day daily log-returns between a candidate and each open position. ρ > `AP_CORR_LIMIT` (0.9) → half-size entry (correlation-aware gate). |
| `loadScoutPromotions()` / `scoutExtraSymbols(base)` | Reads `data/watchlist_dynamic.json` → `_scoutPromos {symbols, details, generated, ageHours, fresh}`. `fresh` = age ≤ `_scoutTtlHours` (config `scout.ttl_hours`, default 6). Fresh promotions merge into the Signals scan + Autopilot; rows get a blue **SCOUT** tag; Command tab shows the 🔭 chip (`renderScoutChip()`). |
| `renderHwmSplitWarning()` | Command-tab warning (`#hwmSplitWarning`) when `data/positions_state.json` and `localStorage.autopilotHwm` both hold an active trailing HWM for one symbol. The Autopilot also seeds `hwm[sym] = max(local, file)` each cycle. |
| `calcADX()` / `adxLabel()` / `calcObvTrend()` | JS ports of `indicators.adx` / `adx_label` / `obv_trend` — display-only ADX + OBV columns in Signals + Scalping. NOT part of `calcSignalScore` (parity exemption). |
| `_signalRrMap` | sym → `{stop, stopDistPct, target, rr}` cached by the Signals scan. Drives the **R:R column** (risk = 4H swing-low stop distance, reward = BB-upper distance) and the trade-modal `#tradeRrInfo` box. Display-only. |
| Min-bars 60 | All five dashboard scoring paths (Signals, Scalping, Breakout, Scanner, Autopilot) gate on `STRAT_CFG.minBarsForSignal` = `data.min_bars_for_signal` (60). Was 55 — parity checklist item 13. |

---

## 2026-06-19 — Loosened gates, 4H swing-low stop, Scalping tab

| Term | Meaning |
|------|---------|
| Swing-low stop (4H) | TA-driven long stop that replaced the fixed −5% hard stop. Sits just below the previous 4H range low — lowest low of the last `swing_low_lookback_bars` (20) completed 4H bars, ×(1−`swing_low_buffer_pct`), clamped so it is never more than `swing_low_max_stop_pct` (8%) below entry. `risk.stop_loss_mode = "swing_low_4h"`. |
| `swing_low_stop_price(entry, lows_4h, …)` | `risk.py` helper returning the swing-low stop price, or `None` when <5 bars or the level isn't below entry (caller then falls back to the fixed `stop_loss_pct`). |
| `should_stop_out(entry, current, stop_price=None)` | `risk.py` — now takes an explicit `stop_price` (the swing-low level); falls back to the fixed `stop_loss_pct` drawdown when `stop_price` is None. |
| `swingLowStop4h(lows4h, entry)` | Dashboard JS mirror of `swing_low_stop_price` (used by Autopilot exits). |
| `downtrend_long_score_threshold` | `config.json › strategy` (= 4.0). Minimum confluence score for a **half-size counter-trend long** in a confirmed daily downtrend. Dashboard const: `SIGNAL_DOWNTREND_LONG_SCORE`. |
| `SIGNAL_BUY_SCORE` / `SIGNAL_HALF_SCORE` | Dashboard consts (3.5 / 2.5) mirroring `strategy.buy_score_threshold` / `buy_score_half_size_threshold`; used by every signal-score display + Autopilot. |
| ⚡ Scalping tab | Low-timeframe confluence scanner (`page-scalp`, `loadScalp()`). TF selector maps the (exec, trend, regime) stack down via `SCALP_TF_MAP` (5m→5m·1h·4h, 15m→15m·1h·4h, 1h→1h·4h·1D) and runs the same `calcSignalScore`. Scanner + manual Buy/Sell (`openTradeModal`); no auto-loop. |
| `SCALP_TF_MAP` | Dashboard map from a scalp timeframe to its `{exec, trend, regime}` bar timeframes. |

---

## 2026-06-17 — Shared Score Distribution tile

| Term | Meaning |
|------|---------|
| `renderScoreDist(elId, scores)` | Shared helper (defined just above `loadSignals`) that renders the 6-point **Score Distribution** tile into the given element id. Buckets an array of scores into ≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR (handles fractional scores) and draws colour-coded horizontal bars. Used by both the Signals tab (`#scoreDist`) and the Market → Scanner sub-tab (`#msScoreDist`) so they render identically. Replaced the Scanner's old per-integer inline list. |

---

## 2026-06-17 — Behavioral Insights tab

| Term | Meaning |
|------|---------|
| `c.activities` | Context field added by `loadContext()` (the newest-first FILL feed it already fetches for `computeFifoStats`). `renderCommand()` uses `c.activities.slice(0,2)` to render the **Latest Activity** block (`#recentActivities`) in the top-left of the 🚦 Trading Permission Rules panel. |
| `apRenderStatusLog()` | Renders the last 3 Autopilot log entries (`apGetLog().slice(-3).reverse()`) into `#tradingStatusLog`, the readout under the big trading-status word in the Command Center. Called by `apRenderLog()` so it stays in sync with the full `#apLog` on every push and on init. |
| `loadInsights()` | Entry point for the 🧠 Insights tab (top-level `page-insights`, id `insights`). On-demand (▶ Analyze). Fetches all FILL history (`edgeFetchAllFills()`), builds round-trips (`insRoundTrips()`), renders 3 KPI tiles + 4 behavioral cards. Analysis-only. |
| `insRoundTrips(activities)` | Dedicated FIFO round-trip matcher for Insights (separate from `computeFifoStats`/`edgeFifoTrades` so the shared engines stay untouched). Returns `{sym, pnl, cost, pnlPct, entryT, exitT}` sorted chronologically by exit time. `cost` = matched entry cost; `pnlPct` = pnl ÷ cost × 100. |
| `insStmt(text, cls)` / `insGap(h)` | Insights render helpers: a coloured headline statement line (`neg`/`pos`/else yellow), and an hour-gap formatter (`m`/`h`/`d`). |
| After-2-Loss Win Rate | Win rate of round-trips that follow ≥2 consecutive losing round-trips (chronological), vs the all-trades baseline. Drives the "win rate drops after losses" insight. |
| Cadence after outcome | Median hours from a round-trip's exit to the next round-trip's entry, split by whether the prior trip won or lost. Shorter gap after wins ⇒ "overtrade after wins". |
| Rule breach (best-effort) | Insights heuristic: **stop-loss breach** = realized `pnlPct < −5` (the −5% hard stop wasn't honored); **cap breach** = entry `cost` > `portCapFor(sym)`% × *current* equity (approximate — historical equity unknown). |

---

## 2026-06-17 — Layout/style consistency sweep

| Term | Meaning |
|------|---------|
| `--hover` | Theme-aware CSS token for control hover backgrounds (`#222b3a` dark / `#e2e7ed` light). Used by `.btn:hover`, `th:hover`, `th.port-sortable:hover`. Replaced hardcoded `#222b3a`/`#21262d` greys that didn't adapt to the light theme. |
| `.spinner` + `@keyframes spin` | Small spinning ring (13px, blue top border) shown inline before portfolio "Loading…" text. Previously referenced by markup but never defined (invisible). |
| `.error` (vs `.error-box`) | The one defined red error-box class. The portfolio error containers (`#portErrorBox`, `#portDistErrorBox`) previously used the undefined `.error-box`; now reuse `.error`. |

---

## 2026-06-15 — Portfolio Dashboard Merge

| Term | Meaning |
|------|---------|
| `port-overview` / `port-hot` / `port-dist` / `port-brief` | Tab IDs for the four portfolio tabs integrated into `dashboard_professional.html` under the "💼 Portfolio" nav section. |
| `portCapFor(sym)` | Returns the symbol's cap percentage from `PORTFOLIO_CAPS` (e.g. 30 for BTC/USD). Uses `PORTFOLIO_CAPS[sym] \|\| 5`. |
| `portConfluenceScore()` | Standalone TA confluence scorer in the Professional Dashboard (same logic as `calcSignalScore`/`signal_score`). Prefixed `port*` to avoid namespace collision. |
| `portLoadBrief()` | Loads the Morning Brief tab: fetches account + positions, computes alerts, runs `portConfluenceScore` for all 10 watchlist symbols. |
| `generateMorningBrief()` | Header-button function that produces a downloadable `.md` morning brief from live Alpaca data. Opens `#briefDocBackdrop` modal. |
| `port-filter-btn` | CSS class for the order-filter buttons (All/Filled/Open/Canceled) in the Portfolio Overview tab. Renamed from `filter-btn` to avoid collision. |
| `port-period-btn` | CSS class for chart period selector buttons in Portfolio Overview. Renamed from `period-btn`. |
| `port-sortable` / `port-sorted` | CSS classes for sortable column headers in portfolio tables. Renamed from `sortable` / `sorted`. |

---

## Acronyms & Abbreviations

| Term | Meaning | Context |
|------|---------|---------|
| ATR | Average True Range | Volatility measure; used for stop distance & position sizing |
| BB | Bollinger Bands | 20-period, 2σ envelope around SMA |
| BoS | Break of Structure | Trend change signal (lower-high broken = bearish BoS) |
| BW | Bandwidth | Bollinger Band width: (upper−lower)/mid |
| EMA | Exponential Moving Average | Weighted MA; reacts faster than SMA |
| HH | Higher High | Bullish structure |
| HL | Higher Low | Bullish structure |
| LH | Lower High | Bearish structure |
| LL | Lower Low | Bearish structure |
| MACD | Moving Average Convergence Divergence | 12/26 EMA diff; 9-period signal line |
| POC | Point of Control | Volume profile: price level with highest traded volume |
| R:R | Risk-to-Reward ratio | Stop distance vs take-profit distance (need ≥1:2, prefer 1:3) |
| RSI | Relative Strength Index | Wilder method, 14-period; overbought >70, oversold <30 |
| SMA | Simple Moving Average | Equal-weight average |
| SoS | Sign of Strength | Wyckoff: volume-confirmed breakout above trading range |
| TA | Technical Analysis | Chart-based signal analysis |
| TF | Timeframe | e.g. 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Position within band: 0=lower, 1=upper |

---

## 2026-07-07 — Informational indicators ADX + OBV

- `indicators.py` gained `adx()`, `adx_label()`, `obv_series()`, `obv_trend()` — journal-only, not in `signal_score()`, exempt from dashboard parity.
- Journal indicator block now has `adx :` and `obv :` lines between `atr` and `4h`.

## 2026-07-07 — New skills: hourly-research + crypto-catalysts

- `skills/hourly-research-SKILL.md` — procedure for the top-of-hour research pass (per-symbol TA + news block `Research HH:MM GMT+2`); research-only, no orders. Symbol set = watchlist + fresh scout promotions.
- `skills/crypto-catalysts/SKILL.md` — knowledge guide for weighing crypto news/events; defensive only (veto/downsize/flag-to-close, never entries below score gates).
- **Catalyst severity ladder (T1/T2/T3)** — T1 structural (hack, stablecoin depeg, delisting, enforcement naming the asset, chain halt → flag position close + block entries), T2 flow (large token unlock, ETF flow streak, funding > +0.1%/8h, listing, OI extreme → downsize/skip borderline entries), T3 noise (record only). Cited in the research block's `Read:` line, e.g. `flagged to close: SOL/USD — T1 venue exploit headline`.
- **Unlock veto** — skip new entries in an alt with a large (>2–3% supply) token-unlock cliff inside ~7 days, even at full-size score.
- **Skill split convention** — knowledge playbooks live in directories (`skills/<name>/SKILL.md`: crypto-trader, crypto-catalysts); scheduled-routine procedures are flat files (`skills/<name>-SKILL.md`: hourly-research, morning-brief, daily-journal).

## Trading Terms

| Term | Meaning |
|------|---------|
| Confluence score | 6-point TA signal score; ≥3.5 = buy, ≥2.5 = half-size, <2.5 = hold (≥4.0 = half-size counter-trend long in a downtrend); ≤−4 = short, −3 = half-size short, ≥+2 = cover |
| Markov analysis | Dashboard Markov tab. First-order Markov chain over daily close-to-close returns. 3 states via ±1% band (`MK_THRESH`): Up (r>+1%), Flat (|r|≤1%), Down (r<−1%). Builds transition matrix `P(next\|current)`, stationary distribution (power iteration), and next-day forecast from current state. Run for BTC/USD & ETH/USD over 30/60/90/180/365-day windows. Analysis-only, no order routing. Matrix tables use the `.mk-matrix` CSS class (`min-width:0; table-layout:fixed`) to override the global 760px table min-width so they fit their narrow grid panels without overlapping. |
| Transition matrix | 3×3 matrix where cell (i,j) = empirical probability of moving from state i to state j on the next day. Rows sum to 1. |
| Stationary distribution | Long-run state probabilities π satisfying π = πP; computed via power iteration. The Markov tab shows it alongside the empirical state frequencies. |
| Regime block | Daily downtrend detected → all new long entries blocked |
| BB squeeze | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |
| Golden cross | 20 EMA crosses above 50 EMA → bullish |
| Death cross | 20 EMA crosses below 50 EMA → bearish |
| EMA cross state | Detected from last two bars; "golden" / "death" / "neutral" |
| 4H regime | Primary trend filter: 20 EMA vs 50 EMA on 4-hour bars |
| ADX | Average Directional Index (14, Wilder) — trend *strength* 0–100, direction-agnostic. Journal-only informational line (`adx :`), not part of the 6-point score. Labels via `adx_label()`: <20 ranging/weak, 20–25 emerging trend, 25–40 trending, ≥40 strong trend |
| OBV / OBV trend | On-Balance Volume — cumulative volume signed by close-to-close direction. `obv_trend()` compares OBV now vs 20 bars ago with a 5%-of-window-volume dead zone → rising/falling/flat. Journal-only informational line (`obv :`), not scored |
| Wyckoff | Market cycle phases: Accumulation → Mark-Up → Distribution → Mark-Down |
| Mark-Up | Wyckoff trend phase: consistent HH/HL, buy pullbacks |
| Mark-Down | Wyckoff downtrend phase: consistent LH/LL, stay flat |
| Accumulation | Wyckoff buy zone: range after downtrend, look for SoS |
| Distribution | Wyckoff exit zone: range after uptrend, do not add positions |
| Regime (daily) | last_close > 50-day SMA AND 20-day SMA > 50-day SMA = uptrend |
| Hard cap | Position capped at 5% of total equity; enforced in trade.py |
| ATR sizing | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at 5% equity |
| Limit order | Only order type used; price ≤ ask + 0.2% |
| Paper trading | Simulated trades only; Alpaca paper environment |
| Morning brief | Scheduled 7 AM task: eval + journal block + dashboard summary |
| Daily regime | Computed from 90-day daily bars: SMA-20 vs SMA-50 vs last close |
| Vol ratio | Current bar volume / 20-bar average volume |
| Live R:R | Real-time risk-to-reward: `(target − current) / (current − stop)` using −5% stop, +10% target |
| Ticker strip | Top-of-dashboard price bar driven by the active watchlist (`getWatchlist()`, up to 20 symbols — not a static 10); 15-second auto-refresh via Alpaca snapshots API, re-renders immediately on watchlist edits |
| Correlation heatmap | 10×10 Pearson ρ matrix of daily log-returns; shown in Risk tab |
| Trend arrow | ↑/↓/→ indicator in Signals tab comparing current confluence score to previous scan |
| Quick-buy (⚡) | Signals tab button for setups scoring ≥ 3; pre-fills trade modal with ATR-sized qty |
| Execute button (▶) | Directly submits the signal row's ATR-sized paper order from the Signals tab without opening the trade modal |
| SHORT (action) | Open a new short position — sends `side="sell"` to Alpaca with no existing position. Triggered when score ≤ −4 in a confirmed daily downtrend |
| COVER (action) | Close an existing short position — sends `side="buy"` to Alpaca. Triggered by stop-loss (+5%) or score ≥ +2 (bullish flip) |
| Short stop-loss | COVER triggered when price rises ≥5% above short entry (`risk.should_cover_short()`). Inverse of long stop-loss |
| Cover stop price | `entry × 1.05` — the hard stop price for a short position (`risk.short_stop_price()`) |
| Short regime gate | SHORT entries only allowed in confirmed daily downtrend (close < 50-SMA AND 20-SMA < 50-SMA). No shorts in uptrend or mixed regime |
| `should_cover_short()` | `risk.py` function: returns True if `(current - entry) / entry >= 0.05`. Short equivalent of `should_stop_out()` |
| `short_stop_price()` | `risk.py` function: returns `entry_price × (1 + STOP_LOSS_PCT)` — the hard stop price for a short |
| `SHORT_SCORE_THRESHOLD` | Constant in `run_evaluation.py` (= −4.0). Full-size short entry gate |
| `SHORT_SCORE_HALF_SIZE` | Constant in `run_evaluation.py` (= −3.0). Half-size short entry gate if R:R ≥ 1:3 |
| `COVER_SCORE_THRESHOLD` | Constant in `run_evaluation.py` (= +2.0). TA-based cover trigger when score turns bullish |
| Trailing stop | Activates once a long position is ≥2.5% in profit. Trails 3% below the high-water mark (HWM). Supersedes the hard 5% stop once active |
| HWM | High-water mark — the highest close price seen since entry. Ratchets up only, never down. Persisted in `data/positions_state.json` |
| Stop-loss deduplication | Before placing any SELL/COVER stop-loss order, `get_open_orders(symbol)` is called. If a pending order exists within the escalation window, the duplicate is suppressed |
| Time-escalation | When a stop-loss order has been pending for `stop_loss_escalation_cycles` (2) evaluation cycles without filling, it is cancelled and replaced with a wider limit (base 0.5% + extra 0.3%) |
| `stop_loss_limit_price(ask, cycles_open)` | `risk.py` function: returns the limit price for a SELL stop. Uses 0.5% band; widens after 2 unfilled cycles |
| `cover_limit_price(ask, cycles_open)` | `risk.py` function: mirror of `stop_loss_limit_price` for COVER (short) orders; limit is placed above ask |
| `is_stop_loss` | `place_order()` bool param — when True, uses 0.5% limit band instead of 0.2% to allow stop-loss fills in volatile markets |
| Correlation budget | Max open positions total + max per tier are **user-configurable** (defaults loosened 2026-06-19 to 4 total, 3 per tier; Tier-1: BTC/USD+ETH/USD; Tier-2: alts). New entries blocked when either limit is reached. Python reads `config.json › risk.max_open_positions` / `max_positions_per_tier` (checked by `correlation_budget_allows()` in `risk.py`); the dashboard Autopilot reads `getSettings().limits.maxOpenPositions` / `maxPositionsPerTier` (Settings › 🔗 Correlation Budget) live via `apMaxPositions()` / `apMaxPerTier()` |
| Tier-1 symbols | BTC/USD and ETH/USD — most liquid, highest correlation. Separate per-tier budget from Tier-2 alts |
| Daily drawdown gate | If portfolio equity drops ≥3% vs day-open equity, capital preservation mode activates: all new entries blocked, existing stops tighten to 3%. Resets at midnight UTC |
| Capital preservation mode | State flag in `data/positions_state.json`. Set by `activate_capital_preservation()`, cleared by `check_and_refresh_day_open()` at start of each new day |
| `position_state.py` | New module (2026-05-27): manages `data/positions_state.json`. Stores HWM, stop order IDs + cycle counts per symbol, plus day-open equity and capital preservation flag |
| `positions_state.json` | Persistent JSON state file in `data/`. Survives evaluation cycles. Atomic writes via temp-file + os.replace() |
| `correlation_budget_allows(symbol, open_symbols)` | `risk.py` function: returns `(allowed, reason)`. Checks total position count and per-tier count |
| `daily_drawdown_gate_triggered(day_open, current)` | `risk.py` function: returns True if drawdown ≥ 3% (configurable via `config.json > risk.daily_drawdown_gate_pct`) |
| Rebalance script | `scripts/rebalance.py` — trims over-cap positions, tops up under-cap positions (signal-gated). Run with `--execute` to submit orders |
| Over-cap trim | Position value > cap% of equity → sell excess to bring back to cap. No signal gate; always fires |
| Under-cap top-up | Position value < cap% → buy to close the gap, subject to signal gate (score ≥ 3) and regime gate (no downtrend) |
| `isShort` | Dashboard JS pattern: `const isShort = qty < 0`. Alpaca returns negative `qty` for open short positions |
| SHORT badge | Red `SHORT` label displayed next to symbol name in Positions tab for short positions (both dashboards) |
| ⚡ Short button | Signals tab quick-fill button for short setups (`down && score <= -3`); pre-fills trade modal with `side='sell'` and ATR-sized qty |
| TOP30_SYMBOLS | 30-element JS array in the dashboard covering the top crypto by market cap available on Alpaca (stablecoins and BNB excluded) |
| TOP30_INFO | JS object keyed by symbol; stores `rank`, `tier` (Mega/Large/Mid/Small), `capLabel`, and `name` for each of the 30 symbols |
| _activateSubTab(parentId, subId) | Generic dashboard helper powering both parent tabs' sub-tabs. Scoped to `#page-<parentId>`, it toggles the `.subpage` divs + `.subtab-btn` buttons within that parent (so 🌐 Market and 🔬 Analytics never clash), then mirrors `subId` to the URL hash + `localStorage.lastTab`. `marketSubTab`/`analyticsSubTab` are thin wrappers that add validation + lazy-loading. (CSS `.subnav`/`.subpage` were renamed from `.market-subnav`/`.market-subpage` when generalised 2026-06-17; button ids unified to `subtab-<subId>`.) |
| Market tab / page-market | Single nav tab merging Market Overview + Scanner + Breakout (2026-06-17). `switchTab('market')` shows `page-market`; the shared `.subnav`/`.subtab-btn` bar switches the three `.subpage` divs (`subpage-market-overview`/`subpage-market-signals`/`subpage-gapgo`). Middle sub-tab labelled **🔭 Scanner** (renamed from "Signals" to fix the duplicate-name bug; sub-id stays `market-signals`) |
| Analytics tab / page-analytics | Single nav tab merging Performance + P&L + Edge (roadmap, 2026-06-17), in the **📊 Analysis** nav section. `switchTab('analytics')` shows `page-analytics`; `.subpage` divs `subpage-performance`/`subpage-pnl`/`subpage-edge`. Performance auto-loads (`refreshCurrent`→`loadDashboard`); P&L on select (`loadPnl`); Edge manual |
| MARKET_SUBS / ANALYTICS_SUBS | Const arrays of each parent tab's valid sub-ids — `["market-overview","market-signals","gapgo"]` and `["performance","pnl","edge"]`. Single source of truth used by `marketSubTab`/`analyticsSubTab` (validation), `applyTabFromUrl()` (`SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)`, deep-link resolution), and `switchTab()` (redirect guard: any sub-id → its parent + sub-tab, so keyboard shortcuts / `#gapgo` / `#pnl` / legacy `switchTab('pnl')` keep working) |
| marketSubTab(subId) / analyticsSubTab(subId) | Wrappers over `_activateSubTab` for the two parent tabs: validate `subId` against `MARKET_SUBS`/`ANALYTICS_SUBS`, store `_marketSub`/`_analyticsSub` for restore, and lazy-load (Overview / Performance auto-load; P&L on select; Scanner/Breakout/Edge manual). Cross-link buttons in each sub-tab header call them |
| Breakout sub-tab / subpage-gapgo | Pre-session breakout/gap analysis, formerly the standalone `gapgo` tab, folded into the Market tab as the third sub-tab 2026-06-17. `loadGapGo()` renders Conviction (±7) + Signal (`calcSignalScore`; the `/6` suffix was dropped 2026-06-29) per card; manual run. Element `subpage-gapgo`, button `subtab-gapgo` |
| Market Overview sub-tab | Dashboard sub-tab (inside the Market tab) showing live price, 24h%, 7d%, volume, trend and cap tier; auto-loads on selection; includes momentum heatmap. Symbol set is the shared `getCryptoUniverse()` filtered to `/USD` pairs (`usdPairsOnly()`, bugfix 2026-07-09 v2) and sliced by the Max Symbols setting (`MO_SYMBOLS = usdPairsOnly(universe).slice(0, n)`) — no longer hardcoded to 30; symbol cells show the full pair. Each row has a **Trade** column with Buy/Sell buttons (`moTradeButtons()`) |
| moTradeButtons(row) | Dashboard fn rendering the Market Overview row's Buy/Sell buttons; calls `openTradeModal(row.sym→BTCUSD, displaySym, side, '', row.price)` (qty blank, side+price pre-filled). Returns `–` when the row has no live price. Reuses the shared trade modal — no new submit logic |
| populateWatchlistOptions() | Dashboard fn filling the Settings watchlist `<datalist id="watchlistSymbolOptions">` from `getCryptoUniverse()`, excluding already-added symbols. Called from `renderWatchlistTags()` so it re-syncs after add/remove/reset. Powers the watchlist add-symbol dropdown (`<input list>`); degrades to free-text if the assets call fails. When the **Show stablecoins** checkbox (`#watchlistShowStable`, default off) is checked, also appends `getStablecoinPairs()` so stablecoin pairs appear in the dropdown |
| getStablecoinPairs() / _stablecoinUniverse | `_stablecoinUniverse` is the list of stablecoin `*/USD` pairs found in the tradable universe — collected (not just dropped) by `getCryptoUniverse()` alongside `_cryptoUniverse`. `getStablecoinPairs()` awaits the universe build then returns it. Used only by the Settings symbol selector's opt-in **Show stablecoins** filter; the trading universe / scans never include these |
| Market Signals sub-tab | Dashboard sub-tab (inside the Market tab) running the full 6-point confluence scan on demand across `getCryptoUniverse()` filtered to `/USD` pairs (`usdPairsOnly()`, bugfix 2026-07-09 v2 — USDT/USDC duplicates removed), capped by the Max Symbols setting; same scoring engine as the watchlist Signals tab. Symbol cells show the full pair (`BTC/USD`). Has a per-symbol Watchlist column (`msWatchlistCell()`) |
| msWatchlistCell(row) / msAddWatch / msRemoveWatch | Market Signals Watchlist-column helpers. `msWatchlistCell()` renders **+ Watch** when score ≥ 4 and symbol not on watchlist, **– Unwatch** when score ≤ −2 (sell) and no open position (`_msOpenPosSyms`), else ✓ watched / – (or "full" at the 20-cap). The buttons call `msAddWatch`/`msRemoveWatch`, which mutate the shared watchlist (`saveWatchlistData`+`renderWatchlistTags`) and re-render only the cells via `renderMsWatchlistCells()` (cached `_msLastRows`, cells keyed `mswl-<alpSym>`) — no rescan |
| _msOpenPosSyms / _msLastRows | Market Signals globals: `_msOpenPosSyms` is a Set of `BASE/QUOTE` symbols with an open position (normalized via `toSlash`, from `/v2/positions`, fetched in `loadMarketSignals`) used to gate the Watchlist – Unwatch button; `_msLastRows` caches the last scanned rows so watchlist cells can re-render without a rescan |
| symbolInfo(sym) / _universeRank | `symbolInfo()` returns a symbol's display info: curated `TOP30_INFO` when known, else `{ rank: _universeRank[sym] (1-based universe position), tier:"?", capLabel:"?", name: baseTicker(sym) }`. `_universeRank` is rebuilt by `rebuildUniverseRank()` at the end of `getCryptoUniverse()`. Used by Market Overview + Market Signals so every row has a contiguous rank instead of `#?` |
| getCryptoUniverse() | Dashboard fn that fetches the full tradable crypto universe once (`/v2/assets?asset_class=crypto&status=active`), caches it in `_cryptoUniverse`, and orders it as still-tradable `TOP30_SYMBOLS` first then the rest alphabetically. Robust to symbol format: normalizes both `BTC/USD` and bare `BTCUSD` to `BASE/QUOTE`. Accepts quotes in `ALLOWED_QUOTES` (**USD, USDT, USDC** — so `BTC/USDT`/`ETH/USDC` are included, roadmap 2026-06-19), drops other quotes (BTC-quoted etc.), and drops stablecoin bases (see `STABLECOIN_BASES`). Falls back to `TOP30_SYMBOLS` on failure/empty **without caching it** (fixed 2026-06-18) — only a real, non-empty result is stored in `_cryptoUniverse`, so a failed first call (e.g. on page load before credentials are seeded) retries instead of sticking the universe at 30 for the session and capping every scan below `maxSignalSymbols`. Shared by **both** Market Signals and Market Overview (and the Settings watchlist dropdown), replacing the 30-symbol ceiling so `maxSignalSymbols` can exceed 30 on both |
| ALLOWED_QUOTES | Dashboard const `{USD,USDT,USDC}` — the quote currencies `getCryptoUniverse()` keeps. Added 2026-06-19 to allow stablecoin-quoted pairs (BTC/USDT, ETH/USDC) into the dashboard universe; pairs in any other quote (BTC-quoted, EUR, …) are dropped. `addWatchlistSymbol()` validates against the same three quotes. Since the 2026-07-09 v2 bugfix the USDT/USDC pairs feed only the Settings watchlist selector — the scan surfaces filter them out via `usdPairsOnly()` |
| usdPairsOnly(universe) | Dashboard helper (bugfix 2026-07-09 v2) — filters the shared crypto universe to symbols ending `/USD`. Applied by `loadMarketSignals()` (Scanner), `loadMarketOverview()`, and `updateScanBtnLabel()`'s ceiling clamp, because Alpaca executes trades against USD and the mixed USDT/USDC quotes made the same base appear up to 3× per scan (all displayed as the bare base ticker). Scan-surface symbol cells now also render the full pair (`tvLink(row.sym)` → `BTC/USD`) instead of `baseTicker()` |
| baseTicker(sym) | Dashboard helper returning the base asset before the slash (`BTC/USDT`→`BTC`, `BTC/USD`→`BTC`, bare `BTC`→`BTC`). Replaced display-only `sym.replace("/USD","")` calls everywhere once USDT/USDC quotes entered the universe (the old strip turned `BTC/USDT` into `BTCT`). Display labels only — order symbols still use `sym.replace("/","")` |
| STABLECOIN_BASES | Dashboard const set of stablecoin base symbols (USDT, USDC, DAI, USDP, PYUSD, TUSD, BUSD, GUSD, USDG, FDUSD, USDD, FRAX, LUSD, USTC) excluded from the trading universe by `getCryptoUniverse()` — a `USDT/USD`/`USDC/USD` pair is just the stablecoin priced in dollars, never a tradeable setup, so it must not pollute scans/overview. Since 2026-06-19 these pairs are *collected* into `_stablecoinUniverse` (see `getStablecoinPairs()`) so the Settings symbol selector's opt-in **Show stablecoins** filter can offer them in the watchlist dropdown only |
| _msPrevScores | Dashboard JS cache (`{}` keyed by symbol) storing confluence scores from the last Market Signals scan; read by Market Overview to populate its Score column |
| applyTabFromUrl() | Dashboard fn that resolves the active tab from the URL hash, then `localStorage.lastTab`, and activates it. Called at end of `bootstrapDashboard()` and on `hashchange`. Enables deep-linking to a tab (`#signals`) and restoring the last tab on browser refresh. A `SUBS = MARKET_SUBS` list (`market-overview`/`market-signals`/`gapgo`) makes it recognise Market sub-tab ids and open the parent `market` tab + sub-tab (sets `_marketSub` first to skip a wasted Overview load when deep-linking to a non-Overview sub-tab) |
| nav-section-label / nav grouping | Sidebar tabs grouped under `.nav-section-label` headers: ⚡ Trade (Signals · Market · Execution) · 💼 Portfolio (Overview · Allocation · Risk) · 📊 Analysis (🔬 Analytics · Backtest vs Live · Markov); Command + Settings are ungrouped anchors. (As of v2026-06-17.17: Performance/P&L/Edge live inside the 🔬 Analytics parent tab, and the standalone Positions tab was dropped.) Keyboard `TAB_ORDER` (keys 1-9) follows the visual order |
| validTabIds() / tabBtnFor(id) | Dashboard helpers: `validTabIds()` derives the list of valid tab ids by parsing each nav button's `switchTab('<id>',…)` onclick (so routing never drifts as tabs change); `tabBtnFor(id)` returns the nav button for a given id |
| lastTab (localStorage) | Dashboard `localStorage` key holding the last opened tab id; written by `switchTab()`, read by `applyTabFromUrl()` as the fallback when the URL has no tab hash |
| Cap tier | Classification of a crypto's market cap: Mega (>$100B), Large ($10B–$100B), Mid ($1B–$10B), Small (<$1B) |
| `generateMorningBrief()` | Portfolio dashboard header-button handler. Builds the morning brief Markdown (Portfolio Health, Alerts, Signal Confluence, Market Notes) from live data + the `confluenceScore`/`fetchBars` engine; shows modal `#briefDocBackdrop`; downloads `morning-brief-YYYY-MM-DD.md` |
| `generateDailyJournal()` | Professional dashboard header-button handler. Builds the closing journal Markdown (Summary, Trades Today, Open Positions, Market Observations) from account/positions/FILL activities + a `JOURNAL_WL` `calcSignalScore` scan; shows modal `#journalDocBackdrop`; downloads `daily-journal-YYYY-MM-DD.md` |
| `getWatchlist()` | Returns the active watchlist array from `localStorage.proDashboardWatchlist` (falls back to `DEFAULT_WATCHLIST` — the 10 default crypto symbols). Used by `generateDailyJournal()` (was `JOURNAL_WL`), Autopilot (`getApWatchlist()`), and portfolio tabs (`getPortCryptoWL()`). Users manage it in the Settings tab watchlist editor. |
| `DEFAULT_WATCHLIST` | `["BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","DOT/USD","LTC/USD","DOGE/USD","ADA/USD","AAVE/USD"]` — the 10-symbol fallback used when no watchlist is saved in localStorage. `resetWatchlist()` restores this. |
| `WL_STORAGE_KEY` | `"proDashboardWatchlist"` — localStorage key for the user-managed watchlist. Separate from `proDashboardSettings`. |
| `Etc/GMT-2` | IANA timezone string used by the brief/journal generators for GMT+2 timestamps and day filtering. Note the inverted sign: `Etc/GMT-2` == UTC+2 == GMT+2 |

---

## Watchlist Symbols

| Symbol | Asset | Notes |
|--------|-------|-------|
| BTC/USD | Bitcoin | Largest by cap; lowest volatility |
| ETH/USD | Ethereum | DeFi hub; correlated with BTC |
| SOL/USD | Solana | High-throughput L1; volatile |
| AVAX/USD | Avalanche | L1; subnet ecosystem |
| LINK/USD | Chainlink | Oracle network |
| DOT/USD | Polkadot | Parachain ecosystem |
| LTC/USD | Litecoin | OG altcoin; often leads BTC moves |
| DOGE/USD | Dogecoin | Meme coin; high sensitivity to sentiment |
| UNI/USD | Uniswap | DeFi AMM token |
| AAVE/USD | Aave | DeFi lending protocol |

---

## Agents

| Term | Meaning | Context |
|------|---------|---------|
| market-researcher | Analysis-only subagent in `.claude/agents/market-researcher.md` | Pro spot-trader persona; verifies strategy/risk/profitability and reviews the project after strategy changes; logs timestamped reports to `data/market_research/`; never trades |
| Universe Scout | `scripts/scout.py` — auto-promotes uptrending score-≥4 non-watchlist `*/USD` pairs | Writes `data/watchlist_dynamic.json` (TTL 6 h); merged by `run_evaluation` when `scout.enabled`; all gates + 5% default cap apply |
| Autopilot | Dashboard Command-tab autonomous trading loop | OFF on every page load; kill switch cancels all orders; gates mirror the Python agent; HWM + log in localStorage |
| `shorts_enabled` | `config.json › strategy` flag, default **false** | Alpaca spot crypto cannot be shorted — short entries gated off in `run_evaluation`; cover logic retained |
| Stop-loss clamp | `trade.py` clamps stale stop limits to the fresh ask's 0.5% band edge | Replaces self-rejection that left positions exposed a full cycle (fixed 2026-06-11) |
| `data/market_research/` | Historical research log folder | `YYYY-MM-DD-HHMM-market.md` and `…-project-verification.md`, GMT+2 timestamps |

## API & Environment

| Key | Value / Detail |
|-----|----------------|
| Base URL | `https://paper-api.alpaca.markets` |
| Data URL | `https://data.alpaca.markets` |
| Bars endpoint | `/v1beta3/crypto/us/bars` |
| Snapshots endpoint | `/v1beta3/crypto/us/snapshots?symbols=...` — returns latest trade, daily bar, prev daily bar per symbol |
| API key var | `APCA_API_KEY_ID` |
| Secret var | `APCA_API_SECRET_KEY` |
| Account ID | PA3EZEE1I9RS |
| Crypto hours | 24/7 — no market clock gate |
| Critical bug (fixed) | `limit` param alone → 1 bar; must pass explicit `start` date |
| Critical bug (fixed 2026-06-11) | default sort is ascending: `start`+`limit=N` → *oldest* N bars (daily 54 d stale, regime gate inverted); must pass `sort=desc` and reverse to chronological |
| `_bars_start()` | Computes: `now − (limit × tf_minutes × 1.6)` to ensure enough history |
| Multi-symbol pagination | Bars API paginates by *total bars*, not per-symbol. Must follow `next_page_token` until `null`. |
| Dashboard Settings inputs | `#page-settings` field IDs: `setPaperApiKey` / `setPaperApiSecret` (📄 Paper), `setLiveApiKey` / `setLiveApiSecret` (🔴 Live), `setStopLoss` / `setMaxDailyLoss` / `setMaxOpenRisk` (🛡 Risk Limits), `setMaxSignalSymbols` (🔭 Signals Analysis), `watchlistAddInput` + `watchlistTagsEl` + `watchlistCountEl` (📋 Active Watchlist). Persisted to `localStorage` key `proDashboardSettings` (main settings) and `proDashboardWatchlist` (watchlist). |
| `maxSignalSymbols` | `getSettings().limits.maxSignalSymbols` — sets how many symbols the Market Signals scanner analyses. Default 30, minimum 1, **no upper clamp**. `loadMarketSignals()` uses `SCAN_SYMBOLS = universe.slice(0, n)` where `universe = usdPairsOnly(getCryptoUniverse())` (full tradable Alpaca crypto list filtered to `/USD` pairs since the 2026-07-09 v2 bugfix, no longer the 30-symbol `TOP30_SYMBOLS`), so values above 30 genuinely scan more symbols. Also caps Market Overview's row count (same setting, same filtered universe); does not affect the watchlist Signals tab. |
| `maxOpenPositions` / `maxPositionsPerTier` | `getSettings().limits.*` — user-configurable Autopilot correlation-budget caps (Settings › 🔗 Correlation Budget; inputs `setMaxOpenPositions` / `setMaxPositionsPerTier`, defaults 4 / 3, min 1). Read live each cycle by `apMaxPositions()` / `apMaxPerTier()`; replaced the old hardcoded `AP_MAX_POSITIONS` / `AP_MAX_PER_TIER` consts. Dashboard-Autopilot only — the Python eval loop uses `config.json › risk.max_open_positions` / `max_positions_per_tier`. |
| `updateScanBtnLabel()` | Sets the Market Signals scan button (`#msScanBtn`) text from `maxSignalSymbols`. Called on page init, after `saveSettings()`, and at the start of `loadMarketSignals()`. **Clamps to the real universe size** when `_cryptoUniverse` is loaded — `usdPairsOnly(_cryptoUniverse).length` since the 2026-07-09 v2 bugfix: `▶ Scan Top <universe> (all available)` when Max Symbols exceeds the tradable `/USD` pairs Alpaca offers, else `▶ Scan Top <min(n, universe)>`. Honest indicator of the active cap (2026-06-18) — the universe, not the setting, is the true ceiling. |
| USD-pair universe ceiling | Alpaca lists only ~20–33 tradable `*/USD` crypto pairs (its ~56 total pairs include USDT/USDC/BTC quotes — USDT/USDC stay in the universe for the watchlist selector but are filtered off the scan surfaces by `usdPairsOnly()` since 2026-07-09 v2; other quotes are dropped outright). So Max Symbols > ~33 can't be satisfied; the Scanner button and the Scanner + Market Overview status lines say so explicitly rather than implying more symbols exist. This is the resolution of the "only 33 scanned while setting is 60" bug — a real exchange limit, not a defect. |
| `config.json` (dashboard) | Settings store for `docs/dashboard_professional.html`, kept in the same folder. Holds `mode`, the four API key/secret fields, and a `limits` object (incl. `maxSignalSymbols`). Loaded on page open by `loadConfigFromFile()` (fetch `./config.json`), written by `saveSettings()` via `saveConfigToFile()`. Separate from the agent's top-level `config.json` (strategy/watchlist/caps). |
| `loadConfigFromFile()` | Dashboard config.json loader (load-only, seed/fallback). `fetch('./config.json')` on page open, then merge into `localStorage` where **saved localStorage values win** and config.json only fills gaps: top-level non-empty config keys seed missing fields; `merged.limits = Object.assign({}, cfg.limits, existing.limits)` so a user-saved `maxSignalSymbols` survives refresh (config.json's value applies only on a fresh browser). No save-to-file; `saveSettings()` writes `localStorage` only. |
| `docs/dashboard_layout.md` | Layout & changelog doc for both dashboards, split into **1. Professional Dashboard** and **2. Portfolio Dashboard** sections (tabs table + key features + dated changelog each). Part of the project doc-update rule: any dashboard change must add a changelog entry to the matching section. |
| TDZ init bug (fixed) | `updateScanBtnLabel()` reads `const TOP30_SYMBOLS`; calling it from the early top-level init (before that const's line) throws `Cannot access 'TOP30_SYMBOLS' before initialization`, aborting the whole script (dead scan button, Market Overview error). Fix: only call it from inside the async `bootstrapDashboard()` IIFE after `await loadConfigFromFile()`, by which time the const is initialized. |

---

## Timeframe Reference

| Alpaca TF string | Minutes | Used for |
|-----------------|---------|---------|
| `15Min` | 15 | Execution signals (MACD, RSI, BB, EMA cross) |
| `4Hour` | 240 | Primary trend filter (4H EMA cross) |
| `1Day` | 1440 | Regime detection (SMA-20 vs SMA-50) |

---

## Script Signatures

| Function | File | Purpose |
|----------|------|---------|
| `signal_score(closes, volumes, highs, lows, closes_4h)` | `indicators.py` | Returns `(score, breakdown_dict)` |
| `ema_cross_state(closes, fast=20, slow=50)` | `indicators.py` | "golden" / "death" / "neutral" |
| `atr(highs, lows, closes, period=14)` | `indicators.py` | Wilder ATR |
| `volume_ratio(volumes, period=20)` | `indicators.py` | Current / 20-bar avg |
| `should_trail_stop_out(entry, hwm, cur)` | `risk.py` | True when trailing stop fires (HWM gain ≥2.5%, current ≤ HWM×0.97) |
| `correlation_budget_allows(symbol, open_symbols)` | `risk.py` | Returns `(bool, reason)` — checks total + per-tier limits |
| `daily_drawdown_gate_triggered(day_open, current)` | `risk.py` | True if today's drawdown ≥ 3% |
| `stop_loss_limit_price(ask, cycles_open)` | `risk.py` | Limit price for stop-loss SELL; widens after 2 unfilled cycles |
| `cover_limit_price(ask, cycles_open)` | `risk.py` | Limit price for stop-loss COVER; mirrors above, price above ask |
| `get_open_orders(symbol)` | `trade.py` | Fetch pending orders for a symbol; normalises BTCUSD→BTC/USD |
| `cancel_order(order_id)` | `trade.py` | Cancel single order by ID; returns True on 200/204, no-raises on 404 |
| `place_order(..., is_stop_loss=False)` | `trade.py` | Place limit order; `is_stop_loss=True` uses wider 0.5% band |
| `load_state()` / `save_state(state)` | `position_state.py` | Load/atomically-write `data/positions_state.json` |
| `check_and_refresh_day_open(state, equity)` | `position_state.py` | Reset daily snapshot if new day; clears capital preservation mode |
| `update_high_water_mark(state, symbol, price)` | `position_state.py` | Ratchet HWM up, never down |
| `set_stop_order(state, symbol, order_id, price)` | `position_state.py` | Record a placed stop-loss order ID + limit price in state |
| `increment_stop_order_cycles(state, symbol)` | `position_state.py` | Increment + return the cycle counter for the pending stop order |
| `clear_stop_order(state, symbol)` | `position_state.py` | Null out stop_order_id + related fields (order filled or cancelled) |
| `init_position(state, symbol, entry_price)` | `position_state.py` | Called on new BUY/SHORT fill; sets entry_price, HWM, clears stop fields |
| `clear_position(state, symbol)` | `position_state.py` | Remove symbol from state (SELL/COVER fully filled) |
| `get_crypto_bars(symbol, limit, timeframe)` | `run_evaluation.py` | Fetches bars with correct start date |
| `_bars_start(limit, timeframe, buffer=1.6)` | `run_evaluation.py` | Computes start datetime string |
| `evaluate_symbol(symbol, positions, equity, buying_power)` | `run_evaluation.py` | Full eval + ATR sizing + journal write |
| `place_order(symbol, side, qty, ask)` | `trade.py` | Limit order; enforces hard rules |
| `evaluate_rebalance(symbol, pos, equity, caps_data)` | `rebalance.py` | Returns rebalance decision (HOLD/BUY/SELL) with qty, limit_price, reason |
| `append_rebalance_journal(timestamp, decisions, executed)` | `rebalance.py` | Appends `## Rebalance HH:MM GMT+2` block to daily journal |
| `computeFifoStats(activities)` | `dashboard_professional.html` | Shared FIFO realized-P&L engine. Returns `{totalPnl, wins, losses, winPnl, lossPnl, winRate, profitFactor, avgWin, avgLoss, tradeRows}`. Long-only buy→sell matching. Single source of truth for both the P&L tab (`loadPnl`) and Backtest tab (`renderBacktest` via `c.fifoStats`). **Must be fed the full paginated FILL history via `edgeFetchAllFills()` — a single 100-fill page truncates the realized total and mis-books SELLs whose matching BUY predates the window as $0 "wins" (fixed 2026-07-06). All three feeders (`loadContext`, `loadPnl`, `generateDailyJournal`) now use `edgeFetchAllFills()`.** A SELL is only counted as a realized trade when it matched a prior BUY (`matchedQty > 1e-9`); an unmatched SELL (empty FIFO queue) stays in the trade log with `pnl: null` and is excluded from win/loss stats — so it can no longer book a phantom $0 "win" (hardened 2026-07-07, aligns with `edgeFifoTrades`/`insRoundTrips`). |
| `tradingDaysPerYear` | `dashboard_professional.html` (`DEFAULT_LIMITS`) | Annualization factor for Sharpe/Sortino/Calmar and annualized volatility (`× √tradingDaysPerYear`). **Set to `365`, not 252** — crypto trades 24/7 and the portfolio-history feed returns daily calendar points, so annualization must use 365 (matches `scripts/metrics.py` `annualization_factor("1D") = 365.0`). Was `252` (equity-market convention) until 2026-07-07, which understated all annualized KPIs by √(252/365) ≈ 0.83. |

---

## Python ↔ Dashboard Parity Notes

Critical implementation details to keep `indicators.py` and `dashboard_professional.html` in sync:

| Concern | Detail |
|---------|--------|
| MACD NaN prefix | `macdLine` has NaN for indices 0–24 (ema26 only valid from index 25). Must strip NaN before calling `emaArr` for signal EMA, then re-pad to original length. Otherwise signal line = NaN always (MACD always 0). |
| Buy/half thresholds | Loosened 2026-06-19. Python: `score >= 3.5` full, `>= 2.5` (`< 3.5`) half — `strategy.buy_score_threshold` / `buy_score_half_size_threshold`. Dashboard: consts `SIGNAL_BUY_SCORE` (3.5) / `SIGNAL_HALF_SCORE` (2.5). Keep in sync. |
| EMA seeding | Both sides seed with SMA of first `period` values (not first raw value). |
| EMA dead zone | Both sides use ±0.05% band: `ema20 > ema50 * 1.0005` = golden; `< 0.9995` = death; else neutral. Applies to 15-min (Signal 1) and 4H (Signal 6). |
| Volume average | `current / avg(prev-20 bars)` — prev-20 excludes current bar: Python `volumes[-21:-1]`; JS `volumes.slice(-21,-1)`. |
| Daily regime | SMA (not EMA) for both sides. `last > SMA50 && SMA20 > SMA50` = uptrend. |

---

## Hard Rules Quick Reference

| # | Rule | Value |
|---|------|-------|
| 1 | Position cap | ≤5% of equity per symbol |
| 2 | Order type | Limit only; within 0.2% of ask |
| 3 | Long stop-loss | 4H swing low (lowest low of last 20 4H bars, ≤8% below entry) → immediate SELL; −5% fallback if no 4H data |
| 3b | Short stop-loss | +5% above entry → immediate COVER |
| 4 | TA exit (long) | Score ≤ −2 → SELL |
| 4b | TA cover (short) | Score ≥ +2 → COVER |
| 5 | Buy gate | Score ≥3.5/6 full size; ≥2.5 (<3.5) half-size (loosened 2026-06-19) |
| 5b | Short gate | Score ≤−4/6 full size; score=−3/6 half-size if R:R≥1:3; downtrend only |
| 6 | Long regime gate | Uptrend/mixed: buy ≥2.5/≥3.5. Downtrend: half-size counter-trend long only at score ≥4.0 |
| 6b | Short regime gate | Shorts ONLY in confirmed daily downtrend; blocked in uptrend/mixed |
| 7 | Sizing | ATR: qty=(equity×1%)/(ATR×1.5), cap at 5% equity |
| 8 | Order routing | All via `scripts/trade.py`; direct API calls forbidden |
| 9 | Journal | Every day, even quiet ones |
| 10 | Partial TP (2026-07-09) | +1R → sell 50%, remaining stop → breakeven (fires once per position) |
| 11 | Stale exit (2026-07-09) | Held > 48h + trail unarmed + score < 2.5 → SELL at normal band |
| 12 | Rotation (2026-07-09) | Budget full: candidate ≥ 4.0 scoring ≥ +2.0 above a weakest holding ≤ 0 → swap same cycle |
| 13 | Net R:R gate (2026-07-09) | Net of 2×25 bps fee + spread: < 1.0 block, 1.0–1.5 half-size |
| 14 | Over-budget (2026-07-09) | Positions > budget → journal warning + Command chip; optional trim (config-flagged) |

## Roadmap Terms (filed 2026-07-10 — ALL IMPLEMENTED same day, v2026-07-10.3)

| Term | Meaning |
|------|---------|
| Pyramiding | **Implemented, ships OFF** (`strategy.pyramid_enabled`). +1R/+2R adds at ½ initial risk to a *winning* position (`risk.should_pyramid()`) — Livermore / Turtle "2N adds". Trend-mode alternative to the partial-TP ladder (ADX ≥ `pyramid_adx_min` 25); stop to breakeven after each add (`mark_pyramid_add`), capped by remaining symbol-cap headroom. |
| Chandelier stop | **Implemented, ships OFF** (`risk.trail_mode="chandelier"`). Trail width = max(fixed 3%, `chandelier_atr_mult` 2.5 × ATR(4H) / price) via `risk.chandelier_trail_pct()` (Turtles' 2N exit). Watchdog-aware. |
| Conviction-scaled sizing | **Implemented, ships OFF** (`strategy.conviction_sizing_enabled`). `risk.conviction_risk_multiplier()`: 0.75× half band / 1.0× full band / 1.5× at score ≥ `conviction_high_score` (5.0) with daily+4H aligned — Druckenmiller. Replaces the legacy ×0.5 half-band halving when on. |
| Streak throttle | **Implemented, ACTIVE** (`risk.streak_throttle_enabled=true`). `risk.update_streak_throttle()`: 3 consecutive losing round-trips OR 7-day drawdown ≥ 5% → risk ×`streak_throttle_risk_factor` (0.5); releases after 2 straight winners AND drawdown < 2.5% (hysteresis; state = `streak_throttle_active` in positions_state.json) — PTJ. 7-day DD from `/v2/account/portfolio/history`. |
| Maker-first pricing | **Implemented, ships OFF** (`costs.maker_first_entries`). Entry limits rest at the bid; a 1-cycle repricing timeout cancels unfilled entry BUYs; exits/stops stay taker. `check_limit_band(limit, ask, bid=…)` accepts any limit inside the live spread (maker-safe). |
| Stop watchdog | **Implemented, ACTIVE.** `scripts/stop_watchdog.py` + `.github/workflows/watchdog.yml` (cron `*/5`): open-long exit levels only (trail from state HWM, max(swing-low, breakeven), −5% fallback), dedup against pending SELLs, orders via trade.py, journals/commits only when a stop fires. |
| Breadth gate | **Implemented, ships OFF** (`strategy.breadth_gate_enabled`). `risk.breadth_pct()`/`breadth_policy()`: ≤ `breadth_low_pct` (30%) of watchlist in daily uptrend → new entries Tier-1 only + max-positions budget halved — Weinstein at book level. |
| Measured-move target | **Implemented, ships OFF** (`strategy.measured_move_enabled`). `risk.measured_move_target()`: prior 4H swing high, or entry + 2× the 4H range height after a breakout; feeds the net-R:R reward leg when ADX ≥ `measured_move_adx_min` (25) — PTJ asymmetry. |
| `walkforward_latest.json` | Stable-named compact summary written by every `walkforward_evaluate.py` run (forward.yml fees corrected 5→25 bps 2026-07-10); the dashboard Backtest tab's `#wfBaseline` banner reads it and turns red past `walkforward.max_baseline_age_days` (45, seeded to `STRAT_CFG.wfMaxAgeDays`). |
| Session-edge filter (ON) | `strategy.session_filter_enabled=true` since 2026-07-10 (item 9) — self-guarding: penalizes only GMT+2 hour/weekday buckets with ≥ `session_min_sample` (20) round trips and negative net P&L. |
| State-persistence bug (P0) | **FIXED 2026-07-10 (v2026-07-10.2).** `data/positions_state.json` reset between runs because the workflow only committed `journal/` — every fresh Actions checkout restored the 2026-06-18 copy. Now committed every run + fill-history reconciliation (below). |

## Bug-Sweep Terms (fixed 2026-07-10, v2026-07-10.2)

| Term | Meaning |
|------|---------|
| Fill-history reconciliation | `reconcile_positions_from_fills()` (`run_evaluation.py`): FIFO walk over the full FILL activity history that rebuilds `partial_tp_done` + breakeven stop (any SELL since the last flat→long transition), backfills `entry_time_iso`, and replaces a non-positive API `avg_entry_price` with the open lots' weighted average. Makes the partial TP idempotent — a lost state file can never re-fire it. |
| Bars page cap (~7 days) | Alpaca caps one `/v1beta3/crypto/us/bars` response at roughly 7 days of bars regardless of `limit`, returning `next_page_token` (4Hour limit=120 → 43 bars, verified live 2026-07-10). `get_crypto_bars` now follows the token (≤10 pages) — the root cause of the "4H bars chronically short / 1H fallback failed" bug. |
| CADENCE WARNING | Journal warning emitted when `now − state.last_evaluation_iso` > 90 min — self-monitoring for scheduler gaps (the cron was silently every-4-hours instead of hourly). |
| `last_evaluation_iso` | New top-level key in `data/positions_state.json` — UTC timestamp of the previous evaluation, drives the CADENCE WARNING. |
| `scripts/daily_summary.py` | Closing-journal generator run by the 23:21 workflow job: `## Daily Summary` block with equity + day change vs `last_equity`, cash %, open positions, today's fills, FIFO realized P&L for round trips closed today. Replaced the second evaluation the job used to run. |
| DATA GUARD | Journal warning emitted when Alpaca's `avg_entry_price` ≤ 0 is replaced with the FIFO-derived cost basis (the SOL `$-4.4931` corruption). |
| Budget ceiling 7 | With Tier-1 = {BTC, ETH} and 5 per tier, the reachable book maximum is 2 + 5 = 7 — `risk.max_open_positions` set to 7 (was an unreachable 15); dashboard `DEFAULT_LIMITS` fallback aligned to 7/5. |

## Bug-Fix Terms (2026-07-11, v2026-07-11.1)

| Term | Meaning |
|------|---------|
| `ggLevelDate(t)` | Breakout-scanner helper (dashboard): formats a daily bar's timestamp as ` · d MMM` (GMT+2, en-GB). Used by `ggKeyLevels()` to date-stamp every 5-bar swing high/low so the 🎯 Daily Chart Key Levels panel never shows indistinguishable same-label rows ("Swing Low" ×3 — Bug #1 fixed 2026-07-11). Price-dedup (0.5%) and the 5-level cap are unchanged. |

## Hosting Fix (2026-07-19)

| Term | Meaning |
|------|---------|
| `server.js` (Trader) | Minimal Express entrypoint added 2026-07-19 — serves `docs/` statically (`GET /` → `dashboard_professional.html`) + `GET /api/health`, skips `app.listen()` under `VERCEL`/`NODE_ENV=test`. Exists only so a Vercel deployment of this repo has a valid entrypoint; does not carry any trading logic and does not change how the dashboard/engine actually run in production (GitHub Pages + GitHub Actions cron). Mirrors CryptoPro Suite's/Charts' `server.js` layout for consistency across the suite. |
