
    async function loadSignals() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("signalBody").innerHTML = '<tr><td colspan="17" class="placeholder">Configure API credentials in Settings first.</td></tr>';
        return;
      }
      $("signalBody").innerHTML = '<tr><td colspan="17" class="placeholder">Scanning all symbols…</td></tr>';
      $("signalKpis").innerHTML = kpi("Status", "Scanning…", "Fetching bars from Alpaca Data API");

      // Merge fresh scout promotions so the scan matches the Python bot's
      // real universe (roadmap item 6). Graceful: file missing → watchlist only.
      await loadScoutPromotions().catch(() => null);
      const baseWl = getWatchlist();
      const scoutSyms = scoutExtraSymbols(baseWl);
      const SYMBOLS = baseWl.concat(scoutSyms);

      try {
        const [bars15, bars4h, barsD, snaps] = await Promise.all([
          fetchBars(SYMBOLS, "15Min", 120),
          fetchBars(SYMBOLS, "4Hour", 60),
          fetchBars(SYMBOLS, "1Day", 60),
          fetchSnapshotsInBatches(SYMBOLS).catch(() => ({}))   // live bid/ask for the Spread column (item 1)
        ]);

        // 4H data fallback (item 6): rebuild short 4H series from 1H bars so
        // Signal 6 / swing-low stops don't silently degrade; mark the rest.
        const fb4h = await fill4hFallback(SYMBOLS, bars4h);

        // Live spread % per symbol from snapshot quotes (item 1).
        const spreadBySym = {};
        for (const sym of SYMBOLS) {
          const snap = snaps[sym] || snaps[sym.replace("/", "")];
          const q = snap && snap.latestQuote;
          if (q && q.ap > 0 && q.bp > 0 && q.ap >= q.bp)
            spreadBySym[sym] = (q.ap - q.bp) / ((q.ap + q.bp) / 2) * 100;
        }

        // Compute and cache correlation matrix from daily bars
        if (barsD) {
          _corrCache = computeCorrelationMatrix(barsD, SYMBOLS);
          renderCorrelationHeatmap(_corrCache, SYMBOLS);
        }

        if (!bars15) {
          $("signalBody").innerHTML = '<tr><td colspan="17" class="placeholder">Error fetching bars — check API credentials.</td></tr>';
          return;
        }

        const rows = [];
        const scores = [];

        for (const sym of SYMBOLS) {
          const alpacaSym = sym.replace("/", "");
          const b15 = (bars15[sym] || bars15[alpacaSym] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const b4h = (bars4h[sym] || bars4h[alpacaSym] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
          const bD  = (barsD[sym]  || barsD[alpacaSym]  || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));

          if (b15.length < STRAT_CFG.minBarsForSignal) {
            rows.push({ sym, score: null, error: "Insufficient bars", scout: scoutSyms.includes(sym) });
            continue;
          }

          const res = calcSignalScore(b15, b4h, bD);
          scores.push(res.score);
          // Informational ADX/OBV (display-only — parity exemption) + R:R inputs
          const adxVal = calcADX(b15.map(b => b.h), b15.map(b => b.l), b15.map(b => b.c));
          const obvVal = calcObvTrend(b15.map(b => b.c), b15.map(b => b.v));
          const swingStop = swingLowStop4h(b4h.map(b => b.l), res.lastClose);
          rows.push({
            sym, ...res, adxVal, obvVal, swingStop,
            scout: scoutSyms.includes(sym),
            spreadPct: spreadBySym[sym] != null ? spreadBySym[sym] : null,
            synth4h: fb4h.synthetic.includes(sym),
            degraded4h: fb4h.degraded.includes(sym)
          });

          // fire notification for strong BUY or SHORT signals
          if (Notification.permission === "granted") {
            if (res.score >= SIGNAL_BUY_SCORE && res.dailyRegime !== "downtrend") {
              try {
                new Notification(`🚀 ${sym} — Score ${res.score}`, {
                  body: `BUY signal · RSI ${res.rsi} · ${res.dailyRegime}`,
                  tag: sym
                });
              } catch(e) {}
            } else if (res.score <= -4 && res.dailyRegime === "downtrend") {
              try {
                new Notification(`🔻 ${sym} — Score ${res.score}`, {
                  body: `BEAR signal (no short — spot venue) · RSI ${res.rsi} · downtrend`,
                  tag: sym
                });
              } catch(e) {}
            }
          }
        }

        // Render signal table
        const scoreBar = (s) => {
          if (s === null) return "–";
          const abs = Math.min(Math.abs(s), 6);
          const pct = abs / 6 * 100;
          const color = s >= SIGNAL_BUY_SCORE ? "#3fb950" : s >= SIGNAL_HALF_SCORE ? "#d29922" : s <= 0 ? "#f85149" : "#58a6ff";
          return `<span style="display:inline-flex;align-items:center;gap:6px">
            <span style="width:52px;height:6px;border-radius:3px;background:rgba(255,255,255,.1);display:inline-block;vertical-align:middle">
              <span style="display:block;height:100%;width:${pct}%;background:${color};border-radius:3px"></span>
            </span>
            <b style="color:${color}">${s > 0 ? "+" : ""}${s}</b>
          </span>`;
        };

        const actionPill = (row) => {
          if (row.score === null) return pill("muted", "Error");
          const down = row.dailyRegime === "downtrend";
          // Long signals (uptrend / mixed)
          if (!down && row.score >= SIGNAL_BUY_SCORE) return pill("green", "BUY");
          if (!down && row.score >= SIGNAL_HALF_SCORE) return pill("yellow", "HALF");   // 2.5–3.49 = half-size
          // Downtrend: half-size counter-trend long allowed at high confluence (≥4)
          if (down && row.score >= SIGNAL_DOWNTREND_LONG_SCORE) return pill("yellow", "½ C-Trend");
          if (down && row.score >= SIGNAL_HALF_SCORE) return pill("muted", "Blocked");
          // Short signals (downtrend only)
          if (down && row.score <= -3) return pill("red", "BEAR");    // informational — shorts unsupported on Alpaca spot
          return pill("muted", "HOLD");
        };

        const emaCls = (row) => {
          const sig = row.signals && row.signals.ema_cross || "";
          return sig.includes("+") ? "pos" : sig.includes("−") ? "neg" : "";
        };

        const macdCls = (row) => {
          const sig = row.signals && row.signals.macd || "";
          return sig.includes("+") ? "pos" : sig.includes("−") ? "neg" : "";
        };

        const regimeCls = (row) => {
          if (row.dailyRegime === "uptrend") return "pos";
          if (row.dailyRegime === "downtrend") return "neg";
          return "";
        };

        // ATR qty helper (uses last loaded account equity if available)
        const equity = lastContext ? lastContext.equity : 0;

        rows.sort((a, b) => (b.score !== null ? b.score : -99) - (a.score !== null ? a.score : -99));
        _signalRrMap = {};   // rebuilt every scan — feeds the trade-modal R:R preview
        const scoutTag = row => row.scout
          ? ` <span style="font-size:9px;background:rgba(88,166,255,.15);color:var(--blue);border-radius:4px;padding:1px 5px;vertical-align:middle" data-tip="Scout promotion (data/watchlist_dynamic.json) — auto-promoted by scripts/scout.py and traded by the Python bot at the default 5% cap.">SCOUT</span>`
          : "";
        $("signalBody").innerHTML = rows.map(row => {
          if (row.error) return `<tr><td><span class="symbol">${tvLink(row.sym)}</span>${scoutTag(row)}</td><td colspan="16" style="color:var(--muted)">${row.error}</td></tr>`;
          const down = row.dailyRegime === "downtrend";
          const emaLabel = (row.ema20 > row.ema50) ? "Golden" : "Death";
          const regime4hLabel = (row.ema4h_20 > row.ema4h_50) ? "Golden" : "Death";
          const regime4hCls = (row.ema4h_20 > row.ema4h_50) ? "pos" : "neg";

          // Trend arrow vs previous scan
          const prevScore = _prevScoreMap[row.sym];
          const trendHtml = prevScore === undefined
            ? '<span class="trend-flat" data-tip="First scan — no previous score">–</span>'
            : row.score > prevScore
              ? `<span class="trend-up" data-tip="Improved from ${prevScore}">↑</span>`
              : row.score < prevScore
                ? `<span class="trend-down" data-tip="Weakened from ${prevScore}">↓</span>`
                : '<span class="trend-flat" data-tip="Unchanged">→</span>';

          // ATR-based suggested qty
          let qtyHtml = "–";
          if (equity && row.atr && row.lastClose) {
            const ask     = row.lastClose;
            const capPct  = (PORTFOLIO_CAPS[row.sym] || PORTFOLIO_CAPS[row.sym.replace("/","")] || 5) / 100;
            const maxRisk = equity * 0.01;
            const stopDist= row.atr * 1.5;
            const rawQty  = maxRisk / stopDist;
            const capQty  = (equity * capPct) / ask;
            const sugQty  = Math.min(rawQty, capQty);
            const notional= sugQty * ask;
            const isCapLimited = capQty < rawQty;
            qtyHtml = `<span class="small ${isCapLimited ? "" : ""}" data-tip="ATR qty: 1% risk → raw ${fmt(rawQty,4)} · cap-limited to ${fmt(capQty,4)} · notional ≈ $${fmt(notional,0)} · stop dist $${fmt(stopDist, ask<1?4:2)}">${fmt(sugQty, sugQty < 0.01 ? 6 : sugQty < 1 ? 4 : 2)}${isCapLimited ? " ⌐" : ""}</span>`;
          }

          // Quick BUY button — opens trade modal pre-filled with ATR qty
          const quickFillQty = (equity && row.atr && row.lastClose) ? (() => {
            const ask = row.lastClose;
            const capPct = (PORTFOLIO_CAPS[row.sym] || 5) / 100;
            const sugQty = Math.min(equity * 0.01 / (row.atr * 1.5), (equity * capPct) / ask);
            return fmt(sugQty, sugQty < 0.01 ? 6 : sugQty < 1 ? 4 : 2).replace(/,/g,"");
          })() : "";
          const orderSym = row.sym.replace("/","");

          // NET R:R preview (roadmap 2026-07-09 items 1+7): risk = distance to
          // the 4H swing-low stop; reward = distance to the BB-upper target
          // MINUS the round-trip cost (2× taker fee + live spread).
          let rrHtml = '<span style="color:var(--muted)">–</span>';
          const costPct = roundTripCostPct(row.spreadPct);
          if (row.swingStop && row.lastClose > row.swingStop) {
            const stopDistPct = (row.lastClose - row.swingStop) / row.lastClose * 100;
            const target = row.bb && row.bb.upper > row.lastClose ? row.bb.upper : null;
            const stopStr = fmt(row.swingStop, row.swingStop < 1 ? 6 : 2);
            if (target) {
              const grossRr = (target - row.lastClose) / (row.lastClose - row.swingStop);
              const rr = netRrPct(row.lastClose, row.swingStop, target, costPct);
              const rrCol = rr >= STRAT_CFG.minRrFull ? "var(--green)" : rr >= STRAT_CFG.minRrHalf ? "var(--yellow)" : "var(--red)";
              rrHtml = `<span style="color:${rrCol};font-weight:700" data-tip="NET of round-trip cost ${fmt(costPct,2)}% (2×${STRAT_CFG.feeBpsPerSide}bps fee${row.spreadPct != null ? " + " + fmt(row.spreadPct,2) + "% spread" : ""}) · gross 1:${fmt(grossRr,1)} · stop = 4H swing low $${stopStr} (−${fmt(stopDistPct,1)}%) · target = BB upper $${fmt(target, target < 1 ? 6 : 2)} · soft gate: &lt;${STRAT_CFG.minRrHalf} block, &lt;${STRAT_CFG.minRrFull} half-size">1:${fmt(rr,1)}</span>`;
              _signalRrMap[row.sym] = { stop: row.swingStop, stopDistPct, target, rr, grossRr, costPct };
            } else {
              rrHtml = `<span style="color:var(--muted)" data-tip="Stop = 4H swing low $${stopStr} (−${fmt(stopDistPct,1)}%) · price at/above BB upper — no upside target">–</span>`;
              _signalRrMap[row.sym] = { stop: row.swingStop, stopDistPct, target: null, rr: null, grossRr: null, costPct };
            }
          }

          // Spread cell (item 1) + 4H data-quality marker (item 6)
          const spreadHtml = row.spreadPct != null
            ? `<span class="${row.spreadPct > 0.3 ? "neg" : ""}" data-tip="Round-trip cost ≈ ${fmt(costPct,2)}% (2×${STRAT_CFG.feeBpsPerSide}bps taker fee + spread)">${fmt(row.spreadPct, 2)}%</span>`
            : '<span style="color:var(--muted)">–</span>';
          const dq4h = row.degraded4h
            ? ' <span style="color:var(--red)" data-tip="DATA-QUALITY WARNING: 4H history unavailable (1H fallback failed too) — Signal 6 contributes 0 and the swing-low stop falls back to the fixed −5%.">⚠</span>'
            : row.synth4h
              ? ' <span style="color:var(--yellow)" data-tip="4H bars rebuilt from 1H bars (native 4H fetch was short) — Signal 6 and the swing-low stop use synthetic 4H data.">⚠</span>'
              : "";

          return `
            <tr>
              <td><span class="symbol">${tvLink(row.sym)}</span>${scoutTag(row)}</td>
              <td class="right mono">${row.lastClose ? fmtPrice(row.lastClose) : "–"}</td>
              <td class="right mono">${spreadHtml}</td>
              <td class="right">${scoreBar(row.score)}</td>
              <td style="text-align:center">${trendHtml}</td>
              <td class="${emaCls(row)}">${emaLabel}</td>
              <td class="right ${row.rsi >= 70 ? "neg" : row.rsi < 30 ? "pos" : ""}">${row.rsi !== null ? fmt(row.rsi, 1) : "–"}</td>
              <td class="${macdCls(row)}">${row.signals && row.signals.macd ? row.signals.macd.replace(/[+−0]\s/, "") : "–"}</td>
              <td class="right ${row.bb && row.bb.pb < 0.25 ? "pos" : row.bb && row.bb.pb > 0.75 ? "neg" : ""}">${row.bb ? fmt(row.bb.pb, 2) : "–"}</td>
              <td class="right ${row.volRatio >= 1.2 ? "pos" : row.volRatio < 0.7 ? "neg" : ""}">${row.volRatio !== null ? fmt(row.volRatio, 2) + "×" : "–"}</td>
              <td class="right mono" data-tip="ADX(14): ${adxLabel(row.adxVal)} — informational, not scored">${row.adxVal != null ? fmt(row.adxVal, 1) : "–"}</td>
              <td class="small ${row.obvVal === "rising" ? "pos" : row.obvVal === "falling" ? "neg" : ""}" data-tip="OBV 20-bar volume-flow trend — informational, not scored">${row.obvVal || "–"}</td>
              <td class="${regime4hCls}">${regime4hLabel}${dq4h}</td>
              <td class="${regimeCls(row)}">${row.dailyRegime}</td>
              <td class="right">${qtyHtml}</td>
              <td class="right">${rrHtml}</td>
              <td>
                ${actionPill(row)}
                ${!down && row.score >= SIGNAL_HALF_SCORE && row.lastClose ? `<button class="trade-action-btn" style="margin-top:3px;font-size:10px" data-tip="Open BUY trade modal pre-filled with ATR-based qty" onclick="openTradeModal('${orderSym}','${row.sym}','buy','${quickFillQty}',${row.lastClose})">⚡ Buy</button><button class="trade-action-btn" style="margin-top:3px;font-size:10px;margin-left:4px" data-tip="Execute BUY order immediately using this signal" onclick="executeSignalTrade('${orderSym}','${row.sym}','buy','${quickFillQty}',${row.lastClose})">▶ Execute</button>` : ""}
              </td>
            </tr>
          `;
        }).join("");

        // Score distribution (shared tile — see renderScoreDist)
        renderScoreDist("scoreDist", scores);

        const buys = scores.filter(s => s >= 4).length;
        const halfs = scores.filter(s => s >= 3 && s < 4).length;  // 3.0–3.9 = half-size
        $("signalKpis").innerHTML = [
          kpi("BUY Signals", String(buys), "Score ≥ 4 across all symbols", buys > 0 ? "pos" : ""),
          kpi("HALF Signals", String(halfs), "Score 3–3.9 (half-size if R:R ≥ 1:3)", halfs > 0 ? "" : ""),
          kpi("Avg Score", scores.length ? fmt(scores.reduce((a,b)=>a+b,0)/scores.length, 1) : "–", "Mean confluence score")
        ].join("");

        // Save scores for next scan's trend arrows
        const newMap = {};
        rows.filter(r => r.score !== null).forEach(r => { newMap[r.sym] = r.score; });
        _prevScoreMap = newMap;
        Object.assign(_msPrevScores, newMap);  // keep MO score column in sync

        _signalCache = rows;

      } catch(e) {
        $("signalBody").innerHTML = `<tr><td colspan="17" class="placeholder">Error: ${e.message}</td></tr>`;
      }
    }

    async function requestNotifications() {
      if (!("Notification" in window)) {
        $("notifStatus").textContent = "Notifications not supported in this browser.";
        return;
      }
      const perm = await Notification.requestPermission();
      $("notifStatus").textContent = `Notifications: ${perm}`;
    }
