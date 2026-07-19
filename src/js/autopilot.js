
    // ═══════════════════════════════════════════════════════════════════════
    //  AUTOPILOT — automated long-only confluence execution (Command tab)
    //  Reuses calcSignalScore / fetchBars / apiPost (same order path as
    //  executeSignalTrade). OFF on every page load — never auto-resumes.
    // ═══════════════════════════════════════════════════════════════════════
    function getApWatchlist() { return getWatchlist(); }   // dynamic — reads settings at call time
    const AP_TIER1 = { "BTC/USD": 1, "ETH/USD": 1 };       // Tier-1; everything else = Tier-2
    const AP_ENTRY_SCORE      = SIGNAL_BUY_SCORE;            // full-size long gate (3.5)
    const AP_HALF_SCORE       = SIGNAL_HALF_SCORE;           // half-size long gate (2.5)
    const AP_DOWNTREND_LONG   = SIGNAL_DOWNTREND_LONG_SCORE; // half-size counter-trend long in a downtrend (≥4)
    const AP_CORR_LIMIT       = 0.9;  // correlation-aware entry gate: ρ > 0.9 vs any open position → half-size
    // TA-exit score, trailing-stop params, cash reserve, swing-low stop params,
    // daily-drawdown gate, and stop-order escalation now live in STRAT_CFG —
    // seeded from config.json › strategy/risk on page load (roadmap item 4) so
    // a config change can't silently fork the Python and dashboard engines.
    // Correlation budget caps are user-configurable (Settings › 🔗 Correlation Budget).
    // Read live at the start of each entry pass via apMaxPositions()/apMaxPerTier().
    function apMaxPositions() { return Math.max(1, Math.round(getSettings().limits.maxOpenPositions || DEFAULT_LIMITS.maxOpenPositions)); }
    function apMaxPerTier()   { return Math.max(1, Math.round(getSettings().limits.maxPositionsPerTier || DEFAULT_LIMITS.maxPositionsPerTier)); }

    // Max Pearson ρ (30-day daily log-returns) between a candidate and the open
    // positions — the live-data upgrade to the static tier budget (roadmap item 9).
    // Returns { sym, rho } for the most-correlated open position, or null.
    function apMaxCorrWith(sym, openSyms, dailyBarsMap) {
      const closesOf = s => {
        const alp = s.replace("/", "");
        return ((dailyBarsMap || {})[s] || (dailyBarsMap || {})[alp] || []).map(b => b.c).slice(-31);
      };
      const rets = closes => {
        const r = [];
        for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
        return r;
      };
      const ra = rets(closesOf(sym));
      let worst = null;
      for (const os of openSyms) {
        if (os === sym) continue;
        const rb = rets(closesOf(os));
        const n = Math.min(ra.length, rb.length);
        if (n < 10) continue;
        const xa = ra.slice(-n), xb = rb.slice(-n);
        const ma = xa.reduce((s, v) => s + v, 0) / n, mb = xb.reduce((s, v) => s + v, 0) / n;
        let num = 0, da = 0, db = 0;
        for (let i = 0; i < n; i++) { const ai = xa[i] - ma, bi = xb[i] - mb; num += ai * bi; da += ai * ai; db += bi * bi; }
        if (!da || !db) continue;
        const rho = num / Math.sqrt(da * db);
        if (!worst || rho > worst.rho) worst = { sym: os, rho };
      }
      return worst;
    }

    let _apTimer = null, _apTick = null, _apRunning = false, _apBusy = false;
    let _apCycles = 0, _apOrders = 0, _apLastCycle = null, _apNextAt = null;

    function apGmt2(ts) {
      return new Date(ts || Date.now()).toLocaleTimeString("en-GB",
        { timeZone: "Etc/GMT-2", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function apGetLog() {
      try { return JSON.parse(localStorage.getItem("autopilotLog") || "[]"); }
      catch (e) { return []; }
    }

    function apLog(kind, msg) {
      const log = apGetLog();
      log.push({ t: apGmt2(), k: kind, m: msg });
      while (log.length > 200) log.shift();               // cap 200 entries
      try { localStorage.setItem("autopilotLog", JSON.stringify(log)); } catch (e) {}
      apRenderLog();
    }

    function apRenderLog() {
      const el = $("apLog");
      if (!el) return;
      const log = apGetLog();
      const col = { entry: "var(--green)", exit: "var(--yellow)", block: "var(--muted)", error: "var(--red)", info: "var(--blue)" };
      el.innerHTML = log.length
        ? log.slice().reverse().map(e =>
            `<div><span style="color:var(--muted)">${e.t}</span> <span style="color:${col[e.k] || "var(--text)"};font-weight:700">[${(e.k || "info").toUpperCase()}]</span> ${e.m}</div>`).join("")
        : '<span style="color:var(--muted)">No autopilot activity yet.</span>';
      apRenderStatusLog();
    }

    // Mirror the last 3 Autopilot log entries into the Command-center trading-status area.
    function apRenderStatusLog() {
      const el = $("tradingStatusLog");
      if (!el) return;
      const col = { entry: "var(--green)", exit: "var(--yellow)", block: "var(--muted)", error: "var(--red)", info: "var(--blue)" };
      const last3 = apGetLog().slice(-3).reverse();
      el.innerHTML = last3.map(e =>
        `<div><span style="color:var(--muted)">${e.t}</span> <span style="color:${col[e.k] || "var(--text)"};font-weight:700">[${(e.k || "info").toUpperCase()}]</span> ${e.m}</div>`).join("");
    }

    function apClearLog() {
      try { localStorage.removeItem("autopilotLog"); } catch (e) {}
      apRenderLog();
    }

    function apIntervalMin() {
      const v = Number(($("apInterval") || {}).value || 60);
      return [15, 30, 60].includes(v) ? v : 60;
    }

    function apStatusRender() {
      const el = $("apStatus");
      if (!el) return;
      if (!_apRunning) {
        el.textContent = `Autopilot is OFF. Cycles run: ${_apCycles} · orders placed: ${_apOrders}.`;
        return;
      }
      let next = "–";
      if (_apNextAt) {
        const ms = Math.max(0, _apNextAt - Date.now());
        next = Math.floor(ms / 60000) + "m " + Math.floor(ms % 60000 / 1000) + "s";
      }
      el.innerHTML = `<b style="color:var(--green)">RUNNING</b> · last cycle: ${_apLastCycle ? apGmt2(_apLastCycle) + " GMT+2" : "–"} · next in ${next} · cycles: ${_apCycles} · orders: ${_apOrders}`;
    }

    // Called once from bootstrapDashboard(). NEVER auto-starts the loop —
    // only restores the interval choice and flags a pre-reload ON state.
    function apInit() {
      const saved = Number(localStorage.getItem("autopilotIntervalMin") || 60);
      const sel = $("apInterval");
      if (sel && [15, 30, 60].includes(saved)) sel.value = String(saved);
      const btn = $("apToggleBtn");
      if (btn && localStorage.getItem("autopilotEnabled") === "1") {
        btn.textContent = "▶ Autopilot was ON before reload — click to resume";
        btn.style.color = "var(--yellow)";
      }
      apRenderLog();
      apStatusRender();
    }

    function apIntervalChanged() {
      try { localStorage.setItem("autopilotIntervalMin", String(apIntervalMin())); } catch (e) {}
      if (_apRunning) {
        apScheduleNext();
        apLog("info", "Interval changed to " + apIntervalMin() + " min — next cycle rescheduled.");
      }
    }

    function apScheduleNext() {
      if (_apTimer) clearTimeout(_apTimer);
      _apNextAt = Date.now() + apIntervalMin() * 60000;
      _apTimer = setTimeout(async () => {
        await apCycle();
        if (_apRunning) apScheduleNext();
      }, apIntervalMin() * 60000);
      apStatusRender();
    }

    function apStop(reason) {
      const wasRunning = _apRunning;
      _apRunning = false;
      if (_apTimer) { clearTimeout(_apTimer); _apTimer = null; }
      if (_apTick)  { clearInterval(_apTick);  _apTick = null; }
      _apNextAt = null;
      try { localStorage.setItem("autopilotEnabled", "0"); } catch (e) {}
      const btn = $("apToggleBtn");
      if (btn) { btn.textContent = "▶ Autopilot OFF"; btn.style.color = ""; }
      apStatusRender();
      if (wasRunning && reason) apLog("info", "Autopilot stopped — " + reason + ".");
    }

    async function apToggle() {
      if (_apRunning) { apStop("toggled off by user"); return; }
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) { alert("Add your Alpaca API key and secret in Settings first."); return; }
      if (s.mode === "live") { alert("Autopilot is paper-mode only. Live order execution is blocked by this dashboard."); return; }
      _apRunning = true;
      try { localStorage.setItem("autopilotEnabled", "1"); } catch (e) {}
      const btn = $("apToggleBtn");
      if (btn) { btn.textContent = "⏸ Autopilot ON"; btn.style.color = "var(--green)"; }
      if (!_apTick) _apTick = setInterval(apStatusRender, 1000);
      apLog("info", "Autopilot started — interval " + apIntervalMin() + " min, " + getApWatchlist().length + " watchlist symbols, long-only.");
      await apCycle();
      if (_apRunning) apScheduleNext();
    }

    async function apKillSwitch() {
      apStop("kill switch");
      try { localStorage.removeItem("autopilotOrderAge"); } catch (e) {}   // stale-order tracker reset
      try {
        const r = await fetch(getBaseUrl() + "/v2/orders", { method: "DELETE", headers: getHeaders() });
        if (!r.ok) throw new Error(r.status + " " + r.statusText);
        let n = 0;
        try { const d = await r.json(); n = Array.isArray(d) ? d.length : 0; } catch (e) {}
        apLog("info", "⛔ Kill switch — cancelled " + n + " open order(s).");
      } catch (e) {
        apLog("error", "Kill switch cancel-all failed: " + e.message);
      }
    }

    function apRoundQty(n) { return Math.floor(n * 1e6) / 1e6; }
    function apPrice(p)    { return p < 1 ? Number(p.toFixed(6)) : Number(p.toFixed(2)); }

    // Cancel a single order (stale-order lifecycle, roadmap item 3).
    // 404 = already filled/cancelled — treated as success.
    async function apCancelOrder(id) {
      const r = await fetch(getBaseUrl() + "/v2/orders/" + id, { method: "DELETE", headers: getHeaders() });
      if (!r.ok && r.status !== 404) throw new Error(r.status + " " + r.statusText);
    }

    async function apPlaceOrder(sym, side, qty, limitPrice, reason) {
      const result = await apiPost("/v2/orders", {
        symbol: sym.replace("/", ""),
        qty: String(qty),
        side: side,
        type: "limit",
        time_in_force: "gtc",
        limit_price: String(limitPrice),
        // "ap-" tag identifies Autopilot orders so the stale-entry sweep never
        // cancels Python-engine or manual trade-modal orders (bugfix 2026-07-08).
        client_order_id: "ap-" + sym.replace("/", "") + "-" + Date.now()
      });
      _apOrders++;
      apLog(side === "buy" ? "entry" : "exit",
        `${side.toUpperCase()} ${qty} ${sym} @ $${limitPrice} limit — ${reason} (order ${(result.id || "?").slice(0, 8)})`);
      return result;
    }

    async function apCycle() {
      if (_apBusy) return;
      _apBusy = true;
      try {
        const s = getSettings();
        if (s.mode === "live") { apLog("error", "Live mode detected — autopilot refuses to run."); apStop("live mode"); return; }
        const L = s.limits;
        const fallbackStopPct = Number(L.assumedStopLossPct || 5);   // fallback hard stop when 4H data missing
        // Strategy params — seeded from config.json › strategy/risk (roadmap item 4)
        const AP_CASH_RESERVE_PCT = STRAT_CFG.cashReservePct;
        const AP_TA_EXIT_SCORE    = STRAT_CFG.taExitScore;
        const AP_TRAIL_ARM_PCT    = STRAT_CFG.trailArmPct;
        const AP_TRAIL_PCT        = STRAT_CFG.trailPct;

        const [acct, positions, openOrders] = await Promise.all([
          apiFetch("/v2/account"),
          apiFetch("/v2/positions"),
          apiFetch("/v2/orders?status=open&limit=100&direction=desc").catch(() => [])
        ]);
        const equity = Number(acct.equity || 0);
        let cash = Number(acct.cash || 0);

        // Daily-drawdown gate (roadmap item 1 — mirrors Python risk.daily_drawdown_gate_triggered
        // + capital-preservation mode): snapshot day-open equity per GMT+2 day in
        // localStorage; once equity falls ≥ daily_drawdown_gate_pct below it, block
        // ALL new entries for the rest of the day. Exits stay fully active.
        const apDay = new Date().toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" });
        let dayOpen = null;
        try { dayOpen = JSON.parse(localStorage.getItem("autopilotDayOpen") || "null"); } catch (e) {}
        if (!dayOpen || dayOpen.day !== apDay || !(Number(dayOpen.equity) > 0)) {
          dayOpen = { day: apDay, equity };                    // day roll — reset the snapshot
          try { localStorage.setItem("autopilotDayOpen", JSON.stringify(dayOpen)); } catch (e) {}
        }
        const dayDrawdownPct = dayOpen.equity > 0 ? (dayOpen.equity - equity) / dayOpen.equity * 100 : 0;
        const ddGateActive = dayDrawdownPct >= STRAT_CFG.dailyDrawdownGatePct;
        if (ddGateActive)
          apLog("block", `Daily-drawdown gate — equity −${fmt(dayDrawdownPct, 2)}% from day open ($${fmt(dayOpen.equity, 0)}) ≥ ${STRAT_CFG.dailyDrawdownGatePct}%. New entries blocked; exits stay active.`);

        // Stale-order lifecycle (roadmap item 3 — mirrors Python stop_loss_escalation_cycles):
        // count the cycles each open order has survived. Unfilled ENTRY limits are
        // cancelled after 1 full cycle (the signal is stale); unfilled EXIT limits
        // are cancel-replaced with a wider band after escalationCycles (below).
        let orderAge = {};
        try { orderAge = JSON.parse(localStorage.getItem("autopilotOrderAge") || "{}"); } catch (e) {}
        const openIds = new Set((openOrders || []).map(o => o.id));
        Object.keys(orderAge).forEach(id => { if (!openIds.has(id)) delete orderAge[id]; });
        (openOrders || []).forEach(o => { orderAge[o.id] = (orderAge[o.id] || 0) + 1; });
        const openSellBySym = {};
        (openOrders || []).forEach(o => {
          const oSym = toSlash(o.symbol);
          if (o.side === "sell" && !openSellBySym[oSym]) openSellBySym[oSym] = o;
        });
        for (const o of (openOrders || [])) {
          // Only sweep the Autopilot's OWN stale entries ("ap-" client_order_id
          // tag) — Python-engine entries and manual resting buy limits must
          // never be cancelled by this loop (bugfix 2026-07-08).
          if (o.side !== "buy" || o.type !== "limit") continue;
          if (!String(o.client_order_id || "").startsWith("ap-")) continue;
          // Bug fix 2026-07-13: cycle-count aging (orderAge[o.id] <= 1) cancelled
          // an entry after just 1 cycle — ~15-30 min at the fastest interval,
          // too short for a limit order to get a fair chance to fill. Gate on
          // real elapsed time instead so every entry gets minStaleEntryAgeHours.
          const ageMs = Date.now() - new Date(o.created_at).getTime();
          if (ageMs < STRAT_CFG.minStaleEntryAgeHours * 3600000) continue;
          try {
            await apCancelOrder(o.id);
            delete orderAge[o.id];
            apLog("info", `Cancelled stale entry limit ${toSlash(o.symbol)} @ $${o.limit_price} — unfilled ≥ ${STRAT_CFG.minStaleEntryAgeHours}h, signal stale.`);
          } catch (e) { apLog("error", `Cancel stale entry ${toSlash(o.symbol)} failed: ${e.message}`); }
        }

        // (a) Scan the watchlist (+ fresh scout promotions, roadmap item 6 —
        //     same merge the Python loop does with data/watchlist_dynamic.json)
        const baseWl = getApWatchlist();
        await loadScoutPromotions().catch(() => null);
        const scoutSyms = scoutExtraSymbols(baseWl);
        if (scoutSyms.length) apLog("info", `Scout promotions merged into scan: ${scoutSyms.join(", ")} (TTL ${_scoutTtlHours}h).`);
        const _apwl = baseWl.concat(scoutSyms);
        const [b15, b4h, bD] = await Promise.all([
          fetchBars(_apwl, "15Min", 120),
          fetchBars(_apwl, "4Hour", 60),
          fetchBars(_apwl, "1Day", 60)
        ]);
        // 4H data fallback (roadmap 2026-07-09 item 6): rebuild short 4H series
        // from 1H bars so Signal 6 / the swing-low stop don't silently degrade.
        const fb4h = await fill4hFallback(_apwl, b4h).catch(() => ({ synthetic: [], degraded: [] }));
        if (fb4h.synthetic.length) apLog("info", `4H fallback: synthetic 4H bars aggregated from 1H for ${fb4h.synthetic.join(", ")}.`);
        if (fb4h.degraded.length)  apLog("error", `DATA-QUALITY WARNING: no usable 4H history for ${fb4h.degraded.join(", ")} — Signal 6 contributes 0 and stops fall back to the fixed %.`);
        const scores = {};
        for (const sym of _apwl) {
          const alp = sym.replace("/", "");
          const a  = ((b15 || {})[sym] || (b15 || {})[alp] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const c4 = ((b4h || {})[sym] || (b4h || {})[alp] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const d  = ((bD  || {})[sym] || (bD  || {})[alp] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          scores[sym] = a.length >= STRAT_CFG.minBarsForSignal ? calcSignalScore(a, c4, d) : null;
        }

        // Fresh snapshot quotes at order time (roadmap item 2): lastClose is the
        // last COMPLETED 15-min bar — up to ~15–30 min stale by design of barsEnd().
        // Limit bands must anchor to the live market; lastClose stays scoring-only.
        const liveQuote = {};
        const liveSpread = {};   // live bid-ask spread % — feeds the round-trip cost model (item 1)
        try {
          const snaps = await fetchSnapshotsInBatches(_apwl);
          for (const sym of _apwl) {
            const snap = snaps[sym] || snaps[sym.replace("/", "")];
            const px = snap ? (snap.latestTrade ? snap.latestTrade.p : (snap.dailyBar ? snap.dailyBar.c : null)) : null;
            if (px > 0) liveQuote[sym] = px;
            const q = snap && snap.latestQuote;
            if (q && q.ap > 0 && q.bp > 0 && q.ap >= q.bp)
              liveSpread[sym] = (q.ap - q.bp) / ((q.ap + q.bp) / 2) * 100;
          }
        } catch (e) { apLog("info", "Snapshot quotes unavailable — falling back to last bar close for limit prices."); }

        // (c) EXITS first — long positions only; shorts are never auto-managed

        // Fill-ledger reconciliation (bugfix 2026-07-18): authoritative,
        // file://-safe cross-check for partial_tp_done/entry_time — see
        // apReconcileFromFills for why this can't rely on positions_state.json.
        let fillRecon = { partialTpSyms: new Set(), entryTime: {} };
        try {
          const heldSymsNow = positions.filter(p => Number(p.qty || 0) > 0).map(p => toSlash(p.symbol));
          const allFills = await edgeFetchAllFills();
          fillRecon = apReconcileFromFills(allFills, heldSymsNow);
        } catch (e) { apLog("info", `Fill-history reconciliation skipped: ${e.message}`); }

        let hwm = {};
        try { hwm = JSON.parse(localStorage.getItem("autopilotHwm") || "{}"); } catch (e) {}
        // Merge the Python engine's persisted HWMs (data/positions_state.json,
        // roadmap item 10): when both loops manage a symbol, trail from
        // max(localStorage, file) so a closed browser can't have missed highs.
        const pyState = await fetchLocalJson(["./data/positions_state.json", "../data/positions_state.json"]);
        if (pyState && pyState.positions) {
          for (const [psym, pst] of Object.entries(pyState.positions)) {
            const fileHwm = Number((pst && pst.high_water_mark) || 0);
            if (fileHwm > 0 && fileHwm > (hwm[psym] || 0)) {
              hwm[psym] = fileHwm;
              apLog("info", `${psym} HWM seeded from Python state file ($${fmt(fileHwm, fileHwm < 1 ? 6 : 2)} > local).`);
            }
          }
        }
        // Partial-TP + entry-time state (roadmap 2026-07-09 items 4+5) —
        // localStorage mirrors of the Python data/positions_state.json fields
        // (partial_tp_done / breakeven_stop / entry_time_iso). Merged from the
        // state file so both engines apply the same ladder to a shared position.
        let partialTp = {};   // sym → breakeven price after the +1R scale-out
        try { partialTp = JSON.parse(localStorage.getItem("autopilotPartialTp") || "{}"); } catch (e) {}
        let entryTime = {};   // sym → entry epoch-ms (stale-position exit)
        try { entryTime = JSON.parse(localStorage.getItem("autopilotEntryTime") || "{}"); } catch (e) {}
        if (pyState && pyState.positions) {
          for (const [psym, pst] of Object.entries(pyState.positions)) {
            if (pst && pst.entry_time_iso && !entryTime[psym]) {
              const t0 = Date.parse(pst.entry_time_iso);
              if (t0 > 0) entryTime[psym] = t0;
            }
            if (pst && pst.partial_tp_done && Number(pst.breakeven_stop) > 0 && !partialTp[psym])
              partialTp[psym] = Number(pst.breakeven_stop);
          }
        }
        const closedSyms = [];
        for (const p of positions) {
          const qty = Number(p.qty || 0);
          if (qty <= 0) continue;
          const sym   = toSlash(p.symbol);
          const alp   = sym.replace("/", "");
          const entry = Number(p.avg_entry_price || 0);
          const res   = scores[sym];
          const cur   = (res && res.lastClose) || Number(p.current_price || 0);
          if (!entry || !cur) continue;
          if (!partialTp[sym] && fillRecon.partialTpSyms.has(sym) && entry > 0) {
            partialTp[sym] = entry;
            apLog("info", `${sym} partial-TP flag restored from fill history (breakeven $${fmt(entry, entry < 1 ? 6 : 2)}) — preventing a repeat scale-out.`);
          }
          if (!entryTime[sym] && fillRecon.entryTime[sym]) entryTime[sym] = fillRecon.entryTime[sym];
          const plPct = (cur - entry) / entry * 100;
          // 4H swing-low stop (TA-driven); fixed % only when 4H data missing.
          const lows4h    = ((b4h || {})[sym] || (b4h || {})[alp] || []).map(b => b.l);
          const swingStop = swingLowStop4h(lows4h, entry);
          let exitReason = null;
          if (plPct >= AP_TRAIL_ARM_PCT)
            hwm[sym] = Math.max(hwm[sym] || 0, cur);        // persist HWM (localStorage autopilotHwm)
          // Armed by the HWM (≥ activation above entry), NOT current P&L —
          // mirrors Python risk.should_trail_stop_out. A pullback below the
          // arm threshold must still fire the trail from the recorded HWM.
          const trailArmed = (hwm[sym] || 0) >= entry * (1 + AP_TRAIL_ARM_PCT / 100);
          if (trailArmed && cur <= hwm[sym] * (1 - AP_TRAIL_PCT / 100))
            exitReason = `trailing stop (HWM $${fmt(hwm[sym], cur < 1 ? 6 : 2)}, −${AP_TRAIL_PCT}% band)`;

          // Partial take-profit ladder (roadmap 2026-07-09 item 4 — mirrors
          // Python should_partial_tp): at +1R sell partialTpFraction and raise
          // the remaining stop to breakeven; the remainder rides the trail.
          if (!exitReason && STRAT_CFG.partialTpEnabled && !partialTp[sym]) {
            const rStop = swingStop || entry * (1 - fallbackStopPct / 100);
            if (rStop < entry && cur >= entry + (entry - rStop) * STRAT_CFG.partialTpRMultiple) {
              const availP = Math.abs(Number(p.qty_available != null ? p.qty_available : p.qty));
              const pQty = apRoundQty(availP * STRAT_CFG.partialTpFraction);
              if (pQty > 0) {
                try {
                  await apPlaceOrder(sym, "sell", pQty, apPrice((liveQuote[sym] || cur) * 0.999),
                    `partial TP +${STRAT_CFG.partialTpRMultiple}R (entry $${fmt(entry, entry < 1 ? 6 : 2)}, R-stop $${fmt(rStop, rStop < 1 ? 6 : 2)}) — selling ${Math.round(STRAT_CFG.partialTpFraction * 100)}%, remaining stop → breakeven`);
                  partialTp[sym] = entry;   // breakeven stop for the remainder
                } catch (e) { apLog("error", `Partial TP ${sym} failed: ${e.message}`); }
                continue;   // remainder re-evaluated next cycle
              }
            }
          }

          // Hard stop with the breakeven ladder: after the partial TP the
          // effective stop is max(4H swing low, breakeven) so the remainder
          // can no longer turn into a loser. Armed trail supersedes.
          const beStop  = partialTp[sym] || null;
          const effStop = Math.max(swingStop || 0, beStop || 0) || null;
          if (!exitReason && !trailArmed) {
            if (effStop && cur <= effStop) {
              exitReason = beStop && effStop === beStop
                ? `breakeven stop after partial TP (price $${fmt(cur, cur < 1 ? 6 : 2)} ≤ entry $${fmt(effStop, effStop < 1 ? 6 : 2)})`
                : `swing-low stop (price $${fmt(cur, cur < 1 ? 6 : 2)} ≤ 4H range low $${fmt(effStop, effStop < 1 ? 6 : 2)})`;
            } else if (!effStop && plPct <= -fallbackStopPct) {
              exitReason = `hard stop fallback (P&L ${fmt(plPct, 2)}% ≤ −${fallbackStopPct}%, no 4H data)`;
            }
          }
          if (!exitReason && res && res.score <= AP_TA_EXIT_SCORE)
            exitReason = `TA exit (score ${res.score} ≤ ${AP_TA_EXIT_SCORE})`;

          // Stale-position exit (roadmap 2026-07-09 item 5): older than
          // maxHoldHours, trail never armed, score below the half-size gate —
          // dead capital blocking a budget slot. Winners are exempt.
          if (!exitReason && STRAT_CFG.maxHoldHours > 0 && !trailArmed
              && res && res.score < AP_HALF_SCORE && entryTime[sym]) {
            const ageH = (Date.now() - entryTime[sym]) / 3600000;
            if (ageH > STRAT_CFG.maxHoldHours)
              exitReason = `stale exit (held ${fmt(ageH, 0)}h > ${STRAT_CFG.maxHoldHours}h, trail never armed, score ${res.score} < ${AP_HALF_SCORE})`;
          }
          if (!exitReason) continue;
          const freshPx = liveQuote[sym] || cur;   // live quote for the limit band (item 2)
          const avail = Math.abs(Number(p.qty_available != null ? p.qty_available : p.qty));
          if (!avail) {
            // Qty locked by an unfilled exit order. Mirror Python's cancel-replace
            // (item 3): after escalationCycles, cancel it and re-place with a
            // wider band so the position never sits unprotected indefinitely.
            const stale = openSellBySym[sym];
            const age = stale ? (orderAge[stale.id] || 0) : 0;
            if (!stale || age < STRAT_CFG.escalationCycles) {
              apLog("block", `${sym} exit skipped — qty locked by an existing open order (dedup${stale ? `, age ${age}/${STRAT_CFG.escalationCycles} cycles` : ""}).`);
              continue;
            }
            try {
              await apCancelOrder(stale.id);
              delete orderAge[stale.id];
              const escBand = 0.005 + STRAT_CFG.escalationExtraPct / 100;   // 0.5% + escalation extra
              const qtyAll = apRoundQty(Math.abs(Number(p.qty || 0)));
              await apPlaceOrder(sym, "sell", qtyAll, apPrice(freshPx * (1 - escBand)),
                `${exitReason} — escalated cancel-replace (exit unfilled ${age} cycles, band −${fmt(escBand * 100, 2)}%)`);
              closedSyms.push(sym);
              delete hwm[sym];
              delete partialTp[sym];
              delete entryTime[sym];
            } catch (e) { apLog("error", `Cancel-replace exit ${sym} failed: ${e.message}`); }
            continue;
          }
          try {
            await apPlaceOrder(sym, "sell", avail, apPrice(freshPx * 0.995), exitReason);  // 0.5% band below live quote
            closedSyms.push(sym);
            delete hwm[sym];
            delete partialTp[sym];
            delete entryTime[sym];
          } catch (e) { apLog("error", `SELL ${sym} failed: ${e.message}`); }
        }
        const heldSyms = positions.filter(p => Number(p.qty || 0) > 0).map(p => toSlash(p.symbol));
        Object.keys(hwm).forEach(k => { if (!heldSyms.includes(k)) delete hwm[k]; });
        Object.keys(partialTp).forEach(k => { if (!heldSyms.includes(k)) delete partialTp[k]; });
        Object.keys(entryTime).forEach(k => { if (!heldSyms.includes(k)) delete entryTime[k]; });
        try { localStorage.setItem("autopilotHwm", JSON.stringify(hwm)); } catch (e) {}
        try { localStorage.setItem("autopilotOrderAge", JSON.stringify(orderAge)); } catch (e) {}
        try { localStorage.setItem("autopilotPartialTp", JSON.stringify(partialTp)); } catch (e) {}

        // (b) ENTRIES — score ≥ 2.5 (half) / 3.5 (full), regime gate (downtrend
        //     allows half-size counter-trend at ≥4), correlation budget, caps, ATR sizing
        const AP_MAX_POSITIONS = apMaxPositions();   // configurable: Settings › Correlation Budget
        const AP_MAX_PER_TIER  = apMaxPerTier();
        const open  = positions.filter(p => Math.abs(Number(p.qty || 0)) > 0 && !closedSyms.includes(toSlash(p.symbol)));
        let total = open.length;
        let tier1 = open.filter(p => AP_TIER1[toSlash(p.symbol)]).length;
        let tier2 = total - tier1;
        const mvBySym = {};
        open.forEach(p => { mvBySym[toSlash(p.symbol)] = Math.abs(Number(p.market_value || 0)); });

        // Daily-drawdown gate (item 1): capital preservation — no new entries.
        const candidates = ddGateActive ? [] : _apwl
          .filter(sym => scores[sym] && scores[sym].score >= AP_HALF_SCORE)
          .sort((a, b) => scores[b].score - scores[a].score);

        if (!candidates.length && !ddGateActive) apLog("info", `Cycle complete — no entry candidates (no watchlist score ≥ ${AP_HALF_SCORE}).`);

        // Session-edge filter (roadmap 2026-07-09 item 8 — experimental, OFF
        // by default): half-size entries when the current GMT+2 hour/weekday
        // bucket has a materially negative realized expectancy.
        let sessionHalf = false;
        if (STRAT_CFG.sessionFilterEnabled && candidates.length) {
          try { sessionHalf = await apSessionPenaltyActive(); }
          catch (e) { apLog("info", "Session-edge filter unavailable: " + e.message); }
          if (sessionHalf) apLog("info", "Session-edge filter: current GMT+2 hour/weekday bucket has negative realized expectancy — half-sizing new entries.");
        }

        for (const sym of candidates) {
          const res = scores[sym];
          const ask = liveQuote[sym] || res.lastClose;   // live quote at order time (item 2)
          const isDown = res.dailyRegime === "downtrend";
          // Downtrend: only a high-confluence (≥4) half-size counter-trend long.
          if (isDown && res.score < AP_DOWNTREND_LONG) { apLog("block", `${sym} score ${res.score} — blocked: downtrend (counter-trend long needs ≥ ${AP_DOWNTREND_LONG}).`); continue; }
          if (mvBySym[sym])                    { apLog("block", `${sym} score ${res.score} — blocked: position already open.`); continue; }
          if (total >= AP_MAX_POSITIONS) {
            // Position rotation (roadmap 2026-07-09 item 2 — mirrors Python
            // apply_rotation): at a full budget a ≥ rotationMinScore candidate
            // replaces the weakest open holding when that holding scores ≤ 0
            // and trails the candidate by ≥ rotationMargin points.
            let rotated = false;
            if (STRAT_CFG.rotationEnabled && res.score >= STRAT_CFG.rotationMinScore) {
              const holdings = Object.keys(mvBySym)
                .filter(hs => scores[hs] && scores[hs].score != null)
                .sort((a, b) => scores[a].score - scores[b].score);
              const weakest = holdings[0];
              const wScore  = weakest != null ? scores[weakest].score : null;
              if (weakest && wScore <= 0 && res.score - wScore >= STRAT_CFG.rotationMargin) {
                const wPos = positions.find(pp => toSlash(pp.symbol) === weakest);
                const wQty = wPos ? Math.abs(Number(wPos.qty_available != null ? wPos.qty_available : wPos.qty)) : 0;
                const wPx  = liveQuote[weakest] || (scores[weakest] && scores[weakest].lastClose) || Number((wPos && wPos.current_price) || 0);
                if (wQty > 0 && wPx > 0) {
                  try {
                    await apPlaceOrder(weakest, "sell", wQty, apPrice(wPx * 0.995),
                      `rotation out — score ${wScore} ≤ 0 while ${sym} scores ${res.score} (≥ +${STRAT_CFG.rotationMargin} margin) at a full budget`);
                    total--;
                    if (AP_TIER1[weakest]) tier1--; else tier2--;
                    delete mvBySym[weakest];
                    delete hwm[weakest]; delete partialTp[weakest]; delete entryTime[weakest];
                    closedSyms.push(weakest);
                    rotated = true;
                  } catch (e) { apLog("error", `Rotation SELL ${weakest} failed: ${e.message}`); }
                }
              }
            }
            if (!rotated) { apLog("block", `${sym} score ${res.score} — blocked: max ${AP_MAX_POSITIONS} open positions reached.`); continue; }
          }
          const isT1 = !!AP_TIER1[sym];
          if (isT1 && tier1 >= AP_MAX_PER_TIER)  { apLog("block", `${sym} score ${res.score} — blocked: Tier-1 budget full (${AP_MAX_PER_TIER}).`); continue; }
          if (!isT1 && tier2 >= AP_MAX_PER_TIER) { apLog("block", `${sym} score ${res.score} — blocked: Tier-2 budget full (${AP_MAX_PER_TIER}).`); continue; }
          if (!ask || !res.atr)                { apLog("block", `${sym} — blocked: missing price/ATR.`); continue; }

          // Correlation-aware gate (item 9): ρ > 0.9 (30-day daily log-returns)
          // vs any open position → half-size the entry (live-data upgrade to the
          // static tier budget; the Risk tab shows the same matrix).
          const corr = apMaxCorrWith(sym, Object.keys(mvBySym), bD);
          const corrHalf = !!(corr && corr.rho > AP_CORR_LIMIT);
          if (corrHalf) apLog("info", `${sym} score ${res.score} — high correlation with open ${corr.sym} (ρ ${fmt(corr.rho, 2)} > ${AP_CORR_LIMIT}) — half-sizing entry.`);

          // Net R:R soft gate (roadmap 2026-07-09 items 1+7 — mirrors Python):
          // reward to the BB-upper target net of round-trip cost (2× taker fee
          // + live spread) vs the distance to the 4H swing-low stop.
          // Soft: skipped when the stop/target geometry is unavailable.
          const lows4hE  = ((b4h || {})[sym] || (b4h || {})[sym.replace("/", "")] || []).map(b => b.l);
          const entryStop = swingLowStop4h(lows4hE, ask);
          const rrTarget  = res.bb && res.bb.upper > ask ? res.bb.upper : null;
          const rrCost    = roundTripCostPct(liveSpread[sym]);
          const rrNet     = netRrPct(ask, entryStop, rrTarget, rrCost);
          if (rrNet !== null && rrNet < STRAT_CFG.minRrHalf) {
            apLog("block", `${sym} score ${res.score} — blocked: net R:R ${fmt(rrNet, 2)} < ${STRAT_CFG.minRrHalf} (round-trip cost ${fmt(rrCost, 2)}%).`);
            continue;
          }
          const rrHalf = rrNet !== null && rrNet < STRAT_CFG.minRrFull;
          if (rrHalf) apLog("info", `${sym} score ${res.score} — net R:R ${fmt(rrNet, 2)} < ${STRAT_CFG.minRrFull} — half-sizing entry.`);

          const capPct = (PORTFOLIO_CAPS[sym] || 5) / 100;            // per-symbol cap (5% default)
          const rawQty = (equity * 0.01) / (res.atr * 1.5);           // 1% risk / 1.5×ATR stop
          const capQty = (equity * capPct) / ask;
          // Half-size for counter-trend (downtrend), below the full-size gate,
          // a >0.9 correlation with an open position, a thin net R:R, or a
          // negative-expectancy session bucket.
          const halfSize = isDown || res.score < AP_ENTRY_SCORE || corrHalf || rrHalf || sessionHalf;
          const sizeNote = isDown ? "half-size counter-trend"
            : corrHalf ? `half-size (ρ ${fmt(corr.rho, 2)} vs ${corr.sym})`
            : rrHalf ? `half-size (net R:R ${fmt(rrNet, 2)})`
            : sessionHalf ? "half-size (session filter)"
            : (res.score < AP_ENTRY_SCORE ? "half-size" : "full-size");
          let qty = Math.min(rawQty, capQty) * (halfSize ? 0.5 : 1);
          const limit = apPrice(ask * 1.001);                         // limit at live ask, within 0.2% band

          // Cash-reserve gate: keep ≥ 20% of equity in cash AFTER the order
          const headroom = cash - equity * AP_CASH_RESERVE_PCT / 100;
          if (headroom <= 0) { apLog("block", `${sym} score ${res.score} — blocked: cash reserve gate (cash $${fmt(cash, 0)} ≤ ${AP_CASH_RESERVE_PCT}% of equity).`); continue; }
          if (qty * limit > headroom) qty = headroom / limit;
          qty = apRoundQty(qty);
          if (!qty || qty * limit < 10) { apLog("block", `${sym} score ${res.score} — blocked: sized below $10 notional after gates.`); continue; }

          try {
            await apPlaceOrder(sym, "buy", qty, limit, `entry — score ${res.score}, regime ${res.dailyRegime}, ${sizeNote} ATR sizing`);
            total++; if (isT1) tier1++; else tier2++;
            cash -= qty * limit;
            mvBySym[sym] = qty * limit;
            entryTime[sym] = Date.now();   // stale-position exit clock (item 5)
          } catch (e) { apLog("error", `BUY ${sym} failed: ${e.message}`); }
        }
        // Re-persist the position-tracking maps — entries added entry times and
        // a rotation may have deleted the rotated-out symbol's state.
        try { localStorage.setItem("autopilotEntryTime", JSON.stringify(entryTime)); } catch (e) {}
        try { localStorage.setItem("autopilotHwm", JSON.stringify(hwm)); } catch (e) {}
        try { localStorage.setItem("autopilotPartialTp", JSON.stringify(partialTp)); } catch (e) {}
      } catch (e) {
        apLog("error", "Cycle error: " + e.message);
      } finally {
        _apBusy = false;
        _apCycles++;
        _apLastCycle = Date.now();
        apStatusRender();
      }
    }
