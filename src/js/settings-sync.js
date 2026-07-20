
    // ═══════════════════════════════════════════════════════════════════════
    //  SETTINGS SYNC — dashboard preferences follow the account across
    //  devices/browsers/sessions (Suite roadmap item). Same server-first,
    //  localStorage-fallback pattern as CryptoPro Charts' persistence.js —
    //  server wins whenever it has data; local is the offline/signed-out
    //  fallback (never merged/diffed against local — matches Charts' own
    //  loadAutosave() precedent).
    //
    //  Synced: theme, last tab, watchlist, backtest form defaults, and the
    //  non-secret parts of dashboard settings (trading mode, position limits).
    //
    //  Deliberately NOT synced (stays local-only, per-browser):
    //   - Alpaca API key/secret (paper and live) — live trading credentials;
    //     writing these to the shared Supabase DB is a materially different
    //     security posture than syncing UI preferences, scoped out on
    //     purpose (see memory/memory.md).
    //   - autopilotXxx keys — live Autopilot runtime bookkeeping (HWM,
    //     partial-TP state, entry time, order age, day-open, log). Autopilot
    //     is deliberately always OFF on page load; syncing this across
    //     devices risks two tabs/devices both believing they own the same
    //     position's trailing-stop state, or two Autopilot loops running
    //     for one account at once.
    // ═══════════════════════════════════════════════════════════════════════

    const SETTINGS_SYNC_KEYS = ["dashTheme", "lastTab", "proDashboardWatchlist", "proBacktestDefaults"];

    async function settingsSyncGet(path) {
      const r = await fetch(path);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }
    async function settingsSyncPut(path, data) {
      const r = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }

    function settingsSnapshot() {
      const snap = {};
      SETTINGS_SYNC_KEYS.forEach(function (k) {
        const v = localStorage.getItem(k);
        if (v !== null) snap[k] = v;
      });
      try {
        const saved = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
        snap.mode = saved.mode;
        snap.limits = saved.limits;
      } catch (e) {}
      return snap;
    }

    function applySyncedSettings(data) {
      if (!data) return;
      SETTINGS_SYNC_KEYS.forEach(function (k) {
        if (data[k] !== undefined) { try { localStorage.setItem(k, data[k]); } catch (e) {} }
      });
      if (data.mode !== undefined || data.limits !== undefined) {
        try {
          const existing = JSON.parse(localStorage.getItem("proDashboardSettings") || "{}");
          if (data.mode !== undefined) existing.mode = data.mode;
          if (data.limits !== undefined) existing.limits = Object.assign({}, existing.limits || {}, data.limits);
          localStorage.setItem("proDashboardSettings", JSON.stringify(existing));
        } catch (e) {}
      }
    }

    function settingsSyncDebounce(fn, ms) {
      let t;
      return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(null, args); }, ms);
      };
    }

    const scheduleSettingsSync = settingsSyncDebounce(function () {
      settingsSyncPut("/api/session", settingsSnapshot()).catch(function () {});
    }, 1500);

    // Called once from main.js's bootstrapDashboard(), before config.json is
    // merged in — so precedence is: this browser's own explicit edits (freshest,
    // read later by the rest of the app) > server-synced state from another
    // device > config.json (deploy-time defaults, gap-fill only).
    async function loadSyncedSettings() {
      let data;
      try { data = await settingsSyncGet("/api/session"); } catch (e) { return; }
      if (!data) return;
      applySyncedSettings(data);
    }
