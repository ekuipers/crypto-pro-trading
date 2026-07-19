
    // ═══════════════════════════════════════════════════════════════════════
    //  EDGE ANALYSIS TAB — realized round-trip expectancy from FILL activities
    //  On-demand via "▶ Analyze" (same pattern as the Markov tab).
    // ═══════════════════════════════════════════════════════════════════════
    async function edgeFetchAllFills() {
      let all = [];
      let pageToken = null;
      for (let i = 0; i < 100; i++) {                      // safety cap: 10,000 fills
        let url = "/v2/account/activities?activity_type=FILL&page_size=100&direction=desc";
        if (pageToken) url += "&page_token=" + encodeURIComponent(pageToken);
        const batch = await apiFetch(url);
        if (!Array.isArray(batch) || batch.length === 0) break;
        all = all.concat(batch);
        if (batch.length < 100) break;
        pageToken = batch[batch.length - 1].id;
      }
      return all;
    }

    // Reconcile partial-TP state + entry time directly from Alpaca's own FILL
    // ledger — the same FIFO walk as Python's reconcile_positions_from_fills()
    // (scripts/run_evaluation.py). The Autopilot previously learned the OTHER
    // engine's partial_tp_done/entry_time_iso only via a positions_state.json
    // fetch() (see the pyState merge in apCycle), a same-origin relative file
    // read that browsers block when this dashboard is opened via file:// —
    // same root cause as the Glossary tab fix (2026-07-18). When that merge
    // silently no-ops, neither engine's own local flag is set, so the +1R
    // partial-TP check re-fires on the already-reduced remainder every cycle
    // (50% of 50% of 50%...), pinning the stop to breakeven on a sliver of
    // the original position long before a real trailing stop can arm — the
    // fast, no-profit exits reported 2026-07-18. Alpaca's FILL activity feed
    // is a normal cross-origin HTTPS call via apiFetch (unaffected by
    // file://) and is the same source Python already trusts, so it is
    // authoritative regardless of whether the state-file merge works.
    const _AP_RECONCILE_DUST_REL_TOL = 0.005;   // mirrors Python's _RECONCILE_DUST_REL_TOL
    function apReconcileFromFills(fills, heldSymbols) {
      const held = new Set(heldSymbols);
      const hist = {};   // sym -> { lots:[[remaining, price, original]], startIso, sellsSinceStart }
      const chron = [...(fills || [])].reverse();   // fills arrive newest-first
      for (const act of chron) {
        const sym   = toSlash(act.symbol || "");
        const side  = act.side;
        const qty   = Math.abs(Number(act.qty || 0));
        const price = Number(act.price || 0);
        const when  = act.transaction_time || act.date;
        if (!sym || qty <= 0 || price <= 0) continue;
        if (!hist[sym]) hist[sym] = { lots: [], startIso: null, sellsSinceStart: 0 };
        const h = hist[sym];
        if (side === "buy") {
          if (h.lots.length === 0) { h.startIso = when; h.sellsSinceStart = 0; }   // flat -> long
          h.lots.push([qty, price, qty]);   // [remaining, price, original]
        } else if (side === "sell") {
          let remaining = qty;
          while (remaining > 1e-9 && h.lots.length) {
            const lot = h.lots[0];
            const m = Math.min(remaining, lot[0]);
            lot[0] -= m; remaining -= m;
            const dust = Math.max(1e-9, lot[2] * _AP_RECONCILE_DUST_REL_TOL);
            if (lot[0] < dust) h.lots.shift();
          }
          if (h.lots.length) h.sellsSinceStart += 1;          // partial — position survives
          else { h.startIso = null; h.sellsSinceStart = 0; }  // fully closed
        }
      }
      const partialTpSyms = new Set(), entryTime = {};
      for (const sym of held) {
        const h = hist[sym];
        if (!h || !h.lots.length) continue;
        if (h.sellsSinceStart > 0) partialTpSyms.add(sym);
        if (h.startIso) {
          const t0 = Date.parse(h.startIso);
          if (t0 > 0) entryTime[sym] = t0;
        }
      }
      return { partialTpSyms, entryTime };
    }

    // FIFO round-trip matcher WITH timestamps. Standalone from computeFifoStats
    // (which stays untouched as the shared P&L/Backtest engine) because the
    // Edge tab needs per-round-trip entry/exit times for holding-time stats.
    function edgeFifoTrades(activities) {
      const sorted = [...activities].reverse();            // chronological
      const queues = {};
      const rts = [];
      for (const act of sorted) {
        const sym = act.symbol, side = act.side;
        const qty = Math.abs(Number(act.qty || 0));
        const price = Number(act.price || 0);
        const t = new Date(act.transaction_time || act.date || 0);
        if (!queues[sym]) queues[sym] = [];
        if (side === "buy") {
          queues[sym].push({ qty, price, t });
        } else if (side === "sell") {
          let remaining = qty, pnl = 0, entryT = null;
          while (remaining > 1e-9 && queues[sym].length > 0) {
            const e = queues[sym][0];
            const m = Math.min(remaining, e.qty);
            pnl += m * (price - e.price);
            if (!entryT) entryT = e.t;                     // first FIFO entry time
            e.qty -= m; remaining -= m;
            if (e.qty < 0.000001) queues[sym].shift();
          }
          if (entryT) rts.push({ sym: toSlash(sym), pnl, entryT, exitT: t, holdMs: t - entryT });
        }
      }
      return rts;
    }

    // Session-edge feedback loop (roadmap 2026-07-09 item 8 — OFF by default,
    // STRAT_CFG.sessionFilterEnabled). True when the current GMT+2 hour or
    // weekday bucket has ≥ sessionMinSample realized round-trips with negative
    // net P&L. Reuses the Edge tab's FIFO engine; cached 6h to avoid re-paging
    // the full FILL history every Autopilot cycle.
    let _sessionPenaltyCache = null;   // { at, hours:{}, dows:{} }
    async function apSessionPenaltyActive() {
      if (!_sessionPenaltyCache || Date.now() - _sessionPenaltyCache.at > 6 * 3600000) {
        const rts = edgeFifoTrades(await edgeFetchAllFills());
        const hourAgg = {}, dowAgg = {};
        for (const r of rts) {
          const h = Number(r.exitT.toLocaleString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", hour12: false })) % 24;
          const d = r.exitT.toLocaleDateString("en-US", { timeZone: "Etc/GMT-2", weekday: "short" });
          (hourAgg[h] = hourAgg[h] || { n: 0, pnl: 0 }).n++; hourAgg[h].pnl += r.pnl;
          (dowAgg[d] = dowAgg[d] || { n: 0, pnl: 0 }).n++;  dowAgg[d].pnl  += r.pnl;
        }
        const hours = {}, dows = {};
        Object.entries(hourAgg).forEach(([h, v]) => { if (v.n >= STRAT_CFG.sessionMinSample && v.pnl < 0) hours[h] = 1; });
        Object.entries(dowAgg).forEach(([d, v])  => { if (v.n >= STRAT_CFG.sessionMinSample && v.pnl < 0) dows[d]  = 1; });
        _sessionPenaltyCache = { at: Date.now(), hours, dows };
      }
      const now = new Date();
      const h = Number(now.toLocaleString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", hour12: false })) % 24;
      const d = now.toLocaleDateString("en-US", { timeZone: "Etc/GMT-2", weekday: "short" });
      return !!(_sessionPenaltyCache.hours[h] || _sessionPenaltyCache.dows[d]);
    }

    function edgeFmtDur(ms) {
      if (ms == null || isNaN(ms) || ms < 0) return "–";
      const m = Math.round(ms / 60000);
      if (m < 60) return m + "m";
      const h = Math.floor(m / 60);
      if (h < 48) return h + "h " + (m % 60) + "m";
      return Math.floor(h / 24) + "d " + (h % 24) + "h";
    }

    function edgePnlColor(v) { return v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--muted)"; }
    function edgePnlStr(v)   { return (v >= 0 ? "+$" : "−$") + fmt(Math.abs(v)); }

    async function loadEdge() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("edgeTakeaway").textContent = "Configure API credentials in Settings first.";
        return;
      }
      $("edgeTakeaway").textContent = "⏳ Fetching all FILL activities (paginated)…";
      try {
        const fills = await edgeFetchAllFills();
        const rts = edgeFifoTrades(fills);
        if (!rts.length) {
          $("edgeKpis").innerHTML = kpi("Round-Trips", 0, "No realized round-trips yet");
          $("edgeSymBody").innerHTML = '<tr><td colspan="8" class="placeholder">No realized round-trips.</td></tr>';
          $("edgeHourChart").innerHTML = "No data.";
          $("edgeDowChart").innerHTML = "No data.";
          $("edgeTakeaway").textContent = `No completed round-trips found in ${fills.length} fill(s) — nothing to analyse yet.`;
          return;
        }

        // ── Summary KPI tiles ──
        const wins   = rts.filter(r => r.pnl >= 0);
        const losses = rts.filter(r => r.pnl < 0);
        const netPnl = rts.reduce((a, r) => a + r.pnl, 0);
        const expectancy = netPnl / rts.length;
        const avgWin  = wins.length ? wins.reduce((a, r) => a + r.pnl, 0) / wins.length : null;
        const avgLoss = losses.length ? Math.abs(losses.reduce((a, r) => a + r.pnl, 0)) / losses.length : null;
        const payoff  = (avgWin !== null && avgLoss) ? avgWin / avgLoss : null;
        const holds   = rts.map(r => r.holdMs).sort((a, b) => a - b);
        const medHold = holds[Math.floor(holds.length / 2)];
        $("edgeKpis").innerHTML = [
          kpi("Round-Trips", rts.length, `${wins.length}W / ${losses.length}L · ${fmt(wins.length / rts.length * 100, 1)}% win rate`),
          kpi("Expectancy / Trade", edgePnlStr(expectancy), `Net realized ${edgePnlStr(netPnl)} across ${fills.length} fills`, expectancy >= 0 ? "pos" : "neg"),
          kpi("Payoff Ratio", payoff !== null ? fmt(payoff, 2) : "n/a", avgWin !== null && avgLoss !== null ? `avg win $${fmt(avgWin)} ÷ avg loss $${fmt(avgLoss)}` : "needs ≥ 1 win and ≥ 1 loss"),
          kpi("Median Hold", edgeFmtDur(medHold), "first FIFO entry fill → exit fill")
        ].join("");

        // ── Per-symbol expectancy table ──
        const bySym = {};
        rts.forEach(r => {
          if (!bySym[r.sym]) bySym[r.sym] = { n: 0, w: 0, winSum: 0, lossSum: 0, pnl: 0, holdSum: 0 };
          const o = bySym[r.sym];
          o.n++; o.pnl += r.pnl; o.holdSum += r.holdMs;
          if (r.pnl >= 0) { o.w++; o.winSum += r.pnl; } else { o.lossSum += Math.abs(r.pnl); }
        });
        const symRows = Object.keys(bySym).map(sym => Object.assign({ sym }, bySym[sym]))
          .sort((a, b) => b.pnl - a.pnl);
        $("edgeSymBody").innerHTML = symRows.map(o => {
          const nl = o.n - o.w;
          const aw = o.w ? o.winSum / o.w : null;
          const al = nl ? o.lossSum / nl : null;
          const pf = o.lossSum > 0 ? o.winSum / o.lossSum : null;
          return `<tr>
            <td><span class="symbol">${tvLink(o.sym)}</span></td>
            <td class="right">${o.n}</td>
            <td class="right">${fmt(o.w / o.n * 100, 1)}%</td>
            <td class="right pos">${aw !== null ? "$" + fmt(aw) : "–"}</td>
            <td class="right neg">${al !== null ? "$" + fmt(al) : "–"}</td>
            <td class="right">${pf !== null ? fmt(pf, 2) : "n/a"}</td>
            <td class="right" style="color:${edgePnlColor(o.pnl)};font-weight:700">${edgePnlStr(o.pnl)}</td>
            <td class="right">${edgeFmtDur(o.holdSum / o.n)}</td>
          </tr>`;
        }).join("");

        // ── Hour-of-day & day-of-week attribution (exit time, GMT+2) ──
        const hourPnl = Array(24).fill(0), hourN = Array(24).fill(0);
        const dowPnl  = Array(7).fill(0),  dowN  = Array(7).fill(0);
        const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        rts.forEach(r => {
          const h = Number(r.exitT.toLocaleString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", hour12: false })) % 24;
          const d = dowNames.indexOf(r.exitT.toLocaleDateString("en-US", { timeZone: "Etc/GMT-2", weekday: "short" }));
          if (h >= 0 && h < 24) { hourPnl[h] += r.pnl; hourN[h]++; }
          if (d >= 0)           { dowPnl[d]  += r.pnl; dowN[d]++; }
        });

        const maxAbsH = Math.max(...hourPnl.map(Math.abs), 1e-9);
        $("edgeHourChart").innerHTML =
          '<div style="display:flex;gap:2px;align-items:flex-end;height:84px;margin-top:8px">' +
          hourPnl.map((v, h) => {
            const hgt = hourN[h] ? Math.max(4, Math.abs(v) / maxAbsH * 72) : 3;
            const bg = hourN[h] ? (v >= 0 ? "var(--green)" : "var(--red)") : "rgba(255,255,255,.08)";
            return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end" data-tip="${String(h).padStart(2, "0")}:00 GMT+2 — ${hourN[h]} trade(s), ${edgePnlStr(v)}"><div style="height:${hgt}px;background:${bg};border-radius:2px"></div></div>`;
          }).join("") + "</div>" +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>';

        const maxAbsD = Math.max(...dowPnl.map(Math.abs), 1e-9);
        const dowOrder = [1, 2, 3, 4, 5, 6, 0];            // Monday-first
        $("edgeDowChart").innerHTML = '<div style="display:grid;gap:6px;margin-top:8px">' +
          dowOrder.map(d => `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:36px;font-size:11px;color:var(--muted)">${dowNames[d]}</span>
              <span style="flex:1;height:8px;background:rgba(255,255,255,.08);border-radius:4px">
                <span style="display:block;height:100%;width:${Math.abs(dowPnl[d]) / maxAbsD * 100}%;background:${dowPnl[d] >= 0 ? "var(--green)" : "var(--red)"};border-radius:4px"></span>
              </span>
              <span style="width:120px;text-align:right;font-size:11px;color:${edgePnlColor(dowPnl[d])}">${dowN[d] ? edgePnlStr(dowPnl[d]) + " · " + dowN[d] + " trade(s)" : "–"}</span>
            </div>`).join("") + "</div>";

        // ── One-line factual takeaway ──
        const worstSym = symRows[symRows.length - 1];
        let worstHour = 0;
        for (let h = 1; h < 24; h++) if (hourPnl[h] < hourPnl[worstHour]) worstHour = h;
        const parts = [`${rts.length} round-trips, expectancy ${edgePnlStr(expectancy)}/trade`];
        if (worstSym && worstSym.pnl < 0) parts.push(`worst symbol ${worstSym.sym} (${edgePnlStr(worstSym.pnl)} net)`);
        if (hourPnl[worstHour] < 0) parts.push(`worst hour ${String(worstHour).padStart(2, "0")}:00 GMT+2 (${edgePnlStr(hourPnl[worstHour])})`);
        $("edgeTakeaway").textContent = "Takeaway: " + parts.join("; ") + ".";
      } catch (e) {
        $("edgeTakeaway").textContent = "❌ " + e.message;
        console.error("loadEdge:", e);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  BEHAVIORAL INSIGHTS TAB — plain-language trading-psychology read-outs
    //  from realized FIFO round-trips. On-demand (▶ Analyze); analysis-only,
    //  places no orders. Reuses edgeFetchAllFills() (paginated FILL history)
    //  + a dedicated FIFO matcher that also carries entry cost + pnl% so the
    //  rule-discipline heuristic (−5% stop, per-symbol cap) can be derived.
    // ═══════════════════════════════════════════════════════════════════════
    function insRoundTrips(activities) {
      const sorted = [...activities].reverse();            // chronological
      const queues = {};
      const rts = [];
      for (const act of sorted) {
        const sym = toSlash(act.symbol), side = act.side;
        const qty = Math.abs(Number(act.qty || 0));
        const price = Number(act.price || 0);
        const t = new Date(act.transaction_time || act.date || 0);
        if (!queues[sym]) queues[sym] = [];
        if (side === "buy") {
          queues[sym].push({ qty, price, t });
        } else if (side === "sell") {
          let remaining = qty, pnl = 0, cost = 0, entryT = null;
          while (remaining > 1e-9 && queues[sym].length > 0) {
            const e = queues[sym][0];
            const m = Math.min(remaining, e.qty);
            pnl  += m * (price - e.price);
            cost += m * e.price;
            if (!entryT) entryT = e.t;
            e.qty -= m; remaining -= m;
            if (e.qty < 0.000001) queues[sym].shift();
          }
          if (entryT && cost > 0) {
            rts.push({ sym, pnl, cost, pnlPct: pnl / cost * 100, entryT, exitT: t });
          }
        }
      }
      rts.sort((a, b) => a.exitT - b.exitT);               // chronological by exit
      return rts;
    }

    function insStmt(text, cls) {                          // headline statement line
      const c = cls === "neg" ? "var(--red)" : cls === "pos" ? "var(--green)" : "var(--yellow)";
      return `<div style="font-size:14px;font-weight:700;color:${c};margin-bottom:10px;line-height:1.4">${text}</div>`;
    }
    function insGap(h) {                                    // format an hour gap
      if (h === null || h === undefined) return "–";
      return h < 1 ? Math.round(h * 60) + "m" : h < 48 ? fmt(h, 1) + "h" : fmt(h / 24, 1) + "d";
    }

    async function loadInsights() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("insightsTakeaway").textContent = "Configure API credentials in Settings first.";
        return;
      }
      $("insightsTakeaway").textContent = "⏳ Fetching all FILL activities (paginated)…";
      $("insightsKpis").innerHTML = "";
      $("insightsCards").innerHTML = "";
      try {
        const fills = await edgeFetchAllFills();
        const rts = insRoundTrips(fills);
        if (rts.length < 2) {
          $("insightsTakeaway").textContent = `Only ${rts.length} completed round-trip(s) found in ${fills.length} fill(s) — need a few closed trades before behavioral patterns are meaningful.`;
          return;
        }

        const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const todayG2 = jGmt2Date();

        // ── 1. Day-of-week edge (exit time, GMT+2) ──
        const dN = Array(7).fill(0), dW = Array(7).fill(0), dP = Array(7).fill(0);
        rts.forEach(r => {
          const d = dowNames.indexOf(r.exitT.toLocaleDateString("en-US", { timeZone: "Etc/GMT-2", weekday: "short" }));
          if (d < 0) return;
          dN[d]++; dP[d] += r.pnl; if (r.pnl >= 0) dW[d]++;
        });
        let worstD = -1, bestD = -1;                       // by avg P&L, ≥2 trades
        for (let d = 0; d < 7; d++) {
          if (dN[d] < 2) continue;
          const avg = dP[d] / dN[d];
          if (worstD < 0 || avg < dP[worstD] / dN[worstD]) worstD = d;
          if (bestD  < 0 || avg > dP[bestD]  / dN[bestD])  bestD  = d;
        }

        // ── 2. Win rate after consecutive losses ──
        let streak = 0, baseW = 0, baseN = 0, a1W = 0, a1N = 0, a2W = 0, a2N = 0;
        rts.forEach((r, i) => {
          if (i > 0) {
            baseN++; if (r.pnl >= 0) baseW++;
            if (streak >= 1) { a1N++; if (r.pnl >= 0) a1W++; }
            if (streak >= 2) { a2N++; if (r.pnl >= 0) a2W++; }
          }
          if (r.pnl < 0) streak++; else streak = 0;
        });
        const baseRate = baseN ? baseW / baseN * 100 : null;
        const a1Rate   = a1N ? a1W / a1N * 100 : null;
        const a2Rate   = a2N ? a2W / a2N * 100 : null;

        // ── 3. Trading cadence after wins vs losses (gap to next entry) ──
        const afterWinGap = [], afterLossGap = [];
        for (let i = 0; i < rts.length - 1; i++) {
          const gap = (rts[i + 1].entryT - rts[i].exitT) / 3600000; // hours
          if (gap < 0) continue;
          (rts[i].pnl >= 0 ? afterWinGap : afterLossGap).push(gap);
        }
        const med = arr => arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null;
        const medWin = med(afterWinGap), medLoss = med(afterLossGap);

        // ── 4. Rule-discipline breaches (best-effort from trade history) ──
        let acctEquity = 0;
        try { acctEquity = Number((await apiFetch("/v2/account")).equity || 0); } catch (e) {}
        const stopBreaches = rts.filter(r => r.pnlPct < -5);                 // −5% hard stop not honored
        const stopToday = stopBreaches.filter(r => r.exitT.toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" }) === todayG2);
        const capBreaches = acctEquity > 0 ? rts.filter(r => r.cost > portCapFor(r.sym) / 100 * acctEquity) : [];
        const totalBreaches = stopBreaches.length + capBreaches.length;

        // ── KPI tiles ──
        $("insightsKpis").innerHTML = [
          kpi("Rule Breaches", String(totalBreaches), `${stopBreaches.length} stop-loss · ${capBreaches.length} cap (best-effort)`, totalBreaches ? "neg" : "pos"),
          kpi("After-2-Loss Win Rate", a2Rate !== null ? fmt(a2Rate, 0) + "%" : "n/a", baseRate !== null ? `baseline ${fmt(baseRate, 0)}%` : "need a streak", a2Rate !== null && baseRate !== null && a2Rate < baseRate ? "neg" : "pos"),
          kpi("Worst Weekday", worstD >= 0 ? `${dowNames[worstD]} ${edgePnlStr(dP[worstD])}` : "n/a", worstD >= 0 ? `${dN[worstD]} trades · ${fmt(dW[worstD] / dN[worstD] * 100, 0)}% win` : "need ≥2/day", worstD >= 0 && dP[worstD] < 0 ? "neg" : "")
        ].join("");

        const cards = [];

        // Card 1 — weekday
        {
          const maxAbs = Math.max(...dP.map(Math.abs), 1e-9);
          const stmt = worstD >= 0 && dP[worstD] < 0
            ? insStmt(`📉 You trade worse on ${dowNames[worstD]}s — ${edgePnlStr(dP[worstD])} net across ${dN[worstD]} trades (${fmt(dW[worstD] / dN[worstD] * 100, 0)}% win rate).`, "neg")
            : insStmt(`No consistently losing weekday yet${bestD >= 0 ? ` — your strongest day is ${dowNames[bestD]}` : ""}.`, "pos");
          const rows = [1, 2, 3, 4, 5, 6, 0].map(d => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="width:34px;font-size:11px;color:var(--muted)">${dowNames[d]}</span>
              <span style="flex:1;height:8px;background:rgba(255,255,255,.08);border-radius:4px">
                <span style="display:block;height:100%;width:${Math.abs(dP[d]) / maxAbs * 100}%;background:${dP[d] >= 0 ? "var(--green)" : "var(--red)"};border-radius:4px"></span>
              </span>
              <span style="width:140px;text-align:right;font-size:11px;color:${edgePnlColor(dP[d])}">${dN[d] ? edgePnlStr(dP[d]) + " · " + fmt(dW[d] / dN[d] * 100, 0) + "%" : "–"}</span>
            </div>`).join("");
          cards.push(`<div class="panel"><div class="panel-title">🗓 Day-of-Week Edge</div>${stmt}${rows}</div>`);
        }

        // Card 2 — losing streaks
        {
          const drop = a2Rate !== null && baseRate !== null && a2Rate < baseRate - 5;
          const stmt = a2N < 1
            ? insStmt("Not enough back-to-back losses yet to judge streak behavior.", "")
            : drop
              ? insStmt(`📉 Your win rate drops after losing streaks — ${fmt(a2Rate, 0)}% after 2+ losses vs ${fmt(baseRate, 0)}% baseline. Consider pausing after consecutive losses.`, "neg")
              : insStmt(`✅ You hold up after losses — ${fmt(a2Rate, 0)}% win rate after 2+ losses vs ${fmt(baseRate, 0)}% baseline.`, "pos");
          const row = (lbl, w, n) => `
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span style="color:var(--muted)">${lbl}</span>
              <span>${n ? fmt(w / n * 100, 0) + "% <span style='color:var(--muted)'>(" + w + "/" + n + ")</span>" : "–"}</span>
            </div>`;
          cards.push(`<div class="panel"><div class="panel-title">📉 After Losing Streaks</div>${stmt}
            ${row("Baseline (all trades)", baseW, baseN)}
            ${row("After 1 loss", a1W, a1N)}
            ${row("After 2+ losses", a2W, a2N)}</div>`);
        }

        // Card 3 — cadence after outcome
        {
          const over = medWin !== null && medLoss !== null && medWin < medLoss;
          const stmt = (medWin === null || medLoss === null)
            ? insStmt("Need more sequential trades to compare post-win vs post-loss cadence.", "")
            : over
              ? insStmt(`🔁 You may overtrade after wins — median ${insGap(medWin)} to the next trade after a win vs ${insGap(medLoss)} after a loss.`, "neg")
              : insStmt(`✅ Balanced cadence — ${insGap(medWin)} to next trade after a win vs ${insGap(medLoss)} after a loss.`, "pos");
          const row = (lbl, v, n) => `
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span style="color:var(--muted)">${lbl}</span><span>${insGap(v)} <span style="color:var(--muted)">(${n} gaps)</span></span>
            </div>`;
          cards.push(`<div class="panel"><div class="panel-title">🔁 Cadence After Outcome</div>${stmt}
            ${row("Median gap after a WIN", medWin, afterWinGap.length)}
            ${row("Median gap after a LOSS", medLoss, afterLossGap.length)}</div>`);
        }

        // Card 4 — rule discipline
        {
          const stmt = totalBreaches === 0
            ? insStmt("✅ No rule breaches detected in your closed trades.", "pos")
            : insStmt(`⚠ ${totalBreaches} rule breach(es) detected${stopToday.length ? ` — ${stopToday.length} stop-loss breach(es) today` : ""}.`, "neg");
          const items = [
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--muted)">−5% stop-loss breaches</span><span class="${stopBreaches.length ? "neg" : ""}">${stopBreaches.length}</span></div>`,
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--muted)">Per-symbol cap breaches <span style="color:var(--muted)">(best-effort)</span></span><span class="${capBreaches.length ? "neg" : ""}">${acctEquity > 0 ? capBreaches.length : "n/a"}</span></div>`
          ];
          if (stopBreaches.length) {
            const worst = stopBreaches.reduce((a, b) => b.pnlPct < a.pnlPct ? b : a);
            items.push(`<div style="font-size:11px;color:var(--muted);margin-top:8px">Worst: ${worst.sym} closed at ${fmt(worst.pnlPct, 1)}% (${edgePnlStr(worst.pnl)}) on ${worst.exitT.toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" })}.</div>`);
          }
          cards.push(`<div class="panel"><div class="panel-title">⚠ Rule Discipline</div>${stmt}${items.join("")}
            <div style="font-size:11px;color:var(--muted);margin-top:8px">Best-effort from FILL history: stop-loss breaches use realized loss % vs the −5% hard rule; cap breaches compare entry cost to the symbol cap × <em>current</em> equity (historical equity unknown).</div></div>`);
        }

        $("insightsCards").innerHTML = cards.join("");

        // ── One-line takeaway ──
        const tk = [];
        if (worstD >= 0 && dP[worstD] < 0) tk.push(`worst weekday ${dowNames[worstD]} (${edgePnlStr(dP[worstD])})`);
        if (a2Rate !== null && baseRate !== null) tk.push(`${fmt(a2Rate, 0)}% win after 2+ losses vs ${fmt(baseRate, 0)}% baseline`);
        if (totalBreaches) tk.push(`${totalBreaches} rule breach(es)`);
        $("insightsTakeaway").textContent = "Takeaway: " + (tk.length ? tk.join("; ") + "." : `${rts.length} round-trips analysed; no notable behavioral flags.`);
      } catch (e) {
        $("insightsTakeaway").textContent = "❌ " + e.message;
        console.error("loadInsights:", e);
      }
    }
