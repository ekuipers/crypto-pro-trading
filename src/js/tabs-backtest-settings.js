
    function getBacktestDefaults() {
      try {
        return Object.assign({}, DEFAULT_BACKTEST, JSON.parse(localStorage.getItem("proBacktestDefaults") || "{}"));
      } catch {
        return Object.assign({}, DEFAULT_BACKTEST);
      }
    }

    function loadBacktestForm() {
      const b = getBacktestDefaults();

      $("btSharpe").value = b.expectedSharpe;
      $("btMaxDD").value = b.expectedMaxDrawdownPct;
      $("btWinRate").value = b.expectedWinRatePct;
      $("btProfitFactor").value = b.expectedProfitFactor;
      $("btAvgDaily").value = b.expectedAvgDailyReturnPct;
    }

    function saveBacktestDefaults() {
      const b = {
        expectedSharpe: Number($("btSharpe").value || DEFAULT_BACKTEST.expectedSharpe),
        expectedMaxDrawdownPct: Number($("btMaxDD").value || DEFAULT_BACKTEST.expectedMaxDrawdownPct),
        expectedWinRatePct: Number($("btWinRate").value || DEFAULT_BACKTEST.expectedWinRatePct),
        expectedProfitFactor: Number($("btProfitFactor").value || DEFAULT_BACKTEST.expectedProfitFactor),
        expectedAvgDailyReturnPct: Number($("btAvgDaily").value || DEFAULT_BACKTEST.expectedAvgDailyReturnPct)
      };

      localStorage.setItem("proBacktestDefaults", JSON.stringify(b));
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
      if (lastContext) renderBacktest(lastContext);
    }

    function renderBacktest(c) {
      if (!$("backtestKpis")) return;

      const L = getSettings().limits;
      const b = getBacktestDefaults();

      const liveSharpe = sharpe(c.returns, L.tradingDaysPerYear);
      const liveMaxDD = Math.abs(c.dd.maxDDPct);
      const avgDaily = mean(c.returns) * 100;

      // Realized win rate and profit factor from FIFO-matched fills — the same
      // engine the P&L tab uses, so the two tabs always agree.
      const fs = c.fifoStats || {};
      const closedTrades = (fs.wins || 0) + (fs.losses || 0);
      const liveWinRate = fs.winRate != null ? fs.winRate : null;
      const profitFactorLive = fs.profitFactor != null ? fs.profitFactor : null;

      function metricStatus(live, expected, higherIsBetter) {
        if (live == null || isNaN(live)) return ["yellow", tt("backtest", "rtNeedData", "Need data")];
        const ok = higherIsBetter ? live >= expected : live <= expected;
        const warn = higherIsBetter ? live >= expected * 0.75 : live <= expected * 1.25;

        if (ok) return ["green", tt("backtest", "rtWithinExpectation", "Within expectation")];
        if (warn) return ["yellow", tt("backtest", "rtSlightDeviation", "Slight deviation")];
        return ["red", tt("backtest", "rtMaterialDeviation", "Material deviation")];
      }

      // Metric names are rendered labels; the comparison logic keys off the
      // numeric columns, not r[0], so translating here is safe.
      const rows = [
        [tt("backtest", "rtMetricSharpe", "Sharpe"), liveSharpe, b.expectedSharpe, true, fmt(liveSharpe,2), fmt(b.expectedSharpe,2)],
        [tt("backtest", "rtMetricMaxDd", "Max Drawdown %"), liveMaxDD, b.expectedMaxDrawdownPct, false, fmt(liveMaxDD,2) + "%", fmt(b.expectedMaxDrawdownPct,2) + "%"],
        [tt("backtest", "rtMetricWinRate", "Win Rate %"), liveWinRate, b.expectedWinRatePct, true, liveWinRate == null ? tt("rtc", "na", "n/a") : fmt(liveWinRate,1) + "%", fmt(b.expectedWinRatePct,1) + "%"],
        [tt("backtest", "rtMetricProfitFactor", "Profit Factor"), profitFactorLive, b.expectedProfitFactor, true, profitFactorLive == null ? tt("rtc", "na", "n/a") : fmt(profitFactorLive,2), fmt(b.expectedProfitFactor,2)],
        [tt("backtest", "rtMetricAvgDaily", "Avg Daily Return %"), avgDaily, b.expectedAvgDailyReturnPct, true, fmt(avgDaily,3) + "%", fmt(b.expectedAvgDailyReturnPct,3) + "%"]
      ];

      const redCount = rows.filter(r => metricStatus(r[1],r[2],r[3])[0] === "red").length;
      const yellowCount = rows.filter(r => metricStatus(r[1],r[2],r[3])[0] === "yellow").length;

      const health = redCount ? "RED" : yellowCount ? "ORANGE" : "GREEN";

      $("backtestKpis").innerHTML = [
        kpi("Strategy Health", tt("backtest", "rtHealth" + health.charAt(0) + health.slice(1).toLowerCase(), health), tt("backtest", "rtKpiHealthSub", "Live vs expected metrics"), redCount ? "neg" : yellowCount ? "" : "pos"),
        kpi("Live Sharpe", fmt(liveSharpe,2), tt("backtest", "rtKpiSharpeSub", "Risk-adjusted live performance")),
        kpi("Live Max DD", fmt(liveMaxDD,2) + "%", tt("backtest", "rtKpiHistorySub", "Loaded account history"), "neg"),
        kpi("Avg Daily Return", fmt(avgDaily,3) + "%", tt("backtest", "rtKpiHistorySub", "Loaded account history"), avgDaily >= 0 ? "pos" : "neg"),
        kpi("Win Rate", liveWinRate == null ? tt("rtc", "na", "n/a") : fmt(liveWinRate,1) + "%", tt("backtest", "rtKpiWinRateSub", "{{w}}W / {{l}}L (FIFO)", { w: fs.wins || 0, l: fs.losses || 0 }), liveWinRate != null && liveWinRate >= 50 ? "pos" : "neg"),
        kpi("Profit Factor", profitFactorLive == null ? tt("rtc", "na", "n/a") : fmt(profitFactorLive,2), tt("backtest", "rtKpiClosedSub", "{{n}} closed trades", { n: closedTrades }), profitFactorLive != null && profitFactorLive >= 1 ? "pos" : "neg")
      ].join("");

      $("backtestCompareBody").innerHTML = rows.map(r => {
        const st = metricStatus(r[1],r[2],r[3]);
        return `
          <tr>
            <td>${r[0]}</td>
            <td class="right">${r[4]}</td>
            <td class="right">${r[5]}</td>
            <td>${pill(st[0],st[1])}</td>
          </tr>
        `;
      }).join("");
    }

    

    

    

    function loadSettingsForm() {
      const s = getSettings();

      const savedRaw = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
      $("setPaperApiKey").value    = savedRaw.paperApiKey    || savedRaw.apiKey    || "";
      $("setPaperApiSecret").value = savedRaw.paperApiSecret || savedRaw.apiSecret || "";
      $("setLiveApiKey").value     = savedRaw.liveApiKey     || "";
      $("setLiveApiSecret").value  = savedRaw.liveApiSecret  || "";
      $("setMode").value = s.mode;
      $("setStopLoss").value = s.limits.assumedStopLossPct;
      $("setMaxDailyLoss").value = s.limits.maxDailyLossPct;
      $("setMaxOpenRisk").value = s.limits.maxOpenRiskPct;
      $("setMaxSignalSymbols").value = s.limits.maxSignalSymbols;
      $("setMaxOpenPositions").value = s.limits.maxOpenPositions;
      $("setMaxPositionsPerTier").value = s.limits.maxPositionsPerTier;

      renderWatchlistTags();
      $("lastUpdated").textContent = tt("settings", "rtLoaded", "Settings loaded");
    }

    function saveSettings() {
      const current = getSettings();

      const maxDaily = Number($("setMaxDailyLoss").value || DEFAULT_LIMITS.maxDailyLossPct);
      const maxOpenRisk = Number($("setMaxOpenRisk").value || DEFAULT_LIMITS.maxOpenRiskPct);
      let maxSignalSymbols = Math.round(Number($("setMaxSignalSymbols").value || DEFAULT_LIMITS.maxSignalSymbols));
      maxSignalSymbols = Math.max(1, maxSignalSymbols || DEFAULT_LIMITS.maxSignalSymbols);
      let maxOpenPositions = Math.round(Number($("setMaxOpenPositions").value || DEFAULT_LIMITS.maxOpenPositions));
      maxOpenPositions = Math.max(1, maxOpenPositions || DEFAULT_LIMITS.maxOpenPositions);
      let maxPositionsPerTier = Math.round(Number($("setMaxPositionsPerTier").value || DEFAULT_LIMITS.maxPositionsPerTier));
      maxPositionsPerTier = Math.max(1, maxPositionsPerTier || DEFAULT_LIMITS.maxPositionsPerTier);

      const saved = {
        paperApiKey:    $("setPaperApiKey").value.trim(),
        paperApiSecret: $("setPaperApiSecret").value.trim(),
        liveApiKey:     $("setLiveApiKey").value.trim(),
        liveApiSecret:  $("setLiveApiSecret").value.trim(),
        mode: $("setMode").value,
        limits: Object.assign({}, current.limits, {
          assumedStopLossPct: Number($("setStopLoss").value || DEFAULT_LIMITS.assumedStopLossPct),
          maxDailyLossPct: maxDaily,
          warningDailyLossPct: maxDaily / 2,
          maxOpenRiskPct: maxOpenRisk,
          warningOpenRiskPct: maxOpenRisk * 0.6,
          maxSignalSymbols: maxSignalSymbols,
          maxOpenPositions: maxOpenPositions,
          maxPositionsPerTier: maxPositionsPerTier
        })
      };

      localStorage.setItem("proDashboardSettings", JSON.stringify(saved));
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
      renderMode();
      if (typeof updateScanBtnLabel === "function") updateScanBtnLabel();
      $("lastUpdated").textContent = tt("settings", "rtSaved", "Settings saved");
      alert(tt("settings", "rtSavedAlert", "Settings saved. Mode and position limits sync to your account when signed in — API keys/secrets always stay in this browser only."));
    }

    function clearSettings() {
      if (!confirm(tt("settings", "rtClearConfirm", "Clear saved API settings?"))) return;
      localStorage.removeItem("proDashboardSettings");
      loadSettingsForm();
      renderMode();
    }

    // #backtestKpis / #backtestCompareBody are script-written. renderBacktest()
    // works off the already-loaded context, so this costs no network call.
    onLangChange("backtest", function () {
      if (lastContext) renderBacktest(lastContext);
    });
