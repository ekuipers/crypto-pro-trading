
    // ═══════════════════════════════════════════════════════════════════════
    //  HOOKS INTO EXISTING RENDERERS
    // ═══════════════════════════════════════════════════════════════════════

    // Cache positions data for CSV export and concentration panel
    const _origRenderPositions = renderPositions;
    renderPositions = function(c) {
      window._lastPositions = c.positions;
      window._lastEquity = c.equity;
      _origRenderPositions(c);
    };

    // After renderRisk runs, also populate concentration and correlation panels
    const _origRenderRisk = renderRisk;
    renderRisk = function(c) {
      _origRenderRisk(c);
      renderConcentration(c.positions, c.equity);
      renderCorrelation(c.positions);
    };

    // After renderPerformance, populate rolling KPIs row
    const _origRenderPerformance = renderPerformance;
    renderPerformance = function(c) {
      _origRenderPerformance(c);
      const L = getSettings().limits;
      const rolling30 = rollingKpis(c.returns, 30, L.tradingDaysPerYear);
      const rolling90 = rollingKpis(c.returns, 90, L.tradingDaysPerYear);
      if ($("rollingKpis")) {
        const cards = [];
        if (rolling30) {
          cards.push(
            kpi("30D Sharpe", fmt(rolling30.sh, 2), "Rolling 30-day risk-adjusted return"),
            kpi("30D Avg Return", pct(rolling30.avgRet, 2), "Average return over last 30 periods", rolling30.avgRet >= 0 ? "pos" : "neg"),
            kpi("30D Max DD", pct(rolling30.maxDD), "Max drawdown in rolling 30D window", "neg")
          );
        }
        if (rolling90) {
          cards.push(
            kpi("90D Sharpe", fmt(rolling90.sh, 2), "Rolling 90-day risk-adjusted return"),
            kpi("90D Avg Return", pct(rolling90.avgRet, 2), "Average return over last 90 periods", rolling90.avgRet >= 0 ? "pos" : "neg"),
            kpi("90D Max DD", pct(rolling90.maxDD), "Max drawdown in rolling 90D window", "neg")
          );
        }
        if (!cards.length) {
          $("rollingKpis").innerHTML = '<div class="small" style="color:var(--muted)">Not enough history for rolling metrics.</div>';
        } else {
          $("rollingKpis").innerHTML = cards.join("");
        }
      }
    };


    // ═══════════════════════════════════════════════════════════════════════
    //  THEME TOGGLE
    // ═══════════════════════════════════════════════════════════════════════

    (function initTheme() {
      const saved = localStorage.getItem("dashTheme") || "dark";
      applyTheme(saved);
    })();

    function applyTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      const btn = document.getElementById("themeBtn");
      if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
      localStorage.setItem("dashTheme", theme);
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    }
