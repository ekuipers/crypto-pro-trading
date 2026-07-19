
    // ═══════════════════════════════════════════════════════════════════════
    //  SCALPING — 6-point confluence (calcSignalScore) on lower timeframes.
    //  Scanner + manual Buy/Sell tickets only (no autonomous loop).
    // ═══════════════════════════════════════════════════════════════════════
    // Each scalp timeframe maps the engine's (execution, trend, regime) stack
    // down a notch. calcSignalScore computes signals 1–5 on the exec bars,
    // signal 6 on the trend bars, and the regime gate on the regime bars.
    const SCALP_TF_MAP = {
      "5Min":  { exec: "5Min",  trend: "1Hour", regime: "4Hour" },
      "15Min": { exec: "15Min", trend: "1Hour", regime: "4Hour" },
      "1Hour": { exec: "1Hour", trend: "4Hour", regime: "1Day"  }
    };

    function scalpActionPill(row) {
      if (row.score === null) return pill("muted", "Error");
      const down = row.dailyRegime === "downtrend";
      if (!down && row.score >= SIGNAL_BUY_SCORE)  return pill("green", "BUY");
      if (!down && row.score >= SIGNAL_HALF_SCORE) return pill("yellow", "HALF");
      if (down && row.score >= SIGNAL_DOWNTREND_LONG_SCORE) return pill("yellow", "½ C-Trend");
      if (down && row.score >= SIGNAL_HALF_SCORE)  return pill("muted", "Blocked");
      if (down && row.score <= -3) return pill("red", "BEAR");
      return pill("muted", "HOLD");
    }

    async function loadScalp() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("scalpBody").innerHTML = '<tr><td colspan="12" class="placeholder">Configure API credentials in Settings first.</td></tr>';
        return;
      }
      const tf  = ($("scalpTf") || {}).value || "15Min";
      const map = SCALP_TF_MAP[tf] || SCALP_TF_MAP["15Min"];
      const SYMBOLS = getWatchlist();
      $("scalpBody").innerHTML = '<tr><td colspan="12" class="placeholder">Scanning ' + SYMBOLS.length + ' symbols on ' + tf + '…</td></tr>';
      $("scalpKpis").innerHTML = kpi("Status", "Scanning…", "Fetching " + map.exec + " / " + map.trend + " / " + map.regime + " bars");

      try {
        const [bExec, bTrend, bReg, snaps] = await Promise.all([
          fetchBars(SYMBOLS, map.exec,  120),
          fetchBars(SYMBOLS, map.trend, 60),
          fetchBars(SYMBOLS, map.regime, 60),
          fetchSnapshotsInBatches(SYMBOLS).catch(() => ({}))   // live bid/ask (item 1)
        ]);
        if (!bExec) {
          $("scalpBody").innerHTML = '<tr><td colspan="12" class="placeholder">Error fetching bars — check API credentials.</td></tr>';
          return;
        }

        const rows = [], scores = [];
        for (const sym of SYMBOLS) {
          const alp = sym.replace("/", "");
          const e = (bExec[sym]  || bExec[alp]  || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const t = (bTrend[sym] || bTrend[alp] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const r = (bReg[sym]   || bReg[alp]   || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          if (e.length < STRAT_CFG.minBarsForSignal) { rows.push({ sym, score: null, error: "Insufficient bars" }); continue; }
          const res = calcSignalScore(e, t, r);
          scores.push(res.score);
          // Informational ADX/OBV on the exec timeframe (display-only — parity exemption)
          const adxVal = calcADX(e.map(b => b.h), e.map(b => b.l), e.map(b => b.c));
          const obvVal = calcObvTrend(e.map(b => b.c), e.map(b => b.v));
          // Spread + scalp-viability gate (roadmap 2026-07-09 item 1c): the
          // distance to the BB-upper target must clear 2× the round-trip cost.
          const snap = snaps[sym] || snaps[alp];
          const q = snap && snap.latestQuote;
          const spreadPct = (q && q.ap > 0 && q.bp > 0 && q.ap >= q.bp)
            ? (q.ap - q.bp) / ((q.ap + q.bp) / 2) * 100 : null;
          const costPct = roundTripCostPct(spreadPct);
          let viable = null, targetDistPct = null;
          if (res.lastClose && res.bb && res.bb.upper > res.lastClose) {
            targetDistPct = (res.bb.upper - res.lastClose) / res.lastClose * 100;
            viable = targetDistPct >= 2 * costPct;
          }
          rows.push({ sym, ...res, adxVal, obvVal, spreadPct, costPct, viable, targetDistPct });
        }

        // KPIs
        const valid = rows.filter(r => r.score !== null);
        const buys  = valid.filter(r => r.score >= SIGNAL_BUY_SCORE).length;
        const halfs = valid.filter(r => r.score >= SIGNAL_HALF_SCORE && r.score < SIGNAL_BUY_SCORE).length;
        const avg   = valid.length ? valid.reduce((a, r) => a + r.score, 0) / valid.length : 0;
        $("scalpKpis").innerHTML =
          kpi("Timeframe", tf, "exec " + map.exec + " · trend " + map.trend + " · regime " + map.regime) +
          kpi("BUY / Half", buys + " / " + halfs, "Score ≥ 3.5 full · ≥ 2.5 half", buys > 0 ? "pos" : "") +
          kpi("Avg Score", (avg >= 0 ? "+" : "") + fmt(avg, 1), "Breadth across watchlist", avg >= 2 ? "pos" : avg <= -1 ? "neg" : "");

        renderScoreDist("scalpScoreDist", scores);

        $("scalpBody").innerHTML = rows.map(row => {
          if (row.score === null) {
            return '<tr><td><span class="symbol">' + tvLink(row.sym) + '</span></td><td colspan="11" class="placeholder">' + (row.error || "n/a") + '</td></tr>';
          }
          const orderSym = row.sym.replace("/", "");
          const price    = row.lastClose;
          const sc       = row.score;
          const scColor  = sc >= SIGNAL_BUY_SCORE ? "var(--green)" : sc >= SIGNAL_HALF_SCORE ? "var(--yellow)" : sc <= 0 ? "var(--red)" : "var(--blue)";
          const down     = row.dailyRegime === "downtrend";
          const canBuy   = price && ((!down && sc >= SIGNAL_HALF_SCORE) || (down && sc >= SIGNAL_DOWNTREND_LONG_SCORE));
          const tradeCell = price
            ? '<div class="trade-actions">' +
                (canBuy ? '<button class="trade-action-btn" style="font-size:10px" data-tip="Open a paper BUY ticket" onclick="openTradeModal(\'' + orderSym + '\',\'' + row.sym + '\',\'buy\',\'\',' + price + ')">Buy</button>' : '') +
                '<button class="trade-close-btn" style="font-size:10px;margin-left:4px" data-tip="Open a paper SELL ticket" onclick="openTradeModal(\'' + orderSym + '\',\'' + row.sym + '\',\'sell\',\'\',' + price + ')">Sell</button>' +
              '</div>'
            : '<span class="small" style="color:var(--muted)">–</span>';
          // Spread + scalp-viability cells (item 1c)
          const spreadCell = row.spreadPct != null
            ? '<span class="' + (row.spreadPct > 0.3 ? "neg" : "") + '">' + fmt(row.spreadPct, 2) + '%</span>'
            : '<span style="color:var(--muted)">–</span>';
          const viaCell = row.viable === null
            ? '<span style="color:var(--muted)" data-tip="No BB-upper target above price — viability not computable.">–</span>'
            : row.viable
              ? '<span class="pos" data-tip="Target distance ' + fmt(row.targetDistPct, 2) + '% ≥ 2× round-trip cost ' + fmt(row.costPct, 2) + '%.">✓ viable</span>'
              : '<span class="neg" style="font-weight:700" data-tip="Target distance ' + fmt(row.targetDistPct, 2) + '% &lt; 2× round-trip cost ' + fmt(row.costPct, 2) + '% — fees + spread eat this scalp’s edge.">⚠ costly</span>';
          return '<tr>' +
            '<td><span class="symbol">' + tvLink(row.sym) + '</span></td>' +
            '<td class="right mono">' + (price ? fmtPrice(price) : "–") + '</td>' +
            '<td class="right mono">' + spreadCell + '</td>' +
            '<td><b style="color:' + scColor + '">' + (sc > 0 ? "+" : "") + sc + '</b></td>' +
            '<td>' + scalpActionPill(row) + '</td>' +
            '<td class="right mono">' + (row.rsi != null ? fmt(row.rsi, 1) : "–") + '</td>' +
            '<td class="right mono">' + (row.atr != null ? fmt(row.atr, row.atr < 1 ? 5 : 2) : "–") + '</td>' +
            '<td class="right mono" data-tip="ADX(14): ' + adxLabel(row.adxVal) + ' — informational, not scored">' + (row.adxVal != null ? fmt(row.adxVal, 1) : "–") + '</td>' +
            '<td class="small ' + (row.obvVal === "rising" ? "pos" : row.obvVal === "falling" ? "neg" : "") + '" data-tip="OBV 20-bar volume-flow trend — informational, not scored">' + (row.obvVal || "–") + '</td>' +
            '<td class="small">' + (row.dailyRegime || "n/a") + '</td>' +
            '<td>' + viaCell + '</td>' +
            '<td>' + tradeCell + '</td>' +
          '</tr>';
        }).join("");
      } catch (e) {
        $("scalpBody").innerHTML = '<tr><td colspan="12" class="placeholder">Scan failed: ' + e.message + '</td></tr>';
      }
    }
