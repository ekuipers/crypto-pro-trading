
    // ═══════════════════════════════════════════════════════════════════════
    //  PERIOD SELECTOR (Performance tab)
    // ═══════════════════════════════════════════════════════════════════════

    let _currentPeriod = "1M";

    function setPeriod(period, btn) {
      _currentPeriod = period;
      document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
      refreshCurrent();
    }

    // Override the history fetch to use the current period
    const _PERIOD_MAP = { "1M": "1Month", "3M": "3Month", "6M": "6Month", "1Y": "1Year" };

    // Patch loadDashboard to inject the period — we hook into fetch via a wrapper
    // We intercept at the point where portfolio history is fetched
    const _origLoadDashboard = loadDashboard;

    // ═══════════════════════════════════════════════════════════════════════
    //  ROLLING METRICS (Performance tab)
    // ═══════════════════════════════════════════════════════════════════════

    function rollingKpis(returns, days, tradingDaysPerYear) {
      if (!returns || returns.length < days) return null;
      const slice = returns.slice(-days);
      const sh = sharpe(slice, tradingDaysPerYear);
      const avgRet = mean(slice) * 100;
      const vol = std(slice) * Math.sqrt(tradingDaysPerYear) * 100;
      const dd = drawdown(slice);
      return { sh, avgRet, vol, maxDD: dd.maxDDPct };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RISK ENHANCEMENTS — Concentration + Correlation panels
    // ═══════════════════════════════════════════════════════════════════════

    function renderConcentration(positions, equity) {
      if (!positions || !positions.length) {
        $("concentrationPanel").innerHTML = '<div class="small">No open positions.</div>';
        return;
      }
      const rows = positions.map(p => {
        const mv = Math.abs(Number(p.market_value || 0));
        const pct = equity ? mv / equity * 100 : 0;
        const sym = toSlash(p.symbol);
        const cap = PORTFOLIO_CAPS[sym] || PORTFOLIO_CAPS[p.symbol] || 5;
        const used = fmt(pct / cap * 100, 0);
        const barColor = pct >= cap * 0.9 ? "#f85149" : pct >= cap * 0.7 ? "#d29922" : "#3fb950";
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <span class="symbol" style="width:70px">${tvLink(sym)}</span>
            <div style="flex:1;height:7px;background:rgba(255,255,255,.08);border-radius:4px">
              <div style="height:100%;width:${Math.min(pct/cap*100,100)}%;background:${barColor};border-radius:4px"></div>
            </div>
            <span class="small" style="width:80px;text-align:right">${fmt(pct,1)}% / ${cap}% cap</span>
          </div>
        `;
      }).join("");
      $("concentrationPanel").innerHTML = rows;
    }

    function renderCorrelation(positions) {
      // We show a simple text-based correlation note based on BTC dominance
      if (!positions || !positions.length) {
        $("correlationPanel").innerHTML = '<div class="small">No open positions.</div>';
        return;
      }
      const syms = positions.map(p => toSlash(p.symbol));
      const altcoins = syms.filter(s => !s.startsWith("BTC") && !s.startsWith("ETH"));
      const note = altcoins.length >= 3
        ? "⚠️ High altcoin concentration — portfolio likely highly correlated to BTC. Consider reducing exposure in drawdowns."
        : altcoins.length >= 1
        ? "Moderate correlation risk. Altcoins tend to move with BTC in risk-off environments."
        : "Low correlation risk — mostly BTC/ETH which are the benchmark assets.";

      const rows = syms.map(s => {
        const isBtc = s.startsWith("BTC");
        const isEth = s.startsWith("ETH");
        const corrLabel = isBtc ? "Benchmark" : isEth ? "~0.85 BTC" : "~0.75–0.95 BTC";
        const corrColor = isBtc ? "var(--muted)" : isEth ? "var(--blue)" : "#d29922";
        return `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span class="symbol">${tvLink(s)}</span>
          <span style="font-size:12px;color:${corrColor}">${corrLabel}</span>
        </div>`;
      }).join("");
      $("correlationPanel").innerHTML = `<div style="margin-bottom:10px;font-size:12px">${rows}</div><div class="small" style="color:var(--muted)">${note}</div>`;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CSV EXPORT
    // ═══════════════════════════════════════════════════════════════════════

    function exportCsv(type) {
      let csv = "";
      let filename = "";

      if (type === "positions") {
        const positions = window._lastPositions || [];
        if (!positions.length) { alert("No position data loaded. Refresh first."); return; }
        csv = "Symbol,Qty,Entry,Current,Market Value,%Equity,Unrealized P&L,P&L%\n";
        positions.forEach(p => {
          const qty = Number(p.qty || 0);
          const mv = Math.abs(Number(p.market_value || 0));
          const unreal = Number(p.unrealized_pl || 0);
          const unrealPct = Number(p.unrealized_plpc || 0) * 100;
          csv += [toSlash(p.symbol), qty, p.avg_entry_price, p.current_price, mv.toFixed(2), (mv / (window._lastEquity || 1) * 100).toFixed(2), unreal.toFixed(2), unrealPct.toFixed(2)].join(",") + "\n";
        });
        filename = `positions_${new Date().toISOString().slice(0,10)}.csv`;
      } else if (type === "trades") {
        if (!_pnlTradeRows.length) { alert("No trade data loaded. Open the P&L tab first."); return; }
        csv = "Date,Symbol,Side,Qty,Fill Price,Realized P&L,Status\n";
        _pnlTradeRows.forEach(t => {
          csv += [t.date, toSlash(t.sym), t.side, t.qty, t.price.toFixed(4), t.pnl !== null ? t.pnl.toFixed(2) : "", t.status].join(",") + "\n";
        });
        filename = `trades_${new Date().toISOString().slice(0,10)}.csv`;
      }

      if (!csv) return;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ACTIVE WATCHLIST — settings-managed, up to 20 symbols
    // ═══════════════════════════════════════════════════════════════════════
    const DEFAULT_WATCHLIST = ["BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","DOT/USD","LTC/USD","DOGE/USD","ADA/USD","AAVE/USD"];
    const WL_STORAGE_KEY = "proDashboardWatchlist";
    const WL_MAX = 20;

    function getWatchlist() {
      try {
        const saved = localStorage.getItem(WL_STORAGE_KEY);
        if (saved) { const p = JSON.parse(saved); if (Array.isArray(p) && p.length) return p; }
      } catch(e) {}
      return DEFAULT_WATCHLIST.slice();
    }

    function saveWatchlistData(arr) {
      localStorage.setItem(WL_STORAGE_KEY, JSON.stringify(arr));
      if (typeof loadTickerStrip === "function") loadTickerStrip();   // reflect new watchlist in the ticker immediately (roadmap item 1)
      if (typeof scheduleSettingsSync === "function") scheduleSettingsSync();
    }

    function renderWatchlistTags() {
      const el = document.getElementById("watchlistTagsEl");
      const countEl = document.getElementById("watchlistCountEl");
      if (!el) return;
      const wl = getWatchlist();
      el.innerHTML = wl.map((sym, i) =>
        `<span class="wl-sym-tag">${sym}<span class="wl-sym-tag-x" onclick="removeWatchlistSymbol(${i})" title="Remove">×</span></span>`
      ).join("");
      if (countEl) countEl.textContent = wl.length;
      populateWatchlistOptions();   // keep the exchange dropdown in sync (excludes already-added symbols)
    }

    function addWatchlistSymbol() {
      const input = document.getElementById("watchlistAddInput");
      if (!input) return;
      const raw = input.value.trim().toUpperCase().replace(/\s+/g, "");
      let sym = raw;
      if (sym && !sym.includes("/")) {
        // bare form: attach the longest matching allowed quote (USDT/USDC before USD)
        const q = ["USDT", "USDC", "USD"].find(function(qq) { return sym.endsWith(qq); });
        if (q) sym = sym.slice(0, -q.length) + "/" + q;
      }
      if (!sym || !/\/(USD|USDT|USDC)$/.test(sym)) { alert("Symbol must be quoted in USD, USDT, or USDC — e.g. BTC/USD, BTC/USDT"); return; }
      const wl = getWatchlist();
      if (wl.length >= WL_MAX) { alert(`Maximum ${WL_MAX} symbols allowed.`); return; }
      if (wl.includes(sym)) { alert(`${sym} is already in the watchlist.`); return; }
      wl.push(sym);
      saveWatchlistData(wl);
      input.value = "";
      renderWatchlistTags();
    }

    function removeWatchlistSymbol(idx) {
      const wl = getWatchlist();
      wl.splice(idx, 1);
      saveWatchlistData(wl);
      renderWatchlistTags();
    }

    function resetWatchlist() {
      if (!confirm("Reset watchlist to the 10 default symbols?")) return;
      saveWatchlistData(DEFAULT_WATCHLIST.slice());
      renderWatchlistTags();
    }

    // Populate the Settings watchlist add-symbol dropdown with the full tradable
    // Alpaca crypto universe (shared getCryptoUniverse). The control is an
    // <input list> + <datalist>, so the user can pick from the exchange list or
    // type to filter; symbols already in the watchlist are skipped. Degrades
    // gracefully to plain free-text entry if the assets call fails (datalist
    // stays empty — addWatchlistSymbol() still normalizes whatever is typed).
    async function populateWatchlistOptions() {
      const dl = document.getElementById("watchlistSymbolOptions");
      if (!dl) return;
      try {
        const universe = await getCryptoUniverse();
        const wl = getWatchlist();
        let syms = universe.slice();
        // Stablecoin filter: getCryptoUniverse() always drops stablecoin bases
        // (USDT/USD, USDC/USD, …). The "Show stablecoins" checkbox lets the user
        // opt them back into the symbol selector dropdown only — scans and the
        // overview universe stay stablecoin-free. Default off = current behaviour.
        const showStable = document.getElementById("watchlistShowStable");
        if (showStable && showStable.checked) {
          syms = syms.concat(await getStablecoinPairs());
        }
        dl.innerHTML = syms
          .filter(function(sym) { return !wl.includes(sym); })
          .map(function(sym) { return '<option value="' + sym + '">'; })
          .join("");
      } catch (e) { /* non-fatal — free-text entry still works */ }
    }
