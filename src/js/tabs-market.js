
    // ── Market Overview & Market Signals — tradable crypto universe ───────

    const TOP30_SYMBOLS = [
      "BTC/USD","ETH/USD","XRP/USD","SOL/USD","DOGE/USD",
      "ADA/USD","AVAX/USD","SHIB/USD","DOT/USD","LINK/USD",
      "LTC/USD","BCH/USD","UNI/USD","ATOM/USD","XLM/USD",
      "ALGO/USD","AAVE/USD","MKR/USD","GRT/USD","NEAR/USD",
      "FIL/USD","XTZ/USD","BAT/USD","CRV/USD","SUSHI/USD",
      "COMP/USD","SNX/USD","MATIC/USD","ENS/USD","YFI/USD"
    ];

    // Approximate market cap rank + metadata (stablecoins & BNB excluded)
    const TOP30_INFO = {
      "BTC/USD":   { rank:1,  tier:"Mega",   capLabel:">$1T",    name:"Bitcoin" },
      "ETH/USD":   { rank:2,  tier:"Mega",   capLabel:">$300B",  name:"Ethereum" },
      "XRP/USD":   { rank:3,  tier:"Large",  capLabel:">$100B",  name:"XRP" },
      "SOL/USD":   { rank:4,  tier:"Large",  capLabel:">$80B",   name:"Solana" },
      "DOGE/USD":  { rank:5,  tier:"Large",  capLabel:">$25B",   name:"Dogecoin" },
      "ADA/USD":   { rank:6,  tier:"Large",  capLabel:">$20B",   name:"Cardano" },
      "AVAX/USD":  { rank:7,  tier:"Large",  capLabel:">$15B",   name:"Avalanche" },
      "SHIB/USD":  { rank:8,  tier:"Mid",    capLabel:">$10B",   name:"Shiba Inu" },
      "DOT/USD":   { rank:9,  tier:"Mid",    capLabel:">$8B",    name:"Polkadot" },
      "LINK/USD":  { rank:10, tier:"Mid",    capLabel:">$8B",    name:"Chainlink" },
      "LTC/USD":   { rank:11, tier:"Mid",    capLabel:">$7B",    name:"Litecoin" },
      "BCH/USD":   { rank:12, tier:"Mid",    capLabel:">$6B",    name:"Bitcoin Cash" },
      "UNI/USD":   { rank:13, tier:"Mid",    capLabel:">$5B",    name:"Uniswap" },
      "ATOM/USD":  { rank:14, tier:"Mid",    capLabel:">$4B",    name:"Cosmos" },
      "XLM/USD":   { rank:15, tier:"Mid",    capLabel:">$3B",    name:"Stellar" },
      "ALGO/USD":  { rank:16, tier:"Mid",    capLabel:">$2B",    name:"Algorand" },
      "AAVE/USD":  { rank:17, tier:"Mid",    capLabel:">$2B",    name:"Aave" },
      "MKR/USD":   { rank:18, tier:"Mid",    capLabel:">$1.5B",  name:"Maker" },
      "GRT/USD":   { rank:19, tier:"Small",  capLabel:">$1B",    name:"The Graph" },
      "NEAR/USD":  { rank:20, tier:"Small",  capLabel:">$1B",    name:"NEAR Protocol" },
      "FIL/USD":   { rank:21, tier:"Small",  capLabel:">$1B",    name:"Filecoin" },
      "XTZ/USD":   { rank:22, tier:"Small",  capLabel:">$800M",  name:"Tezos" },
      "BAT/USD":   { rank:23, tier:"Small",  capLabel:">$500M",  name:"Basic Attention" },
      "CRV/USD":   { rank:24, tier:"Small",  capLabel:">$500M",  name:"Curve DAO" },
      "SUSHI/USD": { rank:25, tier:"Small",  capLabel:">$300M",  name:"SushiSwap" },
      "COMP/USD":  { rank:26, tier:"Small",  capLabel:">$300M",  name:"Compound" },
      "SNX/USD":   { rank:27, tier:"Small",  capLabel:">$300M",  name:"Synthetix" },
      "MATIC/USD": { rank:28, tier:"Small",  capLabel:">$500M",  name:"Polygon" },
      "ENS/USD":   { rank:29, tier:"Small",  capLabel:">$200M",  name:"Ethereum Name Svc" },
      "YFI/USD":   { rank:30, tier:"Small",  capLabel:">$200M",  name:"Yearn Finance" }
    };

    let _moData = [];        // cached overview rows (for re-sort without re-fetch)
    let _msPrevScores = {};  // scores from last Market Signals scan
    let _msLastRows = [];    // last scanned rows (for watchlist cell re-render without a rescan)
    let _msOpenPosSyms = new Set();  // BASE/USD symbols with an open position (watchlist remove gate)

    function moTierColor(tier) {
      return tier === "Mega" ? "var(--blue)" : tier === "Large" ? "var(--green)" : tier === "Mid" ? "var(--yellow)" : "var(--muted)";
    }

    function moFmtVol(v) {
      if (!v && v !== 0) return "–";
      if (v >= 1e9) return "$" + fmt(v / 1e9, 2) + "B";
      if (v >= 1e6) return "$" + fmt(v / 1e6, 1) + "M";
      return "$" + fmt(v, 0);
    }

    function moFmtPrice(p) {
      if (!p) return "–";
      const dec = p < 0.0001 ? 8 : p < 0.01 ? 6 : p < 1 ? 4 : p < 100 ? 2 : 0;
      return "$" + fmt(p, dec);
    }

    function moChgHtml(pct) {
      if (pct === null || pct === undefined || isNaN(pct)) return '<span style="color:var(--muted)">–</span>';
      const cls = pct >= 0 ? "pos" : "neg";
      return '<span class="' + cls + '">' + (pct >= 0 ? "+" : "") + fmt(pct, 2) + "%</span>";
    }

    function moTrendIcon(chg7d) {
      if (chg7d === null || chg7d === undefined || isNaN(chg7d)) return '<span style="color:var(--muted)">–</span>';
      if (chg7d >= 10)  return '<span class="trend-up">↑↑</span>';
      if (chg7d >= 2)   return '<span class="trend-up">↑</span>';
      if (chg7d <= -10) return '<span class="trend-down">↓↓</span>';
      if (chg7d <= -2)  return '<span class="trend-down">↓</span>';
      return '<span class="trend-flat">→</span>';
    }

    function moApplySort() {
      if (!_moData.length) return;
      const sel  = document.getElementById("moSortSelect");
      const mode = sel ? sel.value : "rank";
      const rows = _moData.slice();
      if      (mode === "chg24h_desc") rows.sort(function(a,b){ return (b.chg24h||0)-(a.chg24h||0); });
      else if (mode === "chg24h_asc")  rows.sort(function(a,b){ return (a.chg24h||0)-(b.chg24h||0); });
      else if (mode === "chg7d_desc")  rows.sort(function(a,b){ return (b.chg7d||0)-(a.chg7d||0); });
      else if (mode === "score_desc")  rows.sort(function(a,b){ return (b.score||0)-(a.score||0); });
      else                             rows.sort(function(a,b){ return a.rank-b.rank; });
      renderMoTable(rows);
    }

    function renderMoTable(rows) {
      var tbody = document.getElementById("moTableBody");
      if (!tbody) return;
      tbody.innerHTML = rows.map(function(row) {
        var info      = symbolInfo(row.sym);
        var tierColor = moTierColor(info.tier);
        var scoreStr;
        if (row.score !== null && row.score !== undefined) {
          var sc = row.score;
          var scColor = sc >= SIGNAL_BUY_SCORE ? "var(--green)" : sc >= SIGNAL_HALF_SCORE ? "var(--yellow)" : sc < 0 ? "var(--red)" : "var(--muted)";
          scoreStr = '<span style="color:' + scColor + ';font-weight:700">' + (sc > 0 ? "+" : "") + sc + "</span>";
        } else {
          scoreStr = '<span style="color:var(--muted)">–</span>';
        }
        return "<tr>" +
          '<td style="color:var(--muted);font-weight:700;font-size:12px">#' + info.rank + "</td>" +
          "<td>" + tvLink(row.sym) +
            '<span style="color:var(--muted);font-size:11px;margin-left:5px">' + info.name + "</span></td>" +
          '<td class="right mono">' + moFmtPrice(row.price) + "</td>" +
          '<td class="right">' + moChgHtml(row.chg24h) + "</td>" +
          '<td class="right">' + moChgHtml(row.chg7d)  + "</td>" +
          '<td class="right mono" style="color:var(--muted)">' + moFmtVol(row.vol24h) + "</td>" +
          "<td>" + moTrendIcon(row.chg7d) + "</td>" +
          '<td><span style="font-size:11px;font-weight:800;color:' + tierColor + '">' + info.tier + "</span></td>" +
          "<td>" + scoreStr + "</td>" +
          "<td>" + moTradeButtons(row) + "</td>" +
          "</tr>";
      }).join("");
    }

    // Buy/Sell buttons for a Market Overview row. Opens the shared paper-trade
    // modal (openTradeModal) pre-filled with the symbol, side and live price.
    // Qty is left blank so the user sizes the order in the ticket. Disabled when
    // no live price is available for the row.
    function moTradeButtons(row) {
      var orderSym    = row.sym.replace("/", "");
      var displaySym  = row.sym;   // canonical BASE/QUOTE notation in UI text
      var price       = row.price;
      if (!price) {
        return '<span style="color:var(--muted);font-size:11px">–</span>';
      }
      return '<div class="trade-actions">' +
        '<button class="trade-action-btn" style="font-size:10px" data-tip="Open a paper BUY ticket for ' + displaySym + '" ' +
          'onclick="openTradeModal(\'' + orderSym + '\',\'' + row.sym + '\',\'buy\',\'\',' + price + ')">Buy</button>' +
        '<button class="trade-close-btn" style="font-size:10px;margin-left:4px" data-tip="Open a paper SELL ticket for ' + displaySym + '" ' +
          'onclick="openTradeModal(\'' + orderSym + '\',\'' + row.sym + '\',\'sell\',\'\',' + price + ')">Sell</button>' +
        '</div>';
    }

    function renderMoHeatmap(rows) {
      var sorted = rows.slice().sort(function(a,b){ return (b.chg24h||0)-(a.chg24h||0); });
      var maxAbs = Math.max.apply(null, sorted.map(function(r){ return Math.abs(r.chg24h||0); }).concat([0.01]));
      var html = sorted.map(function(row) {
        var pct = row.chg24h || 0;
        var intensity = Math.min(Math.abs(pct) / maxAbs, 1);
        var bg = pct >= 0
          ? "rgba(63,185,80,"  + (0.15 + intensity * 0.60) + ")"
          : "rgba(248,81,73," + (0.15 + intensity * 0.60) + ")";
        var textCol = intensity > 0.45 ? "#fff" : "var(--text)";
        var sym = row.sym;   // canonical BASE/QUOTE notation on the tile
        return '<div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;' +
          'background:' + bg + ';border-radius:8px;padding:10px 14px;min-width:80px;margin:4px;' +
          'border:1px solid rgba(255,255,255,0.07)" title="' + row.sym + '">' +
          '<div style="font-size:10px;font-weight:800;color:' + textCol + ';letter-spacing:.5px">' + sym + "</div>" +
          '<div style="font-size:13px;font-weight:700;color:' + textCol + ';margin-top:2px">' + (pct >= 0 ? "+" : "") + fmt(pct,2) + "%</div>" +
          '<div style="font-size:10px;color:rgba(255,255,255,.55);margin-top:2px">' + moFmtPrice(row.price) + "</div>" +
          "</div>";
      }).join("");
      var el = document.getElementById("moHeatmap");
      if (el) el.innerHTML = '<div style="display:flex;flex-wrap:wrap">' + html + "</div>";
    }

    async function loadMarketOverview() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        document.getElementById("moTableBody").innerHTML =
          '<tr><td colspan="10" class="placeholder">Configure API credentials in Settings first.</td></tr>';
        return;
      }
      const universe = usdPairsOnly(await getCryptoUniverse());
      const maxSyms  = Math.max(1, Math.round(s.limits.maxSignalSymbols || universe.length));
      const MO_SYMBOLS = universe.slice(0, maxSyms);
      document.getElementById("moTableBody").innerHTML =
        '<tr><td colspan="10" class="placeholder">Fetching market data for ' + MO_SYMBOLS.length + ' symbols…</td></tr>';
      const upd = document.getElementById("moLastUpdated");
      const kEl = document.getElementById("moKpis");
      if (upd) upd.textContent = "Loading…";
      if (kEl) kEl.innerHTML  = kpi("Status", "Loading…", "Fetching snapshots + daily bars");

      try {
        const [snaps, dailyBars] = await Promise.all([
          fetchSnapshotsInBatches(MO_SYMBOLS),
          fetchBarsInBatches(MO_SYMBOLS, "1Day", 10)
        ]);

        const rows = MO_SYMBOLS.map(function(sym) {
          const info   = symbolInfo(sym);
          const alpSym = sym.replace("/","");
          const snap   = snaps[sym] || snaps[alpSym] || null;
          let price = null, chg24h = null, vol24h = null;
          if (snap) {
            price  = snap.latestTrade ? snap.latestTrade.p : (snap.dailyBar ? snap.dailyBar.c : null);
            const ref = snap.prevDailyBar ? snap.prevDailyBar.c : null;
            if (price && ref) chg24h = (price - ref) / ref * 100;
            vol24h = snap.dailyBar ? (snap.dailyBar.v * (price || 1)) : null;
          }
          let chg7d = null;
          if (dailyBars) {
            const db = dailyBars[sym] || dailyBars[alpSym] || [];
            if (db.length >= 7) {
              const c0 = db[db.length - 7].c, c1 = db[db.length - 1].c;
              if (c0) chg7d = (c1 - c0) / c0 * 100;
            }
          }
          const score = (_msPrevScores[sym] !== undefined) ? _msPrevScores[sym] : null;
          return { sym, rank: info.rank, price, chg24h, chg7d, vol24h, score };
        });

        _moData = rows;

        // Market breadth KPIs
        const withData  = rows.filter(function(r){ return r.chg24h !== null; });
        const advancing = withData.filter(function(r){ return r.chg24h > 0; }).length;
        const declining  = withData.filter(function(r){ return r.chg24h < 0; }).length;
        const avgChg    = withData.length ? withData.reduce(function(s,r){ return s+r.chg24h; },0) / withData.length : 0;
        const sorted    = withData.slice().sort(function(a,b){ return b.chg24h - a.chg24h; });
        const top1 = sorted[0], bot1 = sorted[sorted.length-1];
        if (kEl) kEl.innerHTML =
          kpi("Advancing", advancing + " / " + withData.length, "Coins up 24h", advancing/withData.length > 0.6 ? "pos" : advancing/withData.length < 0.4 ? "neg" : "") +
          kpi("Declining",  declining  + " / " + withData.length, "Coins down 24h") +
          kpi("Avg 24h %",  (avgChg >= 0 ? "+" : "") + fmt(avgChg,2) + "%", "Equal-weight avg", avgChg >= 0 ? "pos" : "neg") +
          kpi("Best 24h",   top1 ? top1.sym + " +" + fmt(top1.chg24h,2) + "%" : "–", "Top performer", "pos") +
          kpi("Worst 24h",  bot1 ? bot1.sym + " " + fmt(bot1.chg24h,2) + "%" : "–", "Bottom performer", "neg");

        moApplySort();
        renderMoHeatmap(rows.filter(function(r){ return r.chg24h !== null; }));
        const moCappedNote = maxSyms > universe.length
          ? " · showing all " + universe.length + " tradable USD pairs (Max Symbols " + maxSyms + " exceeds the universe)"
          : "";
        if (upd) upd.textContent = "Last updated: " + new Date().toLocaleTimeString() + moCappedNote;

      } catch(e) {
        document.getElementById("moTableBody").innerHTML =
          '<tr><td colspan="10" style="color:var(--red);padding:16px">❌ ' + e.message + "</td></tr>";
        if (upd) upd.textContent = "Error";
        console.error("loadMarketOverview:", e);
      }
    }

    // ── Market Signals scanner ─────────────────────────────────────────────

    // Full tradable-crypto universe used by BOTH the Market Signals scan and the
    // Market Overview table. Fetched once from Alpaca's assets endpoint and
    // cached, so neither page is capped at the 30 hardcoded TOP30_SYMBOLS.
    // Ordering: the known market-cap-ranked TOP30 first (those still tradable),
    // then every other tradable USD pair alphabetically. Falls back to
    // TOP30_SYMBOLS if the assets call fails or returns nothing usable.
    //
    // Robust to symbol format: Alpaca may return crypto symbols as "BTC/USD" or
    // bare "BTCUSD". Both are normalized to "BASE/QUOTE". Accepted quotes are
    // USD plus the major stablecoin quotes USDT and USDC (see ALLOWED_QUOTES) —
    // so pairs like BTC/USDT and ETH/USDC are included (roadmap 2026-06-19);
    // other quotes (BTC-quoted pairs, etc.) are dropped, as are stablecoin bases
    // (USDT/USD, USDC/USD, … — see STABLECOIN_BASES).
    // NOTE (bug fix 2026-07-09): the Scanner and Market Overview pass this
    // universe through usdPairsOnly() before slicing — Alpaca trades against
    // USD, and the mixed quotes made the same base appear up to 3× per scan.
    // The USDT/USDC pairs remain only for the Settings watchlist selector.
    let _cryptoUniverse = null;
    // Quote currencies the dashboard universe accepts: USD plus the major
    // stablecoin quotes, so BTC/USDT, ETH/USDC, … are selectable and scannable.
    const ALLOWED_QUOTES = { USD: 1, USDT: 1, USDC: 1 };
    // Stablecoin bases excluded from the scan universe — a USDT/USD or USDC/USD
    // "pair" is just the stablecoin priced in dollars, never a tradeable setup,
    // and pollutes the Market Signals / Market Overview / watchlist symbol lists.
    const STABLECOIN_BASES = {
      USDT:1, USDC:1, DAI:1, USDP:1, PYUSD:1, TUSD:1, BUSD:1, GUSD:1,
      USDG:1, FDUSD:1, USDD:1, FRAX:1, LUSD:1, USTC:1
    };
    // Stablecoin USD pairs found in the tradable universe, collected (not just
    // dropped) by getCryptoUniverse() so the Settings symbol selector can offer
    // them when the "Show stablecoins" filter is on. Built alongside
    // _cryptoUniverse; empty on the TOP30 fallback path (no stablecoins there).
    let _stablecoinUniverse = [];
    // sym -> 1-based position in the ordered universe. Used as the rank fallback
    // for symbols outside TOP30_INFO so every row shows a real number, not "?".
    let _universeRank = {};
    function rebuildUniverseRank() {
      _universeRank = {};
      (_cryptoUniverse || []).forEach(function(s, i) { _universeRank[s] = i + 1; });
    }
    // Full info for a symbol: the curated TOP30_INFO when known, otherwise a
    // fallback whose rank is the symbol's position in the universe ordering.
    function symbolInfo(sym) {
      if (TOP30_INFO[sym]) return TOP30_INFO[sym];
      return { rank: _universeRank[sym] || 99, tier: "?", capLabel: "?", name: baseTicker(sym) };
    }
    async function getCryptoUniverse() {
      if (_cryptoUniverse) return _cryptoUniverse;
      try {
        const assets = await apiFetch("/v2/assets?asset_class=crypto&status=active");
        const seen = {};
        const pairs = [];
        const stableSeen = {};
        const stable = [];
        (assets || []).forEach(function(a) {
          if (!a || !a.tradable || typeof a.symbol !== "string") return;
          let sym = a.symbol.toUpperCase();
          if (!sym.includes("/")) {
            // bare form: split off the longest matching allowed quote (USDT/USDC before USD)
            const q = ["USDT", "USDC", "USD"].find(function(qq) { return sym.endsWith(qq); });
            if (!q) return;
            sym = sym.slice(0, -q.length) + "/" + q;   // BTCUSD -> BTC/USD, BTCUSDT -> BTC/USDT
          }
          const slash = sym.indexOf("/");
          const base  = sym.slice(0, slash);
          const quote = sym.slice(slash + 1);
          if (!ALLOWED_QUOTES[quote]) return;        // keep USD/USDT/USDC quotes only (drop BTC-quoted etc.)
          if (STABLECOIN_BASES[base]) {              // stablecoin base: never a directional setup
            if (quote === "USD" && !stableSeen[sym]) { stableSeen[sym] = 1; stable.push(sym); }  // keep USD ones for the opt-in filter
            return;
          }
          if (seen[sym]) return;
          seen[sym] = 1;
          pairs.push(sym);
        });
        const known = TOP30_SYMBOLS.filter(s => pairs.includes(s));
        const extra = pairs.filter(s => !TOP30_SYMBOLS.includes(s)).sort();
        const full  = known.concat(extra);
        if (full.length) {
          _cryptoUniverse = full;     // cache only a real, non-empty result
          _stablecoinUniverse = stable.sort();
          rebuildUniverseRank();
          return _cryptoUniverse;
        }
      } catch (e) {
        console.warn("getCryptoUniverse:", e);
      }
      // Transient fallback: the assets call failed or returned nothing (e.g.
      // it ran on page load before credentials were seeded). Return TOP30
      // WITHOUT caching it, so a later call retries and can pick up the full
      // universe. Caching the fallback here used to stick the universe at 30
      // for the whole session, silently capping every scan below the Max
      // Symbols setting (Bug: fewer symbols scanned than specified).
      const fallback = TOP30_SYMBOLS.slice();
      _universeRank = {};
      fallback.forEach(function(s, i) { _universeRank[s] = i + 1; });
      return fallback;
    }

    // Stablecoin USD pairs available in the tradable universe, for the Settings
    // symbol selector's opt-in "Show stablecoins" filter. Triggers the universe
    // build (which populates _stablecoinUniverse) if it hasn't run yet.
    async function getStablecoinPairs() {
      await getCryptoUniverse();
      return _stablecoinUniverse || [];
    }

    // Alpaca executes trades against USD only, so the trading scan surfaces
    // (Market › Scanner and Market Overview) restrict the shared universe to
    // /USD pairs — otherwise the same base shows up to three times (BTC/USD,
    // BTC/USDT, BTC/USDC) in the results table (bug fix 2026-07-09).
    // USDT/USDC-quoted pairs stay in the full universe for the Settings
    // watchlist selector only.
    function usdPairsOnly(universe) {
      return (universe || []).filter(function(s) { return s.endsWith("/USD"); });
    }

    function updateScanBtnLabel() {
      const btn = document.getElementById("msScanBtn");
      if (!btn) return;
      const n = Math.max(1, Math.round(getSettings().limits.maxSignalSymbols || TOP30_SYMBOLS.length));
      // Clamp the displayed count to the real universe size once it is known —
      // Alpaca only lists ~33 tradable USD pairs, so a Max Symbols of e.g. 60
      // can never be reached. Show "(all available)" so the cap is honest
      // instead of implying 60 symbols exist to scan.
      const uni = _cryptoUniverse ? usdPairsOnly(_cryptoUniverse).length : null;
      if (uni && n > uni) {
        btn.textContent = "▶ Scan Top " + uni + " (all available)";
      } else {
        btn.textContent = "▶ Scan Top " + Math.min(n, uni || n);
      }
    }

    async function loadMarketSignals() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        document.getElementById("msTableBody").innerHTML =
          '<tr><td colspan="14" class="placeholder">Configure API credentials in Settings first.</td></tr>';
        return;
      }
      const universe = usdPairsOnly(await getCryptoUniverse());
      const maxSyms = Math.max(1, Math.round(s.limits.maxSignalSymbols || universe.length));
      const SCAN_SYMBOLS = universe.slice(0, maxSyms);
      updateScanBtnLabel();
      document.getElementById("msTableBody").innerHTML =
        '<tr><td colspan="14" class="placeholder">Scanning ' + SCAN_SYMBOLS.length + ' symbols — fetching 15-min, 4H and daily bars… this may take a moment.</td></tr>';
      const upd = document.getElementById("msLastUpdated");
      const kEl = document.getElementById("msKpis");
      if (upd) upd.textContent = "Loading…";
      if (kEl) kEl.innerHTML  = kpi("Status","Scanning…","Fetching multi-timeframe bars");

      try {
        const [bars15, bars4h, barsD] = await Promise.all([
          fetchBarsInBatches(SCAN_SYMBOLS, "15Min", 120),
          fetchBarsInBatches(SCAN_SYMBOLS, "4Hour", 60),
          fetchBarsInBatches(SCAN_SYMBOLS, "1Day",  60)
        ]);
        if (!bars15) {
          document.getElementById("msTableBody").innerHTML =
            '<tr><td colspan="14" style="color:var(--red);padding:16px">Error fetching bars — check API credentials.</td></tr>';
          return;
        }

        // Snapshot for live prices — batched so one invalid symbol can't kill the whole request
        let snaps = {};
        try {
          snaps = await fetchSnapshotsInBatches(SCAN_SYMBOLS);
        } catch(e) { /* non-fatal */ }

        // Open positions — used by the per-symbol watchlist remove button
        // (only offered when there is no open position for the symbol).
        _msOpenPosSyms = new Set();
        try {
          const ps = await apiFetch("/v2/positions");
          (ps || []).forEach(function(p) {
            _msOpenPosSyms.add(toSlash(p.symbol));
          });
        } catch(e) { /* non-fatal — buttons just won't suppress on open positions */ }

        const rows   = [];
        const scores = [];

        for (const sym of SCAN_SYMBOLS) {
          const alpSym = sym.replace("/","");
          const b15 = (bars15[sym] || bars15[alpSym] || []).map(function(b){ return {c:b.c,h:b.h,l:b.l,v:b.v}; });
          const b4h = (bars4h[sym] || bars4h[alpSym] || []).map(function(b){ return {c:b.c,h:b.h,l:b.l,v:b.v}; });
          const bD  = (barsD[sym]  || barsD[alpSym]  || []).map(function(b){ return {c:b.c,h:b.h,l:b.l,v:b.v}; });
          const snap = snaps[sym] || snaps[alpSym] || null;
          const livePrice = snap && snap.latestTrade ? snap.latestTrade.p : (b15.length ? b15[b15.length-1].c : null);

          if (b15.length < STRAT_CFG.minBarsForSignal) {
            rows.push({ sym, score:null, error: b15.length ? "Insufficient bars (" + b15.length + ")" : "Not available on Alpaca", livePrice });
            continue;
          }
          const res = calcSignalScore(b15, b4h, bD);
          scores.push(res.score);
          rows.push(Object.assign({ sym, livePrice }, res));
        }

        // KPIs
        const valid = rows.filter(function(r){ return r.score !== null; });
        const buys  = valid.filter(function(r){ return r.score >= SIGNAL_BUY_SCORE; }).length;
        const halfs = valid.filter(function(r){ return r.score >= SIGNAL_HALF_SCORE && r.score < SIGNAL_BUY_SCORE; }).length;
        const holds = valid.filter(function(r){ return r.score <= 2 && r.score >= -2; }).length;
        const sells = valid.filter(function(r){ return r.score <= -3; }).length;
        const avgSc = valid.length ? valid.reduce(function(s,r){ return s+r.score; },0) / valid.length : 0;
        if (kEl) kEl.innerHTML =
          kpi("BUY Signals", buys,  "Score >= 3.5", buys > 0 ? "pos" : "") +
          kpi("Half-Size",   halfs, "Score 2.5–3.4") +
          kpi("HOLD",        holds, "Score -2 to +2") +
          kpi("BEAR/Avoid", sells, "Score <= -3 (bearish — shorts unsupported on spot)", sells > 0 ? "neg" : "") +
          kpi("Avg Score",   (avgSc >= 0 ? "+" : "") + fmt(avgSc,1), "Market breadth", avgSc >= 2 ? "pos" : avgSc <= -1 ? "neg" : "");

        // Score bar renderer
        function scoreBar(sc) {
          if (sc === null) return "–";
          const pct   = Math.min(Math.abs(sc), 6) / 6 * 100;
          const color = sc >= SIGNAL_BUY_SCORE ? "#3fb950" : sc >= SIGNAL_HALF_SCORE ? "#d29922" : sc <= 0 ? "#f85149" : "#58a6ff";
          return '<span style="display:inline-flex;align-items:center;gap:5px">' +
            '<span style="width:44px;height:6px;border-radius:3px;background:rgba(255,255,255,.1);display:inline-block">' +
            '<span style="display:block;height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px"></span></span>' +
            '<b style="color:' + color + '">' + (sc > 0 ? "+" : "") + sc + "</b></span>";
        }

        function msActionPill(row) {
          if (row.score === null) return pill("muted","N/A");
          const msDown = row.dailyRegime === "downtrend";
          if (!msDown && row.score >= SIGNAL_BUY_SCORE)  return pill("green","BUY");
          if (!msDown && row.score >= SIGNAL_HALF_SCORE) return pill("yellow","HALF");   // 2.5–3.49 = half-size
          if (msDown && row.score >= SIGNAL_DOWNTREND_LONG_SCORE) return pill("yellow","½ C-Trend");
          if (msDown && row.score >= SIGNAL_HALF_SCORE)  return pill("muted","Blocked");
          if (msDown && row.score <= -3)  return pill("red","BEAR");    // informational — shorts unsupported on Alpaca spot
          return pill("muted","HOLD");
        }

        document.getElementById("msTableBody").innerHTML = rows.map(function(row) {
          const info = symbolInfo(row.sym);
          if (row.error) {
            return '<tr data-unavailable="1">' +
              '<td style="color:var(--muted);font-size:12px">#' + info.rank + "</td>" +
              '<td>' + tvLink(row.sym) + "</td>" +
              '<td class="right mono" style="color:var(--muted)">' + moFmtPrice(row.livePrice) + "</td>" +
              '<td colspan="11" style="color:var(--muted);font-size:12px">' + row.error + "</td>" +
              "</tr>";
          }
          const emaLabel = row.ema20 > row.ema50 ? "Golden" : "Death";
          const emaCls   = row.ema20 > row.ema50 ? "pos" : "neg";
          const r4hLabel = row.ema4h_20 > row.ema4h_50 ? "Golden" : "Death";
          const r4hCls   = row.ema4h_20 > row.ema4h_50 ? "pos" : "neg";
          const regCls   = row.dailyRegime === "uptrend" ? "pos" : row.dailyRegime === "downtrend" ? "neg" : "";
          const prevSc   = _msPrevScores[row.sym];
          const trendHtml = prevSc === undefined ? '<span class="trend-flat">–</span>'
            : row.score > prevSc ? '<span class="trend-up">↑</span>'
            : row.score < prevSc ? '<span class="trend-down">↓</span>'
            : '<span class="trend-flat">→</span>';
          const macdSig = (row.signals && row.signals.macd) || "";
          const macdCls = macdSig.includes("+") ? "pos" : "neg";
          const volSig  = (row.signals && row.signals.volume) || "";
          const volCls  = volSig.includes("+") ? "pos" : volSig.includes("−") ? "neg" : "";
          const pbFmt   = (row.bb_pb !== undefined && row.bb_pb !== null) ? fmt(row.bb_pb,2) : "–";
          return "<tr>" +
            '<td style="color:var(--muted);font-size:12px">#' + info.rank + "</td>" +
            '<td>' + tvLink(row.sym) + "</td>" +
            '<td class="right mono">' + moFmtPrice(row.livePrice || row.lastClose) + "</td>" +
            '<td class="right">' + scoreBar(row.score) + "</td>" +
            "<td>" + trendHtml + "</td>" +
            '<td class="' + emaCls + '">' + emaLabel + "</td>" +
            '<td class="right">' + (row.rsi !== undefined ? fmt(row.rsi,1) : "–") + "</td>" +
            '<td class="' + macdCls + '">' + (macdSig.split("(")[0].replace(/[^a-zA-Z ]/g,"").trim() || "–") + "</td>" +
            '<td class="right">' + pbFmt + "</td>" +
            '<td class="' + volCls + '">' + (volSig.split("(")[0].replace(/[^a-zA-Z ]/g,"").trim() || "–") + "</td>" +
            '<td class="' + r4hCls + '">' + r4hLabel + "</td>" +
            '<td class="' + regCls + '">' + (row.dailyRegime || "–") + "</td>" +
            "<td>" + msActionPill(row) + "</td>" +
            '<td id="mswl-' + row.sym.replace("/","") + '">' + msWatchlistCell(row) + "</td>" +
            "</tr>";
        }).join("");

        _msLastRows = rows;   // cached so watchlist add/remove can re-render cells without a rescan

        // Cache scores for cross-tab score display + trend arrows
        rows.forEach(function(r){ if (r.score !== null) _msPrevScores[r.sym] = r.score; });
        if (_moData.length) moApplySort();  // refresh MO score column live

        // Score distribution — shared tile, identical to the Signals tab
        renderScoreDist("msScoreDist", valid.map(function(r){ return r.score; }).filter(function(s){ return s !== null; }));

        // Top opportunities
        const oppsEl = document.getElementById("msTopOpps");
        if (oppsEl) {
          const buyRows = valid
            .filter(function(r){ return r.score >= SIGNAL_BUY_SCORE && r.dailyRegime !== "downtrend"; })
            .sort(function(a,b){ return b.score - a.score; }).slice(0,5);
          oppsEl.innerHTML = buyRows.length
            ? buyRows.map(function(r) {
                const inf = symbolInfo(r.sym);
                return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px">' +
                  tvLink(r.sym) +
                  '<span style="color:var(--muted);font-size:11px;flex:1">' + (inf.name||"") + "</span>" +
                  '<span style="color:var(--green);font-weight:800">+' + r.score + "</span>" +
                  '<span style="color:var(--muted);font-size:11px">' + (r.dailyRegime||"") + "</span>" +
                  "</div>";
              }).join("")
            : '<span style="color:var(--muted)">No BUY setups currently — market breadth weak.</span>';
        }

        const cappedNote = maxSyms > universe.length
          ? " · Max Symbols (" + maxSyms + ") exceeds the " + universe.length + " tradable USD pairs Alpaca offers — scanning all available"
          : "";
        if (upd) upd.textContent = "Last scanned: " + new Date().toLocaleTimeString() +
          " · " + valid.length + "/" + SCAN_SYMBOLS.length + " symbols analysed" + cappedNote;

      } catch(e) {
        document.getElementById("msTableBody").innerHTML =
          '<tr><td colspan="14" style="color:var(--red);padding:16px">❌ ' + e.message + "</td></tr>";
        if (upd) upd.textContent = "Error";
        console.error("loadMarketSignals:", e);
      }
    }

    let _msHideUnavailable = false;
    function msToggleUnavailable() {
      _msHideUnavailable = !_msHideUnavailable;
      const btn = document.getElementById("msHideBtn");
      document.querySelectorAll("#msTableBody tr[data-unavailable]").forEach(function(tr) {
        tr.style.display = _msHideUnavailable ? "none" : "";
      });
      if (btn) btn.textContent = _msHideUnavailable ? "👁 Show All" : "👁 Hide Unavailable";
    }

    // ── Market Signals per-symbol watchlist control (roadmap item 1) ──────────
    // Add button: shown when score ≥ buy gate (4) and the symbol is not yet on
    // the watchlist. Remove button: shown when the signal is a sell (score ≤ −2)
    // and there is no open position for the symbol. Otherwise show watched/–.
    function msWatchlistCell(row) {
      if (row.score === null || row.error) return '<span style="color:var(--muted)">–</span>';
      const inWl   = getWatchlist().includes(row.sym);
      const hasPos = _msOpenPosSyms.has(row.sym);
      const full   = getWatchlist().length >= WL_MAX;
      if (!inWl && row.score >= SIGNAL_BUY_SCORE) {
        if (full) return '<span class="small" style="color:var(--muted)" title="Watchlist full (' + WL_MAX + ')">full</span>';
        return '<button class="trade-action-btn" onclick="msAddWatch(\'' + row.sym + '\')" title="Score ≥ buy signal — add to watchlist">+ Watch</button>';
      }
      if (inWl && row.score <= -2 && !hasPos) {
        return '<button class="trade-close-btn" onclick="msRemoveWatch(\'' + row.sym + '\')" title="Sell signal & no open position — remove from watchlist">– Unwatch</button>';
      }
      if (inWl) return '<span class="small" style="color:var(--green)">✓ watched</span>';
      return '<span style="color:var(--muted)">–</span>';
    }

    // Re-render just the watchlist cells from the cached rows — no rescan needed.
    function renderMsWatchlistCells() {
      _msLastRows.forEach(function(row) {
        const cell = document.getElementById("mswl-" + row.sym.replace("/",""));
        if (cell) cell.innerHTML = msWatchlistCell(row);
      });
    }

    function msAddWatch(sym) {
      const wl = getWatchlist();
      if (wl.includes(sym)) { renderMsWatchlistCells(); return; }
      if (wl.length >= WL_MAX) { alert("Maximum " + WL_MAX + " symbols allowed."); return; }
      wl.push(sym);
      saveWatchlistData(wl);
      renderWatchlistTags();        // keep the Settings tag editor in sync
      renderMsWatchlistCells();
    }

    function msRemoveWatch(sym) {
      const wl = getWatchlist().filter(function(s){ return s !== sym; });
      saveWatchlistData(wl);
      renderWatchlistTags();
      renderMsWatchlistCells();
    }
