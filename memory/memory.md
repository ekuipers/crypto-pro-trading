# Project: Alpaca Trading Agent

**Status:** Active — paper trading only  
**Account:** PA3EZEE1I9RS  
**Root:** `C:\Users\ERKUIPER\OneDrive - Capgemini\015. Repos\alpaca-trading-bot\alpaca-trading-agent`  
**Owner:** Erik (the.eekman@gmail.com)  
**Timezone:** GMT+2 (Europe/Amsterdam)

---

## v2026-07-18.5 — 2026-07-18 — CryptoPro suite favicon & logo

**Change (branding, requested by Erik):** Added the shared CryptoPro suite favicon to the dashboard:
`docs/favicon.svg` (dark navy rounded square, green/red rising candlesticks, green trend line,
orange badge — this app's badge is opposing buy/sell arrows; Charts uses a line-chart badge,
Training a graduation cap) plus raster fallbacks `favicon.ico`, `favicon-32.png`,
`apple-touch-icon.png` (cairosvg). `dashboard_professional.html`: favicon `<link>` tags added to
`<head>`, header logo 📊 emoji replaced with the icon image, footer version bumped to
v2026-07-18.5. **Verified:** icon rendered at 180px and inspected visually; grepped head for links.

## What It Is

An autonomous paper crypto trading agent built on the Alpaca API. It evaluates 10 crypto symbols on a 24/7 schedule using a 6-point signal confluence system, multi-timeframe analysis (daily / 4H / 15-min), and ATR-based position sizing. All orders flow through `scripts/trade.py` which enforces hard risk rules in code.

---

## Lessons
- Never run a local `run_evaluation.py --execute` within ~25 min after the top of the hour: the GitHub cron (`23 * * * *`) often fires late (seen 17 min late 2026-07-11) and the two engines race — both entered ETH half-size 22 s apart; positions fetched at run start go stale the moment the other engine fills.

- Never edit large project files (CLAUDE.md, README.md, dashboard HTML) with the Cowork file Edit/Write tools — they can silently truncate the file; splice via python in bash from git HEAD and verify byte count + intact tail afterwards (hit again 2026-07-10 on CLAUDE.md).
- Before any evaluation/script run, sanity-check the tree: `python -m py_compile scripts/*.py` and `json.load(config.json)` — truncation hit scripts/*.py + config.json on 2026-07-10 evening and a corrupted config silently reverts gates to 4.0/3.0 with an empty watchlist.
- Self-checks and tests must pass explicit parameters — never assert against config-loaded defaults (the risk.py correlation-budget self-checks asserted the old 4-position cap and broke the moment the owner changed `config.json`; fixed 2026-07-09 by passing `max_positions=4, max_per_tier=3` explicitly).
- Before implementing anything from a "rescan roadmap"/bug request, run `git fetch origin main` and diff against `origin/main` — the automated/scheduled runs push directly to origin far more often than this local checkout gets pulled, so `git log -3` on a stale local HEAD can look current while actually being ~200 commits behind (hit 2026-07-13: a bug describing an "existing" stale-order sweep looked unimplemented locally only because the local file predated the 2026-07-08 commit that added it — the bug was real, but the fix had to be re-targeted at the real current code after `git reset --hard origin/main`, preserving the stale attempt on a backup branch first).
- Never guess a third party's official Telegram/social channel username and wire it in as a trusted source — verify it against the organization's own site or another authoritative reference first. Guessing is also low-yield: 11/11 guessed handles 500'd against the RSS-Bridge on 2026-07-13 when trying to expand Socials-tab Telegram-mirror coverage.


---

## Architecture

```
alpaca-trading-agent/
├── CLAUDE.md                    ← Agent hard rules (DO NOT OVERWRITE)
├── memory/
│   ├── memory.md                ← Single project memory + running changelog (this file)
│   └── glossary.md              ← Full decoder ring
├── config.json                  ← Central config: strategy, risk, indicators, portfolio caps, watchlist
├── scripts/
│   ├── run_evaluation.py        ← Main eval loop; run with --execute to trade
│   ├── daily_summary.py         ← 23:21 closing journal P&L summary (Bug #4 fix 2026-07-10)
│   ├── indicators.py            ← TA library: RSI, MACD, BB, ATR, EMA cross, vol ratio
│   ├── trade.py                 ← Order placement (enforces all hard rules)
│   └── verify.py                ← API smoke test
├── journal/
│   └── YYYY-MM-DD.md            ← Daily trading journals (append, never overwrite)
├── docs/
│   ├── dashboard_professional.html       ← Sole dashboard (portfolio-dashboard.html deleted 2026-06-17; see dashboard_layout.md)
│   └── dashboard_layout.md            ← Tab structure, feature notes, changelog
└── skills/
    └── crypto-trader/
        └── SKILL.md             ← Full strategy playbook (read before any trade eval)
```

---

## Schedule

| Time (GMT+2) | Task |
|-------------|------|
| Every hour :00 | Research routine for all 10 symbols |
| Every hour :23 | `run_evaluation.py --execute` — evaluate + trade |
| 23:21 daily | Closing journal entry |

---

## Scheduled Tasks (Cowork)

| Name | Cron | Status | What it does |
|------|------|--------|-------------|
| `morning-brief` | `0 7 * * *` | enabled | Runs verify.py + run_evaluation.py; writes evaluation block to journal |
| `morning-evaluation` | `0 9 * * *` | **disabled** | Daily evaluation — compute signals for all watchlist symbols and execute trades where warranted |
| `daily-journal` | `21 23 * * *` | enabled | Closing journal entry — summarise trades, P&L, and market observations |

---

## Session History

### 2026-07-18 — Bug fix: Glossary sub-tab dead-ended on "Could not load memory/glossary.md" ("rescan roadmap" trigger)

**Task:** Owner opened the newly-shipped 📖 Glossary sub-tab (previous session) and filed directly in `CLAUDE.md › Bugs`: "Could not load memory/glossary.md — the dashboard needs to be served (or the file must sit two directories as expected, ../memory/glossary.md from docs/); some browsers block file:// fetches of sibling files." — that text is literally the error message the tab itself showed. Then sent "rescan roadmap"; per rule 8 that triggers implementation, and rule 0 gives the (now-filed) bug precedence over the roadmap (which was already empty).

**Investigation:** Confirmed this is a genuine, structural limitation, not a wrong relative path: `docs/dashboard_professional.html` is designed to be opened directly via `file://` (`CLAUDE.md` workflow rule 2 explicitly forbids starting a local server), and most browsers — Chrome in particular — block `fetch()`/`XMLHttpRequest()` reads of a *different* local file from a page loaded via `file://`, with no workaround available from page script (this is a browser security policy, not a bug in the fetch call itself). The dashboard's existing `loadConfigFromFile()` already hits this same wall for `config.json`, but degrades silently (`console.info`, not a UI error) because it has a harmless fallback — browser-stored settings. The new Glossary tab had no equivalent fallback, so the *first* time this general limitation became user-visible was the tab that had no graceful degradation path. Verified the private repo can't be used as a network fallback either: `curl` confirmed general internet connectivity works from this environment (`api.github.com` → 200) but `raw.githubusercontent.com/ekuipers/alpaca-trading-agent/main/...` 404s for both `README.md` and `glossary.md` — consistent with the repo being private, so an unauthenticated raw-GitHub fetch is a dead end, and embedding a GitHub token client-side to work around it would violate the project's own secret-handling rule.

**Fix (`docs/dashboard_professional.html`):**
- Added a small built-in `GLOSSARY_FALLBACK_MD` constant: a deliberately low-churn curated subset of the real glossary — the Acronyms & Abbreviations table plus ~14 core conceptual Trading Terms (Confluence score, Wyckoff phases, Golden/Death cross, BB squeeze, Regime, Hard cap, ATR sizing, Trailing stop, HWM, Correlation budget, Tier-1 symbols, Daily drawdown gate, Short stop-loss/regime gate, Live R:R). Deliberately excludes the fast-changing dated/implementation-detail sections (function names, dashboard internals) so it won't need updating on every code change the way `memory/glossary.md` itself does.
- `loadGlossary(force)` now sets `_glossaryLive = !!md` and falls back to `GLOSSARY_FALLBACK_MD` when the live fetch returns nothing, instead of blanking the list with a red dead-end error. The status line (`#glossaryStatus`) shows "Live from memory/glossary.md" (muted) when the fetch succeeded, or a yellow explanation + ↻ Refresh prompt when showing the fallback.
- Updated the sub-tab's intro text to mention the fallback behavior.
- Bumped the footer version to `v2026-07-18.3`.

**Verified:**
1. `node -e "new Function(...)"` on the extracted `<script>` block — 0 parse errors (392,770 chars after the addition).
2. Extracted `GLOSSARY_FALLBACK_MD` + `escapeHtml`/`mdInline`/`mdTable`/`renderGlossaryMarkdown` via marker/brace-matching into a Node sandbox (script saved to the session scratchpad, not the repo) and ran the renderer against the fallback string directly: 2,586 chars of markdown → 6,090 chars of HTML, both tables (`.glossary-table`) parsed correctly, no exceptions.
3. `wc -l` (9951 → 10007) and `tail -3` confirmed the file's closing `</body></html>` is intact — no truncation.
4. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` (bug cleared, Glossary feature-table row updated), `README.md`, `docs/dashboard_layout.md`, `memory/glossary.md` (new terms below).

---

### 2026-07-18 — Roadmap: added the 📖 Glossary pane to the dashboard Command tab ("rescan roadmap" trigger)

**Task:** `CLAUDE.md › Roadmap` item 1: "Add the glossary to the dashboard by adding a pane under command center called Glossary." Bugs list was empty (rule 0 gives bugs precedence over the roadmap, but there were none open), so "rescan roadmap" (rule 8) triggered implementation of this item directly.

**Design decision:** Rather than hand-copying glossary content into the dashboard (which would drift from `memory/glossary.md` the moment either file was edited), the new sub-tab **renders the actual `memory/glossary.md` file live** — same principle as `config.json` already being fetched into the dashboard via `fetchLocalJson()`. This keeps `memory/glossary.md` as the single source of truth per the project's existing documentation-update rule.

**Implementation (`docs/dashboard_professional.html`):**
- Added a 4th sub-tab to the 🧭 Command parent tab: **📖 Glossary** (`subtab-glossary` / `subpage-glossary`), alongside Overview/News/Socials. `COMMAND_SUBS` extended to `["command-overview","news","socials","glossary"]`; `commandSubTab()` routes `"glossary"` to a new `loadGlossary()`. Deep link `#glossary` resolves via the existing `applyTabFromUrl()`/`SUBS` machinery — no changes needed there since it already concatenates `COMMAND_SUBS`.
- `fetchLocalText(paths)`: text-fetching sibling of the existing `fetchLocalJson(paths)` helper (same fallback-path-list pattern), used to read the raw markdown file.
- `loadGlossary(force)`: fetches `["../memory/glossary.md", "./memory/glossary.md", "memory/glossary.md"]` (first hit wins — `docs/` → `../memory/glossary.md` is the real path), 5-min cache (`GLOSSARY_CACHE_MS`), ↻ Refresh button forces a re-read. Shows a clear error message (not a silent blank tab) if every path 404s or the browser blocks the `file://` fetch.
- `renderGlossaryMarkdown(md)` / `mdTable(rows)` / `mdInline(escaped)`: a deliberately tiny markdown-subset renderer covering exactly what `glossary.md` uses — `#`/`##`/`###` headers, `| … |` tables (drops the `---|---` separator row), `**bold**`, `` `code` ``, and `---` horizontal rules. Everything is HTML-escaped first (`escapeHtml`) then the inline markdown patterns are applied on the escaped text, so the renderer can't be used to inject arbitrary HTML even if the file content changes unexpectedly.
- `filterGlossary()`: a search box (`#glossarySearch`) hides table rows and paragraphs whose lowercased text doesn't contain the query; section headers are never hidden so the document structure stays legible even mid-search.
- Added `.glossary-h` / `.glossary-p` / `.glossary-table` CSS (reusing the existing `.table-wrap` scroll wrapper and `--text`/`--muted`/`--border` theme tokens — no new colors introduced).
- Bumped the footer version to `v2026-07-18.2`.

**Verified:**
1. `node -e "new Function(...)"` on the extracted `<script>` block — 0 parse errors (388,899 chars, unchanged approach from prior sessions' truncation-safety check).
2. Extracted just `escapeHtml`/`mdInline`/`mdTable`/`renderGlossaryMarkdown` via brace-matching (same technique as `tests/test_socials_fetch.js`) and ran `renderGlossaryMarkdown()` against the **real** `memory/glossary.md` (525 lines) in a Node sandbox: 169,811 chars of output, all 29 markdown tables parsed into `<table class="glossary-table">`, headers and `---` rules present, no exceptions.
3. `wc -l` before/after (9797 → 9951 lines) and `tail -5` confirmed the file's closing `</body></html>` is intact — no truncation (the exact failure mode flagged in the Lessons section below).
4. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` (roadmap item moved to "none open", Command tab row + new Glossary row added to the feature table), `README.md` (Dashboard section: sub-tab list, hash-routing sentence, new bullet), `docs/dashboard_layout.md` (tab count line, `COMMAND_SUBS` mention, Command tab row), `memory/glossary.md` (new term entries below).

---

### 2026-07-18 — Bug fix: manual trade-ticket dialog didn't honor the max portfolio cap ("rescan roadmap" trigger)

**Task:** Owner filed directly in `CLAUDE.md › Bugs`: "When scanning the markets and the user executes an order, a dialog is shown to enter the order. However, the dialog isn't honoring the max. portfolio cap so the user can enter values over the cap resulting in a STOP trading permission block." Then sent "rescan roadmap" — per Workflow rule 8 this triggers implementation, and rule 0 gives the bugs list precedence over the (empty) roadmap.

**Investigation:** `docs/dashboard_professional.html`'s manual Execute Paper Trade dialog (`openTradeModal()` → `submitPaperTrade()`) is the shared trade ticket used from the Signals tab, Market Overview, Scanner, and Scalping tab. `submitPaperTrade()` only validated `symbol` present, `qty > 0`, and `limitPrice > 0` before posting straight to `/v2/orders` — no check against `PORTFOLIO_CAPS`/`portCapFor()` at all, unlike `scripts/trade.py`, which enforces the per-symbol cap in code for every automated order. A user could enter a BUY qty that pushed a position well past its cap (e.g. LINK/USD's 5%), submit it, and only discover the problem when the Command tab's live hard-rules panel flipped to a red **STOP** trading-permission status afterward — by which point the over-cap order had already filled.

**Fix (`docs/dashboard_professional.html`):**
- Added `tradeCapProjection(symbol, side, qty, price)`: reads the symbol's existing position from `window._lastPositions`/equity from `window._lastEquity` (already cached by `loadDashboard()`), projects the post-order notional (existing ± this order, direction-aware for buy vs. sell/reduce), and compares it to `portCapFor(symbol) × equity`.
- `updateTradeSummary()` (fires on every keystroke in the ticket) now renders a live cap-check line in a new `#tradeCapWarning` div — green/neutral when within cap, red with the exact max-additional-qty allowed when it would breach the cap.
- `submitPaperTrade()` now calls the same projection for BUY orders and **blocks submission outright** with a detailed alert (cap %, existing notional, projected notional, max additional qty at that price) if it would breach the cap — mirroring `trade.py`'s hard enforcement, but client-side and pre-submission instead of discovered after the fact. SELL/COVER orders (which reduce exposure) are never blocked by this check.

**Verified:** `node -e "..."` extracted and ran every inline `<script>` block through `new Function()` — 1 block, parses with 0 errors. No Python changes, so the existing 171/171 pytest suite is unaffected. Did not start the local dashboard/node server per Workflow rule 2.

**Docs:** `CLAUDE.md` bugs list cleared, `README.md` (Risk Rules bullet — note: `README.md` was independently reset to an older revision by the user's IDE mid-session; per instruction this was left as-is and the new bullet was appended to the current, simpler file rather than restoring the pre-reset version), `docs/dashboard_layout.md` changelog.

---

### 2026-07-18 — Bug #7: Python never cleared stale per-symbol state on a stop-loss-type full close (dashboard Autopilot already did this correctly)

**Task:** Follow-up to the Bug #6 fix (below): owner asked to check consistency between `scripts/*.py` and the dashboard Autopilot's buy/sell order logic. Direct code comparison surfaced a second, independent defect in the same failure family.

**Investigation:**
- Live-queried `/v2/positions` — the account currently holds **only BTC/USD**. Yet `data/positions_state.json` still carried `partial_tp_done: true` (with a stale `breakeven_stop` at or near the old entry price) for **8 fully-closed symbols**: BAT, CRV, SOL, AAVE, LTC, ETH, DOT, LINK.
- Root cause, found by direct code reading (`scripts/run_evaluation.py`): `ps.clear_position()` — which resets `partial_tp_done`/`breakeven_stop`/`stop_order_id`/etc. — is only called from two places: (1) inside the "position still held" branch, when a tracked `stop_order_id` is found to be filled/gone (requires the symbol to *still* appear in `position_by_symbol` that same cycle — i.e., a partial fill scenario, not a full close); (2) immediately after submitting a **non-stop-loss TA exit** (`elif d["action"] in ("SELL","COVER") and not is_stop_loss: ps.clear_position(...)`). Every **stop-loss-type** full exit (swing-low stop, trailing stop, breakeven-after-partial-TP — anything with `is_stop_loss=True`) only calls `ps.set_stop_order()`, never `clear_position()`. Once that exit fully closes the position, the symbol drops out of `position_by_symbol` on the *next* cycle, so the branch that would eventually clear it is never reached again — the stale flags persist forever, waiting to be misapplied to the next unrelated position opened for that symbol (this is what made the LTC/USD 2026-07-17 incident's "breakeven $45.8120" not even match that trade's real entry of $45.9060 — it was carried over from an earlier, unrelated LTC round trip).
- Compared against the dashboard: `docs/dashboard_professional.html`'s Autopilot **already implements the correct behavior** — every cycle it prunes `hwm`/`partialTp`/`entryTime` for any symbol not in `heldSyms` (`Object.keys(hwm).forEach(k => { if (!heldSyms.includes(k)) delete hwm[k]; })`, mirrored for the other two maps). Python had no equivalent pass.

**Fix (`scripts/run_evaluation.py`):** added `prune_stale_position_state(state, open_symbols)` — clears `ps.clear_position()` for every symbol in `state["positions"]` not present in the current cycle's live `open_symbols`. Called once in `main()`, right after the live positions fetch and `open_symbols` list are built (before reconciliation and per-symbol decisions run). Mirrors the dashboard's `heldSyms` prune exactly.

**Verified:** `tests/test_reconcile.py::TestPruneStaleState` (2 new tests: a closed symbol's state is cleared, a still-held symbol's state is untouched). Full suite: 171/171 pass. Also **applied the fix to the live `data/positions_state.json`** directly (ran `prune_stale_position_state` against the real file with the real live position list `["BTC/USD"]`) rather than waiting for the next scheduled run — removed the 8 stale entries (113 lines), leaving only `BTC/USD`.

**Not changed:** did not touch the dashboard — its behavior was already correct and was the reference implementation for this fix.

---

### 2026-07-18 — Bug #6: fee-residue false partial-TP reconciliation caused fast, mostly-losing buy→sell round trips

**Task:** Owner reported "buy orders are followed up with sell orders way too fast, resulting in negative profit most of the trades" and asked for an analysis using the journal + execution history. Per Workflow rule 0 the finding became a bugs-list item and was fixed immediately.

**Investigation:** Spawned the `market-researcher` agent to pull the full live paper-account FIFO fill history (`edgeFetchAllFills()`-style pagination, not a single 100-fill page) and cross-reference every SELL against its stated journal exit reason. Findings, verified directly against the code afterward:

- Of the last 9 SELL decisions logged since 2026-07-11, 8 (89%) were labeled `STOP-LOSS (breakeven after partial TP)` — and every one closed ~99.8–100% of the position, not the 50% scale-out the label implies. The real `should_partial_tp()` path hasn't legitimately fired since 2026-07-10.
- Aggregate live paper P&L: 276 FIFO round trips, 47.8% win rate, profit factor 0.29, **-$6,614.67 realized**.
- Root cause: `reconcile_positions_from_fills()` (`scripts/run_evaluation.py`) rebuilds `partial_tp_done` from Alpaca's own fill history when state is lost, by FIFO-walking BUY/SELL fills and checking `if lot[0] < 1e-6` to decide a lot fully closed. Alpaca paper SELL fills consistently return qty ~0.1–0.25% *smaller* than the matching BUY (fee/precision rounding — confirmed across 15 symbols, e.g. the 2026-07-17 LTC/USD round trip: buy 59.693 @ $45.9060, sell 59.5616754 @ $44.9684, a 0.22% short-fill). That residual is far above the old absolute epsilon, so a fully-closed lot never popped to empty, and the per-symbol `sells_since_start` counter (meant to detect a genuine scale-out) kept incrementing forever across every historical round trip instead of resetting on a real full close.
- Consequence: every brand-new position for a previously-traded symbol saw a stale non-zero `sells_since_start` on its very first post-entry evaluation, triggered `mark_partial_tp()`, and pinned `breakeven_stop = entry` immediately — before any real profit. `eff_stop = max(swing_stop, breakeven)` then picked the tight breakeven price over the intended TA swing-low stop (up to 8% of room), so ordinary volatility took the position out within hours of entry, mislabeled as a "breakeven" exit even when the fill landed materially below entry (spread/band + price drift during the exit's own cycle).

**Fix (`scripts/run_evaluation.py`, `reconcile_positions_from_fills`):** lots now carry their original quantity (`[remaining, price, original_qty]`); the "fully closed" check compares the leftover against `max(1e-9, original_qty * _RECONCILE_DUST_REL_TOL)` (0.5% relative tolerance — 2x the largest observed ~0.25% fee residual) instead of an absolute `1e-6`. A full close now correctly zeroes the lot queue and resets `sells_since_start`/`start_iso`; a genuine ~50% partial sell still leaves well above the dust threshold and is still correctly detected.

**Verified:** Added `tests/test_reconcile.py::TestPartialTpIdempotency::test_fee_mismatched_full_close_not_counted_as_partial`, replaying the exact real LTC/USD figures above — asserts a fresh position after that fee-mismatched full close does NOT reconcile as partial-TP-done. Full suite: `python -m pytest tests/` → 169/169 pass (10/10 in `test_reconcile.py`).

**Not changed (scoped out):** did not add a stricter "sell must be ~`partial_tp_fraction` of position" check on top of the dust fix — the dust fix alone removes the false accumulation that was the confirmed cause; adding fraction-matching now would be speculative hardening without an observed failure mode to justify it.

---

### 2026-07-13 — Bug: Socials tab Twitter/X feeds still not fetched — investigated, confirmed platform limitation, added unit tests (v2026-07-13.2)

**Task:** "rescan roadmap." Per Workflow rule 0 the bugs list took precedence. `git fetch origin main` confirmed the local checkout was already current (no divergence this time — see the `[[Lessons]]` entry below about always checking first).

**Bug as filed:** "In the news section under command center, Twitter aka X feeds are still not fetched. Find a way to get the relevant twitter feeds. Unit test fetching data from twitter." The actual Twitter/X sourcing lives in the **🐦 Socials sub-tab** (not News — News is headlines/RSS only), built 2026-07-09 and last touched 2026-07-10 (v2026-07-10.1: Telegram-mirror-first sourcing + feed-title validation guard).

**Investigation (live, this session):**
- X's own syndication CDN (`cdn.syndication.twimg.com/timeline/profile`) answers with `Access-Control-Allow-Origin: https://platform.twitter.com` — locked to Twitter's own embed widget origin, unusable from any other site regardless of request headers. No keyless direct-X path exists.
- Re-tested **8 public Nitter mirrors** (the full RSS-enabled list from the status.d420.de tracker: xcancel.com, nitter.poast.org, nitter.net, nitter.privacyredirect.com, nitter.tiekoetter.com, lightbrd.com, nuku.trabun.org, nitter.space) through the same `rss2json.com` bridge the dashboard uses — **all 8 are dead**: connection failures, HTTP errors, or (xcancel only) the fake "RSS reader not yet whitelisted!" 200-OK feed that the 2026-07-10 title-verification guard already correctly rejects. This is a **regression from "best-effort, sometimes works"** (2026-07-10 assessment) to **fully non-functional** as of today.
- Re-verified the 4 existing Telegram-mirror accounts (`binance_announcements`, `WatcherGuru`, `whale_alert_io`, `cointelegraph`) via the RSS-Bridge — all 4 still return HTTP 200 with correctly-titled feeds. These remain the only real working source.
- Attempted to expand Telegram-mirror coverage to the other 10 curated accounts by guessing likely official channel usernames (`cz_binance`, `coinbase`, `VitalikButerin`, `saylor`, `justinsuntron`, `BitcoinMagazine`, `APompliano`, `ErikVoorhees`, `novogratz`, `MicroStrategy`, `tron_foundation`) — **every guess 500'd** on the RSS-Bridge (channel doesn't exist under that name). A `WebSearch` for Bitcoin Magazine's Telegram turned up two plausible handles (`Bitcoin_Magazine`, `bitcoinmagazinetelegram`) that both resolve, but neither could be confirmed as *official* against bitcoinmagazine.com's own social links — **not added**, since surfacing an unverified channel as an "official" source on a defensive-input feature is a worse outcome than leaving it out. Individual crypto figures (Elon, Vitalik, CZ, Saylor, Voorhees, Novogratz, Pompliano) do not appear to run official Telegram channels at all — Telegram announcement channels are mostly an org pattern (exchanges, media, projects), not a personal-account pattern.

**Conclusion: this is a confirmed external platform limitation, not a code defect.** There is no keyless, client-side way to fetch X/Twitter content today beyond what's already implemented. No further "fix" is coded — implementing a workaround would mean adding a paid API (X API, or a paid RSS/proxy service), which is a cost/architecture decision for the owner, not something to add silently.

**What was actually delivered this session:**
1. `docs/dashboard_professional.html`: `SOC_NITTER_HOSTS` comment rewritten from "best-effort... rarely yields posts" to state the confirmed-dead status and today's date plainly (so a future session doesn't have to re-derive this from scratch). Socials empty-state copy updated to say the Nitter ecosystem is confirmed dead rather than implying occasional success.
2. **`tests/test_socials_fetch.js`** (new) — a standalone Node test harness (`node:test` + `node:assert` + `node:vm`, no npm dependency, no network) satisfying the "unit test fetching data from twitter" part of the bug. It extracts `socFetchAccount()`, `socCleanText()`, `socToXUrl()`, `socTgFeedUrl()`, and their consts **directly from the live HTML file's source text** (bracket-matching extraction, not a reimplementation) so the test can never silently drift from production behaviour, then runs them against mocked `fetch` responses covering: a successful Telegram-mirror fetch with retweet + media-only-post filtering, the fake-"whitelisted"-feed rejection (regression test for the 2026-07-10 bug — this is the scenario that previously rendered garbage as real tweets), a genuinely-working Nitter mirror (URL rewritten to x.com, `#m` stripped), the crypto-keyword filter for generalist accounts, and total-source-failure error messaging. Run with `node tests/test_socials_fetch.js` — 7/7 pass.
3. Footer bumped to `v2026-07-13.2`.

**Verified:** `node tests/test_socials_fetch.js` (7/7 pass), `node --check` on the extracted inline `<script>` (0 errors), `<div>`/`</div>` balance 535/535 unchanged. Did not start the local dashboard/node server per Workflow rule 2.

---

### 2026-07-13 — Bug: Autopilot stale-entry sweep needed a real 4h floor + Roadmap: Execution tab order filters (v2026-07-13.1)

**Task:** "rescan roadmap." Per Workflow rule 0 the bugs list took precedence, so the stale-entry bug was implemented first, then the Execution-filters roadmap item.

**Important process note — local checkout was ~200 commits behind origin/main.** The local working directory's `git log` showed a HEAD from 2026-06-22, but `git fetch` revealed origin/main had moved on through 2026-07-13 with ~200 commits of scheduled/manual work (autopilot hardening, famous-trader package, news/socials tabs, etc.) that had never been pulled locally. The user had hand-edited the local (stale) `CLAUDE.md` to add the two Roadmap/Bugs items being actioned this session — a reasonable workflow (edit CLAUDE.md, then say "rescan roadmap"), but against a copy of the file that didn't reflect ~3 weeks of upstream history. A first implementation pass was done against that stale base and committed locally; pushing failed (`! [rejected] ... fetch first`), and `git pull --rebase` produced conflicts across every doc + the dashboard. Rather than resolve conflicts blind, the stale local commit was preserved on branch `backup-local-stale-work` and `git reset --hard origin/main` brought the working tree to the real current state, followed by re-reading the current `CLAUDE.md`/dashboard code and re-implementing both fixes against it (this entry describes the real, re-based implementation — the stale first pass never reached origin and can be ignored/deleted).

**Bug — stale-entry sweep could cancel an entry after ~15 minutes.** The Autopilot's stale-entry sweep (added 2026-07-08, `docs/dashboard_professional.html`, inside `apCycle()`) gated cancellation of unfilled, Autopilot-tagged (`client_order_id` starting `ap-`) entry limit orders on the `orderAge` cycle counter: `if (... || orderAge[o.id] <= 1) continue;` — meaning an order was eligible for cancellation as soon as it had survived past its 2nd cycle. At the fastest Autopilot interval (15 min) that could fire in as little as ~15–30 minutes, not a fair chance for a limit order to fill.

**Fix:**
- `config.json › risk`: added `"min_stale_entry_age_hours": 4`.
- `docs/dashboard_professional.html`: `STRAT_CFG` gained `minStaleEntryAgeHours: 4` (seeded from the new config key via `seedStrategyConfig()`, same pattern as every other `STRAT_CFG` threshold). The sweep's entry-cancellation condition now computes `ageMs = Date.now() - new Date(o.created_at).getTime()` and only cancels once `ageMs >= STRAT_CFG.minStaleEntryAgeHours * 3600000` — real wall-clock time instead of the cycle counter. The `orderAge` map itself, and its use for the separate exit-order cancel-replace escalation (2 cycles, protects an unprotected position — intentionally fast, left unchanged), were not touched.

**Roadmap — Execution tab order filters.** Added a filter bar above the 🎯 Execution tab's Recent Orders table: Symbol / Type / Side / Status `<select>` controls plus a Reset button and a "Showing X of Y orders" counter.
- HTML: 4 `<select>` filters + Reset button inserted above the existing orders table (which already had a Total (USD) column from the 2026-07-09 roadmap work).
- JS: `_lastExecutionCtx` caches the last-loaded context so filtering never refetches. `populateExecutionFilters(orders)` fills the Symbol/Type/Status dropdowns from the distinct values actually present in the loaded orders (Side is static Buy/Sell), preserving the current selection across refreshes. `applyExecutionFilters()` filters `c.allOrders` by the four criteria and re-renders `executionOrdersBody` (row markup unchanged, including the Total column). `resetExecutionFilters()` clears all four back to "All". `renderExecution(c)` now stores `c` and calls `populateExecutionFilters` + `applyExecutionFilters` instead of rendering the full unfiltered list directly.

**Verified:** extracted the largest inline `<script>` from the real (post-reset) dashboard and ran `node --check` (0 syntax errors) after both changes. Checked `<div>`/`</div>` balance for the `page-execution` block (7/7) and the whole document (535/535). `python -c "import json; json.load(...)"` on the `config.json` edit. Did not start the local dashboard/node server per Workflow rule 2 — verification was static (syntax + markup balance + JSON validity), not a live browser check. `pytest` was unavailable in this shell (no module found) so the Python suite wasn't re-run — the change is dashboard/config-only and no Python code reads the new `min_stale_entry_age_hours` key yet.

**Docs:** CLAUDE.md's Autopilot row updated (stale-order lifecycle description) and a new 🎯 Execution tab row added to the dashboard feature table; Roadmap/Bugs sections were already empty on the real `CLAUDE.md` (both items existed only as the user's uncommitted local edit against the stale checkout, never as committed content) so nothing needed clearing. README.md gained an Execution-tab-filters bullet and an updated Autopilot-hardening bullet. `memory/glossary.md` gained a `2026-07-13` terms section. `docs/dashboard_layout.md` Command + Execution rows updated and a changelog row added. Footer bumped to `2026-07-13` / `v2026-07-13.1`.

### 2026-07-10 — Rescan roadmap: famous-trader package, all 10 audit items + item 11 v2 (v2026-07-10.3)

**Task:** rescan roadmap (second pass of the day). Bugs list empty; implemented all 10 audit items plus the owner's re-added item 11 v2. **Deployment posture:** entry-affecting features ship config-flagged **OFF** pending walk-forward validation (`strategy.pyramid_enabled`, `risk.trail_mode`, `strategy.conviction_sizing_enabled`, `strategy.measured_move_enabled`, `strategy.breadth_gate_enabled`, `costs.maker_first_entries`); defensive machinery is ON (streak throttle, stop watchdog, session filter, baseline staleness warning).

**risk.py** — third-stage config loader `_load_risk_cfg3()` (20 new keys) + pure helpers: `chandelier_trail_pct()` (item 2 — max(fixed 3%, k×ATR4H/price)), `conviction_risk_multiplier()` (item 3 — 0.75/1.0/1.5× by score band, 1.5× requires daily+4H alignment), `update_streak_throttle()` + `consecutive_losses/wins_tail()` + `rolling_drawdown_pct()` (item 4 — trigger: 3 straight losing round-trips OR 7-day DD ≥ 5%; release: 2 straight winners AND DD < 2.5% — conservative hysteresis, stricter than the spec's "or", deliberate), `measured_move_target()` (item 5 — prior 4H swing high, else entry + 2× range height), `pyramid_trigger_price()`/`should_pyramid()` (item 1 — +1R/+2R tranches, ADX ≥ 25, score ≥ full gate), `breadth_pct()`/`breadth_policy()` (item 10 — ≤30% uptrend breadth → Tier-1 only + budget halved). `check_limit_band()` gained a `bid` param: any limit inside the live spread is accepted (maker-safe, item 6); `trade.py` passes the bid.

**run_evaluation.py** — one shared fills fetch feeds reconciliation + session filter + throttle (`_fifo_round_trips()` extracted; `_compute_session_penalty()` refactored to consume it); `_seven_day_drawdown()` reads `/v2/account/portfolio/history`; `_THROTTLE_ACTIVE` module flag persists as `streak_throttle_active` in the state file and halves entry risk with a journal warning. `compute_entry_qty()` gained `risk_mult` (hard cap never scaled). Entry path: conviction multiplier (skips the legacy ×0.5 half-band halving when enabled), measured-move target feeding `net_rr` when ADX ≥ 25, maker-first limit at the bid + a 1-cycle stale-entry-BUY sweep (only when the flag is on — it cancels non-position BUY limits; caveat for manual orders documented). Held-long path: trend/chop mode split (pyramid enabled + ADX ≥ `pyramid_adx_min` → pyramiding replaces the partial-TP ladder), pyramid adds sized at half risk × throttle, capped by remaining symbol-cap headroom, executed as BUY with `is_pyramid` → `ps.mark_pyramid_add()` (never `init_position`, which would reset HWM/entry clock) + breakeven stop; chandelier trail width when `trail_mode="chandelier"`; the breakeven eff-stop now reads `breakeven_stop` unconditionally (set only by partial-TP/pyramid flows — behavior identical for existing states). Post-pass breadth gate demotes non-Tier-1 new-entry BUYs with a journal warning.

**position_state.py** — `pyramid_tranches` per position, `streak_throttle_active` top-level, `mark_pyramid_add()`.

**Item 7 — `scripts/stop_watchdog.py` + `.github/workflows/watchdog.yml`** (cron `*/5 * * * *`, same concurrency group as the bot, `pip install requests` only — the import chain is pure-Python + requests): checks ONLY open-long exits (trailing from the state HWM — the watchdog never ratchets the HWM, that stays the hourly engine's job; max(swing-low, breakeven); fixed −5% fallback; chandelier-aware), dedups against any pending SELL, orders via `trade.py` (`is_stop_loss=True`), records `set_stop_order` so the hourly dedup/escalation sees it, journals + commits **only when a stop fires** (quiet runs = zero repo churn). Note: GH cron is best-effort (5–15 min real cadence) and ~288 runs/day consumes Actions minutes on private repos.

**Item 8** — `forward.yml` fee corrected 5 → 25 bps (it was silently overstating edge; the daily reports were NOT stale — the audit's 2026-05-14 claim was outdated, reports land daily via forward.yml); `write_reports()` now also writes the stable-named compact `reports/walkforward_latest.json`; dashboard Backtest tab gained `#wfBaseline` + `loadWalkforwardBaseline()` (fetches `../reports/walkforward_latest.json`, shows date/fees/avg-Sharpe per TF, red when older than `walkforward.max_baseline_age_days` 45, seeded into `STRAT_CFG.wfMaxAgeDays`). The fresh 25-bps baseline could not run locally (32-bit Python — no pandas wheel); it lands with the next forward.yml run (daily 04:08 UTC, or manual dispatch).

**Item 9** — `strategy.session_filter_enabled` → **true** (config + dashboard STRAT_CFG default). Safe by construction: a bucket needs ≥ `session_min_sample` (20) round trips AND negative net P&L before any penalty, so with thin history the filter is a no-op that arms itself as data accumulates.

**Item 11 v2 (dashboard, v2026-07-10.3)** — the owner re-added item 11 with sharper wording: controls above the **trade-permission indicator** (the big status word), not just above the permission panel (the v2026-07-10.2 reading). The control row (`#apToggleBtn`, `#apInterval`, kill switch, `#apStatus`) now sits at the very top of Command › Overview above `#tradingStatus`; the permission grid returned to its original spot; the 🤖 Autopilot panel at the bottom keeps only the description + activity log. Element IDs unchanged → zero JS changes. Verified: JS parse, unique IDs, DOM order buttons < status < permissions < log, div-balance parity with HEAD.

**Verified:** 168 pytest tests pass (27 new in `tests/test_risk_roadmap.py`: chandelier, conviction bands, throttle state machine incl. hysteresis, rolling DD, measured move, pyramid triggers +1R/+2R/max-tranches/gates, breadth pct+policy, maker-safe band); `python scripts/risk.py` self-checks pass; module-import smoke test confirms flag states (throttle ON, session ON, pyramid OFF, trail fixed); dashboard `new Function()` parse OK. Docs updated ×5. Footer → v2026-07-10.3.

### 2026-07-10 — Rescan roadmap: all 5 audit bugs fixed + roadmap item 11 (v2026-07-10.2)

**Task:** rescan roadmap. Per workflow rule 0 the 5 bugs from the same-day profit-maximization audit took preference; roadmap item 11 (the only item with no dependencies) shipped alongside. Roadmap items 1–10 remain open — now unblocked, but each needs walk-forward validation before enabling.

**Bug #1 (P0 — state never persisted).** Root cause confirmed in `.github/workflows/trade.yml`: the commit step ran `git add journal/` only, so `data/positions_state.json` was never committed and every fresh Actions checkout reset it to the 2026-06-18 copy (frozen `day_open_date=2026-06-11`). Two-part fix: (a) both workflow jobs now `git add journal/ data/positions_state.json`; (b) defense in depth — new `reconcile_positions_from_fills()` in `run_evaluation.py` rebuilds lost per-position facts from Alpaca's own FILL history (FIFO walk per symbol): any SELL since the position's last flat→long transition restores `partial_tp_done` + breakeven stop (idempotency — the AAVE 6×-re-fire can never happen again even if the file is lost), `entry_time_iso` is backfilled from the transition (stale-exit clock), and `entry_price` is seeded. Runs only when something is missing/corrupt; one paginated fills fetch.

**Bug #2 (P1 — 4H bars short).** Root-caused live: Alpaca now caps a single bars response at ~7 days regardless of `limit` and returns `next_page_token` (probe: 4Hour limit=120 → 43 bars; 1Hour limit=480 → 169 — exactly the journal symptoms, and why the 1H fallback also failed). `get_crypto_bars` now follows `next_page_token` (≤10 pages) until `limit` bars are collected, then slices newest-`limit` and reverses to chronological. Verified live post-fix: 4Hour → 120 bars, 1Hour → 480, 1Day → 90, chronological order intact.

**Bug #3 (P1 — corrupt cost basis).** Guarded in the same reconciliation: when the API `avg_entry_price` ≤ 0 (SOL `$-4.4931` case — Alpaca after repeated partial sells), it is replaced with the FIFO-derived weighted average of the still-open lots and a `DATA GUARD` warning is journaled. All downstream logic (stops, partial TP, stale exit, P&L%) inherits the corrected basis.

**Bug #4 (P1 — cadence).** The cron was `7 */4 * * *` (every 4 hours — matches the observed 5–7 evals/day), not hourly. Fixed to `23 * * * *` (+ the schedule-match `if` condition). Cadence self-monitoring: `run_evaluation` stores `last_evaluation_iso` in the state file (new key, also in `_EMPTY_STATE`) and journals a `CADENCE WARNING` when the gap exceeds 90 minutes. The 23:21 job previously ran a second evaluation (why "daily summary" commits had no P&L); it now runs the new `scripts/daily_summary.py`, which appends a `## Daily Summary HH:MM GMT+2` block: equity + day change vs `last_equity`, cash %, open positions with unrealized P&L, today's fills (GMT+2), and FIFO realized P&L for round trips closed today (same matching rule as the dashboard Edge/P&L tabs — unmatched SELLs excluded).

**Bug #5 (P2 — budget config).** `risk.max_open_positions` 15 → **7** (the reachable ceiling: Tier-1 holds only BTC+ETH, so 2 + 5-per-tier caps the book at 7); `max_positions_per_tier` stays 5. Dashboard `DEFAULT_LIMITS` fallback aligned 4/3 → 7/5. CLAUDE.md hard-rules row updated (saved Settings in `localStorage` still win over defaults, unchanged).

**Roadmap item 11 (dashboard, v2026-07-10.2):** the 🤖 Autopilot panel `<section>` (toggle, interval, ⛔ kill switch, activity log) moved above the 🚦 Trading Permission Rules / 📌 Hard Rules `grid-2` section in the Command › Overview sub-tab — controls always in sight, log at the bottom of the panel as before. Pure block move; div balance verified identical to git HEAD (27/28 with the same slice bounds), JS parses (node `new Function`), footer bumped to v2026-07-10.2.

**Verified:** 141 pytest tests pass (11 new: `tests/test_reconcile.py` — partial-TP idempotency incl. no-refetch when state is intact, entry-price guard, entry-clock backfill, shorts ignored, daily-summary FIFO; `tests/test_bars_fetch.py` — pagination follows the token, stops at `limit`); `py_compile` clean; live probes of the paginated fetch (above). Local `.env` has no Alpaca keys (they exist only as GitHub secrets), so trading-API paths were verified via the mocked tests; the market-data path was verified live keyless. Docs updated: CLAUDE.md (Bugs cleared per rule 3, roadmap preamble + item 11 removed, correlation-budget row, responsibilities/cadence, Command row), README.md (Roadmap + key features), glossary.md, dashboard_layout.md.

### 2026-07-10 — Profit-maximization audit: 10 roadmap items + 5 bugs filed (no code changes)

**Task (owner):** analyse structure, strategies and profits; mimic famous traders' behaviours; file improvements to the Roadmap and faulty parts to Bugs *before* implementing.

**Audit findings (evidence in journals/git):**
- **P0 bug — position state never persists between runs.** `data/positions_state.json` frozen at `day_open_date=2026-06-11` (last committed 2026-06-18) while journals commit every evaluation. Behavioral proof: AAVE/USD's +1R partial TP re-fired on 6 consecutive evaluations (2026-07-09 15:29 → 2026-07-10 07:46), each selling "50%" of the remainder (6.54 → 0.05 AAVE) — the flag `partial_tp_done` is read from a state file that resets every run. Also silently broken: trailing-stop HWM persistence, breakeven stops, stale-exit entry clocks, daily-drawdown gate (compares to 2026-06-11's $95,428). Code itself is correct (`run_evaluation.py` calls `ps.mark_partial_tp`/`ps.save_state`); the runner's git sync likely discards/never commits the file.
- **P1 — 4H bars chronically short** (43–50 < 51 required) for BTC/ADA/AAVE with the 1H fallback also failing → Signal 6 = 0 and stops degraded to fixed −5% on the highest-cap symbols.
- **P1 — corrupt cost basis** in journal output: `SOL/USD HOLD 29.5132 @ $-4.4931 (-1842.96%)`.
- **P1 — cadence gap:** no hourly `Research` blocks since 2026-05-21; only 5–7 evaluations/day instead of 24; the 23:21 closing journal writes no P&L summary.
- **P2 — config inconsistency:** `risk.max_open_positions=15` unreachable with `max_positions_per_tier=5` (2 Tier-1 symbols → ceiling 7); CLAUDE.md hard-rules table still says 4/3.
- Walk-forward baseline stale (2026-05-14, pre-dates the 2026-06-19 loosening and the 2026-07-09 economics package).

**Roadmap filed (CLAUDE.md › Roadmap, 10 items):** (1) pyramid into winners in strong 4H trends (Livermore/Turtle 2N adds/Druckenmiller; mutually exclusive with the partial-TP ladder per position, trend vs chop by ADX 25); (2) Chandelier ATR-adaptive trail (Turtles); (3) conviction-scaled sizing 0.75/1.0/1.5% by score (Druckenmiller/PTJ); (4) losing-streak + 7-day-drawdown throttle (PTJ); (5) trend-based measured-move targets + walk-forward test `min_rr_full` 1.5→2.0 (PTJ asymmetry); (6) maker-first entry pricing (cut ~50 bps round trip); (7) 5-min stop-loss watchdog script; (8) monthly walk-forward re-baseline + dashboard staleness warning; (9) enable session-edge filter once sampled; (10) portfolio breadth/regime gate (Weinstein). Items 1–5 depend on Bugs #1/#4 being fixed first — noted in the roadmap preamble.

**Docs updated:** CLAUDE.md (Roadmap + Bugs), README.md (Roadmap section), this file, glossary.md (new terms). No code changed; no dashboard change (dashboard_layout.md untouched per its rule). **Process note:** the file-tool truncation bug hit CLAUDE.md during the edit (70,870 → truncated mid-file at identical byte count); recovered by splicing HEAD + new sections via python in bash — lesson added above.

### 2026-07-10 — Bugfix: Socials sub-tab "RSS reader not yet whitelisted!" (v2026-07-10.1)

**Bug (CLAUDE.md › Bugs #1):** the Socials tab couldn't load tweets and surfaced the error "RSS reader not yet whitelisted!". **Root cause (two-part, verified live with curl):** (1) xcancel.com answers `/rss` with **HTTP 200 and a fake feed whose title/content is the whitelist error** (they UA-whitelist RSS readers; rss2json's fetcher isn't on the list) — that passed `socFetchAccount()`'s old `j.status === "ok" && items.length` check, so the error text rendered as if it were tweets; (2) every other RSS-enabled public Nitter instance (all 5 per the status.d420.de tracker: nitter.net, xcancel, poast, privacyredirect, nt.vern.cc) is bot-walled (Anubis/go-away/Cloudflare) or UA-whitelisted → "Cannot download this RSS feed" through rss2json. Alternatives probed and dead: fxtwitter has **no timeline endpoint** (404; user endpoint carries no tweet text), openrss.org → 401, twiiit redirector → dead, allorigins → timeout. **What does work (verified live):** the public **RSS-Bridge TelegramBridge** (`rss-bridge.org/bridge01`) turns `t.me/s/<channel>` into Atom that rss2json reads fine.

**Fix (`docs/dashboard_professional.html`):** (a) **feed-title validation** — `socFetchAccount()` now requires the account handle in the feed title (Nitter: `Name / @handle`; TelegramBridge: `Name (@channel) - Telegram`) and rejects anything else ("mirror blocks RSS readers" for whitelist pages), so error feeds can never render as posts; (b) **official-Telegram-mirror-first sourcing** — new `tg:` field on `SOC_ACCOUNTS` (binance=`binance_announcements`, WatcherGuru=`WatcherGuru`, whale_alert=`whale_alert_io`, Cointelegraph=`cointelegraph`; channels confirmed live), new `socTgFeedUrl()` builds the bridge URL, tried before the Nitter mirrors; TG posts link to `t.me` and are marked **TG** (item source + chip suffix via new `_socAcctVia`); media-only TG posts (`Please open Telegram…`) skipped; (c) `SOC_NITTER_HOSTS` trimmed to xcancel + poast (≤2 failing calls/account keeps rss2json's rate limit safe); (d) honest copy: sub-tab description, empty-state, and status line now say posts come from Telegram mirrors and X blocks keyless readers. Footer bumped to v2026-07-10.1.

**Verified:** node syntax parse of the inline script (OK) + live functional test of the exact new fetch logic in Node: whale_alert → 8 posts via TG (real t.me links/timestamps), Cointelegraph → 8 via TG, saylor (no TG) → rejected cleanly with no whitelist text leaking into items. Docs updated: CLAUDE.md (bug cleared per rule 3, Socials feature row), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Command › 🐦 Socials sub-tab (v2026-07-09.6)

**Roadmap item:** "Add a Socials tab to the Command center. This tab show Crypto tweets and stats from accounts with more than 0.5 million followers." *(the follower gate was edited from 1M → 0.5M in CLAUDE.md before implementation; the on-disk 0.5M value was honored)*

**Change (`docs/dashboard_professional.html`):** third Command sub-tab (`COMMAND_SUBS = ["command-overview","news","socials"]`, deep link `#socials`). **Problem:** X/Twitter has no keyless API and blocks CORS. Source research during implementation: rss2json × 4 Nitter mirrors → all 500; direct mirror probes → only xcancel.com serves RSS but answers "RSS reader not yet whitelisted!"; allorigins bridge → 520; Twitter syndication endpoint → 429 + no CORS; openrss.org → 401; sotwe API → 403 Cloudflare. **The only keyless CORS-open X endpoint found working is the fxtwitter API** (`api.fxtwitter.com/<handle>`, `Access-Control-Allow-Origin: *`, live follower/tweet counts — verified live, WatcherGuru 4.43M followers). **Design — split the job:** *stats live* via `socFetchStats()` (fxtwitter; static `followersM` snapshots only as render fallback, marked `*` in the chip), *tweet text best-effort* via Nitter-mirror RSS through the same `api.rss2json.com` bridge as News (`socFetchAccount()` tries `SOC_NITTER_HOSTS` xcancel.com → nitter.poast.org → nitter.privacyredirect.com → lightbrd.com; mirrors come and go — all four down at ship time, the empty state says so and the stats half still works). `loadSocials(force)` fetches timelines + stats in parallel `Promise.allSettled`; dead accounts show a red ✕ chip, never a blank tab. The **>0.5M-follower gate is enforced by curation**: `SOC_ACCOUNTS` (14 accounts — elonmusk, binance, cz_binance, coinbase, VitalikButerin, saylor, justinsuntron, WatcherGuru, whale_alert, BitcoinMagazine, Cointelegraph, APompliano, ErikVoorhees, novogratz). **Retweets skipped** (`RT by` title prefix); generalist accounts (`general:true` — elonmusk) filtered to crypto-keyword tweets via `SOC_CRYPTO_RE`. Caps: 8 tweets/account, 60 total, 10-min cache (↻ forces). "Stats" = per-account chips (`#socAccts`: @handle · live followers · tweets fetched, red ✕ when timeline unreachable) + a status line with reachable-timeline count, live-stats coverage, combined reach in M followers, and key-tweet count. Renderer reuses the News family: `newsCatalystTier()` T1/T2 badges, `newsDetectCoins()` coin chips, All/⚡ Key-only filter (`socSetFilter()`), `.news-item` CSS; new CSS is only `.soc-acct/.soc-dead/.soc-followers`. Tweet links rewritten from the mirror to `x.com` (`socToXUrl()`). Analysis-only — never places orders; social flow is a defensive input only per the crypto-catalysts skill. Footer bumped to v2026-07-09.6. *(Note: the roadmap item's follower gate was edited 1M → 0.5M in CLAUDE.md before this run; the on-disk 0.5M was honored.)*

**Verified:** node syntax parse of the inline script (1 block, OK), page-command div balance 45/45, presence check of all new symbols, and live endpoint tests (fxtwitter 200 + ACAO:* with real follower counts; every tweet-mirror path probed and documented above). Docs updated: CLAUDE.md (roadmap cleared per rule 3, Command row + new feature-table row), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Command › 📰 News sub-tab (v2026-07-09.5)

**Roadmap item:** "Add a news tab to the command center page. There you will list the latest crypto news you deem important for the trader. Use famous crypto news sources and prevent duplicate news items when using multiples sources."

**Change (`docs/dashboard_professional.html`):** the 🧭 Command tab became the third parent tab with sub-tabs (`COMMAND_SUBS = ["command-overview","news"]`): the original command center is now the **Overview** sub-page (`subpage-command-overview`, unchanged content) and a new **📰 News** sub-page aggregates headlines from **4 sources** — the **Alpaca News API** (`/v1beta1/news`, Benzinga, watchlist symbols, existing keys; skipped gracefully when keys are absent) plus **CoinDesk / Cointelegraph / Decrypt RSS** through the keyless `api.rss2json.com` bridge (`Access-Control-Allow-Origin: *`). *Why rss2json:* direct RSS fetches are CORS-blocked in a browser, and both the CryptoCompare and CoinGecko news APIs now return 401/10005 "API key required" (verified via curl during implementation). `loadNews(force)` uses `Promise.allSettled` so one dead source never blanks the tab (per-source errors go to the status line), merges, **dedupes by normalized headline** (`newsNormTitle()` — lowercase, punctuation stripped, first 80 chars) **+ URL**, keeps the newest 40, caches 5 min (↻ Refresh forces). "Important for the trader" = **T1/T2 catalyst badges** (`newsCatalystTier()`, keyword ladders aligned with `skills/crypto-catalysts`: T1 structural — hack/exploit/depeg/delist/enforcement/halt/insolvency; T2 flow — ETF/unlock/halving/listing/treasury buys/Fed/FOMC/CPI/rates) plus an **⚡ Key only** filter; base-ticker chips via `newsDetectCoins()` (case-sensitive ticker + any-case coin name — bare-`Sol`-in-"GPT-5.6 Sol" false positive caught and fixed during testing). Sub-tab plumbing refactored once instead of a third copy-paste: `subParentOf(id)`/`subTabFnOf(parent)` now drive the redirects in `switchTab()` and `applyTabFromUrl()`; deep links `#news` / `#command-overview` work like the Market/Analytics ones. New CSS: `.news-item/.news-time/.news-badge/.news-t1/.news-t2/.news-src/.news-syms/.news-filter-btn`. Footer bumped to v2026-07-09.5.

**Verified:** node syntax parse of the inline script (OK), div balance of the page-command region (37/37), live end-to-end run of the extracted news module against the real feeds (30 items fetched, deduped, 3 correct T1/T2 badges incl. a USDT-delisting T1 and a BTC-ETF-outflows T2), rss2json CORS header confirmed with an `Origin` GET. Docs updated: CLAUDE.md (roadmap cleared per rule 3, nav + feature-table rows), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: Execution order table Total column (v2026-07-09.4)

**Roadmap item:** "Add total amount in currency to the order table in the Execution page."

**Change (`docs/dashboard_professional.html`):** the 🎯 Execution › Recent Orders table gains a sortable **Total** column (after Avg Fill) showing each order's USD value: `filled_qty × filled_avg_price` for (partially) filled orders, else `qty × limit_price` for unfilled limit orders, else the order's `notional` field; "–" when none is available. Rendered as `$X,XXX.XX` via the existing `fmt()` helper in `renderExecution()`. The empty-state placeholder colspan went 9 → 10. Sorting needs no extra wiring — `enhanceTables()`/`sortTable()` are generic per-column and `parseCellValue()` strips the `$`/commas. Footer bumped to v2026-07-09.4.

**Verified:** node parse of the dashboard inline script (1 block, syntax OK). Docs updated: CLAUDE.md (roadmap cleared per workflow rule 3), README.md (Key features bullet), glossary.md, dashboard_layout.md (Execution row + changelog).

### 2026-07-09 — Rescan roadmap: canonical symbol notation BASE/QUOTE everywhere (v2026-07-09.3)

**Roadmap item (owner):** "different notations for symbols … bad design practice. Always use a consistent format throughout this project like e.g BTC/USD or BTC/USDT." Audit found (a) four duplicated local `'BTCUSD' → 'BTC/USD'` converters on the Python side and (b) dashboard surfaces still labelling symbols with the bare base (`BTC`) while tables showed the full pair.

**Canonical rule (now in CLAUDE.md › "Symbol notation (canonical)"):** the slash pair `BASE/QUOTE` (`BTC/USD`) is the one notation for config, journals, logs, state files, and every display label. Alpaca's no-slash form (`BTCUSD`) exists only at the API boundary (positions/orders/activities responses, order payloads, bars/snapshot keys).

**Python (DRY consolidation):**
- New `scripts/symbols.py` — single `to_slash()` converter, USDT/USDC/USD quotes longest-match-first (mirrors the dashboard's `toSlash()`; the old duplicates only handled `USD`, so `BTCUSDT` passed through unnormalised). Self-checks under `__main__`.
- `rebalance.py` (module-level `_to_slash` removed), `run_evaluation.py` (nested `_to_slash` removed), `trade.py` (nested `_slash` in `get_open_orders` removed), `scout.py` (inline bare-symbol block replaced) — all now `from symbols import to_slash`. Behavior-preserving: scout still drops non-`/USD` quotes; both symbol forms are still indexed in `pos_by_symbol`.
- New `tests/test_symbols.py` (10 parametrized cases incl. USDT/USDC, stablecoin base `USDTUSD`, unknown quote, empty input).

**Dashboard (`docs/dashboard_professional.html`, v2026-07-09.3):** bare-base display labels → full pair: Command-tab 🔭 Scout chip (`tvLink(s)` instead of `tvLink(s, baseTicker(s))`), live ticker strip items, Market Overview "Best/Worst 24h" KPIs, Market Overview momentum-heatmap tiles, and Market Overview Buy/Sell button tooltips. **Documented exemptions (functional, not labels):** `baseTicker()` remains for news-site URL slugs (CryptoPanic/CoinGecko need the base), the space-capped 10×10 correlation-matrix axis ticks, and the `symbolInfo()` asset-*name* fallback — each now carries an explanatory comment, and the `baseTicker()` doc-comment states it is not for symbol labels. Footer bumped to v2026-07-09.3.

**Verified:** pytest 120 → **130 passed**; `python scripts/symbols.py` self-checks pass; `py_compile` clean on all five touched scripts; node parse of the dashboard inline script (1 block, 0 errors, `</html>` intact). Docs updated: CLAUDE.md (roadmap cleared → new canonical-notation section), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan bugs: Scanner duplicate-symbol fix — USD-only scan universe (v2026-07-09.2)

**Bug (owner-reported, CLAUDE.md Bugs #1):** the Market › Scanner results table listed the same symbol up to three times — once per quote currency (BTC/USD, BTC/USDT, BTC/USDC) — because the 2026-06-19 roadmap broadened `ALLOWED_QUOTES` to USDT/USDC and the symbol cell showed only the base ticker (`baseTicker()` → "BTC"), making the rows look like exact duplicates. Alpaca executes trades against USD, so the non-USD rows were noise on a trading surface.

**Fix (`docs/dashboard_professional.html`):**

- New `usdPairsOnly(universe)` helper next to `getCryptoUniverse()` — filters to symbols ending `/USD`.
- `loadMarketSignals()` (Scanner) and `loadMarketOverview()` now slice from `usdPairsOnly(await getCryptoUniverse())`, so each base appears exactly once and the "tradable USD pairs" capped-scan notes are accurate again.
- `updateScanBtnLabel()` clamps against the USD-only count instead of the full mixed-quote universe length.
- Symbol cells in the Scanner table (normal + error rows), the Top Opportunities panel, and the Market Overview table now render `tvLink(row.sym)` (full pair, e.g. `BTC/USD`) instead of the bare base — per the owner's request to show the quote in the symbol.
- Scope deliberately narrow: the full USD/USDT/USDC universe is unchanged and still feeds the Settings watchlist selector dropdown (`populateWatchlistOptions()`), which was a deliberate 2026-06-19 feature. Only the two scan surfaces filter.

**Verified:** all inline `<script>` blocks parse clean via `new Function` under node (2 blocks, 0 errors). Footer bumped to v2026-07-09.2. Docs updated: CLAUDE.md (bug closed, Scanner/Market Overview/Settings rows corrected), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Rescan roadmap: all 8 trader-effectiveness items implemented (v2026-07-09.1)

"Rescan roadmap" → implemented every candidate from the same-day analysis, across the Python engine AND the dashboard Autopilot (both engines stay in parity — new consistency-checklist item 15). Roadmap cleared per workflow rule 3.

**Config (`config.json`):** new `costs` section (`taker_fee_bps_per_side: 25`); `strategy` gains `rotation_enabled/rotation_min_score/rotation_score_margin`, `min_rr_full/min_rr_half`, `session_filter_enabled/session_min_sample`; `risk` gains `enforce_budget_on_open_positions`, `max_hold_hours: 48`, `partial_tp_enabled/partial_tp_r_multiple/partial_tp_fraction`. (Owner separately raised `risk.max_open_positions` 4 → 15 mid-session — all new code reads it live from config.)

**Python:**
- `risk.py` — second config loader `_load_risk_cfg2()` (keeps the original 17-tuple untouched) + pure helpers: `spread_pct`, `round_trip_cost_pct` (2×fee + spread), `net_rr` (cost subtracted from the reward leg), `partial_tp_trigger_price`/`should_partial_tp`, `position_age_hours`/`is_stale_position`, `rotation_allows`. Self-checks extended; correlation-budget self-checks now pass explicit caps (they asserted the old 4-position default and broke when the owner set 15 — config-independent now).
- `position_state.py` — `_EMPTY_POSITION` gains `entry_time_iso`, `partial_tp_done`, `breakeven_stop`; `init_position()` stamps entry time; new `mark_partial_tp()`.
- `run_evaluation.py` — (item 6) 4H fallback: `aggregate_bars_to_4h()` builds synthetic 4H bars from a `1Hour` fetch when the native 4H series is < 51 bars; explicit `DATA-QUALITY WARNING` journal line when even that fails, `regime_4h` notes "(synthetic 4H from 1H)". (item 4) partial TP fires between the trailing stop and the hard stop; the hard stop then uses `max(swing_stop, breakeven)`; executed-order handler calls `mark_partial_tp` (a partial SELL no longer clears position state). (item 5) stale exit after the TA-sell check. (items 1+7) net-R:R soft gate on new entries (`net_rr < 1.0` block, `< 1.5` half-size; journal line shows `net_rr=`). (item 8) session-edge filter — paginated FILL history, FIFO round trips, GMT+2 exit-hour/weekday buckets, ≥ 20 samples + negative P&L → half-size (OFF via config). (item 2) `apply_rotation()` post-evaluation pass: budget-blocked candidate ≥ 4.0 replaces the weakest HOLD holding (score ≤ 0, margin ≥ 2.0, tier budget re-checked after removal, R:R gate applied); one per cycle; SELLs sorted before BUYs in the execute loop. (item 3) `BUDGET EXCEEDED n/m` console + journal warning; optional weakest-overflow trim behind `enforce_budget_on_open_positions`. `evaluate_symbol`'s `_compute_qty` extracted to module-level `compute_entry_qty()` for reuse.
- `walkforward_evaluate.py` — (item 1d) `fee_bps` default 0 → 25 (dataclass, `default_sim_config()` from `config.json › costs`, and the `--fee-bps` CLI default).

**Dashboard (`docs/dashboard_professional.html`, v2026-07-09.1):**
- `STRAT_CFG` gains the 11 new keys (fee bps, R:R gates, rotation, max-hold, partial-TP, session filter); `seedStrategyConfig()` seeds them from `config.json › strategy/risk/costs`. New shared helpers `roundTripCostPct()`, `netRrPct()`, `aggregate1hTo4h()`, `fill4hFallback()` (JS ports of the Python functions — verified value-for-value against risk.py with a standalone node test).
- Signals tab: new **Spread** column (snapshot `latestQuote`, red > 0.3%), R:R column is now **net-of-cost** (tooltip shows gross + cost breakdown; thresholds from `minRrHalf/minRrFull`), ⚠ marker in the 4H Regime cell (yellow = synthetic 4H, red = degraded). Table 16 → 17 columns; all placeholder/error colspans updated. `_signalRrMap` entries carry `{rr, grossRr, costPct}`; trade modal `#tradeRrInfo` shows net + gross + cost.
- Scalping tab: **Spread** + **Cost Check** columns (viability gate: target distance < 2× round-trip cost → red "⚠ costly", else "✓ viable"; flag not block). 10 → 12 columns.
- Autopilot `apCycle()`: 4H fallback before scoring (log lines for synthetic/degraded); partial-TP ladder (+1R sell `partialTpFraction`, breakeven stored in `localStorage.autopilotPartialTp`, merged from the Python file's `partial_tp_done/breakeven_stop`); effective stop = max(swing low, breakeven) when not trail-armed; stale exit from `localStorage.autopilotEntryTime` (entry stamped at BUY, merged from file `entry_time_iso`); rotation at a full budget (sell weakest ≤ 0 scoring holding when candidate ≥ 4.0 leads by ≥ 2.0, budget counters updated, then entry proceeds); net-R:R soft gate + half-size note; session filter via `apSessionPenaltyActive()` (reuses `edgeFetchAllFills`/`edgeFifoTrades`, 6h cache, OFF by default). Both new maps pruned to held symbols and re-persisted after entries.
- Command tab: red **⚠ BUDGET EXCEEDED n/m** chip (`#budgetChip`, `renderBudgetChip()`) under the scout chip when open positions exceed the Settings budget.

**Verified:** pytest 95 → **120 passed** (25 new tests: trade economics, partial TP, stale exit, rotation, 1H→4H aggregation incl. partial-bucket drop); `python scripts/risk.py` self-checks pass; `vm.Script` parse of the dashboard inline script (1 block, 0 errors, `</html>` intact); node parity test of the JS helpers against the Python values. Dry-run `run_evaluation.py` starts clean (positions fetch needs live credentials not present in the sandbox shell). Docs updated: CLAUDE.md (roadmap cleared, hard-rules table +5 rows, exit strategy, dashboard rows, checklist items 14/15), README.md, glossary.md, dashboard_layout.md.

### 2026-07-09 — Trader-effectiveness analysis → 8 new roadmap candidates (docs-only, no code change)

Owner asked for a professional-trader review of the dashboard + trading rules (scalping and longer-term) with improvements added to the CLAUDE.md roadmap. Reviewed: CLAUDE.md hard rules, `config.json`, recent journals (2026-07-07/08), the latest walk-forward report (`walkforward_20260708T063702Z.md`), and the dashboard/scripts (grep-verified — no fee/spread accounting, no partial-TP/break-even, no max-hold logic exists anywhere).

**Evidence found in live data:**
- Journals 2026-07-08 show `BLOCKED: correlation budget: 5/4 positions open` — the book was **over** budget (cap only gates entries), and a UNI/USD score **+4.0** setup was repeatedly blocked while AAVE/USD sat open at score **−1.0**. Capital allocation is not re-ranked once the budget is full.
- Journals 2026-07-07/08 repeatedly log `insufficient 4H history (0 bars)` for ADA/USD and AAVE/USD → Signal 6 silently contributes 0 and the swing-low stop silently falls back to fixed −5%.
- `walkforward_evaluate.py` defaults `fee_bps=0`; latest report shows negative avg Sharpe on 4H/1D even before costs. No P&L surface (P&L/Edge/R:R column) accounts for Alpaca taker fees (~0.15–0.25%/side) or spread — critical for scalping economics.

**8 roadmap items added (CLAUDE.md › Roadmap):** (1) HIGH fee- & spread-aware economics (Spread column, net-of-cost R:R, scalp viability gate, walk-forward fee default); (2) HIGH position rotation at the correlation budget (rotate weakest holding out for a ≥4.0 candidate scoring ≥2.0 pts higher); (3) HIGH over-budget reconciliation + Command-tab warning chip; (4) MEDIUM partial take-profit at +1R + break-even ladder; (5) MEDIUM time-based stale-position exit (`risk.max_hold_hours`); (6) MEDIUM 4H data fallback via 1H-bar aggregation + explicit data-quality warning; (7) LOW R:R soft entry gate (block <1.0, half 1.0–1.5); (8) LOW session-edge feedback loop (hour/day expectancy → half-size, OFF by default).

No code changed — roadmap/docs only (CLAUDE.md, README.md, memory.md, glossary.md; dashboard_layout.md untouched — no dashboard change). Implementation deferred until a "rescan roadmap" request per workflow rule 8.

### 2026-07-08 — Bug rescan of v2026-07-08.1 → two Autopilot defects fixed (v2026-07-08.2)

"Rescan bugs" pass over yesterday's +558-line Autopilot commit (`fd16c7f`). Reviewed the full diff, re-verified the `seedStrategyConfig()` unit conversions against `config.json` (all `*_pct` are fractions — ×100 correct), confirmed the `AP_MAX_POSITIONS`/`AP_MAX_PER_TIER` locals exist, and found **two real bugs**, both in `apCycle()` in `docs/dashboard_professional.html`:

**Bug 1 (HIGH) — trailing stop un-armed itself on a pullback below +2.5%.** The exit logic gated the entire trailing-stop check on *current* P&L (`if (plPct >= AP_TRAIL_ARM_PCT) { …trail check… }`). Python arms from the **HWM** (`risk.should_trail_stop_out`: `(hwm − entry)/entry ≥ activation`), so once armed the trail fires at HWM−3% regardless of current P&L. Failure case: entry $100 → run to $106 (HWM recorded) → pull back to $102.40. Trail should fire at $102.82; the dashboard skipped the branch (plPct 2.4 < 2.5) and fell through to the far-lower 4H swing-low stop, giving back profit and breaking Python parity. Fix: HWM still only ratchets while plPct ≥ arm, but arming is now `trailArmed = hwm ≥ entry × (1 + arm/100)` and the trail check runs whenever armed. Verified with a 5-case standalone node test (pullback-below-arm fires trail; within-band holds; unarmed falls to swing stop; new high ratchets; Python-file-seeded HWM arms correctly).

**Bug 2 (MEDIUM-HIGH) — stale-entry sweep cancelled orders it didn't own.** The item-3 lifecycle cancelled **every** open `buy`+`limit` order older than 1 cycle — including the Python engine's entries and any manual resting buy limit placed via the trade modal (e.g. a deliberate below-market bid). Fix: `apPlaceOrder()` now tags every Autopilot order with `client_order_id = "ap-<SYM>-<ms>"`, and the sweep skips any order whose `client_order_id` doesn't start with `ap-`. The exit cancel-replace path stays untargeted on purpose — it immediately re-places a protective SELL for the full qty at a wider band (mirrors Python's escalation and never leaves the position unprotected), so acting on a foreign sell order is safe there.

Verified: `vm.Script` parse on the inline script (1 block, 0 errors), `</html>` intact, behavioral test green, pytest suite still 95/95 (Python untouched). Footer → v2026-07-08.2. Docs updated: CLAUDE.md (Autopilot row + Bugs note), README.md, glossary.md, dashboard_layout.md.

### 2026-07-08 — Roadmap: all 10 dashboard effectiveness/consistency candidates implemented (v2026-07-08.1)

Rescan roadmap. The owner left all 10 candidates from the 2026-07-07 analysis in place → implemented every one. All changes in `docs/dashboard_professional.html` (single file); Python untouched. Roadmap cleared per workflow rule 3.

**Foundation (new shared plumbing):**
- `STRAT_CFG` const object — dashboard-side strategy/risk params (TA-exit score −2, trail arm 2.5 / trail 3, cash reserve 20, swing-low lookback 20 / buffer 0.1% / clamp 8%, min-bars 60, daily-drawdown gate 3%, escalation 2 cycles / +0.3% band). Defaults mirror `config.json`; `seedStrategyConfig(cfg)` overwrites them from the file on load.
- `fetchLocalJson(paths)` — graceful multi-path relative JSON fetch. `loadConfigFromFile()` now tries `./config.json` **then `../config.json`** (the Python engine's file — `docs/config.json` doesn't exist in this repo, so previously the dashboard never actually loaded any config file).
- `calcADX()` / `adxLabel()` / `calcObvTrend()` — JS ports of `indicators.adx/adx_label/obv_trend` (Wilder ADX, OBV with 5%-of-window dead zone). Informational only; `calcSignalScore()` untouched.
- `loadScoutPromotions()` / `scoutExtraSymbols()` — reads `data/watchlist_dynamic.json` (TTL from `config.json › scout.ttl_hours`, seeded into `_scoutTtlHours`).

**Item 1 (HIGH) — Autopilot daily-drawdown gate.** `apCycle()` snapshots day-open equity per GMT+2 day (`localStorage.autopilotDayOpen`, `en-CA` date key, reset at day roll); when equity is ≥ `STRAT_CFG.dailyDrawdownGatePct` below it, the candidates list is emptied (all new entries blocked, `[BLOCK]` log), exits stay fully active. Mirrors `risk.daily_drawdown_gate_triggered` + capital preservation.

**Item 2 (HIGH) — fresh quotes for limit prices.** `apCycle()` fetches `fetchSnapshotsInBatches(_apwl)` once per cycle into `liveQuote{}`; entry ask (`×1.001`) and exit limits (`×0.995`, escalated band) anchor to `liveQuote[sym] || lastClose`. `lastClose` stays scoring-only. Graceful fallback + log line when snapshots fail.

**Item 3 (HIGH) — stale-order lifecycle.** Open orders fetched each cycle; per-order age counter persisted in `localStorage.autopilotOrderAge` (pruned when no longer open). Unfilled BUY limits older than 1 cycle → cancelled via new `apCancelOrder()` (DELETE `/v2/orders/{id}`, 404 = success). Exit path: when `qty_available` is locked and the tracked SELL order age ≥ `STRAT_CFG.escalationCycles` (2), cancel-replace with the full position qty at a wider band (0.5% + `escalationExtraPct` 0.3%). Kill switch clears the tracker.

**Item 4 (MEDIUM) — config-seeded Autopilot constants.** Removed hardcoded `AP_CASH_RESERVE_PCT`/`AP_TA_EXIT_SCORE`/`AP_TRAIL_ARM_PCT`/`AP_TRAIL_PCT` consts and the `SWING_LOW_LOOKBACK_4H`/`SWING_LOW_MAX_STOP_PCT` consts; `apCycle()` reads them from `STRAT_CFG` at cycle start and `swingLowStop4h()` reads lookback/buffer/clamp from `STRAT_CFG` (buffer was hardcoded `×0.999`, now `1 − swingLowBufferPct/100` — same 0.999 default).

**Item 5 (MEDIUM) — min-bars 55 → 60.** All five scoring paths (Signals, Scalping, Breakout, Market Scanner, Autopilot) now gate on `STRAT_CFG.minBarsForSignal` (60, = `config.json › data.min_bars_for_signal`). Added as item 13 of the Python ↔ Dashboard consistency checklist; item 14 documents the STRAT_CFG seeding rule.

**Item 6 (MEDIUM) — scout promotions surfaced.** Signals scan and Autopilot merge fresh (≤ TTL) promotions into their symbol set; promoted rows get a blue **SCOUT** tag; Command tab shows a 🔭 chip (`renderScoutChip()`) listing promotions with freshness (stale promotions shown greyed, excluded from scans). Promoted symbols use the default 5% cap + Tier-2 budget — same as Python.

**Item 7 (MEDIUM) — ADX + OBV columns.** Signals table and Scalping table gained display-only ADX (with `adxLabel()` tooltip) and OBV columns on the exec timeframe. Score-parity exemption intact — not folded into `calcSignalScore`. Signals table is now 16 columns (was 13), Scalping 10 (was 8); all placeholder/error colspans updated.

**Item 8 (LOW) — R:R preview.** New Signals **R:R** column: risk = distance to `swingLowStop4h`, reward = distance to BB-upper target; `1:X` green ≥ 2 / yellow ≥ 1 / red < 1; "–" with tooltip when price sits at/above the BB upper. Values cached in `_signalRrMap`; `openTradeModal()` shows the same numbers in a new `#tradeRrInfo` box. Display-only — no gate.

**Item 9 (LOW) — correlation-aware entry gate.** New `apMaxCorrWith(sym, openSyms, bD)` computes max Pearson ρ of 30-day daily log-returns vs open positions; ρ > `AP_CORR_LIMIT` (0.9) → **half-size** the entry (chose half-size over hard block — the static tier budget already caps count; log line records ρ and the correlated symbol).

**Item 10 (LOW) — HWM state merge.** `apCycle()` reads `data/positions_state.json` each cycle and seeds `hwm[sym] = max(localStorage, file high_water_mark)` before trailing; Command tab shows `renderHwmSplitWarning()` (`#hwmSplitWarning`) when both engines carry an active HWM for the same symbol.

**Verified:** `node` `vm.Script` on the extracted inline script → 1 block, 0 errors; `</html>` intact; repo grep confirms no `>= 55`/`< 55` scoring gates, no removed consts referenced, and the only `activity_type=FILL` URL remains in `edgeFetchAllFills()`. Footer → v2026-07-08.1. Docs updated across CLAUDE.md (roadmap cleared, Autopilot/Signals/Scalping/Command/Settings rows, checklist items 13–14, ADX/OBV note), README.md, glossary.md, dashboard_layout.md.

### 2026-07-07 — Analysis: dashboard effectiveness & strategy-consistency review → 10 roadmap candidates (no code changed)

User asked to analyze the dashboard's effectiveness and strategy consistency and add suggested improvements to the roadmap for owner selection. **Analysis-only session — no code, config, or dashboard changes; CLAUDE.md roadmap + this entry are the only edits.**

**Method.** Reviewed `docs/dashboard_professional.html` (Autopilot `apCycle()` block ~6940–7253, signal engine consts ~2272–2300, order paths), `config.json`, `scripts/risk.py`, `run_evaluation.py`, `position_state.py` for cross-engine drift, against the CLAUDE.md hard rules and parity checklist.

**Findings (ranked, all added to the CLAUDE.md roadmap as candidates 1–10):**

1. **Autopilot has no daily-drawdown gate** — Python blocks entries at −3% day drawdown (`daily_drawdown_gate_triggered` + capital-preservation mode); `apCycle()` has no counterpart, so the in-browser loop keeps buying through a portfolio slide.
2. **Autopilot limit prices are stale** — entries/exits use `res.lastClose` (last *completed* 15-min bar, by design of `barsEnd()` up to ~15–30 min old) instead of a fresh snapshot quote; in a fast move the ±0.1%/−0.5% bands anchor to a stale price.
3. **No stale-order lifecycle** — Autopilot orders are GTC; only the ⛔ kill switch ever cancels. An unfilled exit is skipped every cycle by the `qty_available` dedup ("qty locked"), leaving the position unprotected, where Python cancel-replaces after `stop_loss_escalation_cycles` (2) with a wider band. Unfilled entries also linger indefinitely.
4. **Autopilot strategy consts hardcoded** (TA exit −2, trail 2.5/3, cash reserve 20, swing-low params) vs Python reading `config.json` — engines can silently fork.
5. **Min-bars drift** — dashboard scores at ≥55 bars, Python `min_bars_for_signal` = 60.
6. **Scout promotions invisible to the dashboard** — Python merges `data/watchlist_dynamic.json`; the dashboard never reads it (no `scout`/`watchlist_dynamic` reference in the HTML), so Signals/Autopilot see a narrower universe than the bot trades.
7. **ADX/OBV journal-only** — the 2026-07-07 informational indicators have no dashboard display (score-parity exemption intact; this is about *showing* them, not scoring).
8. **No R:R computation anywhere** despite Decision Checklist item 12 ("prefer R:R ≥ 1:2").
9. **Correlation budget is static tiers** while the Risk tab already computes a live ρ matrix that could gate correlated entries.
10. **Trailing-stop HWM state split** — Python `data/positions_state.json` vs Autopilot `localStorage.autopilotHwm`; two engines managing the same position trail from different HWMs.

**Confirmed consistent (no action):** score gates 3.5/2.5/4.0 shared via `SIGNAL_*` consts and matching `config.json`; trailing 2.5%/3% matches `risk.trailing_*`; swing-low stop params (20 bars / 0.999 / 8% clamp) mirrored in `swingLowStop4h()`; entry band ×1.001 within the 0.2% rule and exit band ×0.995 within 0.5%; cash-reserve 20% post-order gate present; correlation-budget caps read live from Settings; all realized-P&L KPIs on the shared `edgeFetchAllFills()`/`computeFifoStats()` path (2026-07-06/07 fixes verified still in place); annualization 365 both sides.

**Verified:** findings grep-confirmed against the live files (`daily_drawdown|capital_preservation` absent from the HTML; `length >= 55` at lines 6204/7147 vs `min_bars_for_signal` 60; `cancel` only in the kill switch; no `watchlist_dynamic` in the HTML). Roadmap items are proposals — owner selects; nothing moved to "completed".

### 2026-07-07 — Roadmap: skills-gap analysis — `hourly-research` + `crypto-catalysts` skills added

User added roadmap item 1 ("look at the skills in this project and add any skill that could benefit this project, with the focus on crypto. Don't overlap skills and don't add too many") and requested "rescan roadmap" (= implementation per workflow rule 8).

**Analysis.** The existing three skills split cleanly into 1 knowledge playbook (`crypto-trader/SKILL.md` — scoring, Wyckoff, entries/exits, sizing, on-chain metrics, regimes) and 2 scheduled-routine procedures (`morning-brief-SKILL.md` 07:00, `daily-journal-SKILL.md` 23:21). Two genuine gaps, both crypto-focused: (1) the **hourly research routine** — the first core responsibility in CLAUDE.md (top-of-hour `Research HH:MM GMT+2` block feeding the `:23` evaluation) had **no skill**, while both other scheduled routines did; (2) **news/catalyst interpretation** — the Decision Checklist asks "What does recent news say? Any macro catalysts?" and `research.py news` fetches headlines, but nothing taught how to weigh crypto-specific events (crypto-trader §8 covers on-chain *metrics* only, not events/headlines). Rejected as overlapping: a weekly performance-review skill (covered by the market-researcher agent's mission 1 + the dashboard Edge/Insights tabs) and any second TA playbook (crypto-trader owns that). Stopped at two skills per the "don't add too many" constraint.

**Added `skills/hourly-research-SKILL.md` (procedure, flat-file form matching the other routines).** Defines the top-of-hour research pass: symbol set = `config.json › watchlist.symbols` + fresh scout promotions from `data/watchlist_dynamic.json`; data via dry-run `run_evaluation.py` + `research.py news`; appends a per-symbol `Research HH:MM GMT+2` block (15-min/4H EMA state, daily regime, RSI/MACD/BB, informational ADX/OBV, top headlines, a terse `Read:` line). Hard rules: research-only (no orders), never skip a symbol, append-only, news can flag a close (take-profit-on-research rule) but never justify an entry below the score gates.

**Added `skills/crypto-catalysts/SKILL.md` (knowledge, directory form matching crypto-trader).** News & event interpretation guide with a T1/T2/T3 severity ladder — T1 structural (hack, depeg, delisting, enforcement, chain halt) → flag open positions for close + block entries; T2 flow (large unlocks, ETF flow streaks, funding > +0.1%/8h, listings, OI extremes) → downsize/skip borderline entries; T3 noise → record only. Plus macro-window handling (skip half-size-gate entries within ±2h of FOMC/CPI), weekend/thin-liquidity skepticism, and an output convention for `Read:` lines (`flagged to close: SYMBOL — T1 …`). Prime directive: **defensive only** — catalysts veto/downsize/flag, never override score gates, regime gate, correlation budget, or any hard rule. No strategy thresholds, config, or Python/dashboard code changed — scoring parity untouched.

**Docs updated.** CLAUDE.md: roadmap cleared (rule 3), hourly-research skill referenced in the Core Responsibilities bullet, new "Project skills" table under Trading Strategy Skill. README.md: skills table under Trading Strategy + project-structure tree updated to show all five skills.

**Verified:** both SKILL.md files lint-clean frontmatter (name/description) consistent with existing skills; no code paths touched, so no tests affected (`tests/` unchanged). Roadmap item moved out of CLAUDE.md per workflow rule 3.

### 2026-07-07 — Roadmap: indicator-list analysis — ADX + OBV added as informational indicators

User re-added roadmap item 1 ("Analyze the technical indicators list and add more indicator when you deemed it necessary") and requested "rescan roadmap" (= implementation per workflow rule 8).

**Analysis.** The 6-point confluence set covers direction (EMA cross, MACD), momentum (RSI), mean-reversion (BB %b), single-bar participation (volume ratio), and HTF regime (4H EMA). Two genuine gaps: (1) **trend strength** — the EMA cross gives direction but not conviction, so a golden cross in a chop is indistinguishable from one in a real trend (whipsaw trap); (2) **cumulative volume flow** — `volume_ratio` is a one-bar snapshot and cannot see multi-bar accumulation/distribution. Rejected as redundant: Stochastic RSI / CCI / Williams %R (overlap RSI/BB), VWAP (session-ambiguous on a 24/7 venue).

**Change (`scripts/indicators.py`).** Added `adx(highs, lows, closes, period=14)` (Wilder ADX: smoothed ±DM/TR → DX → Wilder-averaged; needs ≥ 2×period+1 bars), `adx_label(value)` (<20 ranging/weak, 20–25 emerging trend, 25–40 trending, ≥40 strong trend), `obv_series(closes, volumes)` (cumulative signed volume), and `obv_trend(closes, volumes, lookback=20)` (rising/falling/flat; dead zone = 5% of window volume so noise reads flat). Self-test block extended.

**Change (`scripts/run_evaluation.py`).** `evaluate_symbol()` computes `decision["adx"]` and `decision["obv_trend"]`; `format_indicator_block()` prints `adx : XX.X (label)` and `obv : rising/falling/flat` lines between `atr` and `4h`.

**Deliberately NOT scored.** Both indicators are informational-only journal context for the hourly agent. Folding them into `signal_score()` would silently shift every trading gate (buy ≥3.5, TA exit ≤−2, scout ≥4 …) and break Python↔dashboard scoring parity; the dashboard `calcSignalScore()` is untouched and needs no counterpart (parity exemption noted in CLAUDE.md).

**Verified:** `python scripts/indicators.py` self-checks pass (ADX 38.6 "trending" and OBV "rising" on the rising sine fixture — sane); `python -m pytest tests/ -q` → **95 passed** (11 new tests: TestAdx — range, insufficient data, length mismatch, high-ADX-on-clean-trend, label buckets; TestObv — series length, mismatch, rising/falling/flat, insufficient data). Roadmap item moved out of CLAUDE.md per workflow rule 3.

### 2026-07-07 — Dashboard KPI audit: crypto annualization factor + unmatched-SELL win-rate hardening (v2026-07-07.1)

User asked to "check the dashboard on inconsistencies and incorrect KPIs." Audited every KPI computation path in `docs/dashboard_professional.html` and cross-checked against `scripts/metrics.py`. Two fixes applied.

**Fix 1 — annualization factor 252 → 365 (incorrect KPI).** `DEFAULT_LIMITS.tradingDaysPerYear` was `252` (the equity-market convention). This is a 24/7 crypto product; the portfolio-history feed (`period=3M&timeframe=1D&intraday_reporting=continuous`) returns ~365 daily points/year, so every annualized KPI was scaled by the wrong √N. It feeds five sites: Performance **Annualized Volatility**, Risk **Sharpe/Sortino/Calmar**, Backtest **Live Sharpe**, and Analytics **rolling 30/90-day Sharpe & vol**. It also contradicted the backend — `scripts/metrics.py:17` documents *"markets are 24/7; annualization uses 365 days"* and `annualization_factor("1D")` returns `365.0`. Effect: Sharpe/Sortino/Calmar/vol were understated by √(252/365) ≈ 0.83 (~17% low), which could flip the Backtest "Strategy Health" colour. One-line change to `365`.

**Fix 2 — `computeFifoStats` no longer books unmatched SELLs as $0 "wins" (cross-tab consistency).** When a SELL hit an empty FIFO queue (no matching prior BUY), `realizedPnl` stayed `0` and `realizedPnl >= 0` counted it as a win — the same class of phantom-$0-win bug the 2026-07-06 fix addressed in the *data source* but not the *logic*. The Edge (`edgeFifoTrades`) and Insights (`insRoundTrips`) engines already skip these (require `entryT`/`cost>0`), so Overview/P&L/Backtest win-rate & trade count could diverge from Edge/Insights. Now tracks `matchedQty`; a SELL is only counted as a realized trade when `matchedQty > 1e-9`, otherwise it stays in the trade log with `pnl: null` (renders "–", excluded from stats and the P&L calendar). Latent today (paper acct from cash, shorts disabled) but future-proofs the shared engine.

**Not changed (reported as LOW, left as-is):** break-even $0 round-trips count as wins across all three engines (internally consistent); dashboard `downsideStd` uses sample-std-of-negatives while `metrics.py` uses RMS-of-downside (Sortino methodology differs — parity note only); `portLoadDist` invested/donut uses signed `market_value` vs `loadContext`'s `Math.abs()` (latent — shorts disabled).

**Verified:** re-extracted the inline `<script>` and validated with `new vm.Script` (`node`) → 1 non-src block checked, 0 errors. Grep confirms `tradingDaysPerYear`/`252` now reads `365` at the single definition and no other `252` literal drives annualization. Footer → v2026-07-07.1.

### 2026-07-06 — Bug: Total P&L / realized-profit KPIs were computed on a truncated 100-fill window (v2026-07-06.1)

Rescan roadmap. Bugs list had one item: *"The total profit kpi's are not correct. Please fix."*

**Problem (root cause):** The shared realized-P&L engine `computeFifoStats()` was fed only a **single 100-fill page** (`/v2/account/activities?activity_type=FILL&page_size=100&sort=desc`) in three places:
- `loadContext()` — drives the Overview **Total P&L** KPI, the Command tab, and the Backtest vs Live tab (`c.fifoStats`).
- `loadPnl()` — drives the P&L tab **Total Realized P&L** KPI + attribution + calendar + day-of-week.
- `generateDailyJournal()` — computes today's realized-P&L slice.

Once an account exceeds 100 fills, FIFO matching runs on a truncated tail: (1) the realized total is understated, and (2) any SELL whose matching BUY predates the 100-fill window hits an empty queue → `realizedPnl` stays 0 → booked as a **$0 "win"**, which also corrupts win rate and profit factor. The Edge and Insights tabs already did it correctly via `edgeFetchAllFills()` (paginates all fills, 10k cap), so they silently disagreed with the "matches P&L tab" KPIs.

**Fix (`docs/dashboard_professional.html`):** routed all three feeders through the existing `edgeFetchAllFills()` helper (mode-aware — uses `apiFetch` → `getBaseUrl()`/`getHeaders()`, paginates via the activities `id` cursor with `direction=desc`, 10k safety cap). It is a hoisted function declaration in the same script block, so the earlier-defined `loadContext`/`loadPnl`/`generateDailyJournal` can call it. `loadPnl` dropped its now-unused local `baseUrl`; `generateDailyJournal` uses `edgeFetchAllFills().catch(() => [])` to preserve its "empty on failure" behaviour. Now every realized-P&L KPI (Overview Total P&L, P&L tab, Backtest, Edge, Insights, daily journal) reads the same complete fill history and cannot diverge. Footer → v2026-07-06.1.

**Verified:** extracted both inline `<script>` blocks and validated each with `new vm.Script` (`node`) → 2 blocks checked, 0 errors. Repo grep confirms the only remaining `activity_type=FILL` URL string is inside `edgeFetchAllFills()` itself; no feeder still uses `page_size=100&sort=desc`. Bugs list cleared in CLAUDE.md.

### 2026-06-29 — Chore: stop tracking `ruvector.db` runtime state

`ruvector.db` (RuVector runtime state binary) mutates continuously while the agent/process runs, so it reappeared as a modified tracked file every cycle and repeatedly tripped the Stop hook ("tracked files changed this session"). It is generated runtime state, not source.

**Fix:** added `ruvector.db` to `.gitignore` and ran `git rm --cached ruvector.db` (file kept on disk, only removed from the index). No code/logic changed. This is the resolution for the previous string of `chore: ruvector.db runtime state` commits — the file no longer needs committing each session.

**Verified:** `git status` no longer lists `ruvector.db`; working tree clean after committing the `.gitignore` change + index removal.

### 2026-06-29 — Fix: resolve committed merge-conflict markers in backtest tooling

After the `/6` rescan, a repo-wide grep surfaced **committed, unresolved `<<<<<<< / ======= / >>>>>>>` markers** (from old auto-merges under SHA `96f6b1b…`) in two source files, leaving them un-importable.

- `scripts/metrics.py` — both conflict sides were **byte-for-byte identical** (a pure duplicate of the whole module). Rewrote the single clean copy.
- `scripts/walkforward_evaluate.py` — the two sides genuinely differed; took the newer `96f6b1b` side at all 13 conflicts. That side is config-driven (`_load_sim_defaults()` / `default_sim_config()` read thresholds from `config.json`), has the half-size buy logic (`buy_score_half_size`, `size_mult`, `cap × size_mult`), reads symbols from `config.json › watchlist.symbols`, and uses a correct `"\n".join(...)` in `write_reports` (the HEAD side had a syntactically broken multiline string). Dataclass defaults (4.0/3.0) are fallbacks only; live `config.json` (3.5/2.5) wins via `default_sim_config()`.

**Verified:** `python -m py_compile` passes on both; grep confirms zero markers remain in either file. Remaining markers live only in append-only `journal/*.md` history (cosmetic, left untouched).

### 2026-06-29 — Roadmap: remove the `/6` suffix from all score values (v2026-06-29.1)

Rescan roadmap. One item: "Remove '/6' from all score values. The reason for this is that 6 is the maximum score anyway and it messes up the sorting of the columns." The `/6` suffix turned numeric score cells into strings (e.g. `+5/6`), so table columns sorted lexically instead of numerically.

**Decision:** the stated reason is column sorting (a dashboard concern), but the instruction says "all score values," so removed `/6` from every displayed/emitted score for consistency — dashboard UI **and** the Python journal output. Left it intact in historical journals/reports/`data/market_research/` (append-only logs — not rewritten) and in CLAUDE.md threshold *prose* that explains the 6-point scale (documentation, not a value).

**Implementation:**
- `docs/dashboard_professional.html` — stripped `/6` from: BUY/BEAR notifications, the closing-journal scan narrative + table, Breakout `ssText` (incl. the `–/6`→`–` fallback) and its `Signal /6` header, Market Overview score cell (sortable column), Scalping score cell (sortable column) + Avg-Score KPI, Market Signals Avg-Score KPI + BUY/Half KPI descriptions + Top-Opportunities rows, Autopilot entry-log note, Breakout legend, and the `portActionChip` threshold chips (`BUY ≥3.5`, `½ BUY 2.5`, `SHORT ≤−4`). Grep confirms zero `/6` remain in the dashboard. Footer → v2026-06-29.1, date 2026-06-29.
- `scripts/run_evaluation.py` — `format_decision_line` (`score=%+.1f`) and `format_indicator_block` (`score   : %+.1f`).
- `scripts/rebalance.py` — the three `score=%.1f` reason/size-note strings.

**Verified:** repo-wide grep for `/6` shows only historical logs + scale-explaining prose left; no live UI or emitted-format string still carries it. CLAUDE.md Output Format block updated to the new `score=+X.X` form so docs match code. Roadmap cleared.

### 2026-06-22 — Roadmap: user-configurable open-position cap (v2026-06-22.1)

Rescan roadmap. Bugs list empty; sole roadmap item: *"Remove the hard limit for max. 4 open positions."* User chose (via clarifying question) to **make the caps user-configurable in Settings** rather than hard-remove them. Landed on top of the 2026-06-19 loosening that had already raised the baseline to 4 total / 3 per tier.

**Problem:** The dashboard Autopilot hardcoded `AP_MAX_POSITIONS` / `AP_MAX_PER_TIER` as module-level consts (4 / 3 after the 2026-06-19 loosening), so the position-count budget couldn't be changed without editing the HTML. Python already reads its caps from `config.json › risk.max_open_positions` / `max_positions_per_tier`, so only the dashboard side was hardcoded.

**Fix (`docs/dashboard_professional.html`):**
- `DEFAULT_LIMITS`: added `maxOpenPositions: 4`, `maxPositionsPerTier: 3` (matching the `config.json` baseline).
- Settings DOM: new **🔗 Correlation Budget (Autopilot)** section (after 🔭 Signals Analysis) with two number inputs — `setMaxOpenPositions` and `setMaxPositionsPerTier` (min 1).
- `loadSettingsForm()`: populates both inputs from `s.limits`.
- `saveSettings()`: persists both (rounded, clamped to ≥ 1) into `limits`.
- Autopilot: removed the two hardcoded consts; added `apMaxPositions()` / `apMaxPerTier()` helpers that read `getSettings().limits` live. The entry loop now sets local `AP_MAX_POSITIONS` / `AP_MAX_PER_TIER` from those helpers at the start of each cycle's entry pass, so a saved change takes effect next cycle without reload.
- Python side unchanged (already config-driven). Footer → v2026-06-22.1.

**Verified:** extracted inline `<script>`s and validated each via `vm.Script` (`node`) → 2 scripts checked, 0 errors. Reconciled with the 2026-06-19 work during a rebase (correlation-budget docs updated to the 4/3 baseline). Docs updated across CLAUDE.md, README.md, glossary.md, dashboard_layout.md; roadmap cleared.

### 2026-06-19 — Roadmap: allow USDT/USDC-quoted pairs in the symbol selector (v2026-06-19.3)

Rescan roadmap. One item: "allow multiple stablecoin pairs like USDT and USDC in the symbol selector. It is currently limited to USD." This is about stablecoin **quote** currencies (BTC/USDT, ETH/USDC), distinct from the previous session's stablecoin-*base* filter (USDT/USD). The dashboard universe (`getCryptoUniverse()`) kept only `/USD` quotes and `addWatchlistSymbol()` hard-rejected anything not `/USD`.

**Decision (asked the user — scope had trading-safety implications):** chose **"Everywhere in the dashboard"** — USDT/USDC pairs are first-class across the selector, watchlist, Scanner, and Market Overview. Python bot untouched (reads `config.json` separately). Per-symbol caps stay `/USD`-keyed → `/USDT`,`/USDC` pairs use the default 5% cap.

**Implementation (`docs/dashboard_professional.html`, all JS):**
- New `const ALLOWED_QUOTES = {USD,USDT,USDC}`. `getCryptoUniverse()` rewritten: normalizes bare symbols by the longest-matching quote (USDT/USDC before USD), splits `BASE/QUOTE`, keeps `ALLOWED_QUOTES` only (drops BTC-quoted etc.), still sidelines stablecoin **bases** (USD ones into `_stablecoinUniverse` for the Show-stablecoins filter, others dropped). Renamed the local `usd`→`pairs` since it now holds mixed quotes.
- `addWatchlistSymbol()`: accepts `/USD`, `/USDT`, `/USDC`; bare input normalized to `BASE/QUOTE`; clearer reject message.
- New `baseTicker(sym)` = base before the slash. Replaced every display `sym.replace("/USD","")` (ticker strip, correlation heatmap names, gap-scanner ticker, Market Overview cell + trade buttons + heatmap + KPIs, `symbolInfo` name, Scanner table + top-opps) with `baseTicker()` so `BTC/USDT` shows `BTC` not `BTCT`.
- `tvLink()` now strips the slash to the TradingView ticker form (`BTCUSDT`), bare base defaults to USD — was hardcoding `+ 'USD'`.
- `toSlash()` broadened to attach the longest-matching allowed quote (so bare `BTCUSDT` → `BTC/USDT`); reused it for the Scanner open-positions normalizer (`_msOpenPosSyms`), replacing an inline `/USD`-only regex.
- Footer → v2026-06-19.3.

**Order/format note:** order symbols still use `sym.replace("/","")` (`BTC/USDT`→`BTCUSDT`), the correct Alpaca order form. Caps for non-USD quotes fall back to default by design (user accepted).

**Verified:** dashboard inline `<script>` → `new Function()` syntax check 0 errors; a standalone Node harness replicating the universe classifier, `baseTicker`, `toSlash`, `tvLink` base, and `addWatchlistSymbol` normalization passed all 27 assertions (BTC/USDT & ETH/USDC kept, BTC/BTC & DAI/USDT dropped, USDT/USD sidelined as stablecoin, bare forms normalized, FOO/EUR rejected). Docs updated (CLAUDE.md roadmap cleared + Settings/Scanner USD-only claims corrected, README, glossary, dashboard_layout changelog). Roadmap cleared.

### 2026-06-19 — Roadmap: stablecoin filter on the symbol selector (v2026-06-19.2)

Rescan roadmap. One item: "Add a stablecoin filter to the symbol selector dialog." The symbol selector is the Settings → 📋 Active Watchlist add-symbol control (`<input list="watchlistSymbolOptions">` + `<datalist>`), fed by `getCryptoUniverse()`, which since 2026-06-17 *unconditionally* drops stablecoin bases (`STABLECOIN_BASES`). The roadmap asks to make that a user-controllable filter.

**Decision:** add a **Show stablecoins** checkbox (default **off**, so current behaviour is preserved) that opts stablecoin pairs back into the dropdown only — scans, Market Overview, and the scan universe must stay stablecoin-free (a USDT/USD "pair" is never a tradeable setup).

**Implementation (`docs/dashboard_professional.html`):**
- HTML: new `#watchlistShowStable` checkbox next to the watchlist add control, `onchange="populateWatchlistOptions()"`.
- `getCryptoUniverse()`: stablecoin bases that were previously just dropped are now *collected* into a new module-level `_stablecoinUniverse` (via local `stable`/`stableSeen`), set alongside `_cryptoUniverse` only on a real non-empty build. Fallback path leaves it empty (no stablecoins in TOP30).
- New `getStablecoinPairs()` — `await getCryptoUniverse()` then returns `_stablecoinUniverse`.
- `populateWatchlistOptions()`: when the checkbox is checked, appends `getStablecoinPairs()` to the symbols before filtering out already-added ones. Manual free-text entry unchanged.
- Footer bumped to v2026-06-19.2.

**Scope kept minimal:** the trading universe (`getCryptoUniverse()` return value used by Scanner/Market Overview/scan slice) is unchanged — stablecoins never enter scans. The filter is a session toggle (not persisted) defaulting to the prior hidden behaviour.

**Verified:** dashboard inline `<script>` → `new Function()` syntax check 0 errors. Docs updated (CLAUDE.md Settings row + roadmap cleared, README, glossary, dashboard_layout changelog). Roadmap cleared.

### 2026-06-19 — Roadmap: loosen gates + 4H swing-low stop, and a Scalping page (v2026-06-19.1)

Rescan roadmap. Two items: (1) "loosen the very strict trade gates and change the 5% hard stop loss to a stop loss based on previous range lows e.g. on the 4H timeframe"; (2) "add a scalping page that trades on low timeframes (5m/15m/1h) using the same indicators." Decisions taken via question prompt: scalp page = **scanner + manual Buy/Sell** (no new auto-loop); stop = **lowest low of last 20×4H bars ×0.999, clamped ≤8%**, fixed-% fallback; gates = **Moderate + regime**.

> Note: an earlier pass this session implemented the *previous* roadmap wording (ATR-based stop) but the working tree was reverted to pristine before this pass; the roadmap was then rewritten to the range-low spec above. This entry reflects the final swing-low implementation.

**Item 1 — gates + swing-low stop.**
- `config.json`: `strategy.buy_score_threshold` 4.0→3.5, `buy_score_half_size_threshold` 3.0→2.5, new `downtrend_long_score_threshold` 4.0; `risk.max_open_positions` 3→4, `max_positions_per_tier` 2→3; new `risk.stop_loss_mode="swing_low_4h"`, `swing_low_lookback_bars=20`, `swing_low_buffer_pct=0.001`, `swing_low_max_stop_pct=0.08` (kept `stop_loss_pct=0.05` as fallback).
- `risk.py`: added `swing_low_stop_price(entry, lows_4h, …)` (lowest low of window ×(1−buffer), clamped to ≤max_stop_pct below entry; returns None when <5 bars or stop ≥ entry so caller falls back). `should_stop_out(entry, current, stop_price=None)` now takes an explicit stop price (falls back to fixed % when None). New consts `STOP_LOSS_MODE`, `SWING_LOW_*`. Updated docstring, self-checks (swing-low + clamp + correlation 4/4 & 3/3), prints. `rebalance.py` calls `should_stop_out(entry, cur)` with no stop_price → uses fixed-% fallback (no 4H bars there) — left unchanged, backward-compatible.
- `run_evaluation.py`: captures `decision["lows_4h"]` from the 4H fetch; hard-stop computes `swing_low_stop_price` and passes it to `should_stop_out`; new `DOWNTREND_LONG_SCORE`; long-entry block allows uptrend/mixed at ≥2.5 (half) / ≥3.5 (full) and a half-size counter-trend long in a downtrend at ≥4.0; updated docstring, downtrend message, startup print.
- Dashboard parity (`dashboard_professional.html`): added shared consts `SIGNAL_BUY_SCORE=3.5` / `SIGNAL_HALF_SCORE=2.5` / `SIGNAL_DOWNTREND_LONG_SCORE=4.0` + `swingLowStop4h()` helper (mirrors Python). Updated every signal-score display to the consts (renderScoreDist buckets/labels, Signals notification + scoreBar + actionPill + quick-buy gate, gap-scanner `signalScore` color, Market-Overview color, Scanner KPIs/labels/scoreBar/msActionPill, top-opps filter, watch button, `portActionChip`). Autopilot: thresholds 3.5/2.5, downtrend half-long ≥4, max 4/3, **4H swing-low exit** (fixed-% fallback), half-size sizing. Conviction (gap) score left untouched per the parity rule. Relabeled Command hard-rules stop row + Positions stop tooltips as 4H-swing-low reference. **`barsStart`/`barsEnd` gained `5Min`/`1Hour`** so the scalp window + in-progress-bar cutoff are correct.

**Item 2 — Scalping tab.** New nav button under ⚡ Trade (`switchTab('scalp')`, id `scalp`, in `TAB_ORDER`, no auto-run). Page `page-scalp`: TF selector (5/15/60-min), ▶ Scan, KPIs, shared score-distribution tile, and a table (score, pill, RSI, ATR, regime, Buy/Sell). `loadScalp()` maps the TF down a notch via `SCALP_TF_MAP` (5m→5m·1h·4h, 15m→15m·1h·4h, 1h→1h·4h·1D) and runs the **same `calcSignalScore`** on those bars; `scalpActionPill` reuses the shared gates; Buy/Sell open `openTradeModal`. Manual tickets only — no autonomous scalp loop.

**Verified:** `python scripts/risk.py` → all self-checks pass; `ast.parse` + guarded `import run_evaluation` OK; dashboard inline `<script>` → `new Function()` syntax check 0 errors. Footer v2026-06-19.1. Roadmap cleared.

**Known characteristic:** sizing still uses 1.5×ATR for the qty calc while the exit stop is the 4H range low — realized risk can differ from a strict 1% when the range low sits farther/closer than 1.5×ATR (bounded by the 8% clamp). Documented in CLAUDE.md.

### 2026-06-18 — Roadmap: last 3 Autopilot-log messages under the trading-status word (v2026-06-18.4)

Rescan roadmap. Bugs list empty; sole roadmap item: *"add the last 3 messages from the Autopilot log to the tradingstatus window/div."*

**Implementation (`docs/dashboard_professional.html`):**
- Added `#tradingStatusLog` directly under the big `#tradingStatus` permission word in the Command Center (centered, monospace 11px). Kept it a **separate sibling** because `renderCommand()` sets `$("tradingStatus").textContent`, which would wipe any child nodes.
- New `apRenderStatusLog()` renders the **last 3** entries from the Autopilot log (`apGetLog().slice(-3).reverse()`, newest-first) using the same `{t, [KIND], m}` formatting + colour map (`entry`/`exit`/`block`/`error`/`info`) as the full `#apLog`. Empty log → empty string (no clutter in the Connect-Alpaca state).
- Hooked it into `apRenderLog()` (one extra call at the end) so it stays in sync automatically: `apRenderLog()` already fires after every `apLog()` push **and** on autopilot init (line ~6745), so no other wiring was needed.

**Verified:** extracted the inline `<script>`s and validated each via `vm.Script` (`node`) → 2 scripts checked, 0 errors. Function declarations (`apRenderStatusLog`, `apGetLog`) are hoisted so the init-time `apRenderLog()` call resolves them. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-18.4.

### 2026-06-18 — Roadmap: latest 2 activities in the Command-center permission area (v2026-06-18.3)

Rescan roadmap. Bugs list empty; sole roadmap item: *"Show the latest 2 activities in the command center in the trade permissions area. Put it in the top left corner of the area."*

**Implementation (`docs/dashboard_professional.html`):**
- `loadContext()` already fetches the FILL activity feed (`/v2/account/activities?activity_type=FILL&page_size=100&sort=desc`, newest-first) but only used it for `computeFifoStats`. Added the raw `activities` array to the returned context object so renderers can reuse it (no extra API call).
- Added a `#recentActivities` block to the **🚦 Trading Permission Rules** panel, placed **above** `#permissionRules` (top-left of the panel), `text-align:left`.
- `renderCommand(c)` now renders a **Latest Activity** label + the latest 2 FILL activities (`c.activities.slice(0,2)`): time formatted GMT+2 via `Etc/GMT-2` (`MMM dd HH:mm`), colour-coded side (BUY green / SELL red), qty, `tvLink(toSlash(symbol))`, and `$price`. Empty feed shows "No recent activity."

**Verified:** extracted the inline `<script>`s and validated each via `vm.Script` (`node`) → 2 scripts checked, 0 errors. Confirmed helpers (`fmt`, `tvLink`, `toSlash`) and the `c` context param are in scope at the call site. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-18.3.

### 2026-06-18 — Bug (follow-up): scanner returns only 33 symbols while Max Symbols = 60 (v2026-06-18.2)

Rescan roadmap. User sharpened the bug after v2026-06-18.1: *"The market and signal scanner still only return 33 symbols while the setting is set higher for example 60."*

**Investigation:** After the v2026-06-18.1 fix (no longer caching the `TOP30_SYMBOLS` fallback), `getCryptoUniverse()` now correctly resolves Alpaca's full tradable-crypto list. The result is ~33 because **Alpaca only offers ~20–33 USD-quoted (`*/USD`) crypto pairs** — its other pairs (~56 total trading pairs) are quoted in USDT / USDC / BTC, which the dashboard deliberately drops (the entire bot — caps, positions, evaluation — is USD-only). Confirmed via Alpaca support docs (≈21–33 USD pairs vs 56 total). So 60 is unreachable with USD pairs; **this is a real exchange ceiling, not a code defect.** No local API credentials were available (`.env` absent, env vars unset), so the universe size couldn't be queried directly — relied on Alpaca's published pair list.

**Decision (asked the user):** chose **"Make the UI honest"** over broadening the universe to USDT/USDC pairs (which would surface signals the USD-only strategy can't act on).

**Fix (`docs/dashboard_professional.html`):**
- `updateScanBtnLabel()` now clamps the displayed count to `_cryptoUniverse.length` when known: shows `▶ Scan Top <universe> (all available)` when Max Symbols exceeds the universe, else `▶ Scan Top <min(n, universe)>`. Falls back to the raw `n` before the universe has loaded.
- Scanner (`loadMarketSignals`) final status appends, when `maxSyms > universe.length`: "Max Symbols (N) exceeds the M tradable USD pairs Alpaca offers — scanning all available".
- Market Overview (`loadMarketOverview`) status appends the analogous note.

**Verified:** extracted the single inline `<script>` and ran `node --check` → SYNTAX OK. `_cryptoUniverse`, `universe`, and `maxSyms` confirmed in scope at each edit site. Footer v2026-06-18.2. Bug cleared from `CLAUDE.md`.

### 2026-06-18 — Bug: fewer symbols scanned than the Max Symbols setting (v2026-06-18.1)

Rescan roadmap. Roadmap empty; sole open bug: *"There are less symbols scanned than in the max. symbols setting specified."*

**Root cause (`docs/dashboard_professional.html` › `getCryptoUniverse()`):** the function caches the tradable-crypto universe in `_cryptoUniverse` on first call (`if (_cryptoUniverse) return _cryptoUniverse`). The old code also cached the **`TOP30_SYMBOLS` fallback** whenever the `/v2/assets` call failed or returned nothing. `getCryptoUniverse()` first runs on page load via `loadSettings()` → `renderWatchlistTags()` → `populateWatchlistOptions()` — which can fire before credentials are seeded (or during a transient network hiccup). When that happened, the 30-symbol fallback was cached for the whole session, so every later Scanner / Market Overview scan computed `universe.slice(0, maxSyms)` against only 30 symbols. With Max Symbols set above 30 the scan silently returned fewer than requested — the reported bug.

**Fix:** only cache a **real, non-empty** assets result; on failure/empty, return the `TOP30_SYMBOLS` fallback **without** assigning it to `_cryptoUniverse`, so the next call retries and can pick up the full universe once credentials/network recover. The fallback path still populates `_universeRank` from the 30 symbols so any rendering in the meantime shows real ranks.

**Verified:** extracted the single inline `<script>` and ran `node --check` → SYNTAX OK. Confirmed `_cryptoUniverse` stays `null` on the fallback path (so retries happen) and is set only on a non-empty real result. Footer bumped to v2026-06-18.1. Bug cleared from `CLAUDE.md`.

### 2026-06-17 — Roadmap: Scanner score-distribution tile matches Signals page (v2026-06-17.22)

Rescan roadmap. Sole item: "Use the same score distribution tile in the Scanner tab as in the Signals page."

**Problem:** The two tabs rendered score distribution differently. The Signals tab (`#scoreDist`) showed a **bucketed horizontal-bar tile** (≥4 BUY / 3–3.9 HALF / 0.5–2.9 HOLD / −2.9–0 HOLD / ≤−3 BEAR, colour-coded, with count + bar). The Market → Scanner sub-tab (`#msScoreDist`) showed a **compact per-integer inline list** (`+4: 3  +3: 1 …`) keyed on exact integer scores — so it also mis-bucketed fractional scores like 3.5.

**Fix (`docs/dashboard_professional.html`):** Extracted the Signals tile rendering into a shared helper `renderScoreDist(elId, scores)` (defined just above `loadSignals`) containing the exact bucket logic + markup. Replaced the Signals inline block (≈28 lines) with `renderScoreDist("scoreDist", scores)` and the Scanner inline block with `renderScoreDist("msScoreDist", valid.map(r=>r.score).filter(s=>s!==null))`. Both tabs now render the identical tile, and the Scanner correctly handles fractional scores. No orphaned variables (old local `dist`/`total`/`distEl` removed with their blocks).

**Verified:** extracted the inline `<script>` and ran `node --check` → SYNTAX OK; confirmed `scores` (loadSignals) and `valid` (loadMarketSignals) are in scope at the call sites. Roadmap cleared. Footer v2026-06-17.22.

### 2026-06-17 — Roadmap: remove duplicate KPI + new 🧠 Behavioral Insights tab (v2026-06-17.21)

Implemented the two-item roadmap the user added to `CLAUDE.md` ("start roadmap"). Decisions taken via the question prompt: remove obvious duplicates at discretion; behavioral insights as a **new top-level nav tab**; rule-breaks computed **best-effort from trade history**.

**Item 1 — remove redundant/duplicate/low-impact metrics.** Audited every `kpi()` block. Removed the one clearly-misplaced visible duplicate: the **"Filled Orders" tile on the Performance tab** (labelled "Recent order sample" — an order-count metric that duplicates the Execution tab and doesn't belong in performance stats). Deliberately preserved the other apparent overlaps because they're legitimate: Current Drawdown / Open Risk appear on both Command (summary cockpit) and Risk (detail) — a standard summary-vs-detail pattern; Win Rate / Profit Factor on P&L vs Backtest are documented as **intentional parity** (`computeFifoStats()` so they can't diverge). The `positionKpis` "Open Risk" lives in the **defunct, null-guarded Positions render** (no longer mounted) so it's invisible — left untouched rather than editing dead code.

**Item 2 — 🧠 Behavioral Insights tab.** New top-level tab (`page-insights`, nav button in the **📊 Analysis** section, id `insights`, deep link `#insights`, added to `TAB_ORDER`; manual ▶ Analyze, no auto-run — same on-demand pattern as Edge/Markov). New JS (`loadInsights`, `insRoundTrips`, `insStmt`, `insGap`) placed right after `loadEdge`. `insRoundTrips()` is a dedicated FIFO matcher (kept separate from `computeFifoStats`/`edgeFifoTrades` to avoid touching the shared engines) that returns round-trips carrying `pnl`, entry `cost`, `pnlPct`, `entryT`, `exitT`, sorted chronologically by exit. Four insight cards + 3 KPI tiles:
- **🗓 Day-of-Week Edge** — per-weekday win rate + net P&L (GMT+2 exit time); flags the worst consistently-losing weekday ("You trade worse on Tuesdays").
- **📉 After Losing Streaks** — win-rate baseline vs after-1-loss vs after-2+-consecutive-losses; flags a ≥5pt drop ("win rate drops after 2 losses").
- **🔁 Cadence After Outcome** — median hours to the next entry after a win vs after a loss; flags shorter post-win gap ("overtrade after wins").
- **⚠ Rule Discipline** — best-effort rule-break detection: −5% hard-stop breaches (realized loss% < −5) + per-symbol cap breaches (entry cost > `portCapFor(sym)`% × *current* equity, labelled approximate). KPI "Rule Breaches" surfaces the count and same-day stop breaches.

**Verified:** extracted the inline `<script>` and ran `node --check` → SYNTAX OK; unit-tested `insRoundTrips` + streak/cadence/breach logic on synthetic fills (5 round-trips −6/−4/+2.1/+10/+1.8%): FIFO correct, baseline 3/4 vs after-2-loss 1/1, 1 stop breach (BTC −6%, ETH −4% correctly not flagged), cadence medians sane. `getSettings().apiKey` guard mirrors `loadEdge`. Roadmap cleared in `CLAUDE.md`. Footer v2026-06-17.21.

### 2026-06-17 — Layout/style consistency sweep (v2026-06-17.20)

Request: "check the dashboard for any inconsistencies in layout and style" → "proceed". Reviewed the CSS + markup of `docs/dashboard_professional.html` and fixed seven defects:

1. **Undefined `--fg`** — `.footer-name` used `color:var(--fg)` (no such token; palette defines `--text`), so the footer project name silently fell back to muted grey. Changed to `var(--text)`.
2. **Invisible `.spinner`** — five portfolio loading states (`<span class="spinner">` in Portfolio Overview + Allocation) referenced a class that was never defined → empty span. Added a real spinner (`width/height:13px`, border ring, `border-top-color:var(--blue)`, `animation:spin .7s linear infinite`) plus `@keyframes spin`.
3. **Undefined `.error-box`** — the two portfolio error containers (`#portErrorBox`, `#portDistErrorBox`) used `class="error-box"` (undefined) → unstyled text. Switched both to the existing `.error` red box. JS still toggles `display`/`textContent`, so no JS change needed.
4. **Dead/duplicate `.score-pip`** — base `.score-pip` was defined twice; the `.on-pos/.on-neg/.on-half` variants were unused (renderer `portScoreBar` only emits `.on`). Removed the first base + the three dead variants; the still-used base (`.score-pip`/`.on`/`.neg`) remains.
5. **Hardcoded, non-theme-aware hover greys** — `.btn:hover`/`th:hover` used `#222b3a` and `th.port-sortable:hover` used `#21262d`; neither adapted to light theme (only `.btn`/inputs were overridden), so hovering a table header in light mode flashed dark, and the two sortable-header shades disagreed. Added a `--hover` token (`#222b3a` dark / `#e2e7ed` light) and pointed all three at it; removed the now-redundant light-theme `.btn:hover` override.
6. **`.period-btns` had no CSS** — Portfolio Overview's period-button wrapper was undefined while the Performance row used inline `display:flex;gap:6px`. Added `.period-btns { display:flex; gap:6px; flex-wrap:wrap; }`.
7. **Breakout-card symbol off-pattern** — the `gg-card` symbol was an inline-styled `<span>`, not a TradingView link (CLAUDE.md: every symbol label is a `tvLink()` anchor). Changed to `<span class="symbol" style="font-size:20px">${tvLink(a.symbol)}</span>`.

Left as intentional: `.subtab-btn` font-weight (600) is deliberately lighter than `.tab-btn` (850) for nav hierarchy.

**Verified:** grep confirms 0 remaining `var(--fg)`, `error-box`, `on-pos/on-half`, and only the `--hover` token definition retains the `#222b3a` literal. Footer bumped to v2026-06-17.20.

### 2026-06-17 — Memory consolidation: merged projects file into single `memory/memory.md`

Merged `memory/projects/alpaca-trading-agent.md` into `memory/memory.md` so the project has **one** memory file (request: "memory.md is the single memory file for the whole project"). The projects file was the comprehensive superset (metadata, architecture, schedule, full session history, dashboard reference, API/indicator notes); the old `memory.md` changelog was a near-duplicate subset. Folded in the one entry unique to the old changelog ("buttons/links not reacting" orphan-`else` syntax fix), fixed the architecture tree to show the single file, then copied the superset over `memory/memory.md` and deleted `memory/projects/` (`git rm`). Updated the three live path references in `CLAUDE.md` (roadmap note, standing rule, doc-update list) from `memory/projects/alpaca-trading-agent.md` → `memory/memory.md`. Historical references inside dated changelog entries and `data/market_research/` reports left intact as accurate records. Verified: 708-line merged file, projects folder gone, no stale live refs.

### 2026-06-17 — Roadmap: portfolio overview tiles horizontal (v2026-06-17.19)

Rescan roadmap. Sole item: "Align the tiles in the portfolio overview page horizontally instead of vertically."

**Problem:** The account-overview tiles use `<div class="cards">` as their container, but there was **no `.cards` CSS rule** anywhere in `dashboard_professional.html`. With no `display`, the wrapper was a plain block and the six `.card` children stacked vertically (one per row) on the Portfolio Overview tab (and the five summary cards on the Allocation tab).

**Fix (`docs/dashboard_professional.html`):** Added a responsive grid rule next to `.grid-2`/`.grid-3`: `.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }`. The tiles now flow horizontally and wrap responsively. Both `.cards` instances (Portfolio Overview "Account Overview" and Allocation "Portfolio Allocation" summaries) are fixed by the single rule.

**Verified:** `.cards` had zero prior CSS matches, so the new rule introduces no override conflict; only the two portfolio-tab containers use the class, both intended to be horizontal. Roadmap is now empty. Footer v2026-06-17.19.

### 2026-06-17 — Roadmap: ticker strip follows the active watchlist (v2026-06-17.18)

Rescan roadmap. Sole remaining item: "On the command center page, make sure that the tickers are showing symbols from the watchlist."

**Problem:** The top-of-page live ticker strip (`loadTickerStrip()`) used a hardcoded 10-symbol `WATCH = ["BTC/USD",…,"AAVE/USD"]` array — identical to the old default but ignoring whatever the user configured in the Settings watchlist. So adding/removing watchlist symbols never changed the ticker.

**Fix (`docs/dashboard_professional.html`):** `loadTickerStrip()` now calls `getWatchlist()` (the same source the Signals tab, Autopilot, and journal already use) and returns early on an empty list. To avoid a up-to-15 s lag after editing the watchlist, `saveWatchlistData()` now also calls `loadTickerStrip()` (guarded by `typeof … === "function"`) so the ticker re-renders immediately on every add/remove/reset. `loadTickerStrip` is best-effort and guards on missing API keys, so the call is safe during early init.

**Verified:** `getWatchlist()` is a hoisted function declaration available to `loadTickerStrip` regardless of source order; watchlist max is 20, well within the snapshots endpoint limit. Roadmap is now empty. Footer v2026-06-17.18.

### 2026-06-17 — Roadmap: Analytics parent tab (Performance+P&L+Edge), drop Positions; Bug: Signals duplication (v2026-06-17.17)

Rescan roadmap, all items confirmed. Bug fixed first (rule 0), then both roadmap items.

**Bug 1 — "Signals" appeared as both a top-level menu item and a Market sub-tab.** Renamed the Market tab's full-universe scanner sub-tab from **🔭 Signals → 🔭 Scanner** (button label + Overview cross-link "View matching signals →" → "View scanner →"). Sub-id stays `market-signals` and the `#market-signals` deep link is unchanged — non-destructive. Now "Signals" names only the watchlist tab (action/execute); "Scanner" is the universe confluence scan (+ watchlist add/remove). Both tools kept — they serve different workflows, so neither was removed.

**Roadmap 1 — merge Performance + P&L + Edge into one 🔬 Analytics tab.** Generalised the Market sub-tab machinery into a reusable system: CSS `.market-subnav`/`.market-subpage` renamed to `.subnav`/`.subpage` (shared); new generic `_activateSubTab(parentId, subId)` scopes the `.subpage`/`.subtab-btn` toggling to `#page-<parent>` so Market and Analytics never clash; button ids unified to `subtab-<subId>` (Market's `msubtab-*` renamed). `marketSubTab`/`analyticsSubTab` are thin wrappers over it. New `ANALYTICS_SUBS = ["performance","pnl","edge"]`, `_analyticsSub`. The three former top-level pages were physically relocated (via a Node div-depth-counting script) into a new `page-analytics` as `subpage-performance/pnl/edge`; nav shows one **🔬 Analytics** button in a renamed **📊 Analysis** section (with Backtest + Markov). `switchTab()` redirect + `applyTabFromUrl()` `SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS)` keep `#performance`/`#pnl`/`#edge` deep links + keyboard working. Performance auto-loads (`refreshCurrent`→`loadDashboard`→`renderPerformance`); P&L on select (`loadPnl`); Edge manual.

**Roadmap 2 — drop standalone Positions.** Removed the `page-positions` block + its nav button (positions table already exists in Portfolio Overview). `renderPositions` is retained (still called by `loadDashboard` via the wrapper that caches `_lastPositions`/`_lastEquity` for the Risk concentration panel + positions CSV export), but its two DOM writes (`positionKpis`/`positionsBody`) are now null-guarded so they no-op with the page gone. The `exportCsv("positions")` branch is now unreachable (no button wired) but left in the still-used `exportCsv` function — harmless, no churn.

**Nav now:** 🧭 Command · ⚡ Trade [Signals · Market · Execution] · 💼 Portfolio [Overview · Allocation · Risk] · 📊 Analysis [🔬 Analytics · Backtest vs Live · Markov] · ⚙ Settings. Keyboard `TAB_ORDER` updated.

**Verified:** inline-script parse clean (0 errors); whole-document div-balanced (459/459); `subpage-performance/pnl/edge` nested inside `page-analytics`; no stale `page-positions`/`page-performance`/`page-pnl`/`page-edge` ids; no `.market-subpage`/`msubtab-` left; 11 nav buttons + 3 section labels; no dead `switchTab('positions'…)` links. Footer v2026-06-17.17.

### 2026-06-17 — Roadmap: regroup nav into Trade/Portfolio/Analytics + fold Breakout into Market tab (v2026-06-17.16)

Owner accepted the nav-IA advice and added it as a roadmap item. Implemented the two parts of the pasted target menu; the two leftover consolidation bullets (merge Performance+P&L+Edge; drop standalone Positions) stay on the roadmap pending sign-off since they change tab behavior/URLs.

**Nav regrouping (menu-only, no behavior change).** Reordered the sidebar `<nav>` and added two `.nav-section-label` headers so all tabs sit under labelled groups: **🧭 Command** (ungrouped, top) · **⚡ Trade** (Signals, Market, Execution) · **💼 Portfolio** (Overview [renamed from "Portfolio Overview"], Positions, Allocation, Risk) · **🔬 Analytics** (Performance, P&L, Backtest vs Live, Edge, Markov) · **⚙ Settings** (ungrouped, bottom, `margin-top:14px`). Act → Hold → Analyze flow. Kept Edge's 🔬 emoji (the pasted target showed 🧭, which collides with Command). No id/onclick changed, so `validTabIds()`/`tabBtnFor()`/routing are untouched. Updated the keyboard `TAB_ORDER` to the new visual order (keys 1-9).

**Breakout Scanner folded into the Market tab as a third sub-tab.** Moved the former standalone `page-gapgo` content into `page-market` as `subpage-gapgo` (class `market-subpage`), added a third sub-tab button `msubtab-gapgo` ("📊 Breakout") to `.market-subnav`, and removed the top-level Breakout nav button. New `const MARKET_SUBS = ["market-overview","market-signals","gapgo"]` is the single source of truth: `marketSubTab()` validates against it, `applyTabFromUrl()` uses `SUBS = MARKET_SUBS`, and `switchTab()` gained a guard at the top that redirects any of the three sub-ids to the parent (`market`) + sub-tab — so keyboard shortcuts, the `#gapgo` deep link, and any legacy `switchTab('gapgo')` keep working. Removed the now-dead `else if (id === "gapgo")` branch. Breakout stays manual (▶ Run Analysis); added a "← Back to market context" cross-link in its toolbar. The sub-tab buttons were also shortened to "Overview / Signals / Breakout" (the parent is already "Market").

**Verified:** inline-script parse clean (`new Function`, 0 errors); `page-market` div-balanced (33/33) with all three sub-pages; nav has 14 tab buttons + 3 section labels; no stale `page-gapgo`/`switchTab('gapgo')` page refs remain (only the moved markup + `loadGapGo` internals + the intentional redirect comment). Footer v2026-06-17.16.

### 2026-06-17 — Roadmap: merge Market Overview+Signals into one tabbed page + Market Signals watchlist buttons (v2026-06-17.15)

Rescan roadmap → implemented the two well-specified items. The third ("add applied Indicators in the left pane to the top pane") was **dropped per the owner** — it belonged to a separate charting project, not this dashboard (which has no chart/indicator pane). Roadmap now empty.

**Roadmap 2 — single tabbed parent for Market Overview + Market Signals.** Replaced the two sidebar nav buttons with one **🌐 Market** button (`switchTab('market')` → `page-market`). The two former pages are now `.market-subpage` divs (`subpage-market-overview`, `subpage-market-signals`) inside `page-market`, switched by a sub-tab bar (`.market-subnav` / `.subtab-btn`) via new `marketSubTab(subId)`. `marketSubTab` toggles the sub-pages + sub-tab buttons, writes the precise sub-tab id to the URL hash and `localStorage.lastTab` (so old deep links `#market-overview` / `#market-signals` still resolve), lazy-loads Overview (manual Signals), and stores `_marketSub` so `switchTab('market')` restores the last sub-tab. `applyTabFromUrl()` gained a `SUBS` list that recognises the two sub-ids from hash or stored value and opens the parent + sub-tab (sets `_marketSub` first to avoid a wasted Overview load when deep-linking to Signals). Cross-links added: Overview header "View matching signals →" and Signals header "← Back to market context". CSS: `.market-subnav`, `.subtab-btn`(+`.active`), `.market-subpage`(+`.active`). Selection state persists because both sub-pages keep their DOM.

**Roadmap 1 — per-symbol watchlist Add/Remove on Market Signals.** Added a **Watchlist** column (header + colspans 13→14, error-row inner colspan 10→11). `msWatchlistCell(row)`: **+ Watch** when score ≥ 4 and symbol not on watchlist; **– Unwatch** when score ≤ −2 (sell) and no open position; else "✓ watched" / "–" (and "full" at the 20-symbol cap). `loadMarketSignals()` now fetches `/v2/positions` into `_msOpenPosSyms` (normalised to `BASE/USD`) to gate the remove button, and caches `_msLastRows`. Buttons → `msAddWatch`/`msRemoveWatch`, which mutate the shared watchlist (`saveWatchlistData` + `renderWatchlistTags`) and re-render only the watchlist cells (`renderMsWatchlistCells()`, cells keyed `mswl-<alpSym>`) — no rescan. Reuses existing `trade-action-btn`/`trade-close-btn` styles.

**Verified:** inline-script parse clean (`new Function` over the extracted script block, 0 errors); `page-market` segment div-balanced (24 open / 24 close) with both sub-pages + sub-nav present; column counts reconciled (14 data tds = 14 headers; error row 3 + 11). Footer bumped to v2026-06-17.15. Roadmap items 1 & 2 cleared from CLAUDE.md; item 3 flagged for clarification.

### 2026-06-17 — Bugs: exclude stablecoins from scans + fix false "Over Cap" badge (v2026-06-17.14)

New workflow rule 8 added to CLAUDE.md: a "rescan roadmap" request must **implement** the roadmap items and **fix** the listed bugs, not just report status.

**Bug 1 — stablecoins in symbol scans.** `getCryptoUniverse()` kept every `*/USD` pair, so `USDT/USD`, `USDC/USD`, etc. (stablecoins priced in dollars — never tradeable setups) appeared in Market Signals, Market Overview, and the Settings watchlist dropdown. Fix: added a `STABLECOIN_BASES` set (USDT, USDC, DAI, USDP, PYUSD, TUSD, BUSD, GUSD, USDG, FDUSD, USDD, FRAX, LUSD, USTC) and skip any pair whose base is in it (`STABLECOIN_BASES[sym.slice(0,-4)]`). Fixed at the source, so every consumer of `getCryptoUniverse()` is covered.

**Bug 2 — false "Over Cap" badge at exactly 100%.** In the Allocation tab's cap-utilisation table, `utilPct` was clamped with `Math.min(...,100)` for the text while `isOver = curPct > capPct` used the raw value. A position fractionally over cap (e.g. 100.3%) displayed "100% of cap used" yet showed "⚠ Over Cap" — a visible contradiction. Fix: `utilPct` is now the true un-clamped utilisation, `isOver = Math.round(utilPct) > 100`, and the progress-bar width is clamped separately (`Math.min(utilPct,100)`). The badge now always agrees with the displayed "% of cap used": at-cap → Near Cap, only >100% rounded → Over Cap.

**Verified:** Bug 1 — base-slice logic handles both `USDT/USD` and bare `USDCUSD` (normalized first). Bug 2 — walked the boundary cases: 100.4% → round 100 → Near Cap / "100% of cap used"; 100.6% → round 101 → Over Cap / "101% of cap used". Footer v2026-06-17.14. Both items moved out of CLAUDE.md's Roadmap/Bugs lists.

### 2026-06-17 — Roadmap: single-line responsive footer + delete legacy portfolio-dashboard.html (v2026-06-17.13)

**Roadmap — footer on a single line depending on window size.** The footer was two stacked `.footer-row` divs (the `<footer>` was `flex-direction:column`). Flattened to a single `<footer>` flex row with `flex-wrap:wrap; align-items:baseline; gap:4px 14px` — all items (name · description · creator · last modified · version) sit on one line on wide windows and wrap naturally as the window narrows. Removed the now-unused `.footer-row` CSS rule and its mobile override; kept the `@media(max-width:700px)` footer padding tweak. Footer bumped to v2026-06-17.13.

**Deleted `docs/portfolio-dashboard.html`.** The legacy standalone dashboard (its tabs were merged into the Professional Dashboard on 2026-06-15) was removed at the user's request. Updated all current-state references (CLAUDE.md, README.md, this file's architecture tree, dashboard_layout.md) to note the deletion; historical changelog entries describing the original merge are left intact as the record.

**Verified:** Footer change is CSS + markup only, all required footer fields (description, creator, last-modified, version) retained. Surgical reference cleanup; no code logic touched.

### 2026-06-17 — Roadmap: Market Overview Buy/Sell buttons + Settings watchlist exchange dropdown (v2026-06-17.12)

Cleared the two open roadmap items (both completed; roadmap now empty).

**Roadmap 2 — Buy/Sell buttons on Market Overview rows.** Added a **Trade** column to the Market Overview table (header + all `colspan` placeholders bumped 9 → 10). New helper `moTradeButtons(row)` renders **Buy** / **Sell** buttons that call the existing shared `openTradeModal(orderSym, displaySym, side, '', price)` — order symbol in Alpaca `BTCUSD` format, qty left blank for the user to size, side + live price pre-filled. Shows `–` when the row has no live price. Reuses the same `trade-action-btn` / `trade-close-btn` classes as the Signals and Positions tabs, so no new modal/submit logic was needed.

**Roadmap 1 — Settings watchlist add via exchange dropdown.** Replaced the free-text `#watchlistAddInput` with an `<input list="watchlistSymbolOptions">` + `<datalist>` populated from the full tradable Alpaca crypto universe via new `populateWatchlistOptions()` → `getCryptoUniverse()`. User can pick from the exchange list or type to filter; already-added symbols are excluded. Called from `renderWatchlistTags()` so the dropdown re-syncs after add/remove/reset. Degrades gracefully to plain free-text entry if the assets call fails — the existing `addWatchlistSymbol()` still normalizes input to `BASE/USD`, so add/cap(20)/dedupe logic is untouched.

**Verified:** Surgical edits — header/colspan, one render-cell call, two new helper functions, one markup swap. Both features reuse existing, already-tested code paths (`openTradeModal`, `getCryptoUniverse`, `addWatchlistSymbol`). Footer bumped to v2026-06-17.12 / Last modified 2026-06-17.

### 2026-06-15 — Bug fix: Signals tab ignored Settings watchlist (v2026-06-15.11)

**Problem:** `loadSignals()` hardcoded `const SYMBOLS = ["BTC/USD",...]` — the 10 default symbols. Adding or removing symbols in the Settings watchlist had no effect on the Signals tab scan.  
**Fix:** Replaced the hardcoded array with `getWatchlist()` so the Signals tab now dynamically reads whatever symbols the user configured.  
**Verified:** Code change is surgical — one line. `SYMBOLS` is used throughout the function (bar fetches, correlation matrix, row iteration) so using `getWatchlist()` propagates correctly everywhere.

### 2026-06-15 — Bug fix: Total P&L in Performance tab (v2026-06-15.10)

**Problem:** After v2026-06-15.9, "Total P&L" pointed at `acct.unrealized_pl` (open-position paper gains) — still not matching the P&L tab which shows `fifoStats.totalPnl` (FIFO-realized P&L from FILL activities).  
**Fix:** Changed to `c.fifoStats.totalPnl` which is already computed in `loadContext()` via `computeFifoStats()` over the same 100-fill sample. Both tabs now use the same number.

### 2026-06-15 — Bug fix: Total P&L in Performance tab (v2026-06-15.9)

**Problem:** "Total P&L" in the Performance tab used equity-history subtraction (`equitySeries[last] - equitySeries[0]`), which measures equity change over the loaded 3-month window — different from Portfolio Overview's "Unrealized P&L" card which reads `acct.unrealized_pl`.  
**Fix:** Replaced `totalReturnCurrency` with `totalPL = parseFloat(c.acct.unrealized_pl ?? 0)`. The tooltip now says "Unrealized P&L — matches Portfolio Overview". Both tabs now display the same number from the same API field.

### 2026-06-15 — Bug fixes + Roadmap: score distribution, applySort, Total P&L (v2026-06-15.8)

**Bug fix — Score distribution (Signals tab):** Distribution bucket `else if (s <= 2)` sent score 2.5 to the BUY category. Fixed to `else if (s < 3)`. Labels updated to "0.5–2.9 (HOLD)" and "−2.9–0 (HOLD)". Dict key renamed from `1to2` → `1to3`. Version v2026-06-15.7.

**Bug fix — `applySort` / `numOrStr` not defined:** `portRenderPositions()` called `applySort()` (undefined), and the sort helpers in `portRenderDistTable` / `portRenderDistCap` called `numOrStr()` (also undefined). Added both as shared sort helpers before `portRenderPositions`: `numOrStr(v)` = `parseFloat(v)` if numeric else `String(v).toLowerCase()`; `applySort(arr, key, dir)` = shallow-copy sort via `numOrStr`. Portfolio Overview positions table now sorts correctly.

**Roadmap — Total P&L in currency (Performance tab):** `renderPerformance()` now computes `totalReturnCurrency = equitySeries[last] − equitySeries[0]` and adds (a) a **Total P&L** KPI tile (first in the `grid-3`) formatted as `+$X.XX` / `-$X.XX` with pos/neg colour, and (b) a "Total P&L ($)" row as the first entry in the Performance Summary table. Version v2026-06-15.8.

### 2026-06-15 — Roadmap 1–2 + Bugs 1–2 (v2026-06-15.6)

Four items completed in `docs/dashboard_professional.html`:

**Roadmap 1 — Remove "Watchlist — No Position":** Deleted the `<section>` with `portNoPosBody`, removed `portRenderWatchlistNoPos()` function and its 2 call sites in `portRenderPositions()`, removed the watchlist snapshot fetch block from `portLoadPositions()`, and removed `portWlSnaps` declaration.

**Roadmap 2 — Sort Signals tab descending by score:** Added `rows.sort((a, b) => ...)` before `signalBody.innerHTML` assignment in `loadSignals()`.

**Bug 1 — Market Overview Score column:** Two fixes: (a) `loadSignals()` now calls `Object.assign(_msPrevScores, newMap)` after saving `_prevScoreMap`; (b) Market Signals scan now calls `moApplySort()` if `_moData.length > 0` after updating `_msPrevScores`. Score column now populates from either Signals or Market Signals scans.

**Bug 2 — Score inconsistency in Breakout Scanner:** `loadGapGo()` now fetches 15-min and 4H bars via `fetchBars()` in the same `Promise.all`. Per symbol: maps bars to `{c,h,l,v}` and calls `calcSignalScore()`. Result attached as `ggA.signalScore`. In `ggRenderCards()`, added `ssColor`/`ssText` variables and rendered a **Signal /6** badge next to the existing Conviction score in each card header. Legend updated to clarify both metrics. Now consistent with Signals and Market Signals tabs.

### 2026-06-15 — Roadmap items 1–5: favicon, title, remove Orders/HotSymbols/MorningBrief

Applied all 5 remaining roadmap items to `docs/dashboard_professional.html` via a Python script (to avoid encoding corruption from PowerShell):
1. **Favicon** — Inline SVG candlestick chart (`data:image/svg+xml`), 3 candles on dark background. Added to `<head>` alongside updated `<title>`.
2. **Title** — Changed from "Professional Trader Dashboard" to "CryptoPro Dashboard".
3. **Remove Orders pane** — Deleted the `<!-- Orders -->` `<section>` from `page-port-overview`; removed `portFilterOrders`, `portSortOrd`, `portLoadOrders` JS; removed `portLoadOrders()` from `portLoadOverview`'s `Promise.all`; removed `portAllOrders`, `portOrdSort`, `PORT_STATUS_GROUPS` declarations.
4. **Remove Hot Symbols tab** — Deleted nav button, `page-port-hot` HTML, all Hot Symbols JS (`portWlCard`, `portSortHot`, `portRenderHot`, `portLoadCryptoWatchlist`, `portLoadHot`), and related vars (`portRawHotRows`, `portHotSort`).
5. **Remove Morning Brief** — Deleted nav button, header button, `page-port-brief` HTML, `#briefDocBackdrop` modal, and all Brief JS (`portLoadBrief`, `portSortBriefPos`, `portRenderBriefPos`, `portSortConf`, `portRenderConf`, `generateMorningBrief`, `closeBriefDoc`, `downloadBriefDoc`, `copyBriefDoc`); removed vars (`port_briefEquity`, `portRawBriefPos`, `portRawConfRows`, `portBriefPosSort`, `portConfSort`); fixed `switchTab`, `refreshCurrent`, `setInterval`, `setSortIcons` init calls.
Version: v2026-06-15.5. File: 7395 lines (down from 8070).

### 2026-06-15 — Bug fix: buttons/links not reacting on dashboard

**Problem:** After the drawdown-rule removal commit (c505713), a dangling `else` was left at the top level of `renderCommand()` — removing `if/else if (drawdown ≥ max/warn)` left its trailing `else add("Drawdown OK",...)` behind. An orphan `else` (no matching `if`) is a JavaScript **syntax error** that prevented the entire script block from being parsed, so no function declarations were hoisted and ALL onclick handlers (`switchTab`, `saveSettings`, etc.) were undefined — the "nothing reacts" symptom. Additionally `setSortIcons()` (present in the original `portfolio-dashboard.html`) was accidentally omitted during the portfolio merge, causing a `ReferenceError` that prevented the Port init block from completing.
**Fix 1:** Removed the orphan `else add("green", "Drawdown OK", ...)` line from `renderCommand()` (~line 3039).
**Fix 2:** Added `setSortIcons(headId, activeKey, dir)` before the Port init calls (uses the `port-sorted` CSS class).
**Verified:** if/else chain for daily-loss and open-risk checks is now valid; `setSortIcons` defined before its first call.

### 2026-06-15 — All 3 roadmap items completed

Three roadmap items completed in one session (items tackled in order: 2, 3, 1):

**Item 2: Merge portfolio-dashboard.html into dashboard_professional.html**
Roadmap item #2: merged `docs/portfolio-dashboard.html` into `docs/dashboard_professional.html` as four new nav tabs under a "💼 Portfolio" section label. Changes made surgically via Edit tool — no full rewrite.

**What was added:**
1. **CSS block** — All portfolio-specific CSS classes (`port-filter-btn`, `hot-stat`, `bar-track/fill`, `wl-card`, `port-period-btn`, `port-status-badge`, `health-*`, `alerts-box`, `conf-table`, `score-bar-pips`, `chip-*`, `pos-health-wrap`, `progress-bar`, `brief-*`, `sort-icon`, `port-sortable/sorted`) added before `</style>`.
2. **Header button** — `🌅 Morning Brief` button added next to `📓 Daily Journal` in the header, calls `generateMorningBrief()`.
3. **Nav section** — Four new tab buttons under a `💼 Portfolio` section label inserted before Settings: Portfolio Overview, Hot Symbols, Allocation, Morning Brief.
4. **Four portfolio pages** — `page-port-overview`, `page-port-hot`, `page-port-brief` (inline `<style>` dropped, CSS moved to global block), `page-port-dist` inserted before `page-settings`. All element IDs prefixed with `port`, all onclick handlers prefixed with `port`, `sortable/sorted/filter-btn` CSS classes prefixed with `port-`, `period-btn` class renamed to `port-period-btn`.
5. **Morning Brief modal** — `#briefDocBackdrop` inserted after the Daily Journal modal.
6. **Portfolio JavaScript block** — ~700 lines of portfolio JS (all functions prefixed `port*`): `portCapFor()` using existing `PORTFOLIO_CAPS`, account/chart/positions/orders loader, hot symbols, TA engine (standalone `portEmaSeries/portComputeRSI/portComputeMACD/portComputeBB/portVolumeRatio/portConfluenceScore`), brief loader, dist loader, morning brief doc generator (`generateMorningBrief`, `closeBriefDoc`, `downloadBriefDoc`, `copyBriefDoc`), 60-second auto-refresh interval for portfolio tabs.
7. **`switchTab` extension** — Added `port-overview/port-hot/port-dist/port-brief` branches.
8. **`refreshCurrent` extension** — Added same four branches so ⟳ Refresh works on portfolio tabs.

**Key design decisions:** `portCapFor(sym)` returns `PORTFOLIO_CAPS[sym] || 5` (percentage, not decimal) matching the pro dashboard's existing cap table. The portfolio's standalone TA functions do not conflict with the pro dashboard's `calcSignalScore` — they are prefixed and independent. The inline `<style>` block from `page-brief` was dropped and its CSS moved to the global `<style>` tag to avoid duplication.

**Verification:** All 23 key identifiers confirmed present (page IDs, function names, CSS classes, modal ID). Final file: 7971 lines.

**Footer redesign (Workflow rule 6)**
Replaced the single-line footer in `docs/dashboard_professional.html` with a two-row structured footer: row 1 = project name "CryptoPro Dashboard" + description; row 2 = Creator, Last modified date, Version (v2026-06-15.4). CSS: `.footer-row` flex wrap with mobile fallback. Roadmap cleared.

**Item 3: Remove 6% drawdown hard rule**
Removed the "current drawdown ≤ 6%, STOP trading" rule from `dashboard_professional.html`. Four locations cleaned: `DEFAULT_LIMITS` (removed `maxCurrentDrawdownPct`/`warningCurrentDrawdownPct`), the live hard-rules panel (removed the drawdown row), the permission-rules check, and the alerts block. The drawdown metric still renders on the Risk tab — only the trading halt was removed. Footer updated to v2026-06-15.2.

**Item 1: Watchlist management in Settings tab**
Added a `📋 Active Watchlist` section to the Settings tab: a tag editor (`#watchlistTagsEl`) showing up to 20 symbols as removable pills, an Add input field, and a Reset-to-defaults link. Storage key: `localStorage.proDashboardWatchlist`. New JS: `DEFAULT_WATCHLIST`, `getWatchlist()`, `saveWatchlistData()`, `renderWatchlistTags()`, `addWatchlistSymbol()`, `removeWatchlistSymbol(idx)`, `resetWatchlist()`. All three previous hardcoded arrays replaced: `JOURNAL_WL` → `getWatchlist()`, `AP_WATCHLIST` → `getApWatchlist()`, `PORT_CRYPTO_WL` → `getPortCryptoWL()`. `loadSettingsForm()` calls `renderWatchlistTags()`. Footer updated to v2026-06-15.3. CSS added: `.wl-tag-editor`, `.wl-sym-tag`, `.wl-sym-tag-x`.

### 2026-06-11 — Pro-trader review: scout, stop-clamp, shorts off, dashboard Autopilot + Edge
Professional-trader review of dashboard + project (focus: max profit, autonomy). Key context: account 100% cash ($95.4k), all 10 watchlist majors in confirmed downtrend (corr ~0.81), and Alpaca spot crypto **cannot be shorted** (every SHORT ever attempted was rejected; none filled). Five changes:
1. **Stop-loss self-rejection fix** — `trade.py` clamps a stale stop-loss limit to the nearest 0.5%-band edge of the fresh ask instead of rejecting (journals showed repeated AVAX/LINK stop rejections leaving positions exposed a full cycle). Tests in `tests/test_trade_stop_clamp.py`.
2. **Universe scout** — new `scripts/scout.py` + `config.json › scout` block: scans tradable non-watchlist `*/USD` pairs, daily-uptrend filter, full confluence, promotes top 3 (score ≥ 4) to `data/watchlist_dynamic.json` (atomic, TTL 6 h); merged in `run_evaluation.main()`. All existing gates apply (5% default cap, Tier-2 budget). Live test: scanned 26, promoted 0 (broad downtrend — correct). Tests in `tests/test_scout.py`.
3. **Shorts disabled** — `strategy.shorts_enabled=false` gates the SHORT entry branch in `run_evaluation.py` (venue unsupported); cover logic retained; HOLD reason now says "shorts disabled (venue unsupported)".
4. **Dashboard Autopilot panel (Command tab)** — autonomous in-browser loop, OFF-on-load, kill switch, all hard-rule gates, trailing HWM + activity log in localStorage.
5. **Dashboard Edge tab + short-UI removal** — FIFO realized-edge analytics; ⚡ Short buttons removed, SHORT pills → BEAR (informational).
Suite: 84/84 (3 new clamp + 3 new scout tests). Dry-run evaluation verified end-to-end on fresh data. NOTE: streaming file-tool edits on the mounted repo can truncate files (sync race) — all edits done via bash `python3` string-replace with asserts + `py_compile`/`node --check` verification; trade.py and run_evaluation.py were each restored from `git show HEAD` once.

### 2026-06-11 — Fix critical stale-bars bug in get_crypto_bars (sort=desc)
First market-researcher run (reports in `data/market_research/2026-06-11-1023-*.md`, both FAIL) found the live evaluation path was trading on stale data: `get_crypto_bars()` passed `start` (1.6× buffer) + `limit=N` without `sort`, and Alpaca returns ascending by default → the *first* N bars of the window. Daily bars ended 2026-04-18 (54 d stale), 4H 2026-05-17, 15-min ~30 h stale. Consequence: daily regime read "uptrend" from April data while all 10 watchlist symbols were in confirmed downtrend — longs permitted in mark-down, shorts blocked. Fix in `scripts/run_evaluation.py`: add `"sort": "desc"` to params and return `bars[::-1]` (chronological for indicators). `rebalance.py` delegated already; `research.py` had its own bare-`limit` `get_bars()` (found by the post-fix verification run) and now delegates its crypto path to `run_evaluation.get_crypto_bars` too — one fetcher for all Python paths; dashboard already paginated correctly. Verified live: 15-min/4H/daily last bars now current. Added `tests/test_bars_fetch.py` (3 regression tests, mocked api_get); suite 78/78 green. Note: during editing the mounted file was once truncated mid-write by a sync race — restored from `git show HEAD` and re-applied; verify `python -m py_compile` after edits in Cowork sessions. Updated CLAUDE.md (parity table + consistency check #11), README.md (API notes), glossary.

### 2026-06-11 — Add market-researcher subagent
Created `.claude/agents/market-researcher.md`: an analysis-only "research desk" subagent (professional crypto spot trader persona). Mission 1: verify strategy assumptions/risk/profitability vs. current Alpaca spot-market conditions. Mission 2: verify the project after every strategy change (rule consistency across CLAUDE.md/README/config/indicators.py/risk.py/dashboard, hard-rule soundness, walk-forward evidence, pytest run). Logs every run as a timestamped Markdown report in the new `data/market_research/` folder (GMT+2; `-market.md` / `-project-verification.md` suffixes; Scope/Findings/Verdict/Recommendations/Data sources structure). Hard limits: never trades, never mutates account state, never edits strategy code. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Fix correlation matrix left whitespace
The Live Correlation Matrix rendered with a large blank area on its left (matrix shoved right). Root cause: the global `table { min-width:760px }` rule forced the corr table to 760px, and since the data cells are fixed 28px but the row-label column had no fixed width, that label column stretched to absorb the slack, pushing the whole grid right. Fix: `.corr-wrap table` now sets `min-width:0; width:auto` (same pattern as the `.mk-matrix` override) so the table sizes to its content and aligns left. Pure CSS, no logic change. Updated CLAUDE.md, README.md, dashboard_layout.md.

### 2026-06-07 — Risk tab: move Live Correlation Matrix to the left column
Per user request, swapped the two panels in the "Portfolio Concentration & Correlation Risk" `grid-2` on the Risk page of `dashboard_professional.html` so the 🔗 Live Correlation Matrix is now the **left** column and 📊 Effective Exposure the right (previously reversed). Pure markup reorder; no logic change. Updated CLAUDE.md, README.md, dashboard_layout.md (no new glossary terms).

### 2026-06-07 — Add docs/dashboard_layout.md to the doc-update rule; rewrite it
Per user request, `docs/dashboard_layout.md` is now part of the project documentation-update rule (it was previously a standalone, stale design-notes file). Updated the rule in **both** places in `CLAUDE.md` (the top "Standing rule" and the bottom "Documentation update rule" — now "all five"), the `feedback_doc_updates.md` memory + its `MEMORY.md` index hook, and the README file-tree comment. Rewrote `dashboard_layout.md` itself: it was badly out of date (wrong file names, pre-sidebar nav, only 10 tabs, no Market Overview/Signals/Markov). Now structured as two clear sections — **1. Professional Dashboard** (`dashboard_professional.html`, 13 tabs, sidebar nav, hash routing, shared `getCryptoUniverse()`/`symbolInfo()`, Daily Journal) and **2. Portfolio Dashboard** (`portfolio-dashboard.html`, 5 tabs: Overview/Hot Symbols/Allocation/Morning Brief/Settings, Morning Brief generator) — each with tabs table, key features, and a dated changelog. Kept the Design Philosophy and Original Design Reference. Going forward, dashboard changes must add a changelog entry to the matching section here. Updated CLAUDE.md, README.md, glossary, MEMORY.md.

### 2026-06-07 — Give every symbol a real rank number (no more #?)
Symbols outside the curated `TOP30_INFO` were rendering rank `#?` (and `99` for sorting) on Market Overview / Market Signals. Added `_universeRank` (sym → 1-based position in the ordered universe), populated by `rebuildUniverseRank()` which is called at the end of `getCryptoUniverse()` (covers both the success and fallback branches). New shared helper `symbolInfo(sym)`: returns `TOP30_INFO[sym]` when known, else `{ rank: _universeRank[sym] || 99, tier:"?", capLabel:"?", name: sym without /USD }`. Replaced all four inline `TOP30_INFO[…] || {…}` fallbacks (`renderMoTable`, `loadMarketOverview` rows map, Market Signals row render, and the Top Opportunities panel) with `symbolInfo(…)`. Because the universe is ordered (still-tradable TOP30 by rank first, then the rest alphabetically), ranks are now contiguous: 1–30 match the curated cap ranks, 31+ follow universe position. Sort-by-rank works for all rows. Validated via `new Function` parse (0 errors); only the `symbolInfo` definition still references `TOP30_INFO`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Remove 30-symbol cap on BOTH Market Signals and Market Overview (real fix)
The prior session wired Market Signals to `getCryptoUniverse()` but the user still saw a 30 cap on both pages. Deep search found two remaining causes: (1) **Market Overview was never converted** — `loadMarketOverview()` still hardcoded `TOP30_SYMBOLS` for its snapshots/bars fetch and `rows` map; (2) **`getCryptoUniverse()` was fragile** — its filter `a.symbol.endsWith("/USD")` silently dropped everything and fell back to the 30 if Alpaca returned bare `BTCUSD` symbols. Fixes: (a) hardened `getCryptoUniverse()` to normalize both `BTC/USD` and bare `BTCUSD` → `BASE/USD`, drop non-USD quotes (USDT/USDC/BTC), de-dupe, and only fall back when truly empty; (b) `loadMarketOverview()` now does `universe = await getCryptoUniverse(); MO_SYMBOLS = universe.slice(0, maxSyms)` using the same `maxSignalSymbols` setting, and all three references (placeholder text, the `Promise.all` fetches, the `rows` map) use `MO_SYMBOLS`; (c) header label changed `🌍 Market Overview — Top 30 Crypto` → `🌍 Market Overview — Crypto` with a tooltip pointing at the Max Symbols setting. Both pages now scan/show up to the entered Max Symbols, capped only by the tradable universe. Validated via `new Function` parse (0 errors) and confirmed both pages call `getCryptoUniverse()`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Market Signals: remove 30-symbol scan ceiling, honour Max Symbols fully
The Max Symbols setting (`maxSignalSymbols`) was already uncapped on entry (`Math.max(1, …)`, no `max` attr), but the scan was still limited to 30 because the universe was the hardcoded 30-element `TOP30_SYMBOLS` and `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, n)` can't exceed the array length. Added `getCryptoUniverse()` (near `loadMarketSignals` in dashboard_professional.html): fetches `/v2/assets?asset_class=crypto&status=active` via the existing `apiFetch`, filters to tradable `…/USD` pairs, orders them as still-tradable `TOP30_SYMBOLS` first then the rest alphabetically, caches the result in `_cryptoUniverse`, and falls back to `TOP30_SYMBOLS` on any error. `loadMarketSignals()` now does `const universe = await getCryptoUniverse(); SCAN_SYMBOLS = universe.slice(0, maxSyms)`. So a Max Symbols value above 30 genuinely scans more than 30 symbols, capped only by how many USD pairs the account can trade. Symbols outside `TOP30_INFO` already render gracefully (rank `?`). Market Overview tab still uses the static 30 — unchanged. Validated via `new Function` parse (0 errors). Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Dashboard: tab deep-linking + last-tab restore on refresh
Added hash-based routing to `dashboard_professional.html`. `switchTab()` now writes the active tab id to the URL hash (`history.replaceState(null,"","#"+id)`) and to `localStorage.lastTab`. New helpers near `openSettings`: `tabBtnFor(id)`, `validTabIds()` (derives valid ids from the nav buttons' `switchTab('<id>',…)` onclick, so it never drifts as tabs change), and `applyTabFromUrl()` which resolves the target tab from the URL hash first, then `localStorage.lastTab`, and activates it (no-op if it's already active). A `hashchange` listener calls `applyTabFromUrl` so editing the `#tab` anchor or following a deep link switches tabs live. `applyTabFromUrl()` is called at the end of the `bootstrapDashboard()` IIFE (after initial render, in both the configured and not-configured branches) so a refresh or a `…/dashboard_professional.html#signals` link lands on the right tab instead of always Command. The switchTab loader dispatch already runs after the active-class swap, so even if a loader throws without credentials the tab still visually switches. Validated by parsing the script block via `new Function` (0 errors). Updated CLAUDE.md, README.md, glossary.

### 2026-06-07 — Fix: Market Overview symbol column overflowing to next row
In `renderMarketOverview` (dashboard_professional.html ~line 5538), the symbol cell was missing its opening `<td>`: the rank `<td>` closed, then `tvLink()` emitted a bare `<a>` + name `<span>` followed by a stray `</td>`. With no opening cell tag, the browser hoisted the symbol/name content out of the table grid, so it rendered on a separate line instead of beside the Rank column. Fix: prepended `"<td>"` before `tvLink(...)`. Other tables (Market Signals ~5751, ~5773) already wrap their symbol in a proper `<td>`. Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: removed 30-symbol hard clamp on Max Symbols
`maxSignalSymbols` was clamped to 1–30 in three places (`saveSettings`, `updateScanBtnLabel`, `loadMarketSignals`). Per request, removed the `Math.min(30 / TOP30_SYMBOLS.length, ...)` upper bound; now `Math.max(1, Math.round(value))` — the entered number is used as-is (minimum 1). Note the scan universe is still the 30 `TOP30_SYMBOLS`, so a value above 30 just scans all of them (`TOP30_SYMBOLS.slice(0, n)` caps at array length). Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Fix: Max Symbols setting reset to 30 on refresh
`maxSignalSymbols` (and any other `limits` value) reset to the `config.json` default on every reload. Cause: `loadConfigFromFile()` merged `config.json`'s `limits` *over* the user's saved `localStorage` limits (`Object.assign({}, existing.limits, cfg.limits)`), so config.json (30) always won. API keys were unaffected only because config.json's key fields are blank. Fix: flipped the limits merge to `Object.assign({}, cfg.limits, existing.limits)` so saved `localStorage` values win and `config.json` only fills gaps (seed/fallback for a fresh browser). Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Dashboard: removed config.json save-to-file
Per request, dropped the write-to-`config.json` path. Removed `saveConfigToFile()` and the `_configFileHandle` var; `saveSettings()` is no longer `async` and persists to `localStorage` only (alert back to "Settings saved locally in this browser."). `loadConfigFromFile()` is unchanged — `config.json` is still fetched on page open to seed settings (load-only). To change on-disk defaults, edit `docs/config.json` directly. Validated with `node --check`. Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Fix: dashboard TDZ crash + config.json settings persistence
**Two issues reported:** (1) Market Signals scan button dead and Market Overview throwing `Cannot access 'TOP30_SYMBOLS' before initialization`; (2) request to persist all Settings-tab values to a `config.json` next to the HTML and load them on open.

**Root cause of (1):** the `updateScanBtnLabel()` call I had added to the early top-level init ran *before* `const TOP30_SYMBOLS` (declared much later in the same script). `const` has a temporal dead zone, so the access threw at top level and aborted the entire script — the const never initialized, so every later consumer (scan, Market Overview) failed. (Also discovered the working-tree HTML + all four doc files had been truncated mid-file by earlier file-tool writes; restored each from `git show HEAD:` via in-place overwrite, since `git checkout` couldn't unlink on the mount.)

**Fixes (all applied through the shell, not the file editor, to avoid re-truncation):**
- Removed the early `updateScanBtnLabel()` call. Wrapped the credential-dependent bootstrap in an `(async function bootstrapDashboard(){ await loadConfigFromFile(); renderMode(); updateScanBtnLabel(); ... })()` IIFE. Because it awaits, the synchronous remainder of the script (incl. the `TOP30_SYMBOLS` const) finishes first, so the label call is safe.
- Added `loadConfigFromFile()` — `fetch('./config.json')` on load, merges into `localStorage` (empty strings don't clobber stored keys; `limits` merged), then `loadSettingsForm()`.
- Added `saveConfigToFile(obj)` — writes `config.json` via File System Access API (`showSaveFilePicker`, handle cached in `_configFileHandle`); falls back to an `<a download>`. `saveSettings()` is now `async` and awaits it, with mode-aware alerts.
- Created `docs/config.json` (mode, 4 API fields, `limits` incl. `maxSignalSymbols`).
- Validated the inline script with `node --check` after every change. Note: `fetch('./config.json')` works when the dashboard is served over HTTP (GitHub Pages / local server); on bare `file://` Chrome blocks it and the dashboard falls back to `localStorage`.

Updated CLAUDE.md, README.md, glossary.


### 2026-06-06 — Dashboard: Market Signals scan-button label made dynamic
Follow-up after user reported the Market Signals tab "still scans 30 / ignores the setting." The scan logic (`loadMarketSignals` → `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, maxSignalSymbols)`) was already correct in the file, so the report was almost certainly a cached-JS / stale-browser issue (the bash workspace mount was also serving a truncated copy cut off at line 5400 — file tools showed the complete file). To make the cap unmistakable and provide a version-check tell: renamed the static "▶ Scan All 30" button to a dynamic `#msScanBtn` updated by new `updateScanBtnLabel()` → `▶ Scan Top N`; called on page init, after `saveSettings()`, and at the start of each scan. Also dropped "Top 30" from the panel title and the initial `msLastUpdated` hint. Advised user to hard-refresh (Ctrl/Cmd+Shift+R) and re-save settings. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: Max Symbols setting for Market Signals scan
Added a **🔭 Signals Analysis** section to the Settings tab with one input, **Max Symbols in Market Signals scan** (`setMaxSignalSymbols`). Persisted as `limits.maxSignalSymbols` (default 30, clamped 1–30) — added to `DEFAULT_LIMITS`, wired through `getSettings()`, `loadSettingsForm()`, and `saveSettings()`. `loadMarketSignals()` now derives `SCAN_SYMBOLS = TOP30_SYMBOLS.slice(0, maxSignalSymbols)` (top-N by market cap, since `TOP30_SYMBOLS` is cap-ranked) and uses it for all bar/snapshot fetches, the scan loop, and the "N/M symbols analysed" footer. Watchlist Signals tab (fixed 10) and Market Overview (full 30) are unaffected — confirmed with the user this should apply only to the Market Signals scanner. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Dashboard: tidied Settings tab layout
Reorganised the Settings tab (`#page-settings`) in `docs/dashboard_professional.html`. Previously the Live API Key/Secret shared one `form-grid` with the three risk-limit inputs, so the fields wrapped unevenly. Now there are three labelled 2-column `form-grid` blocks: **📄 Paper Trading** (Key + Secret), **🔴 Live Trading** (Key + Secret), and a new **🛡 Risk Limits** block (Assumed Stop Loss %, Max Daily Loss %, Max Open Risk %) placed below the API credentials. API key/secret pairs now line up side by side per environment; risk limits sit in their own block under the keys. No JS/IDs changed (`setPaperApiKey`, `setLiveApiKey`, `setStopLoss`, etc. untouched). Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Fix: Backtest vs Live tab — broken Win Rate & Profit Factor
The Backtest tab's "Strategy Health" comparison had two non-functional metrics. **Win Rate Proxy** compared each filled order's `filled_avg_price` against its `limit_price` (`fill <= limit` for buys, `fill >= limit` for sells) — but limit orders by definition always fill at or better than the limit, so the proxy was permanently ~100% and always green regardless of actual profitability. **Profit Factor** was hardcoded to `null` → permanently `n/a`. Meanwhile the P&L tab already computed correct realized win rate and profit factor via FIFO matching. Fix: extracted that FIFO engine into a shared `computeFifoStats(activities)` helper (long-only buy→sell matching, identical behaviour to the P&L tab's original inline code). `loadContext()` now fetches `/v2/account/activities?activity_type=FILL` and attaches `c.fifoStats`; `renderBacktest()` reads `c.fifoStats.winRate` / `.profitFactor` for both the comparison table and the KPI tiles. `loadPnl()` refactored to call the same helper (single source of truth). Removed the now-orphaned "Filled Order Sample" KPI. Verified the helper with a unit test (1 win / 1 loss → winRate 50%, PF 0.5). Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Fix: Markov matrices overlapping in dashboard
The Markov tab's transition matrices were overflowing their `grid-3` panels and overlapping. Root cause: the global `table { min-width:760px }` rule (needed for the wide data tables elsewhere) applied to the small 5-column matrix tables sitting in ≥230px grid columns. Fix: added a `.mk-matrix` class (`min-width:0; table-layout:fixed; th/td padding 6px 7px; white-space:nowrap`) and tagged the `mkMatrixTable()` `<table>` with it. Tables now constrain to their card width. Updated CLAUDE.md, README.md, glossary.

### 2026-06-06 — Daily closing journal (scheduled pass)
Wrote `journal/2026-06-06.md` Daily Close block. Equity $95,623.28, 100% cash, 0 open positions, flat vs prior day (last_equity unchanged), $0 realized/unrealized. No orders today (Alpaca `/v2/orders` after 2026-06-06T00:00Z returned 0). All watchlist symbols scored below the buy gate during the concurrent 14:04 evaluation pass — EMA death crosses across the board, oversold RSI on alts but no confluence ≥ 3 and regimes mixed/uptrend, so the agent stayed flat. Rule compliance clean: cash reserve 100% (≥20%), no caps breached, no missed stops. Write-only pass — no orders placed.

### 2026-06-05 — Dashboard: tab nav moved to left sidebar
Converted `docs/dashboard_professional.html`'s top horizontal tab bar into a left vertical sidebar. Wrapped `<nav>` + `<main>` in a new `.layout` flex container; `nav` is now a 210px sticky column (`flex:0 0 210px`, `top:57px`, own `overflow-y`). `.tab-btn` restyled to full-width left-aligned rows with a left blue border + tint for the active state. Mobile media query (≤700px) sets `.layout{flex-direction:column}` and reverts `nav` to a horizontal scrolling bar with a bottom-border active marker, so phone layout is unchanged. Pure layout/CSS change — no JS or scoring logic touched. Verified div balance and `node --check` on the script block.

### 2026-06-05 — Dashboard: new 🔗 Markov tab (BTC/ETH transition-matrix analysis)
Added a `Markov` tab to `docs/dashboard_professional.html`. For `MK_SYMBOLS` (BTC/USD, ETH/USD) across `MK_INTERVALS` (30/60/90/180/365-day windows) it classifies each daily close-to-close return into Up/Flat/Down via a ±`MK_THRESH` (1%) band (`mkClassify`), then `mkBuild()` computes the 3×3 transition matrix `P(next|current)`, the stationary distribution (power iteration with self-loop fallback for unseen rows), the current-state next-day forecast, and the mean daily return. `mkIntervalCard()` renders one heatmap-shaded matrix per window (< 3 transitions → "Insufficient data"); KPI tiles show each symbol's 90-day next-day-up probability. Single `fetchBars(MK_SYMBOLS, "1Day", maxDays+5)` call per run feeds all five windows. User-triggered via `loadMarkov()` (▶ Run Markov Analysis); not auto-run on tab switch. Analysis-only — places no orders, separate from the 6-point execution score. Verified: JS `node --check` passes; standalone test confirms transition rows and stationary vectors sum to 1 and the < 3-transition edge case is gated.

### 2026-06-05 — Dashboard: executable Morning Brief + Daily Journal header buttons

**Scope:** Added top-row "execute" buttons to both dashboards that generate the daily artifacts client-side from live Alpaca data, preview them in a modal, and offer a `.md` download.

- **`docs/portfolio-dashboard.html`** — new header button `🌅 Morning Brief` → `generateMorningBrief()`. Fetches `/v2/account` + `/v2/positions`, runs the existing `confluenceScore`/`fetchBars` engine over the 10-symbol `CRYPTO_WL`, and builds Markdown matching the `journal/` morning-brief format: Portfolio Health (+ per-position table with direction-aware stop/target), Alerts, Signal Confluence table, templated Market Notes. Preview modal `#briefDocBackdrop` with Copy + Download `.md` (`morning-brief-YYYY-MM-DD.md`).
- **`docs/dashboard_professional.html`** — new header button `📓 Daily Journal` → `generateDailyJournal()`. Fetches account, positions, and `/v2/account/activities?activity_type=FILL`; filters fills to the GMT+2 calendar day; FIFO-computes today's realized P&L; runs a closing 10-symbol `JOURNAL_WL` scan via `calcSignalScore`. Sections: Summary, Trades Today, Open Positions, Market Observations. Preview modal `#journalDocBackdrop` with Copy + Download `.md` (`daily-journal-YYYY-MM-DD.md`).
- Both use the `Etc/GMT-2` IANA timezone for GMT+2 timestamps and day filtering. No backend/server required — fully client-side, reusing each dashboard's existing helpers.
- **Verification:** extracted both JS blocks into standalone files and ran `node --check` + execution with mocked helpers — both parse and run clean. (Note: the bash mount lagged the file-tool writes during this session; validation was done on freshly-written standalone copies.)

### 2026-05-27 — Risk Management Chapter 2: five improvements implemented

**Scope:** Full implementation of all five Chapter 2 risk improvements identified in the `reports/trading-analysis-2026-05-27.md` performance review.

**Files changed:** `scripts/risk.py`, `scripts/trade.py`, `scripts/run_evaluation.py` (new logic), `scripts/position_state.py` (new file), `config.json` (13 new risk parameters), `CLAUDE.md`, `README.md`, this file, `memory/glossary.md`.

**2.1 — Stop-loss order deduplication (`run_evaluation.py` + `trade.py`)**
- Added `get_open_orders(symbol)`, `get_order(order_id)`, `cancel_order(order_id)` to `trade.py`.
- Before placing any SELL/COVER stop-loss order, `run_evaluation.py` now fetches open orders for the symbol. If a pending order is found within `stop_loss_escalation_cycles` (2) cycles, it skips placing a duplicate. Fixes the ADA infinite-loop bug (30+ duplicate orders).

**2.2 — Wider stop-loss limit band + time-escalation (`risk.py` + `config.json`)**
- New constants: `STOP_LOSS_LIMIT_BAND_PCT` (0.5%), `STOP_LOSS_ESCALATION_CYCLES` (2), `STOP_LOSS_ESCALATION_EXTRA_PCT` (0.3%).
- New functions: `stop_loss_limit_price(ask, cycles_open)`, `cover_limit_price(ask, cycles_open)`.
- `place_order()` gains `is_stop_loss: bool` param — when True, uses 0.5% band instead of 0.2%.
- After 2 unfilled cycles, the band widens by an extra 0.3% to force execution.

**2.3 — Trailing stops (`risk.py` + `position_state.py` + `run_evaluation.py`)**
- New file `scripts/position_state.py`: atomic JSON state manager for `data/positions_state.json`.
  - Per-symbol: `entry_price`, `high_water_mark`, `stop_order_id`, `stop_order_cycles`.
  - Portfolio: `day_open_equity`, `capital_preservation_mode`.
- New functions in `risk.py`: `trailing_stop_price()`, `should_trail_stop_out()`, `effective_stop_pct()`.
- Trailing stop activates at +2.5% gain (`trailing_stop_activation_pct`), trails 3% below HWM (`trailing_stop_trail_pct`). HWM updated each HOLD cycle in `main()`.

**2.4 — Correlation budget (`risk.py` + `run_evaluation.py`)**
- New functions: `correlation_budget_allows(symbol, open_symbols)`, `tier_count(symbol, open_symbols)`.
- Tier-1: BTC/USD, ETH/USD. Tier-2: all other alts. Max 3 total, max 2 per tier.
- New entries blocked at the `open_symbols` gate in `run_evaluation.py` before any sizing.

**2.5 — Portfolio-level daily drawdown gate (`risk.py` + `position_state.py` + `run_evaluation.py`)**
- New functions: `daily_drawdown_pct()`, `daily_drawdown_gate_triggered()`.
- `main()` calls `check_and_refresh_day_open(state, equity)` at startup to snapshot opening equity.
- If daily drop ≥ 3%, `activate_capital_preservation()` sets flag in state; all new entries blocked.
- State resets automatically at midnight UTC via `check_and_refresh_day_open`.

**Verification:** All `risk.py` self-checks pass. All `position_state.py` smoke tests pass. All four script files parse clean (667 / 379 / 324 / 206 lines). Import chain verified via `ast` inspection.

---

### 2026-05-26 — Python ↔ Dashboard consistency audit + two bug fixes

**Scope:** Full parity check between `scripts/indicators.py`, `scripts/run_evaluation.py`, `scripts/trade.py`, `scripts/risk.py` and `docs/dashboard_professional.html`.

**Bugs found and fixed:**

1. **MACD signal line always NaN (critical)** — `calcMACD()` in the dashboard built `macdLine` with NaN for its first 25 positions (ema26 only valid from index 25), then passed this NaN-prefixed array to `emaArr(macdForSignal, 9)`. The EMA seed computation (`seed += src[0..8]`, all NaN) produces NaN, making the entire signal line NaN. Therefore `histogram = macdLine − NaN = NaN` always. The MACD signal was always "0 Flat" regardless of market conditions (max achievable score was ±5 not ±6). **Fix:** strip NaN prefix before computing signal EMA, then re-pad to full length.

2. **Half-size score pill used strict equality** — Pills for "HALF" (`score === 3`) and "SHORT ½" (`score === -3`) missed scores of 3.5 and -3.5 respectively. Python fires at `score >= 3.0` (half-size). **Fix:** changed to `>= 3 && < 4` and `<= -3 && > -4` across Signals tab, Market Signals tab, KPI counters, and score distribution chart.

**Confirmed correct (no change needed):** EMA seeding, EMA ±0.05% dead zone, ATR formula, ATR multiplier (1.5×), position sizing formula, Bollinger bands (population std-dev), BB thresholds (0.25/0.75), volume ratio formula (prev-20 average), volume thresholds (1.2×/0.7×), daily regime (SMA20/SMA50), MACD 2-bar rising check, stop-loss trigger (5%), bar completeness (end=now−1 bar).

**CLAUDE.md updated:** Added `Python ↔ Dashboard consistency check` section with a 10-point checklist to run after any indicator logic change.

---

### 2026-05-26 — Bar fetch: exclude in-progress bar from all indicator calculations

**Root cause:** Neither `run_evaluation.py` nor the dashboard's `fetchBars` passed an `end` parameter to the Alpaca bars API. Alpaca returns the currently-forming bar in responses with no `end`. This partial bar has near-zero volume (only trades since bar open), causing `volume_ratio ≈ 0.00×` and unstable RSI / MACD / BB values that shift wildly depending on the exact second the page loads or the script runs.

**Fix:** Added `_bars_end(timeframe)` to `scripts/run_evaluation.py` and `barsEnd(timeframe)` to the dashboard, both computing `now − 1 bar period`. Wired `end=` into:
- `scripts/run_evaluation.py` → `get_crypto_bars()` params
- `docs/dashboard_professional.html` → `fetchBars()` URL

**Effect:** Both now always use only fully-closed bars. Results are stable within a bar period and consistent between Python and the dashboard when checked at the same time.

---

### 2026-05-26 — Dashboard: Signal Confluence scoring fixed to match indicators.py exactly

**Root cause:** Four discrepancies between `docs/dashboard_professional.html`'s `calcSignalScore()` and `scripts/indicators.py`'s `signal_score()` caused significantly different scores between the journal and the Signals/Market Signals tabs.

**Fixes applied to `docs/dashboard_professional.html`:**

1. **EMA seeding (`emaArr`):** Dashboard was seeding with the first raw value; Python seeds with the SMA of the first `period` values. Fixed to match, affecting all EMA-derived signals (1, 6).

2. **EMA dead zone (Signals 1 & 6):** Dashboard had no dead zone — EMAs equal or very close gave -1. Python uses ±0.05% band (`ema20 > ema50 * 1.0005` = golden, `< 0.9995` = death, else neutral = 0). Fixed for both the 15-min EMA cross and the 4H regime.

3. **MACD partial credits (Signal 2):** Dashboard had only +1/-1/0. Python gives +0.5 for green-but-not-rising histogram and -0.5 for red-but-improving. Also upgraded from 1-bar to 2-bar rising lookback (matching `macd_hist_rising(lookback=2)`). Added `prevHistogram2` to `calcMACD()` and `calcRSIRising()` helper.

4. **RSI direction check (Signal 3):** Dashboard gave +1 for RSI 40–65 regardless of direction. Python requires RSI to be rising (3-bar lookback). Also added -0.5 partial credit for RSI < 40 AND falling. Added `calcRSIRising()` helper function.

---

### 2026-05-25 — New Script: `scripts/rebalance.py`

Added `scripts/rebalance.py` — a portfolio rebalancer that aligns positions to their caps in `config.json › portfolio_caps.caps`.

**Logic:**
- Loops over all watchlist crypto symbols.
- **Over-cap** positions: trims the excess immediately (no signal gate needed — reducing risk).
- **Under-cap** positions: tops up only when signal gate passes (score ≥ 4 full-size, score = 3 half-size) AND daily regime is not downtrend.
- Stop-loss checks (`should_stop_out`) always fire regardless of cap status.
- ATR-based sizing applies; hard cap = remaining gap to target cap.

**Order routing:** uses `trade.place_order()` — all hard rules enforced.

**Journal:** appends a `## Rebalance HH:MM GMT+2` block to the day's journal with a per-symbol table (current%, cap%, score, action).

**Usage:**
```bash
python scripts/rebalance.py           # dry-run
python scripts/rebalance.py --execute # place orders
```

---

### 2026-05-22 — Full Short-Selling Support Added

**`config.json` — three short-side thresholds added to `strategy` block:**
- `short_score_threshold: -4.0` — full-size short entry gate
- `short_score_half_size_threshold: -3.0` — half-size short entry gate
- `cover_score_threshold: 2.0` — cover a short when TA turns bullish

**`scripts/risk.py` — two new functions:**
- `should_cover_short(entry_price, current_price)` — returns True if price has risen ≥5% above short entry (symmetric inverse of `should_stop_out`)
- `short_stop_price(entry_price)` — returns `entry_price × 1.05`

**`scripts/run_evaluation.py` — full bidirectional trading:**
- Detects open short via `qty < 0` from Alpaca positions API
- Short stop-loss: `should_cover_short()` triggers immediate COVER
- TA cover: score ≥ `COVER_SCORE_THRESHOLD` (+2) → COVER
- Short entry: regime must be `downtrend`, score ≤ `SHORT_SCORE_HALF_SIZE` (−3); full size at ≤−4, half-size at −3
- Sizing: uses `bid` as reference price for SHORT limit orders; COVER limit = `ask × (1 + limit_band × 0.5)`
- Order routing: `side="sell"` for BUY→no wait, SHORT→sell; `side="buy"` for COVER→buy
- Added constants: `SHORT_SCORE_THRESHOLD`, `SHORT_SCORE_HALF_SIZE`, `COVER_SCORE_THRESHOLD`

**`docs/dashboard_professional.html` — short-aware UI updates:**
- Hard Rules panel: adverse stop check now direction-aware (short: price rose ≥5%)
- Positions tab: `isShort = qty < 0`; stop = `entry×1.05`, target = `entry×0.90` for shorts; SHORT badge; `Buy / Cover` button
- `actionPill()`: regime-gated — SHORT/SHORT½ pills only appear in downtrend
- `const down` variable declared inside `.map()` callback before use (bug fix)
- Notifications: BUY alert gated on `!down`; SHORT alert for `score <= -4` in downtrend
- ⚡ Quick-fill: `⚡ Buy` for longs; `⚡ Short` (side=`sell`) for shorts in downtrend
- Score distribution label: "≤ −3 (SELL)" → "≤ −3 (SHORT)"
- Market Signals `msActionPill`: same regime-aware logic; "SELL" → "SHORT"/"SHORT½"
- KPI label: "SELL/Avoid" → "SHORT/Avoid"

**`docs/portfolio-dashboard.html` — short-aware UI updates:**
- `renderPositions` (Overview): `isShort = qty < 0`; direction-aware stop/target; SHORT badge; `Buy / Cover` button
- `renderBriefPos` (Morning Brief): direction-aware stop price, distToStop, stopProg, nearStop; P&L from `unrealized_plpc` (pre-computed, direction-correct)
- Alerts panel: short-specific proximity alerts mention `(SHORT)` and cover stop price
- `actionChip()`: full regime-aware logic — SHORT ≤−4/6, ½ SHORT −3/6, TA SELL ≤−2 (exit long only)
- `actionRank()`: updated to accept `(score, dailyRegime)` pair; 5-level ranking

**`CLAUDE.md` — documentation standing rule added:**
- Prominent callout at top of Trading Agent Instructions: update CLAUDE.md, README.md, memory/projects/alpaca-trading-agent.md, and memory/glossary.md after every change, no exceptions
- Hard Rules table updated for short direction (stop-loss, score gate, regime gate, cover signal)
- Signal Confluence entry/exit rules updated to include SHORT and COVER

**Persistent memory (Cowork spaces):**
- `feedback_doc_updates.md` created — feedback-type memory recording the documentation standing rule
- `MEMORY.md` updated with pointer to the feedback memory

---

### 2026-05-21 — Dashboard: Market Overview + Market Signals tabs added

### 2026-05-21 — Dashboard: Signals tab execute button

- Added `▶ Execute` direct execution buttons to `docs/dashboard_professional.html` on Signals tab rows.
- The button submits the existing ATR-based paper order quantity immediately in paper mode, while preserving the live-mode guard.


**Two new tabs added to `docs/dashboard_professional.html` (now 12 tabs total):**

- **🌍 Market Overview** — loads automatically on tab open. Fetches live price, 24h%, 7d% (from daily bars), USD volume, and trend direction for 30 crypto symbols ranked by market cap (`TOP30_SYMBOLS`). Sortable by rank, 24h% up/down, 7d%, or signal score. Includes a color-coded momentum heatmap below the table. Score column pulls from `_msPrevScores` cache set by a Market Signals scan.
- **🔭 Market Signals** — on-demand "Scan All 30" button. Runs the full `calcSignalScore` 6-point confluence engine across all 30 symbols using the existing paginated `fetchBars` function (15-min, 4H, daily timeframes). Renders the same table format as the watchlist Signals tab, plus a score distribution summary and a Top Opportunities panel. Cached scores in `_msPrevScores` feed back into the Market Overview Score column.
- New JS globals: `TOP30_SYMBOLS` (array), `TOP30_INFO` (metadata per symbol), `_moData` (cached overview rows), `_msPrevScores` (cross-tab score cache).
- New functions: `loadMarketOverview()`, `loadMarketSignals()`, `moApplySort()`, `renderMoTable()`, `renderMoHeatmap()`, `moFmtPrice()`, `moFmtVol()`, `moChgHtml()`, `moTrendIcon()`, `moTierColor()`.
- switchTab wired: `market-overview` auto-runs on open; `market-signals` is manual (same pattern as Breakout Scanner).
- Note: smaller-cap symbols (ATOM, XLM, COMP, SNX, ENS) have no data on Alpaca — show "–" gracefully. `1INCH/USD` replaced with `MATIC/USD` (see below).

---

### 2026-05-25 — Dashboards: TradingView symbol links added

- Added `tvLink(sym, label)` helper to both `dashboard_professional.html` and `portfolio-dashboard.html`.
- Converts any symbol form ("BTC/USD", "BTCUSD", "BTC") to a `https://www.tradingview.com/chart/?symbol=CRYPTO:BTCUSD` URL.
- Every `<span class="symbol">` in both dashboards now wraps its text in the link — opens in a new tab (`target="_blank"`).
- Added `.tv-link` CSS class: inherits colour, no underline at rest, underline + slight fade on hover.
- 15 call-sites in the pro dashboard, 12 in the portfolio dashboard; zero unlinked symbol spans remain.
- **IMPORTANT — file write pattern for large HTML files**: Never use Python `open(path,'w').write(html)` directly on the Windows-mounted path (`/sessions/.../mnt/`). Large writes on the FUSE/SMB mount are silently truncated. Always write to `/tmp/` first, verify `</html>` is present, then `cp` to the mounted path.

---

### 2026-05-25 — Dashboards: Mobile portrait table horizontal scroll fixed

**`dashboard_professional.html`**
- **Root cause**: `.table-wrap` used `overflow:auto` without an explicit width constraint. On mobile, block elements expand to fit content, so the wrapper grew to 760px+ alongside the table instead of staying at viewport width and scrolling.
- **Fix**: Added `max-width:100%` and `-webkit-overflow-scrolling:touch` to `.table-wrap` globally. In the `@media (max-width:700px)` block, overrode to `overflow-x:scroll` and `max-width:calc(100vw - 32px)`. Same constraint applied to `.corr-wrap`.

**`portfolio-dashboard.html`**
- **Root cause**: `.table-wrap` and `.conf-wrap` both used `overflow:hidden` — actively
## 2026-07-10 — Session: workspace corruption repair + manual evaluation run (19:00 GMT+2)

- **Problem:** Local working tree had silently truncated files (known mounted-repo truncation issue): `scripts/position_state.py` (214/233 lines, cut mid-statement), `scripts/risk.py` (739/938), `scripts/run_evaluation.py` (1395/1827), `scripts/trade.py` (324/329), `scripts/walkforward_evaluate.py` (346/371), `tests/test_bars_fetch.py` (86/127), and `config.json` (84/139 — watchlist + risk sections lost, causing the engine to fall back to buy=4.0/half=3.0 gates and an empty watchlist).
- **Fix:** Verified each damaged file was a clean prefix of HEAD (cd7f225, v2026-07-10.3) via `diff <(git show HEAD:f | head -n) f`, then restored all 7 from HEAD. All scripts/tests compile; config.json parses (10 symbols, gates 3.5/2.5). No work lost — HEAD already contained all of today's famous-trader changes.
- **Evaluation:** No local `.env` (Alpaca keys unavailable in sandbox), so the 19:00 GMT+2 evaluation ran via GitHub Actions workflow_dispatch (Trading Bot #346, paper, dry_run=false, Success 58s). Orders: SOL/USD SELL 29.5132 @ $78.1396 and AAVE/USD SELL 0.0127 @ $94.9679 — both STALE EXIT (held >48h, trail never armed, score < 2.5). BTC stop order had filled — position cleared. LINK holds at score 5.0 (+2.38%). Tier-2 budget 5/5 blocked new alt entries. Warnings: PARTIAL-TP RECONCILED (AAVE/BTC/CRV/LINK/SOL flags restored, stops at breakeven) and a DATA GUARD on SOL avg_entry_price (API returned −87.26, FIFO-derived $77.0166 used).
- **Note:** The workflow committed journal + positions state to remote; this local clone is now behind origin/main and should be pulled before the next local edit.

---

## 2026-07-11 — Session: bug fix — Breakout scanner Key Levels duplicate labels (v2026-07-11.1)

- **Problem (Bug #1):** The Breakout sub-tab's 🎯 Daily Chart Key Levels panel showed several rows with the identical label (e.g. "Swing Low" ×3) at different prices with no date/timeframe context — indistinguishable, reading as duplicate entries. Root cause: `ggKeyLevels()` pushed every 5-bar swing point in the 6-month daily window with the bare label "Swing High"/"Swing Low"; the 0.5% dedup only collapses near-identical *prices*, not same-label rows.
- **Fix:** New `ggLevelDate(t)` helper (GMT+2 `Etc/GMT-2`, `en-GB` day+month) date-stamps each swing level with the daily bar it formed on — labels now render as e.g. "Swing Low · 21 Jun". The price-dedup and 5-level cap are unchanged. Footer bumped to v2026-07-11.1.
- **Verified:** Node test harness with the extracted `ggKeyLevels`/`ggLevelDate` over a synthetic 60-day series — all swing levels carry a date, no duplicate label+price rows (PASS).
- **Workspace repair (same session):** the working copies of `journal/2026-07-11.md` and `memory/memory.md` were silently truncated again (journal lost HEAD lines 189–393 — the tail of the 01:16 evaluation incl. the LTC BUY order record and the whole 02:12 evaluation — with the local 09:40 evaluation appended onto the damaged file; memory.md lost the last 3 lines of the 2026-07-10 entry). Both rebuilt from git HEAD + the legitimate new local content (09:40 eval + 09:42 manual note re-appended in chronological order; the new engine-race lesson kept). `data/*.json` validated (`json.load` OK), all `scripts/*.py` compile.

---

## 2026-07-18 — Bug fix: Autopilot re-firing partial-TP on its own already-scaled-out positions (v2026-07-18.4)

- **Problem (Bug #1, reported by user via CLAUDE.md Bugs list):** "run_evaluation.py on GitHub Actions selling dashboard-Autopilot-opened positions without profit or a trailing stop." Journal evidence across 2026-07-09 through 2026-07-17 showed clean geometric halving cascades of "PARTIAL TP" sells on the same position (e.g. AAVE/USD: qty 6.5413 → 0.8177 → 0.4088 → 0.2044 → 0.1022 → 0.0511 → 0.0128; LINK/USD accumulated 24+ "partial SELL(s) since entry" on one open lot) followed by a `STOP-LOSS (breakeven after partial TP)` full close at essentially zero profit — well before the position's P&L ever reached the +2.5% trailing-stop arm threshold.
- **Root cause:** The dashboard Autopilot's partial-TP ladder (`docs/dashboard_professional.html`) only knows "has +1R already fired for this position" via its own `localStorage.autopilotPartialTp`, merged each cycle with the Python engine's `data/positions_state.json` (`partial_tp_done`/`breakeven_stop`) via `fetchLocalJson(["./data/positions_state.json", "../data/positions_state.json"])`. That is a same-origin relative `fetch()` of a local sibling file — the exact class of call Chromium blocks when the dashboard is opened via `file://` (the same root cause just fixed for the Glossary tab, see the 2026-07-18 entry above). When the merge silently returns `null`, the Autopilot has no way to know a scale-out already happened (by itself in a prior session, or by the Python cron), so on its next cycle it re-evaluates the (now smaller) remaining position against the same +1R trigger, sells 50% of the remainder again, and repeats — producing the observed halving cascade. Each re-fire also re-pins `breakeven_stop = entry`, so once price merely returns to the original entry (common on a pullback, long before +2.5%), the hard-stop check exits the sliver of remaining position at ~breakeven — no profit, and the trailing stop never got a chance to arm.
- **Fix:** Added `apReconcileFromFills(fills, heldSymbols)` to `docs/dashboard_professional.html` — the same FIFO walk as Python's `reconcile_positions_from_fills()` in `scripts/run_evaluation.py` (flat→long transition tracking, dust-tolerant lot consumption at `_AP_RECONCILE_DUST_REL_TOL = 0.005`), run against Alpaca's own FILL activity ledger via the already-existing `edgeFetchAllFills()`/`apiFetch()` (a normal cross-origin HTTPS call to Alpaca — unaffected by `file://`, unlike the local state-file fetch). `apCycle()` now calls this once per cycle before the exit-management loop and merges `partialTpSyms`/`entryTime` into the existing `partialTp`/`entryTime` maps (only filling gaps, never overwriting an already-set local flag) right where `entry` is computed for each held position. This makes "has the +1R scale-out already fired" independently verifiable from Alpaca's own trade history regardless of whether the `positions_state.json` merge succeeds, so the Autopilot can no longer re-fire its own partial-TP on an already-reduced position. The `positions_state.json` HWM merge is unchanged (lower-severity: a missed merge there under-arms the trail rather than causing a premature exit).
- **Verified:** Extracted `apReconcileFromFills`/`toSlash` from the dashboard HTML with Node and ran three synthetic fill-history scenarios (fills ordered newest-first, matching Alpaca's `direction=desc`): (1) a real prior partial sell on an open lot → correctly flagged (prevents re-fire); (2) a brand-new position with only a BUY fill → correctly NOT flagged, entry time correctly backfilled; (3) an old, fully-closed round trip (partial sell + full close) followed by a brand-new BUY on the same symbol → correctly NOT flagged (old sells don't leak into the new round trip). Also parsed the full dashboard `<script>` block with `new Function(...)` to confirm no syntax errors from the edit. Footer bumped to v2026-07-18.4.

## lessons
- Any `fetch()`/XHR of a same-origin relative local file (config.json, positions_state.json, glossary.md, etc.) in `docs/dashboard_professional.html` can be silently blocked when the dashboard is opened via `file://` — never rely on it as the *only* source for cross-engine state; prefer deriving the same fact from an HTTPS call (e.g. Alpaca's own API via `apiFetch`) when one is available, and treat the local-file fetch as a best-effort enhancement only.
