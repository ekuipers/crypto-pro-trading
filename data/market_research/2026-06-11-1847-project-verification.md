# Project Verification — 2026-06-11 18:47 GMT+2

## Scope
Verification of the 2026-06-11 strategy change set:
1. `scripts/trade.py` — stop-loss limit clamping to the 0.5% band edge (was: self-rejection).
2. `scripts/scout.py` (new) + `config.json › scout` + merge in `run_evaluation.main()` — universe scout / dynamic watchlist.
3. `config.json › strategy.shorts_enabled = false` + venue gate in `run_evaluation.py`.
4. `docs/dashboard_professional.html` — shorts UI removed (BEAR pills informational), 🤖 Autopilot panel, 🔬 Edge tab.
5. Documentation updates (CLAUDE.md, README.md, docs/dashboard_layout.md, memory/*).

Method: code read (trade.py, scout.py, run_evaluation.py, risk.py, dashboard apCycle), full test suite + py_compile in an isolated copy (/tmp/verify2), live read-only dry-run of `run_evaluation.py` and `scout.py --force` on fresh Alpaca data, journal evidence grep. No orders placed; no project files modified (dry-run journal written only inside /tmp/verify2).

## Findings

### 1. Stop-loss clamp (trade.py:181–202) — SOUND
- Clamp `min(max(limit, ask−band), ask+band)` keeps the price exactly on or inside the 0.5% band of the **fresh** ask — the hard rule "limit within 0.5% of ask (stop-loss)" still holds by construction. `round(…, 6)` error (≤5e-7) is negligible vs. band widths (e.g. DOGE band ≈ 4.2e-4).
- Evidence-supported: journals contain 3 self-rejected stop-losses (AVAX/USD ×2, LINK/USD ×1, e.g. `ask=8.1887 limit=8.1477` — 0.0001 outside the band), each leaving the position exposed a full cycle. Fix targets a real, observed failure.
- Minor: the clamp is symmetric. A stop-SELL whose stale limit lands **above** ask+band (price crashed since the quote) is clamped to ask+band — a passive sell resting 0.5% above market, which delays the exit in exactly the fast-crash case stops exist for. Direction-aware clamping (SELL → ask−band, COVER/BUY → ask+band) would be strictly better. Severity: LOW (escalation cancel-replace still catches it 2 cycles later).
- Non-stop-loss orders unchanged — 0.2% band still hard-rejects (risk.py:120–135). Rule table in CLAUDE.md:82 matches the code.

### 2. Universe scout (scout.py, run_evaluation.py:783–799) — SOUND WITH ONE GAP
- Gates respected: promoted symbols flow through the unchanged `evaluate_symbol` path — score ≥ 4 entry gate, daily regime gate, correlation budget (counted as Tier-2 via `risk.tier_count`, budget built from live positions at run_evaluation.py:845), ATR sizing, and the 5% default cap enforced in code (`trade.py:_symbol_cap` → `default_cap` 0.05). scout.py itself never places orders; payload written atomically (mkstemp + os.replace).
- **GAP (HIGH): orphaned promoted positions.** The evaluation set = watchlist + *currently* promoted (run_evaluation.py:783–794). The dynamic list is TTL-rescanned (6 h) and only keeps symbols that are *still* uptrend + score ≥ 4. A position opened in a promoted symbol drops out of the evaluation set the moment the symbol loses its uptrend/score — i.e. precisely when the −5% stop / trailing stop / TA exit must fire. Nothing merges open-position symbols back in (only stop paths at :414/:481 check open orders; no path adds position symbols to `symbols`). `rebalance.py` also iterates the watchlist only. Until fixed, a scouted position can sit unmanaged indefinitely (the dashboard Autopilot would hard-stop it, but it is OFF by default and not a server-side control).
- Premise supported: today's live dry-run shows **all 10 watchlist symbols regime=downtrend, every entry blocked** — exactly the all-cash scenario the scout addresses. Live `scout.py --force` scan completed without error (universe fetch + filter OK, promoted 0 — honest, consistent with broad downtrend).
- Universe quantified: 26 non-watchlist */USD pairs currently tradable, so `max_scan=60` with `sorted()[:60]` covers 100% (alphabetical truncation is moot today; would bias to A–F if the universe ever exceeds 60). Note: **USDT/USD is in the scan universe** — a stablecoin can technically print "uptrend + score ≥ 4" on ±0.1% noise and waste a promotion slot (dead capital, capped at 5%; not dangerous).

### 3. shorts_enabled = false (config.json:13, run_evaluation.py:611–646) — SOUND, EVIDENCE-SUPPORTED
- Gate sits ahead of the SHORT branch; cover logic untouched (legacy-short safety net retained). Dry-run HOLD reasons are honest: "downtrend, longs blocked; shorts disabled (venue unsupported)".
- Journal evidence: **6/6 SHORT orders ever attempted were rejected, 0 fills** (LTC/USD ×5, DOGE/USD ×1, 2026-06-04…08), all self-rejected on the 0.2% band before reaching Alpaca. Independently, Alpaca spot crypto is non-marginable/non-shortable, so the short half of the strategy was structurally dead code generating rejection noise. Disabling is correct.
- Consistency: CLAUDE.md:91 documents the disable inside the short score-gate rule; README.md and memory files match; dashboard BEAR pills are informational only (dashboard_professional.html:4216, 5916 — "shorts unsupported on Alpaca spot").

### 4. Dashboard Autopilot (apCycle, dashboard_professional.html:6016–6300) — GATES MATCH, TWO WARNINGS
Gate-by-gate vs CLAUDE.md: entry score ≥ 4 (AP_ENTRY_SCORE=4, :6024), max 3 positions (:6028), 2 per tier with Tier-1={BTC,ETH} (:6022/:6029), 20% post-order cash reserve (:6023, :6279–6281), per-symbol caps with 5% default (`PORTFOLIO_CAPS[sym] || 5`, :6272 — values at :1868 match config.json), ATR sizing equity×1%/(1.5×ATR) (:6273), hard stop −5% (settings default, :6187/6229), trailing arms +2.5% / trails 3% below HWM (:6026–6027, persisted in localStorage), TA exit ≤ −2 (:6025), downtrend regime block (:6264), long-only (qty>0 filter :6217), limit-only GTC orders (:6166–6173), paper-mode-only with live-mode refusal (:6138, :6185), OFF on load / never auto-resumes (:6088–6101). All consistent with the hard-rules table.
- **WARNING (MEDIUM): double-execution with the hourly Python loop.** Autopilot (browser, 15/30/60-min cycles) and `run_evaluation.py --execute` (:23 hourly) trade the same 10 symbols on the same account. Exits are reasonably deduplicated both ways (autopilot skips when `qty_available` is locked by a pending order, :6235–6236; Python's stop dedup checks `get_open_orders`, run_evaluation.py:414/481). **Entries are not**: neither side checks pending open BUY orders — both check positions only (:6265; Python entry path has no `get_open_orders` call). Two near-simultaneous limit BUYs on the same symbol can fill → up to 2× the per-symbol cap and 2× the 1%-risk intent; each side's cash-reserve check also won't see the other's unfilled order. Mitigation today: Autopilot is OFF on every load and opt-in. Do not run both concurrently until an open-order entry check exists.
- **WARNING (LOW): order routing + limit-band fidelity.** Autopilot posts directly to `/v2/orders` (:6166), bypassing `scripts/trade.py` — the "Route all orders" hard rule as written. It reimplements the gates, but its limit price is `lastClose×1.001` from the last complete 15-min bar (:6276), not validated against a **live** ask; if price moved >0.2% since that bar closed, the order violates the 0.2%-band rule (harmless when above ask — limit fills at better price; rests if below). Python-side trade.py validation would have caught it.
- Separate HWM stores (Python `data/positions_state.json` vs browser `localStorage.autopilotHwm`) can diverge; whichever loop sees its trail first exits, dedup catches the second. Acceptable.
- Edge tab is analysis-only (FILL reads, no orders) — no rule surface.

### 5. Tests, compile, dry-run
- `python3 -m pytest tests/ -q` in /tmp/verify2: **84 passed in 0.31s** (84 expected — includes 3 new clamp + 3 new scout tests).
- `py_compile` trade.py, scout.py, run_evaluation.py: OK.
- Live dry-run `run_evaluation.py` (no --execute, scout file fresh): 10/10 symbols HOLD, fresh data (BTC ask $62,633.24, ETH $1,642.70), all regimes downtrend, honest reasons, scout merge silent-clean, "No actionable decisions", no orders. (Scout scan in the sandbox used max_scan=8 to fit the execution window — config edit confined to /tmp/verify2; mechanism verified end-to-end, full-universe count verified separately: 26 pairs.)

### 6. Documentation consistency
CLAUDE.md:82 (clamp), :91 (shorts), :281–298 (scout), :356–357 (Autopilot/Edge), :360 (BEAR pills); README.md:146/:437 (scout); docs/dashboard_layout.md:49/:90 (Autopilot, dated changelog); memory/projects/alpaca-trading-agent.md 2026-06-11 entry; glossary updated. All five files reflect the change set. No contradictions found between docs, config and code for the reviewed thresholds.

## Verdict
**PASS WITH WARNINGS**
- PASS — stop-loss clamp: rule-preserving, evidence-backed (3 observed self-rejections), tested.
- PASS — shorts disabled: venue-correct, 6/6 historical shorts rejected with 0 fills, cover retained, docs consistent.
- PASS WITH WARNINGS — scout: all gates respected, premise confirmed live (10/10 watchlist in downtrend), but formerly-promoted open positions fall out of the evaluation set → unmanaged stops (HIGH; fix before a scouted entry fills).
- PASS WITH WARNINGS — dashboard Autopilot: gate parity with CLAUDE.md verified line-by-line, but concurrent operation with the hourly Python loop can double-enter the same symbol (MEDIUM), and it bypasses trade.py band validation (LOW).
- PASS — tests 84/84, compile clean, dry-run clean, docs in sync.

## Recommendations
1. **(HIGH)** In `run_evaluation.main()` merge open-position symbols into the evaluation set: `symbols += [s for s in open_symbols if s not in symbols]` (after :845, or merge positions before evaluating) so stops/trailing/TA exits always cover scouted positions regardless of dynamic-list churn.
2. **(MEDIUM)** Pick one executor at a time: document that Autopilot must stay OFF while the hourly `--execute` schedule is active, or add a pending-open-BUY check to both entry paths (Python: `get_open_orders(symbol)` before BUY; dashboard: fetch `/v2/orders?status=open` in apCycle and treat pending buys as held).
3. **(LOW)** Make the trade.py stop clamp direction-aware: clamp stop-SELL to `ask−band` (marketable) rather than the nearest edge when the stale limit is above the ask.
4. **(LOW)** Exclude stablecoins (at least USDT/USD) from `scout.get_universe()` to avoid wasting a promotion slot.
5. **(LOW)** Have Autopilot validate its limit against a live quote (`/v1beta3/crypto/us/latest/quotes`) instead of lastClose to honour the 0.2% band exactly.

## Data sources
- Code: scripts/trade.py (:181–202 clamp), scripts/scout.py (full), scripts/run_evaluation.py (:607–646 short gate, :761–880 main/merge), scripts/risk.py, docs/dashboard_professional.html (:1868, :4185–4216, :5896–5916, :6016–6300), config.json.
- Docs: CLAUDE.md, README.md, docs/dashboard_layout.md, memory/projects/alpaca-trading-agent.md.
- Tests: `python3 -m pytest tests/ -q` → 84 passed; `py_compile` ×3 OK (isolated copy /tmp/verify2).
- Live (read-only): dry-run `run_evaluation.py` 18:43 GMT+2 (10 HOLDs, fresh quotes); `scout.py --force` (universe 26 non-watchlist USD pairs, promoted 0); `/v2/assets` count.
- Evidence: `grep "SHORT ->" journal/` (6 rejections, 0 fills, 2026-06-04…08); `grep "outside stop-loss" journal/` (3 rejections: AVAX ×2, LINK ×1); regime counts journal/2026-06-03…11.
