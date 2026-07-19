
    // ── Tab deep-linking & last-tab restore ───────────────────────────────
    // Valid tab ids are derived from the nav buttons' switchTab('<id>',…) calls
    // so this never drifts when tabs are added/removed.
    function tabBtnFor(id) {
      return Array.from(document.querySelectorAll(".tab-btn")).find(b =>
        (b.getAttribute("onclick") || "").includes("'" + id + "'"));
    }
    function validTabIds() {
      return Array.from(document.querySelectorAll(".tab-btn")).map(b => {
        const m = (b.getAttribute("onclick") || "").match(/switchTab\('([^']+)'/);
        return m ? m[1] : null;
      }).filter(Boolean);
    }
    // Resolve the target tab from (1) the URL hash, else (2) the last tab saved
    // in localStorage, and activate it. Used on page load and on hashchange so
    // a refresh or a direct #tab link lands on the right tab instead of Command.
    function applyTabFromUrl() {
      const ids = validTabIds();
      const SUBS = MARKET_SUBS.concat(ANALYTICS_SUBS, COMMAND_SUBS);  // all parent sub-tab ids
      const hash = (location.hash || "").replace(/^#/, "");
      let stored = null;
      try { stored = localStorage.getItem("lastTab"); } catch (e) {}
      const target = (ids.includes(hash) || SUBS.includes(hash)) ? hash
                   : (ids.includes(stored) || SUBS.includes(stored)) ? stored
                   : null;
      if (!target) return;
      // A sub-tab deep link: open the parent tab, then select the sub-tab.
      // Backward-compatible with the old standalone #market-signals / #pnl / … hashes.
      if (SUBS.includes(target)) {
        const parent = subParentOf(target);
        if (parent === "market") _marketSub = target;
        else if (parent === "analytics") _analyticsSub = target;
        else _commandSub = target;
        if (activeTab !== parent) switchTab(parent, tabBtnFor(parent));
        else subTabFnOf(parent)(target);
        return;
      }
      if (target === activeTab) return;
      try { switchTab(target, tabBtnFor(target)); } catch (e) {}
    }
    window.addEventListener("hashchange", applyTabFromUrl);

    function refreshCurrent() {
      if (activeTab === "settings") {
        loadSettingsForm();
        return;
      } else if (activeTab === "port-overview") {
        portLoadOverview(); return;
      } else if (activeTab === "port-dist") {
        portLoadDist(); return;
      }

      loadDashboard();
    }
