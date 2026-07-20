    renderMode();
    loadBacktestForm();
    enhanceTables();

    (async function bootstrapDashboard() {
    if (typeof loadSyncedSettings === "function") await loadSyncedSettings();
    await loadConfigFromFile();
    renderMode();
    loadBacktestForm();
    try { updateScanBtnLabel(); } catch (e) {}
    try { apInit(); } catch (e) {}

    if (getSettings().apiKey && getSettings().apiSecret) {
      loadDashboard();
      loadTickerStrip();
      _tickerTimer = setInterval(loadTickerStrip, 15000);
    } else {
      $("commandKpis").innerHTML = [
        kpi("Connection", "Not configured", "Go to Settings and add Alpaca credentials"),
        kpi("Mode", getSettings().mode === "live" ? "Live" : "Paper", "Selected account mode"),
        kpi("Security", "Local only", "Credentials are stored in browser localStorage")
      ].join("");

      $("permissionRules").innerHTML = `
        <div class="rule-row">
          <div class="rule-dot yellow"></div>
          <div>
            <b>Alpaca connection required</b><br>
            <span class="small">Open Settings, add your API key and secret, then refresh.</span>
          </div>
        </div>
      `;
    }

    // Restore the tab from the URL hash (deep link) or the last-opened tab
    // (browser refresh). Runs after initial render so loaders fire correctly.
    applyTabFromUrl();
    })();
