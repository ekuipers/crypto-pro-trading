
    // ── project-local JSON fetch (graceful) ───────────────────────────────
    // Tries each relative path in order and returns the first parsed object,
    // else null. The Python engine's files (config.json, data/*.json) sit one
    // level above docs/, so callers pass both candidate paths.
    async function fetchLocalJson(paths) {
      for (const p of paths) {
        try {
          const r = await fetch(p, { cache: "no-store" });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && typeof j === "object") return j;
        } catch (e) { /* try next path */ }
      }
      return null;
    }

    // Same fallback-path fetch as fetchLocalJson, but for plain text files
    // (used to load memory/glossary.md into the Glossary sub-tab).
    async function fetchLocalText(paths) {
      for (const p of paths) {
        try {
          const r = await fetch(p, { cache: "no-store" });
          if (!r.ok) continue;
          const t = await r.text();
          if (t && t.trim()) return t;
        } catch (e) { /* try next path */ }
      }
      return null;
    }

    // ── config.json load (same directory as this HTML, then project root) ─
    async function loadConfigFromFile() {
      // config.json is the source of truth on page load. Falls back to
      // browser-stored settings if the file is missing or fetch is blocked.
      const cfg = await fetchLocalJson(["./config.json", "../config.json"]);
      if (!cfg) {
        console.info("config.json not loaded (using browser-stored settings)");
        return false;
      }
      const existing = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
      const merged = Object.assign({}, existing);
      ["mode","paperApiKey","paperApiSecret","liveApiKey","liveApiSecret"].forEach(function(k){
        if (cfg[k] !== undefined && cfg[k] !== "") merged[k] = cfg[k];
      });
      // localStorage (user-saved limits) wins; config.json only fills gaps.
      merged.limits = Object.assign({}, cfg.limits || {}, existing.limits || {});
      localStorage.setItem("proDashboardSettings", JSON.stringify(merged));
      seedStrategyConfig(cfg);
      if (document.getElementById("setPaperApiKey")) loadSettingsForm();
      return true;
    }

    // Seed STRAT_CFG from config.json › strategy/risk/data so the Autopilot and
    // signal engine use the same thresholds as the Python loop (roadmap item 4).
    // Fractional config values (0.03) are converted to percent (3).
    function seedStrategyConfig(cfg) {
      const st = cfg.strategy || {}, rk = cfg.risk || {}, dt = cfg.data || {};
      const num = v => (typeof v === "number" && isFinite(v)) ? v : null;
      if (num(st.sell_score_threshold)           !== null) STRAT_CFG.taExitScore          = st.sell_score_threshold;
      if (num(rk.trailing_stop_activation_pct)   !== null) STRAT_CFG.trailArmPct          = rk.trailing_stop_activation_pct * 100;
      if (num(rk.trailing_stop_trail_pct)        !== null) STRAT_CFG.trailPct             = rk.trailing_stop_trail_pct * 100;
      if (num(rk.min_cash_reserve_pct)           !== null) STRAT_CFG.cashReservePct       = rk.min_cash_reserve_pct * 100;
      if (num(rk.swing_low_lookback_bars)        !== null) STRAT_CFG.swingLowLookback     = rk.swing_low_lookback_bars;
      if (num(rk.swing_low_buffer_pct)           !== null) STRAT_CFG.swingLowBufferPct    = rk.swing_low_buffer_pct * 100;
      if (num(rk.swing_low_max_stop_pct)         !== null) STRAT_CFG.swingLowMaxStopPct   = rk.swing_low_max_stop_pct * 100;
      if (num(dt.min_bars_for_signal)            !== null) STRAT_CFG.minBarsForSignal     = dt.min_bars_for_signal;
      if (num(rk.daily_drawdown_gate_pct)        !== null) STRAT_CFG.dailyDrawdownGatePct = rk.daily_drawdown_gate_pct * 100;
      if (num(rk.stop_loss_escalation_cycles)    !== null) STRAT_CFG.escalationCycles     = rk.stop_loss_escalation_cycles;
      if (num(rk.stop_loss_escalation_extra_pct) !== null) STRAT_CFG.escalationExtraPct   = rk.stop_loss_escalation_extra_pct * 100;
      if (num(rk.min_stale_entry_age_hours)      !== null) STRAT_CFG.minStaleEntryAgeHours = rk.min_stale_entry_age_hours;
      if (cfg.scout && num(cfg.scout.ttl_hours)  !== null) _scoutTtlHours                 = cfg.scout.ttl_hours;
      // Roadmap 2026-07-09 keys (trade economics, rotation, ladders):
      const co = cfg.costs || {};
      if (num(co.taker_fee_bps_per_side)         !== null) STRAT_CFG.feeBpsPerSide        = co.taker_fee_bps_per_side;
      if (num(st.min_rr_full)                    !== null) STRAT_CFG.minRrFull            = st.min_rr_full;
      if (num(st.min_rr_half)                    !== null) STRAT_CFG.minRrHalf            = st.min_rr_half;
      if (typeof st.rotation_enabled === "boolean")        STRAT_CFG.rotationEnabled      = st.rotation_enabled;
      if (num(st.rotation_min_score)             !== null) STRAT_CFG.rotationMinScore     = st.rotation_min_score;
      if (num(st.rotation_score_margin)          !== null) STRAT_CFG.rotationMargin       = st.rotation_score_margin;
      if (num(rk.max_hold_hours)                 !== null) STRAT_CFG.maxHoldHours         = rk.max_hold_hours;
      if (typeof rk.partial_tp_enabled === "boolean")      STRAT_CFG.partialTpEnabled     = rk.partial_tp_enabled;
      if (num(rk.partial_tp_r_multiple)          !== null) STRAT_CFG.partialTpRMultiple   = rk.partial_tp_r_multiple;
      if (num(rk.partial_tp_fraction)            !== null) STRAT_CFG.partialTpFraction    = rk.partial_tp_fraction;
      if (typeof st.session_filter_enabled === "boolean")  STRAT_CFG.sessionFilterEnabled = st.session_filter_enabled;
      if (num(st.session_min_sample)             !== null) STRAT_CFG.sessionMinSample     = st.session_min_sample;
      const wf = cfg.walkforward || {};
      if (num(wf.max_baseline_age_days)          !== null) STRAT_CFG.wfMaxAgeDays         = wf.max_baseline_age_days;
    }

    // ── Walk-forward baseline banner (roadmap 2026-07-10 item 8) ───────────
    // scripts/walkforward_evaluate.py writes reports/walkforward_latest.json
    // (stable name — a file:// page cannot list the reports directory).
    // Shows the baseline date + headline avg Sharpe per timeframe, red when
    // older than STRAT_CFG.wfMaxAgeDays (config walkforward.max_baseline_age_days).
    async function loadWalkforwardBaseline() {
      const el = $("wfBaseline");
      if (!el) return;
      let latest = null;
      for (const path of ["../reports/walkforward_latest.json", "./reports/walkforward_latest.json"]) {
        try { const r = await fetch(path, {cache: "no-store"}); if (r.ok) { latest = await r.json(); break; } }
        catch (_) { /* try next path */ }
      }
      if (!latest || !latest.generated_utc) {
        el.style.display = "block";
        el.style.color = "var(--muted)";
        el.textContent = "Walk-forward baseline: reports/walkforward_latest.json not found yet — it is written by the next Forward Analysis run.";
        return;
      }
      const m = String(latest.generated_utc).match(/^(\d{4})(\d{2})(\d{2})T/);
      const genDate = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : null;
      const ageDays = genDate ? Math.floor((Date.now() - genDate.getTime()) / 86400000) : null;
      const maxAge  = STRAT_CFG.wfMaxAgeDays || 45;
      const stale   = ageDays !== null && ageDays > maxAge;
      const fee     = latest.params && latest.params.fee_bps;
      const tfBits  = [];
      for (const [tf, syms] of Object.entries(latest.summary || {})) {
        const sharpes = Object.values(syms || {}).map(s => s && s.avg_sharpe).filter(v => typeof v === "number");
        if (sharpes.length) tfBits.push(`${tf} avg Sharpe ${(sharpes.reduce((a,b)=>a+b,0)/sharpes.length).toFixed(2)}`);
      }
      el.style.display = "block";
      el.style.color = stale ? "var(--red)" : "var(--muted)";
      el.innerHTML = (stale ? "⚠ <b>Walk-forward baseline is stale</b> — " : "🧪 Walk-forward baseline: ")
        + `${m ? `${m[1]}-${m[2]}-${m[3]}` : latest.generated_utc}`
        + (ageDays !== null ? ` (${ageDays}d old${stale ? `, max ${maxAge}d — re-run scripts/walkforward_evaluate.py` : ""})` : "")
        + (fee != null ? ` · fees ${fee} bps/side` : "")
        + (tfBits.length ? " · " + tfBits.join(" · ") : "");
    }

    // ── Scout promotions (data/watchlist_dynamic.json) ─────────────────────
    // scripts/scout.py auto-promotes uptrending high-confluence pairs and the
    // Python loop merges them into every evaluation. Surface them here too so
    // Signals, Autopilot, and Command see the bot's real universe (roadmap
    // item 6). Promotions older than the scout TTL are shown but marked stale
    // and excluded from scans.
    let _scoutTtlHours = 6;           // config.json › scout.ttl_hours (seeded above)
    let _scoutPromos   = null;        // { symbols, details, generated, ageHours, fresh }
    async function loadScoutPromotions() {
      const j = await fetchLocalJson(["./data/watchlist_dynamic.json", "../data/watchlist_dynamic.json"]);
      if (!j || !Array.isArray(j.symbols)) { _scoutPromos = null; return null; }
      const gen = j.generated ? new Date(j.generated) : null;
      const ageHours = (gen && !isNaN(gen)) ? (Date.now() - gen.getTime()) / 3600000 : null;
      _scoutPromos = {
        symbols: j.symbols.filter(s => typeof s === "string" && s.includes("/")),
        details: Array.isArray(j.details) ? j.details : [],
        generated: gen,
        ageHours,
        fresh: ageHours !== null && ageHours <= _scoutTtlHours
      };
      return _scoutPromos;
    }

    // Fresh promoted symbols not already in `base` (respects the scout TTL).
    function scoutExtraSymbols(base) {
      if (!_scoutPromos || !_scoutPromos.fresh) return [];
      return _scoutPromos.symbols.filter(s => !base.includes(s));
    }

    function getSettings() {
      const saved       = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
      const mode        = saved.mode || "paper";
      const paperKey    = saved.paperApiKey    || saved.apiKey    || "";
      const paperSecret = saved.paperApiSecret || saved.apiSecret || "";
      const liveKey     = saved.liveApiKey    || "";
      const liveSecret  = saved.liveApiSecret || "";
      return {
        paperApiKey:    paperKey,
        paperApiSecret: paperSecret,
        liveApiKey:     liveKey,
        liveApiSecret:  liveSecret,
        apiKey:    mode === "live" ? liveKey    : paperKey,
        apiSecret: mode === "live" ? liveSecret : paperSecret,
        mode,
        limits: Object.assign({}, DEFAULT_LIMITS, saved.limits || {})
      };
    }

    function getBaseUrl() {
      const s = getSettings();
      return s.mode === "live"
        ? "https://api.alpaca.markets"
        : "https://paper-api.alpaca.markets";
    }

    function getHeaders() {
      const s = getSettings();
      return {
        "APCA-API-KEY-ID": s.apiKey,
        "APCA-API-SECRET-KEY": s.apiSecret
      };
    }

    async function apiFetch(path) {
      const s = getSettings();

      if (!s.apiKey || !s.apiSecret) {
        throw new Error("Add your Alpaca API key and secret in Settings first.");
      }

      const r = await fetch(getBaseUrl() + path, {
        headers: getHeaders()
      });

      if (!r.ok) {
        throw new Error(r.status + " " + r.statusText + " for " + path);
      }

      return r.json();
    }

    async function apiPost(path, payload) {
      const s = getSettings();

      if (!s.apiKey || !s.apiSecret) {
        throw new Error("Add your Alpaca API key and secret in Settings first.");
      }

      const r = await fetch(getBaseUrl() + path, {
        method:"POST",
        headers:Object.assign({}, getHeaders(), {
          "Content-Type":"application/json"
        }),
        body:JSON.stringify(payload)
      });

      const text = await r.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw:text };
      }

      if (!r.ok) {
        throw new Error(data.message || data.error || r.status + " " + r.statusText);
      }

      return data;
    }
