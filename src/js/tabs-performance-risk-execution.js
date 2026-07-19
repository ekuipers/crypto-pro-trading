
    function renderPerformance(c) {
      const L = getSettings().limits;

      const totalReturnPct = c.equitySeries.length > 1
        ? (c.equitySeries[c.equitySeries.length - 1] - c.equitySeries[0]) / c.equitySeries[0] * 100
        : 0;
      const totalPL = c.fifoStats ? (c.fifoStats.totalPnl || 0) : 0;

      const avgRet = mean(c.returns) * 100;
      const bestRet = c.returns.length ? Math.max(...c.returns) * 100 : 0;
      const worstRet = c.returns.length ? Math.min(...c.returns) * 100 : 0;
      const vol = std(c.returns) * Math.sqrt(L.tradingDaysPerYear) * 100;

      $("performanceKpis").innerHTML = [
        kpi("Total P&L", (totalPL >= 0 ? "+$" : "-$") + fmt(Math.abs(totalPL)), "Realized P&L (FIFO) — matches P&L tab", totalPL >= 0 ? "pos" : "neg"),
        kpi("Total Return", pct(totalReturnPct), "Loaded 3M account history", totalReturnPct >= 0 ? "pos" : "neg"),
        kpi("Average Return", pct(avgRet,3), "Average period return", avgRet >= 0 ? "pos" : "neg"),
        kpi("Annualized Volatility", fmt(vol,2) + "%", "Return dispersion"),
        kpi("Best Period", pct(bestRet), "Largest positive period", "pos"),
        kpi("Worst Period", pct(worstRet), "Largest negative period", "neg")
      ].join("");

      $("performanceSummaryBody").innerHTML = [
        ["Total P&L ($)", (totalPL >= 0 ? "+$" : "-$") + fmt(Math.abs(totalPL)), "Realized P&L (FIFO matched fills) — same value as P&L tab."],
        ["Total return (%)", pct(totalReturnPct), "Percentage account growth over loaded history."],
        ["Average period return", pct(avgRet,3), "Useful for consistency analysis."],
        ["Annualized volatility", fmt(vol,2) + "%", "Measures return dispersion."],
        ["Best period", pct(bestRet), "Largest positive move in loaded history."],
        ["Worst period", pct(worstRet), "Largest negative move in loaded history."],
        ["Filled orders", String(c.filledOrders.length), "Recent execution activity sample."]
      ].map(r => `
        <tr>
          <td>${r[0]}</td>
          <td class="right">${r[1]}</td>
          <td>${r[2]}</td>
        </tr>
      `).join("");

      renderEquityChart(c);
      renderReturnsChart(c);
    }

    function renderRisk(c) {
      const L = getSettings().limits;
      const sh = sharpe(c.returns, L.tradingDaysPerYear);
      const so = sortino(c.returns, L.tradingDaysPerYear);
      const ca = calmar(c.returns, c.dd.maxDDPct, L.tradingDaysPerYear);
      const var95 = percentile(c.returns, 0.05) * 100;
      const cvar95 = cvar(c.returns, 0.05) * 100;

      $("riskKpis").innerHTML = [
        kpi("Current Drawdown", pct(c.dd.currentDDPct), "Current decline from peak", c.dd.currentDDPct < 0 ? "neg" : ""),
        kpi("Max Drawdown", pct(c.dd.maxDDPct), "Worst loaded drawdown", "neg"),
        kpi("Sharpe Ratio", fmt(sh,2), "Risk-adjusted return"),
        kpi("Sortino Ratio", fmt(so,2), "Downside-risk adjusted return"),
        kpi("Calmar Ratio", fmt(ca,2), "Annual return / max drawdown"),
        kpi("VaR 95%", pct(var95), "Historical 5th percentile", "neg"),
        kpi("CVaR 95%", pct(cvar95), "Average tail loss beyond VaR", "neg"),
        kpi("Open Risk", "$" + fmt(c.assumedOpenRisk), fmt(c.assumedOpenRiskPct,2) + "% of equity")
      ].join("");

      const alerts = [];


      if (c.assumedOpenRiskPct >= L.maxOpenRiskPct) alerts.push(["red", "Open risk breaches hard limit based on assumed stop model."]);
      else if (c.assumedOpenRiskPct >= L.warningOpenRiskPct) alerts.push(["yellow", "Open risk is elevated. Avoid adding correlated exposure."]);

      if (c.largestPositionPct >= L.maxSinglePositionPct) alerts.push(["red", "Largest position exceeds concentration limit."]);
      else if (c.largestPositionPct >= L.warningSinglePositionPct) alerts.push(["yellow", "Largest position is approaching concentration limit."]);

      if (!alerts.length) alerts.push(["green", "No major risk alerts. Portfolio is within configured limits."]);

      $("riskAlerts").innerHTML = alerts.map(a => `
        <div class="rule-row">
          <div class="rule-dot ${a[0]}"></div>
          <div>${a[1]}</div>
        </div>
      `).join("");

      $("riskExposureBody").innerHTML = c.positions.length
        ? c.positions.map(p => {
            const mv = Math.abs(Number(p.market_value || 0));
            const pctEq = c.equity ? mv / c.equity * 100 : 0;
            const openRisk = mv * L.assumedStopLossPct / 100;
            const unreal = Number(p.unrealized_pl || 0);

            const level = pctEq >= L.maxSinglePositionPct ? "red" : pctEq >= L.warningSinglePositionPct ? "yellow" : "green";
            const text = level === "red" ? "Too concentrated" : level === "yellow" ? "Elevated" : "OK";

            const sym = toSlash(p.symbol);
            const capPct = PORTFOLIO_CAPS[sym] || PORTFOLIO_CAPS[p.symbol] || 5;
            const capUsed = capPct ? fmt(pctEq / capPct * 100, 0) + "%" : "–";
            const capText = fmt(pctEq,1) + "% / " + capPct + "% cap";
            const capCls = pctEq >= capPct * 0.9 ? "neg" : pctEq >= capPct * 0.7 ? "" : "pos";

            return `
              <tr>
                <td><span class="symbol">${tvLink(sym)}</span></td>
                <td class="right mono">$${fmt(mv)}</td>
                <td class="right">${fmt(pctEq,1)}%</td>
                <td class="right ${capCls}" data-tip="Current allocation vs portfolio cap. Red = within 10% of cap limit.">${capText}</td>
                <td class="right ${plClass(unreal)}">${plSign(unreal)}</td>
                <td class="right mono">$${fmt(openRisk)}</td>
                <td>${pill(level,text)}</td>
              </tr>
            `;
          }).join("")
        : '<tr><td colspan="7" class="placeholder">No open positions</td></tr>';

      renderDrawdownChart(c);
    }

    function renderPositions(c) {
      // The standalone Positions page was dropped (its table lives in Portfolio
      // Overview). This renderer still runs via loadDashboard so the wrapper can
      // cache _lastPositions for the Risk concentration panel + CSV export, but
      // its DOM writes are guarded so they no-op when the elements are absent.
      const _pk = $("positionKpis");
      if (_pk) _pk.innerHTML = [
        kpi("Open Positions", String(c.positions.length), "Current active positions"),
        kpi("Invested", "$" + fmt(c.invested), fmt(c.investedPct,1) + "% of equity"),
        kpi("Cash", "$" + fmt(c.cash), fmt(c.cashPct,1) + "% of equity"),
        kpi("Largest Position", fmt(c.largestPositionPct,1) + "%", "Position concentration"),
        kpi("Open Risk", "$" + fmt(c.assumedOpenRisk), fmt(c.assumedOpenRiskPct,2) + "% of equity"),
        kpi("Buying Power", "$" + fmt(c.buyingPower), "Available buying power")
      ].join("");

      const _pb = $("positionsBody");
      if (_pb) _pb.innerHTML = c.positions.length
        ? c.positions.map(p => {
            const qty = Number(p.qty || 0);
            const mv = Math.abs(Number(p.market_value || 0));
            const pctEq = c.equity ? mv / c.equity * 100 : 0;
            const unreal = Number(p.unrealized_pl || 0);
            const unrealPct = Number(p.unrealized_plpc || 0) * 100;
            const current = Number(p.current_price || 0);
            const displaySymbol = toSlash(p.symbol);
            const orderSymbol = p.symbol;

            const entry   = Number(p.avg_entry_price || 0);
            const isShort = qty < 0;

            // Stop distance: longs stop at −5%, shorts stop at +5% (price rose)
            const stopPct = entry
              ? isShort
                ? (current - entry) / entry * 100   // positive = adverse for shorts
                : (current - entry) / entry * 100   // negative = adverse for longs
              : null;
            const stopDistLabel = stopPct == null ? "–"
              : isShort
                ? fmt(stopPct, 1) + "%"             // show how far price has moved up
                : fmt(stopPct, 1) + "%";
            const stopRemLabel = stopPct == null ? ""
              : isShort
                ? fmt(5 - stopPct, 1) + "% to cover stop"
                : fmt(-5 - stopPct, 1) + "% to stop";
            const stopCls = stopPct != null && (isShort ? stopPct >= 3 : stopPct <= -3) ? "neg" : "";

            // Stop $ and Target $
            const stopPrice   = entry ? (isShort ? entry * 1.05 : entry * 0.95) : null;
            const targetPrice = entry ? (isShort ? entry * 0.90 : entry * 1.10) : null;

            // R:R
            let rrRaw = null;
            if (stopPrice && targetPrice) {
              if (isShort && current < stopPrice) {
                // Short: profit = entry − current, risk = stop − entry
                rrRaw = (current - targetPrice) / (stopPrice - current);
              } else if (!isShort && current > stopPrice) {
                rrRaw = (targetPrice - current) / (current - stopPrice);
              }
            }
            const atStopStr = isShort ? "AT COVER STOP" : "AT STOP";
            const rrStr = rrRaw !== null ? fmt(rrRaw, 2) + ":1"
              : (current && stopPrice && (isShort ? current >= stopPrice : current <= stopPrice)) ? atStopStr : "–";
            const rrCls = rrRaw === null ? "neg" : rrRaw >= 2 ? "rr-good" : rrRaw >= 1 ? "rr-warn" : "rr-bad";

            const dirBadge = isShort
              ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(248,81,73,.15);color:var(--red);font-weight:700;margin-left:4px">SHORT</span>`
              : "";

            return `
              <tr>
                <td><span class="symbol">${tvLink(displaySymbol)}</span>${dirBadge}</td>
                <td class="right">${fmt(Math.abs(qty), Math.abs(qty) % 1 === 0 ? 0 : 6)}</td>
                <td class="right mono">${fmtPrice(p.avg_entry_price)}</td>
                <td class="right mono">${fmtPrice(p.current_price)}</td>
                <td class="right mono">$${fmt(mv)}</td>
                <td class="right">${fmt(pctEq,1)}%</td>
                <td class="right ${plClass(unreal)}">${plSign(unreal)}</td>
                <td class="right ${plClass(unrealPct)}">${pct(unrealPct)}</td>
                <td class="right ${stopCls}" data-tip="${isShort ? "Adverse move % for short. Red = price risen ≥3% above entry." : "Current P&L %. Live stop is the previous 4H range low (≤8% cap); −5% reference shown."}">${stopDistLabel}<br><span class="small">${stopRemLabel}</span></td>
                <td class="right mono" data-tip="${isShort ? "Cover stop = entry × 1.05 (+5% rule)" : "Reference stop (entry × 0.95). Live stop = previous 4H range low, clamped ≤8% below entry."}">${stopPrice ? fmtPrice(stopPrice) : "–"}</td>
                <td class="right mono" data-tip="${isShort ? "Short target = entry × 0.90 (−10%)" : "Take-profit = entry × 1.10 (+10% rule)"}">${targetPrice ? fmtPrice(targetPrice) : "–"}</td>
                <td class="right ${rrCls}" data-tip="Live R:R = (target − current) ÷ (current − stop)">${rrStr}</td>
                <td>
                  <div class="trade-actions">
                    ${isShort
                      ? `<button class="trade-close-btn" data-tip="Open a paper buy ticket to cover this short position." onclick="openTradeModal('${orderSymbol}','${displaySymbol}','buy','${Math.abs(qty)}',${current || 0})">Buy / Cover</button>`
                      : `<button class="trade-action-btn" data-tip="Open a paper limit-order ticket to buy this symbol." onclick="openTradeModal('${orderSymbol}','${displaySymbol}','buy','',${current || 0})">Buy</button>
                         <button class="trade-close-btn" data-tip="Open a paper sell ticket prefilled with current quantity." onclick="openTradeModal('${orderSymbol}','${displaySymbol}','sell','${qty}',${current || 0})">Sell / Close</button>`
                    }
                  </div>
                </td>
              </tr>
            `;
          }).join("")
        : '<tr><td colspan="13" class="placeholder">No open positions</td></tr>';
    }

    let _lastExecutionCtx = null;

    function renderExecution(c) {
      _lastExecutionCtx = c;
      const rejected = c.allOrders.filter(o => o.status === "rejected").length;
      const canceled = c.allOrders.filter(o => ["canceled","expired"].includes(o.status)).length;

      const sample = c.slippageRows.filter(o => o.slipPct != null).length;
      const favorable = c.slippageRows.filter(o => o.slipPct != null && o.slipPct <= 0).length;
      const favorableRate = sample ? favorable / sample * 100 : null;

      $("executionKpis").innerHTML = [
        kpi("Open Orders", String(c.openOrders.length), "Orders not resolved"),
        kpi("Filled Orders", String(c.filledOrders.length), "Recent filled orders"),
        kpi("Canceled / Expired", String(canceled), "Recent non-filled exits"),
        kpi("Rejected Orders", String(rejected), "Broker rejected orders", rejected ? "neg" : ""),
        kpi("Avg Slippage Proxy", c.avgSlip == null ? "n/a" : pct(c.avgSlip), "Limit vs average fill", c.avgSlip > 0 ? "neg" : "pos"),
        kpi("Favorable Fill Rate", favorableRate == null ? "n/a" : fmt(favorableRate,1) + "%", "Slippage proxy ≤ 0")
      ].join("");

      populateExecutionFilters(c.allOrders);
      applyExecutionFilters();
    }

    // Populate the Symbol/Type/Status filter dropdowns from the live order set,
    // preserving whatever the user already had selected across refreshes.
    function populateExecutionFilters(orders) {
      const symSel = $("execFilterSymbol"), typeSel = $("execFilterType"), statusSel = $("execFilterStatus");
      if (!symSel || !typeSel || !statusSel) return;
      const prevSym = symSel.value, prevType = typeSel.value, prevStatus = statusSel.value;

      const symbols = [...new Set(orders.map(o => o.symbol))].sort();
      symSel.innerHTML = '<option value="">All</option>' +
        symbols.map(s => `<option value="${s}">${toSlash(s)}</option>`).join("");
      if (symbols.includes(prevSym)) symSel.value = prevSym;

      const types = [...new Set(orders.map(o => o.type).filter(Boolean))].sort();
      typeSel.innerHTML = '<option value="">All</option>' +
        types.map(t => `<option value="${t}">${t}</option>`).join("");
      if (types.includes(prevType)) typeSel.value = prevType;

      const statuses = [...new Set(orders.map(o => o.status).filter(Boolean))].sort();
      statusSel.innerHTML = '<option value="">All</option>' +
        statuses.map(s => `<option value="${s}">${s}</option>`).join("");
      if (statuses.includes(prevStatus)) statusSel.value = prevStatus;
    }

    function resetExecutionFilters() {
      ["execFilterSymbol", "execFilterType", "execFilterSide", "execFilterStatus"].forEach(id => {
        const el = $(id); if (el) el.value = "";
      });
      applyExecutionFilters();
    }

    // Re-renders the Recent Orders table from the last-loaded order set using the
    // current Symbol/Type/Side/Status filter selections. No refetch — filtering is client-side.
    function applyExecutionFilters() {
      if (!_lastExecutionCtx) return;
      const c = _lastExecutionCtx;
      const sym    = ($("execFilterSymbol") || {}).value || "";
      const type   = ($("execFilterType")   || {}).value || "";
      const side   = ($("execFilterSide")   || {}).value || "";
      const status = ($("execFilterStatus") || {}).value || "";

      const filtered = c.allOrders.filter(o =>
        (!sym    || o.symbol === sym) &&
        (!type   || o.type === type) &&
        (!side   || o.side === side) &&
        (!status || o.status === status)
      );

      const countEl = $("execFilterCount");
      if (countEl) countEl.textContent = `Showing ${filtered.length} of ${c.allOrders.length} orders`;

      $("executionOrdersBody").innerHTML = filtered.length
        ? filtered.map(o => {
            const slipRow = c.slippageRows.find(x => x.id === o.id);
            const slip = slipRow ? slipRow.slipPct : null;

            const level = slip == null ? "muted" : slip <= 0 ? "green" : slip <= 0.10 ? "yellow" : "red";
            const text = slip == null ? o.status : slip <= 0 ? "Favorable" : slip <= 0.10 ? "Slight drag" : "Execution drag";

            const filledQty = Number(o.filled_qty || 0);
            const total = filledQty > 0 && o.filled_avg_price
              ? filledQty * Number(o.filled_avg_price)
              : Number(o.qty || 0) && o.limit_price
                ? Number(o.qty) * Number(o.limit_price)
                : o.notional ? Number(o.notional) : null;

            return `
              <tr>
                <td><span class="symbol">${tvLink(toSlash(o.symbol))}</span></td>
                <td class="${o.side === "buy" ? "pos" : "neg"}">${String(o.side || "").toUpperCase()}</td>
                <td>${o.type || "–"}</td>
                <td class="right">${fmt(Number(o.qty || 0), 6)}</td>
                <td class="right mono">${o.limit_price ? fmtPrice(o.limit_price) : "–"}</td>
                <td class="right mono">${o.filled_avg_price ? fmtPrice(o.filled_avg_price) : "–"}</td>
                <td class="right mono">${total == null ? "–" : "$" + fmt(total, 2)}</td>
                <td class="right ${slip != null ? plClass(-slip) : ""}">${slip == null ? "–" : pct(slip)}</td>
                <td>${pill(level,text)}</td>
                <td style="color:var(--muted);white-space:nowrap">${timeAgo(o.created_at)}</td>
              </tr>
            `;
          }).join("")
        : `<tr><td colspan="10" class="placeholder">${c.allOrders.length ? "No orders match the selected filters" : "No recent orders"}</td></tr>`;
    }
