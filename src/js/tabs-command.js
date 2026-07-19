
    async function loadContext() {
      const [acct, positions, openOrders, closedOrders, hist, activities] = await Promise.all([
        apiFetch("/v2/account"),
        apiFetch("/v2/positions"),
        apiFetch("/v2/orders?status=open&limit=100&direction=desc"),
        apiFetch("/v2/orders?status=closed&limit=100&direction=desc"),
        apiFetch("/v2/account/portfolio/history?period=3M&timeframe=1D&intraday_reporting=continuous&extended_hours=true"),
        edgeFetchAllFills()   // full paginated FILL history — computeFifoStats must see every fill; a single 100-fill page truncates realized P&L and mis-matches SELLs whose BUY predates the window (booked as $0 "wins")
      ]);

      const fifoStats = computeFifoStats(activities);

      const s = getSettings();
      const L = s.limits;

      const equity = Number(acct.equity || 0);
      const lastEquity = Number(acct.last_equity || equity);
      const cash = Number(acct.cash || 0);
      const buyingPower = Number(acct.buying_power || 0);

      const dayPL = equity - lastEquity;
      const dayPct = lastEquity ? dayPL / lastEquity * 100 : 0;

      const equitySeries = (hist.equity || [])
        .filter(v => v != null && !isNaN(v))
        .map(Number);

      const timestamps = (hist.timestamp || []).slice(0, equitySeries.length);
      const returns = returnsFromEquity(equitySeries);
      const dd = drawdown(equitySeries);

      const invested = positions.reduce((sum, p) => sum + Math.abs(Number(p.market_value || 0)), 0);
      const cashPct = equity ? cash / equity * 100 : 0;
      const investedPct = equity ? invested / equity * 100 : 0;

      const largestPositionPct = positions.length && equity
        ? Math.max(...positions.map(p => Math.abs(Number(p.market_value || 0)) / equity * 100))
        : 0;

      const assumedOpenRisk = positions.reduce((sum, p) => {
        return sum + Math.abs(Number(p.market_value || 0)) * L.assumedStopLossPct / 100;
      }, 0);

      const assumedOpenRiskPct = equity ? assumedOpenRisk / equity * 100 : 0;

      const allOrders = [...openOrders, ...closedOrders]
        .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0,100);

      const filledOrders = allOrders.filter(o => o.status === "filled");

      const slippageRows = filledOrders.map(o => {
        const limit = Number(o.limit_price || 0);
        const fill = Number(o.filled_avg_price || 0);
        let slipPct = null;

        if (limit && fill) {
          if (o.side === "buy") slipPct = (fill - limit) / limit * 100;
          else slipPct = (limit - fill) / limit * 100;
        }

        return Object.assign({}, o, { slipPct });
      });

      const validSlips = slippageRows
        .map(o => o.slipPct)
        .filter(v => v != null && !isNaN(v));

      const avgSlip = validSlips.length ? mean(validSlips) : null;

      return {
        acct,
        positions,
        openOrders,
        closedOrders,
        allOrders,
        filledOrders,
        slippageRows,
        avgSlip,
        activities,
        equity,
        lastEquity,
        cash,
        buyingPower,
        dayPL,
        dayPct,
        equitySeries,
        timestamps,
        returns,
        dd,
        fifoStats,
        invested,
        investedPct,
        cashPct,
        largestPositionPct,
        assumedOpenRisk,
        assumedOpenRiskPct
      };
    }

    async function loadDashboard() {
      clearError();
      renderMode();
      $("lastUpdated").textContent = "Refreshing…";

      try {
        const c = await loadContext();
        lastContext = c;

        renderCommand(c);
        renderPerformance(c);
        renderRisk(c);
        renderPositions(c);
        renderExecution(c);
        renderBacktest(c);

        enhanceTables();
        $("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (e) {
        showError(e.message);
        $("lastUpdated").textContent = "Error";
        console.error(e);
      }
    }

    

    

    // 🔭 Scout-promotions chip (Command tab, roadmap item 6) — shows the pairs
    // scripts/scout.py promoted into the Python bot's universe. Best-effort async.
    async function renderScoutChip() {
      const el = $("scoutChip");
      if (!el) return;
      try {
        const p = await loadScoutPromotions();
        if (!p || !p.symbols.length) { el.style.display = "none"; el.innerHTML = ""; return; }
        const age = p.ageHours !== null ? `${fmt(p.ageHours, 1)}h old` : "age unknown";
        const state = p.fresh ? `fresh · ${age}` : `STALE · ${age} > ${_scoutTtlHours}h TTL — excluded from scans`;
        const col = p.fresh ? "var(--blue)" : "var(--muted)";
        el.style.display = "block";
        el.innerHTML = `<span style="border:1px solid var(--border);border-radius:12px;padding:3px 10px;color:${col}" data-tip="Universe-scout promotions from data/watchlist_dynamic.json — the Python bot merges these into every evaluation; fresh promotions are also merged into the dashboard Signals scan and Autopilot.">🔭 Scout: ${p.symbols.map(s => tvLink(s)).join(", ")} <span style="color:var(--muted)">(${state})</span></span>`;
      } catch (e) { el.style.display = "none"; }
    }

    // ⚠ Split trailing-stop HWM warning (Command tab, roadmap item 10): fires
    // when data/positions_state.json carries an active Python HWM for a symbol
    // the dashboard Autopilot is also trailing in localStorage.
    async function renderHwmSplitWarning() {
      const el = $("hwmSplitWarning");
      if (!el) return;
      try {
        let local = {};
        try { local = JSON.parse(localStorage.getItem("autopilotHwm") || "{}"); } catch (e) {}
        const st = await fetchLocalJson(["./data/positions_state.json", "../data/positions_state.json"]);
        const both = [];
        if (st && st.positions) {
          for (const [sym, ps] of Object.entries(st.positions)) {
            const fileHwm = Number((ps && ps.high_water_mark) || 0);
            if (fileHwm > 0 && local[sym]) both.push(`${sym} (python $${fmt(fileHwm)} · dashboard $${fmt(local[sym])})`);
          }
        }
        if (!both.length) { el.style.display = "none"; el.innerHTML = ""; return; }
        el.style.display = "block";
        el.innerHTML = `⚠ Trailing-stop HWM is tracked by BOTH engines for ${both.join(", ")} — the Autopilot seeds max(local, file) each cycle, but avoid managing the same position from two loops.`;
      } catch (e) { el.style.display = "none"; }
    }

    // 🔗 Over-budget chip (Command tab, roadmap 2026-07-09 item 3): the
    // correlation budget only gates NEW entries, so scout promotions / older
    // entries can leave the book permanently over budget with no visibility
    // (5/4 observed live 2026-07-08). Red chip whenever open positions exceed
    // Settings › Correlation Budget › Max Open Positions.
    function renderBudgetChip(c) {
      const el = $("budgetChip");
      if (!el) return;
      const maxPos = apMaxPositions();
      const openN = (c.positions || []).length;
      if (openN <= maxPos) { el.style.display = "none"; el.innerHTML = ""; return; }
      el.style.display = "block";
      el.innerHTML = `<span style="border:1px solid var(--red);border-radius:12px;padding:3px 10px;color:var(--red);font-weight:700" data-tip="The correlation budget (max ${maxPos} open positions) only gates new entries — the book is over budget. Enable risk.enforce_budget_on_open_positions in config.json to auto-trim the weakest overflow position, or close one manually.">⚠ BUDGET EXCEEDED ${openN}/${maxPos} positions</span>`;
    }

    function renderCommand(c) {
      const L = getSettings().limits;
      renderScoutChip();          // best-effort async — fills #scoutChip
      renderHwmSplitWarning();    // best-effort async — fills #hwmSplitWarning
      renderBudgetChip(c);        // over-budget warning — fills #budgetChip (item 3)
      const rules = [];

      function add(level, title, detail) {
        rules.push({ level, title, detail });
      }

      if (c.dayPct <= -L.maxDailyLossPct) add("red", "Daily loss limit hit", "Today P&L is " + pct(c.dayPct) + ". Stop trading.");
      else if (c.dayPct <= -L.warningDailyLossPct) add("yellow", "Daily loss warning", "Today P&L is " + pct(c.dayPct) + ". Reduce size.");
      else add("green", "Daily loss OK", "Today P&L is " + pct(c.dayPct) + ".");

      if (c.assumedOpenRiskPct >= L.maxOpenRiskPct) add("red", "Open risk too high", "Open risk is " + fmt(c.assumedOpenRiskPct,2) + "% of equity.");
      else if (c.assumedOpenRiskPct >= L.warningOpenRiskPct) add("yellow", "Open risk elevated", "Open risk is " + fmt(c.assumedOpenRiskPct,2) + "% of equity.");
      else add("green", "Open risk OK", "Open risk is " + fmt(c.assumedOpenRiskPct,2) + "% of equity.");

      if (c.largestPositionPct >= L.maxSinglePositionPct) add("red", "Position concentration too high", "Largest position is " + fmt(c.largestPositionPct,1) + "% of equity.");
      else if (c.largestPositionPct >= L.warningSinglePositionPct) add("yellow", "Position concentration elevated", "Largest position is " + fmt(c.largestPositionPct,1) + "% of equity.");
      else add("green", "Concentration OK", "Largest position is " + fmt(c.largestPositionPct,1) + "% of equity.");

      if (c.cashPct < 20) add("red", "Cash reserve below minimum", "Cash is " + fmt(c.cashPct,1) + "% of equity. Hard rule requires ≥ 20%. No new entries.");
      else if (c.cashPct < 25) add("yellow", "Cash reserve low", "Cash is " + fmt(c.cashPct,1) + "% of equity. Keep buffer above 20%.");
      else add("green", "Cash reserve OK", "Cash is " + fmt(c.cashPct,1) + "% of equity — above the 20% hard minimum.");

      const redCount = rules.filter(r => r.level === "red").length;
      const yellowCount = rules.filter(r => r.level === "yellow").length;

      const status = redCount ? "STOP" : yellowCount ? "REDUCE SIZE" : "TRADE";
      const cls = redCount ? "stop" : yellowCount ? "reduce" : "trade";

      $("tradingStatus").className = "status-main " + cls;
      $("tradingStatus").textContent = status;

      $("commandKpis").innerHTML = [
        kpi("Equity / NAV", "$" + fmt(c.equity), "Current account equity"),
        kpi("Today P&L", plSign(c.dayPL), pct(c.dayPct), plClass(c.dayPL)),
        kpi("Open Risk", "$" + fmt(c.assumedOpenRisk), fmt(c.assumedOpenRiskPct,2) + "% of equity"),
        kpi("Current Drawdown", pct(c.dd.currentDDPct), "From recent equity peak", c.dd.currentDDPct < 0 ? "neg" : ""),
        kpi("Open Positions", String(c.positions.length), "Current active exposure"),
        kpi("Cash Reserve", fmt(c.cashPct,1) + "%", "$" + fmt(c.cash) + " available", c.cashPct < 20 ? "neg" : "pos")
      ].join("");

      $("permissionRules").innerHTML = rules.map(r => `
        <div class="rule-row">
          <div class="rule-dot ${r.level}"></div>
          <div>
            <b>${r.title}</b><br>
            <span class="small">${r.detail}</span>
          </div>
        </div>
      `).join("");

      // Latest 2 activities — top-left of the trading-permission panel.
      const actEl = $("recentActivities");
      if (actEl) {
        const recent = (c.activities || []).slice(0, 2);
        if (!recent.length) {
          actEl.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Latest Activity</div>
            <div style="color:var(--muted)">No recent activity.</div>`;
        } else {
          actEl.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">Latest Activity</div>` +
            recent.map(a => {
              const t = new Date(a.transaction_time || a.date || 0)
                .toLocaleString("en-GB", { timeZone: "Etc/GMT-2", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
              const side = String(a.side || "").toUpperCase();
              const sideColor = side === "BUY" ? "var(--green)" : side === "SELL" ? "var(--red)" : "var(--muted)";
              const qty = fmt(Number(a.qty || 0), 4);
              const price = Number(a.price || 0);
              return `<div style="margin-bottom:2px">
                <span style="color:var(--muted)">${t}</span>
                <b style="color:${sideColor}">${side}</b>
                ${qty} ${tvLink(toSlash(a.symbol))} @ $${fmt(price)}
              </div>`;
            }).join("");
        }
      }

      // Live Hard Rules panel
      const hardEl = $("hardRulesLive");
      if (hardEl) {
        const nearStop = c.positions.filter(p => {
          const entry = Number(p.avg_entry_price || 0);
          const cur   = Number(p.current_price   || 0);
          const qty   = Number(p.qty || 0);
          if (!entry) return false;
          if (qty < 0) {
            // Short: stop triggers when price RISES above entry
            return (cur - entry) / entry * 100 >= 3;
          }
          return (cur - entry) / entry * 100 <= -3;
        });
        const atStop = nearStop.filter(p => {
          const entry = Number(p.avg_entry_price || 0);
          const cur   = Number(p.current_price   || 0);
          const qty   = Number(p.qty || 0);
          if (!entry) return false;
          if (qty < 0) return (cur - entry) / entry * 100 >= 5;
          return (cur - entry) / entry * 100 <= -5;
        });

        const hRules = [
          {
            label: "Cash reserve ≥ 20%",
            value: fmt(c.cashPct,1) + "% cash ($" + fmt(c.cash) + ")",
            level: c.cashPct < 20 ? "red" : c.cashPct < 25 ? "yellow" : "green",
            note:  c.cashPct < 20 ? "⚠ BREACH — no new entries allowed" : "OK"
          },
          {
            label: "Daily loss ≤ " + L.maxDailyLossPct + "%",
            value: pct(c.dayPct) + " today (" + plSign(c.dayPL) + ")",
            level: c.dayPct <= -L.maxDailyLossPct ? "red" : c.dayPct <= -L.warningDailyLossPct ? "yellow" : "green",
            note:  c.dayPct <= -L.maxDailyLossPct ? "⚠ STOP TRADING — daily limit hit" : "OK"
          },
          {
            label: "Open risk ≤ " + L.maxOpenRiskPct + "% equity",
            value: fmt(c.assumedOpenRiskPct,2) + "% ($" + fmt(c.assumedOpenRisk) + ")",
            level: c.assumedOpenRiskPct >= L.maxOpenRiskPct ? "red" : c.assumedOpenRiskPct >= L.warningOpenRiskPct ? "yellow" : "green",
            note:  c.assumedOpenRiskPct >= L.maxOpenRiskPct ? "⚠ BREACH — reduce exposure" : "OK"
          },
          {
            label: "Stop-loss (4H swing low)",
            value: atStop.length ? atStop.length + " position(s) ≥ 5% underwater" : nearStop.length ? nearStop.length + " position(s) ≥ 3% underwater" : "All positions clear",
            level: atStop.length ? "red" : nearStop.length ? "yellow" : "green",
            note:  atStop.length ? "⚠ Deep loss — verify 4H swing-low stop" : nearStop.length ? "⚠ Monitor — approaching likely 4H range low" : "OK — stop is the previous 4H range low (≤8% cap)"
          },
          {
            label: "Limit orders only",
            value: c.openOrders.length + " open order(s)",
            level: "green",
            note:  "Policy enforced by scripts/trade.py"
          }
        ];

        hardEl.innerHTML = hRules.map(r => `
          <div class="rule-row">
            <div class="rule-dot ${r.level}"></div>
            <div>
              <b>${r.label}</b> — <span style="color:var(--muted)">${r.value}</span><br>
              <span class="small" style="color:${r.level === "red" ? "var(--red)" : r.level === "yellow" ? "var(--yellow)" : "var(--muted)"}">${r.note}</span>
            </div>
          </div>
        `).join("");
      }
    }
