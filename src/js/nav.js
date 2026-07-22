

    let _autoMode = 0; // 0 = off, 1 = prices only (15s), 2 = full (60s)

    function toggleAutoRefresh() {
      const btn = $("autoRefreshBtn");
      // Clear all timers
      if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      if (_tickerTimer)     { clearInterval(_tickerTimer);     _tickerTimer = null; }

      _autoMode = (_autoMode + 1) % 3;

      if (_autoMode === 0) {
        btn.textContent = "⟳ Auto OFF";
        btn.style.color = "var(--muted)";
      } else if (_autoMode === 1) {
        // Prices-only: ticker every 15s
        loadTickerStrip();
        _tickerTimer = setInterval(loadTickerStrip, 15000);
        btn.textContent = "⟳ Prices 15s";
        btn.style.color = "var(--yellow)";
      } else {
        // Full: ticker every 15s + full dashboard every 60s
        loadTickerStrip();
        refreshCurrent();
        _tickerTimer     = setInterval(loadTickerStrip, 15000);
        autoRefreshTimer = setInterval(refreshCurrent, 60000);
        btn.textContent = "⟳ Full 60s";
        btn.style.color = "var(--green)";
      }
    }

    function renderMode() {
      const s     = getSettings();
      const badge = $("modeBadge");
      const sel   = $("setMode");
      if (sel) sel.value = s.mode;
      badge.className = "badge " + (s.mode === "live" ? "live" : "paper");
    }
    function onModeChange() {
      const saved = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
      saved.mode  = $("setMode").value;
      localStorage.setItem("proDashboardSettings", JSON.stringify(saved));
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
      renderMode();
      refreshCurrent();
    }

    function switchTab(id, btn) {
      // Sub-tab ids (Market: #market-overview/#market-signals/#gapgo; Analytics:
      // #performance/#pnl/#edge; Command: #command-overview/#news) are not
      // top-level pages — redirect to the parent tab and select the sub-tab.
      // Keeps deep links, keyboard shortcuts, and any legacy
      // switchTab('pnl')/switchTab('gapgo') call working after the merges.
      if (subParentOf(id)) {
        const parent = subParentOf(id);
        if (parent === "market") _marketSub = id;
        else if (parent === "analytics") _analyticsSub = id;
        else _commandSub = id;
        if (activeTab !== parent) switchTab(parent, tabBtnFor(parent));
        else subTabFnOf(parent)(id);
        return;
      }

      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      $("page-" + id).classList.add("active");

      activeTab = id;

      // Persist the active tab to the URL hash (deep-linkable) and localStorage
      // (restored on browser refresh). See applyTabFromUrl().
      try { localStorage.setItem("lastTab", id); } catch (e) {}
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
      if (location.hash !== "#" + id) {
        try { history.replaceState(null, "", "#" + id); }
        catch (e) { location.hash = id; }
      }

      if (id === "settings") loadSettingsForm();
      else if (id === "backtest") {
        loadBacktestForm();
        refreshCurrent();
      } else if (id === "signals") {
        loadSignals();
      } else if (id === "scalp") {
        // don't auto-run — user picks a timeframe and clicks "▶ Scan"
      } else if (id === "market") {
        // Parent page — restore the last-used sub-tab (Overview auto-loads;
        // Signals/Breakout stay manual). marketSubTab updates the hash.
        marketSubTab(_marketSub || "market-overview");
      } else if (id === "analytics") {
        // Parent page — restore the last-used sub-tab (Performance auto-loads;
        // P&L loads on select; Edge stays manual). analyticsSubTab updates the hash.
        analyticsSubTab(_analyticsSub || "performance");
      } else if (id === "command") {
        // Parent page — restore the last-used sub-tab (Overview refreshes the
        // command data; News auto-loads with a 5-min cache; Socials with 10-min).
        commandSubTab(_commandSub || "command-overview");
      } else if (id === "markov") {
        // don't auto-run — user clicks "Run Markov Analysis"
      } else if (id === "insights") {
        // don't auto-run — user clicks "▶ Analyze" (paginates all FILL history)
      } else if (id === "port-overview") {
        portLoadOverview();
      } else if (id === "port-dist") {
        portLoadDist();
      } else {
        refreshCurrent();
      }
    }

    function openSettings() {
      const btn = Array.from(document.querySelectorAll(".tab-btn")).find(b => b.textContent.includes("Settings"));
      switchTab("settings", btn);
    }

    // ── Parent-page sub-tabs (generic) ────────────────────────────────────────
    // Two parent tabs use an inner sub-tab bar: 🌐 Market (Overview / Signals /
    // Breakout) and 🔬 Analytics (Performance / P&L / Edge). `_activateSubTab`
    // toggles the inner `.subpage` divs + `.subtab-btn` buttons (scoped to the
    // parent so the two groups never clash), keeps the parent nav button active,
    // and reflects the precise sub-tab in the URL hash / lastTab so a refresh or
    // deep link (#market-signals, #pnl, …) lands on the exact sub-tab. Selection
    // state is preserved because the sub-pages keep their rendered DOM.
    const MARKET_SUBS    = ["market-overview", "market-signals", "gapgo"];
    const ANALYTICS_SUBS = ["performance", "pnl", "edge"];
    const COMMAND_SUBS   = ["command-overview", "jobs", "news", "socials", "glossary"];
    let _marketSub    = "market-overview";
    let _analyticsSub = "performance";
    let _commandSub   = "command-overview";

    // Which parent tab owns a sub-tab id (null when `id` is not a sub-tab), and
    // the matching <parent>SubTab function. Single source of truth for the
    // sub-tab redirects in switchTab() and applyTabFromUrl().
    function subParentOf(id) {
      if (MARKET_SUBS.includes(id))    return "market";
      if (ANALYTICS_SUBS.includes(id)) return "analytics";
      if (COMMAND_SUBS.includes(id))   return "command";
      return null;
    }
    function subTabFnOf(parent) {
      return parent === "market" ? marketSubTab
           : parent === "analytics" ? analyticsSubTab
           : commandSubTab;
    }

    function _activateSubTab(parentId, subId) {
      const page = document.getElementById("page-" + parentId);
      if (!page) return;
      page.querySelectorAll(".subpage").forEach(p => p.classList.remove("active"));
      const pg = document.getElementById("subpage-" + subId);
      if (pg) pg.classList.add("active");
      page.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
      const sb = document.getElementById("subtab-" + subId);
      if (sb) sb.classList.add("active");
      // Mirror the sub-tab id to the hash + lastTab for deep-links / refresh.
      try { localStorage.setItem("lastTab", subId); } catch (e) {}
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
      if (location.hash !== "#" + subId) {
        try { history.replaceState(null, "", "#" + subId); }
        catch (e) { location.hash = subId; }
      }
    }

    function marketSubTab(subId) {
      if (!MARKET_SUBS.includes(subId)) subId = "market-overview";
      _marketSub = subId;
      _activateSubTab("market", subId);
      if (subId === "market-overview") loadMarketOverview();
      // market-signals / gapgo stay manual — user clicks ▶
    }

    function analyticsSubTab(subId) {
      if (!ANALYTICS_SUBS.includes(subId)) subId = "performance";
      _analyticsSub = subId;
      _activateSubTab("analytics", subId);
      if (subId === "performance") refreshCurrent();  // populated by loadDashboard → renderPerformance
      else if (subId === "pnl")    loadPnl();
      // edge stays manual — user clicks ▶ Analyze
    }

    function commandSubTab(subId) {
      if (!COMMAND_SUBS.includes(subId)) subId = "command-overview";
      _commandSub = subId;
      _activateSubTab("command", subId);
      if (subId === "command-overview") refreshCurrent();  // reload account/positions context
      else if (subId === "jobs")        renderCronJobs();  // best-effort async — fills #cronJobsList
      else if (subId === "news")        loadNews();        // 5-min cache; ↻ forces
      else if (subId === "socials")     loadSocials();     // 10-min cache; ↻ forces
      else if (subId === "glossary")    loadGlossary();    // 5-min cache; ↻ forces
    }
