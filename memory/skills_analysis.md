---
name: skills-analysis-2026-07-19
description: Analysis of existing skills for programmatic scriptification and identification of additional skills to create
---

# Skills Analysis: Programmatic Opportunities & New Skill Creation

**Date:** 2026-07-19  
**Project:** CryptoPro Trader  
**Scope:** All existing skills + conversation history review  

---

## Part 1: Existing Skills — Programmatic Optimization Opportunities

### Tier 1: Ready for Script-Optimized Versions (Highly Programmatic)

#### 1. **hourly-research** — MIGRATE TO SCRIPT
**Current form:** Manual Claude skill (research-only, no orders)  
**Frequency:** Hourly on the hour  
**Programmatic elements:**
- Fetch bars via `scripts/run_evaluation.py` (100% deterministic)
- Fetch news from external APIs (cryptographic, repeatable)
- Parse indicators from evaluation output (formula-based, no judgment)
- Append structured markdown to journal (template-based)

**Migration to script (`scripts/hourly_research.py`):**
```python
# Deterministic inputs → outputs
# - fetch_indicators(symbols) → dict of {symbol: {ema, macd, rsi, bb, atr, adx, obv}}
# - fetch_news_headlines(symbol, limit=3) → list[headline, source, tier]
# - append_research_block(date, symbols_data) → writes markdown to journal/YYYY-MM-DD.md
```

**Why scripting works:**
- No subjective judgment needed in this step (research is dry fact-collection)
- All indicator calculations are formulas (indicators.py already provides them)
- Output format is standardized (Research HH:MM block template never changes)
- Can be scheduled via GitHub Actions cron without Claude involvement
- Reduces latency: instant vs. waiting for Claude inference

**Script-optimized version:** `scripts/hourly_research.py --symbols watchlist --append-journal`  
**Scheduled:** `.github/workflows/research.yml` (top of every hour)  
**Prerequisite:** Ensure news-fetch logic can be extracted to a standalone function (already exists as `scripts/research.py news`)

---

#### 2. **daily-journal** — MIGRATE TO SCRIPT
**Current form:** Manual Claude skill (write-only, no orders)  
**Frequency:** Daily at 23:21  
**Programmatic elements:**
- Fetch portfolio state via API (deterministic REST call)
- Fetch today's fills via API with date filter (deterministic query)
- Compute realized P&L via FIFO matching (formula-based, already in code)
- Append structured markdown to journal (template-based)

**Migration to script (`scripts/daily_journal.py`):**
```python
# Deterministic inputs → outputs
# - fetch_account_state() → {equity, cash, unrealized_pnl}
# - fetch_fills_today(date) → list[side, qty, price, time]
# - fetch_positions() → list[symbol, qty, entry, current, unrealized_pnl]
# - compute_fifo_realizations(fills) → {symbol: pnl, avg_hold_time}  # already exists in JS
# - append_closing_journal_block(date, account, positions, fills) → writes markdown
```

**Why scripting works:**
- All inputs are API/file reads (no human judgment)
- FIFO P&L computation is pure formula (already implemented in `src/reconcile.js` and Python)
- Output is a standardized markdown block (same template structure every day)
- No risk assessment or trade decisions are made (write-only pass)
- Can run via GitHub Actions after markets close, auto-commit state

**Script-optimized version:** `scripts/daily_journal.py --date today --append-journal`  
**Scheduled:** `.github/workflows/journal.yml` (daily at 23:21 GMT+2)  
**Prerequisite:** Extract FIFO matching logic into a shared module (`scripts/portfolio_state.py` or `src/reconcile.js`)

---

#### 3. **morning-brief** — PARTIALLY SCRIPTABLE (Hybrid)
**Current form:** Manual Claude skill (analysis + write)  
**Frequency:** Daily at 07:00  
**Programmatic elements:**
- Fetch portfolio state via API (deterministic)
- Compute signal confluence scores (formula-based, already in code)
- Generate alerts based on hard rules (rule-engine, deterministic)
- Append structured markdown to journal (template-based)

**Non-programmatic elements:**
- Market Notes (2–4 sentences on broad crypto trend) — subjective analysis
- Interpretation of technical patterns (Wyckoff phase, divergence language) — requires judgment

**Hybrid solution: `scripts/morning_brief.py` + Claude skill post-processor:**
```python
# Step 1: Script (deterministic) — generates 80% of the brief
# - fetch_account_state() → equity, cash, P&L, positions
# - compute_signal_scores(watchlist) → {symbol: score, 4h_regime, daily_regime}
# - check_hard_rules(positions, config) → list[alert, severity, reason]
# - generate_alert_section(alerts) → formatted markdown
# - append_data_only_section(date, state, scores, alerts) → writes to journal

# Step 2: Claude skill (judgment-only) — fills in the 20%
# - Read the auto-generated "## Morning Brief (auto-generated data)" section
# - Write a "### Market Notes" section (2–4 subjective sentences)
# - Append to the same journal entry
```

**Why hybrid works:**
- Removes latency and inference cost from deterministic parts (40+ seconds → <1 second for data)
- Preserves human judgment where it matters (market interpretation)
- 80/20 split maximizes automation without sacrificing quality
- Claude focuses on *pattern meaning*, not *data collection*

**Script-optimized version:** `scripts/morning_brief.py --append-journal`, then human skill adds Market Notes  
**Scheduled:** `.github/workflows/morning.yml` (daily at 07:00 GMT+2, script runs first; Claude runs afterward if needed)  
**Prerequisite:** Extract signal-score computation and alert-checking logic to `scripts/` (already exists in Python; mirror to Node if Node cutover happens)

---

### Tier 2: Partially Programmatic (Manual Skill + Optional Script Helper)

#### 4. **crypto-trader** — ADD SCRIPT HELPER
**Current form:** Manual Claude skill (decision playbook, knowledge-only)  
**Nature:** Reference knowledge, not executable procedure  
**Programmatic elements:**
- Hard thresholds are hardcoded (score gates, RSI ranges, BB %b boundaries) — could be validated
- Decision tree is deterministic given inputs (if score ≥ 3.5 AND daily not downtrend → BUY) — could be unit-tested

**Script helper (`scripts/validate_trader_decisions.py`):**
```python
# Automated validation: ensure execution matches playbook
# - verify_score_gates(execution_log, config) → checks all entries used correct thresholds
# - verify_regime_gates(execution_log) → checks all trades respected daily/4H regime
# - verify_wyckoff_journal_entries() → spot-checks journal entries for phase awareness
# - report: list[violation, trade_id, reason]
```

**Why helpful (not critical):**
- Could catch accidental rule violations in execution logs
- Validates that human decisions in journals align with stated playbook
- Not automatable itself (it's a knowledge base, not a procedure)

**Associated script:** `scripts/validate_trader_decisions.py journal/YYYY-MM-DD.md --config config.json`  
**Usage:** Post-trade verification (daily)

---

#### 5. **crypto-catalysts** — ADD SCRIPT HELPER
**Current form:** Manual Claude skill (news severity ladder, knowledge-only)  
**Nature:** Reference knowledge (T1/T2/T3 catalyst taxonomy), not executable  
**Programmatic elements:**
- T1/T2/T3 definitions are regex-matchable (hack, depeg, ETF flow, etc.)
- Headline severity could be auto-classified based on keywords
- Defensive-only rule (news never justifies entry) is a hard rule to validate

**Script helper (`scripts/classify_news_catalysts.py`):**
```python
# Auto-classify news headlines into T1/T2/T3
# - parse_headlines(newsapi_response, coin_symbols) → list[headline, tier, coin_tags]
# - validate_news_gating(journal_entry, positions) → checks news triggered defensive actions (close/skip) when applicable
# - report: list[headline, tier, action_taken_if_any]
```

**Why helpful:**
- Speeds up hourly-research step (pre-classify news before Claude reads it)
- Validates that high-tier catalysts are acted upon (defensive rule enforcement)
- Could feed into Autopilot to auto-downsize on T1 events

**Associated script:** `scripts/classify_news_catalysts.py --fetch-news watchlist`  
**Usage:** Called by `hourly_research.py` to pre-classify news

---

### Tier 3: Knowledge-Only Skills (No Programmatic Version)

#### 6. **crypto-trading-dashboard-reference** (not yet created)
**Rationale:** Documentation skill — how to use the Autopilot, Settings, and each tab  
**Nature:** Reference knowledge; no executable procedure  
**Example content:** "Autopilot tab › Toggle always starts OFF on page reload. Click to resume. Interval options are 15/30/60 min. Kill switch ⛔ cancels all orders. Activity log shows every decision and why."

**No script version needed** — but should be created as a skill for Claude to consult before using the dashboard interactively.

---

## Part 2: New Skills to Create (Identified from Conversation & Missing Gaps)

### High Priority (Critical Gaps)

#### 1. **stop-watchdog-executor** — CRITICAL
**Frequency:** Every 5 minutes  
**Purpose:** Autonomous stop-loss enforcement outside the hourly evaluation  
**Current state:** Referenced in CLAUDE.md but no dedicated skill exists  
**Status:** Ships-OFF (not yet ported to Node); Python version `scripts/stop_watchdog.py` exists

**Skill content:**
- Check only long-position exit levels (trailing via HWM, 4H swing low, breakeven, −5% fallback)
- Skip symbols with pending SELL orders (dedup with hourly engine + Autopilot)
- Fire the `trade.py` SELL path if a stop is breached
- Commit state + journal only if a stop fires
- Hard rule: this is **EXITS ONLY** — never entries

**Reason to create:** Ensures understanding of the stop-watchdog architecture before Node cutover. Also clarifies the Autopilot's interaction with Python stops.

---

#### 2. **rebalance-executor** — IMPORTANT (Manual CLI Skill)
**Frequency:** Manual (user-initiated)  
**Purpose:** Rebalance portfolio to per-symbol caps  
**Current state:** `scripts/rebalance.py` exists but no skill explains when/why to use it

**Skill content:**
- When to rebalance: drift detected (position > cap, or user wants manual realignment)
- Over-cap logic: SELL excess immediately (no signal gate)
- Under-cap logic: BUY only if signal gate (score ≥ 3) + daily regime allows
- Example: "BTC is 32% of equity (cap is 30%) — run `python scripts/rebalance.py --execute` to trim 2%"

**Reason to create:** Document the manual rebalancing procedure and decision gates.

---

#### 3. **market-researcher-invocation** — DOCUMENTATION
**Frequency:** After strategy changes (optional but recommended)  
**Purpose:** Invoke the `.claude/agents/market-researcher.md` subagent  
**Current state:** CLAUDE.md mentions it but no stand-alone skill explains how/when to use it

**Skill content:**
- When to invoke: after code changes, config changes, rule tweaks, strategy backtest updates
- What it checks: rule consistency (Python/dashboard/docs all align), soundness vs hard rules, profitability vs. current market regime
- Output: timestamped report in `data/market_research/YYYY-MM-DD-HHMM-project-verification.md`
- Example flow: "Edit `indicators.py` → save → immediately invoke market-researcher to verify parity"

**Reason to create:** Ensures strategy changes are always independently verified before live trading.

---

#### 4. **node-cutover-parity-verification** — TECHNICAL REFERENCE
**Frequency:** Pre-cutover (one-time, but referenced thereafter)  
**Purpose:** Step-by-step parity-verification checklist before Node.js cutover  
**Current state:** CLAUDE.md › Node.js port mentions 3-checkpoint cutover gate but no how-to guide exists

**Skill content:**
- Checkpoint 1: Frozen-fixture decision parity (run test suite, diff decisions)
- Checkpoint 2: Live shadow-run parity (both engines dry-run 24+ hours, diff every decision)
- Checkpoint 3: State-file round-trip check (Python writes → Node reads → Python reads, must be identical)
- Post-cutover rollback plan: keep Python cron running for 1 week parallel-with-Node
- Test commands: `npm test`, `npm run evaluate --dry`, `pytest tests/`

**Reason to create:** De-risk the Node.js cutover by providing a clear, testable procedure.

---

#### 5. **dashboard-browser-verification** — QA SKILL
**Frequency:** Pre-production (after any React-shell or tab change)  
**Purpose:** Manual browser-based verification checklist  
**Current state:** CLAUDE.md notes "not yet verified — no browser tool" but doesn't list the checks

**Skill content:**
- Test checklist (all must pass before relying on dashboard for live trading):
  - Page loads without console errors
  - Autopilot toggle works (OFF on reload, can click to toggle ON)
  - Settings save persists across refresh
  - Every tab (Command, Trade, Portfolio, Analysis, Settings) renders and responds to clicks
  - A couple sub-tabs render (e.g. News, Market › Scanner)
  - Nav links work (hash routing, deep links like `#signals`, `#market-signals`)
  - Mobile view (portrait ≤700px) scrolls correctly
  - TradingView links open in a new tab
- Expected outcome: a checklist-completion report stating pass/fail per item

**Reason to create:** Codify the manual QA procedure so it's repeatable and documented.

---

### Medium Priority (Useful But Not Critical)

#### 6. **edge-analytics-interpretation** — ANALYSIS SKILL
**Frequency:** Post-backtest or weekly review  
**Purpose:** Interpret the Edge analytics tab (day-of-week win rates, after-loss behavior, etc.)  
**Current state:** Dashboard tab exists but no guidance on how to *act* on the insights

**Skill content:**
- How to read each analytics card (Day-of-Week Edge, After Losing Streaks, Cadence After Outcome, Rule Discipline)
- When to adjust: "Win rate is 30% on Mondays — consider half-sizing or sitting out that day"
- Example: "After 3+ losses, my entries are smaller but I'm overtrade-ing the rebounds — reduce frequency"
- Ties to: streak throttle rule (already active, but this explains why it exists)

**Reason to create:** Make the behavioral insights actionable, not just observational.

---

#### 7. **scout-enabled-watchlist-strategy** — STRATEGY SKILL
**Frequency:** Ongoing (reference)  
**Purpose:** When and how to use the dynamic scout-promoted watchlist  
**Current state:** CLAUDE.md mentions scout.enabled but doesn't explain the strategic implications

**Skill content:**
- What scout does: promotes ≤3 high-confluence uptrending alts into watchlist dynamically (TTL 6h)
- When enabled: fills gaps when the static 10-symbol watchlist is regime-blocked (whole book downtrending)
- Strategic consideration: Tier-2 correlation budget is 5 slots — scout fills those with candidates ≥ 4 score
- Risk: scout-promoted symbols are unknown (not in PORTFOLIO_CAPS) → use default 5% cap
- Example: "BTC/ETH downtrend, all 10 majors regime-blocked, cash rising. Scout promotes 3 alts at score ≥4. Autopilot sizes them at default 5% cap. If score drops below 4, re-evaluate next cycle."

**Reason to create:** Clarify the role of dynamic watchlist in a hedging strategy.

---

### Lower Priority (Nice to Have)

#### 8. **backtest-interpretation** — ANALYSIS SKILL
**Frequency:** Pre-cutover, and when assumptions change  
**Purpose:** How to read backtest results and compare to live performance  
**Current state:** Dashboard has "Backtest vs Live" tab but no guide on what metrics matter

#### 9. **scalping-setup-scanner** — PROCEDURE SKILL
**Frequency:** Intraday, user-triggered  
**Purpose:** How to scan and execute scalp setups on the Scalping tab  
**Current state:** Tab exists but no playbook for when/why to use it vs. longer-term entries

#### 10. **glossary-maintenance** — DOCUMENTATION SKILL
**Frequency:** Post-feature-release  
**Purpose:** How to keep `memory/glossary.md` up-to-date with new terms, API changes, and feature notes

---

## Part 3: Script-Optimized Skill Migration Plan

### Immediate (Week 1)

| Skill | Migration | Status | Owner | Benefit |
|-------|-----------|--------|-------|---------|
| hourly-research | → `scripts/hourly_research.py` | Not started | Auto | Remove Claude latency; deterministic research |
| daily-journal | → `scripts/daily_journal.py` | Not started | Auto | Remove Claude latency; deterministic P&L |
| crypto-news-classifier | Helper for hourly-research | Not started | Auto | Pre-classify T1/T2/T3 for faster research |
| stop-watchdog-executor | ✓ exists (`scripts/stop_watchdog.py`); create *skill* | Not started | Manual (ref) | Document 5-min stop-loss enforcement |

### Short-term (Month 1)

| Skill | Migration | Status | Owner | Benefit |
|-------|-----------|--------|-------|---------|
| morning-brief | Hybrid: `scripts/morning_brief.py` (80%) + Claude Market Notes (20%) | Not started | Mixed | Reduce latency; preserve judgment |
| rebalance-executor | → Manual CLI skill (no script change; docs only) | Not started | Manual | Document manual rebalancing procedure |
| market-researcher-invocation | → Documentation skill | Not started | Manual | Ensure post-change verification is consistent |

### Medium-term (Before Node Cutover)

| Skill | Migration | Status | Owner | Benefit |
|-------|-----------|--------|-------|---------|
| node-cutover-parity-verification | → Technical reference skill | Not started | Manual | De-risk Node.js cutover |
| dashboard-browser-verification | → QA skill | Not started | Manual | Codify browser verification checklist |
| market-researcher-verification | → Subagent invocation (already automated; create skill) | Partial | Manual | Ensure parity checks run post-change |

### Optional (Long-term Backlog)

- edge-analytics-interpretation (analysis)
- scout-enabled-watchlist-strategy (strategy reference)
- backtest-interpretation (analysis)
- scalping-setup-scanner (procedure)
- glossary-maintenance (documentation)

---

## Summary: Impact & ROI

### Automation (Estimated)
- **hourly-research**: ~40 sec Claude → ~2 sec script (95% latency reduction)
- **daily-journal**: ~60 sec Claude → ~3 sec script (95% latency reduction)
- **morning-brief hybrid**: ~45 sec Claude → 3 sec script + 20 sec Claude for Market Notes (65% latency reduction)
- **Total daily savings**: ~145 sec → ~28 sec = ~82% latency reduction, 117 seconds / day

### Quality Improvements
- **Consistency**: Research/journals always generated on schedule, zero misses
- **Verification**: market-researcher auto-invoked post-change, reducing drift
- **Transparency**: Scripts leave audit trails in GitHub commits; Claude judgments are preserved where it matters

### Risk Reduction
- **Parity verification**: Node cutover has documented checkpoints
- **Dashboard QA**: Browser verification is repeatable and documented
- **Rule enforcement**: Stop-watchdog and rebalance procedures are explicit

---

## Recommendations

1. **Start with `hourly_research.py`**: Lowest risk, highest latency reduction, deterministic steps
2. **Follow with `daily_journal.py`**: Same rationale; these two make the biggest impact
3. **Then hybrid `morning_brief.py`**: Balances automation with judgment; requires careful design
4. **Create reference skills** for stop-watchdog, rebalance, and market-researcher *before* Node cutover
5. **QA skill** (dashboard-browser-verification) should be finalized before any production reliance on React shell

All three scripts should be committed to `.github/workflows/` with GitHub Actions triggers so they run autonomously on schedule.
