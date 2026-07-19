
    // ═══════════════════════════════════════════════════════════════════════
    //  SIGNAL SCANNER
    // ═══════════════════════════════════════════════════════════════════════

    let _signalCache  = null;
    let _prevScoreMap = {};       // sym → previous scan score
    let _corrCache    = null;     // correlation matrix populated by loadSignals
    let _signalRrMap  = {};       // sym → {stop, stopDistPct, target, rr} from last Signals scan (R:R preview, item 8)

    // ── Live price ticker strip ──────────────────────────────────────────────

    async function loadTickerStrip() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) return;
      const WATCH = getWatchlist();   // active watchlist (Settings) — not a static list (roadmap item 1)
      if (!WATCH.length) return;
      const joined = WATCH.map(encodeURIComponent).join(",");
      try {
        const resp = await fetch(`${DATA_URL}/v1beta3/crypto/us/snapshots?symbols=${joined}`, { headers: getHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        renderTickerStrip(data.snapshots || {}, WATCH);
      } catch(e) { /* silent — ticker is best-effort */ }
    }

    function renderTickerStrip(snapshots, symbols) {
      const el = $("tickerStrip");
      if (!el) return;
      const html = symbols.map(sym => {
        const snap = snapshots[sym] || snapshots[sym.replace("/","")] || null;
        if (!snap) {
          return `<div class="ticker-item"><div class="ticker-sym">${sym}</div><div class="ticker-price" style="color:var(--muted)">–</div></div>`;
        }
        const price  = snap.latestTrade ? snap.latestTrade.p : (snap.dailyBar ? snap.dailyBar.c : null);
        const ref    = snap.prevDailyBar ? snap.prevDailyBar.c : (snap.dailyBar ? snap.dailyBar.o : null);
        const chgPct = (price && ref) ? (price - ref) / ref * 100 : null;
        const cls    = chgPct === null ? "" : chgPct >= 0 ? "pos" : "neg";
        const chgStr = chgPct === null ? "" : (chgPct >= 0 ? "+" : "") + fmt(chgPct, 2) + "%";
        const dec    = price ? (price < 0.01 ? 6 : price < 1 ? 4 : price < 100 ? 2 : 0) : 2;
        return `<div class="ticker-item" data-tip="${sym} · Last: $${price ? fmt(price,dec) : "–"} · 24h: ${chgStr || "–"}">
          <div class="ticker-sym">${sym}</div>
          <div class="ticker-price">${price ? "$" + fmt(price, dec) : "–"}</div>
          ${chgStr ? `<div class="ticker-chg ${cls}">${chgStr}</div>` : ""}
        </div>`;
      }).join("");
      el.innerHTML = html;
    }

    // ── Correlation matrix helpers ───────────────────────────────────────────

    function computeCorrelationMatrix(barsMap, symbols) {
      const returns = {};
      for (const sym of symbols) {
        const bars = barsMap[sym] || barsMap[sym.replace("/","")] || [];
        const closes = bars.map(b => b.c);
        if (closes.length < 10) { returns[sym] = []; continue; }
        const r = [];
        for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i-1]));
        returns[sym] = r;
      }
      const matrix = {};
      for (const a of symbols) {
        matrix[a] = {};
        for (const b of symbols) {
          if (a === b) { matrix[a][b] = 1; continue; }
          const ra = returns[a], rb = returns[b];
          const n = Math.min(ra.length, rb.length);
          if (n < 10) { matrix[a][b] = null; continue; }
          const xa = ra.slice(-n), xb = rb.slice(-n);
          const ma = xa.reduce((s,v) => s+v, 0) / n;
          const mb = xb.reduce((s,v) => s+v, 0) / n;
          let num = 0, da = 0, db = 0;
          for (let i = 0; i < n; i++) {
            const ai = xa[i] - ma, bi = xb[i] - mb;
            num += ai * bi; da += ai * ai; db += bi * bi;
          }
          matrix[a][b] = (da && db) ? num / Math.sqrt(da * db) : null;
        }
      }
      return matrix;
    }

    function renderCorrelationHeatmap(matrix, symbols) {
      const el = $("corrHeatmap");
      if (!el) return;
      // Axis ticks only: base tickers, capped at 4 chars, so the 10×10 grid
      // stays compact. Deliberate exemption from the BASE/QUOTE notation rule.
      const names = symbols.map(s => baseTicker(s));
      const colorFor = r => {
        if (r === null) return "rgba(255,255,255,.06)";
        if (r >= 0) { const a = (r * 0.75 + 0.12).toFixed(2); return `rgba(88,166,255,${a})`; }
        const a = (Math.abs(r) * 0.75 + 0.12).toFixed(2); return `rgba(248,81,73,${a})`;
      };
      let html = `<div style="font-size:10px;color:var(--muted);margin-bottom:6px">Pairwise ρ of daily log-returns. Blue = positive, red = negative.</div>`;
      html += `<div class="corr-wrap"><table><tr><td></td>`;
      for (const n of names) html += `<td class="corr-head">${n.slice(0,4)}</td>`;
      html += `</tr>`;
      for (let i = 0; i < symbols.length; i++) {
        html += `<tr><td class="corr-head" style="text-align:right;padding-right:4px">${names[i].slice(0,4)}</td>`;
        for (let j = 0; j < symbols.length; j++) {
          const r = (matrix[symbols[i]] || {})[symbols[j]];
          const bg = colorFor(i === j ? 1 : r);
          const val = i === j ? "1" : (r !== null ? (r >= 0 ? "+" : "") + fmt(r, 1).replace("-","−") : "–");
          const tc  = Math.abs(r||0) > 0.5 || i === j ? "#fff" : "var(--text)";
          html += `<td class="corr-cell" style="background:${bg}" data-tip="${symbols[i]} vs ${symbols[j]}: ρ = ${r !== null ? fmt(r,2) : 'n/a'}"><span style="color:${tc}">${val}</span></td>`;
        }
        html += `</tr>`;
      }
      html += `</table></div>`;
      html += `<div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--muted)">
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(88,166,255,.75);border-radius:2px;vertical-align:middle;margin-right:3px"></span>High +ve</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(255,255,255,.1);border-radius:2px;vertical-align:middle;margin-right:3px"></span>Low</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:rgba(248,81,73,.75);border-radius:2px;vertical-align:middle;margin-right:3px"></span>Negative</span>
      </div>`;
      el.innerHTML = html;
    }

    // Compute an ISO-8601 UTC start timestamp for the bar fetch.
    // ROOT CAUSE FIX (mirrors run_evaluation.py): Alpaca's crypto bar endpoint
    // ignores a bare `limit` and returns only the current day's partial bars
    // unless an explicit `start` date is supplied.  Always pass `start`.
    function barsStart(limit, timeframe, buffer) {
      buffer = buffer || 1.6;
      const TF_MINUTES = { "5Min": 5, "15Min": 15, "1H": 60, "1Hour": 60, "4Hour": 240, "1Day": 1440 };
      const minutes = TF_MINUTES[timeframe] || 60;
      const ms = limit * minutes * buffer * 60 * 1000;
      return new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, "Z");
    }

    // Compute an ISO-8601 UTC end timestamp that cuts off BEFORE the current
    // in-progress bar.  Subtracting one full bar-period ensures Alpaca only
    // returns bars whose open-time is before the current bar started, i.e. only
    // fully-closed bars are included.  Without this the current partial bar is
    // returned with near-zero volume, causing volume_ratio ≈ 0.00× and unstable
    // RSI / MACD / BB values that change wildly depending on when the page loads.
    function barsEnd(timeframe) {
      const TF_MINUTES = { "5Min": 5, "15Min": 15, "1H": 60, "1Hour": 60, "4Hour": 240, "1Day": 1440 };
      const minutes = TF_MINUTES[timeframe] || 60;
      return new Date(Date.now() - minutes * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    }

    // fetchBars follows next_page_token until all symbols have their full bar
    // history.  The Alpaca multi-symbol endpoint paginates by *total* bars across
    // all symbols (not per-symbol), so a single request for 10 symbols × 120 bars
    // only returns the first ~12 bars per symbol.  Without pagination only the
    // first alphabetical symbol (AAVE) accumulates enough bars; every other symbol
    // falls below the min-bars threshold (STRAT_CFG.minBarsForSignal, 60 —
    // matches config.json › data.min_bars_for_signal) and shows "Insufficient bars".
    async function fetchBars(symbols, timeframe, limit) {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) return null;
      const joined = symbols.map(encodeURIComponent).join(",");
      const start = barsStart(limit, timeframe);
      const allBars = {};
      let pageToken = null;
      let pages = 0;
      const MAX_PAGES = 20; // safety cap

      const end = barsEnd(timeframe);  // exclude the currently-forming bar

      do {
        // Correct endpoint: /v1beta3/crypto/us/bars  (not the old /v2/crypto/bars)
        // end= is required to exclude the in-progress bar (which has near-zero
        // volume and skews every indicator depending on when the page loads).
        let url = `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${joined}&timeframe=${timeframe}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=${limit}&sort=asc`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;

        const resp = await fetch(url, { headers: getHeaders() });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          console.error(`fetchBars ${timeframe} error ${resp.status}:`, errText);
          return null;
        }
        const data = await resp.json();

        for (const [sym, symBars] of Object.entries(data.bars || {})) {
          if (!allBars[sym]) allBars[sym] = [];
          allBars[sym].push(...symBars);
        }

        pageToken = data.next_page_token || null;
        pages++;
      } while (pageToken && pages < MAX_PAGES);

      return allBars;
    }

    // Fetches snapshots for a large symbol list in batches.
    // A single invalid symbol (e.g. one starting with a digit) causes Alpaca to return 400
    // for the whole request, so batching ensures one bad symbol only silences its own batch.
    async function fetchSnapshotsInBatches(symbols, batchSize = 10) {
      const allSnaps = {};
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        try {
          const joined = batch.map(encodeURIComponent).join(",");
          const r = await fetch(DATA_URL + "/v1beta3/crypto/us/snapshots?symbols=" + joined, { headers: getHeaders() });
          if (r.ok) {
            const d = await r.json();
            Object.assign(allSnaps, d.snapshots || {});
          } else {
            console.warn("fetchSnapshotsInBatches: batch", batch, "returned", r.status);
          }
        } catch(e) {
          console.warn("fetchSnapshotsInBatches: batch failed", batch, e);
        }
      }
      return allSnaps;
    }

    // Fetches bars for a large symbol list by splitting into batches of batchSize.
    // A single invalid symbol can cause the Alpaca API to reject the whole request,
    // so batching ensures one bad symbol only silences its own batch of 10.
    async function fetchBarsInBatches(symbols, timeframe, limit, batchSize = 10) {
      const allBars = {};
      let anySuccess = false;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        try {
          const result = await fetchBars(batch, timeframe, limit);
          if (result) {
            anySuccess = true;
            Object.assign(allBars, result);
          }
        } catch(e) {
          console.warn("fetchBarsInBatches: batch failed", batch, e);
        }
      }
      return anySuccess ? allBars : null;
    }
