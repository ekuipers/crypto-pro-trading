
    // ═══════════════════════════════════════════════════════════════════════
    //  P&L TAB
    // ═══════════════════════════════════════════════════════════════════════

    let _pnlActivities = [];
    let _pnlTradeRows  = [];

    async function loadPnl() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("pnlTradeBody").innerHTML = '<tr><td colspan="7" class="placeholder">Configure API credentials in Settings first.</td></tr>';
        return;
      }
      $("pnlKpis").innerHTML = kpi("Status", "Loading…", "Fetching trade activities");
      $("pnlTradeBody").innerHTML = '<tr><td colspan="7" class="placeholder">Fetching activities…</td></tr>';

      try {
        // Full paginated FILL history — was capped at the last 100 fills, which
        // truncated realized P&L and mis-matched SELLs whose BUY predated the
        // window (booked as $0 "wins"). Same engine the Edge/Insights tabs use.
        const activities = await edgeFetchAllFills();
        _pnlActivities = Array.isArray(activities) ? activities : [];

        // FIFO P&L matching (shared engine — see computeFifoStats)
        const stats = computeFifoStats(_pnlActivities);
        const { totalPnl, wins, losses, winRate, profitFactor, avgWin, avgLoss } = stats;
        _pnlTradeRows = stats.tradeRows; // most recent first

        $("pnlKpis").innerHTML = [
          kpi("Total Realized P&L", plSign(totalPnl), "FIFO matched fills", plClass(totalPnl) === "pos" ? "pos" : "neg"),
          kpi("Win Rate", winRate !== null ? fmt(winRate, 1) + "%" : "–", `${wins}W / ${losses}L`, winRate >= 50 ? "pos" : "neg"),
          kpi("Profit Factor", profitFactor !== null ? fmt(profitFactor, 2) : "–", "Gross wins / gross losses", profitFactor >= 1 ? "pos" : "neg"),
          kpi("Avg Win", avgWin !== null ? "$" + fmt(avgWin) : "–", "Average winning trade", "pos"),
          kpi("Avg Loss", avgLoss !== null ? "-$" + fmt(avgLoss) : "–", "Average losing trade", "neg"),
          kpi("Total Fills", String(_pnlActivities.length), "Loaded from Alpaca activities")
        ].join("");

        // Render P&L calendar heatmap
        renderPnlCalendar(_pnlTradeRows);

        // ── P&L attribution by symbol ─────────────────────────────────────
        const bySymbol = {};
        _pnlTradeRows.filter(t => t.pnl !== null).forEach(t => {
          if (!bySymbol[t.sym]) bySymbol[t.sym] = { wins: 0, losses: 0, totalPnl: 0, winPnl: 0, lossPnl: 0 };
          bySymbol[t.sym].totalPnl += t.pnl;
          if (t.pnl >= 0) { bySymbol[t.sym].wins++;   bySymbol[t.sym].winPnl  += t.pnl; }
          else             { bySymbol[t.sym].losses++; bySymbol[t.sym].lossPnl += Math.abs(t.pnl); }
        });
        const symRows = Object.entries(bySymbol)
          .sort((a,b) => b[1].totalPnl - a[1].totalPnl)
          .map(([sym, d]) => {
            const total  = d.wins + d.losses;
            const wr     = total   ? d.wins / total * 100  : 0;
            const pf     = d.lossPnl > 0 ? d.winPnl / d.lossPnl : null;
            const avgW   = d.wins   ? d.winPnl / d.wins   : null;
            const avgL   = d.losses ? d.lossPnl / d.losses : null;
            return `<tr>
              <td><span class="symbol">${tvLink(toSlash(sym))}</span></td>
              <td class="right">${total}</td>
              <td class="right">${d.wins}W / ${d.losses}L</td>
              <td class="right ${wr >= 50 ? "pos" : "neg"}">${fmt(wr,1)}%</td>
              <td class="right ${plClass(d.totalPnl)}">${plSign(d.totalPnl)}</td>
              <td class="right ${pf !== null && pf >= 1 ? "pos" : "neg"}">${pf !== null ? fmt(pf,2) : "–"}</td>
              <td class="right pos">${avgW !== null ? "$" + fmt(avgW) : "–"}</td>
              <td class="right neg">${avgL !== null ? "$" + fmt(avgL) : "–"}</td>
            </tr>`;
          }).join("");
        if ($("pnlBySymbolBody")) {
          $("pnlBySymbolBody").innerHTML = symRows || '<tr><td colspan="8" class="placeholder">No realized P&amp;L data.</td></tr>';
        }

        // ── Day-of-week analysis ──────────────────────────────────────────
        const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const dowData = {};
        _pnlTradeRows.filter(t => t.pnl !== null && t.date).forEach(t => {
          const dow = new Date(t.date + "T12:00:00Z").getDay();
          if (!dowData[dow]) dowData[dow] = { pnl: 0, trades: 0, wins: 0 };
          dowData[dow].pnl += t.pnl; dowData[dow].trades++;
          if (t.pnl >= 0) dowData[dow].wins++;
        });
        const maxDowAbs = Math.max(...Object.values(dowData).map(d => Math.abs(d.pnl)), 1);
        const dowRows = [1,2,3,4,5,6,0].map(d => {
          const row = dowData[d];
          if (!row) return `<tr><td>${DOW_LABELS[d]}</td><td class="right" style="color:var(--muted)">–</td><td class="right" style="color:var(--muted)">–</td><td class="right" style="color:var(--muted)">–</td><td></td></tr>`;
          const wr   = row.trades ? row.wins / row.trades * 100 : 0;
          const barW = Math.round(Math.abs(row.pnl) / maxDowAbs * 100);
          const barC = row.pnl >= 0 ? "#3fb950" : "#f85149";
          return `<tr>
            <td>${DOW_LABELS[d]}</td>
            <td class="right">${row.trades}</td>
            <td class="right ${wr >= 50 ? "pos" : "neg"}">${fmt(wr,1)}%</td>
            <td class="right ${plClass(row.pnl)}">${plSign(row.pnl)}</td>
            <td><span class="dow-bar" style="width:${barW}%;background:${barC}"></span></td>
          </tr>`;
        }).join("");
        if ($("dowBody")) $("dowBody").innerHTML = dowRows;

        // Trade log
        $("pnlTradeBody").innerHTML = _pnlTradeRows.length
          ? _pnlTradeRows.map(t => `
            <tr>
              <td style="color:var(--muted);white-space:nowrap">${t.date}</td>
              <td><span class="symbol">${tvLink(toSlash(t.sym))}</span></td>
              <td class="${t.side === "BUY" ? "pos" : "neg"}">${t.side}</td>
              <td class="right mono">${fmt(t.qty, 6)}</td>
              <td class="right mono">${fmtPrice(t.price)}</td>
              <td class="right ${t.pnl !== null ? plClass(t.pnl) : ""}">${t.pnl !== null ? plSign(t.pnl) : "–"}</td>
              <td><span style="color:var(--muted)">${t.status}</span></td>
            </tr>
          `).join("")
          : '<tr><td colspan="7" class="placeholder">No fill activities found.</td></tr>';

      } catch(e) {
        $("pnlKpis").innerHTML = kpi("Error", e.message, "Failed to load P&L data");
        $("pnlTradeBody").innerHTML = `<tr><td colspan="7" class="placeholder">Error: ${e.message}</td></tr>`;
      }
    }

    function renderPnlCalendar(trades) {
      // Group SELL trades by date
      const byDate = {};
      trades.filter(t => t.side === "SELL" && t.pnl !== null).forEach(t => {
        if (!byDate[t.date]) byDate[t.date] = 0;
        byDate[t.date] += t.pnl;
      });

      if (!Object.keys(byDate).length) {
        $("pnlCalendar").innerHTML = '<div class="small">No realized P&L data to display.</div>';
        return;
      }

      // Build 3-month calendar
      const today = new Date();
      const months = [];
      for (let m = 2; m >= 0; m--) {
        const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
        months.push({ year: d.getFullYear(), month: d.getMonth() });
      }

      const maxAbs = Math.max(...Object.values(byDate).map(Math.abs), 1);

      const html = months.map(({ year, month }) => {
        const monthName = new Date(year, month, 1).toLocaleString("default", { month: "short", year: "numeric" });
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let cells = '<div class="small" style="margin-bottom:4px;color:var(--muted)">' + monthName + '</div>';
        cells += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
        // Day headers
        ["S","M","T","W","T","F","S"].forEach(d => {
          cells += `<div style="text-align:center;font-size:9px;color:var(--muted);padding:1px">${d}</div>`;
        });
        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) cells += '<div></div>';
        // Day cells
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const pnl = byDate[dateStr];
          let bg = "rgba(255,255,255,.05)";
          let title = dateStr;
          if (pnl !== undefined) {
            const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
            const alpha = 0.2 + intensity * 0.7;
            bg = pnl >= 0 ? `rgba(63,185,80,${alpha})` : `rgba(248,81,73,${alpha})`;
            title = `${dateStr}: ${plSign(pnl)}`;
          }
          const isToday = dateStr === today.toISOString().slice(0,10);
          cells += `<div style="aspect-ratio:1;border-radius:2px;background:${bg};font-size:9px;display:flex;align-items:center;justify-content:center;cursor:default;${isToday ? "outline:1px solid var(--blue);" : ""}" title="${title}">${d}</div>`;
        }
        cells += '</div>';
        return `<div style="margin-right:20px">${cells}</div>`;
      }).join("");

      $("pnlCalendar").innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:16px;padding:8px">
          ${html}
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);width:100%">
            <span>P&L:</span>
            <span style="background:rgba(63,185,80,.4);width:12px;height:12px;border-radius:2px;display:inline-block"></span>Gain
            <span style="background:rgba(248,81,73,.4);width:12px;height:12px;border-radius:2px;display:inline-block"></span>Loss
          </div>
        </div>
      `;
    }
